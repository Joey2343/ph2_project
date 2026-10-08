'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');
const simdate = require('../lib/simdate');
const auth = require('../lib/auth');
const { uploadDocuments, uploadStaff, createDynamicUpload, getUploadSubdir, uploadErrorHandler, deleteUploadedFile, renameAsCitizen } = require('../lib/uploads');
const cleanup = require('../lib/cleanup');
const uploadDocDynamic = createDynamicUpload('documents');

const router = express.Router();
// Get school prefix for file paths
function getSchoolPrefix(req) {
  if (req.user && req.user.school_code) {
    return req.user.school_code + '/';
  }
  return '';
}


function getYearBE() { return simdate.todayISO().slice(0, 4) - 0 + 543; }
async function nextDocNo(table, idCol) {
  var sql = 'SELECT ' + idCol + ' AS no FROM ' + table + ' WHERE ' + idCol + " IS NOT NULL AND " + idCol + " != ''";
  const rows = await db.prepare(sql).all();
  let max = 0;
  for (const r of rows) {
    const val = parseInt(String(r.no).replace(/[^0-9]/g, ""), 10);
    if (!isNaN(val) && val > max) max = val;
  }
  return String(max + 1);
}

router.get('/next-doc-no', auth.requireAuth, async (req, res) => {
  const type = req.query.type || '';
  const isSchool = req.user.user_group === 'school';
  const schoolCode = req.user.school_code || '';
  if (type === 'honor') {
    res.json({ next: await nextHonorDocNo() });
  } else if (type === 'certificate') {
    res.json({ next: await nextCertificateDocNo() });
  } else if (type === 'order') {
    res.json({ next: await nextOrderDocNo() });
  } else if (type === 'honorees') {
    // รายชื่อสำหรับ autocomplete ในฟอร์มเกียรติบัตร: คำนำหน้า+ชื่อ-นามสกุล และชื่อสถานศึกษา
    var staff = await db.prepare("SELECT title, full_name, workplace FROM users WHERE status = 'active' AND full_name != ''").all();
    var persons = staff.map(function(s) {
      var full = ((s.title ? s.title + ' ' : '') + (s.full_name || '')).trim();
      return { name: full, workplace: s.workplace || '' };
    }).filter(function(p) { return p.name; });
    var schools = (await db.prepare("SELECT DISTINCT name FROM schools WHERE name IS NOT NULL AND name != '' ORDER BY name").all()).map(function(r) { return r.name; });
    res.json({ persons: persons, schools: schools });
  } else if (type === 'outgoing') {
    // นับเฉพาะปีปัจจุบัน (เลขหนังสือรันใหม่ทุกปี) — รายการต่างปีต้องไม่มีผลกับเลขถัดไป
    var yCE = simdate.todayISO().slice(0, 4);
    try { var _dm = String(req.query.date || '').match(/^(\d{4})-/); if (_dm) yCE = _dm[1]; } catch (e) {}
    var sql = "SELECT doc_no FROM documents WHERE doc_type = 'outgoing' AND sender_type = 'registered' AND doc_no IS NOT NULL AND doc_no != '' AND SUBSTRING(date,1,4) = ?";
    if (isSchool && schoolCode) {
      // นับจาก school_code ของหนังสือโดยตรง (ไม่นับหนังสือของโรงเรียนอื่นที่ user เคยสร้างไว้)
      sql += " AND school_code = '" + schoolCode + "'";
    }
    var rows = await db.prepare(sql).all(yCE);
    var max = 0;
    for (var r of rows) {
      var no = String(r.doc_no);
      if (isSchool) {
        // โรงเรียน: เลขชุดของโรงเรียนตัวเอง (หลัง / สุดท้าย)
        var m = no.split('/').pop().match(/[0-9]+/);
        if (m) { var v = parseInt(m[0], 10); if (v > max) max = v; }
      } else {
        // สำนักงาน: นับเฉพาะชุดรวม "ที่ ศธ 04110/[ว]เลข" — ไม่นับชุดย่อยของกลุ่มปฏิบัติ (เช่น ที่ ศธ 04110.111/1)
        var m2 = no.match(/^ที่\s*ศธ\s*04110\/(ว?)([0-9]+)$/);
        if (m2) { var v2 = parseInt(m2[2], 10); if (v2 > max) max = v2; }
      }
    }
    res.json({ next: String(max + 1) });
  } else {
    // For incoming_reg - also per-school (นับเฉพาะรายการที่ยังอยู่ในทะเบียน is_registered=1 — ไม่นับ reg_no ค้างของหนังสือที่นำออกจากทะเบียนแล้ว)
    var sql2 = "SELECT reg_no FROM documents WHERE doc_type = 'incoming' AND is_registered = 1";
    if (isSchool && schoolCode) {
      sql2 += " AND school_code = '" + schoolCode + "'";
    }
    var rows2 = await db.prepare(sql2).all();
    var max2 = 0;
    for (var r2 of rows2) {
      var m2 = String(r2.reg_no || '').match(/[0-9]+/);
      if (m2) { var v2 = parseInt(m2[0], 10); if (v2 > max2) max2 = v2; }
    }
    res.json({ next: String(max2 + 1) });
  }
});

// หมายเหตุ: คอลัมน์ของ documents / document_recipients ทั้งหมดถูกย้ายไปประกาศ
// ใน COLUMN_MIGRATIONS ของ db.js แล้ว เพราะเดิมประกาศด้วย ALTER TABLE ระดับ module
// ซึ่งทำงานไม่ได้เมื่อระบบเป็น async และไม่ portable ข้าม dialect

// ---------- เมนู 9: หนังสือราชการ (ทะเบียนหนังสือ) ----------
router.post('/cert-status/:id', auth.requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!row || row.doc_type !== 'certificate') return res.status(404).json({ error: 'not found' });
  if (req.user.role !== 'admin' && !await isCertStaffUser(req.user.id)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เปลี่ยนสถานะ' });
  await db.prepare('UPDATE documents SET cert_status = ? WHERE id = ?').run('เสร็จแล้ว', req.params.id);
  res.json({ ok: true });
});

async function isCertStaffUser(userId) {
  return !!await db.prepare("SELECT id FROM document_staff WHERE staff_type = 'certificate' AND user_id = ?").get(userId);
}

// ---------- เจ้าหน้าที่หนังสือรับรอง (admin only) ----------
router.get('/cert-staff', auth.requireAdmin, async (req, res) => {
  const rows = await db.prepare("SELECT ds.id, ds.user_id, u.full_name, u.title, u.position FROM document_staff ds JOIN users u ON u.id = ds.user_id WHERE ds.staff_type = 'certificate' ORDER BY u.full_name").all();
  res.json({ certStaff: rows });
});
router.post('/cert-staff', auth.requireAdmin, async (req, res) => {
  const ids = req.body.userIds || [];
  if (!ids.length) return res.status(400).json({ error: 'กรุณาเลือกเจ้าหน้าที่' });
  const ins = db.prepare("INSERT IGNORE INTO document_staff (staff_type, user_id) VALUES ('certificate', ?)");
  let added = 0;
  for (const uid of ids) { if ((await ins.run(Number(uid))).changes) added++; };
  res.json({ ok: true, message: 'เพิ่มเจ้าหน้าที่เรียบร้อย (' + added + ' คน)' });
});
router.delete('/cert-staff/:id', auth.requireAdmin, async (req, res) => {
  await db.prepare("DELETE FROM document_staff WHERE id = ? AND staff_type = 'certificate'").run(Number(req.params.id));
  res.json({ ok: true, message: 'ลบเจ้าหน้าที่เรียบร้อย' });
});
router.get('/cert-staff/me', auth.requireAuth, async (req, res) => {
  res.json({ isCertStaff: await isCertStaffUser(req.user.id) });
});

router.get('/documents', auth.requireAuth, async (req, res) => {
  const { doc_type, q, year } = req.query;
  let sql = `SELECT d.*, u.full_name AS creator_name FROM documents d
             LEFT JOIN users u ON u.id = d.created_by WHERE 1=1`;
  const args = [];
  if (doc_type) {
    sql += ' AND d.doc_type = ?';
    args.push(doc_type);
    // For outgoing documents, only show documents created by current user
    if (doc_type === 'outgoing') {
      sql += ' AND d.created_by = ? AND (d.sender_type IS NULL OR d.sender_type != ?)';
      args.push(req.user.id);
      args.push('registered');
      // โรงเรียน: เห็นเฉพาะหนังสือส่งของโรงเรียนตัวเองเท่านั้น (แยกชัดเจนระหว่างโรงเรียน เช่น 54020036 ≠ 54020055)
      if (req.user.user_group === 'school' && req.user.school_code) {
        sql += ' AND d.school_code = ?';
        args.push(req.user.school_code);
      }
    }
  }
  if (q) { sql += ' AND (d.title LIKE ? OR d.doc_no LIKE ? OR d.from_org LIKE ? OR d.to_org LIKE ?)'; const p = `%${q}%`; args.push(p, p, p, p); }
  const wg0 = (req.query.workgroup || '').trim(); if (wg0) { sql += ' AND d.workgroup = ?'; args.push(wg0); }
  const yc0 = docYearClause(year); if (yc0) { sql += yc0.clause; args.push(yc0.arg); }
  sql += ' ORDER BY d.id DESC';
  res.json({ documents: await db.prepare(sql).all(...args) });
});

const DOC_TYPES = ['incoming', 'outgoing', 'order', 'certificate', 'honor'];

/** ปี พ.ศ. ปัจจุบัน (1 ม.ค. - 31 ธ.ค.) */
function getCurrentYearBE() { return simdate.todayISO().slice(0, 4) - 0 + 543; }

/** ตัวกรองปี พ.ศ. สำหรับตาราง documents — year เป็น พ.ศ. กรองจากคอลัมน์ date (ค.ศ.) เช่น year=2569 → 2026-01-01..2026-12-31
 *  คืน { clause, arg } หรือ null เมื่อไม่ระบุปี */
function docYearClause(year) {
  const yBE = Number(year);
  if (!yBE) return null;
  return { clause: ' AND SUBSTRING(d.date, 1, 4) = ?', arg: String(yBE - 543) };
}

