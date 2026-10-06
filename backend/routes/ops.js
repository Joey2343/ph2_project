'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const simdate = require('../lib/simdate');
const auth = require('../lib/auth');

const approvals = require('../lib/approvals');
const { applyYearFilter } = require('../lib/year-filter');
const telegram = require('../lib/telegram');
const cleanup = require('../lib/cleanup');
const { uploadVehicles, uploadErrorHandler, deleteUploadedFile } = require('../lib/uploads');

const router = express.Router();

/** ปี พ.ศ. ปัจจุบัน */
function getYearBE() {
  return simdate.todayISO().slice(0, 4) - 0 + 543;
}

/** สร้างเลขที่อัตโนมัติต่อปี เช่น 001/2569 */
async function nextDocNo(table, idCol, yearBE) {
  if (!yearBE) yearBE = getYearBE();
  const rows = await db.prepare(`SELECT ${idCol} AS no FROM ${table} WHERE ${idCol} LIKE ?`).all(`%/${yearBE}`);
  let max = 0;
  for (const r of rows) {
    const m = String(r.no).match(/^(\d+)\//);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${max + 1}/${yearBE}`;
}

// ---------- ฟอนต์สำหรับเครื่องมือจัดการข้อความ (จากโฟล์เดอร์ font/) ----------
const FONT_DIR = path.join(__dirname, '..', 'font');
// ต่อท้ายชื่อไฟล์ เช่น Bold Italic / BoldItalic / -Regular / -Medium → แยกเป็นน้ำหนัก + เอียง
const FONT_TOKENS = ['Bold Italic', 'BoldItalic', 'ExtraBold', 'SemiBold', 'Light', 'Medium', 'Regular', 'Bold', 'Italic'];

function deriveFont(file) {
  const base = String(file).replace(/\.[^.]+$/, '');
  let family = base, weight = 400, style = 'normal';
  for (const tok of FONT_TOKENS) {
    const re = new RegExp('\\s*-?(' + tok.replace(' ', '\\s*') + ')$');
    if (re.test(family)) {
      family = family.replace(re, '');
      if (/Bold/.test(tok)) weight = 700;
      else if (/Light/.test(tok)) weight = 300;
      else if (/Medium/.test(tok)) weight = 500;
      if (/Italic/.test(tok)) style = 'italic';
      break;
    }
  }
  family = family.replace(/[\s_-]+$/, '').trim();
  return { family, weight, style, file };
}

// รายการฟอนต์ทั้งหมดในโฟล์เดอร์ font/ (จัดกลุ่มตามชื่อฟอนต์)
router.get('/fonts', (req, res) => {
  let files = [];
  try {
    files = fs.readdirSync(FONT_DIR).filter((f) => /\.(ttf|otf|woff2?)$/i.test(f));
  } catch (e) { /* ignore */ }
  const families = {};
  for (const f of files) {
    const it = deriveFont(f);
    if (!it.family) continue;
    if (!families[it.family]) families[it.family] = { family: it.family, files: [] };
    families[it.family].files.push({ file: it.file, weight: it.weight, style: it.style });
  }
  res.json({ fonts: Object.values(families) });
});

// ---------- สิทธิ์การแก้ไข/ดูบันทึกเวลาทั้งหมด (admin ตั้งค่า) ----------
const { getTimeEditorIds, isTimeEditor } = auth;

async function getTimeEditorUsers() {
  const ids = await getTimeEditorIds();
  if (!ids.length) return [];
  return await db.prepare(`SELECT id, username, full_name, position, workplace FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
}

// ---------- การตรวจตำแหน่งการลงเวลา (GPS มือถือ/แท็บเล็ต, IP คอมพิวเตอร์/แล็ปท็อป) ----------
function clientIp(req) {
  // ตรวจสอบ X-Forwarded-For ก่อน (ถ้ามี reverse proxy)
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first && first !== '::1' && first !== '127.0.0.1') return first;
  }
  // req.ip อาจเป็น ::ffff:192.168.1.5 หรือ ::1 → ปรับเป็น IPv4 ธรรมดา
  let ip = String(req.ip || '').trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}

/** ดึง IP จริงของเครื่อง (จาก network interfaces) */
function getMachineIps() {
  const os = require('os');
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

/** ตรวจว่า IP อยู่ในรายการที่กำหนดหรือไม่ (รองรับ prefix เช่น "192.168.1.") */
function ipAllowed(ip, list) {
  if (!ip) return false;
  const items = String(list || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!items.length) return false;
  return items.some((it) => it === '*' || ip === it || ip.startsWith(it));
}

/** ระยะทางระหว่าง 2 พิกัด (เมตร) โดยใช้สูตร Haversine */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * อ่านค่าตั้งค่าการลงเวลาตามตำแหน่งจากตาราง settings
 *
 * ทุกค่าต้อง await เพราะ db adapter เป็น async (SQLite ใช้ node:sqlite)
 * การไม่ await จะได้ Promise แทนค่าจริง → .trim() ไม่ใช่ฟังก์ชัน
 */
async function getClockGeoConfig() {
  const row = async (key) => {
    const r = await db.prepare('SELECT value FROM settings WHERE `key` = ?').get(key);
    return r ? r.value : null;
  };
  const [enabled, lat, lng, radius, ips] = await Promise.all([
    row('clock_geo_enabled'),
    row('clock_lat'),
    row('clock_lng'),
    row('clock_radius'),
    row('clock_ips'),
  ]);
  return {
    enabled: enabled !== '0', // เปิดใช้โดยค่าเริ่มต้น
    lat: lat !== null && lat !== '' ? Number(lat) : null,
    lng: lng !== null && lng !== '' ? Number(lng) : null,
    radius: radius !== null && radius !== '' ? Number(radius) : 200,
    ips: typeof ips === 'string' ? ips : '',
  };
}

// admin อ่านค่าตั้งค่าตำแหน่งที่ทำงาน
router.get('/time/location-settings', auth.requireAdmin, async (req, res) => {
  res.json(await getClockGeoConfig());
});

// admin ตั้งค่าตำแหน่งที่ทำงาน (ละติจูด/ลองติจูด/รัศมี/IP อินเทอร์เน็ต)
router.put('/time/location-settings', auth.requireAdmin, (req, res) => {
  const { enabled, lat, lng, radius, ips } = req.body || {};
  const set = async (key, value) => { return 
    await db.prepare('INSERT INTO settings (`key`, value) VALUES (?,?) ON CONFLICT(`key`) DO UPDATE SET value = excluded.value').run(key, String(value)) };
  if (enabled !== undefined) set('clock_geo_enabled', enabled ? '1' : '0');
  if (lat !== undefined && lat !== null && lat !== '') {
    const n = Number(lat);
    if (!Number.isFinite(n) || n < -90 || n > 90) return res.status(400).json({ error: 'ละติจูดไม่ถูกต้อง' });
    set('clock_lat', n);
  }
  if (lng !== undefined && lng !== null && lng !== '') {
    const n = Number(lng);
    if (!Number.isFinite(n) || n < -180 || n > 180) return res.status(400).json({ error: 'ลองติจูดไม่ถูกต้อง' });
    set('clock_lng', n);
  }
  if (radius !== undefined && radius !== null && radius !== '') {
    const n = Number(radius);
    if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'รัศมีไม่ถูกต้อง' });
    set('clock_radius', n);
  }
  if (ips !== undefined) set('clock_ips', String(ips || '').trim());
  res.json({ ok: true, message: 'บันทึกค่าตำแหน่งที่ทำงานเรียบร้อย' });
});

// รายชื่อผู้มีสิทธิ์แก้ไขหมายเหตุ (admin)
router.get('/time/editors', auth.requireAdmin, async (req, res) => {
  res.json({ editors: await getTimeEditorUsers(), ids: await getTimeEditorIds() });
});

// admin ตั้งค่าเจ้าหน้าที่ที่ให้สิทธิ์เห็นปุ่มแก้ไขหมายเหตุ
router.put('/time/editors', auth.requireAdmin, async (req, res) => {
  const { user_ids } = req.body || {};
  const ids = Array.isArray(user_ids)
    ? [...new Set(user_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : [];
  await db.prepare("INSERT INTO settings (`key`, value) VALUES ('time_edit_users', ?) ON CONFLICT(`key`) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(ids));
  res.json({ ok: true, message: 'บันทึกสิทธิ์การแก้ไขหมายเหตุเรียบร้อย' });
});

// แก้ไขเวลาเข้างาน/ออกงานของบันทึกเวลา (admin หรือผู้ได้รับสิทธิ์)
router.put('/time/:id', auth.requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare('SELECT * FROM time_records WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบบันทึกเวลา' });
  if (!await isTimeEditor(req.user)) {
    return res.status(403).json({ error: 'คุณไม่มีสิทธิ์แก้ไขบันทึกเวลาในหน้านี้' });
  }
  const { clock_in, clock_out } = req.body || {};
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
  const clean = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
  const ci = clean(clock_in);
  const co = clean(clock_out);
  if (ci !== null && !timeRe.test(ci)) return res.status(400).json({ error: 'รูปแบบเวลาเข้างานไม่ถูกต้อง (HH:MM)' });
  if (co !== null && !timeRe.test(co)) return res.status(400).json({ error: 'รูปแบบเวลาออกงานไม่ถูกต้อง (HH:MM)' });
  await db.prepare('UPDATE time_records SET clock_in = ?, clock_out = ? WHERE id = ?').run(ci, co, id);
  res.json({ ok: true, message: 'บันทึกเวลาเรียบร้อย' });
});

// ลบบันทึกเวลา (admin หรือผู้ได้รับสิทธิ์)
router.delete('/time/:id', auth.requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare('SELECT * FROM time_records WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบบันทึกเวลา' });
  if (!await isTimeEditor(req.user)) {
    return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ลบบันทึกเวลาในหน้านี้' });
  }
  await db.prepare('DELETE FROM time_records WHERE id = ?').run(id);
  res.json({ ok: true, message: 'ลบบันทึกเวลาเรียบร้อย' });
});

// ---------- การ์ดวันเกิด (สมาชิกทุกคน) ----------
router.get('/birthdays', auth.requireAuth, async (req, res) => {
  const today = simdate.todayISO(); // YYYY-MM-DD
  const md = today.slice(5); // MM-DD
  const rows = await db.prepare(`SELECT id, title, full_name, first_name, last_name, birth_date, position, workplace
                           FROM users
                           WHERE status = 'active' AND birth_date IS NOT NULL AND birth_date != ''
                             AND substr(birth_date, 6, 5) = ?
                           ORDER BY full_name`).all(md);
  const year = parseInt(today.slice(0, 4), 10);
  const people = rows.map((u) => {
    const b = String(u.birth_date).slice(0, 10);
    const m = b.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    let age = null;
    if (m) {
      age = year - parseInt(m[1], 10);
      if ((m[2] + '-' + m[3]) > md) age--; // ยังไม่ถึงวันเกิดปีนี้
    }
    return { id: u.id, title: u.title, full_name: u.full_name, first_name: u.first_name, last_name: u.last_name, birth_date: u.birth_date, age, position: u.position, workplace: u.workplace };
  });
  res.json({ count: people.length, people });
});

// ---------- สรุปสถานะวันนี้สำหรับหน้าแรก (สมาชิกทั่วไป) ----------
router.get('/today-summary', auth.requireAuth, async (req, res) => {
  const today = simdate.todayISO(); // YYYY-MM-DD
  const md = today.slice(5); // MM-DD
  const year = parseInt(today.slice(0, 4), 10);

  // ผู้ที่ลงเวลาเข้างานวันนี้
  const worked = await db.prepare(`SELECT u.id, u.title, u.full_name, u.first_name, u.last_name, u.position, u.workplace, t.clock_in, t.clock_out
    FROM time_records t JOIN users u ON u.id = t.user_id
    WHERE t.date = ? AND t.clock_in IS NOT NULL AND u.status = 'active'
    ORDER BY u.full_name`).all(today);

  // ผู้ที่เกิดวันนี้ (พร้อมอายุ)
  const birthdays = (await db.prepare(`SELECT id, title, full_name, first_name, last_name, birth_date, position, workplace
    FROM users WHERE status = 'active' AND birth_date IS NOT NULL AND birth_date != ''
      AND substr(birth_date, 6, 5) = ?
    ORDER BY full_name`).all(md)).map((u) => {
    const m = String(u.birth_date).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    let age = null;
    if (m) {
      age = year - parseInt(m[1], 10);
      if ((m[2] + '-' + m[3]) > md) age--; // ยังไม่ถึงวันเกิดปีนี้
    }
    return { id: u.id, title: u.title, full_name: u.full_name, first_name: u.first_name, last_name: u.last_name, age, position: u.position, workplace: u.workplace };
  });

  // ผู้ที่ลาวันนี้ (คำขอที่อนุมัติแล้วครอบคลุมวันนี้)
  const leave = await db.prepare(`SELECT l.id, u.title, u.full_name, u.first_name, u.last_name, u.position, u.workplace, l.leave_type, l.date_from, l.date_to
    FROM leave_requests l JOIN users u ON u.id = l.user_id
    WHERE l.status = 'approved' AND l.date_from <= ? AND l.date_to >= ? AND u.status = 'active'
    ORDER BY u.full_name`).all(today, today);

  // ผู้ที่ไปราชการวันนี้ (คำขอที่อนุมัติแล้วครอบคลุมวันนี้)
  const travel = await db.prepare(`SELECT t.id, u.title, u.full_name, u.first_name, u.last_name, u.position, u.workplace, t.title AS topic, t.destination, t.date_from, t.date_to
    FROM travel_requests t JOIN users u ON u.id = t.user_id
    WHERE t.status = 'approved' AND t.date_from <= ? AND t.date_to >= ? AND u.status = 'active'
    ORDER BY u.full_name`).all(today, today);

  res.json({ today, worked, birthdays, leave, travel });
});

// ---------- งานที่ค้าง/รออนุมัติของฉัน (เฉพาะ user นั้น ๆ) ----------
router.get('/my-pending', auth.requireAuth, async (req, res) => {
  const uid = req.user.id;
  const count = async (sql) => { return  (await db.prepare(sql).get(uid)).c };
  // งานที่รอการอนุมัติขั้นของ user (ในฐานะผู้อนุมัติ) ต่อขั้น เช่น {1: 2, 2: 1}
  const countAwaiting = async (table, levels) => {
    const out = {};
    if (!levels.length) return out;
    const rows = await db.prepare(`SELECT approval_level FROM ${table}
      WHERE status = 'pending' AND (approval_level + 1) IN (${levels.map(() => '?').join(',')})`).all(...levels);
    for (const l of levels) out[l] = rows.filter((r) => r.approval_level + 1 === l).length;
    return out;
  };
  // บันทึกข้อความ: นับรายการที่รอการอนุมัติจากฉัน (ตาม chain ณ เวลาส่ง)
  const memoLevels = await approvals.getUserSystemLevels(req.user, 'memo');
  const memoApprove = {};
  if (memoLevels.length) {
    const memRows = await db.prepare(`SELECT id, approval_level, approval_chain, next_approver_id FROM memos WHERE status = 'submitted'`).all();
    const liveChain = await approvals.getSystemApprovers('memo');
    for (const l of memoLevels) memoApprove[l] = 0;
    for (const m of memRows) {
      const next = (m.approval_level || 0) + 1;
      if (!memoLevels.includes(next)) continue;
      let ok = false;
      // ส่งต่อเฉพาะเจาะจง (เรียนเสนอ / ผ่านเรื่อง) → นับเฉพาะผู้ที่ถูกเลือก (และ admin)
      if (m.next_approver_id) {
        ok = Number(m.next_approver_id) === req.user.id || req.user.role === 'admin';
      } else {
        let chain = null;
        try { chain = JSON.parse(m.approval_chain || '[]'); } catch (e) { chain = null; }
        if (Array.isArray(chain) && chain.length) {
          const lv = chain.find((x) => Number(x.level) === next);
          ok = !!lv && Array.isArray(lv.ids) && lv.ids.map(Number).includes(req.user.id);
        } else {
          ok = (liveChain[next] || []).includes(req.user.id);
        }
      }
      if (ok) memoApprove[next] = (memoApprove[next] || 0) + 1;
    }
  }
  res.json({
    vehicleNotices: count("SELECT COUNT(*) c FROM vehicle_notices WHERE user_id = ? AND `read` = 0"),
    vehicle: count("SELECT COUNT(*) c FROM vehicle_bookings WHERE user_id = ? AND status = 'pending'"),
    room: count("SELECT COUNT(*) c FROM room_bookings WHERE user_id = ? AND status = 'pending'"),
    travel: count("SELECT COUNT(*) c FROM travel_requests WHERE user_id = ? AND status = 'pending'"),
    leave: count("SELECT COUNT(*) c FROM leave_requests WHERE user_id = ? AND status = 'pending'"),
    // ประเภทคำขอลาของฉันที่รออยู่ (vacation = ลาพักผ่อน, general = อื่น ๆ) เพื่อ deep-link ไปแทปที่ถูกต้อง
    leaveTypes: (async () => {
      const rows = await db.prepare("SELECT leave_type FROM leave_requests WHERE user_id = ? AND status = 'pending'").all(uid);
      const out = { general: 0, vacation: 0 };
      for (const r of rows) {
        if (String(r.leave_type || '').indexOf('พักผ่อน') !== -1) out.vacation++; else out.general++;
      }
      return out;
    })(),
    memo: count("SELECT COUNT(*) c FROM memos WHERE user_id = ? AND status = 'submitted'"),
    memoReturned: count("SELECT COUNT(*) c FROM memos WHERE user_id = ? AND status = 'returned'"),
    approve: {
      vehicle: countAwaiting('vehicle_bookings', await approvals.getUserSystemLevels(req.user, 'vehicle')),
      room: countAwaiting('room_bookings', await approvals.getUserSystemLevels(req.user, 'room')),
      travel: (async () => {
        // สาย สพป. — ตาม role/สิทธิ์อนุมัติเดิม (นับเฉพาะคำขอของเจ้าหน้าที่ สพป. กันนับซ้ำกับสายสถานศึกษา)
        const out = {};
        const levels = await approvals.getUserSystemLevels(req.user, 'travel');
        if (levels.length) {
          const rows = await db.prepare(`SELECT t.approval_level FROM travel_requests t JOIN users u ON u.id = t.user_id
            WHERE t.status = 'pending' AND (t.approval_level + 1) IN (${levels.map(() => '?').join(',')})
            AND COALESCE(u.user_group, CASE WHEN u.school_code = '54020000' THEN 'office' ELSE 'school' END) = 'office'`).all(...levels);
          for (const l of levels) out[l] = rows.filter((r) => r.approval_level + 1 === l).length;
        }
        return out;
      })(),
      travel_school: (async () => {
        // สายสถานศึกษา (3 ขั้น: reviewer→supervisor→approver) — นับคำขอของเจ้าหน้าที่สถานศึกษาที่รอขั้นของฉัน
        const isAdmin = req.user.role === 'admin';
        const tas = await db.prepare("SELECT value FROM settings WHERE `key` = 'travel_approvers_school'").get();
        let mapping = {};
        try { mapping = JSON.parse(tas ? tas.value : '{}'); } catch (e) {}
        const out = {};
        const pendingRows = await db.prepare("SELECT t.user_id, t.approval_level FROM travel_requests t JOIN users u ON u.id = t.user_id WHERE t.status = 'pending' AND COALESCE(u.user_group, CASE WHEN u.school_code = '54020000' THEN 'office' ELSE 'school' END) = 'school'").all();
        for (const r of pendingRows) {
          const entry = mapping[String(r.user_id)];
          if (!entry) continue;
          const next = (r.approval_level || 0) + 1;
          const isMine = isAdmin
            || (next === 1 && Number(entry.reviewer) === req.user.id)
            || (next === 2 && Number(entry.supervisor) === req.user.id)
            || (next === 3 && Number(entry.approver) === req.user.id);
          if (isMine) out[next] = (out[next] || 0) + 1;
        }
        return out;
      })(),
      leave: countAwaiting('leave_requests', await approvals.getUserSystemLevels(req.user, 'leave')),
      // ลาแยกตามประเภท (general = ลาป่วย/ลากิจ/ลาคลอด, vacation = ลาพักผ่อน) + กลุ่มของแต่ละขั้น เพื่อ deep-link จากหน้าแรก
      leave_split: (async () => {
        const levels = await approvals.getUserSystemLevels(req.user, 'leave');
        const out = {};
        if (!levels.length) return out;
        const rows = await db.prepare(`SELECT l.approval_level, l.leave_type, u.user_group, u.school_code FROM leave_requests l JOIN users u ON u.id = l.user_id
          WHERE l.status = 'pending' AND (l.approval_level + 1) IN (${levels.map(() => '?').join(',')})`).all(...levels);
        for (const r of rows) {
          const next = r.approval_level + 1;
          if (!levels.includes(next)) continue;
          const isVac = String(r.leave_type || '').indexOf('พักผ่อน') !== -1;
          const sys = isVac ? 'leave_vacation' : 'leave_general';
          if (!out[sys]) out[sys] = {};
          out[sys][next] = (out[sys][next] || 0) + 1;
        }
        // ใส่กลุ่มผู้ใช้ (office/school) ของแต่ละขั้นเพื่อเลือกแทปที่ถูกต้อง
        for (const sys of Object.keys(out)) {
          for (const lv of Object.keys(out[sys])) {
            if (lv === 'group') continue;
            const row = rows.find((r) => r.approval_level + 1 === Number(lv));
            if (row) out[sys].group = (row.user_group || (row.school_code === '54020000' ? 'office' : 'school'));
          }
        }
        return out;
      })(),
      memo: memoApprove,
    },
  });
});

// ---------- เมนู 3: ลงเวลาทำงาน ----------
router.get('/time/today', auth.requireAuth, async (req, res) => {
  const today = simdate.todayISO();
  const rec = await db.prepare('SELECT * FROM time_records WHERE user_id = ? AND date = ?').get(req.user.id, today);
  res.json({ today, record: rec || null });
});

router.post('/time/check', auth.requireAuth, async (req, res) => {
  // user สถานศึกษาไม่ใช้ระบบลงเวลาทำงาน (ยกเว้น admin)
  if (req.user.user_group === 'school' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'เจ้าหน้าที่สถานศึกษาไม่ใช้ระบบลงเวลาทำงาน' });
  }
  const today = simdate.todayISO();
  const t = new Date().toTimeString().slice(0, 8); // เวลาบนนาฬิกาของระบบ (จำลองตามวันที่ sim_today เมื่อเปิดใช้)
  const { type, device, lat, lng } = req.body || {};
  const cfg = await getClockGeoConfig();
  let rec = await db.prepare('SELECT * FROM time_records WHERE user_id = ? AND date = ?').get(req.user.id, today);

  // ---- ตรวจตำแหน่งตามประเภทอุปกรณ์ ----
  // มือถือ/แท็บเล็ต → ใช้ GPS ของอุปกรณ์; คอมพิวเตอร์/แล็ปท็อป → ใช้ IP อินเทอร์เน็ตของที่ทำงาน
  let src = '';
  const warn = [];
  if (cfg.enabled) {
    if (device === 'mobile') {
      const la = Number(lat), lo = Number(lng);
      if (Number.isFinite(la) && Number.isFinite(lo)) {
        if (cfg.lat !== null && cfg.lng !== null) {
          const dist = haversineMeters(la, lo, cfg.lat, cfg.lng);
          if (dist > cfg.radius) {
            return res.status(403).json({ error: `คุณอยู่นอกพื้นที่ที่กำหนด (ระยะ ${Math.round(dist)} ม. จากที่ทำงาน) — ต้องลงเวลาภายในรัศมี ${cfg.radius} เมตร` });
          }
          src = `GPS (${la.toFixed(6)}, ${lo.toFixed(6)})`;
        } else {
          warn.push('ยังไม่ได้ตั้งค่าพิกัด (ละติจูด/ลองติจูด) ของที่ทำงาน');
        }
      } else {
        return res.status(400).json({ error: 'ไม่ได้รับตำแหน่ง GPS ของอุปกรณ์ — ไม่อนุญาตให้ลงเวลาจากมือถือ/แท็บเล็ต' });
      }
    } else {
      // คอมพิวเตอร์/แล็ปท็อป → ตรวจ IP อินเทอร์เน็ตของที่ทำงาน
      const ip = clientIp(req);
      const hasIps = !!(cfg.ips && cfg.ips.trim());
      if (hasIps) {
        // ถ้า IP เป็น localhost ให้ตรวจ IP จริงของเครื่องด้วย
        let ipToCheck = ip;
        if (ip === '127.0.0.1' || ip === '::1') {
          const machineIps = getMachineIps();
          const matchedIp = machineIps.find(mip => ipAllowed(mip, cfg.ips));
          if (matchedIp) {
            ipToCheck = matchedIp;
          }
        }
        if (!ipAllowed(ipToCheck, cfg.ips)) {
          return res.status(403).json({ error: `คุณไม่ได้เชื่อมต่ออินเทอร์เน็ตของที่ทำงาน (IP: ${ip}) — ไม่อนุญาตให้ลงเวลาจากคอมพิวเตอร์/แล็ปท็อป` });
        }
        src = `IP ${ipToCheck}`;
      } else {
        warn.push('ยังไม่ได้ตั้งค่า IP อินเทอร์เน็ตของที่ทำงาน');
      }
    }
  }

  const note = warn.length ? ` (หมายเหตุ: ${warn.join('; ')})` : '';

  if (type === 'in') {
    if (!rec) {
      await db.prepare('INSERT INTO time_records (user_id, date, clock_in, clock_in_src) VALUES (?,?,?,?)').run(req.user.id, today, t, src || null);
      return res.json({ ok: true, message: `ลงเวลาเข้างาน ${t} เรียบร้อย${note}`, warning: warn });
    }
    return res.status(400).json({ error: 'คุณได้ลงเวลาเข้างานแล้วในวันนี้' });
  }
  if (type === 'out') {
    if (!rec || !rec.clock_in) return res.status(400).json({ error: 'กรุณาลงเวลาเข้างานก่อน' });
    if (rec.clock_out) return res.status(400).json({ error: 'คุณได้ลงเวลาออกงานแล้วในวันนี้' });
    await db.prepare('UPDATE time_records SET clock_out = ?, clock_out_src = ? WHERE id = ?').run(t, src || null, rec.id);
    return res.json({ ok: true, message: `ลงเวลาออกงาน ${t} เรียบร้อย${note}`, warning: warn });
  }
  res.status(400).json({ error: 'ประเภทการลงเวลาไม่ถูกต้อง' });
});

router.get('/time/mine', auth.requireAuth, async (req, res) => {
  const month = req.query.month || simdate.todayISO().slice(0, 7);
  const rows = await db.prepare(`SELECT * FROM time_records WHERE user_id = ? AND date LIKE ?
    ORDER BY date DESC`).all(req.user.id, month + '%');
  res.json({ records: rows, month, can_edit: await isTimeEditor(req.user) });
});

// ดูบันทึกเวลาทั้งหมด — admin และผู้ที่ได้รับสิทธิ์ (เห็นเหมือน admin)
router.get('/time/all', auth.requireAuth, async (req, res) => {
  if (!await isTimeEditor(req.user)) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ดูบันทึกเวลาทั้งหมดในหน้านี้' });
  const { month, date, user_id } = req.query;
  let sql = `SELECT t.*, u.title, u.full_name, u.first_name, u.last_name, u.username, u.workplace FROM time_records t
             JOIN users u ON u.id = t.user_id WHERE 1=1`;
  const args = [];
  if (month) { sql += ' AND t.date LIKE ?'; args.push(month + '%'); }
  if (date) { sql += ' AND t.date = ?'; args.push(date); }
  if (user_id) { sql += ' AND t.user_id = ?'; args.push(Number(user_id)); }
  sql += ' ORDER BY t.date DESC, t.user_id';
  const editors = await getTimeEditorUsers();
  res.json({ records: await db.prepare(sql).all(...args), editors, can_edit: true });
});

// สถิติภาพรวม — admin และผู้ที่ได้รับสิทธิ์
router.get('/time/stats', auth.requireAuth, async (req, res) => {
  if (!await isTimeEditor(req.user)) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ดูสถิติในหน้านี้' });
  const today = simdate.todayISO();
  const checkedIn = (await db.prepare('SELECT COUNT(*) c FROM time_records WHERE date = ? AND clock_in IS NOT NULL').get(today)).c;
  const checkedOut = (await db.prepare('SELECT COUNT(*) c FROM time_records WHERE date = ? AND clock_out IS NOT NULL').get(today)).c;
  const activeUsers = (await db.prepare("SELECT COUNT(*) c FROM users WHERE status = 'active'").get()).c;
  res.json({ date: today, checkedIn, checkedOut, activeUsers });
});

// ---------- รายงานการลงเวลา (วัน/สัปดาห์/เดือน) ----------
/** คำนวณช่วงวันที่จาก period + วันที่อ้างอิง (YYYY-MM-DD หรือ YYYY-MM) */
function reportRange(period, ref) {
  const simIso = simdate.todayISO(); // YYYY-MM-DD (วันจำลองเมื่อเปิดโหมดจำลอง)
  const today = simIso;
  let y = Number(simIso.slice(0, 4)), mo = Number(simIso.slice(5, 7)), d = Number(simIso.slice(8, 10));
  if (ref && /^\d{4}-\d{2}-\d{2}$/.test(ref)) {
    y = Number(ref.slice(0, 4)); mo = Number(ref.slice(5, 7)); d = Number(ref.slice(8, 10));
  } else if (ref && /^\d{4}-\d{2}$/.test(ref)) {
    y = Number(ref.slice(0, 4)); mo = Number(ref.slice(5, 7)); d = 1;
  } else if (ref && /^\d{4}$/.test(ref)) {
    y = Number(ref.slice(0, 4)); mo = 1; d = 1;
  } else if (ref) {
    return null;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (yy, mm, dd) => `${yy}-${pad(mm)}-${pad(dd)}`;
  const dayOfWeek = (yy, mm, dd) => new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay(); // 0=อาทิตย์
  // แสดงวันที่แบบไทย (พ.ศ.) เช่น 14/08/2569
  const beDate = (yy, mm, dd) => `${pad(dd)}/${pad(mm)}/${yy + 543}`;
  const monthsThai = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

  if (period === 'day') {
    return { start: iso(y, mo, d), end: iso(y, mo, d), label: `${parseInt(d, 10)} ${monthsThai[mo - 1]} ${y + 543}` };
  }
  if (period === 'week') {
    const dow = (dayOfWeek(y, mo, d) + 6) % 7; // จันทร์ = 0
    const sDate = new Date(Date.UTC(y, mo - 1, d - dow));
    const sY = sDate.getUTCFullYear(), sM = sDate.getUTCMonth() + 1, sD = sDate.getUTCDate();
    const eDate = new Date(Date.UTC(sY, sM - 1, sD + 6));
    const eY = eDate.getUTCFullYear(), eM = eDate.getUTCMonth() + 1, eD = eDate.getUTCDate();
    return { start: iso(sY, sM, sD), end: iso(eY, eM, eD), label: `${beDate(sY, sM, sD)} ถึง ${beDate(eY, eM, eD)}` };
  }
  if (period === 'month') {
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return { start: iso(y, mo, 1), end: iso(y, mo, lastDay), label: `${monthsThai[mo - 1]} ${y + 543}` };
  }
  if (period === 'year') {
    return { start: iso(y, 1, 1), end: iso(y, 12, 31), label: `ปี พ.ศ. ${y + 543} (1 มกราคม - 31 ธันวาคม ${y + 543})` };
  }
  return null;
}

// ข้อมูลรายงาน — admin หรือผู้ได้รับสิทธิ์
router.get('/time/report', auth.requireAuth, async (req, res) => {
  if (!await isTimeEditor(req.user)) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ดูรายงานในหน้านี้' });
  const period = ['day', 'week', 'month', 'year'].includes(req.query.period) ? req.query.period : 'day';
  const range = reportRange(period, req.query.date);
  if (!range) return res.status(400).json({ error: 'วันที่ไม่ถูกต้อง' });
  const rows = await db.prepare(`SELECT t.id, t.date, t.clock_in, t.clock_out, u.title, u.full_name, u.first_name, u.last_name, u.username, u.position, u.workplace
    FROM time_records t JOIN users u ON u.id = t.user_id
    WHERE t.date BETWEEN ? AND ?
    ORDER BY t.date ASC, u.full_name ASC`).all(range.start, range.end);
  res.json({ period, range, records: rows });
});

// ดาวน์โหลดรายงาน .xlsx — admin หรือผู้ได้รับสิทธิ์
router.get('/time/report.xlsx', auth.requireAuth, async (req, res) => {
  if (!await isTimeEditor(req.user)) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ดาวน์โหลดรายงานในหน้านี้' });
  const period = ['day', 'week', 'month', 'year'].includes(req.query.period) ? req.query.period : 'day';
  const range = reportRange(period, req.query.date);
  if (!range) return res.status(400).json({ error: 'วันที่ไม่ถูกต้อง' });
  const rows = await db.prepare(`SELECT t.date, t.clock_in, t.clock_out, u.title, u.full_name, u.first_name, u.last_name, u.position, u.workplace
    FROM time_records t JOIN users u ON u.id = t.user_id
    WHERE t.date BETWEEN ? AND ?
    ORDER BY t.date ASC, u.full_name ASC`).all(range.start, range.end);

  const XLSX = require('xlsx');
  const head = [['รายงานการลงเวลาทำงาน', '', '', '', '', ''],
    ['สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2', '', '', '', '', ''],
    [`ช่วงเวลา: ${range.label}`, '', '', '', '', ''],
    []];
  const body = rows.map((r) => [r.date, r.full_name, r.position || '', r.workplace || '', r.clock_in || '-', r.clock_out || '-']);
  const aoa = head.concat([['วันที่', 'ชื่อ-นามสกุล', 'ตำแหน่ง', 'กลุ่มงาน', 'เวลาเข้า', 'เวลาออก']], body);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 12 }, { wch: 26 }, { wch: 30 }, { wch: 28 }, { wch: 10 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'รายงานการลงเวลา');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="report-time-${range.start}-to-${range.end}.xlsx"`);
  res.send(buf);
});

// ---------- เมนู 4: จองยานพาหนะ ----------
router.get('/vehicles', async (req, res) => {
  res.json({ vehicles: await db.prepare('SELECT * FROM vehicles ORDER BY id').all() });
});

/** รายชื่อบุคลากรที่ใช้งานอยู่ (สำหรับเลือกพนักงานขับรถ ฯลฯ) */
router.get('/users/active', auth.requireAuth, async (req, res) => {
  const rows = await db.prepare("SELECT id, title, first_name, last_name, full_name, position FROM users WHERE status = 'active' ORDER BY full_name").all();
  res.json({ users: rows });
});

router.post('/vehicles', auth.requireAdmin, uploadVehicles.single('photo'), uploadErrorHandler, async (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อยานพาหนะ' });
  const photo = req.file ? 'vehicles/' + req.file.filename : null;
  const info = await db.prepare('INSERT INTO vehicles (name, plate, type, capacity, status, notes, photo) VALUES (?,?,?,?,?,?,?)')
    .run(String(b.name).trim(), (b.plate || '').trim(), (b.type || '').trim(),
      Number(b.capacity) || 0, b.status || 'available', (b.notes || '').trim(), photo);
  res.json({ ok: true, id: info.lastInsertRowid, message: 'เพิ่มยานพาหนะเรียบร้อย' });
});

router.put('/vehicles/:id', auth.requireAdmin, uploadVehicles.single('photo'), uploadErrorHandler, async (req, res) => {
  const id = Number(req.params.id);
  const cur = await db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'ไม่พบยานพาหนะ' });
  const b = req.body || {};
  // รูปใหม่: ไฟล์ที่อัปโหลด / ส่งค่า '' เพื่อลบรูปเดิม / ไม่ส่ง = คงรูปเดิม
  let newPhoto = cur.photo;
  if (b.photo !== undefined && String(b.photo) === '') newPhoto = null;
  if (req.file) {
    newPhoto = 'vehicles/' + req.file.filename;
    if (cur.photo) deleteUploadedFile(cur.photo);
  }
  await db.prepare('UPDATE vehicles SET name=?, plate=?, type=?, capacity=?, status=?, notes=?, photo=? WHERE id=?')
    .run(String(b.name || '').trim(), (b.plate || '').trim(), (b.type || '').trim(),
      Number(b.capacity) || 0, b.status || 'available', (b.notes || '').trim(), newPhoto, id);
  res.json({ ok: true, message: 'แก้ไขยานพาหนะเรียบร้อย' });
});

