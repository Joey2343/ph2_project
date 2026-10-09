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
// เรียงตามรหัสโรงเรียนจากน้อยไปมาก
// เรียง LENGTH ก่อนเพราะ code เป็น mediumtext (เรียงแบบข้อความ)
// ถ้าไม่เรียงความยาวก่อน รหัส 10 หลักจะไปอยู่หน้ารหัส 8 หลักทั้งหมด
router.get('/schools', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM schools ORDER BY LENGTH(code), code').all();
  res.json({ schools: rows });
});

router.post('/schools', auth.requireAdmin, uploadSchoolsDyn.single('disaster_image'), uploadErrorHandler, async (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อโรงเรียน' });
  const disasterImage = req.file ? getSchoolPrefix(req) + 'schools/' + req.file.filename : null;
  const info = await db.prepare(`INSERT INTO schools (code, name, group_name, district, address, principal, phone, level, lat, lng, image, notes, disaster, disaster_image)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
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
  // รูปภาพความเสียหาย: ถ้าแนบไฟล์ใหม่ ลบไฟล์เดิมแล้วใช้ไฟล์ใหม่; ถ้าไม่แนบ คงค่าเดิม (หรือล้างถ้าส่ง disaster_image_clear=1)
  let disasterImage = existing.disaster_image || null;
  if (req.file) {
    if (disasterImage) deleteUploadedFile(disasterImage);
    disasterImage = getSchoolPrefix(req) + 'schools/' + req.file.filename;
  } else if (b.disaster_image_clear === '1') {
    if (disasterImage) deleteUploadedFile(disasterImage);
    disasterImage = null;
  }
  await db.prepare(`UPDATE schools SET code=?, name=?, group_name=?, district=?, address=?, principal=?, phone=?, level=?, lat=?, lng=?, image=?, notes=?, disaster=?, disaster_image=? WHERE id=?`)
    .run((b.code || '').trim(), String(b.name).trim(), (b.group_name || '').trim(), (b.district || '').trim(), (b.address || '').trim(),
      (b.principal || '').trim(), (b.phone || '').trim(), (b.level || '').trim(), b.lat == null ? null : Number(b.lat), b.lng == null ? null : Number(b.lng), (b.image || '').trim(), (b.notes || '').trim(),
      (b.disaster || '').trim(), disasterImage, id);
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
