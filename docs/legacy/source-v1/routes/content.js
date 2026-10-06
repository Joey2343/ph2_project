'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../lib/auth');
const { createDynamicUpload, uploadErrorHandler, deleteUploadedFile } = require('../lib/uploads');
const cleanup = require('../lib/cleanup');

// อัปโหลดแบบแยกโฟลเดอร์ตามรหัสหน่วยงาน (school_code) — ไฟล์รูปภาพความเสียหายจากภัยธรรมชาติ
const uploadSchoolsDyn = createDynamicUpload('schools', { imageOnly: true });

const router = express.Router();

// คำนำหน้าพาธไฟล์ตามรหัสหน่วยงาน (school_code) — ต้องตรงกับ path ที่บันทึกใน DB
function getSchoolPrefix(req) {
  if (req.user && req.user.school_code) {
    return req.user.school_code + '/';
  }
  return '';
}

// ---------- เมนู 1: ข้อมูลพื้นฐาน สพป.แพร่ เขต 2 ----------
router.get('/office', (req, res) => {
  const sections = db.prepare('SELECT id, key, title, content, sort FROM office_sections ORDER BY sort, id').all();
  res.json({ sections });
});

router.put('/office', auth.requireAdmin, (req, res) => {
  const { sections } = req.body || {};
  if (!Array.isArray(sections) || sections.length === 0) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  }
  const upsert = db.prepare(`INSERT INTO office_sections (key, title, content, sort)
    VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET title = excluded.title, content = excluded.content, sort = excluded.sort`);
  const tx = db.transaction((list) => {
    for (const s of list) {
      if (!s.title) continue;
      upsert.run(s.key || null, String(s.title).trim(), String(s.content ?? ''), Number(s.sort) || 0);
    }
  });
  tx(sections);
  const fresh = db.prepare('SELECT id, key, title, content, sort FROM office_sections ORDER BY sort, id').all();
  res.json({ ok: true, sections: fresh, message: 'บันทึกข้อมูลพื้นฐานเรียบร้อย' });
});

// ---------- เมนู 2: พิกัดโรงเรียนในสังกัด ----------
router.get('/schools', (req, res) => {
  const rows = db.prepare('SELECT * FROM schools ORDER BY district, name').all();
  res.json({ schools: rows });
});

router.post('/schools', auth.requireAdmin, uploadSchoolsDyn.single('disaster_image'), uploadErrorHandler, (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อโรงเรียน' });
  const disasterImage = req.file ? getSchoolPrefix(req) + 'schools/' + req.file.filename : null;
  const info = db.prepare(`INSERT INTO schools (code, name, group_name, district, address, principal, phone, level, lat, lng, image, notes, disaster, disaster_image)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    (b.code || '').trim(), String(b.name).trim(), (b.group_name || '').trim(), (b.district || '').trim(), (b.address || '').trim(),
    (b.principal || '').trim(), (b.phone || '').trim(), (b.level || '').trim(),
    b.lat == null ? null : Number(b.lat), b.lng == null ? null : Number(b.lng),
    (b.image || '').trim(), (b.notes || '').trim(),
    (b.disaster || '').trim(), disasterImage);
  res.json({ ok: true, id: info.lastInsertRowid, message: 'เพิ่มโรงเรียนเรียบร้อย' });
});

router.put('/schools/:id', auth.requireAdmin, uploadSchoolsDyn.single('disaster_image'), uploadErrorHandler, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id, disaster_image FROM schools WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'ไม่พบโรงเรียน' });
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อโรงเรียน' });
  // รูปภาพความเสียหาย: ถ้าแนบไฟล์ใหม่ ลบไฟล์เดิมแล้วใช้ไฟล์ใหม่; ถ้าไม่แนบ คงค่าเดิม (หรือล้างถ้าส่ง disaster_image_clear=1)
  let disasterImage = existing.disaster_image || null;
  if (req.file) {
    if (disasterImage) deleteUploadedFile(disasterImage);
    disasterImage = getSchoolPrefix(req) + 'schools/' + req.file.filename;
  } else if (b.disaster_image_clear === '1') {
    if (disasterImage) deleteUploadedFile(disasterImage);
    disasterImage = null;
  }
  db.prepare(`UPDATE schools SET code=?, name=?, group_name=?, district=?, address=?, principal=?, phone=?, level=?, lat=?, lng=?, image=?, notes=?, disaster=?, disaster_image=? WHERE id=?`)
    .run((b.code || '').trim(), String(b.name).trim(), (b.group_name || '').trim(), (b.district || '').trim(), (b.address || '').trim(),
      (b.principal || '').trim(), (b.phone || '').trim(), (b.level || '').trim(), b.lat == null ? null : Number(b.lat), b.lng == null ? null : Number(b.lng), (b.image || '').trim(), (b.notes || '').trim(),
      (b.disaster || '').trim(), disasterImage, id);
  res.json({ ok: true, message: 'แก้ไขโรงเรียนเรียบร้อย' });
});

router.delete('/schools/:id', auth.requireAdmin, (req, res) => {
  const row = db.prepare('SELECT disaster_image FROM schools WHERE id = ?').get(Number(req.params.id));
  if (row && row.disaster_image) deleteUploadedFile(row.disaster_image);
  // ลบบันทึกภัยธรรมชาติ + ลบรหัสโรงเรียนออกจากผู้ใช้ที่สังกัดโรงเรียนนี้ (ไม่ทิ้งค่าค้างใน DB)
  const code = db.prepare('SELECT code FROM schools WHERE id = ?').get(Number(req.params.id));
  if (code && code.code) {
    db.prepare('DELETE FROM disasters WHERE user_id IN (SELECT id FROM users WHERE school_code = ?)').run(code.code);
    db.prepare("UPDATE users SET school_code = '', current_school = '' WHERE school_code = ?").run(code.code);
  }
  db.prepare('DELETE FROM schools WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true, message: 'ลบโรงเรียนเรียบร้อย' });
});

module.exports = router;
