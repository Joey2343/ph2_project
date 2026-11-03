'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../lib/auth');
const { createDynamicUpload, uploadErrorHandler, deleteUploadedFile } = require('../lib/uploads');
const cleanup = require('../lib/cleanup');
const { schoolCodeOf } = require('../lib/school-code');

// อัปโหลดแบบแยกโฟลเดอร์ตามรหัสหน่วยงาน (school_code) — ไฟล์รูปภาพความเสียหายจากภัยธรรมชาติ
const uploadSchoolsDyn = createDynamicUpload('schools', { imageOnly: true });

const router = express.Router();

// คำนำหน้าพาธไฟล์ตามรหัสหน่วยงาน (school_code) — ต้องตรงกับ path ที่บันทึกใน DB
// ⚠️ ใช้ schoolCodeOf() เพราะบัญชีสถานศึกษาที่ school_code ว่าง (บั๊กเดิม) จะได้ path ไม่มีรหัสโรงเรียน
function getSchoolPrefix(req) {
  const code = schoolCodeOf(req.user);
  if (code) return code + '/';
  return '';
}

// ---------- เมนู 1: ข้อมูลพื้นฐาน สพป.แพร่ เขต 2 ----------
router.get('/office', async (req, res) => {
  const sections = await db.prepare('SELECT id, `key`, title, content, sort FROM office_sections ORDER BY sort, id').all();
  res.json({ sections });
});

router.put('/office', auth.requireAdmin, async (req, res) => {
  const { sections } = req.body || {};
  if (!Array.isArray(sections) || sections.length === 0) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  }
  await db.transaction(async (tx) => {
    const upsert = tx.prepare(
      'INSERT INTO office_sections (`key`, title, content, sort)' +
        ' VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE' +
        ' title = VALUES(title), content = VALUES(content), sort = VALUES(sort)'
    );
    for (const s of sections) {
      if (!s.title) continue;
      await upsert.run(s.key || null, String(s.title).trim(), String(s.content ?? ''), Number(s.sort) || 0);
    }
  })();
  const fresh = await db.prepare('SELECT id, `key`, title, content, sort FROM office_sections ORDER BY sort, id').all();
  res.json({ ok: true, sections: fresh, message: 'บันทึกข้อมูลพื้นฐานเรียบร้อย' });
});

// ---------- เมนู 2: พิกัดโรงเรียนในสังกัด ----------
/*
 * พิกัด "สพป.แพร่ เขต 2" (สำนักงานเขตพื้นที่) — แสดงเป็นหมุดแยกต่างหาก
 *
 * ⚠️ ห้ามเก็บในตาราง schools — จำนวน "โรงเรียนในสังกัด 103 แห่ง" ต้องไม่เปลี่ยน
 *    หน้าพิกัดโรงเรียนจึงรับมาทางฟิลด์ office ใน response นี้ แล้ววาดหมุดเอง
 *
 * พิกัดใช้ค่าเดียวกับที่ตั้งไว้ในหน้าลงเวลาทำงาน (settings.clock_sites คีย์ 'office')
 * เพื่อไม่ต้องกรอกซ้ำ 2 ที่ — ถ้ายังไม่ตั้ง ใช้ค่าเดิม clock_lat/clock_lng
 * แล้วจึงใช้ค่าคงที่ของสำนักงาน (อ.ลอง)
 */
const OFFICE_LOCATION_FALLBACK = { lat: 18.08346, lng: 99.84805 };

