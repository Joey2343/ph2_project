/**
 * ทดสอบการยื่นลาและสายอนุมัติการลาตั้งแต่ต้นจนจบ
 *
 * ทำไมต้องมี
 * ──────────
 * ผู้ใช้รายงานว่ากด "ส่งคำขอ" แล้วได้
 *   "เกิดข้อผิดพลาดในระบบ [POST /api/leaves · HTTP 500]"
 *
 * สาเหตุจริง 2 จุด ทั้งคู่เป็น "async หลุดเข้าไปในคำสั่ง SQL" (มีมาตั้งแต่ commit แรก)
 *
 * ① nextLeaveNo() เป็น async แต่ไม่มี await
 *      .run(nextLeaveNo(...), ...)   → ส่ง Promise แทนคอลัมน์ leave_no
 *      → mysql2 โยน TypeError → API ตอบ 500
 *      → ยื่นลาไม่ได้เลย แม้แต่ครั้งเดียว ไม่ว่าจะกรอกอะไร
 *
 * ② requesterApproverKey() เป็น async แต่ไม่มี await (4 จุด)
 *      .get(requesterApproverKey(id))  → ส่ง Promise แทนคีย์ใน settings
 *      → ค้นไม่เจอค่าที่ตั้งไว้เสมอ → ตรวจสิทธิ์ไม่ผ่าน
 *      → ผู้ตรวจสอบ/ผู้อนุมัติที่ได้รับแต่งตั้ง (ไม่ใช่ admin) โดน 403 ทุกคน
 *      → สายอนุมัติการลาใช้ไม่ได้เลย เหลือแต่ admin ที่กดได้
 *
 * ตัวตรวจ scripts/check-await-in-sql.js กันการหลุดของชนิดนี้ทั่ว backend
 * ไฟล์นี้ทดสอบผลลัพธ์จริงว่าฟีเจอร์ใช้ได้
 *
 * ใช้: node scripts/test-leave-flow.js
 *   (ต้องเปิด backend ไว้ที่ TEST_BASE_URL หรือ http://127.0.0.1:3000)
 */
const http = require('http');
const path = require('path');
const fs = require('fs');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const url = new URL(BASE);

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
}

function req(method, p, body, cookie, isForm) {
  return new Promise((resolve) => {
    const headers = {};
    let payload = null;
    if (body) {
      if (isForm) { headers['Content-Type'] = body.boundary; payload = body.buffer; }
      else { headers['Content-Type'] = 'application/json'; payload = Buffer.from(JSON.stringify(body), 'utf8'); }
      headers['Content-Length'] = payload.length;
    }
    if (cookie) headers.Cookie = cookie;
    const r = http.request({ host: url.hostname, port: url.port || 80, path: p, method, headers, timeout: 30000 }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(b); } catch (e) { /* ไม่ใช่ JSON */ }
        resolve({ status: res.statusCode, j, raw: b, cookie: (res.headers['set-cookie'] || [])[0] || '' });
      });
    });
    r.on('error', (e) => resolve({ status: 0, j: null, raw: e.message }));
    if (payload) r.write(payload);
    r.end();
  });
}

const login = async (u, p) => {
  const r = await req('POST', '/api/auth/login', { username: u, password: p });
  // ⚠️ ต้องกัน r.cookie ไม่มีค่า
  //    ตอนที่ไม่มีเซิร์ฟเวอร์ ฟังก์ชัน req คืน { status: 0 } โดยไม่มี set-cookie
  //    ถ้าเรียก .match ตรง ๆ จะ throw → เทสต์นับเป็น "ไม่ผ่าน"
  //    แต่ CI ไม่มีเซิร์ฟเวอร์ ต้องข้ามแล้ว exit 0 เสมอ
  return ((r.cookie || '').match(/sid=[^;]+/) || [])[0] || '';
};

/** สร้าง multipart body สำหรับ POST /leaves */
function leaveForm(fields) {
  const B = '----ph2' + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, 'utf8'));
  }
  parts.push(Buffer.from(`--${B}--\r\n`, 'utf8'));
  return { boundary: 'multipart/form-data; boundary=' + B, buffer: Buffer.concat(parts) };
}