router.delete('/vehicles/:id', auth.requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const cur = await db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
  if (cur && cur.photo) deleteUploadedFile(cur.photo);
  // ลบการจองทั้งหมดที่ผูกกับรถคันนี้ + ข้อความแจ้งเตือนของการจองนั้น (ไม่ทิ้งค่าค้างใน DB)
  await cleanup.purgeVehicleBookings(id);
  await db.prepare('DELETE FROM vehicles WHERE id = ?').run(id);
  res.json({ ok: true, message: 'ลบยานพาหนะเรียบร้อย' });
});

// ---------- การมอบหมายผู้อนุมัติยานพาหนะ (admin ตั้งค่า) ----------
router.get('/vehicle/approvers', auth.requireAdmin, async (req, res) => {
  const approvers = await approvals.getSystemApprovers('vehicle');
  const staff = await db.prepare(`SELECT id, title, full_name, first_name, last_name, position, workplace, role FROM users
    WHERE status = 'active' ORDER BY full_name`).all();
  res.json({ approvers, staff });
});

router.put('/vehicle/approvers', auth.requireAdmin, async (req, res) => {
  const b = req.body || {};
  const toIds = (v) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []);
  let level1 = toIds(b.level1), level2 = toIds(b.level2);
  const all = [...new Set([...level1, ...level2])];
  if (all.length) {
    const rows = await db.prepare(`SELECT id FROM users WHERE id IN (${all.map(() => '?').join(',')}) AND status = 'active'`).all(...all);
    const valid = new Set(rows.map((r) => r.id));
    level1 = level1.filter((n) => valid.has(n));
    level2 = level2.filter((n) => valid.has(n));
  }
  const approvers = { 1: level1, 2: level2 };
  // ห้องประชุม + ยานพาหนะใช้รายการผู้อนุมัติชุดเดียวกัน
  await db.prepare("UPDATE settings SET value = ? WHERE `key` = 'approvers_booking'").run(JSON.stringify(approvers));
  res.json({ ok: true, message: 'บันทึกผู้อนุมัติการจอง (ห้องประชุม + ยานพาหนะ) เรียบร้อย' });
});