/** รายชื่อปี พ.ศ. ที่มีหนังสืออยู่จริง + ปีปัจจุบัน (ปีปัจจุบันขึ้นแรกเสมอ — เมื่อขึ้นปีใหม่ 1 ม.ค. รายการจะเพิ่มปีใหม่อัตโนมัติ) */
router.get('/document-years', auth.requireAuth, async (req, res) => {
  const rows = await db.prepare("SELECT DISTINCT SUBSTRING(date, 1, 4) AS y FROM documents WHERE date IS NOT NULL AND date != ''").all();
  const years = rows.map(r => Number(r.y) + 543);
  const cur = getCurrentYearBE();
  if (!years.includes(cur)) years.push(cur);
  years.sort((a, b) => b - a); // ใหม่ → เก่า
  // ปีปัจจุบันขึ้นแรกเสมอ (ตามสเปก — เมื่อขึ้น 1 ม.ค. ปีใหม่จะกลายเป็นตัวเลือกแรกเอง)
  const idx = years.indexOf(cur);
  if (idx > 0) { years.splice(idx, 1); years.unshift(cur); }
  res.json({ years, current: cur });
});

/** เลขที่หนังสือรับรองถัดไป — รันอัตโนมัติ ที่ 1/{ปี พ.ศ. ปัจจุบัน} เริ่ม 1 ใหม่ทุกปี */
async function nextCertificateDocNo() {
  const yearBE = simdate.todayISO().slice(0, 4) - 0 + 543;
  const rows = await db.prepare("SELECT doc_no AS no FROM documents WHERE doc_type = 'certificate' AND doc_no LIKE ?").all('%/' + yearBE);
  let max = 0;
  for (const r of rows) {
    const m = String(r.no).match(/([0-9]+)\s*\/\s*[0-9]{4}$/);
    if (m) { const v = parseInt(m[1], 10); if (!isNaN(v) && v > max) max = v; }
  }
  return 'ที่ ' + (max + 1) + '/' + yearBE;
}

/** เลขที่คำสั่งถัดไป — รันอัตโนมัติ 1/{ปี พ.ศ. ปัจจุบัน} เริ่ม 1 ใหม่ทุกปี (ไม่มีคำนำหน้า) */
async function nextOrderDocNo() {
  const yearBE = simdate.todayISO().slice(0, 4) - 0 + 543;
  const rows = await db.prepare("SELECT doc_no AS no FROM documents WHERE doc_type = 'order' AND doc_no LIKE ?").all('%/' + yearBE);
  let max = 0;
  for (const r of rows) {
    const m = String(r.no).match(/([0-9]+)\s*\/\s*[0-9]{4}$/);
    if (m) { const v = parseInt(m[1], 10); if (!isNaN(v) && v > max) max = v; }
  }
  return (max + 1) + '/' + yearBE;
}

/** ปี พ.ศ. ปัจจุบัน (ใช้รันเลขเกียรติบัตร — เมื่อเปลี่ยนปีเริ่มนับ 1 ใหม่) */
async function nextHonorDocNo() {
  const yearBE = simdate.todayISO().slice(0, 4) - 0 + 543;
  const rows = await db.prepare("SELECT doc_no AS no FROM documents WHERE doc_type = 'honor' AND doc_no LIKE ?").all('%/' + yearBE);
  let max = 0;
  for (const r of rows) {
    const m = String(r.no).match(/([0-9]+)\s*\/\s*[0-9]{4}$/);
    if (m) { const v = parseInt(m[1], 10); if (!isNaN(v) && v > max) max = v; }
  }
  return 'เลขที่ ' + (max + 1) + '/' + yearBE;
}

// ---------- โหมดจำลองวันที่ (ทดสอบการเปลี่ยนปี พ.ศ.) ----------
// เปิด: PUT /api/sim-date { "date": "2027-01-01" } • ปิด/กลับเวลาจริง: PUT /api/sim-date { "date": null }
// เป็นการจำลองเฉพาะ "นาฬิกาของระบบ" ไม่แก้ไขข้อมูลจริงใด ๆ และปิดแล้วทุกอย่างกลับปกติทันที
// GET ให้ผู้ใช้ทุกคนที่ล็อกอินอ่านได้ (frontend ต้องรู้วันจำลองเพื่อ patch ปฏิทิน/ฟอร์มของ user สถานศึกษาด้วย) — ส่วนเปิด/ปิด (PUT) เฉพาะ admin
router.get('/sim-date', auth.requireAuth, (req, res) => {
  res.json({ sim_today: simdate.simulating(), real_today: simdate.realTodayISO() });
});

router.put('/sim-date', auth.requireAdmin, async (req, res) => {
  const b = req.body || {};
  const val = b.date == null ? '' : String(b.date).trim();
  if (val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) return res.status(400).json({ error: 'รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น ค.ศ. YYYY-MM-DD เช่น 2027-01-01)' });
  await db.prepare("INSERT INTO settings (`key`, value) VALUES ('sim_today', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)").run(val);
  const applied = await simdate.reload();
  res.json({ ok: true, sim_today: applied || null, message: applied ? ('เปิดโหมดจำลอง: ระบบถือว่าวันนี้คือ ' + applied) : 'ปิดโหมดจำลอง — กลับสู่เวลาจริงแล้ว' });
});

