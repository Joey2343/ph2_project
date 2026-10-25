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
const staffSort = require('../lib/staff-sort');
const telegram = require('../lib/telegram');
const { schoolCodeOf } = require('../lib/school-code');
const uploadDocDynamic = createDynamicUpload('documents');

const router = express.Router();
// Get school prefix for file paths
// ⚠️ ใช้ schoolCodeOf() ไม่ใช่ req.user.school_code ตรง ๆ
//    เพราะบัญชีสถานศึกษาที่ school_code ว่าง (บั๊กเดิม) จะได้ path ไม่มีรหัสโรงเรียน
function getSchoolPrefix(req) {
  const code = schoolCodeOf(req.user);
  if (code) return code + '/';
  return '';
}

/**
 * เงื่อนไข "เอกสารของโรงเรียนนี้" (alias ตาราง documents คือ d)
 *
 * ทำไมต้องมี helper
 * ────────────────
 * เอกสารฝั่งสถานศึกษาเป็นของ "โรงเรียน" ไม่ใช่ของบัญชีเจ้าหน้าที่สารบัญ
 * เปลี่ยนตัวเจ้าหน้าที่แล้ว คนใหม่ต้องเห็นงานเดิมทั้งหมด
 *
 * เงื่อนไข 2 ชั้น
 *   ① d.school_code = รหัสโรงเรียน  → แถวที่บันทึกหลังแก้บั๊ก (ปกติ)
 *   ② school_code ว่าง + ผู้สร้างเป็นคนของโรงเรียนนี้ → แถวเก่าก่อน migrate เติม
 *      (created_by ไม่มี FK → แถวยังอยู่แม้ลบบัญชีผู้สร้าง)
 *
 * ไม่รู้รหัสโรงเรียนเลย (school_code/workplace/current_school ว่างหมด)
 *   → เห็นเฉพาะที่ตัวเองสร้าง (ปลอดภัยกว่าเห็นของโรงเรียนอื่น)
 *
 * @returns {{clause: string, params: any[]}} ต่อท้ายด้วย " AND (clause) "
 */
async function schoolDocScope(user) {
  const code = schoolCodeOf(user);
  if (!code) return { clause: 'd.created_by = ?', params: [user.id] };

  const mates = await db
    .prepare("SELECT id FROM users WHERE user_group = 'school' AND (school_code = ? OR workplace LIKE ? OR current_school LIKE ?)")
    .all(code, code + '%', code + '%');
  const ids = mates.map((r) => Number(r.id)).filter((n) => n > 0);
  if (!ids.length) return { clause: 'd.school_code = ?', params: [code] };

  return {
    clause:
      "d.school_code = ? OR ((d.school_code IS NULL OR d.school_code = '') AND d.created_by IN (" +
      ids.map(() => '?').join(',') + '))',
    params: [code, ...ids],
  };
}

/**
 * ผู้ใช้คนนี้เป็น "เจ้าหน้าที่สารบัญเขต" ไหม (admin นับด้วย)
 *
 * ใช้ตัดสินว่าใครเห็นงานหนังสือราชการ "ของทั้งสำนักงานเขต"
 * ไม่ใช่ของบัญชีผู้ใช้ — เปลี่ยนตัวเจ้าหน้าที่แล้วงานเดิมต้องอยู่ครบ
 */
async function isOfficeDocStaff(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const row = await db
    .prepare("SELECT id FROM document_staff WHERE staff_type = 'office' AND user_id = ?")
    .get(user.id);
  return !!row;
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
  const schoolCode = schoolCodeOf(req.user);
  if (type === 'honor') {
    res.json({ next: await nextHonorDocNo() });
  } else if (type === 'certificate') {
    res.json({ next: await nextCertificateDocNo() });
  } else if (type === 'order') {
    res.json({ next: await nextOrderDocNo() });
  } else if (type === 'honorees') {
    // รายชื่อสำหรับ autocomplete ในฟอร์มเกียรติบัตร: คำนำหน้า+ชื่อ-นามสกุล และชื่อสถานศึกษา
    // ⚠️ เดิมไม่มี ORDER BY เลย → ลำดับที่โชว์ตาม id โดยไม่ตั้งใจ
    //    แก้เป็นเรียงตามกฎหน้าเจ้าหน้าที่ ให้ตรงกับที่เห็นในรายการ
    var staff = staffSort.sortStaff(await db.prepare("SELECT title, full_name, first_name, last_name, position, workplace, staff_no, user_group, school_code, current_school FROM users WHERE status = 'active' AND full_name != ''").all(), 'office');
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
  // row = สถานะจริงหลังบันทึก ให้หน้าเว็บอัปเดตแถวนี้ทันที
  res.json({ ok: true, row: { id: Number(req.params.id), cert_status: 'เสร็จแล้ว' } });
});

async function isCertStaffUser(userId) {
  return !!await db.prepare("SELECT id FROM document_staff WHERE staff_type = 'certificate' AND user_id = ?").get(userId);
}

/**
 * ส่งกลับหนังสือจากสถานศึกษา เพื่อให้ไปแก้ไข
 *
 * ทำไมต้องมี
 * ──────────
 * โรงเรียนส่งหนังสือเข้ามาที่ สพป. แล้วข้อมูลผิด (เลขหนังสือ/ชื่อเรื่อง/ปลายทาง)
 * เดิมต้องโทรหรือไปบอกเพื่อให้โรงเรียนแก้ แล้วส่งใหม่อีกรอบ
 * → ตอนนี้ สพป. กดส่งกลับพร้อมระบุสาเหตุ → โรงเรียนเห็นในรายการหนังสือส่งของตัวเองทันที
 *
 * เงื่อนไข
 *   · เฉพาะหนังสือที่ "ส่งมาจากสถานศึกษา" (sender_type = 'school') เท่านั้น
 *     หนังสือของ สพป. เองไม่ต้องส่งกลับตัวเอง
 *   · ผู้กดต้องเป็น admin หรือเจ้าหน้าที่สารบัญเขต
 *   · ต้องกรอกสาเหตุเสมอ (บังคับ) — ไม่งั้นโรงเรียนไม่รู้จะแก้อะไร
 *   · ส่งกลับซ้ำได้ ถ้ายังไม่แก้ (ทับสาเหตุเดิม + เวลาใหม่)
 *
 * หลังส่งกลับ หนังสือยังอยู่ในรายการของ สพป. (เปลี่ยนสถานะเป็น 'returned')
 * คนไม่ได้ทำงานที่ สพป. จะเห็นสถานะว่า "รอให้โรงเรียนแก้ไข"
 */