// ขั้นที่ผู้ใช้ปัจจุบันได้รับมอบหมายให้อนุมัติยานพาหนะ
router.get('/vehicle/approvers/me', auth.requireAuth, async (req, res) => {
  const levels = await approvals.getUserSystemLevels(req.user, 'vehicle');
  res.json({ levels, can_approve: levels.length > 0 });
});

/**
 * ตัวกรอง "ปี พ.ศ." สำหรับรายการจองห้องประชุมและยานพาหนะ
 *
 * ครอบ applyYearFilter() จาก lib/year-filter.js ไว้ในไฟล์นี้
 * เพื่อให้อ่านต่อเนื่องกับ SQL ที่อยู่ข้าง ๆ
 *
 * ประวัติ: เดิมใช้ booking_no LIKE '%/<ปี>' ซึ่งพังกับรายการที่ไม่มีเลขเอกสาร
 * → เลือกปีปัจจุบันแล้วเห็น 0 รายการ ทั้งที่มีข้อมูลอยู่จริง
 */
router.get('/vehicle-bookings', auth.requireAuth, async (req, res) => {
  // ทุก user (ที่ล็อกอิน) เห็นรายการจองทั้งหมด — ลบ/ยกเลิกได้เฉพาะของตัวเอง (ตรวจใน DELETE)
  const { status, vehicle_id, mine, year } = req.query;
  let sql = `SELECT v.*, u.title, u.full_name, u.first_name, u.last_name, u.username, vh.name AS vehicle_name, vh.plate
             FROM vehicle_bookings v JOIN users u ON u.id = v.user_id
             LEFT JOIN vehicles vh ON vh.id = v.vehicle_id WHERE 1=1`;
  const args = [];
  if (mine === '1') { sql += ' AND v.user_id = ?'; args.push(req.user.id); }
  if (status) { sql += ' AND v.status = ?'; args.push(status); }
  if (vehicle_id) { sql += ' AND v.vehicle_id = ?'; args.push(Number(vehicle_id)); }
  sql = applyYearFilter(sql, args, 'v.date', year);
  sql += ' ORDER BY v.created_at DESC, v.id DESC';
  const rows = await db.prepare(sql).all(...args);
  const required = await approvals.getRequiredLevels('vehicle');
  res.json({ bookings: rows.map((r) => ({ ...r, required_levels: required, approvals: approvals.parseApprovals(r.approval_data) })) });
});