router.post('/documents', auth.requireAuth, uploadDocDynamic.array('files', 7), uploadErrorHandler, async (req, res) => {
  const b = req.body || {};
  if (!DOC_TYPES.includes(b.doc_type)) return res.status(400).json({ error: 'กรุณาเลือกประเภทหนังสือ' });
  if (b.doc_type === 'certificate' && req.user.role !== 'admin' && !await isCertStaffUser(req.user.id)) return res.status(403).json({ error: 'เฉพาะเจ้าหน้าที่หนังสือรับรองเท่านั้นที่ลงทะเบียนได้' });
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: 'กรุณากรอกเรื่องของหนังสือ' });
  // Handle multiple files
  let file = null;
  if (req.files && req.files.length > 0) {
    var fPrefix = getSchoolPrefix(req);
    if (req.files.length === 1) {
      file = fPrefix + 'documents/' + req.files[0].filename;
    } else {
      file = JSON.stringify(req.files.map(function(f) { return fPrefix + 'documents/' + f.filename; }));
    }
  } else if (req.file) {
    file = getSchoolPrefix(req) + 'documents/' + req.file.filename;
  }
  // Auto-generate reg_no for school-to-office documents
  var autoRegNo = (b.reg_no || '').trim();
  var senderTypeVal = (b.sender_type || 'office').trim();
  if (senderTypeVal === 'school' && !autoRegNo) {
    autoRegNo = await nextDocNo('documents', 'reg_no');
  }
  // เกียรติบัตร: ระบบรันเลขอัตโนมัติ เริ่ม ที่เกียรติบัตร 1/{ปี พ.ศ.} — ไม่ใช้ค่าจาก client
  if (b.doc_type === 'honor') b.doc_no = await nextHonorDocNo();
  // หนังสือรับรอง: ระบบรันเลขอัตโนมัติ ที่ 1/{ปี พ.ศ.} เริ่ม 1 ใหม่ทุกปี — ไม่ใช้ค่าจาก client
  if (b.doc_type === 'certificate') b.doc_no = await nextCertificateDocNo();
  // คำสั่ง: ระบบรันเลขอัตโนมัติ ที่ 1/{ปี พ.ศ.} เริ่ม 1 ใหม่ทุกปี — ไม่ใช้ค่าจาก client
  if (b.doc_type === 'order') b.doc_no = await nextOrderDocNo();
  // ⚠ ตรวจผู้รับก่อนบันทึก: ถ้าระบบหาผู้รับจากช่อง "ถึง" ไม่ได้เลย → บังคับให้ผู้ส่งแก้ชื่อก่อน (กันหนังสือหล่นหายเงียบ)
  // ข้ามกรณีที่ไม่ได้ตั้งใจส่งถึงใคร: sender_type 'registered' (ลงทะเบียนเลขหนังสือส่ง), หนังสือรับรอง/คำสั่ง/เกียรติบัตร (ไม่มีช่องถึง),
  // และการส่งหลายโรงเรียนที่มี recipient_schools (โรงเรียนที่ยังไม่มีบุคลากรจะข้ามไปเฉพาะโรงเรียนนั้น ไม่บล็อกทั้งฉบับ)
  {
    const _toOrg = (b.to_org || '').trim();
    const _senderType = (b.sender_type || 'office').trim();
    const _skipGuard = _senderType === 'registered' || !_toOrg || b.recipient_schools || _senderType === 'school' || (_senderType === 'school_to_school' && !_toOrg);
    if (!_skipGuard) {
      if (_senderType === 'office') {
        if (!_toOrg.startsWith('ทุกคน') && !_toOrg.startsWith('กลุ่ม:')) {
          // ส่งถึงชื่อเจาะจง (คั่นด้วยจุลภาค) — ตรวจทีละชื่อ ถ้ามีชื่อใดไม่เจอในระบบเลย ให้แก้ก่อนบันทึก
          const names = _toOrg.split(',').map(n => n.trim()).filter(Boolean);
          if (!names.length) return res.status(400).json({ error: 'ไม่พบผู้รับจากช่อง "ถึง": "' + _toOrg + '" — กรุณาพิมพ์ชื่อ-นามสกุลผู้รับให้ตรงกับบุคลากรในระบบ หรือเลือกส่งแบบ "ทุกคน"/"กลุ่ม:" ก่อนบันทึก' });
          const missing = [];
          for (const name of names) {
            let u = await db.prepare(`SELECT id FROM users WHERE (title || ' ' || full_name) = ? OR full_name = ?`).get(name, name);
            if (!u) u = await db.prepare(`SELECT id FROM users WHERE ? LIKE (title || ' ' || full_name) || ' %' OR ? LIKE full_name || ' %' ORDER BY id LIMIT 1`).get(name, name);
            if (!u) missing.push(name);
          }
          if (missing.length) return res.status(400).json({ error: 'ไม่พบผู้รับจากช่อง "ถึง": ' + missing.join(', ') + ' — กรุณาตรวจสอบและแก้ไขชื่อผู้รับให้ตรงกับบุคลากรในระบบก่อนบันทึก (พิมพ์ชื่อ-นามสกุลให้ตรง หรือเลือกส่งแบบ "ทุกคน"/"กลุ่ม:")' });
        }
        // ทุกคน/กลุ่ม: เช็คล่วงหน้าไม่ได้ว่าจะมีสมาชิกกี่คน — ถ้าไม่ได้ผู้รับเลยจะเตือนหลังบันทึก (ด้านล่าง)
      } else if (_senderType === 'school_to_school') {
        // ส่งถึงโรงเรียนเดียว (client เก่า) — ต้องระบุรหัสโรงเรียนนำหน้าในช่อง "ถึง"
        const targetSchoolCode = _toOrg.split(' ')[0];
        if (!targetSchoolCode) return res.status(400).json({ error: 'กรุณาระบุสถานศึกษาปลายทางในช่อง "ถึง" (รูปแบบ: รหัสโรงเรียน ชื่อโรงเรียน) ก่อนส่งหนังสือ' });
        let tClerks = (await db.prepare("SELECT user_id FROM document_staff WHERE staff_type = 'school' AND school_code = ?").all(targetSchoolCode)).map(r => r.user_id);
        if (!tClerks.length) tClerks = (await db.prepare("SELECT id FROM users WHERE user_group = 'school' AND school_code = ? AND status = 'active'").all(targetSchoolCode)).map(r => r.id);
        if (!tClerks.length) return res.status(400).json({ error: 'ไม่พบผู้รับที่สถานศึกษาปลายทาง (รหัส ' + targetSchoolCode + ') — โรงเรียนนี้ยังไม่มีสารบัญสถานศึกษาหรือบุคลากรในระบบ กรุณาตรวจสอบก่อนส่งหนังสือ' });
      }
    }
  }
  const docSchoolCode = (req.user.school_code || '').trim();
  const isRegisteredVal = Number(b.is_registered) ? 1 : 0;
  const info = await db.prepare(`INSERT INTO documents (doc_type, doc_no, reg_no, title, from_org, to_org, date, category, file, note, created_by, body_text, priority, workgroup, sender_type, school_code, person_name, person_school, honor_signer, honor_template, honor_saved_file, is_registered, requester, cert_position, officer, owner_group, order_registrar)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.doc_type, (b.doc_no || '').trim(), autoRegNo, String(b.title).trim(),
    (b.from_org || '').trim(), (b.to_org || '').trim(), (b.date || simdate.todayISO()),
    (b.category || '').trim(), file, (b.note || '').trim(), req.user.id,
    (b.body_text || '').trim(), (b.priority || 'normal').trim(), (b.workgroup || '').trim(), (b.sender_type || 'office').trim(), docSchoolCode,
    (b.person_name || '').trim(), (b.person_school || '').trim(), (b.honor_signer || '').trim(), (b.honor_template || '').trim(), (b.honor_saved_file || '').trim(), isRegisteredVal,
    (b.requester || '').trim(), (b.cert_position || '').trim(), (b.officer || '').trim(), (b.owner_group || '').trim(), (b.order_registrar || '').trim());
  const docId = info.lastInsertRowid;
  // Add recipients based on to_org
  const toOrg = (b.to_org || '').trim();
  const senderType = (b.sender_type || 'office').trim();
  if (senderType === 'office' && toOrg) {
    const insertRecip = db.prepare('INSERT INTO document_recipients (document_id, user_id) VALUES (?, ?)');
    if (toOrg.startsWith('ทุกคน')) {
      // Send to all office staff
      const officeStaff = await db.prepare("SELECT id FROM users WHERE user_group != 'school' AND status = 'active'").all();
      for (const s of officeStaff) { return  await insertRecip.run(docId, s.id) };
    } else if (toOrg.startsWith('กลุ่ม:')) {
      // Send to staff in selected groups
      const groups = toOrg.replace('กลุ่ม:', '').split(',').map(g => g.trim()).filter(Boolean);
      if (groups.length) {
        const placeholders = groups.map(() => '?').join(',');
        const staff = await db.prepare(`SELECT id FROM users WHERE user_group != 'school' AND status = 'active' AND workplace IN (${placeholders})`).all(...groups);
        for (const s of staff) { return  await insertRecip.run(docId, s.id) };
      }
    } else {
      // Send to specific staff (comma-separated names)
      const names = toOrg.split(',').map(n => n.trim()).filter(Boolean);
      for (const name of names) {
      let user = await db.prepare(`SELECT id FROM users WHERE (title || ' ' || full_name) = ? OR full_name = ?`).get(name, name);
      if (!user) {
        // ชื่อผู้รับอาจพิมพ์ต่อท้ายด้วยข้อมูลอื่น (เช่น กลุ่มงาน) — ลองจับกรณีชื่อจริงเป็นคำนำหน้าของข้อความ กันผู้รับหายเงียบ
        user = await db.prepare(`SELECT id FROM users WHERE ? LIKE (title || ' ' || full_name) || ' %' OR ? LIKE full_name || ' %' ORDER BY id LIMIT 1`).get(name, name);
      }
      if (user) await insertRecip.run(docId, user.id);
    };
    }
  } else if (senderType === 'school') {
    // School sending to office - only the designated office registry clerks (สารบัญเขต) receive it
    const insertRecip = db.prepare('INSERT IGNORE INTO document_recipients (document_id, user_id) VALUES (?, ?)');
    let clerks = (await db.prepare("SELECT user_id FROM document_staff WHERE staff_type = 'office'").all()).map(r => r.user_id);
    if (!clerks.length && req.user.role === 'admin') clerks = [req.user.id];
    for (const s of clerks) { return  await insertRecip.run(docId, s) };
  } else if (senderType === 'school_to_school' && !b.recipient_schools) {
    // School sending to another school (โรงเรียนเดียว จาก client เก่า) — สารบัญสถานศึกษาของโรงเรียนปลายทางรับ
    const insertRecip2 = db.prepare('INSERT INTO document_recipients (document_id, user_id, as_school) VALUES (?, ?, ?)');
    const targetSchoolCode = (toOrg || '').split(' ')[0];
    if (targetSchoolCode) {
      let clerks = (await db.prepare("SELECT user_id FROM document_staff WHERE staff_type = 'school' AND school_code = ?").all(targetSchoolCode)).map(r => r.user_id);
      if (!clerks.length) {
        // โรงเรียนปลายทางยังไม่มีสารบัญ — fallback ให้บุคลากรของโรงเรียนนั้นรับไว้ก่อน (กันหนังสือหาย)
        clerks = (await db.prepare("SELECT id FROM users WHERE user_group = 'school' AND school_code = ? AND status = 'active'").all(targetSchoolCode)).map(r => r.id);
      }
      var seen2 = new Set();
      for (const s of clerks) { if (!seen2.has(s)) { seen2.add(s); await insertRecip2.run(docId, s, targetSchoolCode); } };
    }
  }
  // school_to_school แบบเลือกหลายโรงเรียน/กลุ่ม/ทุกโรงเรียน → ผู้รับ = สารบัญสถานศึกษาของแต่ละโรงเรียนปลายทาง (dedupe กันแถวซ้ำ)
  if (senderType === 'school_to_school' && b.recipient_schools) {
    try {
      var rawListS = Array.isArray(b.recipient_schools) ? b.recipient_schools : [b.recipient_schools];
      var parsedS = [];
      rawListS.forEach(function(rv) {
        try { var arr = JSON.parse(rv); if (Array.isArray(arr)) parsedS = parsedS.concat(arr); } catch (e) { parsedS.push(rv); }
      });
      var schoolCodesS = [];
      parsedS.forEach(function(c) { var code = String(c).split(' ')[0].trim(); if (code && schoolCodesS.indexOf(code) === -1) schoolCodesS.push(code); });
      var seenUserS = new Set();
      var insRecipS = db.prepare('INSERT INTO document_recipients (document_id, user_id, as_school) VALUES (?, ?, ?)');
      for (const code of schoolCodesS) {
      var clerks = (await db.prepare("SELECT user_id FROM document_staff WHERE staff_type = 'school' AND school_code = ?").all(code)).map(function(r) { return r.user_id; });
      if (!clerks.length) {
        // โรงเรียนนี้ยังไม่มีสารบัญ — fallback ให้บุคลากรของโรงเรียนรับไว้ก่อน (กันหนังสือหาย)
        clerks = (await db.prepare("SELECT id FROM users WHERE user_group = 'school' AND school_code = ? AND status = 'active'").all(code)).map(function(r) { return r.id; });
      }
      // หนึ่ง user อาจเป็นสารบัญหลายโรงเรียน — สร้างแถวผู้รับแยกต่อโรงเรียน + เก็บ as_school (โรงเรียนที่รับในฐานะนั้น)
      for (const s of clerks) { if (!seenUserS.has(s + '|' + code)) { seenUserS.add(s + '|' + code); await insRecipS.run(docId, s, code); } };
    };
    } catch (e) { /* ignore parse errors */ }
  }
  // ส่งหนังสือถึงสถานศึกษาเฉพาะเจาะจง → ผู้รับเป็นสารบัญสถานศึกษาของโรงเรียนนั้น (ไม่ใช่ทั้งโรงเรียน)
  if (senderType === 'office' && b.recipient_schools) {
  try {
    var rawList2 = Array.isArray(b.recipient_schools) ? b.recipient_schools : [b.recipient_schools];
    var parsed2 = [];
    rawList2.forEach(function(rv) {
      try { var arr = JSON.parse(rv); if (Array.isArray(arr)) parsed2 = parsed2.concat(arr); } catch (e) { parsed2.push(rv); }
    });
    var schoolCodes2 = [];
    parsed2.forEach(function(c) { var code = String(c).split(' ')[0].trim(); if (code && schoolCodes2.indexOf(code) === -1) schoolCodes2.push(code); });
    var insertSchoolRecip = db.prepare('INSERT INTO document_recipients (document_id, user_id, as_school) VALUES (?, ?, ?)');
    for (const code of schoolCodes2) {
    var clerks = (await db.prepare("SELECT user_id FROM document_staff WHERE staff_type = 'school' AND school_code = ?").all(code)).map(function(r) { return r.user_id; });
    if (!clerks.length) {
      // โรงเรียนนี้ยังไม่มีสารบัญ — fallback ให้บุคลากรของโรงเรียนรับไว้ก่อน (กันหนังสือหาย)
      clerks = (await db.prepare("SELECT id FROM users WHERE user_group = 'school' AND school_code = ? AND status = 'active'").all(code)).map(function(r) { return r.id; });
    }
    var seenC = new Set();
    for (const s of clerks) { if (!seenC.has(s)) { seenC.add(s); await insertSchoolRecip.run(docId, s, code); } };
  };
  } catch (e) { /* ignore parse errors */ }
}
  // เตือนหลังบันทึก: กรณีที่ตรวจล่วงหน้าไม่ได้ (ทุกคน/กลุ่ม: ไม่มีสมาชิก) — หนังสือถูกบันทึกแต่ไม่มีผู้รับ
  try {
    const recipCount = (await db.prepare('SELECT COUNT(*) AS c FROM document_recipients WHERE document_id = ?').get(docId)).c;
    if (!recipCount && (senderType === 'office' && toOrg)) {
      return res.json({ ok: true, id: docId, message: 'บันทึกหนังสือแล้ว ⚠ แต่ไม่พบผู้รับจากช่อง "ถึง": "' + toOrg + '" — หนังสืออาจไม่ถึงปลายทาง กรุณาแก้ไขชื่อผู้รับให้ตรงกับบุคลากรในระบบแล้วส่งใหม่' });
    }
  } catch (e) { /* ไม่เป็นผลต่อการบันทึก */ }
  res.json({ ok: true, id: docId, message: 'ลงทะเบียนหนังสือเรียบร้อย' });
});

router.put('/documents/:id', auth.requireAuth, uploadDocDynamic.array('files', 7), uploadErrorHandler, async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบหนังสือ' });
  if (row.doc_type === 'certificate' && req.user.role !== 'admin' && !await isCertStaffUser(req.user.id)) return res.status(403).json({ error: 'เฉพาะเจ้าหน้าที่หนังสือรับรองเท่านั้นที่แก้ไขได้' });
  // สารบัญเขตสามารถลงทะเบียน/แก้ไขหนังสือที่สถานศึกษาหรือบุคคลอื่นส่งมาได้
  const isOfficeClerk = !!await db.prepare("SELECT id FROM document_staff WHERE staff_type = 'office' AND user_id = ?").get(req.user.id);
  if (req.user.role !== 'admin' && row.created_by !== req.user.id && !isOfficeClerk) return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขหนังสือนี้' });
  const b = req.body || {};
  let file = row.file;
  if (req.files && req.files.length) {
    var fPrefixUp = getSchoolPrefix(req);
    var newFiles = req.files.map(f => fPrefixUp + 'documents/' + f.filename);
    // Flow ลงทะเบียน/ปั้มรับ (is_registered=1): เก็บไฟล์เดิมไว้ครบ แล้วเพิ่มไฟล์ใหม่ต่อท้าย — ไม่ลบ/ไม่ทับไฟล์เดิม
    if (Number(b.is_registered) === 1 && row.file) {
      var oldFiles = [];
      try { var arr = JSON.parse(row.file); oldFiles = Array.isArray(arr) ? arr : [row.file]; } catch (e) { oldFiles = [row.file]; }
      oldFiles.forEach(f => { if (!newFiles.includes(f)) newFiles.unshift(f); });
      file = JSON.stringify(newFiles);
    } else {
      if (row.file) deleteUploadedFile(row.file);
      file = newFiles.length === 1 ? newFiles[0] : JSON.stringify(newFiles);
    }
  } else if (req.file) {
    if (row.file) deleteUploadedFile(row.file);
    file = getSchoolPrefix(req) + 'documents/' + req.file.filename;
  }
  await db.prepare(`UPDATE documents SET doc_type=?, doc_no=?, title=?, from_org=?, to_org=?, date=?, category=?, file=?, note=?, body_text=?, priority=?, person_name=?, person_school=?, honor_signer=?, honor_template=?, honor_saved_file=?, reg_no=?, workgroup=?, is_registered=?, requester=?, cert_position=?, officer=?, owner_group=?, order_registrar=? WHERE id=?`)
    .run(b.doc_type || row.doc_type, (b.doc_no ?? (row.doc_no || '')).trim(), String(b.title || row.title).trim(),
      (b.from_org ?? (row.from_org || '')).trim(), (b.to_org ?? (row.to_org || '')).trim(),
      b.date || row.date || simdate.todayISO(), (b.category ?? (row.category || '')).trim(),
      file, (b.note ?? (row.note || '')).trim(),
      (b.body_text ?? (row.body_text || '')).trim(), (b.priority ?? (row.priority || 'normal')).trim(),
      (b.person_name ?? (row.person_name || '')).trim(), (b.person_school ?? (row.person_school || '')).trim(),
      (b.honor_signer ?? (row.honor_signer || '')).trim(), (b.honor_template ?? (row.honor_template || '')).trim(), (b.honor_saved_file ?? (row.honor_saved_file || '')).trim(),
      (b.reg_no ?? row.reg_no ?? '').toString().trim(), (b.workgroup ?? row.workgroup ?? '').toString().trim(),
      (b.is_registered !== undefined ? (Number(b.is_registered) ? 1 : 0) : (row.is_registered ? 1 : 0)),
      (b.requester ?? (row.requester || '')).trim(), (b.cert_position ?? (row.cert_position || '')).trim(), (b.officer ?? (row.officer || '')).trim(), (b.owner_group ?? (row.owner_group || '')).trim(), (b.order_registrar ?? (row.order_registrar || '')).trim(), id);
  res.json({ ok: true, message: 'แก้ไขหนังสือเรียบร้อย' });
});

// POST /honor-certificate — บันทึกภาพเกียรติบัตรที่ประกอบแล้ว (dataURL) ลง public/uploads/honors/
// คืน path สัมพัทธ์ (honors/xxx.jpg) สำหรับเก็บใน documents.honor_saved_file
router.post('/honor-certificate', auth.requireAuth, (req, res) => {
  try {
    const dataUrl = String(req.body.image || '');
    const m = dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'รูปแบบภาพไม่ถูกต้อง' });
    const HONORS_DIR = path.join(__dirname, '..', 'public', 'uploads', 'honors');
    if (!fs.existsSync(HONORS_DIR)) fs.mkdirSync(HONORS_DIR, { recursive: true });
    const name = 'honor-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.jpg';
    fs.writeFileSync(path.join(HONORS_DIR, name), Buffer.from(m[2], 'base64'));
    res.json({ ok: true, path: 'honors/' + name, url: '/uploads/honors/' + name });
  } catch (e) {
    console.error('[honor-certificate]', e);
    res.status(500).json({ error: 'บันทึกไฟล์เกียรติบัตรไม่สำเร็จ' });
  }
});

router.delete('/documents/:id', auth.requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'ไม่พบหนังสือ' });
  if (row.doc_type === 'certificate' && req.user.role !== 'admin' && !await isCertStaffUser(req.user.id)) return res.status(403).json({ error: 'เฉพาะเจ้าหน้าที่หนังสือรับรองเท่านั้นที่ลบได้' });
  if (req.user.role !== 'admin' && row.created_by !== req.user.id) return res.status(403).json({ error: 'ไม่มีสิทธิ์ลบหนังสือนี้' });
  if (row.file) deleteUploadedFile(row.file);
  if (row.honor_saved_file) deleteUploadedFile(row.honor_saved_file); // ลบไฟล์เกียรติบัตรที่บันทึกไว้ด้วย
  await cleanup.purgeDocumentChildren(row.id); // ลบผู้รับ + สถานะการอ่านที่ผูกกับหนังสือนี้ (ไม่ทิ้งค่าค้างใน DB)
  await db.prepare('DELETE FROM documents WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true, message: 'ลบหนังสือเรียบร้อย' });
});

// ตรวจสอบว่า user ปัจจุบันเป็นเจ้าหน้าที่สารบัญหรือไม่
router.get('/document-staff/me', auth.requireAuth, async (req, res) => {
  const userId = req.user.id;
  const isOffice = await db.prepare('SELECT id FROM document_staff WHERE staff_type = ? AND user_id = ?').get('office', userId);
  const schoolRow = await db.prepare('SELECT school_code FROM document_staff WHERE staff_type = ? AND user_id = ? AND school_code = ?').get('school', userId, req.user.school_code || '');
  res.json({
    isOfficeDocStaff: !!isOffice,
    schoolCode: schoolRow ? schoolRow.school_code : null
  });
});

// GET /document-staff/school-prefix - ดึงเลขหนังสือของสถานศึกษาที่กำลังใช้งาน (แยกตาม school_code)
router.get('/document-staff/school-prefix', auth.requireAuth, async (req, res) => {
  const userId = req.user.id;
  const myCode = req.user.school_code || '';
  const row = await db.prepare('SELECT doc_prefix FROM document_staff WHERE staff_type = ? AND user_id = ? AND school_code = ?').get('school', userId, myCode);
  res.json({ doc_prefix: row ? (row.doc_prefix || '') : '', school_code: myCode });
});

// PUT /document-staff/school-prefix - บันทึกเลขหนังสือของสถานศึกษาที่กำลังใช้งาน (แยกตาม school_code)
router.put('/document-staff/school-prefix', auth.requireAuth, async (req, res) => {
  const userId = req.user.id;
  const myCode = req.user.school_code || '';
  const { doc_prefix } = req.body;
  const row = await db.prepare('SELECT id FROM document_staff WHERE staff_type = ? AND user_id = ? AND school_code = ?').get('school', userId, myCode);
  if (!row) return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขเลขหนังสือของสถานศึกษานี้' });
  await db.prepare('UPDATE document_staff SET doc_prefix = ? WHERE id = ?').run(doc_prefix || '', row.id);
  res.json({ message: 'บันทึกเลขหนังสือเรียบร้อย', doc_prefix: doc_prefix || '', school_code: myCode });
});

// ---------- เจ้าหน้าที่หนังสือราชการ (admin only) ----------

// ดึงรายชื่อเจ้าหน้าที่หนังสือราชการทั้งหมด
router.get('/document-staff', auth.requireAdmin, async (req, res) => {
  const officeStaff = await db.prepare(`
    SELECT ds.id, ds.user_id, u.full_name, u.title, u.position, u.workplace
    FROM document_staff ds
    JOIN users u ON u.id = ds.user_id
    WHERE ds.staff_type = 'office'
    ORDER BY u.full_name
  `).all();
  const schoolStaff = await db.prepare(`
    SELECT ds.id, ds.user_id, ds.school_code, u.full_name, u.title, u.position, u.workplace,
           s.name AS school_name
    FROM document_staff ds
    JOIN users u ON u.id = ds.user_id
    LEFT JOIN schools s ON s.code = ds.school_code
    WHERE ds.staff_type = 'school'
    ORDER BY ds.school_code, u.full_name
  `).all();
  res.json({ officeStaff, schoolStaff });
});

// เพิ่มเจ้าหน้าที่ สพป. (หลายคนพร้อมกัน)
router.post('/document-staff/office', auth.requireAdmin, async (req, res) => {
  const ids = req.body.userIds || [];
  if (!ids.length) return res.status(400).json({ error: 'กรุณาเลือกเจ้าหน้าที่' });
  const ins = db.prepare('INSERT IGNORE INTO document_staff (staff_type, user_id) VALUES (?, ?)');
  // สารบัญคนใหม่ต้องเห็นหนังสือที่สถานศึกษาส่งมาทั้งหมดที่เคยมี (sync ผู้รับย้อนหลัง)
  const syncRecip = db.prepare("INSERT IGNORE INTO document_recipients (document_id, user_id) SELECT id, ? FROM documents WHERE sender_type = 'school'");
  let added = 0;
  for (const uid of ids) { const r = await ins.run('office', Number(uid)); if (r.changes) { added++; await syncRecip.run(Number(uid)); } };
  res.json({ ok: true, message: 'เพิ่มเจ้าหน้าที่เรียบร้อย (' + added + ' คน)' });
});

// ลบเจ้าหน้าที่ สพป.
router.delete('/document-staff/office/:id', auth.requireAdmin, async (req, res) => {
  const row = await db.prepare('SELECT user_id FROM document_staff WHERE id = ? AND staff_type = ?').get(Number(req.params.id), 'office');
  await db.prepare('DELETE FROM document_staff WHERE id = ? AND staff_type = ?').run(Number(req.params.id), 'office');
  // ถ้า user นี้ไม่ได้เป็นสารบัญเขตแล้ว ถอดออกจากผู้รับหนังสือที่สถานศึกษาส่งมา (ตัวหนังสือยังเก็บในทะเบียนครบ)
  if (row) {
    const still = await db.prepare('SELECT id FROM document_staff WHERE staff_type = ? AND user_id = ?').get('office', row.user_id);
    if (!still) await db.prepare("DELETE FROM document_recipients WHERE user_id = ? AND document_id IN (SELECT id FROM documents WHERE sender_type = 'school')").run(row.user_id);
  }
  res.json({ ok: true, message: 'ลบเจ้าหน้าที่เรียบร้อย' });
});

// บันทึกเจ้าหน้าที่สถานศึกษา (replace ทั้งหมดของโรงเรียนนั้น)
router.post('/document-staff/school', auth.requireAdmin, async (req, res) => {
  const { school_code, userIds } = req.body;
  if (!school_code) return res.status(400).json({ error: 'กรุณาเลือกสถานศึกษา' });
  const ids = (userIds || []).map(Number);
  const before = (await db.prepare("SELECT user_id FROM document_staff WHERE staff_type = 'school' AND school_code = ?").all(school_code)).map(r => r.user_id);
  await db.prepare('DELETE FROM document_staff WHERE staff_type = ? AND school_code = ?').run('school', school_code);
  const ins = db.prepare('INSERT INTO document_staff (staff_type, user_id, school_code) VALUES (?, ?, ?)');
  for (const uid of ids) { return  await ins.run('school', uid, school_code) };
  // sync ผู้รับหนังสือที่ สพป. ส่งถึงสถานศึกษานี้ (ย้อนหลังทั้งหมด)
  const syncRecip = db.prepare("INSERT IGNORE INTO document_recipients (document_id, user_id) SELECT d.id, ? FROM documents d WHERE d.sender_type = 'office' AND (d.to_org LIKE ? OR EXISTS (SELECT 1 FROM document_recipients dr JOIN users u ON u.id = dr.user_id WHERE dr.document_id = d.id AND u.user_group = 'school' AND (u.school_code = ? OR u.workplace LIKE ?)))");
  const syncArgs = [school_code + '%', school_code, school_code + '%'];
  for (const uid of ids) { return  await syncRecip.run(uid, ...syncArgs) };
  // ถอดผู้รับที่ถูกปลด (เคยเป็นสารบัญของโรงเรียนนี้ แต่ไม่อยู่ในรายการใหม่) — ถอดเฉพาะหนังสือของโรงเรียนนี้ เพื่อไม่กระทบสิทธิ์ของโรงเรียนอื่นที่ยังดูแลอยู่
  for (const oldUid of before) {
  if (ids.indexOf(Number(oldUid)) >= 0) return;
  await db.prepare("DELETE FROM document_recipients WHERE user_id = ? AND document_id IN (SELECT d.id FROM documents d WHERE d.sender_type = 'office' AND (d.to_org LIKE ? OR EXISTS (SELECT 1 FROM document_recipients dr JOIN users u ON u.id = dr.user_id WHERE dr.document_id = d.id AND u.user_group = 'school' AND (u.school_code = ? OR u.workplace LIKE ?))))").run(oldUid, school_code + '%', school_code, school_code + '%');
};
  res.json({ ok: true, message: 'บันทึกเจ้าหน้าที่สถานศึกษาเรียบร้อย (' + ids.length + ' คน)' });
});

// บันทึกการอ่านหนังสือ
router.post('/document-reads/:docId', auth.requireAuth, async (req, res) => {
  const docId = Number(req.params.docId);
  const userId = req.user.id;
  await db.prepare('INSERT IGNORE INTO document_reads (doc_id, user_id) VALUES (?, ?)').run(docId, userId);
  res.json({ ok: true });
});

// ดึงสถานะการอ่านหนังสือ
router.get('/document-reads/:docId', auth.requireAuth, async (req, res) => {
  const docId = Number(req.params.docId);
  const reads = await db.prepare(`
    SELECT dr.user_id, dr.read_at, u.full_name, u.title
    FROM document_reads dr JOIN users u ON u.id = dr.user_id
    WHERE dr.doc_id = ?
  `).all(docId);
  res.json({ reads });
});

// ---------- เมนู 10: บริหารงบประมาณ ----------
router.get('/budgets', auth.requireAuth, async (req, res) => {
  const budgets = await db.prepare('SELECT * FROM budgets ORDER BY sort, id').all();
  const summary = await Promise.all(budgets.map(async (b) => {
    const used = (await db.prepare("SELECT COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) - COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS used FROM budget_transactions WHERE budget_id = ?").get(b.id)).used;
    return { ...b, used: Number(used), remaining: Number(b.plan) - Number(used) };
  }));
  const totalPlan = summary.reduce((s, b) => s + Number(b.plan), 0);
  const totalUsed = summary.reduce((s, b) => s + b.used, 0);
  res.json({ budgets: summary, totalPlan, totalUsed, totalRemaining: totalPlan - totalUsed });
});

router.post('/budgets', auth.requireAdmin, async (req, res) => {
  const b = req.body || {};
  if (!b.category || !String(b.category).trim()) return res.status(400).json({ error: 'กรุณากรอกรายการงบประมาณ' });
  const info = await db.prepare('INSERT INTO budgets (year, category, plan, note, sort) VALUES (?,?,?,?,?)')
    .run(Number(b.year) || simdate.todayISO().slice(0, 4) - 0 + 543, String(b.category).trim(), Number(b.plan) || 0,
      (b.note || '').trim(), Number(b.sort) || 0);
  res.json({ ok: true, id: info.lastInsertRowid, message: 'เพิ่มรายการงบประมาณเรียบร้อย' });
});

router.put('/budgets/:id', auth.requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!await db.prepare('SELECT id FROM budgets WHERE id = ?').get(id)) return res.status(404).json({ error: 'ไม่พบรายการ' });
  const b = req.body || {};
  await db.prepare('UPDATE budgets SET year=?, category=?, plan=?, note=?, sort=? WHERE id=?')
    .run(Number(b.year) || simdate.todayISO().slice(0, 4) - 0 + 543, String(b.category || '').trim(), Number(b.plan) || 0,
      (b.note || '').trim(), Number(b.sort) || 0, id);
  res.json({ ok: true, message: 'แก้ไขรายการงบประมาณเรียบร้อย' });
});

router.delete('/budgets/:id', auth.requireAdmin, async (req, res) => {
  await db.prepare('DELETE FROM budget_transactions WHERE budget_id = ?').run(Number(req.params.id));
  await db.prepare('DELETE FROM budgets WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true, message: 'ลบรายการงบประมาณเรียบร้อย' });
});
router.get('/budgets/:id/transactions', auth.requireAuth, async (req, res) => {
  const rows = await db.prepare('SELECT * FROM budget_transactions WHERE budget_id = ? ORDER BY date DESC, id DESC')
    .all(Number(req.params.id));
  res.json({ transactions: rows });
});

router.post('/budgets/:id/transactions', auth.requireAdmin, async (req, res) => {
  const b = req.body || {};
  if (!b.description || !String(b.description).trim()) return res.status(400).json({ error: 'กรุณากรอกรายละเอียดรายการ' });
  if (isNaN(Number(b.amount)) || Number(b.amount) <= 0) return res.status(400).json({ error: 'กรุณาระบุจำนวนเงินที่ถูกต้อง' });
  const info = await db.prepare('INSERT INTO budget_transactions (budget_id, date, description, amount, type) VALUES (?,?,?,?,?)')
    .run(Number(req.params.id), b.date || simdate.todayISO(), String(b.description).trim(),
      Number(b.amount), b.type === 'income' ? 'income' : 'expense');
  res.json({ ok: true, id: info.lastInsertRowid, message: 'บันทึกรายการเรียบร้อย' });
});

router.delete('/budgets/:id/transactions/:tid', auth.requireAdmin, async (req, res) => {
  await db.prepare('DELETE FROM budget_transactions WHERE id = ?').run(Number(req.params.tid));
  res.json({ ok: true, message: 'ลบรายการเรียบร้อย' });
});

// ---------- เมนู 11: บริหารงานวิชาการ ----------
router.get('/academic', auth.requireAuth, async (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM academic_projects WHERE 1=1';
  const args = [];
  if (status) { sql += ' AND status = ?'; args.push(status); }
  sql += ' ORDER BY id DESC';
  res.json({ projects: await db.prepare(sql).all(...args) });
});

router.post('/academic', auth.requireAdmin, async (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อโครงการ/กิจกรรม' });
  const info = await db.prepare(`INSERT INTO academic_projects (name, kind, detail, date_from, date_to, status, responsible, budget, result)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(String(b.name).trim(), b.kind === 'activity' ? 'activity' : 'project',
    (b.detail || '').trim(), (b.date_from || '').trim(), (b.date_to || '').trim(),
    b.status || 'planned', (b.responsible || '').trim(), Number(b.budget) || 0, (b.result || '').trim());
  res.json({ ok: true, id: info.lastInsertRowid, message: 'เพิ่มโครงการ/กิจกรรมเรียบร้อย' });
});

