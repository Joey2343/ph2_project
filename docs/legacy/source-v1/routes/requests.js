'use strict';
const path = require('path');
function getSchoolPrefix(req) {
  if (req.user && req.user.school_code) {
    return req.user.school_code + '/';
  }
  return '';
}

const express = require('express');
const fs = require('fs');
const db = require('../db');
const auth = require('../lib/auth');
const { uploadTravel, uploadLeaves, uploadMemos, uploadErrorHandler, deleteUploadedFile } = require('../lib/uploads');
const { createDynamicUpload } = require('../lib/uploads');
// อัปโหลดแบบแยกโฟลเดอร์ตามรหัสหน่วยงาน (school_code) — ต้องตรงกับ path ที่บันทึกใน DB (getSchoolPrefix)
const uploadMemosDyn  = createDynamicUpload('memos',  { fileSize: 5 * 1024 * 1024, fieldSize: 8 * 1024 * 1024 });
const uploadTravelDyn = createDynamicUpload('travel');
const uploadLeavesDyn = createDynamicUpload('leaves');
const simdate = require('../lib/simdate');
const approvals = require('../lib/approvals');
const telegram = require('../lib/telegram');

const router = express.Router();

/** ปี พ.ศ. ปัจจุบัน */
function getYearBE() {
  return simdate.todayISO().slice(0, 4) - 0 + 543;
}

/** ปีงบประมาณ พ.ศ. (ตุลาคม - กันยายน) เช่น ต.ค.2569 → ปีงบประมาณ 2570 */
function getFiscalYearBE() {
  const now = simdate.todayISO(); // YYYY-MM-DD (วันจำลองเมื่อเปิดโหมดจำลอง)
  const month = Number(now.slice(5, 7)); // 1=Jan
  const yearBE = Number(now.slice(0, 4)) + 543;
  return month >= 10 ? yearBE + 1 : yearBE; // >= ต.ค. = ปี+1
}