router.put('/documents/:id/return', auth.requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบหนังสือ' });

  if (String(row.sender_type || '') !== 'school') {
    return res.status(400).json({ error: 'ส่งกลับได้เฉพาะหนังสือที่ส่งมาจากสถานศึกษาเท่านั้น' });
  }
  const isOfficeClerk = await isOfficeDocStaff(req.user);
  if (!isOfficeClerk) return res.status(403).json({ error: 'เฉพาะเจ้าหน้าที่สารบัญเขตเท่านั้นที่ส่งกลับหนังสือได้' });

  const note = ((req.body || {}).note || '').trim();
  if (!note) return res.status(400).json({ error: 'กรุณากรอกสาเหตุที่ส่งกลับเพื่อแก้ไข' });

  /*
   * กันข้อความที่เสียรูปแบบ — เคยเจอจริงในระบบจริง (ซ้ำ 2 ครั้ง)
   *
   * อาการ: ผู้ใช้พิมพ์/วางสาเหตุภาษาไทย → บันทึกเป็น "????????" (1 ตัวต่อ 1 อักษร)
   *   ทั้งช่อง "เรื่อง" "หมายเหตุ" ของหนังสือเดียวกันกลับมาสมบูรณ์
   *   ทดสอบที่เครื่องผมผ่าน → ไม่ใช่ปัญหา browser หรือ JSON body
   *   วัดแล้วว่า server ได้รับค่าเป็น ? อยู่แล้ว → ต้นเหตุอยู่ที่ชั้นใดชั้นหนึ่ง
   *   ระหว่าง server → ฐานข้อมูล (เช่น คอลัมน์มี charset ต่างจาก utf8mb4)
   *
   *   ⚠️ เดิมไม่มีการตรวจ → บันทึกของเสียลงฐานเงียบ ๆ
   *      โรงเรียนเห็นแต่เครื่องหมายคำถาม และไม่มีใครรู้ว่าต้นเหตุอยู่ที่ไหน
   *      เจอซ้ำ 2 ครั้งจนต้องย้อนกลับไปตรวจทีละชั้น
   *
   * เงื่อนไขปฏิเสธ: ข้อความ "ไม่มีอักษรไทย/ตัวเลข/อักษรอังกฤษเลย" และมี ? ตั้งแต่ 3 ตัวขึ้นไป
   *   ไม่กวนกับการใช้งานจริง เช่น "ขอแก้เลขที่ 2" หรือหมายเหตุเป็นภาษาอังกฤษ
   */
  const hasRealContent = /[\u0E00-\u0E7F0-9A-Za-z]/.test(note);
  const qRun = (note.match(/\?{3,}/g) || []).length;
  if (!hasRealContent && qRun > 0) {
    console.warn('[documents/return] ข้อความส่งกลับเป็น ? ทั้งหมด — ข้อความที่ server ได้รับคือ:', JSON.stringify(note));
    return res.status(400).json({
      // เขียนตามที่วัดได้จริง: server ได้รับข้อความนี้มาแล้ว และมันไม่มีอักษรจริงเลย
      error: 'ข้อความที่ส่งมามีแต่เครื่องหมาย (?) ไม่มีตัวอักษรจริงเลย\n'
        + 'ระบบจึงยังไม่บันทึก เพื่อไม่ให้โรงเรียนเห็นแต่เครื่องหมายคำถาม\n\n'
        + 'ลองวิธีใดวิธีหนึ่ง:\n'
        + '· คัดลอกข้อความภาษาไทยจากที่อื่นมาวาง (Ctrl+V) แทนการพิมพ์\n'
        + '· ถ้ายังเป็น ? เช่นเดิม แจ้งผู้ดูแลระบบให้ตรวจการตั้งค่า charset ของฐานข้อมูล',
      debug_note: note,
    });
  }

  const returnedAt = auth.now();
  await db.prepare(`UPDATE documents SET status = 'returned', revision_note = ?, returned_at = ?, returned_by = ? WHERE id = ?`)
    .run(note, returnedAt, req.user.id, id);

  /*
   * Read-back verification — อ่านค่าที่บันทึกจริงกลับมาเทียบกับที่ส่งไป
   * ถ้าไม่ตรงกัน = ฐานข้อมูลแปลงค่าเสีย (เช่น charset ของคอลัมน์ไม่รองรับไทย)
   * คืน error พร้อมค่าที่อ่านกลับมาได้ เพื่อวินิจฉัยได้ทันที ไม่ต้องเดา
   */
  const verify = await db.prepare('SELECT revision_note FROM documents WHERE id = ?').get(id);
  if (verify && String(verify.revision_note || '') !== note) {
    console.error('[documents/return] revision_note อ่านกลับไม่ตรงกับที่เขียน — '
      + 'เขียน=' + JSON.stringify(note) + ' อ่านกลับ=' + JSON.stringify(verify.revision_note));
    return res.status(500).json({
      error: 'ระบบบันทึกข้อความแล้วแต่อ่านกลับไม่ตรงกับที่ส่ง — '
        + 'ฐานข้อมูลอาจแปลงอักขระภาษาไทยเป็นเครื่องหมาย (?) กรุณาแจ้งผู้ดูแลระบบ',
      debug_sent: note,
      debug_readback: verify.revision_note,
    });
  }

  // แจ้งผู้ส่ง (เจ้าหน้าที่โรงเรียน) ทาง Telegram ให้รู้ว่าต้องแก้อะไร
  await telegram.notifyDocumentReturned(id, req.user.full_name, note);

  // row = สถานะจริงหลังบันทึก (อ่านจากฐานข้อมูลจริง ไม่ใช่ค่าที่ส่งไป) → หน้าเว็บอัปเดตเฉพาะแถวนี้
  res.json({
    ok: true,
    row: {
      id,
      status: 'returned',
      revision_note: verify ? verify.revision_note : note,
      returned_at: returnedAt,
      returned_by: req.user.id,
    },
    message: 'ส่งกลับเพื่อแก้ไขแล้ว — โรงเรียนจะได้รับแจ้งเตือน',
  });
});

/**
 * โรงเรียนแก้หนังสือที่ถูกส่งกลับมาแล้วส่งอีกครั้ง → ล้างสถานะ "ส่งกลับ"
 *
 * เรียกจาก PUT /documents/:id เมื่อผู้แก้ไขเป็นคนส่งหนังสือนั้นเอง
 * ต้องล้างให้ครบ ไม่งั้นหนังสือจะค้างสถานะ 'returned' และโรงเรียนแก้ไปเรื่อย ๆ
 *   และ สพป. จะเห็นสถานะ "รอให้โรงเรียนแก้ไข" ทั้งที่โรงเรียนแก้แล้ว
 * รวมถึงล้างธง "อ่านแล้ว" ของผู้รับฝั่ง สพป. ด้วย ให้เห็นเป็นหนังสือใหม่ที่ยังไม่ได้อ่าน
 */
async function clearReturnedState(docId, senderUserId) {
  const row = await db.prepare('SELECT status, created_by FROM documents WHERE id = ?').get(docId);
  if (!row || row.status !== 'returned') return false;
  // ป้องกันคนอื่นในโรงเรียนเดียวกันแก้ทับโดยไม่ตั้งใจ — ให้ผู้ส่งเดิมเป็นคนเคลียร์สถานะ
  if (senderUserId && row.created_by && Number(row.created_by) !== Number(senderUserId)) return false;
  await db.prepare(`UPDATE documents SET status = 'received', revision_note = NULL, returned_at = NULL, returned_by = NULL WHERE id = ?`)
    .run(docId);
  await db.prepare('UPDATE document_recipients SET is_read = 0, read_at = NULL WHERE document_id = ?').run(docId);
  return true;
}

// ---------- เจ้าหน้าที่หนังสือรับรอง (admin only) ----------
router.get('/cert-staff', auth.requireAdmin, async (req, res) => {
  // เรียงตามกฎหน้าเจ้าหน้าที่ (ต้องมี position/workplace/staff_no ใน SELECT)
  const rows = await db.prepare(`SELECT ds.id, ds.user_id, u.full_name, u.first_name, u.last_name,
           u.title, u.position, u.workplace, u.staff_no, u.user_group, u.school_code, u.current_school
    FROM document_staff ds JOIN users u ON u.id = ds.user_id WHERE ds.staff_type = 'certificate'`).all();
  res.json({ certStaff: staffSort.sortStaff(rows, 'office') });
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

/* ---------- หนังสือลับ (ผู้รับต้องใช้รหัสจากผู้ส่งก่อนเปิด) ---------- */

/** เรื่องที่แสดงแทนหนังสือลับที่ยังไม่ปลดล็อก */
const SECRET_TITLE = '🔒 หนังสือลับ — ต้องใช้รหัสจากผู้ส่งเพื่อเปิด';
/** รหัสสั้นที่สุดที่ยอมรับ */
const SECRET_MIN_LEN = 4;

/**
 * เตรียมแถวหนังสือก่อนส่งให้หน้าเว็บ
 *
 * ⚠️ secret_code_hash ห้ามหลุดออก API เด็ดขาด → ตัดทิ้งทุกครั้ง
 * ⚠️ หนังสือลับที่ยังไม่ปลดล็อก → ปิดบังเรื่อง/ข้อความ/หมายเหตุ/ไฟล์ แล้วตั้ง locked = true
 *    หน้าเว็บใช้ locked ตัดสินใจว่าจะเปิดรายละเอียดหรือถามรหัสก่อน
 */
async function prepareDocRows(rows, req) {
  const list = Array.isArray(rows) ? rows : (rows ? [rows] : []);
  const secretIds = list.filter((r) => r && Number(r.is_secret)).map((r) => Number(r.id));
  let unlocked = new Set();
  if (secretIds.length && req.sessionToken) {
    const ph = secretIds.map(() => '?').join(',');
    const got = await db
      .prepare(`SELECT document_id FROM document_unlocks WHERE session_token = ? AND document_id IN (${ph})`)
      .all(req.sessionToken, ...secretIds);
    unlocked = new Set(got.map((r) => Number(r.document_id)));
  }
  const isAdmin = !!(req.user && req.user.role === 'admin');
  const uid = req.user ? Number(req.user.id) : 0;
  const out = list.map((r) => {
    if (!r) return r;
    const row = Object.assign({}, r);
    delete row.secret_code_hash;
    if (!Number(row.is_secret)) {
      row.locked = false;
      return row;
    }
    // ผู้ส่ง (เจ้าของหนังสือ) และ admin เปิดได้เลย — คนอื่นต้องปลดล็อกด้วยรหัสในเซสชันนี้
    row.locked = !(isAdmin || Number(row.created_by) === uid || unlocked.has(Number(row.id)));
    if (row.locked) {
      row.title = SECRET_TITLE;
      row.body_text = '';
      row.note = '';
      row.file = null;
      row.file_names = '';
      row.honor_saved_file = '';
    }
    return row;
  });
  return Array.isArray(rows) ? out : out[0];
}

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
      sql += ' AND (d.sender_type IS NULL OR d.sender_type != ?)';
      args.push('registered');
      if (req.user.user_group === 'school') {
        // โรงเรียน: หนังสือส่งเป็นของ "โรงเรียน" ไม่ใช่ของบัญชีเจ้าหน้าที่สารบัญ
        // (เดิมกรอง d.created_by = ตัวเอง → เปลี่ยนเจ้าหน้าที่แล้วหนังสือส่งเดิมหายหมด)
        // ยังคงแยกชัดเจนระหว่างโรงเรียน เช่น 54020036 ≠ 54020055
        const scope = await schoolDocScope(req.user);
        sql += ' AND (' + scope.clause + ')';
        args.push(...scope.params);
      } else if (await isOfficeDocStaff(req.user)) {
        /*
         * สำนักงานเขต: "หนังสือส่ง" ของสารบัญเขต = ของสำนักงาน ไม่ใช่ของบัญชี
         * ─────────────────────────────────────────────────────────────────
         * เดิมกรอง d.created_by = ตัวเอง → ลบเจ้าหน้าที่สารบัญเขตคนเก่า
         * แล้วเพิ่มคนใหม่ หนังสือส่งที่คนเก่าส่งไว้หายหมดจากสายตา
         * (เจอจริง 25 ต.ค. 2569 · สพป. 54020000 เปลี่ยนตัวสารบัญเขต)
         *
         * ใช้เงื่อนไขเดียวกับทะเบียนหนังสือส่งฝั่งสำนักงานเขต:
         *   ไม่มีรหัสโรงเรียน (ของโรงเรียนเป็นของโรงเรียน) + ผู้สร้างไม่ใช่ฝั่งสถานศึกษา
         * เจ้าหน้าที่ทั่วไปที่ไม่ได้เป็นสารบัญเขต ยังเห็นเฉพาะหนังสือที่ตัวเองสร้าง
         */
        sql += " AND (d.school_code IS NULL OR d.school_code = '') AND COALESCE(u.user_group, 'office') != 'school'";
      } else {
        sql += ' AND d.created_by = ?';
        args.push(req.user.id);
      }
    }
  }
  if (q) { sql += ' AND (d.title LIKE ? OR d.doc_no LIKE ? OR d.from_org LIKE ? OR d.to_org LIKE ?)'; const p = `%${q}%`; args.push(p, p, p, p); }
  const wg0 = (req.query.workgroup || '').trim(); if (wg0) { sql += ' AND d.workgroup = ?'; args.push(wg0); }
  const yc0 = docYearClause(year); if (yc0) { sql += yc0.clause; args.push(yc0.arg); }
  sql += ' ORDER BY d.id DESC';
  res.json({ documents: await prepareDocRows(await db.prepare(sql).all(...args), req) });
});