router.put('/academic/:id', auth.requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!await db.prepare('SELECT id FROM academic_projects WHERE id = ?').get(id)) return res.status(404).json({ error: 'ไม่พบรายการ' });
  const b = req.body || {};
  await db.prepare(`UPDATE academic_projects SET name=?, kind=?, detail=?, date_from=?, date_to=?, status=?, responsible=?, budget=?, result=? WHERE id=?`)
    .run(String(b.name || '').trim(), b.kind === 'activity' ? 'activity' : 'project',
      (b.detail || '').trim(), (b.date_from || '').trim(), (b.date_to || '').trim(),
      b.status || 'planned', (b.responsible || '').trim(), Number(b.budget) || 0, (b.result || '').trim(), id);
  res.json({ ok: true, message: 'แก้ไขโครงการ/กิจกรรมเรียบร้อย' });
});

router.delete('/academic/:id', auth.requireAdmin, async (req, res) => {
  await db.prepare('DELETE FROM academic_projects WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true, message: 'ลบโครงการ/กิจกรรมเรียบร้อย' });
});// ---------- เมนู 12: เจ้าหน้าที่ในระบบ ----------
router.get('/staff', auth.requireAdmin, async (req, res) => {
  const { status, q, user_group } = req.query;
  let sql = `SELECT id, username, title, full_name, first_name, last_name, nickname, blood_type,
             academic_rank, highest_education, birth_date, citizen_id, staff_no, position, workplace, workplace_secondary, phone, email,
             telegram_token, telegram_chat_id, photo, signature, role, can_approve, status, user_group, created_at, approved_at
             FROM users WHERE 1=1`;
  const args = [];
  if (status) { sql += ' AND status = ?'; args.push(status); }
  if (user_group) { sql += ' AND user_group = ?'; args.push(user_group); }
  if (q) { sql += ' AND (username LIKE ? OR full_name LIKE ? OR position LIKE ? OR workplace LIKE ? OR citizen_id LIKE ?)'; const p = `%${q}%`; args.push(p, p, p, p, p); }
  // เรียงตามลำดับเจ้าหน้าที่ (staff_no) น้อย → มาก บนลงล่าง — ผู้ที่ยังไม่กำหนดลำดับอยู่ท้ายสุด (เรียงตาม id)
  sql += ' ORDER BY CASE WHEN staff_no IS NULL OR staff_no = \'\' THEN 1 ELSE 0 END, CAST(staff_no AS SIGNED) ASC, id ASC';
  // auth.publicUser เป็น async → คืน Promise
  // ถ้าใช้ rows.map(auth.publicUser) ตรง ๆ จะได้ Promise[] ซึ่ง JSON.stringify แปลงเป็น {}
  // ทำให้หน้าเว็บเห็นแถวเปล่า (ชื่อ-นามสกุล ตำแหน่ง กลุ่มงาน ว่างหมด)
  // จุดอื่นในไฟล์นี้ใช้ await ถูกต้องแล้ว เช่นบรรทัด 723, 803, 814
  res.json({ staff: await Promise.all((await db.prepare(sql).all(...args)).map(auth.publicUser)) });
});

// Route สำหรับดึงรายชื่อเจ้าหน้าที่สพป. (ใช้ได้ทุก user สำหรับส่งไปรษณีย์)
router.get('/office-staff', auth.requireAuth, async (req, res) => {
  const staff = await db.prepare(`
    SELECT id, title, full_name, position, workplace, user_group, status, signature
    FROM users
    WHERE user_group != 'school' AND status = 'active'
    ORDER BY CASE WHEN staff_no IS NULL OR staff_no = '' THEN 1 ELSE 0 END,
CAST(staff_no AS SIGNED) ASC, id ASC
  `).all();
  res.json({ staff });
});

router.get('/staff/:id', auth.requireAdmin, async (req, res) => {
  const u = await db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'ไม่พบเจ้าหน้าที่' });
  res.json({ user: await auth.publicUser(u) });
});