// ตรวจสอบว่ายานพาหนะถูกจองซ้อนทับกับรายการอื่นหรือไม่ (คันเดียวกัน + ช่วงวันที่/เวลาซ้อนทับ)
async function findVehicleClash(vehicleId, dateFrom, dateTo, startTime, endTime, excludeId) {
  if (!vehicleId) return null; // มอบเจ้าหน้าที่จัดให้ → ยังไม่เช็คคันรถ
  const s = (startTime || '').slice(0, 5), e = (endTime || '').slice(0, 5);
  const rows = await db.prepare(`SELECT v.id, v.start_time, v.end_time, v.purpose, v.date, v.date_to, u.full_name
    FROM vehicle_bookings v JOIN users u ON u.id = v.user_id
    WHERE v.vehicle_id = ? AND v.status IN ('pending','approved') AND v.id != ?
      AND COALESCE(v.date_to, v.date) >= ? AND v.date <= ?`)
    .all(Number(vehicleId), Number(excludeId) || 0, dateFrom, dateTo || dateFrom);
  return rows.find((c) => timeOverlap(s, e, c.start_time, c.end_time)) || null;
}

// ตรวจสอบว่าช่วงวันที่/เวลาที่เลือกซ้อนทับกับการจองยานพาหนะที่มีอยู่หรือไม่ (ชื่อคนจอง + วัตถุประสงค์)
router.get('/vehicle-bookings/conflicts', auth.requireAuth, async (req, res) => {
  const { vehicle_id, date, date_to, start_time, end_time, exclude } = req.query;
  if (!vehicle_id || !date) return res.json({ conflicts: [] });
  const hit = await findVehicleClash(Number(vehicle_id), date, date_to, start_time, end_time, Number(exclude) || 0);
  res.json({ conflicts: hit ? [hit] : [] });
});