/**
 * POST /documents/:id/unlock — ปลดล็อกหนังสือลับด้วยรหัสที่ผู้ส่งกำหนด
 *
 * ปลดล็อกผูกกับ session (คุกกี้ sid) → เปิดใหม่ในเบราว์เซอร์อื่นต้องกรอกรหัสอีกครั้ง
 * คืน row ข้อมูลเต็มเพื่อให้หน้าเว็บอัปเดตแถวนั้นได้ทันที (ไม่ต้องโหลดตารางใหม่)
 */
router.post('/documents/:id/unlock', auth.requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'รหัสหนังสือไม่ถูกต้อง' });
  const row = await db.prepare('SELECT id, is_secret, secret_code_hash FROM documents WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบหนังสือฉบับนี้' });
  if (!Number(row.is_secret) || !row.secret_code_hash) {
    return res.json({ ok: true, message: 'หนังสือนี้ไม่ได้ตั้งรหัสไว้', row: await getDocRow(id, req) });
  }
  const code = String((req.body && req.body.code) || '').trim();
  if (!code) return res.status(400).json({ error: 'กรุณากรอกรหัสเปิดหนังสือ' });
  const ok = await auth.verifyPassword(code, row.secret_code_hash);
  if (!ok) return res.status(403).json({ error: 'รหัสไม่ถูกต้อง กรุณาตรวจสอบรหัสจากผู้ส่งหนังสือ' });
  if (req.sessionToken) {
    await db
      .prepare('INSERT IGNORE INTO document_unlocks (session_token, document_id) VALUES (?, ?)')
      .run(req.sessionToken, id);
  }
  res.json({ ok: true, message: 'ปลดล็อกหนังสือแล้ว', row: await getDocRow(id, req) });
});

/** อ่านหนังสือหนึ่งฉบับแบบเต็ม (ใช้ตอบหลังปลดล็อก) — ตัด hash และปิดบังตามสิทธิ์เหมือนรายการ */
async function getDocRow(id, req) {
  const row = await db
    .prepare('SELECT d.*, u.full_name AS creator_name FROM documents d LEFT JOIN users u ON u.id = d.created_by WHERE d.id = ?')
    .get(id);
  if (!row) return null;
  return await prepareDocRows(row, req);
}

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

// ---------- สถานศึกษาปลายทางของหนังสือ (ถาวร ไม่ผูกกับบัญชีผู้ใช้) ----------

/**
 * แปลงค่า recipient_schools ที่ส่งมาจากฟอร์ม → รหัสโรงเรียน (ไม่ซ้ำ)
 *
 * รับได้ทั้ง array ของรหัส, array ของ JSON string, และ string เดียว
 * (ฟอร์มเดิมส่ง JSON.stringify ต่อหนึ่งค่า และบางสาขาส่งซ้ำหลายค่า)
 */
function parseRecipientSchoolCodes(raw) {
  const out = [];
  const push = (v) => {
    const code = String(v == null ? '' : v).split(' ')[0].trim();
    if (/^\d{7,8}$/.test(code) && out.indexOf(code) === -1) out.push(code);
  };
  const list = Array.isArray(raw) ? raw : [raw];
  for (const item of list) {
    if (item == null) continue;
    let parsed = null;
    try { parsed = JSON.parse(item); } catch (e) { parsed = null; }
    if (Array.isArray(parsed)) parsed.forEach(push);
    else String(item).split(',').forEach(push);
  }
  return out;
}

/**
 * บันทึก "โรงเรียนปลายทาง" ลงตารางถาวร (document_school_targets)
 *
 * ⚠️ ห้ามพึ่ง document_recipients อย่างเดียว — แถวนั้นผูกกับผู้ใช้ (ON DELETE CASCADE)
 *    ลบเจ้าหน้าที่สารบัญออก = หลักฐานว่าโรงเรียนไหนได้รับหนังสือหายทั้งหมด
 *    แล้วสารบัญคนใหม่จะไม่เห็นหนังสือเก่า (เจอจริง 25 ต.ค. 2569)
 */