router.put('/staff/:id/status', auth.requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const u = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'ไม่พบเจ้าหน้าที่' });
  const { status, note } = req.body || {};
  if (!['pending', 'active', 'inactive', 'rejected'].includes(status)) return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });
  if (u.id === req.user.id && status !== 'active') {
    return res.status(400).json({ error: 'ไม่สามารถระงับหรือลบบัญชีของตนเองได้' });
  }
  const approvedAt = status === 'active' ? auth.now() : null;
  await db.prepare('UPDATE users SET status=?, approved_at=COALESCE(?, approved_at) WHERE id=?').run(status, approvedAt, id);
  if (status !== 'active') await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  res.json({ ok: true, message: `อัปเดตสถานะ${u.full_name} เป็น ${status} เรียบร้อย` });
});

// แก้ไขข้อมูลสมาชิกโดย admin (ทุกฟิลด์ รวมรูปถ่ายและลายเซ็น)
router.put('/staff/:id', auth.requireAdmin, uploadStaff.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'signature', maxCount: 1 },
]), uploadErrorHandler, async (req, res) => {
  const id = Number(req.params.id);
  const u = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'ไม่พบเจ้าหน้าที่' });
  const b = req.body || {};
  const firstName = (b.first_name !== undefined ? String(b.first_name).trim() : u.first_name || '');
  const lastName = (b.last_name !== undefined ? String(b.last_name).trim() : u.last_name || '');
  const fullName = (firstName + ' ' + lastName).trim() || u.full_name;
  const newCitizenId = (b.citizen_id !== undefined ? String(b.citizen_id).trim() : u.citizen_id || '');

  // รูปถ่ายและลายเซ็นใหม่ (ตั้งชื่อตามเลขบัตรประชาชน) — ส่งค่า '' เพื่อลบรูปเดิม
  let newPhoto = u.photo, newSignature = u.signature;
  if (b.photo !== undefined && String(b.photo) === '') newPhoto = null;
  if (b.signature !== undefined && String(b.signature) === '') newSignature = null;
  if (req.files && req.files.photo && req.files.photo[0]) {
    newPhoto = renameAsCitizen(req.files.photo[0].filename, newCitizenId, 'photo');
  }
  if (req.files && req.files.signature && req.files.signature[0]) {
    newSignature = renameAsCitizen(req.files.signature[0].filename, newCitizenId, 'signature');
  }

  await db.prepare(`UPDATE users SET
    title=?, full_name=?, first_name=?, last_name=?, nickname=?, blood_type=?, academic_rank=?,
    highest_education=?, birth_date=?, citizen_id=?, position=?, workplace=?, phone=?, email=?,
    staff_no=?, telegram_token=?, telegram_chat_id=?, role=?, can_approve=?, photo=?, signature=?, school_code=?
    WHERE id=?`)
    .run(
      (b.title !== undefined ? String(b.title).trim() : u.title) || 'นาย/นาง/นางสาว',
      fullName, firstName, lastName,
      (b.nickname !== undefined ? String(b.nickname).trim() : u.nickname || ''),
      (b.blood_type !== undefined ? String(b.blood_type).trim() : u.blood_type || ''),
      (b.academic_rank !== undefined ? String(b.academic_rank).trim() : u.academic_rank || ''),
      (b.highest_education !== undefined ? String(b.highest_education).trim() : u.highest_education || ''),
      (b.birth_date !== undefined ? (String(b.birth_date).trim() || null) : u.birth_date || null),
      newCitizenId,
      (b.position !== undefined ? String(b.position).trim() : u.position || ''),
      (b.workplace !== undefined ? String(b.workplace).trim() : u.workplace || ''),
      (b.phone !== undefined ? String(b.phone).trim() : u.phone || ''),
      (b.email !== undefined ? String(b.email).trim() : u.email || ''),
      (b.staff_no !== undefined ? String(b.staff_no).trim() : u.staff_no || ''),
      (b.telegram_token !== undefined ? String(b.telegram_token).trim() : u.telegram_token || ''),
      (b.telegram_chat_id !== undefined ? String(b.telegram_chat_id).trim() : u.telegram_chat_id || ''),
      (b.role !== undefined ? b.role : u.role),
      (b.can_approve !== undefined ? (b.can_approve ? 1 : 0) : u.can_approve),
      newPhoto, newSignature,
      (b.user_group === 'school' || u.user_group === 'school') ? ((b.workplace || u.workplace || '').match(/^d{8}/) || [])[0] || u.school_code || '' : (u.school_code || ''),
      id);

  // ลบไฟล์เก่าหลังอัปเดตสำเร็จ (เฉพาะเมื่อเปลี่ยนไฟล์ใหม่)
  if (newPhoto !== u.photo && u.photo) deleteUploadedFile(u.photo);
  if (newSignature !== u.signature && u.signature) deleteUploadedFile(u.signature);
  if (newCitizenId !== u.citizen_id) {
    // ถ้าเปลี่ยนเลขบัตร ไฟล์เก่าที่อ้างอิงเลขบัตรเดิมถูกลบทิ้ง (ไฟล์ใหม่ถูกตั้งชื่อตามเลขบัตรใหม่แล้ว)
    if (u.photo && u.photo === newPhoto) deleteUploadedFile(u.photo);
    if (u.signature && u.signature === newSignature) deleteUploadedFile(u.signature);
  }

  const fresh = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ ok: true, user: await auth.publicUser(fresh), message: 'แก้ไขข้อมูลเจ้าหน้าที่เรียบร้อย' });
});