router.post('/vehicle-bookings', auth.requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.date) return res.status(400).json({ error: 'กรุณาเลือกวันที่' });
  if (!b.purpose || !String(b.purpose).trim()) return res.status(400).json({ error: 'กรุณากรอกวัตถุประสงค์' });
  // vehicle_id ว่าง/0 = มอบเจ้าหน้าที่จัดให้ (ไม่มีรถเฉพาะ)
  const vehicleId = b.vehicle_id ? Number(b.vehicle_id) : 0;
  // กันการจองซ้ำ: คันเดียวกัน + ช่วงวันที่/เวลาซ้อนทับ
  const clash = await findVehicleClash(vehicleId, b.date, b.date_to, b.start_time, b.end_time, 0);
  if (clash) {
    return res.status(409).json({ error: `ยานพาหนะคันนี้ถูกจองไว้แล้วในช่วงเวลานี้ (${clash.full_name} • ${clash.purpose})` });
  }
  const totalDays = calcTripDays(b.date, b.date_to);
  const bookingNo = await nextDocNo('vehicle_bookings', 'booking_no');
  const info = await db.prepare(`INSERT INTO vehicle_bookings
    (booking_no, vehicle_id, user_id, date, start_time, date_to, end_time, total_days, purpose, destination,
     passenger_count, controller, fuel_choice, fuel_project, fuel_activity, fuel_amount, self_drive)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(bookingNo, vehicleId, req.user.id, b.date, (b.start_time || '').trim(), b.date_to || null,
      (b.end_time || '').trim(), totalDays, String(b.purpose).trim(), (b.destination || '').trim(),
      Number(b.passenger_count) || 0, (b.controller || '').trim(), (b.fuel_choice || '').trim(),
      (b.fuel_project || '').trim(), (b.fuel_activity || '').trim(), Number(b.fuel_amount) || 0,
      b.self_drive ? 1 : 0);
  // แจ้งเตือน Telegram ไปยังผู้อนุมัติขั้นต้นว่ามีคำขอใช้ยานพาหนะใหม่
  await telegram.notifyVehicleSubmitted(Number(info.lastInsertRowid));
  res.json({ ok: true, id: info.lastInsertRowid, message: 'ส่งคำขอยืมยานพาหนะเรียบร้อย รอผู้ดูแลระบบอนุมัติ' });
});

/** คำนวณจำนวนวันเดินทาง (รวมวันแรกและวันสุดท้าย) จากวันที่เริ่ม-สิ้นสุด */
function calcTripDays(from, to) {
  if (!from) return 1;
  if (!to || to === from) return 1;
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a) return 1;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function timeOverlap(aStart, aEnd, bStart, bEnd) {
  const s1 = aStart || '00:00', e1 = aEnd || '23:59';
  const s2 = bStart || '00:00', e2 = bEnd || '23:59';
  return s1 < e2 && s2 < e1;
}

router.put('/vehicle-bookings/:id/approve', auth.requireAuth, async (req, res) => {
  const { note, driver_name, vehicle_id } = req.body || {};
  const bookingId = Number(req.params.id);
  // กรณีผู้อนุมัติขั้นต้นเลือกยานพาหนะให้ผู้ขอ (ผู้ขอเลือกมอบเจ้าหน้าที่จัดให้)
  // → เช็คก่อนว่ายานพาหนะคันนั้นซ้อนกับรายการอื่นในช่วงวันที่/เวลาที่ขอหรือไม่
  if (vehicle_id !== undefined && Number(vehicle_id) > 0) {
    const row = await db.prepare('SELECT date, date_to, start_time, end_time FROM vehicle_bookings WHERE id = ?').get(bookingId);
    const clash = row ? await findVehicleClash(Number(vehicle_id), row.date, row.date_to, row.start_time, row.end_time, bookingId) : null;
    if (clash) {
      return res.status(409).json({ error: `ไม่สามารถจัดยานพาหนะคันนี้ได้ — ถูกจองไว้แล้วในช่วงเวลาที่ขอ (${clash.full_name} • ${clash.purpose})` });
    }
    await db.prepare('UPDATE vehicle_bookings SET vehicle_id = ? WHERE id = ?').run(Number(vehicle_id), bookingId);
  }
  // บันทึกพนักงานขับรถที่ผู้อนุมัติขั้นต้นเลือก (ถ้ามี)
  if (driver_name && String(driver_name).trim()) {
    await db.prepare('UPDATE vehicle_bookings SET driver_name = ? WHERE id = ?').run(String(driver_name).trim(), bookingId);
  }
  const result = await approvals.approveRequest({
    table: 'vehicle_bookings', system: 'vehicle', id: Number(req.params.id), user: req.user, note,
    canApproveFn: (u, level) => approvals.canApproveSystem(u, 'vehicle', level),
    levelLabelFn: (level) => (level <= 1 ? 'ขั้นต้น' : 'ขั้นสุดท้าย'),
    onFinal: async (row) => {
      // ไม่ระบุรถ (มอบเจ้าหน้าที่จัดให้) → ไม่ตรวจการซ้อนทับของรถ
      if (!row.vehicle_id) return null;
      const clash = await db.prepare(`SELECT * FROM vehicle_bookings
        WHERE vehicle_id = ? AND date = ? AND status = 'approved' AND id != ?`).all(row.vehicle_id, row.date, row.id);
      for (const c of clash) {
        if (timeOverlap(row.start_time, row.end_time, c.start_time, c.end_time)) {
          return { error: `ช่วงเวลาซ้อนทับกับการจองที่อนุมัติแล้ว (${c.purpose})`, code: 409 };
        }
      }
      return null;
    },
  });
  if (result.error) return res.status(result.code || 400).json({ error: result.error });
  if (result.approved) {
    // อนุมัติครบขั้นแล้ว → แจ้งเตือน Telegram (ข้อความสีเขียว 🟢) ไปยังผู้จอง
    await telegram.notifyRequest({ system: 'vehicle', id: Number(req.params.id), approved: true, deciderName: req.user.full_name, note });
  } else {
    // ผ่านขั้นต้น → แจ้งผู้อนุมัติขั้นถัดไป + พนักงานขับรถที่ถูกเลือก
    await telegram.notifyVehicleNextLevel(Number(req.params.id), req.user.full_name);
    await telegram.notifyVehicleDriver(Number(req.params.id), req.user.full_name);
  }
  res.json(result);
});

router.put('/vehicle-bookings/:id/reject', auth.requireAuth, async (req, res) => {
  const { note } = req.body || {};
  const result = await approvals.rejectRequest({
    table: 'vehicle_bookings', id: Number(req.params.id), user: req.user, note,
    allowFn: (u) => approvals.getUserSystemLevels(u, 'vehicle').length > 0,
  });
  if (result.error) return res.status(result.code || 400).json({ error: result.error });
  // ไม่อนุมัติ → แจ้งเตือนทันที (ข้อความสีแดง 🔴) ไปยังผู้จอง
  await telegram.notifyRequest({ system: 'vehicle', id: Number(req.params.id), approved: false, deciderName: req.user.full_name, note });
  res.json(result);
});

// ยกเลิกรายการจองยานพาหนะ — เจ้าของรายการ (ยังรออนุมัติ) / ผู้อนุมัติขั้นต้น / admin ยกเลิกได้
// เมื่อยกเลิก ระบบจะส่งข้อความในระบบ + Telegram แจ้งผู้จองและพนักงานขับรถ
router.delete('/vehicle-bookings/:id', auth.requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare('SELECT * FROM vehicle_bookings WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบรายการจอง' });
  const isOwner = Number(row.user_id) === req.user.id;
  const isApprover = req.user.role === 'admin' || (await approvals.getUserSystemLevels(req.user, 'vehicle')).includes(1);
  if (!isOwner && !isApprover) return res.status(403).json({ error: 'ไม่มีสิทธิ์ยกเลิกรายการนี้' });
  if (isOwner && !isApprover && row.status !== 'pending') {
    return res.status(403).json({ error: 'รายการนี้ผ่านการอนุมัติแล้ว — เฉพาะผู้อนุมัติขั้นต้นหรือผู้ดูแลระบบเท่านั้นที่ยกเลิกได้' });
  }
  // เตรียมข้อมูลสำหรับการแจ้งเตือนก่อนลบ (ชื่อรถ + ผู้จอง)
  const veh = row.vehicle_id ? await db.prepare('SELECT name AS vehicle_name, plate AS vehicle_plate FROM vehicles WHERE id = ?').get(row.vehicle_id) : null;
  const notifyRow = {
    ...row,
    vehicle_name: veh ? veh.vehicle_name : null,
    vehicle_plate: veh ? veh.vehicle_plate : null,
  };
  await db.prepare('DELETE FROM vehicle_bookings WHERE id = ?').run(id);
  // ผู้จองยกเลิกเอง → ไม่ต้องแจ้งตัวเองซ้ำ (admin/ขั้นต้นยกเลิก → แจ้งผู้จอง + พนักงานขับรถ)
  await telegram.notifyVehicleCancelled(notifyRow, req.user.full_name, { skipBooker: isOwner && !isApprover });
  res.json({ ok: true, message: 'ยกเลิกรายการจองยานพาหนะเรียบร้อย — แจ้งเตือนผู้จองและพนักงานขับรถแล้ว' });
});

// แก้ไขการจองยานพาหนะ (เฉพาะผู้อนุมัติขั้นต้น / admin — แก้ได้แม้อนุมัติแล้ว)
// แก้ไขได้: ยานพาหนะ, วันที่/เวลา, พนักงานขับรถ → ส่งข้อความในระบบ + Telegram แจ้งผู้จอง/พนักงานขับรถ
router.put('/vehicle-bookings/:id/edit', auth.requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare('SELECT * FROM vehicle_bookings WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบรายการจอง' });
  if (req.user.role !== 'admin' && !(await approvals.getUserSystemLevels(req.user, 'vehicle')).includes(1)) {
    return res.status(403).json({ error: 'เฉพาะผู้อนุมัติขั้นต้นหรือผู้ดูแลระบบเท่านั้นที่แก้ไขการจองได้' });
  }
  const b = req.body || {};
  // ค่าที่แก้ไข (ถ้าไม่ส่ง = คงเดิม)
  const vehicleId = b.vehicle_id !== undefined && b.vehicle_id !== '' ? Number(b.vehicle_id) : row.vehicle_id;
  const date = b.date || row.date;
  const dateTo = b.date_to !== undefined ? (b.date_to || null) : row.date_to;
  const startTime = b.start_time !== undefined ? String(b.start_time || '').trim() : row.start_time;
  const endTime = b.end_time !== undefined ? String(b.end_time || '').trim() : row.end_time;
  const driverName = b.driver_name !== undefined ? String(b.driver_name || '').trim() : row.driver_name;
  if (!date) return res.status(400).json({ error: 'กรุณาระบุวันที่' });
  // กันการจองซ้ำกับรายการอื่น (คันเดียวกัน + ช่วงวันที่/เวลาซ้อนทับ)
  if (vehicleId) {
    const clash = await findVehicleClash(vehicleId, date, dateTo, startTime, endTime, id);
    if (clash) {
      return res.status(409).json({ error: `ยานพาหนะคันนี้ถูกจองไว้แล้วในช่วงเวลาที่แก้ไข (${clash.full_name} • ${clash.purpose})` });
    }
  }
  const oldDriver = row.driver_name;
  const totalDays = calcTripDays(date, dateTo);
  await db.prepare(`UPDATE vehicle_bookings SET vehicle_id=?, date=?, start_time=?, date_to=?, end_time=?, total_days=?, driver_name=? WHERE id=?`)
    .run(vehicleId, date, startTime, dateTo, endTime, totalDays, driverName || null, id);
  // แจ้งเตือนผู้จอง + พนักงานขับรถเดิม + พนักงานขับรถคนใหม่ (ในระบบ + Telegram)
  await telegram.notifyVehicleEdited(id, req.user.full_name, { oldDriver, newDriver: driverName });
  res.json({ ok: true, message: 'แก้ไขการจองยานพาหนะเรียบร้อย — แจ้งเตือนผู้เกี่ยวข้องแล้ว' });
});

// ข้อความแจ้งเตือนในระบบ (มีการแก้ไข/ยกเลิกการจองยานพาหนะ) ของผู้ใช้ปัจจุบัน — เฉพาะที่ยังไม่ได้อ่าน (อ่านแล้วจะหายไป)
router.get('/vehicle-bookings/notices', auth.requireAuth, async (req, res) => {
  const rows = await db.prepare(`SELECT * FROM vehicle_notices WHERE user_id = ? AND \`read\` = 0 ORDER BY id DESC LIMIT 50`).all(req.user.id);
  res.json({ notices: rows, unread: rows.length });
});