function numOrNull(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function getOfficeLocation() {
  const rows = await db
    .prepare('SELECT `key`, value FROM settings WHERE `key` IN (?,?,?,?)')
    .all('office_location', 'clock_sites', 'clock_lat', 'clock_lng');
  const kv = {};
  for (const r of rows) kv[r.key] = r.value;

  // ข้อมูลที่ admin แก้ไว้ในหน้าแผนที่ (settings.office_location) — มาก่อนเสมอ
  let saved = {};
  try {
    saved = JSON.parse(kv.office_location || '{}') || {};
  } catch (e) {
    saved = {};
  }

  let lat = null;
  let lng = null;
  try {
    const arr = JSON.parse(kv.clock_sites || '[]');
    const site = (Array.isArray(arr) ? arr : []).find((s) => s && String(s.key) === 'office');
    if (site) {
      lat = numOrNull(site.lat);
      lng = numOrNull(site.lng);
    }
  } catch (e) {
    /* ค่าเสียหาย → ใช้ค่าถัดไป */
  }
  if (lat === null || lng === null) {
    lat = numOrNull(kv.clock_lat);
    lng = numOrNull(kv.clock_lng);
  }
  if (lat === null || lng === null) {
    lat = OFFICE_LOCATION_FALLBACK.lat;
    lng = OFFICE_LOCATION_FALLBACK.lng;
  }

  // ค่าที่บันทึกไว้ทับค่าที่ดึงมา (ถ้ามี)
  const savedLat = numOrNull(saved.lat);
  const savedLng = numOrNull(saved.lng);
  if (savedLat !== null && savedLng !== null) {
    lat = savedLat;
    lng = savedLng;
  }

  return {
    name: String(saved.name || '').trim() || 'สพป.แพร่ เขต 2',
    district: String(saved.district || '').trim() || 'ลอง',
    address: String(saved.address || '').trim() || 'อ.ลอง จ.แพร่',
    phone: String(saved.phone || '').trim(),
    email: String(saved.email || '').trim(),
    website: String(saved.website || '').trim(),
    facebook: String(saved.facebook || '').trim(),
    lat,
    lng,
  };
}

/**
 * แก้ไขข้อมูลเบื้องต้นของ "สพป.แพร่ เขต 2" (เฉพาะ admin)
 *
 * เก็บใน settings คีย์ `office_location` — ไม่เขียนลงตาราง schools
 * เพื่อให้จำนวน "โรงเรียนในสังกัด" ยังเป็น 103 แห่งเท่าเดิม
 *
 * ⚠️ พิกัดที่บันทึกจากหน้านี้ใช้กับ "หมุดบนแผนที่" เท่านั้น
 *    ไม่กระทบจุดลงเวลาทำงาน (clock_sites) เพราะการย้ายจุดลงเวลาจะทำให้
 *    เจ้าหน้าที่ที่อยู่ในพื้นที่เดิมลงเวลาไม่ได้ทันที
 *
 * ⚠️ ต้องประกาศก่อน PUT /schools/:id ไม่งั้น Express จะจับ "office" เป็น :id
 */
router.put('/schools/office', auth.requireAdmin, async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อ' });
  const lat = numOrNull(b.lat);
  const lng = numOrNull(b.lng);
  if (lat === null || lng === null) {
    return res.status(400).json({ error: 'กรุณากรอกละติจูดและลองจิจูดให้ครบทั้งคู่' });
  }
  if (lat < -90 || lat > 90) return res.status(400).json({ error: 'ละติจูดไม่ถูกต้อง' });
  if (lng < -180 || lng > 180) return res.status(400).json({ error: 'ลองจิจูดไม่ถูกต้อง' });

  const email = String(b.email || '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'อีเมลไม่ถูกต้อง' });
  }

  const data = {
    name,
    district: String(b.district || '').trim(),
    address: String(b.address || '').trim(),
    phone: String(b.phone || '').trim(),
    email,
    website: String(b.website || '').trim(),
    facebook: String(b.facebook || '').trim(),
    lat,
    lng,
  };
  await db
    .prepare('INSERT INTO settings (`key`, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
    .run('office_location', JSON.stringify(data));

  res.json({ ok: true, message: 'บันทึกข้อมูล สพป.แพร่ เขต 2 เรียบร้อย', office: data });
});

// เรียงตามรหัสโรงเรียนจากน้อยไปมาก
// เรียง LENGTH ก่อนเพราะ code เป็น mediumtext (เรียงแบบข้อความ)
// ถ้าไม่เรียงความยาวก่อน รหัส 10 หลักจะไปอยู่หน้ารหัส 8 หลักทั้งหมด
router.get('/schools', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM schools ORDER BY LENGTH(code), code').all();
  // office = สพป.แพร่ เขต 2 (ไม่นับรวมใน rows ของโรงเรียน)
  res.json({ schools: rows, office: await getOfficeLocation() });
});