(async () => {
  const db = require(path.join(__dirname, '..', 'db.js'));
  await db.init();
  await db.bootstrap();

  const admin = await login('admin', 'Joey2343**');
  if (!admin) {
    console.log('  – ข้าม: ล็อกอิน admin ไม่ได้ (backend ไม่ได้รันอยู่?)');
    process.exit(0);
  }
  const adminId = (await db.prepare("SELECT id FROM users WHERE username = 'admin'").get()).id;

  /* ── ① ยื่นลาได้จริง ─────────────────────────────────────────────────── */
  console.log('');
  console.log('① ยื่นลา');

  const before = await db.prepare('SELECT COUNT(*) c FROM leave_requests').get();
  const f = leaveForm({
    leave_type: 'ลาป่วย', date_from: '2026-11-02', date_to: '2026-11-02',
    days: 1, writing_at: '', address: '', phone: '',
  });
  const r1 = await req('POST', '/api/leaves', f, admin, true);
  check(r1.status === 200, 'POST /api/leaves ตอบ 200', `ได้ HTTP ${r1.status} · ${r1.raw.slice(0, 120)}`);
  check(r1.j && r1.j.ok === true, 'ตอบ ok: true');

  const after = await db.prepare('SELECT COUNT(*) c FROM leave_requests').get();
  check(after.c === before.c + 1, 'บันทึกลงตารางจริง 1 แถว', `ก่อน ${before.c} หลัง ${after.c}`);

  const row = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(r1.j && r1.j.id);
  check(row && /^\d+\/\d{4}$/.test(String(row.leave_no)),
    'leave_no เป็นเลขที่จริง ไม่ใช่ Promise',
    'ได้ ' + JSON.stringify(row && row.leave_no));
  check(String(row.leave_no).indexOf('Promise') === -1,
    'ไม่มีคำว่า Promise ปนในข้อมูล',
    'เคยเป็น "[object Promise]" → ยื่นลาไม่ได้เลย');

  /* ── ② สายอนุมัติ: ผู้ได้รับแต่งตั้งต้องตรวจสอบได้ ─────────────────────── */
  console.log('');
  console.log('② สายอนุมัติ — ผู้ที่ได้รับแต่งตั้ง (ไม่ใช่ admin) ต้องตรวจสอบได้');

  // หาเจ้าหน้าที่ฝั่งสพป. ที่มีสิทธิ์อนุมัติ 1 คน
  const approver = await db.prepare("SELECT id, username FROM users WHERE status='active' AND user_group<>'school' AND can_approve=1 AND id != ? ORDER BY id LIMIT 1").get(adminId);
  if (!approver) {
    console.log('  – ข้าม: ไม่มีเจ้าหน้าที่ที่มีสิทธิ์อนุมัติในฐาน');
  } else {
    const kRow = await db.prepare("SELECT value FROM settings WHERE `key` = 'leave_approvers'").get();
    const kSaved = kRow ? kRow.value : null;
    // ตั้ง: ผู้ขอ admin → ผู้ตรวจสอบ = approver
    await db.prepare("INSERT INTO settings (`key`, value) VALUES ('leave_approvers', ?) ON DUPLICATE KEY UPDATE value = ?")
      .run(JSON.stringify({ 1: { [adminId]: approver.id } }), JSON.stringify({ 1: { [adminId]: approver.id } }));

    const apCookie = await login(approver.username, 'Test1234**');
    if (!apCookie) {
      console.log(`  – ข้าม: ล็อกอิน ${approver.username} ไม่ได้ (รหัสผ่านไม่ใช่ Test1234**)`);
    } else {
      const rev = await req('PUT', `/api/leaves/${r1.j.id}/review`, {}, apCookie);
      check(rev.status === 200,
        'ผู้ที่ได้รับแต่งตั้งตรวจสอบคำขอได้ (200)',
        `ได้ HTTP ${rev.status} · ${rev.raw.slice(0, 130)}`
        + '\n        ถ้าได้ 403 = requesterApproverKey ยังไม่มี await');

      const reviewed = await db.prepare('SELECT reviewed, approval_level FROM leave_requests WHERE id = ?').get(r1.j.id);
      check(reviewed && reviewed.reviewed === 1, 'บันทึกสถานะ "ตรวจสอบแล้ว" จริง');
      check(reviewed && reviewed.approval_level === 1, 'เลื่อนไปรอผู้อนุมัติขั้นต้น');

      // คนที่ไม่ได้รับแต่งตั้งต้องโดน 403
      const other = await db.prepare("SELECT username FROM users WHERE status='active' AND user_group<>'school' AND id NOT IN (?,?) ORDER BY id LIMIT 1").get(adminId, approver.id);
      if (other) {
        const oc = await login(other.username, 'Test1234**');
        if (oc) {
          const rej = await req('PUT', `/api/leaves/${r1.j.id}/approve`, { note: 'ทดสอบ' }, oc);
          check(rej.status === 403, 'คนที่ไม่ได้รับแต่งตั้งโดน 403 ตามที่ควร', `ได้ HTTP ${rej.status}`);
        }
      }
    }

    // คืนค่าตั้งเดิม
    if (kSaved === null) await db.prepare("DELETE FROM settings WHERE `key` = 'leave_approvers'").run();
    else await db.prepare("UPDATE settings SET value = ? WHERE `key` = 'leave_approvers'").run(kSaved);
  }

  /* ── ③ ยื่นคำขอไปราชการ (พังแบบเดียวกัน) ─────────────────────────────── */
  console.log('');
  console.log('③ ยื่นคำขอไปราชการ (nextDocNo พังแบบเดียวกันกับ nextLeaveNo)');

  const tv = await db.prepare('SELECT COUNT(*) c FROM travel_requests').get();
  const tf = leaveForm({
    travel_subject: 'ทดสอบระบบ', destination: 'กรุงเทพฯ',
    date_from: '2026-11-10', date_to: '2026-11-11', days: 2, budget: '0',
    form_data: '{}',
  });
  const tr = await req('POST', '/api/travel', tf, admin, true);
  check(tr.status === 200, 'POST /api/travel ตอบ 200', `ได้ HTTP ${tr.status} · ${tr.raw.slice(0, 120)}`);
  if (tr.status === 200) {
    const tRow = await db.prepare('SELECT travel_no FROM travel_requests WHERE id = ?').get(tr.j.id);
    check(tRow && /^\S+\/\d{4}$/.test(String(tRow.travel_no)),
      'travel_no เป็นเลขที่จริง', 'ได้ ' + JSON.stringify(tRow && tRow.travel_no));
  }

  /* ── เก็บกวาดเฉพาะแถวที่ตัวเองสร้าง ────────────────────────────────────── */
  if (r1.j && r1.j.id) await db.prepare('DELETE FROM leave_requests WHERE id = ?').run(r1.j.id);
  if (tr.j && tr.j.id) await db.prepare('DELETE FROM travel_requests WHERE id = ?').run(tr.j.id);
  await db.close();

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ทดสอบล้มเหลว:', e);
  process.exit(1);
});