// อ่านข้อความแจ้งเตือนทั้งหมดแล้ว
router.put('/vehicle-bookings/notices/read', auth.requireAuth, async (req, res) => {
  await db.prepare('UPDATE vehicle_notices SET `read` = 1 WHERE user_id = ? AND `read` = 0').run(req.user.id);
  res.json({ ok: true, message: 'ทำเครื่องหมายอ่านแล้ว' });
});

/** ข้อมูลครบสำหรับแบบฟอร์ม บันทึกการขอใช้ยานพาหนะ (ผู้ขอ + เจ้าหน้าที่/คนขับ + ผู้อนุมัติ พร้อมลายเซ็น) */
router.get('/vehicle-bookings/:id/document', auth.requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare(`SELECT v.*, u.title AS req_title, u.full_name AS req_name, u.first_name AS req_first_name, u.last_name AS req_last_name, u.position AS req_position, u.signature AS req_signature
    FROM vehicle_bookings v JOIN users u ON u.id = v.user_id WHERE v.id = ?`).get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบรายการ' });
  // ผู้อนุมัติตามลำดับขั้น (จาก approval_data)
  const approvers = await Promise.all(approvals.parseApprovals(row.approval_data).map(async (a) => {
    const uid = a.user_id ?? a.by;
    const u = uid ? await db.prepare('SELECT title, full_name, first_name, last_name, position, signature FROM users WHERE id = ?').get(uid) : null;
    return u || { title: '', full_name: a.name || '', first_name: '', last_name: '', position: '', signature: null };
  }));
  // เจ้าหน้าที่ = ผู้อนุมัติขั้นต้น (คนแรกที่อนุมัติ) — ผู้อนุมัติ = คนสุดท้ายที่อนุมัติ (เฉพาะเมื่อครบทุกขั้น)
  const staff = approvers.length ? approvers[0] : null;
  const finalApprover = row.status === 'approved' && approvers.length ? approvers[approvers.length - 1] : null;
  // พนักงานขับรถ (สำหรับข้อความ เห็นควรให้ ... เป็นพนักงานขับรถในราชการนี้)
  // เปรียบเทียบโดยตัดคำนำหน้า + ย่อช่องว่างหลายช่องให้เป็น 1 ช่อง (รองรับรูปแบบชื่อที่ต่างกัน)
  const driver = row.driver_name ? await findDriver(row.driver_name) : null;
  res.json({ row, staff, approvers, finalApprover, driver });
});