router.put('/staff/:id/role', auth.requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const u = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'ไม่พบเจ้าหน้าที่' });
  const { role } = req.body || {};
  if (!auth.ROLES[role]) return res.status(400).json({ error: 'บทบาทไม่ถูกต้อง' });
  if (u.id === req.user.id && role !== 'admin') return res.status(400).json({ error: 'ไม่สามารถถอดสิทธิ์ผู้ดูแลของตนเองได้' });
  await db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  res.json({ ok: true, user: await auth.publicUser(await db.prepare('SELECT * FROM users WHERE id = ?').get(id)), message: `ปรับสิทธิ์เป็น "${auth.roleLabel(role)}" เรียบร้อย` });
});

// กำหนด/ถอนสิทธิ์การอนุมัติให้ผู้ใช้ (admin เป็นผู้กำหนด)
router.put('/staff/:id/approve', auth.requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const u = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'ไม่พบเจ้าหน้าที่' });
  const { can_approve } = req.body || {};
  const val = can_approve ? 1 : 0;
  await db.prepare('UPDATE users SET can_approve = ? WHERE id = ?').run(val, id);
  res.json({ ok: true, user: await auth.publicUser(await db.prepare('SELECT * FROM users WHERE id = ?').get(id)),
    message: val ? `ให้สิทธิ์ ${u.full_name} อนุมัติคำขอตามบทบาทแล้ว` : `ถอนสิทธิ์การอนุมัติของ ${u.full_name} แล้ว` });
});

// ตั้งค่าจำนวนขั้นการอนุมัติของแต่ละระบบ
router.get('/settings/approvals', auth.requireAdmin, async (req, res) => {
  const settings = {};
  for (const s of require('../lib/approvals').APPROVAL_SYSTEMS) {
    const row = await db.prepare('SELECT value FROM settings WHERE `key` = ?').get('approval_' + s);
    settings['approval_' + s] = row ? parseInt(row.value, 10) : 1;
  }
  res.json({ settings });
});