/** สร้างเลขที่อัตโนมัติต่อปี เช่น 001/2569 */
function nextDocNo(table, idCol, yearBE, schoolCode) {
  if (!yearBE) yearBE = getYearBE();
  var whereClause = "WHERE " + idCol + " LIKE ?";
  var args = ["%/" + yearBE];
  if (schoolCode) { whereClause += " AND created_by IN (SELECT id FROM users WHERE school_code = ?)"; args.push(schoolCode); }
  var query = "SELECT " + idCol + " AS no FROM " + table + " " + whereClause;
  const rows = db.prepare(query).all(...args);
  let max = 0;
  for (const r of rows) {
    var m = String(r.no).match(/^([0-9]+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return (max + 1) + "/" + yearBE;
}

/** ปีงบประมาณ สำหรับ leave (ต.ค. - ก.ย.) */
function leaveFiscalYearBE() {
  return getFiscalYearBE();
}

/** สร้างเลขที่คำขอลาแยกตามประเภทการลา — ลาป่วย/ลากิจ/ลาคลอด และ ลาพักผ่อน รันเลขของตัวเอง ไม่รันต่อกัน
 *  เมนูขออนุญาตลานับปีงบประมาณ (1 ต.ค. - 30 ก.ย.) — เลขเริ่ม 1 ใหม่ทุกวันที่ 1 ต.ค. */
function nextLeaveNo(leaveType) {
  const yearBE = getFiscalYearBE();
  const rows = db.prepare("SELECT leave_no AS no FROM leave_requests WHERE leave_type = ? AND leave_no LIKE ?").all(leaveType, '%/' + yearBE);
  let max = 0;
  for (const r of rows) {
    var m = String(r.no).match(/^([0-9]+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return (max + 1) + '/' + yearBE;
}

function canEdit(user, row) {
  return user.role === 'admin' || row.user_id === user.id;
}

function daysBetween(from, to) {
  const a = new Date(from), b = new Date(to);
  if (isNaN(a) || isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

// ---------- เมนู 6: บันทึกข้อความ ----------
/** แปลง JSON รายการไฟล์ (จากคอลัมน์ ref_files/enc_files/draft_file) เป็น array — รองรับทั้ง array และ object เดียว */
function parseMemoFiles(data) {
  try {
    const d = JSON.parse(data || 'null');
    if (Array.isArray(d)) return d;
    if (d && d.file) return [d]; // ร่างหนังสือส่งเก็บเป็น object เดียว
    return [];
  } catch (e) {
    return [];
  }
}

/** ลบไฟล์แนบทั้งหมดของบันทึกข้อความออกจากดิสก์ */
function deleteMemoFiles(row) {
  const files = [
    ...parseMemoFiles(row.ref_files),
    ...parseMemoFiles(row.enc_files),
    ...parseMemoFiles(row.draft_file),
  ].map((f) => (typeof f === 'string' ? f : (f && f.file) || ''));
  for (const f of files) {
    if (f) deleteUploadedFile(f);
  }
  if (row.attachment) deleteUploadedFile(row.attachment);
}

/** จับคู่ไฟล์ที่อัปโหลดกับชื่อไฟล์ที่ผู้ใช้พิมพ์ (array ตามลำดับ) */
function buildFileList(req, fileArr, namesRaw) {
  const arr = Array.isArray(fileArr) ? fileArr : (fileArr ? [fileArr] : []);
  let names = [];
  try { names = JSON.parse(namesRaw || '[]'); } catch (e) { names = []; }
  if (!Array.isArray(names)) names = [];
  return arr.map((f, i) => ({
    file: getSchoolPrefix(req) + 'memos/' + f.filename,
    name: String(names[i] || '').trim() || f.originalname,
  }));
}

/** จำนวนขั้นการอนุมัติของบันทึกข้อความนี้ = จำนวนขั้นใน chain (snapshot ณ เวลาส่ง) */
function memoRequired(row) {
  let chain = null;
  try { chain = JSON.parse(row.approval_chain || '[]'); } catch (e) { chain = null; }
  if (Array.isArray(chain) && chain.length) {
    return Math.max(...chain.map((x) => Number(x.level) || 0));
  }
  // fallback: นับขั้นที่มีผู้ได้รับมอบหมายในปัจจุบัน (สายของผู้จัดทำ)
  const ap = memoChainFor(row.user_id);
  return [1, 2, 3].filter((l) => (ap[l] || []).length).length || 1;
}

/** สายการอนุมัติบันทึกข้อความของบุคคลหนึ่ง: { 1: [approverId], 2: [...], 3: [...] } (รายบุคคล + fallback ลำดับรวม) */
function memoChainFor(staffId) {
  const per = approvals.getMemoApproversPerPerson();
  const flat = approvals.getSystemApprovers('memo');
  const out = { 1: [], 2: [], 3: [] };
  for (const lv of ['1', '2', '3']) {
    const v = Number((per[lv] || {})[String(staffId)]) || 0;
    out[lv] = v ? [v] : (flat[lv] || []).slice();
  }
  return out;
}

/** ผู้มีสิทธิ์ขั้นที่ level ของบันทึกข้อความนี้ (จาก chain snapshot ณ เวลาส่ง หรือ config ปัจจุบัน) */
function memoLevelIds(row, level) {
  let chain = null;
  try { chain = JSON.parse(row.approval_chain || '[]'); } catch (e) { chain = null; }
  if (Array.isArray(chain) && chain.length) {
    const lv = chain.find((x) => Number(x.level) === level);
    if (lv && Array.isArray(lv.ids) && lv.ids.length) return lv.ids.map(Number);
  }
  // fallback: สายของผู้จัดทำ (รายบุคคล)
  return memoChainFor(row.user_id)[level] || [];
}

/** ผู้ใช้พิจารณาบันทึกข้อความนี้ได้หรือไม่ (ผู้อนุมัติขั้นที่กำลังรอ หรือผู้ที่ถูกเรียนเสนอเลือกไว้) */
function canDecideMemo(user, row, nextLevel) {
  // รายบุคคล: ต้องเป็นผู้อนุมัติของ "ผู้จัดทำ" ณ ขั้นนั้้น (หรือถูกส่งต่อเจาะจงถึง)
  if (approvals.canApproveMemoFor(user, row.user_id, nextLevel)) return true;
  return !!(row.next_approver_id && Number(row.next_approver_id) === user.id);
}

/** ตัวเลือกในส่วน ปฏิบัติราชการ/รักษาราชการแทน (ขั้นที่ 2) — ติ๊กได้หลายช่อง */
const MEMO_ACT_CHOICES = ['ทราบ', 'ลงนามแล้ว', 'อนุญาต', 'ไม่อนุญาต', 'อนุมัติ', 'ไม่อนุมัติ', 'ชอบ/ให้ดำเนินการตามเสนอ'];

/** เลขที่หนังสือนี้ยังว่าง (ไม่มีบันทึกอื่นใช้) หรือไม่ */
function docNoAvailable(table, idCol, no) {
  if (!no) return false;
  return !db.prepare(`SELECT 1 FROM ${table} WHERE ${idCol} = ?`).get(no);
}

// เลขที่อัตโนมัติ (ที่) สำหรับบันทึกข้อความถัดไป — แสดงในฟอร์ม แก้ไขไม่ได้
router.get('/memos/next-no', auth.requireAuth, (req, res) => {
  const isSchool = req.user.user_group === 'school';
  const schoolCode = req.user.school_code || '';
  if (schoolCode) {
    var rows = db.prepare("SELECT doc_no FROM memos WHERE created_by IN (SELECT id FROM users WHERE school_code = ?)").all(schoolCode);
    var max = 0;
    for (var r of rows) {
      var m = String(r.doc_no || '').match(/^([0-9]+)/);
      if (m) { var v = parseInt(m[0], 10); if (v > max) max = v; }
    }
    res.json({ next: String(max + 1) });
  } else {
    res.json({ next: nextDocNo('memos', 'doc_no') });
  }
});

// ลำดับขั้นการส่งบันทึกข้อความ (admin กำหนดชื่อผู้รับในช่อง ส่งบันทึกข้อความถึง)
router.get('/memo/approvers', auth.requireAuth, (req, res) => {
  const approvers = approvals.getSystemApprovers('memo');
  // แผนที่รายบุคคล: approvers[level][staffId] = approverId
  let perPerson = approvals.getMemoApproversPerPerson();
  // เฉพาะเจ้าหน้าที่ สพป.แพร่ เขต 2 (รหัส 54020000) — ไม่รวมเจ้าหน้าที่สถานศึกษา
  const staff = db.prepare(`SELECT id, title, full_name, first_name, last_name, position, workplace, role FROM users
    WHERE status = 'active' AND school_code = '54020000' ORDER BY full_name`).all();
  // ยังไม่เคยบันทึกรายบุคคล → ใช้ค่า effective จากลำดับรวมเดิม (คนแรกของแต่ละขั้น) ให้ทุกคน เพื่อไม่ให้ตารางว่าง
  const hasPer = ['1', '2', '3'].some((lv) => Object.keys(perPerson[lv] || {}).length);
  if (!hasPer) {
    perPerson = { 1: {}, 2: {}, 3: {} };
    for (const lv of ['1', '2', '3']) {
      const first = (approvers[lv] || [])[0];
      if (first) staff.forEach((u) => { perPerson[lv][String(u.id)] = first; });
    }
  }
  res.json({ approvers, perPerson, staff });
});

router.put('/memo/approvers', auth.requireAdmin, (req, res) => {
  const b = req.body || {};
  // รูปแบบรายบุคคล: { 1: { staffId: approverId }, 2: {...}, 3: {...} } — แต่ละคนเลือกสายอนุมัติของตัวเองได้อิสระ
  const toMap = (v) => {
    const out = {};
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const k in v) { const sid = Number(k), aid = Number(v[k]); if (sid > 0 && aid > 0) out[String(sid)] = aid; }
    }
    return out;
  };
  const per = { 1: toMap(b['1'] || b.per1), 2: toMap(b['2'] || b.per2), 3: toMap(b['3'] || b.per3) };
  // ตรวจว่าทุก id เป็นเจ้าหน้าที่ สพป.แพร่ เขต 2 ที่ active เท่านั้น
  const all = [...new Set([...Object.keys(per[1]), ...Object.keys(per[2]), ...Object.keys(per[3]).concat(Object.values(per[3]))].map(Number).concat(Object.values(per[1]), Object.values(per[2])))];
  if (all.length) {
    const rows = db.prepare(`SELECT id FROM users WHERE id IN (${all.map(() => '?').join(',')}) AND status = 'active' AND school_code = '54020000'`).all(...all);
    const valid = new Set(rows.map((r) => r.id));
    for (const lv of ['1', '2', '3']) {
      for (const sid in per[lv]) {
        if (!valid.has(Number(sid)) || !valid.has(Number(per[lv][sid]))) delete per[lv][sid];
      }
    }
  }
  // รวมเป็นลำดับรวม (สำหรับ fallback/telegram) จากชุดผู้อนุมัติทั้งหมด
  const flat = { 1: [...new Set(Object.values(per[1]))], 2: [...new Set(Object.values(per[2]))], 3: [...new Set(Object.values(per[3]))] };
  db.prepare("UPDATE settings SET value = ? WHERE key = 'memo_approvers'").run(JSON.stringify({ per, flat }));
  res.json({ ok: true, message: 'บันทึกลำดับขั้นการส่งบันทึกข้อความเรียบร้อย' });
});

router.get('/memos', auth.requireAuth, (req, res) => {
  const { status, q, mine, year } = req.query;
  // ทุกคนมองเห็นบันทึกข้อความของทุกคน (แก้ไขได้เฉพาะของตัวเอง ตรวจในฝั่งหน้าเว็บ)
  // ระบุคอลัมน์ชัดเจน (กัน u.title ชนกับ m.title) — maker_title คือคำนำหน้าชื่อของผู้จัดทำ
  let sql = `SELECT m.id, m.doc_no, m.user_id, m.title, m.content, m.date, m.status, m.attachment, m.office,
                    m.urgency, m.to_text, m.ref_files, m.enc_files, m.draft_file, m.send_to, m.created_at,
                    m.approval_level, m.approval_data, m.approval_chain, m.note, m.revision_note, m.decided_at, m.next_approver_id,
                    u.title AS maker_title, u.full_name, u.first_name, u.last_name, u.username,
                    u.position AS maker_position, u.signature AS maker_signature
             FROM memos m JOIN users u ON u.id = m.user_id WHERE 1=1`;
  const args = [];
  // ปุ่ม "บันทึกข้อความของฉัน" — กรองเฉพาะของตัวเอง
  if (mine === '1') { sql += ' AND m.user_id = ?'; args.push(req.user.id); }
  if (status && status !== 'myapprove') { sql += ' AND m.status = ?'; args.push(status); }
  if (q) { sql += ' AND (m.title LIKE ? OR m.content LIKE ? OR m.doc_no LIKE ?)'; const p = `%${q}%`; args.push(p, p, p); }
  if (year) { sql += " AND m.doc_no LIKE ?"; args.push('%/' + year); }
  sql += ' ORDER BY m.id DESC';
  let rows = db.prepare(sql).all(...args);
  // ฟิลเตอร์ "รอการอนุมัติของฉัน" — เฉพาะรายการที่กำลังรอขั้นที่ฉันได้รับมอบหมาย (อ้างอิง chain ณ เวลาส่ง)
  if (status === 'myapprove') {
    rows = rows.filter((r) => {
      if (r.status !== 'submitted') return false;
      const next = (r.approval_level || 0) + 1;
      // ส่งต่อเฉพาะเจาะจง (เรียนเสนอจากขั้นที่ 1) → เฉพาะผู้ที่ถูกเลือก (และ admin) เห็นเป็นงานรออนุมัติ
      if (r.next_approver_id) {
        return Number(r.next_approver_id) === req.user.id || req.user.role === 'admin';
      }
      // สายรายบุคคล: ต้องเป็นผู้อนุมัติของ "ผู้จัดทำ" ณ ขั้นถัดไป
      return approvals.canApproveMemoFor(req.user, r.user_id, next);
    });
  }
  res.json({ memos: rows.map((r) => ({ ...r, required_levels: memoRequired(r), approvals: approvals.parseApprovals(r.approval_data) })) });
});

const memoUpload = uploadMemosDyn.fields([
  { name: 'ref_files', maxCount: 10 },
  { name: 'enc_files', maxCount: 10 },
  { name: 'draft_file', maxCount: 1 },
]);

router.post('/memos', auth.requireAuth, memoUpload, uploadErrorHandler, (req, res) => {
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: 'กรุณากรอกเรื่อง (หัวข้อ) ของบันทึกข้อความ' });
  // เลขที่หนังสือ: ใช้ค่าที่แสดงในฟอร์มถ้ายังว่างอยู่ ไม่เช่นนั้นออกเลขใหม่ (กันเลขซ้ำ)
  let docNo = (b.doc_no || '').trim();
  if (!docNoAvailable('memos', 'doc_no', docNo)) docNo = nextDocNo('memos', 'doc_no');
  const status = b.status === 'submitted' ? 'submitted' : 'draft';
  const files = req.files || {};
  const refFiles = buildFileList(req, files.ref_files, b.ref_names);
  const encFiles = buildFileList(req, files.enc_files, b.enc_names);
  const draftList = buildFileList(req, files.draft_file, b.draft_names);
  const draftFile = draftList[0] || null;
  const office = (b.office || '').trim();
  const urgency = ['ปกติ', 'ด่วน', 'ด่วนที่สุด'].includes(b.urgency) ? b.urgency : 'ปกติ';
  // เมื่อกดส่งจริง: สร้างสายการอนุมัติจากลำดับขั้น (snapshot ณ เวลาส่ง) + ระดับเริ่มต้น 0
  let approvalChain = null;
  let approvalLevel = 0;
  if (status === 'submitted') {
    // snapshot สายอนุมัติของ "ผู้จัดทำ" ณ เวลาส่ง (รายบุคคล)
    const ap = memoChainFor(req.user.id);
    const chain = [1, 2, 3].filter((l) => (ap[l] || []).length).map((l) => ({ level: l, ids: ap[l].map(Number) }));
    approvalChain = JSON.stringify(chain);
  }
  const info = db.prepare(`INSERT INTO memos
    (doc_no, user_id, title, content, date, status, office, urgency, to_text, ref_files, enc_files, draft_file, send_to, approval_level, approval_data, approval_chain)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(docNo, req.user.id, String(b.title).trim(), (b.content || '').trim(),
    (b.date || simdate.todayISO()), status, office || null, urgency,
    (b.to_text || '').trim() || null, JSON.stringify(refFiles), JSON.stringify(encFiles),
    draftFile ? JSON.stringify(draftFile) : null, (b.send_to || '').trim() || null,
    approvalLevel, '[]', approvalChain);
  const newId = info.lastInsertRowid;
  if (status === 'submitted') {
    // แจ้งเตือน Telegram ไปยังผู้อนุมัติขั้นที่ 1 ว่ามีบันทึกข้อความใหม่ส่งเข้ามา
    telegram.notifyMemoSubmitted(newId);
  }
  res.json({ ok: true, id: newId, message: status === 'submitted' ? 'บันทึกข้อความถูกส่งเรียบร้อย' : 'บันทึกฉบับร่างเรียบร้อย' });
});

// อนุมัติบันทึกข้อความทีละขั้น (ขั้นที่ 1 → 2 → 3 ตามลำดับขั้นที่ admin กำหนด)
// ขั้นที่ 1 (ผู้อนุมัติขั้นต้น): เลือกความเห็น + เลือกผู้อนุมัติขั้นที่ 2 (เรียนเสนอ) เพื่อส่งต่อเรื่อง
// ขั้นที่ 2: เลือก ผ่านเรื่อง (ส่งต่อขั้นที่ 3 / เสนอต่อ) หรือ ปฏิบัติราชการ/รักษาราชการแทน (สิ้นสุดที่ขั้นที่ 2)
// ขั้นที่ 3 (สุดท้าย): บันทึกสั่งการ — ติ๊กได้หลายช่อง (ทราบ/ลงนามแล้ว/อนุญาต/...) แล้วถือเป็นสิ้นสุดการพิจารณา
router.put('/memos/:id/approve', auth.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM memos WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบบันทึกข้อความ' });
  if (row.status !== 'submitted') return res.status(400).json({ error: 'รายการนี้ไม่รอการอนุมัติแล้ว' });
  const required = memoRequired(row);
  const approvalsArr = approvals.parseApprovals(row.approval_data);
  const nextLevel = approvalsArr.length + 1;
  if (nextLevel > required) return res.status(400).json({ error: 'รายการนี้ได้รับการอนุมัติครบทุกขั้นแล้ว' });
  if (!canDecideMemo(req.user, row, nextLevel)) {
    return res.status(403).json({ error: `คุณไม่มีสิทธิ์อนุมัติ${approvals.levelLabel(nextLevel)} (เฉพาะผู้ที่ได้รับมอบหมายเท่านั้น)` });
  }
  const note = ((req.body || {}).note || '').trim();
  const comment = ((req.body || {}).comment || '').trim() || null;
  // ขั้นที่ 1 (ผู้อนุมัติขั้นต้น) ต้องเลือกความเห็น (เพื่อโปรดพิจารณา / เพื่อโปรดทราบ)
  let decide = ((req.body || {}).decide || '').trim();
  if (nextLevel === 1) {
    if (!['เพื่อโปรดพิจารณา', 'เพื่อโปรดทราบ'].includes(decide)) {
      return res.status(400).json({ error: 'กรุณาเลือกความเห็นในส่วนอนุมัติขั้นต้น (เพื่อโปรดพิจารณา / เพื่อโปรดทราบ)' });
    }
  }
  // ขั้นที่ 1 ต้องเลือกผู้อนุมัติขั้นที่ 2 (เรียนเสนอ) เพื่อส่งต่องาน — เมื่อมีผู้ได้รับมอบหมายขั้นที่ 2
  const level2Ids = memoLevelIds(row, 2);
  const level3Ids = memoLevelIds(row, 3);
  let mode = null;
  let actChoices = [];
  let nextApproverId = null;
  let nextApproverName = null;
  if (nextLevel === 1 && level2Ids.length) {
    nextApproverId = Number((req.body || {}).next_approver_id);
    if (!level2Ids.includes(nextApproverId)) {
      return res.status(400).json({ error: 'กรุณาเลือกผู้อนุมัติขั้นที่ 2 (เรียนเสนอ) ก่อนยืนยันอนุมัติ' });
    }
    const nextUser = db.prepare('SELECT full_name, title, first_name, last_name FROM users WHERE id = ?').get(nextApproverId);
    nextApproverName = nextUser ? nextUser.full_name : null;
  }
  if (nextLevel === 2) {
    mode = ((req.body || {}).mode || '').trim();
    if (!['pass', 'act'].includes(mode)) {
      return res.status(400).json({ error: 'กรุณาเลือก ผ่านเรื่อง หรือ ปฏิบัติราชการ/รักษาราชการแทน' });
    }
    if (mode === 'pass') {
      // ผ่านเรื่อง/เสนอต่อ: เลือกความเห็น + เลือกผู้อนุมัติขั้นที่ 3 (สุดท้าย) เพื่อส่งต่อ
      if (!level3Ids.length) {
        return res.status(400).json({ error: 'ไม่มีผู้อนุมัติขั้นที่ 3 ในระบบ — ไม่สามารถผ่านเรื่องต่อได้' });
      }
      decide = ((req.body || {}).decide || '').trim();
      if (!['เพื่อโปรดพิจารณา', 'เพื่อโปรดทราบ'].includes(decide)) {
        return res.status(400).json({ error: 'กรุณาเลือกความเห็นในส่วน ผ่านเรื่อง/เสนอต่อ (เพื่อโปรดทราบ / เพื่อโปรดพิจารณา)' });
      }
      nextApproverId = Number((req.body || {}).next_approver_id);
      if (!level3Ids.includes(nextApproverId)) {
        return res.status(400).json({ error: 'กรุณาเลือกผู้อนุมัติขั้นที่ 3 (สุดท้าย) ก่อนยืนยันอนุมัติ' });
      }
      const nextUser = db.prepare('SELECT full_name, title, first_name, last_name FROM users WHERE id = ?').get(nextApproverId);
      nextApproverName = nextUser ? nextUser.full_name : null;
    } else {
      // ปฏิบัติราชการ/รักษาราชการแทน: ติ๊กได้หลายช่อง (ทราบ/ลงนามแล้ว/อนุญาต/...) → สิ้นสุดการพิจารณาที่ขั้นที่ 2
      actChoices = Array.isArray((req.body || {}).act_choices)
        ? (req.body || {}).act_choices.filter((c) => typeof c === 'string' && MEMO_ACT_CHOICES.includes(c))
        : [];
      if (!actChoices.length) {
        return res.status(400).json({ error: 'กรุณาเลือกอย่างน้อย 1 รายการในส่วน ปฏิบัติราชการ/รักษาราชการแทน' });
      }
    }
  }
  // ขั้นที่ 3 (สุดท้าย): บันทึกสั่งการ — ติ๊กได้หลายช่อง (ทราบ/ลงนามแล้ว/อนุญาต/...) แล้วถือเป็นสิ้นสุดการพิจารณา
  if (nextLevel === 3) {
    actChoices = Array.isArray((req.body || {}).act_choices)
      ? (req.body || {}).act_choices.filter((c) => typeof c === 'string' && MEMO_ACT_CHOICES.includes(c))
      : [];
    if (!actChoices.length) {
      return res.status(400).json({ error: 'กรุณาเลือกอย่างน้อย 1 รายการในส่วน บันทึกสั่งการ' });
    }
  }
  approvalsArr.push({
    level: nextLevel, by: req.user.id, name: req.user.full_name,
    title: req.user.title, first_name: req.user.first_name, last_name: req.user.last_name,
    position: req.user.position, signature: req.user.signature || null, decide: decide || null,
    role: req.user.role, at: auth.now(), note,
    mode: mode || undefined, comment: comment || undefined,
    act_choices: actChoices.length ? actChoices : undefined,
    next_approver_id: nextApproverId, next_approver_name: nextApproverName,
  });
  // ปฏิบัติราชการ/รักษาราชการแทน (ขั้นที่ 2) = สิ้นสุดการพิจารณาที่ขั้นที่ 2 (ไม่ส่งต่อขั้นที่ 3)
  const done = nextLevel >= required || (nextLevel === 2 && mode === 'act');
  const storeNext = (nextLevel === 1 || (nextLevel === 2 && mode === 'pass')) ? nextApproverId : null;
  // next_approver_id: เก็บเฉพาะตอนขั้นที่ 1 (เรียนเสนอ) และขั้นที่ 2 (ผ่านเรื่อง/เสนอต่อ) ส่งต่อ (ขั้นที่ 3 ใช้ chain ตามปกติ → ล้างค่า)
  db.prepare(`UPDATE memos SET approval_level = ?, approval_data = ?, status = ?, note = ?, decided_by = ?, decided_at = ?, next_approver_id = ? WHERE id = ?`)
    .run(nextLevel, JSON.stringify(approvalsArr), done ? 'approved' : 'submitted',
      note, req.user.id, auth.now(), storeNext, id);
  if (done) {
    // อนุมัติครบขั้น → แจ้งเตือน Telegram (สีเขียว 🟢) ไปยังผู้จัดทำ พร้อมรายละเอียดบันทึกสั่งการ/ปฏิบัติราชการฯ + ความเห็น
    const extra = [];
    if (nextLevel === 3 && actChoices.length) extra.push(`• บันทึกสั่งการ: ${actChoices.join(', ')}`);
    if (nextLevel === 2 && mode === 'act') extra.push(`• ปฏิบัติราชการ/รักษาราชการแทน: ${actChoices.join(', ')}`);
    if (comment) extra.push(`• ความเห็น: ${comment}`);
    telegram.notifyRequest({ system: 'memo', id, approved: true, deciderName: req.user.full_name, note, extra });
  } else if (nextApproverId) {
    // ส่งต่อเฉพาะเจาะจง → แจ้งเตือน Telegram เฉพาะผู้ที่ถูกเลือกเท่านั้น
    telegram.notifyMemoForwarded(id, nextApproverId, req.user.full_name, decide, nextLevel === 2 ? 'ผ่านเรื่อง/เสนอต่อ' : undefined);
  } else {
    // ยังไม่ครบขั้น → แจ้งเตือนผู้อนุมัติขั้นถัดไปว่าขั้นก่อนหน้าได้อนุมัติแล้ว (พร้อมความเห็นขั้นต้น)
    telegram.notifyMemoNextLevel(id, req.user.full_name, decide);
  }
  let message;
  if (done) {
    message = nextLevel === 2 && mode === 'act'
      ? '✅ อนุมัติครบทุกขั้นแล้ว (ปฏิบัติราชการ/รักษาราชการแทน) — บันทึกข้อความสิ้นสุดการพิจารณาที่ขั้นที่ 2'
      : nextLevel === 3 && actChoices.length
        ? `✅ อนุมัติครบทุกขั้นแล้ว (บันทึกสั่งการ: ${actChoices.join(', ')}) — บันทึกข้อความได้รับการอนุมัติอย่างเป็นทางการ`
        : '✅ อนุมัติครบทุกขั้นแล้ว บันทึกข้อความได้รับการอนุมัติอย่างเป็นทางการ';
  } else if (nextApproverId) {
    message = nextLevel === 2
      ? `✅ อนุมัติ${approvals.levelLabel(2)}แล้ว (ผ่านเรื่อง) ส่งต่อให้ผู้อนุมัติขั้นที่ 3 (${nextApproverName || '-'}) แล้ว`
      : `✅ อนุมัติ${approvals.levelLabel(1)}แล้ว ส่งต่อให้ผู้อนุมัติขั้นที่ 2 (${nextApproverName || '-'}) แล้ว ยังเหลืออีก ${required - nextLevel} ขั้น`;
  } else {
    message = `✅ อนุมัติ${approvals.levelLabel(nextLevel)}แล้ว ยังเหลืออีก ${required - nextLevel} ขั้น`;
  }
  res.json({ ok: true, approved: done, level: nextLevel, required, mode, message });
});

// ไม่อนุมัติบันทึกข้อความ (ผู้มีสิทธิ์ขั้นที่กำลังรอ หรือ admin)
router.put('/memos/:id/reject', auth.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM memos WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบบันทึกข้อความ' });
  if (row.status !== 'submitted') return res.status(400).json({ error: 'รายการนี้ไม่รอการอนุมัติแล้ว' });
  const approvalsArr = approvals.parseApprovals(row.approval_data);
  const nextLevel = approvalsArr.length + 1;
  if (!canDecideMemo(req.user, row, nextLevel)) {
    return res.status(403).json({ error: 'คุณไม่มีสิทธิ์พิจารณาบันทึกข้อความนี้' });
  }
  const note = ((req.body || {}).note || '').trim();
  db.prepare(`UPDATE memos SET status = 'rejected', note = ?, decided_by = ?, decided_at = ? WHERE id = ?`)
    .run(note, req.user.id, auth.now(), id);
  // แจ้งเตือน Telegram (สีแดง 🔴) ไปยังผู้จัดทำทันที
  telegram.notifyRequest({ system: 'memo', id, approved: false, deciderName: req.user.full_name, note });
  res.json({ ok: true, message: 'ไม่อนุมัติบันทึกข้อความนี้แล้ว' });
});

// ส่งกลับเพื่อให้แก้ไข (ผู้มีสิทธิ์ขั้นที่กำลังรอ หรือ admin) — ผู้จัดทำแก้ไขแล้วกดส่งใหม่ได้
router.put('/memos/:id/return', auth.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM memos WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบบันทึกข้อความ' });
  if (row.status !== 'submitted') return res.status(400).json({ error: 'รายการนี้ไม่รอการอนุมัติแล้ว' });
  const approvalsArr = approvals.parseApprovals(row.approval_data);
  const nextLevel = approvalsArr.length + 1;
  if (!canDecideMemo(req.user, row, nextLevel)) {
    return res.status(403).json({ error: 'คุณไม่มีสิทธิ์พิจารณาบันทึกข้อความนี้' });
  }
  const note = ((req.body || {}).note || '').trim();
  if (!note) return res.status(400).json({ error: 'กรุณากรอกสิ่งที่ให้แก้ไขก่อนส่งกลับ' });
  db.prepare(`UPDATE memos SET status = 'returned', revision_note = ?, decided_by = ?, decided_at = ? WHERE id = ?`)
    .run(note, req.user.id, auth.now(), id);
  // แจ้งเตือนผู้จัดทำ (การ์ดหน้าแรก + Telegram)
  telegram.notifyMemoReturned(id, req.user.full_name, note);
  res.json({ ok: true, message: 'ส่งกลับเพื่อให้แก้ไขแล้ว — ผู้จัดทำจะได้รับแจ้งเตือน' });
});

// ลงนามในร่างเอกสาร (ผู้อนุมัติขั้นที่ 2/3) — ฝังลายเซ็นของผู้ลงนามลงในไฟล์ร่างหนังสือส่ง แล้วเซฟทับไฟล์เดิมในระบบ
router.post('/memos/:id/sign-draft', auth.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM memos WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบบันทึกข้อความ' });
  const draft = parseMemoFiles(row.draft_file)[0];
  if (!draft || !draft.file) return res.status(400).json({ error: 'บันทึกข้อความนี้ไม่มีไฟล์ร่างหนังสือส่ง' });
  if (!req.user.signature) return res.status(400).json({ error: 'คุณยังไม่มีลายเซ็นในระบบ — กรุณาอัปโหลดลายเซ็นก่อนลงนามในร่างเอกสาร' });
  const approvalsArr = approvals.parseApprovals(row.approval_data);
  const nextLevel = approvalsArr.length + 1;
  // เฉพาะผู้อนุมัติขั้นที่ 2 และ 3 (ขั้นที่กำลังรอพิจารณา) เท่านั้นที่ลงนามในร่างเอกสารได้
  if (![2, 3].includes(nextLevel)) {
    return res.status(400).json({ error: 'ลงนามในร่างเอกสารได้เฉพาะผู้อนุมัติขั้นที่ 2 หรือ 3 เท่านั้น' });
  }
  if (!canDecideMemo(req.user, row, nextLevel)) {
    return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ลงนามในร่างเอกสารของบันทึกข้อความนี้' });
  }
  const stamps = (req.body || {}).stamps;
  if (!Array.isArray(stamps) || !stamps.length) {
    return res.status(400).json({ error: 'ไม่พบตำแหน่งลายเซ็นที่จะวางในเอกสาร' });
  }
  const draftPath = path.join(__dirname, '..', 'public', 'uploads', draft.file);
  const sigPath = path.join(__dirname, '..', 'public', 'uploads', req.user.signature);
  if (!fs.existsSync(draftPath)) return res.status(400).json({ error: 'ไม่พบไฟล์ร่างหนังสือส่งในระบบ' });
  if (!fs.existsSync(sigPath)) return res.status(400).json({ error: 'ไม่พบไฟล์ลายเซ็นของคุณในระบบ' });
  (async () => {
    try {
      const { PDFDocument } = require('pdf-lib');
      const pdf = await PDFDocument.load(fs.readFileSync(draftPath), { ignoreEncryption: true });
      const sigExt = path.extname(req.user.signature).toLowerCase();
      let img;
      if (sigExt === '.png') img = await pdf.embedPng(fs.readFileSync(sigPath));
      else if (sigExt === '.jpg' || sigExt === '.jpeg') img = await pdf.embedJpg(fs.readFileSync(sigPath));
      else return res.status(400).json({ error: 'ไฟล์ลายเซ็นต้องเป็น PNG หรือ JPG' });
      const pages = pdf.getPages();
      for (const s of stamps) {
        const pageNum = Number(s.page);
        if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > pages.length) continue;
        const page = pages[pageNum - 1];
        const { width, height } = page.getSize();
        // ตำแหน่งจากหน้าจอเป็นสัดส่วน 0-1 (ซ้ายบน) → แปลงเป็นพิกัด PDF (ล่างซ้าย)
        const w = Math.min(0.9, Math.max(0.02, Number(s.w) || 0.15)) * width;
        const h = w * (img.height / img.width);
        const x = (Number(s.x) || 0) * width;
        const y = height - ((Number(s.y) || 0) * height) - h;
        page.drawImage(img, { x: Math.max(0, x), y: Math.max(0, y), width: w, height: h });
      }
      fs.writeFileSync(draftPath, await pdf.save()); // เซฟทับไฟล์เดิม
      res.json({ ok: true, message: 'ลงนามในร่างเอกสารเรียบร้อย — บันทึกทับไฟล์เดิมแล้ว' });
    } catch (e) {
      console.error('sign-draft error', e);
      res.status(500).json({ error: 'ไม่สามารถลงนามในเอกสารได้ (รองรับเฉพาะไฟล์ PDF): ' + (e.message || '') });
    }
  })();
});

router.put('/memos/:id', auth.requireAuth, memoUpload, uploadErrorHandler, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM memos WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบบันทึกข้อความ' });
  if (!canEdit(req.user, row)) return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขบันทึกนี้' });
  const b = req.body || {};
  let docNo = (b.doc_no || '').trim();
  if (!docNoAvailable('memos', 'doc_no', docNo)) docNo = row.doc_no || nextDocNo('memos', 'doc_no');
  const status = b.status === 'submitted' ? 'submitted' : 'draft';
  const files = req.files || {};
  // ไฟล์ใหม่ (ถ้ามี) + คงไฟล์เดิมที่ไม่ได้อัปโหลดใหม่
  const oldRef = parseMemoFiles(row.ref_files);
  const oldEnc = parseMemoFiles(row.enc_files);
  const oldDraft = parseMemoFiles(row.draft_file)[0] || null;
  const refFiles = [...oldRef, ...buildFileList(req, files.ref_files, b.ref_names)];
  const encFiles = [...oldEnc, ...buildFileList(req, files.enc_files, b.enc_names)];
  const draftFile = buildFileList(req, files.draft_file, b.draft_names)[0] || oldDraft;
  const office = (b.office || '').trim();
  const urgency = ['ปกติ', 'ด่วน', 'ด่วนที่สุด'].includes(b.urgency) ? b.urgency : (row.urgency || 'ปกติ');
  // กดส่งจากฉบับร่าง/ส่งกลับ: สร้างสายการอนุมัติใหม่ (snapshot) + ระดับเริ่มต้น 0 + ล้างหมายเหตุส่งกลับ + แจ้งเตือนขั้นที่ 1
  // กรณีถูกคืนเรื่องจากขั้นที่ 2 ขึ้นไป (คืนเรื่องเพื่อแก้ไข): คงขั้นอนุมัติเดิมไว้ (ลายเซ็นของผู้จัดทำ + ผู้อนุมัติขั้นก่อนหน้า)
  // และเมื่อแก้ไขแล้วกดส่งใหม่ เรื่องจะกลับไปที่ผู้อนุมัติขั้นเดิม (ขั้นที่ 2) ทันที โดยไม่ผ่านขั้นที่ 1
  let approvalChain = row.approval_chain;
  let approvalLevel = row.approval_level || 0;
  let approvalData = row.approval_data || '[]';
  let revisionNote = row.revision_note || null;
  let justSubmitted = false;
  let resubmittedToPrevLevel = false;
  if (status === 'submitted' && row.status !== 'submitted') {
    if (row.status === 'returned' && (row.approval_level || 0) >= 1) {
      approvalLevel = row.approval_level || 1;
      approvalData = row.approval_data || '[]';
      approvalChain = row.approval_chain;
      revisionNote = null;
      justSubmitted = true;
      resubmittedToPrevLevel = true;
    } else {
      const ap = memoChainFor(req.user.id);
      const chain = [1, 2, 3].filter((l) => (ap[l] || []).length).map((l) => ({ level: l, ids: ap[l].map(Number) }));
      approvalChain = JSON.stringify(chain);
      approvalLevel = 0;
      approvalData = '[]';
      revisionNote = null;
      justSubmitted = true;
    }
  }
  db.prepare(`UPDATE memos SET doc_no=?, title=?, content=?, date=?, status=?, office=?, urgency=?, to_text=?,
      ref_files=?, enc_files=?, draft_file=?, send_to=?, approval_chain=?, approval_level=?, approval_data=?, revision_note=?, next_approver_id=?, decided_by=?, decided_at=? WHERE id=?`)
    .run(docNo, String(b.title || '').trim(), (b.content || '').trim(),
      (b.date || row.date || simdate.todayISO()), status, office || null, urgency,
      (b.to_text || '').trim() || null, JSON.stringify(refFiles), JSON.stringify(encFiles),
      draftFile ? JSON.stringify(draftFile) : null, (b.send_to || '').trim() || null,
      approvalChain, approvalLevel, approvalData, revisionNote,
      (resubmittedToPrevLevel || !justSubmitted) ? (row.next_approver_id || null) : null,
      justSubmitted ? null : row.decided_by, justSubmitted ? null : row.decided_at, id);
  if (justSubmitted) {
    if (resubmittedToPrevLevel) {
      // คืนเรื่องจากขั้นที่ 2 แล้วแก้ไข → แจ้งผู้อนุมัติขั้นเดิม (ขั้นที่ 2 / คนที่ถูกเรียนเสนอ) ว่ามีบันทึกแก้ไขแล้วส่งกลับมา
      telegram.notifyMemoResubmitted(id, req.user.full_name);
    } else {
      telegram.notifyMemoSubmitted(id);
    }
  }
  res.json({ ok: true, message: status === 'submitted' ? 'ส่งบันทึกข้อความเรียบร้อย' : 'แก้ไขบันทึกข้อความเรียบร้อย' });
});

router.delete('/memos/:id', auth.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM memos WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบบันทึกข้อความ' });
  if (!canEdit(req.user, row)) return res.status(403).json({ error: 'ไม่มีสิทธิ์ลบบันทึกนี้' });
  deleteMemoFiles(row);
  db.prepare('DELETE FROM memos WHERE id = ?').run(id);
  res.json({ ok: true, message: 'ลบบันทึกข้อความเรียบร้อย' });
});

// ---------- เมนู 7: ขออนุญาตไปราชการ ----------
router.get('/travel', auth.requireAuth, (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const { status, year, group } = req.query;  let sql = `SELECT t.*, u.title AS user_title, u.full_name, u.first_name, u.last_name, u.username, u.position, u.workplace, u.user_group, u.school_code, u.signature AS user_signature, v.name AS vehicle_name, v.plate
    FROM travel_requests t JOIN users u ON u.id = t.user_id LEFT JOIN vehicles v ON v.id = t.vehicle_id WHERE 1=1`;
  const args = [];
  // ให้ทุกคนเห็นรายการทั้งหมด (เหมือน leave_requests)
  // if (!isAdmin) { sql += ' AND t.user_id = ?'; args.push(req.user.id); }
  // แยกหน้าตามกลุ่มผู้ใช้: group=office → เฉพาะเจ้าหน้าที่ สพป.แพร่ เขต 2 (user_group=office)
  //                       group=school → เฉพาะเจ้าหน้าที่สถานศึกษา (user_group=school)
  if (group === 'office') { sql += " AND COALESCE(u.user_group, CASE WHEN u.school_code = '54020000' THEN 'office' ELSE 'school' END) = 'office'"; }
  if (group === 'school') { sql += " AND COALESCE(u.user_group, CASE WHEN u.school_code = '54020000' THEN 'office' ELSE 'school' END) = 'school'"; }
  if (status) { sql += ' AND t.status = ?'; args.push(status); }
  if (year) { sql += " AND t.travel_no LIKE ?"; args.push('%/' + year); }
  sql += ' ORDER BY t.id DESC';
  const rows = db.prepare(sql).all(...args);
  const required = approvals.getRequiredLevels('travel');
  // ส่ง travelApprovers (สาย สพป.แพร่ เขต 2) + travelApproversSchool (สายสถานศึกษา 3 ขั้น) เพื่อให้ frontend ตรวจสอบสิทธิ์
  let travelApprovers = {};
  let travelApproversSchool = {};
  try {
    const taRow = db.prepare("SELECT value FROM settings WHERE key = 'travel_approvers'").get();
    travelApprovers = JSON.parse(taRow ? taRow.value : '{}');
    const tasRow = db.prepare("SELECT value FROM settings WHERE key = 'travel_approvers_school'").get();
    travelApproversSchool = JSON.parse(tasRow ? tasRow.value : '{}');
  } catch (e) { /* ignore */ }
  res.json({
    requests: rows.map((r) => ({
      ...r,
      required_levels: approvals.travelRequiredLevels(r.user_id),
      approvals: approvals.parseApprovals(r.approval_data),
    })),
    travelApprovers,
    travelApproversSchool,
  });
});

router.post('/travel', auth.requireAuth, uploadTravelDyn.single('attachment'), uploadErrorHandler, (req, res) => {
  const b = req.body || {};
  if (!b.travel_subject || !String(b.travel_subject).trim()) return res.status(400).json({ error: 'กรุณากรอกเรื่อง/งานที่ไปราชการ' });
  if (!b.destination || !String(b.destination).trim()) return res.status(400).json({ error: 'กรุณากรอกสถานที่ไปราชการ' });
  if (!b.date_from || !b.date_to) return res.status(400).json({ error: 'กรุณาระบุวันเดินทาง (จาก-ถึง)' });
  const days = daysBetween(b.date_from, b.date_to);
  let form_data = b.form_data || {};
  if (typeof form_data === 'string') { try { form_data = JSON.parse(form_data); } catch (_e) {} }
  const attachment = req.file ? getSchoolPrefix(req) + 'travel/' + req.file.filename : null;
  if (attachment) form_data.attachment = attachment;
  const info = db.prepare(`INSERT INTO travel_requests
    (travel_no, user_id, title, destination, date_from, date_to, days, vehicle_id, budget, detail, form_data)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(nextDocNo('travel_requests', 'travel_no'), req.user.id,
    String(b.travel_subject || b.title || '').trim(), String(b.destination).trim(), b.date_from, b.date_to, days,
    b.vehicle_id ? Number(b.vehicle_id) : null, Number(b.budget) || 0, (b.detail || '').trim(),
    JSON.stringify(form_data));
  // แจ้งเตือนผู้บังคับบัญชาขั้นต้นผ่าน Telegram
  telegram.notifyTravelSubmitted(info.lastInsertRowid);
  res.json({ ok: true, id: info.lastInsertRowid, message: 'ส่งคำขออนุญาตไปราชการเรียบร้อย รอผู้ดูแลระบบอนุมัติ' });
});

router.put('/travel/:id/approve', auth.requireApprover, (req, res) => {
  const { note, position } = req.body || {};
  // ถ้ามี position ให้ใช้ position ที่เลือกแทน position ของผู้ใช้
  const user = position ? Object.assign({}, req.user, { position }) : req.user;
  const row = db.prepare('SELECT user_id FROM travel_requests WHERE id = ?').get(Number(req.params.id));
  const result = approvals.approveRequest({ table: 'travel_requests', system: 'travel', id: Number(req.params.id), user, note,
    canApproveFn: (u, lvl) => approvals.canTravelApprover(u, lvl, Number(req.params.id)),
    requiredFn: (r) => approvals.travelRequiredLevels(r.user_id),
    levelLabelFn: (lvl) => approvals.travelLevelLabel(row ? row.user_id : null, lvl) });
  if (result.error) return res.status(result.code || 400).json({ error: result.error });
  if (result.approved) {
    // อนุมัติครบขั้นแล้ว → แจ้งเตือน Telegram (ข้อความสีเขียว 🟢) ไปยังผู้ยื่นคำขอ
    telegram.notifyRequest({ system: 'travel', id: Number(req.params.id), approved: true, deciderName: req.user.full_name, note });
  } else if (result.level >= 1) {
    // ขั้นกลาง (ยังไม่ครบ): L1 ผู้ตรวจสอบยืนยัน → แจ้ง ขั้น2 | L2 ผู้บังคับบัญชาขั้นต้นยืนยัน → แจ้ง ขั้น3 (สายสถานศึกษา)
    telegram.notifyTravelNextLevel(Number(req.params.id), req.user.full_name);
  }
  res.json(result);
});

router.put('/travel/:id/reject', auth.requireApprover, (req, res) => {
  const { note } = req.body || {};
  const result = approvals.rejectRequest({ table: 'travel_requests', id: Number(req.params.id), user: req.user, note });
  if (result.error) return res.status(result.code || 400).json({ error: result.error });
  // ไม่อนุมัติ → แจ้งเตือนทันที (ข้อความสีแดง 🔴) ไปยังผู้ขอ
  telegram.notifyRequest({ system: 'travel', id: Number(req.params.id), approved: false, deciderName: req.user.full_name, note });
  res.json(result);
});

router.delete('/travel/:id', auth.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id, user_id FROM travel_requests WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบรายการ' });
  if (!canEdit(req.user, row)) return res.status(403).json({ error: 'ไม่มีสิทธิ์ลบรายการนี้' });
  db.prepare('DELETE FROM travel_requests WHERE id = ?').run(id);
  res.json({ ok: true, message: 'ลบรายการเรียบร้อย' });
});

// ---------- เมนู 8: ขออนุญาตลา ----------
const LEAVE_TYPES = ['ลากิจ', 'ลาป่วย', 'ลาพักผ่อน', 'ลาคลอดบุตร', 'ลาเข้ารับการตรวจคัดเลือก', 'ลาอื่น ๆ'];

router.get('/leaves', auth.requireAuth, (req, res) => {
  const { status, group, year, ugroup, round } = req.query;  let sql = `SELECT l.*, u.title, u.full_name, u.first_name, u.last_name, u.username, u.position, u.workplace,
    d.full_name AS delegate_name, d.position AS delegate_position FROM leave_requests l
    JOIN users u ON u.id = l.user_id LEFT JOIN users d ON d.id = l.delegate_to WHERE 1=1`;
  const args = [];
  if (group === 'vacation') {
    sql += " AND l.leave_type = 'ลาพักผ่อน'";
  } else if (group === 'general') {
    sql += " AND l.leave_type != 'ลาพักผ่อน'";
  }
  // รอบพิจารณาความชอบ: round1 = 1 ต.ค. ปีที่ผ่านมา - 31 มี.ค. | round2 = 1 เม.ย. - 30 ก.ย. | year = ในรอบปี
  // ยึดปีตามพารามิเตอร์ year (พ.ศ.) ถ้าส่งมา — ทำให้เลือกดูรายการปีอื่น (เช่น ปี 2570) ได้ ไม่ล็อกที่ปีปัจจุบัน
  const yBE = Number(year) || getFiscalYearBE();
  if (round === 'round1' || round === 'round2') {
    const y = yBE - 543;
    const from = round === 'round1' ? (y - 1) + '-10-01' : y + '-04-01';
    const to = round === 'round1' ? y + '-03-31' : y + '-09-30';
    sql += ' AND l.date_from >= ? AND l.date_from <= ?';
    args.push(from, to);
  } else if (round === 'year') {
    // ในรอบปี = ทั้งปีงบประมาณ (1 ต.ค. ปีก่อน - 30 ก.ย. ปีที่เลือก) — ครอบคลุมรอบที่ 1 + รอบที่ 2 พอดี
    const y = yBE - 543;
    sql += " AND l.date_from >= ? AND l.date_from <= ?";
    args.push((y - 1) + '-10-01', y + '-09-30');
  }
  // แยกรายการตามกลุ่มผู้ใช้: ugroup=office → เจ้าหน้าที่ สพป.แพร่ เขต 2 | ugroup=school → เจ้าหน้าที่สถานศึกษา
  if (ugroup === 'office') { sql += " AND COALESCE(u.user_group, CASE WHEN u.school_code = '54020000' THEN 'office' ELSE 'school' END) = 'office'"; }
  if (ugroup === 'school') { sql += " AND COALESCE(u.user_group, CASE WHEN u.school_code = '54020000' THEN 'office' ELSE 'school' END) = 'school'"; }
  if (status) { sql += ' AND l.status = ?'; args.push(status); }
  // ปีงบประมาณ (ปี พ.ศ.): 1 ต.ค. ปีก่อน - 30 ก.ย. ปีที่เลือก (เช่น ปีงบประมาณ 2569 = 1 ต.ค. 2568 - 30 ก.ย. 2569)
  if (year) { const yCE = Number(year) - 543; sql += " AND l.date_from >= ? AND l.date_from <= ?"; args.push((yCE - 1) + '-10-01', yCE + '-09-30'); }
  sql += ' ORDER BY l.id DESC';
  const rows = db.prepare(sql).all(...args);
  const required = approvals.getRequiredLevels('leave');
  res.json({ requests: rows.map((r) => ({ ...r, required_levels: required, approvals: approvals.parseApprovals(r.approval_data) })) });
});

// รายชื่อบุคลากรในกลุ่มงานเดียวกัน (สำหรับมอบหมายงาน)
router.get('/leave-users', auth.requireAuth, (req, res) => {
  const wp = req.user.workplace || '';
  if (!wp) return res.json({ users: [] });
  const rows = db.prepare(`SELECT id, title, full_name, first_name, last_name, position FROM users
    WHERE workplace = ? AND status = 'active' AND id != ? ORDER BY full_name`).all(wp, req.user.id);
  res.json({ users: rows });
});

// ข้อมูลเจ้าหน้าที่การลา 3 ลำดับ (อ่านได้ทุกคน — ใช้เช็คสิทธิ์ ผู้ตรวจสอบ) — รวมทั้ง 2 กลุ่ม (สพป. + สถานศึกษา)
router.get('/leave-approvers-public', auth.requireAuth, (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'leave_approvers'").get();
  const rowSchool = db.prepare("SELECT value FROM settings WHERE key = 'leave_approvers_school'").get();
  let obj = {};
  try { obj = JSON.parse(row ? row.value : '{}'); } catch (e) { /* ignore */ }
  // Flatten per-person data to unique approver IDs per level
  const flatten = (lvData) => {
    if (Array.isArray(lvData)) return lvData.map(Number).filter(Boolean);
    if (lvData && typeof lvData === 'object') {
      const ids = new Set();
      for (const k in lvData) { const v = Number(lvData[k]); if (v) ids.add(v); }
      return [...ids];
    }
    return [];
  };
  let objSchool = {};
  try { objSchool = JSON.parse(rowSchool ? rowSchool.value : '{}'); } catch (e) { /* ignore */ }
  // รวมทั้งสองชุด (office + school) เพื่อให้สิทธิ์ผู้ตรวจสอบ/ผู้อนุมัติครอบคลุมทุกกลุ่ม
  const merged = { '1': {}, '2': {}, '3': {} };
  for (var src of [obj, objSchool]) {
    for (var lv0 = 1; lv0 <= 3; lv0++) {
      var d0 = src[String(lv0)] || {};
      if (typeof d0 === 'object' && !Array.isArray(d0)) {
        for (var k0 in d0) { var v0 = Number(d0[k0]); if (v0) merged[String(lv0)][String(k0)] = v0; }
      }
    }
  }
  const result = { 1: flatten(merged['1']), 2: flatten(merged['2']), 3: flatten(merged['3']) };
  // Also include per-person map so frontend can check per-requester assignment
  const perPerson = { 1: {}, 2: {}, 3: {} };
  for (var lv = 1; lv <= 3; lv++) {
    var lvData = merged[String(lv)] || {};
    if (typeof lvData === 'object' && !Array.isArray(lvData)) {
      for (var k in lvData) { var v = Number(lvData[k]); if (v) perPerson[lv][String(k)] = v; }
    }
  }
  res.json({ approvers: result, perPerson });
});

// ดึงข้อมูลเจ้าหน้าที่ (สำหรับ user ทุกคน)
router.get('/staff-public/:id', auth.requireAuth, (req, res) => {
  const u = db.prepare('SELECT id, citizen_id, title, first_name, last_name, full_name, nickname, position, workplace, phone, email, signature, photo, status, can_approve, role FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'ไม่พบเจ้าหน้าที่' });
  res.json({ user: u });
});

// สถิติการลาปีงบประมาณนี้ (ต.ค. - ก.ย.)
router.get('/leave-stats', auth.requireAuth, (req, res) => {
  const userId = Number(req.query.userId) || req.user.id;
  // excludeId = ไม่นับรายการนี้ (ใช้เมื่อเปิดดู/ตรวจสอบรายการที่กำลังรออนุมัติ เพื่อไม่ให้นับตัวเองใน "ลามาแล้ว")
  const excludeId = Number(req.query.excludeId) || 0;
  const excl = excludeId ? ' AND id != ' + excludeId : '';
  const todayIso = simdate.todayISO(); // YYYY-MM-DD (วันจำลองเมื่อเปิดโหมดจำลอง)
  // ปีงบประมาณ = ต.ค.ปีนี้ ถึง ก.ย.ปีหน้า
  const fyCE = Number(todayIso.slice(0, 4)), fyMo = Number(todayIso.slice(5, 7));
  const fy = fyMo >= 10 ? fyCE : fyCE - 1;
  const fyFrom = `${fy}-10-01`;
  const fyTo = `${fy + 1}-09-30`;    const types = ['ลาป่วย', 'ลากิจ', 'ลาคลอดบุตร'];
    const stats = types.map((t) => {
      const row = db.prepare(`SELECT COALESCE(SUM(days), 0) as total
        FROM leave_requests WHERE user_id = ? AND leave_type = ?
        AND status IN ('approved', 'pending') AND date_from >= ? AND date_from <= ?${excl}`).get(userId, t, fyFrom, fyTo);
      return { leave_type: t, used: row.total };
    });
    // ลาพักผ่อน: นับตามวันที่ลาในปีงบประมาณเดียวกัน (1 ต.ค. - 30 ก.ย.) — ไม่อิงเลขที่ (เลขที่รันตามปี พ.ศ.)
    const vacRow = db.prepare(`SELECT COALESCE(SUM(days), 0) as total
      FROM leave_requests WHERE user_id = ? AND leave_type = 'ลาพักผ่อน'
      AND status IN ('approved', 'pending') AND date_from >= ? AND date_from <= ?${excl}`).get(userId, fyFrom, fyTo);
    stats.push({ leave_type: 'ลาพักผ่อน', used: vacRow.total });
    res.json({ stats, fyYear: fy });
});

// ดึงรายการลาล่าสุดของผู้ใช้ (ลาป่วย/ลากิจ/ลาคลอดบุตร)
router.get('/leave-last', auth.requireAuth, (req, res) => {
  const userId = req.user.id;
  const row = db.prepare(`SELECT date_from, date_to, days, leave_type
    FROM leave_requests WHERE user_id = ? AND leave_type IN ('ลาป่วย', 'ลากิจ', 'ลาคลอดบุตร')
    AND status IN ('approved', 'pending') ORDER BY id DESC LIMIT 1`).get(userId);
  res.json({ last: row || null });
});

router.post('/leaves', auth.requireAuth, uploadLeavesDyn.single('attachment'), uploadErrorHandler, (req, res) => {
  const b = req.body || {};
  if (!b.leave_type) return res.status(400).json({ error: 'กรุณาเลือกประเภทการลา' });
  if (!b.date_from || !b.date_to) return res.status(400).json({ error: 'กรุณาระบุวันลา (จาก-ถึง)' });
  if (b.leave_type === 'ลากิจ' && (!b.reason || !String(b.reason).trim())) return res.status(400).json({ error: 'กรุณากรอกเหตุผลการลากิจ' });
  const days = b.days || daysBetween(b.date_from, b.date_to);
  const attachment = req.file ? getSchoolPrefix(req) + 'leaves/' + req.file.filename : null;
  const info = db.prepare(`INSERT INTO leave_requests
    (leave_no, user_id, leave_type, date_from, date_to, days, reason, address, phone,
     writing_at, last_leave_from, last_leave_to, last_leave_days, attachment, delegate_to)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(nextLeaveNo(b.leave_type), req.user.id,
    b.leave_type, b.date_from, b.date_to, days, (b.reason ? String(b.reason).trim() : null),
    (b.address || '').trim(), (b.phone || '').trim(),
    (b.writing_at || '').trim(),
    b.last_leave_from || null, b.last_leave_to || null,
    b.last_leave_days ? Number(b.last_leave_days) : null,
    attachment,
    b.delegate_to ? Number(b.delegate_to) : null);
  res.json({ ok: true, id: info.lastInsertRowid, message: 'ส่งคำขอลาเรียบร้อย รอผู้ตรวจสอบตรวจสอบ' });
  // แจ้งเตือน Telegram ไปยังผู้ตรวจสอบ (level 1)
  telegram.notifyLeaveSubmitted(info.lastInsertRowid);
});

// ผู้ตรวจสอบ: กด 'ตรวจสอบแล้ว' → ส่งต่อผู้อนุมัติขั้นต้น
router.put('/leaves/:id/review', auth.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบรายการ' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'รายการนี้ไม่รอการตรวจสอบแล้ว' });
  if (row.reviewed) return res.status(400).json({ error: 'รายการนี้ได้รับการตรวจสอบแล้ว' });
  // ตรวจสอบสิทธิ์: ต้องเป็นผู้ตรวจสอบ (leave_approvers level 1 ของกลุ่มผู้ขอ) หรือ admin
  const isAdmin = req.user.role === 'admin';
  let isInspector = false;
  const laRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(requesterApproverKey(row.user_id));
  try {
    const la = JSON.parse(laRow ? laRow.value : '{}');
    const lv1 = la['1'] || {};
    const requesterId = String(row.user_id);
    if (Array.isArray(lv1)) {
      // Old format: global array of inspector IDs
      isInspector = lv1.map(Number).includes(req.user.id);
    } else if (typeof lv1 === 'object') {
      // Per-person format: lv1[requesterId] = inspectorId
      isInspector = Number(lv1[requesterId]) === req.user.id;
    }
  } catch (e) { /* ignore */ }
  if (!isAdmin && !isInspector) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ตรวจสอบคำขอนี้' });
  // บันทึกว่าตรวจสอบแล้ว + เพิ่ม level 1 ใน approval_data + บันทึกสถิติที่แก้ไข
  const reviewedStats = req.body.reviewed_stats || null;
  const existingApprovals = approvals.parseApprovals(row.approval_data);
  existingApprovals.push({ level: 1, by: req.user.id, name: req.user.full_name, role: req.user.role, at: auth.now(), note: 'ตรวจสอบแล้ว' });
  // เลื่อน approval_level → 1 เพื่อให้ระบบนับว่าคำขอกำลังรอผู้อนุมัติขั้นต้น (level 2)
  db.prepare('UPDATE leave_requests SET reviewed = 1, approval_level = 1, reviewed_stats = ?, approval_data = ? WHERE id = ?').run(reviewedStats ? JSON.stringify(reviewedStats) : null, JSON.stringify(existingApprovals), id);
  // แจ้งเตือน Telegram ไปยังผู้อนุมัติขั้นต้น (level 1)
  telegram.notifyLeaveReviewed(id, req.user.full_name);
  res.json({ ok: true, message: '✅ ตรวจสอบแล้ว ส่งต่อผู้อนุมัติขั้นต้นเรียบร้อย' });
});

router.put('/leaves/:id/approve', auth.requireAuth, (req, res) => {
  const { note } = req.body || {};
  const id = Number(req.params.id);
  // ตรวจสอบว่าผู้ใช้มีสิทธิ์อนุมัติขั้นนี้จริง (ใช้ leave_approvers)
  const row = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบรายการ' });
  const approvalsData = approvals.parseApprovals(row.approval_data);
  const nextLevel = approvalsData.length + 1;
  const isAdmin = req.user.role === 'admin';
  let canDo = false;
  if (isAdmin) { canDo = true; } else {
    // Helper: check per-person approver for a requester at a given level (ใช้ชุดตั้งค่าตามกลุ่มของผู้ขอ)
    const checkPerLevel = (lv, requesterId, userId) => {
      const laRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(requesterApproverKey(requesterId));
      try {
        const la = JSON.parse(laRow ? laRow.value : '{}');
        const lvData = la[String(lv)] || {};
        if (Array.isArray(lvData)) return lvData.map(Number).includes(userId);
        if (typeof lvData === 'object') return Number(lvData[String(requesterId)]) === userId;
      } catch (e) { /* ignore */ }
      return false;
    };
    if (nextLevel === 2) {
      // level 2: check per-person level 2 approver for the requester
      canDo = checkPerLevel(2, row.user_id, req.user.id);
    } else if (nextLevel === 3) {
      // level 3: check per-person level 3 approver for the requester
      canDo = checkPerLevel(3, row.user_id, req.user.id);
    } else {
      canDo = checkPerLevel(nextLevel, row.user_id, req.user.id);
    }
  }
  if (!canDo) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์อนุมัติขั้นนี้' });
  const result = approvals.approveRequest({ table: 'leave_requests', system: 'leave', id, user: req.user, note,
    canApproveFn: () => canDo });
  if (result.error) return res.status(result.code || 400).json({ error: result.error });
  if (result.approved) {
    // อนุมัติครบทุกขั้น → แจ้ง Telegram กลับผู้ขอ (สีเขียว 🟢)
    telegram.notifyRequest({ system: 'leave', id, approved: true, deciderName: req.user.full_name, note });
  } else {
    // ยังไม่ครบทุกขั้น → แจ้ง Telegram ไปยังผู้อนุมัติขั้นถัดไป
    telegram.notifyLeaveNextLevel(id, req.user.full_name);
  }
  res.json(result);
});

router.put('/leaves/:id/reject', auth.requireAuth, (req, res) => {
  const { note } = req.body || {};
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบรายการ' });
  // ตรวจสอบสิทธิ์: admin หรือผู้ที่เป็นผู้อนุมัติ/ผู้ตรวจสอบของผู้ขอ
  const isAdmin = req.user.role === 'admin';
  let canDo = false;
  if (isAdmin) { canDo = true; } else {
    const laRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(requesterApproverKey(row.user_id));
    try {
      const la = JSON.parse(laRow ? laRow.value : '{}');
      for (const lvl of ['1','2','3']) {
        const lvData = la[lvl] || {};
        if (Array.isArray(lvData)) {
          if (lvData.map(Number).includes(req.user.id)) { canDo = true; break; }
        } else if (typeof lvData === 'object') {
          if (Number(lvData[String(row.user_id)]) === req.user.id) { canDo = true; break; }
        }
      }
    } catch (e) { /* ignore */ }
  }
  if (!canDo) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์พิจารณาคำขอนี้' });
  const result = approvals.rejectRequest({ table: 'leave_requests', id, user: req.user, note, allowFn: () => true });
  if (result.error) return res.status(result.code || 400).json({ error: result.error });
  // ไม่อนุมัติ → แจ้ง Telegram กลับผู้ขอ (สีแดง 🔴)
  telegram.notifyRequest({ system: 'leave', id, approved: false, deciderName: req.user.full_name, note });
  res.json(result);
});

router.delete('/leaves/:id', auth.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id, user_id FROM leave_requests WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบรายการ' });
  if (!canEdit(req.user, row)) return res.status(403).json({ error: 'ไม่มีสิทธิ์ลบรายการนี้' });
  db.prepare('DELETE FROM leave_requests WHERE id = ?').run(id);
  res.json({ ok: true, message: 'ลบรายการเรียบร้อย' });
});

// ---------- ขอยกเลิกวันลา (เฉพาะรายการอนุมัติแล้ว — เจ้าของหรือ admin) ----------
// ส่งเรื่องให้ผู้ตรวจสอบ (level 1) พิจารณา และสิ้นสุดที่ผู้ตรวจสอบ (ไม่ส่งต่อขั้นถัดไป)
router.post('/leaves/:id/cancel-request', auth.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id, user_id, status, cancel_status FROM leave_requests WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบรายการ' });
  const isOwner = row.user_id === req.user.id;
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isAdmin) return res.status(403).json({ error: 'เฉพาะเจ้าของรายการหรือผู้ดูแลระบบเท่านั้น' });
  if (row.status !== 'approved') return res.status(400).json({ error: 'ยกเลิกได้เฉพาะรายการที่อนุมัติแล้วเท่านั้น' });
  if (row.cancel_status === 'cancel_requested') return res.status(400).json({ error: 'รายการนี้อยู่ระหว่างรอยกเลิกแล้ว' });
  db.prepare("UPDATE leave_requests SET cancel_status = 'cancel_requested' WHERE id = ?").run(id);
  // แจ้งเตือน Telegram ไปยังผู้ตรวจสอบ (level 1 ของผู้ขอ) ว่ามีการขอยกเลิกวันลา
  telegram.notifyLeaveCancelRequested(id);
  res.json({ ok: true, message: 'ส่งคำขอยกเลิกวันลาไปยังผู้ตรวจสอบเรียบร้อย' });
});

// ผู้ตรวจสอบ: ยืนยันยกเลิกวันลา → ลบรายการ (สถิติคำนวณใหม่อัตโนมัติเพราะนับจากตาราง) + แจ้งผู้ขอ
router.put('/leaves/:id/cancel-confirm', auth.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id, user_id, cancel_status FROM leave_requests WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบรายการ' });
  if (row.cancel_status !== 'cancel_requested') return res.status(400).json({ error: 'รายการนี้ไม่ได้อยู่ระหว่างรอยกเลิก' });
  const isAdmin = req.user.role === 'admin';
  let isInspector = false;
  const laRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(requesterApproverKey(row.user_id));
  try {
    const la = JSON.parse(laRow ? laRow.value : '{}');
    const lv1 = la['1'] || {};
    const requesterId = String(row.user_id);
    if (Array.isArray(lv1)) {
      isInspector = lv1.map(Number).includes(req.user.id);
    } else if (typeof lv1 === 'object') {
      isInspector = Number(lv1[requesterId]) === req.user.id;
    }
  } catch (e) { /* ignore */ }
  if (!isAdmin && !isInspector) return res.status(403).json({ error: 'เฉพาะผู้ตรวจสอบของผู้ขอหรือผู้ดูแลระบบเท่านั้น' });
  // แจ้ง Telegram ผู้ขอยกเลิกก่อนลบรายการ (ต้องดึงข้อมูลแถวเดิม)
  telegram.notifyLeaveCancelled(id, req.user.full_name);
  // ลบรายการวันลา — สถิติ (จำนวนครั้ง/จำนวนวัน) คำนวณจากตารางโดยตรง จึงถูกต้องทันทีหลังลบ
  db.prepare('DELETE FROM leave_requests WHERE id = ?').run(id);
  res.json({ ok: true, message: 'ยกเลิกวันลาเรียบร้อย รายการถูกลบและสถิติปรับใหม่แล้ว' });
});

// แก้ไขคำขอลา — เจ้าของหรือ admin (admin แก้ไขได้ทุกรายการในระบบ)
router.put('/leaves/:id', auth.requireAuth, uploadLeavesDyn.single('attachment'), uploadErrorHandler, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบรายการ' });
  if (!canEdit(req.user, row)) return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขรายการนี้' });
  const b = req.body || {};
  const leaveType = b.leave_type ? String(b.leave_type).trim() : row.leave_type;
  if (leaveType === 'ลากิจ' && b.leave_type && (!b.reason || !String(b.reason).trim())) return res.status(400).json({ error: 'กรุณากรอกเหตุผลการลากิจ' });
  const dateFrom = b.date_from || row.date_from;
  const dateTo = b.date_to || row.date_to;
  const days = b.days ? Number(b.days) : row.days;
  const attachment = req.file ? getSchoolPrefix(req) + 'leaves/' + req.file.filename : row.attachment;
  db.prepare(`UPDATE leave_requests SET
    leave_type = ?, date_from = ?, date_to = ?, days = ?, reason = ?, address = ?, phone = ?,
    writing_at = ?, last_leave_from = ?, last_leave_to = ?, last_leave_days = ?, attachment = ?, delegate_to = ?
    WHERE id = ?`).run(
    leaveType, dateFrom, dateTo, days,
    b.reason !== undefined ? String(b.reason || '').trim() : (row.reason || ''),
    b.address !== undefined ? String(b.address || '').trim() : (row.address || ''),
    b.phone !== undefined ? String(b.phone || '').trim() : (row.phone || ''),
    b.writing_at !== undefined ? String(b.writing_at || '').trim() : (row.writing_at || ''),
    b.last_leave_from || null, b.last_leave_to || null,
    b.last_leave_days ? Number(b.last_leave_days) : null,
    attachment,
    b.delegate_to ? Number(b.delegate_to) : null,
    id);
  res.json({ ok: true, message: 'แก้ไขคำขอลาเรียบร้อย' });
});

// ---------- วันลาพักผ่อนสะสมของฉัน (user ทั่วไปใช้ได้) ----------
router.get('/my-leave-balance', auth.requireAuth, (req, res) => {
  // ค่าเริ่มต้น = ปีงบประมาณปัจจุบัน (1 ต.ค. เริ่มปีงบใหม่ทันที เช่น 1 ต.ค. 2569 = ปีงบประมาณ 2570) — เรียกดูปีเก่าได้ด้วย ?year=
  const year = Number(req.query.year) || getFiscalYearBE();
  const bal = db.prepare('SELECT vacation_accumulated, vacation_annual FROM user_leave_balances WHERE user_id = ? AND year = ?').get(req.user.id, year);
  const accumulated = bal ? bal.vacation_accumulated : 0;
  const annual = bal ? bal.vacation_annual : 10;
  const total = accumulated + annual;
  // ดึงยอดลาพักผ่อนที่ใช้ไปแล้ว "ปีงบประมาณนี้" (1 ต.ค. ปีก่อน - 30 ก.ย. ปีที่เลือก) — เดิมนับตามปีปฏิทินซึ่งคลาดเคลื่อนช่วง ต.ค.-ธ.ค.
  const usedRow = db.prepare("SELECT COALESCE(SUM(days),0) as total FROM leave_requests WHERE user_id = ? AND leave_type = 'ลาพักผ่อน' AND status = 'approved' AND date_from >= ? AND date_from <= ?").get(req.user.id, (year - 544) + '-10-01', (year - 543) + '-09-30');
  const used = usedRow ? (usedRow.total || 0) : 0;
  const remaining = total - used;
  res.json({ accumulated, annual, total, used, remaining, year });
});

// ---------- เมนู วันลาพักผ่อนสะสม ----------
router.get('/leave-balances', auth.requireAuth, (req, res) => {
  const isAdmin = req.user.role === 'admin';
  // ตรวจสอบสิทธิ์: admin, can_approve, หรือผู้ตรวจสอบ (leave_approvers level 1)
  let isLeaveInspector = false;
  if (!isAdmin && !req.user.can_approve) {
    const laRow = db.prepare("SELECT value FROM settings WHERE key = 'leave_approvers'").get();
    let la = {};
    try { la = JSON.parse(laRow ? laRow.value : '{}'); } catch (e) { /* ignore */ }
    const inspectorIds = Array.isArray(la['1']) ? la['1'].map(Number) : [];
    if (inspectorIds.includes(req.user.id)) isLeaveInspector = true;
  }
  if (!isAdmin && !req.user.can_approve && !isLeaveInspector) return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบ ผู้อนุมัติ หรือผู้ตรวจสอบเท่านั้น' });
  // ค่าเริ่มต้น = ปีงบประมาณปัจจุบัน (พอถึง 1 ต.ค. เปลี่ยนเป็นปีงบใหม่ทันที) — ข้อมูลปีเก่าเก็บครบตามคอลัมน์ year เรียกดูย้อนหลังได้
  const year = Number(req.query.year) || getFiscalYearBE(); // พ.ศ. (ปีงบประมาณ)
  // ดึงรายชื่อบุคลากรทั้งหมดที่ active
  // เรียงตามลำดับเจ้าหน้าที่ (staff_no) เหมือนหน้าเจ้าหน้าที่ — ผู้ที่ยังไม่กำหนดลำดับอยู่ท้ายสุด (เรียงตาม id)
  const users = db.prepare(`SELECT id, title, full_name, first_name, last_name, position, workplace, staff_no, user_group,
    ROW_NUMBER() OVER (ORDER BY CASE WHEN staff_no IS NULL OR staff_no = '' THEN 1 ELSE 0 END, CAST(staff_no AS INTEGER) ASC, id ASC) AS seq
    FROM users WHERE status = 'active'`).all();
  // ดึงยอดลาพักผ่อนที่ได้รับอนุมัติแล้วปีนี้
  // "ลาปีนี้" นับตามปีงบประมาณ (1 ต.ค. ปีก่อน - 30 ก.ย. ปีที่เลือก) เช่น ปีงบประมาณ 2569 = 1 ต.ค. 2568 - 30 ก.ย. 2569
  const usedRows = db.prepare(`SELECT user_id, SUM(days) as total FROM leave_requests WHERE leave_type = 'ลาพักผ่อน' AND status = 'approved' AND date_from >= ? AND date_from <= ? GROUP BY user_id`).all((year - 544) + '-10-01', (year - 543) + '-09-30');
  const usedMap = {};
  usedRows.forEach(r => { usedMap[r.user_id] = r.total; });
  // ดึงยอดสะสมและประจำปี
  const balRows = db.prepare('SELECT user_id, vacation_accumulated, vacation_annual FROM user_leave_balances WHERE year = ?').all(year);
  const balMap = {};
  balRows.forEach(r => { balMap[r.user_id] = r; });
  const result = users.map(u => {
    const bal = balMap[u.id] || { vacation_accumulated: 0, vacation_annual: 10 };
    const hasData = !!balMap[u.id]; // มีแถวตั้งค่าจริงของปีนี้หรือไม่ (admin ยังไม่ได้ตั้งค่า = false)
    const accumulated = bal.vacation_accumulated;
    const annual = bal.vacation_annual;
    const total = accumulated + annual;
    const used = usedMap[u.id] || 0;
    const remaining = total - used;
    return { ...u, accumulated, annual, total, used, remaining, hasData };
  });
  // hasDataAny = มีการตั้งค่าวันลาของปีที่เลือกแล้วอย่างน้อย 1 คน (ใช้ชั่วคราวแสดงข้อมูลปีก่อนหน้าตอนเปลี่ยนปีงบประมาณ)
  const hasDataAny = Object.keys(balMap).length > 0;
  res.json({ balances: result, year, hasDataAny });
});

router.put('/leave-balances/:userId', auth.requireAuth, (req, res) => {
  const userId = Number(req.params.userId);
  const isAdmin = req.user.role === 'admin';
  // ตรวจสอบสิทธิ์: admin หรือผู้ตรวจสอบ (leave_approvers level 1)
  let isLeaveInspector = false;
  const laRow = db.prepare("SELECT value FROM settings WHERE key = 'leave_approvers'").get();
  let la = {};
  try { la = JSON.parse(laRow ? laRow.value : '{}'); } catch (e) { /* ignore */ }
  const inspectorIds = Array.isArray(la['1']) ? la['1'].map(Number) : [];
  if (inspectorIds.includes(req.user.id)) isLeaveInspector = true;
  if (!isAdmin && !isLeaveInspector) return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบหรือผู้ตรวจสอบเท่านั้น' });
  const u = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!u) return res.status(404).json({ error: 'ไม่พบเจ้าหน้าที่' });
  const b = req.body || {};
  const year = Number(b.year) || getFiscalYearBE();
  const accumulated = Number(b.vacation_accumulated) || 0;
  const annual = Number(b.vacation_annual) || 0;
  db.prepare(`INSERT INTO user_leave_balances (user_id, year, vacation_accumulated, vacation_annual)
    VALUES (?,?,?,?) ON CONFLICT(user_id, year) DO UPDATE SET vacation_accumulated=excluded.vacation_accumulated, vacation_annual=excluded.vacation_annual
  `).run(userId, year, accumulated, annual);
  res.json({ ok: true, message: 'บันทึกข้อมูลวันลาพักผ่อนเรียบร้อย' });
});

// === GET/PUT settings/leave-approvers (admin) ===
// Data format: { "1": { "staffId": approverId, ... }, "2": {...}, "3": {...} }
// Each staff member picks their own inspector/approver per level
// แยกตามกลุ่มผู้ใช้: ?scope=office → key 'leave_approvers' | ?scope=school → key 'leave_approvers_school'
const leaveApproverKeys = { office: 'leave_approvers', school: 'leave_approvers_school' };
function leaveApproverKey(scope) {
  return leaveApproverKeys[scope === 'school' ? 'school' : 'office'] || 'leave_approvers';
}
// หา scope ของผู้ขอ (requester) จาก user_group/school_code — ใช้เลือกชุดการตั้งค่าที่ถูกต้องตอนตรวจ/อนุมัติ
function requesterApproverKey(userId) {
  const u = db.prepare('SELECT user_group, school_code FROM users WHERE id = ?').get(userId);
  if (!u) return 'leave_approvers';
  const group = u.user_group || (u.school_code === '54020000' ? 'office' : 'school');
  return group === 'school' ? 'leave_approvers_school' : 'leave_approvers';
}
router.get('/settings/leave-approvers', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const key = leaveApproverKey(req.query.scope);
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  let obj = {};
  try { obj = JSON.parse(row ? row.value : '{}'); } catch (e) { /* ignore */ }
  // Normalize: support both old array format and new per-person object format
  const approvers = { 1: {}, 2: {}, 3: {} };
  for (var lv = 1; lv <= 3; lv++) {
    var lvData = obj[String(lv)] || {};
    if (Array.isArray(lvData)) {
      // Old format migration: empty arrays
      approvers[lv] = {};
    } else if (typeof lvData === 'object') {
      approvers[lv] = {};
      for (var k in lvData) {
        var v = Number(lvData[k]);
        if (v) approvers[lv][String(k)] = v;
      }
    }
  }
  res.json({ approvers });
});

router.put('/settings/leave-approvers', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const key = leaveApproverKey(req.query.scope);
  const b = req.body || {};
  const data = { '1': {}, '2': {}, '3': {} };
  for (var lv = 1; lv <= 3; lv++) {
    var lvObj = b[String(lv)] || {};
    if (typeof lvObj === 'object' && !Array.isArray(lvObj)) {
      for (var staffId in lvObj) {
        var approverId = Number(lvObj[staffId]);
        if (approverId) data[String(lv)][String(staffId)] = approverId;
      }
    }
  }
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(data));
  res.json({ ok: true, message: 'บันทึกเจ้าหน้าที่การลาเรียบร้อย', approvers: data });
});

module.exports = router;