/** ค้นหาผู้ใช้ที่เป็นพนักงานขับรถจากชื่อ (ตัดคำนำหน้า + ย่อช่องว่าง) */
async function findDriver(name) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const dn = norm(name);
  if (!dn) return null;
  // 1) ชื่อตรงกันทุกตัว (ไม่รวมคำนำหน้า)
  const all = await db.prepare("SELECT title, full_name, first_name, last_name, position, signature FROM users WHERE status = 'active'").all();
  const byName = all.find((u) => norm(u.full_name) === dn);
  if (byName) return byName;
  // 2) ตัดคำนำหน้า (นาย/นาง/นางสาว/ว่าที่...) ออกจากชื่อที่ส่งมา แล้วเทียบกับ full_name
  const bare = dn.replace(/^(ว่าที่ร้อยตรีหญิง|ว่าที่ร้อยตรี|นาย|นางสาว|นาง)\s*/, '');
  const hit = all.find((u) => norm(u.full_name) === bare || norm(u.full_name).includes(bare));
  return hit || null;
}

// ---------- เมนู 5: จองห้องประชุม ----------
router.get('/rooms', async (req, res) => {
  res.json({ rooms: await db.prepare('SELECT * FROM rooms ORDER BY id').all() });
});

router.post('/rooms', auth.requireAdmin, async (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อห้องประชุม' });
  const info = await db.prepare('INSERT INTO rooms (name, capacity, location, equipment, status, notes) VALUES (?,?,?,?,?,?)')
    .run(String(b.name).trim(), Number(b.capacity) || 0, (b.location || '').trim(),
      (b.equipment || '').trim(), b.status || 'available', (b.notes || '').trim());
  res.json({ ok: true, id: info.lastInsertRowid, message: 'เพิ่มห้องประชุมเรียบร้อย' });
});

router.put('/rooms/:id', auth.requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!await db.prepare('SELECT id FROM rooms WHERE id = ?').get(id)) return res.status(404).json({ error: 'ไม่พบห้องประชุม' });
  const b = req.body || {};
  await db.prepare('UPDATE rooms SET name=?, capacity=?, location=?, equipment=?, status=?, notes=? WHERE id=?')
    .run(String(b.name || '').trim(), Number(b.capacity) || 0, (b.location || '').trim(),
      (b.equipment || '').trim(), b.status || 'available', (b.notes || '').trim(), id);
  res.json({ ok: true, message: 'แก้ไขห้องประชุมเรียบร้อย' });
});