async function recordSchoolTargets(docId, codes) {
  if (!docId || !codes || !codes.length) return;
  const ins = db.prepare(
    'INSERT IGNORE INTO document_school_targets (document_id, school_code) VALUES (?,?)'
  );
  for (const code of codes) {
    try { await ins.run(docId, code); } catch (e) { /* ไม่กระทบการบันทึกหนังสือ */ }
  }
}

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
  // ⚠️ ใช้ schoolCodeOf() ไม่ใช่ req.user.school_code ตรง ๆ — บัญชีสถานศึกษาที่ school_code
  //    ว่าง (บั๊ก regex เดิม) จะทำให้หนังสือทุกฉบับถูกบันทึกโดยไม่มีรหัสโรงเรียน
  //    → ทะเบียนหนังสือส่งของโรงเรียนหายทั้งกระดานเมื่อเปลี่ยนเจ้าหน้าที่สารบัญ
  const docSchoolCode = schoolCodeOf(req.user);
  const isRegisteredVal = Number(b.is_registered) ? 1 : 0;
  // หนังสือลับ: ต้องมีรหัสอย่างน้อย 4 ตัวอักษร — เก็บเฉพาะ hash (bcrypt) ไม่เก็บรหัสจริง
  const isSecretVal = Number(b.is_secret) ? 1 : 0;
  const secretCode = String(b.secret_code || '').trim();
  if (isSecretVal && secretCode.length < SECRET_MIN_LEN) {
    return res.status(400).json({ error: 'รหัสเปิดหนังสือต้องมีอย่างน้อย ' + SECRET_MIN_LEN + ' ตัวอักษร' });
  }
  const secretHash = isSecretVal ? await auth.hashPassword(secretCode) : null;
  const info = await db.prepare(`INSERT INTO documents (doc_type, doc_no, reg_no, title, from_org, to_org, date, letter_date, category, file, file_names, note, created_by, body_text, priority, workgroup, sender_type, school_code, person_name, person_school, honor_signer, honor_template, honor_saved_file, is_registered, requester, cert_position, officer, owner_group, order_registrar, is_secret, secret_code_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.doc_type, (b.doc_no || '').trim(), autoRegNo, String(b.title).trim(),
    (b.from_org || '').trim(), (b.to_org || '').trim(), (b.date || simdate.todayISO()), (b.letter_date || '').trim(),
    (b.category || '').trim(), file, (b.file_names || '').trim(), (b.note || '').trim(), req.user.id,
    (b.body_text || '').trim(), (b.priority || 'normal').trim(), (b.workgroup || '').trim(), (b.sender_type || 'office').trim(), docSchoolCode,
    (b.person_name || '').trim(), (b.person_school || '').trim(), (b.honor_signer || '').trim(), (b.honor_template || '').trim(), (b.honor_saved_file || '').trim(), isRegisteredVal,
    (b.requester || '').trim(), (b.cert_position || '').trim(), (b.officer || '').trim(), (b.owner_group || '').trim(), (b.order_registrar || '').trim(),
    isSecretVal, secretHash);
  const docId = info.lastInsertRowid;
  // Add recipients based on to_org
  const toOrg = (b.to_org || '').trim();
  const senderType = (b.sender_type || 'office').trim();
  if (senderType === 'office' && toOrg) {
    const insertRecip = db.prepare('INSERT INTO document_recipients (document_id, user_id) VALUES (?, ?)');
    if (toOrg.startsWith('ทุกคน')) {
      // ส่งถึงเจ้าหน้าที่ฝั่งสำนักงานทุกคน
      const officeStaff = await db.prepare("SELECT id FROM users WHERE user_group != 'school' AND status = 'active'").all();
      for (const s of officeStaff) { await insertRecip.run(docId, s.id) };
    } else if (toOrg.startsWith('กลุ่ม:')) {
      // ส่งถึงเจ้าหน้าที่ในกลุ่มที่เลือก
      const groups = toOrg.replace('กลุ่ม:', '').split(',').map(g => g.trim()).filter(Boolean);
      if (groups.length) {
        const placeholders = groups.map(() => '?').join(',');
        const staff = await db.prepare(`SELECT id FROM users WHERE user_group != 'school' AND status = 'active' AND workplace IN (${placeholders})`).all(...groups);
        for (const s of staff) { await insertRecip.run(docId, s.id) };
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
    // โรงเรียนส่งหนังสือมา สพป. → ผู้รับคือเจ้าหน้าที่สารบัญเขตเท่านั้น
    // (ถ้ายังไม่ได้ตั้งสารบัญเขต ให้ admin เป็นผู้รับชั่วคราว กันหนังสือหาย)
    const insertRecip = db.prepare('INSERT IGNORE INTO document_recipients (document_id, user_id) VALUES (?, ?)');
    let clerks = (await db.prepare("SELECT user_id FROM document_staff WHERE staff_type = 'office'").all()).map(r => r.user_id);
    if (!clerks.length && req.user.role === 'admin') clerks = [req.user.id];
    for (const s of clerks) { await insertRecip.run(docId, s) };
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
  /*
   * บันทึกโรงเรียนปลายทางลงตารางถาวร — ต้องทำ "ก่อน" ตอบกลับ
   * ให้ครอบทุกเส้นทางที่ส่งถึงโรงเรียน: สพป.→โรงเรียน (เลือกเอง/ทุกโรงเรียน/กลุ่ม)
   * และโรงเรียน→โรงเรียน (เดียว/หลายโรงเรียน/กลุ่ม)
   */
  try {
    const targetCodes = new Set();
    if (b.recipient_schools) {
      for (const code of parseRecipientSchoolCodes(b.recipient_schools)) targetCodes.add(code);
    }
    if (senderType === 'office' || senderType === 'school_to_school') {
      // ฟอร์มเก่าที่พิมพ์ "รหัส โรงเรียน" ลงช่องถึงตรง ๆ (ไม่มี recipient_schools)
      for (const code of String(toOrg).match(/\d{7,8}/g) || []) targetCodes.add(code);
    }
    await recordSchoolTargets(docId, [...targetCodes]);
  } catch (e) { /* ไม่กระทบการบันทึกหนังสือ */ }
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
  /*
   * ⚠️ ไฟล์เดิมต้องถูกลบ "หลัง" UPDATE สำเร็จเท่านั้น
   *
   *   เดิมลบตรงนี้เลย → ถ้า UPDATE ล้มเหลว (ข้อมูลไม่ผ่าน constraint / คอลัมน์สั้นเกิน /
   *   การเชื่อมต่อฐานขาด) ไฟล์ถูกทิ้งไปแล้ว แต่ฐานข้อมูลยังชี้ชื่อไฟล์เดิม
   *   → ไฟล์แนบหายถาวรทั้งที่ผู้ใช้เห็นข้อความ "บันทึกไม่สำเร็จ"
   *
   *   เก็บค่าไว้ในตัวแปร แล้วไปลบหลัง UPDATE (แบบเดียวกับยานพาหนะ/โรงเรียน)
   */
  let fileToDelete = null;
  if (req.files && req.files.length) {
    var fPrefixUp = getSchoolPrefix(req);
    var newFiles = req.files.map(f => fPrefixUp + 'documents/' + f.filename);
    // Flow ลงทะเบียน/ปั้มรับ (is_registered=1): เก็บไฟล์เดิมไว้ครบ แล้วเพิ่มไฟล์ใหม่ต่อท้าย — ไม่ลบ/ไม่ทับไฟล์เดิม
    if (Number(b.is_registered) === 1 && row.file) {
      var oldFiles = [];
      try { var arr = JSON.parse(row.file); oldFiles = Array.isArray(arr) ? arr : [row.file]; } catch (e) { oldFiles = [row.file]; }
      /*
       * ⚠️ ห้ามใช้ unshift ต่อทีละไฟล์
       *    unshift ดันของเดิมไปหน้าเสมอ → ลำดับไฟล์เดิมกลับด้าน
       *    เช่น เดิม [a, b] กลายเป็น [b, a, ใหม่]
       *
       *    เดิมไม่มีผลกระทบเพราะทุกไฟล์แสดงชื่อจาก path ตัวเอง
       *    แต่ documents.file_names ผูกชื่อกับไฟล์ด้วยลำดับ index
       *    ถ้าลำดับเพี้ยน ชื่อจะไปตกกับไฟล์ผิดตัว
       */
      file = JSON.stringify(oldFiles.concat(newFiles.filter(function(f) { return !oldFiles.includes(f); })));
    } else {
      file = newFiles.length === 1 ? newFiles[0] : JSON.stringify(newFiles);
      fileToDelete = row.file;
    }
  } else if (req.file) {
    file = getSchoolPrefix(req) + 'documents/' + req.file.filename;
    fileToDelete = row.file;
  }
  // ไฟล์เกียรติบัตรที่ถูกแทนที่ก็ต้องลบของเดิม (ไม่ให้ค้างเป็นขยะบนดิสก์)
  const oldHonorFile = row.honor_saved_file || '';
  const newHonorFile = (b.honor_saved_file ?? (row.honor_saved_file || '')).trim();
  await db.prepare(`UPDATE documents SET doc_type=?, doc_no=?, title=?, from_org=?, to_org=?, date=?, letter_date=?, category=?, file=?, file_names=?, note=?, body_text=?, priority=?, person_name=?, person_school=?, honor_signer=?, honor_template=?, honor_saved_file=?, reg_no=?, workgroup=?, is_registered=?, requester=?, cert_position=?, officer=?, owner_group=?, order_registrar=? WHERE id=?`)
    .run(b.doc_type || row.doc_type, (b.doc_no ?? (row.doc_no || '')).trim(), String(b.title || row.title).trim(),
      (b.from_org ?? (row.from_org || '')).trim(), (b.to_org ?? (row.to_org || '')).trim(),
      b.date || row.date || simdate.todayISO(), (b.letter_date ?? (row.letter_date || '')).trim(), (b.category ?? (row.category || '')).trim(),
      file, (b.file_names ?? (row.file_names || '')).toString().trim(), (b.note ?? (row.note || '')).trim(),
      (b.body_text ?? (row.body_text || '')).trim(), (b.priority ?? (row.priority || 'normal')).trim(),
      (b.person_name ?? (row.person_name || '')).trim(), (b.person_school ?? (row.person_school || '')).trim(),
      (b.honor_signer ?? (row.honor_signer || '')).trim(), (b.honor_template ?? (row.honor_template || '')).trim(), newHonorFile,
      (b.reg_no ?? row.reg_no ?? '').toString().trim(), (b.workgroup ?? row.workgroup ?? '').toString().trim(),
      (b.is_registered !== undefined ? (Number(b.is_registered) ? 1 : 0) : (row.is_registered ? 1 : 0)),
      (b.requester ?? (row.requester || '')).trim(), (b.cert_position ?? (row.cert_position || '')).trim(), (b.officer ?? (row.officer || '')).trim(), (b.owner_group ?? (row.owner_group || '')).trim(), (b.order_registrar ?? (row.order_registrar || '')).trim(), id);

  // ลบไฟล์เดิมได้ก็ต่อเมื่อ UPDATE ข้างบนสำเร็จแล้ว (ถ้าถึงบรรทัดนี้ = สำเร็จ)
  if (fileToDelete) deleteUploadedFile(fileToDelete);
  /*
   * ไฟล์เกียรติบัตร: ลบของเดิมเฉพาะเมื่อ "ถูกแทนที่ด้วยไฟล์ใหม่"
   * ⚠️ ไม่ลบเมื่อค่าถูกส่งมาเป็น '' เพราะหนังสือลับจะถูกปิดข้อมูล (honor_saved_file = '')
   *    ตอนอ่านจาก API — ถ้าลบตาม ไฟล์ของเจ้าของจะหายไปโดยที่ไม่มีใครสั่ง
   *    (ไฟล์ที่ค้างแบบนี้หาได้ด้วย `npm run uploads:find`)
   */
  if (oldHonorFile && newHonorFile && oldHonorFile !== newHonorFile) deleteUploadedFile(oldHonorFile);

  /*
   * โรงเรียนแก้หนังสือที่ถูกส่งกลับมาแล้วส่งอีกครั้ง → ล้างสถานะ "ส่งกลับ"
   *
   * ⚠️ ต้องล้างธง "อ่านแล้ว" ของผู้รับฝั่ง สพป. ด้วย
   *   ไม่งั้น สพป. จะเห็นเป็นหนังสือที่อ่านแล้ว (ไม่มีจุดต่างจากฉบับเก่าที่ส่งกลับไป)
   *   แล้วหนังสือฉบับที่แก้แล้วจะหลุดสายตาจนกว่าจะมีคนกดเปิดดูอีกครั้ง
   */
  const wasReturned = await clearReturnedState(id, req.user.id);

  // row = สถานะจริงหลังบันทึก → ให้หน้าเว็บอัปเดตเฉพาะแถวนี้ ไม่ต้องโหลดทั้งตาราง
  res.json({
    ok: true,
    row: wasReturned
      ? { id, status: 'received', revision_note: '', returned_at: '', returned_by: null }
      : null,
    message: wasReturned
      ? 'แก้ไขหนังสือเรียบร้อย — ส่งกลับไปที่ สพป. เรียบร้อย'
      : 'แก้ไขหนังสือเรียบร้อย',
  });
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
  const schoolRow = await db.prepare('SELECT school_code FROM document_staff WHERE staff_type = ? AND user_id = ? AND school_code = ?').get('school', userId, schoolCodeOf(req.user));
  res.json({
    isOfficeDocStaff: !!isOffice,
    schoolCode: schoolRow ? schoolRow.school_code : null
  });
});

/*
 * เลขหนังสือของสถานศึกษา — เก็บตาม "โรงเรียน" (school_doc_prefix)
 *
 * ⚠️ เดิมเก็บใน document_staff.doc_prefix ซึ่งเป็นแถวของ "บัญชีผู้ใช้"
 *    พอลบเจ้าหน้าที่สารบัญออกจากระบบ เลขที่ตั้งไว้หายไปด้วย
 *    แล้วคนใหม่ที่รับช่วงต่อต้องตั้งเลขใหม่ทั้งที่โรงเรียนเดิม
 *    (เจอจริง 25 ต.ค. 2569 — โรงเรียน 54020071)
 *
 *    ตั้งแต่ตอนนี้ค่าอยู่กับโรงเรียน → เปลี่ยนคนกี่ครั้งก็ยังเป็นเลขเดิม
 *    ยังเขียนสำเนาลง document_staff.doc_prefix ด้วย เพื่อให้โค้ด/รายงานเดิมอ่านได้
 */
router.get('/document-staff/school-prefix', auth.requireAuth, async (req, res) => {
  const userId = req.user.id;
  const myCode = schoolCodeOf(req.user);
  if (!myCode) return res.json({ doc_prefix: '', school_code: '' });
  // ต้องเป็นเจ้าหน้าที่สารบัญของสถานศึกษานี้เท่านั้น (เหมือนเดิม)
  const isClerk = await db
    .prepare('SELECT id FROM document_staff WHERE staff_type = ? AND user_id = ? AND school_code = ?')
    .get('school', userId, myCode);
  if (!isClerk) return res.json({ doc_prefix: '', school_code: myCode });

  let row = await db.prepare('SELECT doc_prefix FROM school_doc_prefix WHERE school_code = ?').get(myCode);
  if (!row) {
    // ค่าเดิมเคยอยู่กับบัญชีผู้ใช้ — ย้ายมาเก็บตามโรงเรียนเมื่อเปิดใช้ครั้งแรก
    const legacy = await db
      .prepare(
        "SELECT doc_prefix FROM document_staff WHERE staff_type = 'school' AND school_code = ? AND doc_prefix IS NOT NULL AND doc_prefix <> '' ORDER BY id DESC LIMIT 1"
      )
      .get(myCode);
    if (legacy && legacy.doc_prefix) {
      await db
        .prepare('INSERT IGNORE INTO school_doc_prefix (school_code, doc_prefix) VALUES (?, ?)')
        .run(myCode, legacy.doc_prefix);
      row = { doc_prefix: legacy.doc_prefix };
    }
  }
  res.json({ doc_prefix: row ? row.doc_prefix || '' : '', school_code: myCode });
});

router.put('/document-staff/school-prefix', auth.requireAuth, async (req, res) => {
  const userId = req.user.id;
  const myCode = schoolCodeOf(req.user);
  const { doc_prefix } = req.body || {};
  if (!myCode) return res.status(400).json({ error: 'ไม่พบสถานศึกษาของผู้ใช้' });
  const row = await db
    .prepare('SELECT id FROM document_staff WHERE staff_type = ? AND user_id = ? AND school_code = ?')
    .get('school', userId, myCode);
  if (!row) return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขเลขหนังสือของสถานศึกษานี้' });
  const val = String(doc_prefix || '');
  await db
    .prepare(
      'INSERT INTO school_doc_prefix (school_code, doc_prefix) VALUES (?, ?) ON DUPLICATE KEY UPDATE doc_prefix = VALUES(doc_prefix)'
    )
    .run(myCode, val);
  // สำเนาไว้ที่แถวเจ้าหน้าที่ (คอลัมน์เดิม) — ไม่ใช่แหล่งข้อมูลหลักแล้ว
  await db
    .prepare("UPDATE document_staff SET doc_prefix = ? WHERE staff_type = 'school' AND school_code = ?")
    .run(val, myCode);
  res.json({ message: 'บันทึกเลขหนังสือเรียบร้อย', doc_prefix: val, school_code: myCode });
});

// ---------- เจ้าหน้าที่หนังสือราชการ (admin only) ----------

// ดึงรายชื่อเจ้าหน้าที่หนังสือราชการทั้งหมด
router.get('/document-staff', auth.requireAdmin, async (req, res) => {
  // ⚠️ SELECT ต้องมีครบ: position, workplace, staff_no (ฝั่ง สพป.)
  //    และ school_code (ฝั่งสถานศึกษา) ไม่งั้น sortStaff เรียงไม่ได้
  const officeStaff = await db.prepare(`
    SELECT ds.id, ds.user_id, u.full_name, u.first_name, u.last_name, u.title,
           u.position, u.workplace, u.staff_no, u.user_group, u.school_code, u.current_school
    FROM document_staff ds
    JOIN users u ON u.id = ds.user_id
    WHERE ds.staff_type = 'office'
  `).all();
  const schoolStaff = await db.prepare(`
    SELECT ds.id, ds.user_id, ds.school_code, u.full_name, u.first_name, u.last_name,
           u.title, u.position, u.workplace, u.staff_no, u.user_group, u.current_school,
           s.name AS school_name
    FROM document_staff ds
    JOIN users u ON u.id = ds.user_id
    LEFT JOIN schools s ON s.code = ds.school_code
    WHERE ds.staff_type = 'school'
  `).all();
  res.json({
    officeStaff: staffSort.sortStaff(officeStaff, 'office'),
    schoolStaff: staffSort.sortStaff(schoolStaff, 'school'),
  });
});

// เพิ่มเจ้าหน้าที่ สพป. (หลายคนพร้อมกัน)
router.post('/document-staff/office', auth.requireAdmin, async (req, res) => {
  const ids = req.body.userIds || [];
  if (!ids.length) return res.status(400).json({ error: 'กรุณาเลือกเจ้าหน้าที่' });
  const ins = db.prepare('INSERT IGNORE INTO document_staff (staff_type, user_id) VALUES (?, ?)');
  // สารบัญคนใหม่ต้องเห็นหนังสือที่สถานศึกษาส่งมาทั้งหมดที่เคยมี (sync ผู้รับย้อนหลัง)
  // ⚠️ document_recipients ไม่มี UNIQUE(document_id,user_id) → INSERT IGNORE กันซ้ำไม่ได้
  const syncRecip = db.prepare(`
    INSERT INTO document_recipients (document_id, user_id)
    SELECT d.id, ? FROM documents d
    WHERE d.sender_type = 'school'
      AND NOT EXISTS (SELECT 1 FROM document_recipients dr WHERE dr.document_id = d.id AND dr.user_id = ?)
  `);
  let added = 0;
  for (const uid of ids) { const r = await ins.run('office', Number(uid)); if (r.changes) { added++; await syncRecip.run(Number(uid), Number(uid)); } };
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

/*
 * บันทึกเจ้าหน้าที่สารบัญสถานศึกษา (replace ทั้งหมดของโรงเรียนนั้น)
 *
 * ⚠️ กุญแจสำคัญ: "หนังสือของโรงเรียน" ต้องผูกกับโรงเรียน ไม่ใช่บัญชีผู้ใช้
 *   document_recipients ผูกกับ users (ON DELETE CASCADE) → ลบคนเก่าออก แถวผู้รับหายหมด
 *   ถ้า sync ย้อนหลังใช้แค่ to_org/ผู้รับเดิม สารบัญคนใหม่จะไม่เห็นหนังสือเก่า
 *   (เจอจริง 25 ต.ค. 2569: โรงเรียน 54020071 เปลี่ยนตัวสารบัญ แล้วหนังสือรับหายทั้งกอง)
 *
 *   จึง sync จาก document_school_targets (ตารางถาวรที่บันทึกตอนส่งหนังสือ) เป็นหลัก
 *   และคงเส้นทางเดิม (to_org / ผู้รับที่ยังเหลือ) ไว้เป็น fallback สำหรับหนังสือเก่า
 *
 * ⚠️ document_recipients ไม่มี UNIQUE(document_id, user_id)
 *   INSERT IGNORE จึงกันแถวซ้ำไม่ได้ → ต้องเช็ค NOT EXISTS เอง
 *   ไม่งั้นกดบันทึกซ้ำ = หนังสือโผล่ซ้ำในรายการรับ
 */
router.post('/document-staff/school', auth.requireAdmin, async (req, res) => {
  const school_code = String((req.body || {}).school_code || '').trim();
  if (!school_code) return res.status(400).json({ error: 'กรุณาเลือกสถานศึกษา' });
  const ids = (req.body.userIds || []).map(Number).filter((n) => !!n);
  const before = (await db.prepare("SELECT user_id FROM document_staff WHERE staff_type = 'school' AND school_code = ?").all(school_code)).map(r => r.user_id);
  await db.prepare('DELETE FROM document_staff WHERE staff_type = ? AND school_code = ?').run('school', school_code);
  const ins = db.prepare('INSERT INTO document_staff (staff_type, user_id, school_code) VALUES (?, ?, ?)');
  for (const uid of ids) { await ins.run('school', uid, school_code) };

  // 1) หนังสือที่ "ส่งถึงโรงเรียนนี้" ตามตารางถาวร — ครอบทั้ง สพป.→โรงเรียน และ โรงเรียน→โรงเรียน
  const syncFromTargets = db.prepare(`
    INSERT INTO document_recipients (document_id, user_id, as_school)
    SELECT t.document_id, ?, t.school_code
    FROM document_school_targets t
    WHERE t.school_code = ?
      AND NOT EXISTS (
        SELECT 1 FROM document_recipients dr
        WHERE dr.document_id = t.document_id AND dr.user_id = ?
      )
  `);
  // 2) หนังสือเก่าก่อนมีตารางถาวร — ใช้ to_org หรือผู้รับที่ยังเหลือเป็นหลักฐาน
  const syncLegacy = db.prepare(`
    INSERT INTO document_recipients (document_id, user_id, as_school)
    SELECT d.id, ?, ?
    FROM documents d
    WHERE d.sender_type IN ('office', 'school_to_school')
      AND (d.to_org LIKE ? OR EXISTS (
        SELECT 1 FROM document_recipients dr JOIN users u ON u.id = dr.user_id
        WHERE dr.document_id = d.id AND u.user_group = 'school'
          AND (u.school_code = ? OR u.workplace LIKE ?)
      ))
      AND NOT EXISTS (
        SELECT 1 FROM document_recipients dr2
        WHERE dr2.document_id = d.id AND dr2.user_id = ?
      )
  `);
  for (const uid of ids) {
    await syncFromTargets.run(uid, school_code, uid);
    await syncLegacy.run(uid, school_code, school_code + '%', school_code, school_code + '%', uid);
  }

  // 3) ผู้ที่ถูกปลดออกจากสารบัญของโรงเรียนนี้ → ถอดสิทธิ์รับ "เฉพาะหนังสือของโรงเรียนนี้"
  //    (ถ้ายังดูแลโรงเรียนอื่นอยู่ แถวของโรงเรียนนั้นมี as_school ต่างกัน จึงไม่ถูกแตะ)
  const delOld = db.prepare(`
    DELETE FROM document_recipients
    WHERE user_id = ?
      AND (
        as_school = ?
        OR (
          (as_school IS NULL OR as_school = '')
          AND (
            document_id IN (SELECT document_id FROM document_school_targets WHERE school_code = ?)
            OR document_id IN (
              SELECT id FROM documents
              WHERE sender_type IN ('office', 'school_to_school') AND to_org LIKE ?
            )
          )
        )
      )
  `);
  for (const oldUid of before) {
    // เดิมเป็น `return` → ออกจาก handler ก่อน res.json() ทำให้ค้าง และข้ามการถอดผู้รับคนที่เหลือ
    if (ids.indexOf(Number(oldUid)) >= 0) continue;
    await delOld.run(Number(oldUid), school_code, school_code, school_code + '%');
  }
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
             telegram_token, telegram_chat_id, photo, signature, role, can_approve, status, user_group, created_at, approved_at,
             school_code, current_school
             FROM users WHERE 1=1`;
  const args = [];
  if (status) { sql += ' AND status = ?'; args.push(status); }
  if (user_group) { sql += ' AND user_group = ?'; args.push(user_group); }
  if (q) { sql += ' AND (username LIKE ? OR full_name LIKE ? OR position LIKE ? OR workplace LIKE ? OR citizen_id LIKE ?)'; const p = `%${q}%`; args.push(p, p, p, p, p); }
  // เรียงตามกฎของหน้าเจ้าหน้าที่ (lib/staff-sort.js) ไม่ใช่แค่ staff_no
  //   ฝั่ง สพป.: ผู้บริหารฯ → กลุ่มงานตามลำดับที่กำหนด → หน่วยตรวจสอบภายใน
  //            ภายในกลุ่ม: ผู้อำนวยการ → รองผู้อำนวยการ → ผู้อำนวยการกลุ่ม/หน่วย → ตาม staff_no
  //   ฝั่งสถานศึกษา: รหัสสถานศึกษาน้อย→มาก แล้ว ผอ. → รอง ผอ. → ครู → เจ้าหน้าที่ธุรการ
  //
  // ⚠️ endpoint นี้ถูกใช้ทั้งหน้าเจ้าหน้าที่ และ dialog ตั้งค่าอีก 6 จุด
  //   (ผู้อนุมัติการลา · ผู้อนุมัติไปราชการ · ผู้แก้เวลา · สารบัญเขต · สารบัญสถานศึกษา · หนังสือรับรอง)
  //   ถ้าเรียงไม่ตรง รายการใน dropdown จะไม่ตรงกับที่เห็นในหน้าเจ้าหน้าที่
  //
  // ถ้าไม่ระบุ user_group (dialog ที่ต้องการทั้งสองฝั่งพร้อมกัน)
  //   → เรียงฝั่ง สพป. ก่อน แล้วฝั่งสถานศึกษา เพราะสองฝั่งใช้กฎเรียงต่างกัน
  //     (ฝั่งสถานศึกษาเรียงตามเลขรหัสสถานศึกษา)
  const rows = await db.prepare(sql).all(...args);
  let sorted;
  if (user_group === 'school' || user_group === 'office') {
    sorted = staffSort.sortStaff(rows, user_group);
  } else {
    const office = rows.filter((r) => (r.user_group || 'office') !== 'school');
    const school = rows.filter((r) => r.user_group === 'school');
    sorted = staffSort.sortStaff(office, 'office').concat(staffSort.sortStaff(school, 'school'));
  }
  // auth.publicUser เป็น async → คืน Promise
  // ถ้าใช้ rows.map(auth.publicUser) ตรง ๆ จะได้ Promise[] ซึ่ง JSON.stringify แปลงเป็น {}
  // ทำให้หน้าเว็บเห็นแถวเปล่า (ชื่อ-นามสกุล ตำแหน่ง กลุ่มงาน ว่างหมด)
  // จุดอื่นในไฟล์นี้ใช้ await ถูกต้องแล้ว เช่นบรรทัด 723, 803, 814
  res.json({ staff: await Promise.all(sorted.map(auth.publicUser)) });
});