router.put('/settings/approvals', auth.requireAdmin, async (req, res) => {
  const b = req.body || {};
  const keys = ['approval_vehicle', 'approval_room', 'approval_travel', 'approval_leave'];
  for (const k of keys) {
    if (b[k] !== undefined) {
      const n = Math.min(3, Math.max(1, parseInt(b[k], 10) || 1));
      await db.prepare('INSERT INTO settings (`key`, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)').run(k, String(n));
    }
  }
  res.json({ ok: true, message: 'บันทึกการตั้งค่าการอนุมัติเรียบร้อย' });
});

// เจ้าหน้าที่การลา 3 ลำดับ
router.get('/settings/leave-approvers', auth.requireAdmin, async (req, res) => {
  const row = await db.prepare("SELECT value FROM settings WHERE `key` = 'leave_approvers'").get();
  let obj = {};
  try { obj = JSON.parse(row ? row.value : '{}'); } catch (e) { /* ignore */ }
  const result = { 1: Array.isArray(obj['1']) ? obj['1'] : [], 2: Array.isArray(obj['2']) ? obj['2'] : [], 3: Array.isArray(obj['3']) ? obj['3'] : [] };
  res.json({ approvers: result });
});

router.put('/settings/leave-approvers', auth.requireAdmin, async (req, res) => {
  const b = req.body || {};
  const data = {};
  for (const lvl of [1, 2, 3]) {
    data[lvl] = Array.isArray(b[lvl]) ? b[lvl].map(Number).filter((n) => n > 0) : [];
  }
  await db.prepare("INSERT INTO settings (`key`, value) VALUES ('leave_approvers', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)").run(JSON.stringify(data));
  res.json({ ok: true, message: 'บันทึกเจ้าหน้าที่การลาเรียบร้อย' });
});

// === ตั้งค่าผู้อนุมัติขั้นต้นตามกลุ่มงาน ===
router.get('/settings/leave-group-approvers', auth.requireAdmin, async (req, res) => {
  const row = await db.prepare("SELECT value FROM settings WHERE `key` = 'leave_group_approvers'").get();
  let obj = {};
  try { obj = JSON.parse(row ? row.value : '{}'); } catch (e) { /* ignore */ }
  res.json({ groupApprovers: obj });
});

router.put('/settings/leave-group-approvers', auth.requireAdmin, async (req, res) => {
  const b = req.body || {};
  // b = { "กลุ่มอำนวยการ": 7, "กลุ่มส่งเสริม...": 2, ... }
  const data = {};
  for (const [group, userId] of Object.entries(b)) {
    if (group && userId) data[group] = Number(userId);
  }
  await db.prepare("INSERT INTO settings (`key`, value) VALUES ('leave_group_approvers', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)").run(JSON.stringify(data));
  res.json({ ok: true, message: 'บันทึกการตั้งค่าผู้อนุมัติขั้นต้นตามกลุ่มงานเรียบร้อย' });
});

// === ตั้งค่าผู้อนุมัติ (level 2 → level 3) ===
router.get('/settings/leave-final-approvers', auth.requireAdmin, async (req, res) => {
  const row = await db.prepare("SELECT value FROM settings WHERE `key` = 'leave_final_approvers'").get();
  let obj = {};
  try { obj = JSON.parse(row ? row.value : '{}'); } catch (e) { /* ignore */ }
  res.json({ finalApprovers: obj });
});

router.put('/settings/leave-final-approvers', auth.requireAdmin, async (req, res) => {
  const b = req.body || {};
  // b = { "7": 5, "2": 1, ... } → level2 userId → level3 userId
  const data = {};
  for (const [lvl2Uid, lvl3Uid] of Object.entries(b)) {
    if (lvl2Uid && lvl3Uid) data[String(lvl2Uid)] = Number(lvl3Uid);
  }
  await db.prepare("INSERT INTO settings (`key`, value) VALUES ('leave_final_approvers', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)").run(JSON.stringify(data));
  res.json({ ok: true, message: 'บันทึกการตั้งค่าผู้อนุมัติเรียบร้อย' });
});

// === ตั้งค่าผู้อนุมัติไปราชการ (per-person: supervisor + approver) ===
router.get('/settings/travel-approvers', auth.requireAdmin, async (req, res) => {
  const row = await db.prepare("SELECT value FROM settings WHERE `key` = 'travel_approvers'").get();
  let obj = {};
  try { obj = JSON.parse(row ? row.value : '{}'); } catch (e) { /* ignore */ }
  res.json({ travelApprovers: obj });
});

router.put('/settings/travel-approvers', auth.requireAdmin, async (req, res) => {
  const b = req.body || {};
  // b = { "1": { supervisor: 3, approver: 5 }, "2": { supervisor: 4, approver: 7 }, ... }
  const data = {};
  for (const [uid, val] of Object.entries(b)) {
    if (uid && val) data[String(uid)] = { supervisor: Number(val.supervisor) || 0, approver: Number(val.approver) || 0 };
  }
  await db.prepare("INSERT INTO settings (`key`, value) VALUES ('travel_approvers', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)").run(JSON.stringify(data));
  res.json({ ok: true, message: 'บันทึกการตั้งค่าผู้อนุมัติไปราชการเรียบร้อย' });
});

// === ตั้งค่าผู้อนุมัติไปราชการของเจ้าหน้าที่สถานศึกษา (3 ขั้น: ผู้ตรวจสอบ → ผู้บังคับบัญชาขั้นต้น → ผู้อนุมัติ — ทุกขั้นเป็นเจ้าหน้าที่ สพป.แพร่ เขต 2) ===
router.get('/settings/travel-approvers-school', auth.requireAdmin, async (req, res) => {
  const row = await db.prepare("SELECT value FROM settings WHERE `key` = 'travel_approvers_school'").get();
  let obj = {};
  try { obj = JSON.parse(row ? row.value : '{}'); } catch (e) { /* ignore */ }
  res.json({ travelApprovers: obj });
});

router.put('/settings/travel-approvers-school', auth.requireAdmin, async (req, res) => {
  const b = req.body || {};
  // b = { "21": { reviewer: 3, supervisor: 4, approver: 5 }, ... }
  const data = {};
  for (const [uid, val] of Object.entries(b)) {
    if (uid && val) data[String(uid)] = { reviewer: Number(val.reviewer) || 0, supervisor: Number(val.supervisor) || 0, approver: Number(val.approver) || 0 };
  }
  await db.prepare("INSERT INTO settings (`key`, value) VALUES ('travel_approvers_school', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)").run(JSON.stringify(data));
  res.json({ ok: true, message: 'บันทึกการตั้งค่าผู้อนุมัติไปราชการของสถานศึกษาเรียบร้อย' });
});

router.post('/staff/:id/reset-password', auth.requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const u = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'ไม่พบเจ้าหน้าที่' });
  const { new_password, username } = req.body || {};
  // แก้ไขชื่อผู้ใช้ (Username) พร้อมกัน — ตรวจรูปแบบเดียวกับตอนสมัคร + กันชื่อซ้ำ
  if (username !== undefined) {
    const uname = String(username || '').trim();
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(uname)) {
      return res.status(400).json({ error: 'ชื่อผู้ใช้ต้องเป็นตัวอักษร ตัวเลข หรือ _ . - และมีความยาว 3-30 ตัวอักษร' });
    }
    const dup = await db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(uname, id);
    if (dup) return res.status(400).json({ error: 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว กรุณาเลือกชื่ออื่น' });
    await db.prepare('UPDATE users SET username = ? WHERE id = ?').run(uname, id);
  }
  const pwErr = auth.validatePasswordStrength(new_password || '');
  if (pwErr) return res.status(400).json({ error: pwErr });
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(new_password), id);
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  res.json({ ok: true, message: 'รีเซ็ตรหัสผ่านเรียบร้อย ผู้ใช้ต้องเข้าสู่ระบบใหม่' });
});

router.delete('/staff/:id', auth.requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const u = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'ไม่พบเจ้าหน้าที่' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'ไม่สามารถลบบัญชีของตนเองได้' });
  const adminCount = (await db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND status='active'").get()).c;
  if (u.role === 'admin' && adminCount <= 1) return res.status(400).json({ error: 'ไม่สามารถลบผู้ดูแลระบบคนสุดท้ายได้' });
  if (u.photo) deleteUploadedFile(u.photo);
  if (u.signature) deleteUploadedFile(u.signature);
  // ลบข้อมูลลูกทุกตารางที่อ้างถึงผู้ใช้ + เอาออกจากสายอนุมัติใน settings (กันค่าค้างที่ส่วนอื่นไปอ่าน)
  await cleanup.purgeUser(id);
  await db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true, message: 'ลบเจ้าหน้าที่เรียบร้อย' });
});

// ---------- สถิติสำหรับหน้าแรก (admin และผู้มีสิทธิ์อนุมัติ) ----------
router.get('/dashboard', async (req, res) => {
  if (!req.user || req.user.status !== 'active') return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' });
  if (req.user.role !== 'admin' && !req.user.can_approve) {
    return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบหรือผู้มีสิทธิ์อนุมัติเท่านั้น' });
  }

  const pendingVehicle = (await db.prepare("SELECT COUNT(*) c FROM vehicle_bookings WHERE status='pending'").get()).c;
  const pendingRoom = (await db.prepare("SELECT COUNT(*) c FROM room_bookings WHERE status='pending'").get()).c;
  const pendingTravel = (await db.prepare("SELECT COUNT(*) c FROM travel_requests WHERE status='pending'").get()).c;
  const pendingLeave = (await db.prepare("SELECT COUNT(*) c FROM leave_requests WHERE status='pending'").get()).c;
  const pendingUsers = (await db.prepare("SELECT COUNT(*) c FROM users WHERE status='pending'").get()).c;
  const today = simdate.todayISO();
  const todayClockedIn = (await db.prepare(`SELECT COUNT(DISTINCT t.user_id) c FROM time_records t
    JOIN users u ON u.id = t.user_id
    WHERE t.date = ? AND t.clock_in IS NOT NULL AND u.status = 'active'`).get(today)).c;
  res.json({
    pendingVehicle, pendingRoom, pendingTravel, pendingLeave, pendingUsers,
    pendingTotal: pendingVehicle + pendingRoom + pendingTravel + pendingLeave,
    todayClockedIn,
  });
});