router.delete('/rooms/:id', auth.requireAdmin, async (req, res) => {
  // ลบการจองทั้งหมดที่ผูกกับห้องนี้ (ไม่ทิ้งค่าค้างใน DB)
  await cleanup.purgeRoomBookings(Number(req.params.id));
  await db.prepare('DELETE FROM rooms WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true, message: 'ลบห้องประชุมเรียบร้อย' });
});

// ---------- การมอบหมายผู้อนุมัติห้องประชุม (admin ตั้งค่า) ----------
router.get('/room/approvers', auth.requireAdmin, async (req, res) => {
  const approvers = await approvals.getSystemApprovers('room');
  const staff = await db.prepare(`SELECT id, title, full_name, first_name, last_name, position, workplace, role FROM users
    WHERE status = 'active' ORDER BY full_name`).all();
  res.json({ approvers, staff });
});

router.put('/room/approvers', auth.requireAdmin, async (req, res) => {
  const b = req.body || {};
  const toIds = (v) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []);
  let level1 = toIds(b.level1), level2 = toIds(b.level2);
  const all = [...new Set([...level1, ...level2])];
  if (all.length) {
    const rows = await db.prepare(`SELECT id FROM users WHERE id IN (${all.map(() => '?').join(',')}) AND status = 'active'`).all(...all);
    const valid = new Set(rows.map((r) => r.id));
    level1 = level1.filter((n) => valid.has(n));
    level2 = level2.filter((n) => valid.has(n));
  }
  const approvers = { 1: level1, 2: level2 };
  // ห้องประชุม + ยานพาหนะใช้รายการผู้อนุมัติชุดเดียวกัน
  await db.prepare("UPDATE settings SET value = ? WHERE `key` = 'approvers_booking'").run(JSON.stringify(approvers));
  res.json({ ok: true, message: 'บันทึกผู้อนุมัติการจอง (ห้องประชุม + ยานพาหนะ) เรียบร้อย' });
});

// ขั้นที่ผู้ใช้ปัจจุบันได้รับมอบหมายให้อนุมัติห้องประชุม
router.get('/room/approvers/me', auth.requireAuth, async (req, res) => {
  const levels = await approvals.getUserSystemLevels(req.user, 'room');
  res.json({ levels, can_approve: levels.length > 0 });
});

router.get('/room-bookings', auth.requireAuth, async (req, res) => {
  // ทุก user เห็นการจองทุกรายการ (แก้ไข/ยกเลิกได้เฉพาะของตัวเองเท่านั้น — ตรวจใน DELETE)
  const { status, room_id, year } = req.query;
  let sql = `SELECT r.*, u.title, u.full_name, u.first_name, u.last_name, u.username, rm.name AS room_name, rm.capacity AS room_capacity
             FROM room_bookings r JOIN users u ON u.id = r.user_id
             JOIN rooms rm ON rm.id = r.room_id WHERE 1=1`;
  const args = [];
  if (status) { sql += ' AND r.status = ?'; args.push(status); }
  if (room_id) { sql += ' AND r.room_id = ?'; args.push(Number(room_id)); }
  sql = applyYearFilter(sql, args, 'r.date', year);
  sql += ' ORDER BY r.created_at DESC, r.id DESC';
  const rows = await db.prepare(sql).all(...args);
  const required = await approvals.getRequiredLevels('room');
  res.json({ bookings: rows.map((r) => ({ ...r, required_levels: required, approvals: approvals.parseApprovals(r.approval_data) })) });
});

// ตรวจสอบว่าช่วงเวลาที่เลือกซ้อนทับกับการจองที่มีอยู่หรือไม่ (ชื่อคนจอง + หัวข้อ)
router.get('/room-bookings/conflicts', auth.requireAuth, async (req, res) => {
  const { room_id, date, start_time, end_time } = req.query;
  if (!room_id || !date) return res.json({ conflicts: [] });
  const rows = await db.prepare(`SELECT r.id, r.start_time, r.end_time, r.topic, r.status, u.full_name
    FROM room_bookings r JOIN users u ON u.id = r.user_id
    WHERE r.room_id = ? AND r.date = ? AND r.status IN ('pending','approved')`).all(Number(room_id), date);
  const s = (start_time || '').slice(0, 5), e = (end_time || '').slice(0, 5);
  const conflicts = s && e ? rows.filter((r) => timeOverlap(s, e, r.start_time, r.end_time)) : [];
  res.json({ conflicts });
});

router.post('/room-bookings', auth.requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.room_id || !b.date) return res.status(400).json({ error: 'กรุณาเลือกห้องประชุมและวันที่' });
  if (!b.topic || !String(b.topic).trim()) return res.status(400).json({ error: 'กรุณากรอกหัวข้อการประชุม' });
  const start = (b.start_time || '').slice(0, 5), end = (b.end_time || '').slice(0, 5);
  if (start && end) {
    const clash = await db.prepare(`SELECT r.id, r.start_time, r.end_time, r.topic, u.full_name
      FROM room_bookings r JOIN users u ON u.id = r.user_id
      WHERE r.room_id = ? AND r.date = ? AND r.status IN ('pending','approved')`).all(Number(b.room_id), b.date);
    const hit = clash.find((c) => timeOverlap(start, end, c.start_time, c.end_time));
    if (hit) {
      return res.status(409).json({ error: `ห้องประชุมนี้ถูกจองไว้แล้วในช่วงเวลานี้ (${hit.full_name} • ${hit.topic})` });
    }
  }
  const bookingNo = await nextDocNo('room_bookings', 'booking_no');
  const info = await db.prepare(`INSERT INTO room_bookings (booking_no, room_id, user_id, date, start_time, end_time, topic, attendees)
    VALUES (?,?,?,?,?,?,?,?)`).run(bookingNo, Number(b.room_id), req.user.id, b.date,
    start, end, String(b.topic).trim(), Number(b.attendees) || 0);
  // แจ้งเตือน Telegram ไปยังผู้อนุมัติขั้นต้นว่ามีคำขอจองใหม่
  await telegram.notifyRoomSubmitted(Number(info.lastInsertRowid));
  res.json({ ok: true, id: info.lastInsertRowid, message: 'ส่งคำขอจองห้องประชุมเรียบร้อย รอผู้ดูแลระบบอนุมัติ' });
});

router.put('/room-bookings/:id/approve', auth.requireAuth, async (req, res) => {
  const { note } = req.body || {};
  const result = await approvals.approveRequest({
    table: 'room_bookings', system: 'room', id: Number(req.params.id), user: req.user, note,
    canApproveFn: (u, level) => approvals.canApproveSystem(u, 'room', level),
    levelLabelFn: (level) => (level <= 1 ? 'ขั้นต้น' : 'ขั้นสุดท้าย'),
    onFinal: async (row) => {
      const clash = await db.prepare(`SELECT * FROM room_bookings
        WHERE room_id = ? AND date = ? AND status = 'approved' AND id != ?`).all(row.room_id, row.date, row.id);
      for (const c of clash) {
        if (timeOverlap(row.start_time, row.end_time, c.start_time, c.end_time)) {
          return { error: `ช่วงเวลาซ้อนทับกับการจองที่อนุมัติแล้ว (${c.topic})`, code: 409 };
        }
      }
      return null;
    },
  });
  if (result.error) return res.status(result.code || 400).json({ error: result.error });
  if (result.approved) {
    // อนุมัติครบขั้นแล้ว → แจ้งเตือน Telegram (ข้อความสีเขียว 🟢) ไปยังผู้จอง
    await telegram.notifyRequest({ system: 'room', id: Number(req.params.id), approved: true, deciderName: req.user.full_name, note });
  } else {
    // อนุมัติขั้นต้นแล้ว (ยังไม่ครบทุกขั้น) → แจ้งเตือนผู้อนุมัติขั้นถัดไปว่าขั้นต้นอนุมัติแล้ว
    await telegram.notifyRoomNextLevel(Number(req.params.id), req.user.full_name);
  }
  res.json(result);
});

router.put('/room-bookings/:id/reject', auth.requireAuth, async (req, res) => {
  const { note } = req.body || {};
  const result = await approvals.rejectRequest({
    table: 'room_bookings', id: Number(req.params.id), user: req.user, note,
    allowFn: (u) => approvals.getUserSystemLevels(u, 'room').length > 0,
  });
  if (result.error) return res.status(result.code || 400).json({ error: result.error });
  // ไม่อนุมัติ → แจ้งเตือนทันที (ข้อความสีแดง 🔴) ไปยังผู้จอง
  await telegram.notifyRequest({ system: 'room', id: Number(req.params.id), approved: false, deciderName: req.user.full_name, note });
  res.json(result);
});

router.delete('/room-bookings/:id', auth.requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare('SELECT id, user_id FROM room_bookings WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบรายการจอง' });
  if (row.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'ไม่มีสิทธิ์ลบรายการนี้' });
  }
  await db.prepare('DELETE FROM room_bookings WHERE id = ?').run(id);
  res.json({ ok: true, message: 'ลบรายการจองเรียบร้อย' });
});

// ห่อ router เพื่อจับ error จาก async handler (Express 4 ไม่ catch promise เอง)
const { wrapRouter } = require('../lib/async-route');
module.exports = wrapRouter(router);