router.post('/schools', auth.requireAdmin, uploadSchoolsDyn.single('disaster_image'), uploadErrorHandler, async (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อโรงเรียน' });
  const disasterImage = req.file ? getSchoolPrefix(req) + 'schools/' + req.file.filename : null;
  const info = await db.prepare(`INSERT INTO schools (code, name, group_name, district, address, principal, phone, level, lat, lng, image, notes, disaster, disaster_image)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    (b.code || '').trim(), String(b.name).trim(), (b.group_name || '').trim(), (b.district || '').trim(), (b.address || '').trim(),
    (b.principal || '').trim(), (b.phone || '').trim(), (b.level || '').trim(),
    b.lat == null ? null : Number(b.lat), b.lng == null ? null : Number(b.lng),
    (b.image || '').trim(), (b.notes || '').trim(),
    (b.disaster || '').trim(), disasterImage);
  res.json({ ok: true, id: info.lastInsertRowid, message: 'เพิ่มโรงเรียนเรียบร้อย' });
});

router.put('/schools/:id', auth.requireAdmin, uploadSchoolsDyn.single('disaster_image'), uploadErrorHandler, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await db.prepare('SELECT id, disaster_image FROM schools WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'ไม่พบโรงเรียน' });
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อโรงเรียน' });
  // รูปภาพความเสียหาย: ถ้าแนบไฟล์ใหม่ ใช้ไฟล์ใหม่; ถ้าไม่แนบ คงค่าเดิม (หรือล้างถ้าส่ง disaster_image_clear=1)
  // ⚠️ ลบไฟล์เดิม "หลัง" UPDATE สำเร็จเท่านั้น — เดิมลบก่อน ถ้า UPDATE ล้มเหลว
  //    ไฟล์หายแต่ฐานยังชี้ชื่อไฟล์เดิม → รูปเสียถาวร
  const oldImage = existing.disaster_image || null;
  let disasterImage = oldImage;
  if (req.file) {
    disasterImage = getSchoolPrefix(req) + 'schools/' + req.file.filename;
  } else if (b.disaster_image_clear === '1') {
    disasterImage = null;
  }
  await db.prepare(`UPDATE schools SET code=?, name=?, group_name=?, district=?, address=?, principal=?, phone=?, level=?, lat=?, lng=?, image=?, notes=?, disaster=?, disaster_image=? WHERE id=?`)
    .run((b.code || '').trim(), String(b.name).trim(), (b.group_name || '').trim(), (b.district || '').trim(), (b.address || '').trim(),
      (b.principal || '').trim(), (b.phone || '').trim(), (b.level || '').trim(), b.lat == null ? null : Number(b.lat), b.lng == null ? null : Number(b.lng), (b.image || '').trim(), (b.notes || '').trim(),
      (b.disaster || '').trim(), disasterImage, id);
  if (oldImage && oldImage !== disasterImage) deleteUploadedFile(oldImage);
  res.json({ ok: true, message: 'แก้ไขโรงเรียนเรียบร้อย' });
});

router.delete('/schools/:id', auth.requireAdmin, async (req, res) => {
  const row = await db.prepare('SELECT disaster_image FROM schools WHERE id = ?').get(Number(req.params.id));
  if (row && row.disaster_image) deleteUploadedFile(row.disaster_image);
  // ลบบันทึกภัยธรรมชาติ + ลบรหัสโรงเรียนออกจากผู้ใช้ที่สังกัดโรงเรียนนี้ (ไม่ทิ้งค่าค้างใน DB)
  const code = await db.prepare('SELECT code FROM schools WHERE id = ?').get(Number(req.params.id));
  if (code && code.code) {
    await db.prepare('DELETE FROM disasters WHERE user_id IN (SELECT id FROM users WHERE school_code = ?)').run(code.code);
    await db.prepare("UPDATE users SET school_code = '', current_school = '' WHERE school_code = ?").run(code.code);
  }
  await db.prepare('DELETE FROM schools WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true, message: 'ลบโรงเรียนเรียบร้อย' });
});

// ห่อ router เพื่อจับ error จาก async handler (Express 4 ไม่ catch promise เอง)
const { wrapRouter } = require('../lib/async-route');
module.exports = wrapRouter(router);
