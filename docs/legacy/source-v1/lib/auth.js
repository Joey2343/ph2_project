'use strict';
const crypto = require('crypto');
const db = require('../db');
const bcrypt = require('bcryptjs');

const SESSION_DAYS = 7;

/**
 * บทบาทในระบบ (5 ระดับ)
 * - admin     : ผู้ดูแลระบบ — ดู/แก้ไขได้ทุกส่วน
 * - staff     : เจ้าหน้าที่ในสำนักงาน — ใช้ได้ทุกเมนู แต่แก้ไขระบบ/ข้อมูลคนอื่นไม่ได้
 * - group_head: ผู้อำนวยการกลุ่ม/หน่วย — อนุมัติขั้นที่ 1 (ขั้นต้น) เมื่อ admin กำหนดให้
 * - deputy    : รองผู้อำนวยการ สพป.แพร่ เขต 2 — อนุมัติขั้นที่ 2-3 (ขั้นกลาง/ขั้นสูง) เมื่อ admin กำหนดให้
 * - director  : ผู้อำนวยการ สพป.แพร่ เขต 2 — อนุมัติขั้นที่ 3 (ขั้นสูง) เมื่อ admin กำหนดให้
 */
const ROLES = {
  admin: { label: 'ผู้ดูแลระบบ', approveLevels: [1, 2, 3], icon: '⭐' },
  staff: { label: 'เจ้าหน้าที่ในสำนักงาน', approveLevels: [], icon: '👤' },
  group_head: { label: 'ผู้อำนวยการกลุ่ม/หน่วย', approveLevels: [1], icon: '🧑‍💼' },
  deputy: { label: 'รองผู้อำนวยการ สพป.แพร่ เขต 2', approveLevels: [2, 3], icon: '👔' },
  director: { label: 'ผู้อำนวยการ สพป.แพร่ เขต 2', approveLevels: [3], icon: '🎓' },
};

function roleLabel(role) {
  return (ROLES[role] || ROLES.staff).label;
}

function roleIcon(role) {
  return (ROLES[role] || ROLES.staff).icon;
}

/** รายชื่อ user_id ที่ได้รับสิทธิ์แก้ไข/ดูบันทึกเวลาทั้งหมด (admin ตั้งค่า) */
function getTimeEditorIds() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'time_edit_users'").get();
    const arr = JSON.parse(row ? row.value : '[]');
    return Array.isArray(arr) ? arr.filter((n) => Number.isInteger(Number(n))).map(Number) : [];
  } catch (e) {
    return [];
  }
}

/** ผู้ใช้มีสิทธิ์แก้ไข/ดูบันทึกเวลาทั้งหมดหรือไม่ (admin มีเสมอ) */
function isTimeEditor(user) {
  if (!user || user.status !== 'active') return false;
  if (user.role === 'admin') return true;
  return getTimeEditorIds().includes(user.id);
}

/** ผู้ใช้สามารถอนุมัติขั้นที่ `level` ได้หรือไม่ (ต้องมีสิทธิ์อนุมัติที่ admin กำหนดให้) */
function canApprove(user, level) {
  if (!user || user.status !== 'active') return false;
  if (user.role === 'admin') return true;
  if (!user.can_approve) return false;
  const meta = ROLES[user.role];
  if (!meta) return false;
  return meta.approveLevels.includes(Number(level));
}

/** ผู้ใช้มีสิทธิ์พิจารณาคำขอใด ๆ (admin หรือผู้ที่ได้รับสิทธิ์อนุมัติ) */
function isApprover(user) {
  if (!user || user.status !== 'active') return false;
  if (user.role === 'admin') return true;
  return !!user.can_approve && ROLES[user.role].approveLevels.length > 0;
}

// อายุเซสชันต้องเทียบกับ "เวลาจริง" เสมอ — ไม่ใช่เวลาจำลอง (มิฉะนั้นการเปิดโหมดจำลองจะเลื่อนทุกเซสชันออก)
const simdate = require('./simdate');

function now() {
  return simdate.realNowISO();
}

function newSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(simdate.realNowMs() + SESSION_DAYS * 24 * 3600 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(token, userId, expires);
  return token;
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function getSessionUser(token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!row) return null;
  if (row.expires_at < now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
}

function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}

function verifyPassword(pw, hash) {
  return bcrypt.compareSync(pw, hash);
}

/** ดึงค่า cookie จาก header */
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/** ตรวจสอบเลขบัตรประชาชน 13 หลัก ตามหลักการ checksum */
function isValidCitizenId(id) {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(id[i], 10) * (13 - i);
  const check = (11 - (sum % 11)) % 10;
  return check === parseInt(id[12], 10);
}

/** ตรวจสอบรหัสผ่าน: อย่างน้อย 8 ตัวอักษร มีตัวพิมพ์ใหญ่ ตัวเลข และอักขระพิเศษ */
function validatePasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร';
  if (!/[A-Z]/.test(pw)) return 'รหัสผ่านต้องมีตัวพิมพ์ใหญ่อย่างน้อย 1 ตัว';
  if (!/[a-z]/.test(pw)) return 'รหัสผ่านต้องมีตัวพิมพ์เล็กอย่างน้อย 1 ตัว';
  if (!/\d/.test(pw)) return 'รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'รหัสผ่านต้องมีอักขระพิเศษอย่างน้อย 1 ตัว (เช่น @ # $ *)';
  return null;
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    title: u.title,
    full_name: u.full_name,
    first_name: u.first_name,
    last_name: u.last_name,
    nickname: u.nickname,
    blood_type: u.blood_type,
    academic_rank: u.academic_rank,
    highest_education: u.highest_education,
    birth_date: u.birth_date,
    citizen_id: u.citizen_id,
    staff_no: u.staff_no,
    position: u.position,
    workplace: u.workplace,
    school_code: u.school_code || '',
    phone: u.phone,
    email: u.email,
    telegram_token: u.telegram_token,
    telegram_chat_id: u.telegram_chat_id,
    photo: u.photo,
    signature: u.signature,
    user_group: u.user_group || 'office',
    workplace_secondary: u.workplace_secondary || '[]',
    current_school: u.current_school || '',
    role: u.role,
    role_label: roleLabel(u.role),
    can_approve: !!u.can_approve,
    is_time_editor: isTimeEditor(u),
    status: u.status,
    created_at: u.created_at,
    approved_at: u.approved_at,
  };
}

/** Middleware: ผูกผู้ใช้จาก session cookie เข้ากับ req.user */
function attachUser(req, res, next) {
  const cookies = parseCookies(req.headers.cookie || '');
  const user = getSessionUser(cookies.sid);
  req.user = user;
  req.sessionToken = cookies.sid || null;
  next();
}

/** ต้องเข้าสู่ระบบ */
function requireAuth(req, res, next) {
  if (!req.user || req.user.status !== 'active') {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' });
  }
  next();
}

/** ต้องเป็นผู้ดูแลระบบ */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.status !== 'active') {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถใช้งานส่วนนี้ได้' });
  }
  next();
}

/** ต้องเป็นผู้มีสิทธิ์อนุมัติ (admin หรือได้รับสิทธิ์อนุมัติจาก admin) — รวมถึงผู้ถูกกำหนดในสายอนุมัติไปราชการ (สถานศึกษา) */
function requireApprover(req, res, next) {
  if (!req.user || req.user.status !== 'active') {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' });
  }
  const approvals = require('./approvals'); // lazy — กัน circular dependency
  if (!isApprover(req.user) && !approvals.isSchoolTravelApprover(req.user.id)) {
    return res.status(403).json({ error: 'คุณไม่มีสิทธิ์อนุมัติคำขอในระบบนี้' });
  }
  next();
}

module.exports = {
  now, newSession, destroySession, getSessionUser, hashPassword, verifyPassword,
  parseCookies, isValidCitizenId, validatePasswordStrength, publicUser,
  attachUser, requireAuth, requireAdmin, requireApprover,
  ROLES, roleLabel, roleIcon, canApprove, isApprover,
  getTimeEditorIds, isTimeEditor,
};