/**
 * ดาวน์โหลดรายชื่อเจ้าหน้าที่เป็นไฟล์ Excel (.xlsx)
 *
 * รองรับตัวกรองชุดเดียวกับ GET /staff (status / q / user_group)
 * เพื่อให้ไฟล์ที่ได้ตรงกับรายการที่เห็นบนหน้าจออยู่เสมอ
 *
 * คอลัมน์ตามที่ขอ: ที่ · ชื่อ-นามสกุล · ชื่อเล่น · เลขบัตรประชาชน · ตำแหน่ง · วิทยฐานะ
 *              กลุ่มงาน · วุฒิการศึกษาสูงสุด · วัน/เดือน/ปี เกิด · อายุ · เบอร์โทร · อีเมล
 *
 * ⚠️ ดึงเฉพาะคอลัมน์ที่ต้องใช้เท่านั้น (ไม่เอา password_hash / telegram_token)
 * ⚠️ ลำดับแถวใช้ staffSort.sortStaff() ตัวเดียวกับที่หน้าเว็บเรียง
 *    ไม่งั้นคอลัมน์ "ที่" ในไฟล์จะไม่ตรงกับหมายเลขบนจอ
 */
router.get('/staff.xlsx', auth.requireAdmin, async (req, res) => {
  const { status, q, user_group } = req.query;
  let sql = `SELECT id, title, full_name, first_name, last_name, nickname, citizen_id,
             academic_rank, highest_education, birth_date, position, workplace,
             phone, email, staff_no, user_group, school_code, current_school
             FROM users WHERE 1=1`;
  const args = [];
  if (status) { sql += ' AND status = ?'; args.push(status); }
  if (user_group) { sql += ' AND user_group = ?'; args.push(user_group); }
  if (q) { sql += ' AND (username LIKE ? OR full_name LIKE ? OR position LIKE ? OR workplace LIKE ? OR citizen_id LIKE ?)'; const p = `%${q}%`; args.push(p, p, p, p, p); }
  const group = user_group === 'school' ? 'school' : 'office';
  const rows = staffSort.sortStaff(await db.prepare(sql).all(...args), group);

  const HEAD = ['ที่', 'ชื่อ-นามสกุล', 'ชื่อเล่น', 'เลขบัตรประชาชน', 'ตำแหน่ง', 'วิทยฐานะ',
    'กลุ่มงาน', 'วุฒิการศึกษาสูงสุด', 'วัน/เดือน/ปี เกิด', 'อายุ', 'เบอร์โทร', 'อีเมล'];
  const body = rows.map((u) => [
    u._seq,
    staffSort.personName(u),
    u.nickname || '',
    u.citizen_id || '',
    u.position || '',
    u.academic_rank || '',
    u.workplace || '',
    u.highest_education || '',
    staffSort.thaiBirthDate(u.birth_date),
    staffSort.ageFromBirth(u.birth_date),
    u.phone || '',
    u.email || '',
  ]);

  const title = group === 'school' ? 'รายชื่อเจ้าหน้าที่สถานศึกษา' : 'รายชื่อเจ้าหน้าที่ สพป.แพร่ เขต 2';
  const aoa = [
    [title, ...HEAD.slice(1).map(() => '')],
    [`จำนวน ${rows.length} คน`, ...HEAD.slice(1).map(() => '')],
    [],
    HEAD,
    ...body,
  ];

  const XLSX = require('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 5 }, { wch: 26 }, { wch: 16 }, { wch: 18 }, { wch: 30 },
    { wch: 16 }, { wch: 30 }, { wch: 24 }, { wch: 18 }, { wch: 6 }, { wch: 16 }, { wch: 26 }];
  // เลขบัตรประชาชน/เบอร์โทร ต้องคงเป็นข้อความ ไม่ให้ Excel แปลงเป็นตัวเลขหรือ scientific
  const bodyStart = 4;
  for (let r = bodyStart; r < bodyStart + body.length; r += 1) {
    for (const c of [3, 10]) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === 'n') cell.t = 's';
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'รายชื่อเจ้าหน้าที่');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="staff-${group}-${stamp}.xlsx"`);
  res.send(buf);
});

// Route สำหรับดึงรายชื่อเจ้าหน้าที่สพป. (ใช้ได้ทุก user สำหรับส่งไปรษณีย์)
router.get('/office-staff', auth.requireAuth, async (req, res) => {
  // ⚠️ เพิ่ม staff_no เข้ามาให้ sortStaff ใช้เรียงลำดับ
  //    (เดิม SELECT ไม่มี staff_no แต่ ORDER BY ใน SQL กลับอ้างถึงมันอยู่)
  // endpoint นี้ถูกใช้ 5 จุด: ผู้รับหนังสือ · บุคคลปฏิบัติ · ผู้ลงนามเกียรติบัตร
  //                       ผู้ลงทะเบียนทะเบียนคำสั่ง · เจ้าหน้าที่ผู้ปฏิบัติหนังสือรับรอง
  const rows = await db.prepare(`
    SELECT id, title, first_name, last_name, full_name, position, workplace,
           staff_no, user_group, school_code, current_school, status, signature
    FROM users
    WHERE user_group != 'school' AND status = 'active'
  `).all();
  res.json({ staff: staffSort.sortStaff(rows, 'office') });
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
      // ⚠️ เดิมเขียน /^d{8}/ (ขาด backslash) → ไม่มีวัน match → school_code หาย
      //    ตอนนี้ใช้ schoolCodeOf(): workplace ก่อน (ถ้าแอดมินย้ายโรงเรียน รหัสต้องตามไปด้วย)
      //    แล้วค่อย fallback เป็นรหัสเดิมของผู้ใช้
      (b.user_group === 'school' || u.user_group === 'school')
        ? (schoolCodeOf({ workplace: b.workplace || u.workplace }) || schoolCodeOf(u) || '')
        : (u.school_code || ''),
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
  // บทบาทของ สพป. กับของสถานศึกษาแยกกัน — ตั้งข้ามฝั่งไม่ได้
  // (เช่น ให้เจ้าหน้าที่สถานศึกษาเป็น "รองผู้อำนวยการ สพป.แพร่ เขต 2")
  if (!auth.isValidRoleFor(role, u.user_group)) {
    return res.status(400).json({
      error: u.user_group === 'school'
        ? `เจ้าหน้าที่สถานศึกษาต้องใช้บทบาทฝั่งสถานศึกษาเท่านั้น (${auth.SCHOOL_ROLE_ORDER.map((r) => auth.roleLabel(r)).join(', ')})`
        : 'เจ้าหน้าที่ สพป.แพร่ เขต 2 ต้องใช้บทบาทฝั่งสำนักงานเท่านั้น',
    });
  }
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
  /*
   * ⚠️ มีแค่ 2 ระบบที่ยังใช้ "จำนวนขั้น" จากค่ากลางนี้จริง
   *   · ระบบลา    → นับจากคอลัมน์ที่เลือกในหน้า ⊛ เจ้าหน้าที่การลา (รายคน)
   *   · ไปราชการ → นับจากคอลัมน์ที่เลือกในหน้า ⊛ กำหนดผู้อนุมัติไปราชการ (รายคน)
   *   เคยรับ approval_travel / approval_leave มาบันทึกด้วย แต่ค่าไม่มีผลกับระบบจริง
   *   (approval_travel = 1 ทำให้คอลัมน์ "ผู้อนุมัติ" ที่ตั้งไว้ไม่เคยถูกพิจารณา)
   *   ถ้าวันหนึ่งมีการเพิ่มระบบเข้ามา ต้องเพิ่ม key กลับที่นี่ด้วย
   */
  const keys = ['approval_vehicle', 'approval_room'];
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
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await auth.hashPassword(new_password), id);
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
  // "to_org ขึ้นต้นด้วยเลข" ต้องใช้ REGEXP ไม่ใช่ GLOB
  // GLOB เป็นไวยากรณ์ของ SQLite — MariaDB ไม่รู้จัก คำสั่งจะ error ทันที
  // (เคยทำให้หน้า "หนังสือรับ" ฝั่งสถานศึกษาพังทันทีที่เลือกสถานศึกษาไว้)
  if (req.user.user_group === 'school' && (req.user.current_school || '').trim()) {
    const activeCode = String(req.user.current_school).trim().split(' ')[0];
    if (/^\d{7,8}$/.test(activeCode)) {
      sql += " AND (dr.as_school = ? OR (dr.as_school IS NULL AND NOT (d.to_org REGEXP '^[0-9]' AND d.to_org NOT LIKE ?)))";
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
  res.json({ documents: await prepareDocRows(docs, req) });
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
  // row = สถานะจริงหลังทำเครื่องหมายว่าอ่านแล้ว
  //   หน้าเว็บใช้อัปเดตแถวนี้ทันที ไม่ต้องรอผู้ใช้รีเฟรชเอง
  //   (เคยต้องรีเฟรชเพราะ response เดิมคืนแค่ { ok: true } ไม่มีข้อมูลให้อัปเดต)
  //   ⚠️ ไม่คืน read_at — ฐานเขียนด้วย NOW() ของ MariaDB
  //     ถ้าเอา auth.now() มาใส่จะเป็นค่าที่ไม่ได้บันทึกจริง (ต่างกันได้)
  //     และหน้าเว็บก็ไม่ได้ใช้ค่านี้อยู่แล้ว
  res.json({ ok: true, row: { id: docId, is_read: 1 } });
});

// GET /my-incoming-registered - get documents registered as incoming by current user
router.get('/my-incoming-registered', auth.requireAuth, async (req, res) => {
  const userId = req.user.id;
  const isSchool = req.user.user_group === 'school';
  const schoolCode = schoolCodeOf(req.user);
  const q = req.query.q || '';
  // แทปทะเบียนหนังสือรับ: แสดงเฉพาะรายการที่ลงทะเบียนรับหนังสือแล้วเท่านั้น (is_registered = 1)
  let sql = `SELECT d.*, u.full_name AS creator_name FROM documents d LEFT JOIN users u ON u.id = d.created_by WHERE (d.doc_type = 'incoming' OR (d.doc_type = 'outgoing' AND d.sender_type = 'school')) AND d.is_registered = 1`;
  const params = [];
  if (isSchool) {
    // ทะเบียนของโรงเรียน = หนังสือที่ "ส่งถึงโรงเรียนนี้" — ต้องไม่หายเมื่อเปลี่ยนตัวเจ้าหน้าที่สารบัญ
    // จึงดูจาก document_school_targets (ถาวร) ด้วย ไม่ใช่แค่ school_code/to_org
    if (schoolCode) {
      sql += " AND (d.school_code = ? OR d.to_org LIKE ? OR EXISTS (SELECT 1 FROM document_school_targets t WHERE t.document_id = d.id AND t.school_code = ?))";
      params.push(schoolCode, "%" + schoolCode + "%", schoolCode);
    } else {
      // ⚠️ ไม่รู้รหัสโรงเรียน (school_code + workplace + current_school ว่างหมด)
      //    เดิมปล่อยเป็น to_org LIKE '%%' → เห็นทะเบียนหนังสือรับของ *ทุกโรงเรียน* ในประเทศ
      //    ปลอดภัยกว่า: เห็นเฉพาะฉบับที่ตัวเองเป็นผู้รับ
      sql += ' AND EXISTS (SELECT 1 FROM document_recipients r WHERE r.document_id = d.id AND r.user_id = ?)';
      params.push(userId);
    }
  }
  else {
    // เฉพาะสารบัญเขต (หรือ admin) จะเห็นหนังสือที่สถานศึกษาส่งมา (sender_type = 'school')
    //
    // "เป็นของสำนักงานเขต" ตัดสินจากฝั่งของผู้สร้างหนังสือ (users.user_group)
    // ไม่ใช่รหัสโรงเรียน เพราะรหัสสำนักงานเขตถูกถอดออกจากตาราง schools ไปแล้ว
    // และผู้ใช้ฝั่งสำนักงานไม่มี school_code อยู่แล้ว
    const isOfficeClerk = await isOfficeDocStaff(req.user);
    if (isOfficeClerk) sql += " AND (COALESCE(u.user_group, 'office') != 'school' OR d.sender_type = 'school')";
    else sql += " AND COALESCE(u.user_group, 'office') != 'school'";
  }
  const yc2 = docYearClause(req.query.year); if (yc2) { sql += yc2.clause; params.push(yc2.arg); }
  // ตัวกรองกลุ่มปฏิบัติ (เช่น กลุ่มส่งเสริมการศึกษาทางไกล เทคโนโลยีสารสนเทศฯ)
  const wg1 = (req.query.workgroup || '').trim();
  if (wg1) { sql += ' AND d.workgroup = ?'; params.push(wg1); }
  if (q) { sql += ` AND (d.title LIKE ? OR d.doc_no LIKE ? OR d.from_org LIKE ? OR d.to_org LIKE ?)`; const like = '%' + q + '%'; params.push(like, like, like, like); }
  sql += ' ORDER BY d.id DESC';
  const docs = await db.prepare(sql).all(...params);
  res.json({ documents: await prepareDocRows(docs, req) });
});

// GET /my-outgoing-registered - get all outgoing registered documents
router.get('/my-outgoing-registered', auth.requireAuth, async (req, res) => {
  const userId = req.user.id;
  const isSchool = req.user.user_group === 'school';
  const q = req.query.q || '';
  let sql = "SELECT d.*, u.full_name AS creator_name FROM documents d LEFT JOIN users u ON u.id = d.created_by WHERE d.doc_type = 'outgoing' AND d.sender_type = 'registered'";
  const params = [];
  if (isSchool) {
    /*
     * ทะเบียนหนังสือส่งเป็นของ "โรงเรียน" ไม่ใช่ของบัญชีเจ้าหน้าที่สารบัญ
     * ────────────────────────────────────────────────────────────────
     * เดิมกรอง d.school_code = req.user.school_code ตรง ๆ ซึ่งพังได้ 2 ทาง
     *   ① บัญชีใหม่มี school_code = '' (บั๊ก regex /^d{8}/ ตอนสมัคร/อนุมัติ)
     *      → กรองด้วย '' = ไม่เห็นอะไรเลย
     *   ② รายการเก่าที่ลงทะเบียนตอน school_code ยังว่าง → school_code = ''
     *      → ไม่มีใครที่มีรหัสถูกต้องเห็นอีกเลย
     * → ใช้ schoolDocScope() (ดูคำอธิบายที่ตัวช่วยด้านบนไฟล์)
     */
    const scope = await schoolDocScope(req.user);
    sql += ' AND (' + scope.clause + ')';
    params.push(...scope.params);
  }
  // ฝั่งสำนักงานเขต: เฉพาะรายการที่ไม่มีรหัสโรงเรียน (ของโรงเรียนเป็นของโรงเรียน)
  // (เดิมคัดด้วย d.school_code = '54020000' ซึ่งไม่มีผล เพราะรหัสนี้ถูกถอดจาก schools แล้ว
  //  และผู้ใช้ฝั่งสำนักงานไม่มี school_code → ทำให้ลงทะเบียนแล้วไม่โผล่ในทะเบียนเลย)
  // + กันรายการของโรงเรียนที่ผู้สร้างถูกลบไปแล้วหลุดมาอยู่ทะเบียนของสำนักงานเขต
  else { sql += " AND (d.school_code IS NULL OR d.school_code = '') AND COALESCE(u.user_group, 'office') != 'school'"; }
  const yc3 = docYearClause(req.query.year); if (yc3) { sql += yc3.clause; params.push(yc3.arg); }
  // ตัวกรองกลุ่มปฏิบัติ
  const wg2 = (req.query.workgroup || '').trim();
  if (wg2) { sql += ' AND d.workgroup = ?'; params.push(wg2); }
  if (q) { sql += ' AND (d.title LIKE ? OR d.doc_no LIKE ? OR d.from_org LIKE ? OR d.to_org LIKE ?)'; const like = '%' + q + '%'; params.push(like, like, like, like); }
  sql += ' ORDER BY d.id DESC';
  const docs = await db.prepare(sql).all(...params);
  res.json({ documents: await prepareDocRows(docs, req) });
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
  res.json({ documents: await prepareDocRows(docs, req) });
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
  res.json({ documents: await prepareDocRows(docs, req) });
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
  res.json({ documents: await prepareDocRows(docs, req) });
});

router.get('/workplace-groups', auth.requireAuth, async (req, res) => {
  const groups = await db.prepare("SELECT DISTINCT workplace FROM users WHERE workplace IS NOT NULL AND workplace != '' AND user_group = 'office' ORDER BY workplace").all();
  res.json({ groups: groups.map(g => g.workplace) });
});

// ห่อ router เพื่อจับ error จาก async handler (Express 4 ไม่ catch promise เอง)
const { wrapRouter } = require('../lib/async-route');
module.exports = wrapRouter(router);