// ---------- ทะเบียนหนังสือรับ (document recipients) ----------
router.get('/document-recipients/:docId', auth.requireAuth, async (req, res) => {
  const docId = Number(req.params.docId);
  const recipients = await db.prepare(`
    SELECT dr.*, u.title, u.full_name, u.position, u.workplace,
      CASE WHEN dr.as_school IS NOT NULL AND dr.as_school != ''
        THEN (SELECT (s.code || ' ' || s.name) FROM schools s WHERE s.code = dr.as_school LIMIT 1)
        ELSE NULL END AS as_school_label
    FROM document_recipients dr
    LEFT JOIN users u ON u.id = dr.user_id
    WHERE dr.document_id = ?
    ORDER BY u.full_name
  `).all(docId);
  res.json({ recipients });
});

// GET /my-incoming - get incoming documents for current user
router.get('/my-incoming', auth.requireAuth, async (req, res) => {
  const q = req.query.q || '';
  let sql = 'SELECT d.*, u.full_name AS creator_name, dr.is_read, dr.read_at, dr.as_school FROM document_recipients dr JOIN documents d ON d.id = dr.document_id LEFT JOIN users u ON u.id = d.created_by WHERE dr.user_id = ?';
  const params = [req.user.id];
  // ผู้ใช้กลุ่มสถานศึกษา: แยกตามสถานศึกษาที่กำลังใช้งาน (as_school) — ของใครของมัน
  if (req.user.user_group === 'school' && (req.user.current_school || '').trim()) {
    const activeCode = String(req.user.current_school).trim().split(' ')[0];
    if (/^\d{7,8}$/.test(activeCode)) {
      sql += " AND (dr.as_school = ? OR (dr.as_school IS NULL AND NOT (d.to_org GLOB '[0-9]*' AND d.to_org NOT LIKE ?)))";
      params.push(activeCode, activeCode + '%');
    }
  }
  const yc1 = docYearClause(req.query.year); if (yc1) { sql += yc1.clause; params.push(yc1.arg); }
  const wgi = (req.query.workgroup || '').trim(); if (wgi) { sql += ' AND d.workgroup = ?'; params.push(wgi); }
  if (q) {
    sql += ' AND (d.title LIKE ? OR d.doc_no LIKE ? OR d.from_org LIKE ? OR d.to_org LIKE ?)';
    const like = '%' + q + '%';
    params.push(like, like, like, like);
  }
  sql += ' ORDER BY d.id DESC';
  const docs = await db.prepare(sql).all(...params);
  res.json({ documents: docs });
});

// PUT /document-recipients/:docId/read - mark document as read
router.put('/document-recipients/:docId/read', auth.requireAuth, async (req, res) => {
  const docId = Number(req.params.docId);
  const userId = req.user.id;
  // แยกตามสถานศึกษาที่กำลังใช้งาน — อ่านที่โรงเรียนไหน อ่านเฉพาะแถวของโรงเรียนนั้น (ของใครของมัน)
  const activeCode = String(req.user.current_school || '').trim().split(' ')[0];
  if (req.user.user_group === 'school' && /^\d{7,8}$/.test(activeCode)) {
    await db.prepare(`
      UPDATE document_recipients SET is_read = 1, read_at = NOW()
      WHERE document_id = ? AND user_id = ? AND (as_school = ? OR as_school IS NULL OR as_school = '')
    `).run(docId, userId, activeCode);
  } else {
    await db.prepare(`
      UPDATE document_recipients SET is_read = 1, read_at = NOW()
      WHERE document_id = ? AND user_id = ?
    `).run(docId, userId);
  }
  res.json({ ok: true });
});

// GET /my-incoming-registered - get documents registered as incoming by current user
router.get('/my-incoming-registered', auth.requireAuth, async (req, res) => {
  const userId = req.user.id;
  const isSchool = req.user.user_group === 'school';
  const schoolCode = req.user.school_code || '';
  const q = req.query.q || '';
  // แทปทะเบียนหนังสือรับ: แสดงเฉพาะรายการที่ลงทะเบียนรับหนังสือแล้วเท่านั้น (is_registered = 1)
  let sql = `SELECT d.*, u.full_name AS creator_name FROM documents d LEFT JOIN users u ON u.id = d.created_by WHERE (d.doc_type = 'incoming' OR (d.doc_type = 'outgoing' AND d.sender_type = 'school')) AND d.is_registered = 1`;
  const params = [];
  if (isSchool) { sql += " AND (d.school_code = ? OR d.to_org LIKE ?)"; params.push(schoolCode, "%" + schoolCode + "%"); }
  else {
    // เฉพาะสารบัญเขต (หรือ admin) จะเห็นหนังสือที่สถานศึกษาส่งมา (sender_type = 'school')
    const isOfficeClerk = !!await db.prepare("SELECT id FROM document_staff WHERE staff_type = 'office' AND user_id = ?").get(userId) || req.user.role === 'admin';
    if (isOfficeClerk) sql += " AND (d.school_code = '54020000' OR d.sender_type = 'school')";
    else sql += " AND d.school_code = '54020000'";
  }
  const yc2 = docYearClause(req.query.year); if (yc2) { sql += yc2.clause; params.push(yc2.arg); }
  // ตัวกรองกลุ่มปฏิบัติ (เช่น กลุ่มส่งเสริมการศึกษาทางไกล เทคโนโลยีสารสนเทศฯ)
  const wg1 = (req.query.workgroup || '').trim();
  if (wg1) { sql += ' AND d.workgroup = ?'; params.push(wg1); }
  if (q) { sql += ` AND (d.title LIKE ? OR d.doc_no LIKE ? OR d.from_org LIKE ? OR d.to_org LIKE ?)`; const like = '%' + q + '%'; params.push(like, like, like, like); }
  sql += ' ORDER BY d.id DESC';
  const docs = await db.prepare(sql).all(...params);
  res.json({ documents: docs });
});

// GET /my-outgoing-registered - get all outgoing registered documents
router.get('/my-outgoing-registered', auth.requireAuth, async (req, res) => {
  const userId = req.user.id;
  const isSchool = req.user.user_group === 'school';
  const q = req.query.q || '';
  const schoolCode = req.user.school_code || '';
  let sql = "SELECT d.*, u.full_name AS creator_name FROM documents d LEFT JOIN users u ON u.id = d.created_by WHERE d.doc_type = 'outgoing' AND d.sender_type = 'registered'";
  const params = [];
  if (isSchool) { sql += " AND d.school_code = ?"; params.push(schoolCode || ''); }
  else { sql += " AND d.school_code = '54020000'"; }
  const yc3 = docYearClause(req.query.year); if (yc3) { sql += yc3.clause; params.push(yc3.arg); }
  // ตัวกรองกลุ่มปฏิบัติ
  const wg2 = (req.query.workgroup || '').trim();
  if (wg2) { sql += ' AND d.workgroup = ?'; params.push(wg2); }
  if (q) { sql += ' AND (d.title LIKE ? OR d.doc_no LIKE ? OR d.from_org LIKE ? OR d.to_org LIKE ?)'; const like = '%' + q + '%'; params.push(like, like, like, like); }
  sql += ' ORDER BY d.id DESC';
  const docs = await db.prepare(sql).all(...params);
  res.json({ documents: docs });
});
// GET /my-orders - get order documents (คำสั่ง)
router.get('/my-orders', auth.requireAuth, async (req, res) => {
  const q = req.query.q || '';
  let sql = `SELECT d.*, u.full_name AS creator_name FROM documents d LEFT JOIN users u ON u.id = d.created_by WHERE d.doc_type = 'order'`;
  const params = [];
  const yc4 = docYearClause(req.query.year); if (yc4) { sql += yc4.clause; params.push(yc4.arg); }
  const wg4 = (req.query.workgroup || '').trim(); if (wg4) { sql += ' AND d.workgroup = ?'; params.push(wg4); }
  if (q) { sql += ` AND (d.title LIKE ? OR d.doc_no LIKE ? OR d.from_org LIKE ? OR d.to_org LIKE ? OR d.owner_group LIKE ? OR d.order_registrar LIKE ?)`; const like = '%' + q + '%'; params.push(like, like, like, like, like, like); }
  sql += ' ORDER BY d.id DESC';
  const docs = await db.prepare(sql).all(...params);
  res.json({ documents: docs });
});
// GET /my-certificates - get certificate documents (หนังสือรับรอง)
router.get('/my-certificates', auth.requireAuth, async (req, res) => {
  const q = req.query.q || '';
  let sql = `SELECT d.*, u.full_name AS creator_name FROM documents d LEFT JOIN users u ON u.id = d.created_by WHERE d.doc_type = 'certificate'`;
  const params = [];
  const yc5 = docYearClause(req.query.year); if (yc5) { sql += yc5.clause; params.push(yc5.arg); }
  const wg5 = (req.query.workgroup || '').trim(); if (wg5) { sql += ' AND d.workgroup = ?'; params.push(wg5); }
  if (q) { sql += ` AND (d.title LIKE ? OR d.doc_no LIKE ? OR d.from_org LIKE ? OR d.to_org LIKE ?)`; const like = '%' + q + '%'; params.push(like, like, like, like); }
  sql += ' ORDER BY d.id DESC';
  const docs = await db.prepare(sql).all(...params);
  res.json({ documents: docs });
});
// GET /my-honors - get honor documents (เกียรติบัตร) — แนบชื่อผู้ลงนามมาด้วย
router.get('/my-honors', auth.requireAuth, async (req, res) => {
  const q = req.query.q || '';
  let sql = `SELECT d.*, u.full_name AS creator_name,
    (SELECT TRIM(COALESCE(s.title || ' ', '') || s.full_name) FROM users s WHERE s.id = TRIM(d.honor_signer)) AS signer_name
    FROM documents d LEFT JOIN users u ON u.id = d.created_by WHERE d.doc_type = 'honor'`;
  const params = [];
  const yc6 = docYearClause(req.query.year); if (yc6) { sql += yc6.clause; params.push(yc6.arg); }
  const wg6 = (req.query.workgroup || '').trim(); if (wg6) { sql += ' AND d.workgroup = ?'; params.push(wg6); }
  if (q) { sql += ` AND (d.title LIKE ? OR d.doc_no LIKE ? OR d.person_name LIKE ?)`; const like = '%' + q + '%'; params.push(like, like, like); }
  sql += ' ORDER BY d.id DESC';
  const docs = await db.prepare(sql).all(...params);
  res.json({ documents: docs });
});

router.get('/workplace-groups', auth.requireAuth, async (req, res) => {
  const groups = await db.prepare("SELECT DISTINCT workplace FROM users WHERE workplace IS NOT NULL AND workplace != '' AND user_group = 'office' ORDER BY workplace").all();
  res.json({ groups: groups.map(g => g.workplace) });
});

// ห่อ router เพื่อจับ error จาก async handler (Express 4 ไม่ catch promise เอง)
const { wrapRouter } = require('../lib/async-route');
module.exports = wrapRouter(router);
