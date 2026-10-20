'use strict';
const crypto = require('crypto');
const db = require('../db');
const bcrypt = require('bcryptjs');

/**
 * อายุเซสชัน
 *
 * ⚠️ เดิมใช้ค่าเดียวคือ SESSION_DAYS = 7 วัน และ "ไม่เคยล้างแถวที่หมดอายุทิ้ง"
 *   ทุกครั้งที่ล็อกอินจะ INSERT 1 แถว ถ้าอ่านก็เช็คแค่ว่าหมดอายยหรือยัง (auth.js เดิม)
 *   แต่ไม่มี DELETE FROM sessions WHERE expires_at < ... ที่ไหนเลยทั้งระบบ
 *   → ตารางโตไม่จำกัด ทั้งที่ไม่มีใครใช้แถวเก่าอีกแล้ว
 *
 * ตอนนี้เปลี่ยนเป็น "ต่ออายุตามการใช้งานจริง" (sliding expiry)
 *   · ล็อกอิน          → expires_at = เวลาจริงตอนนี้ + SESSION_IDLE_MINUTES
 *   · ผู้ใช้ยังใช้อยู่ → หน้าเว็บยิง POST /auth/keepalive (ทุก 5 นาทีที่มีการใช้งาน)
 *                       → เลื่อน expires_at ไปอีก SESSION_IDLE_MINUTES
 *   · ไม่แตะเว็บเกิน 1 ชั่วโมง → session หมดอายุเองฝั่ง server
 *                       (ปิดเครื่องทิ้งไว้แล้วกลับมาวันหน้าก็ต้องล็อกอินใหม่)
 *   · มี purgeExpiredSessions() คัดลบแถวที่หมดอายุทิ้ง (เรียกตอนบูต + ทุก 30 นาที)
 *
 * SESSION_DAYS ยังเก็บไว้ เพราะเป็นอายุ cookie ฝั่งเบราว์เซอร์
 * (server เป็นผู้ตัดสินจริง แต่ถ้า cookie ตายเร็วกว่า server ผู้ใช้จะโดนเด้งออกโดยไม่ได้ใช้)
 */
const SESSION_IDLE_MINUTES = 60;
const SESSION_DAYS = 7;

/**
 * บทบาทในระบบ — แยกเป็น 2 กลุ่มตามฝั่งของผู้ใช้
 *
 * ฝั่ง สพป.แพร่ เขต 2 (user_group = 'office')
 * ──────────────────────────────────────
 * - admin     : ผู้ดูแลระบบ — ดู/แก้ไขได้ทุกส่วน
 * - staff     : เจ้าหน้าที่ในสำนักงาน — ใช้ได้ทุกเมนู แต่แก้ไขระบบ/ข้อมูลคนอื่นไม่ได้
 * - group_head: ผู้อำนวยการกลุ่ม/หน่วย — อนุมัติขั้นที่ 1 (ขั้นต้น) เมื่อ admin กำหนดให้
 * - deputy    : รองผู้อำนวยการ สพป.แพร่ เขต 2 — อนุมัติขั้นที่ 2-3 (ขั้นกลาง/ขั้นสูง) เมื่อ admin กำหนดให้
 * - director  : ผู้อำนวยการ สพป.แพร่ เขต 2 — อนุมัติขั้นที่ 3 (ขั้นสูง) เมื่อ admin กำหนดให้
 *
 * ฝั่งสถานศึกษา (user_group = 'school')
 * ───────────────────────────────
 * - school_director : ผู้อำนวยการสถานศึกษา
 * - school_deputy   : รองผู้อำนวยการสถานศึกษา
 * - teacher         : ครู
 * - school_clerk    : เจ้าหน้าที่ธุรการ
 * - school_staff    : บทบาทเดิมของสถานศึกษา (คงไว้ให้ข้อมูลเก่าแสดงผลได้)
 *
 * ⚠️ บทบาทฝั่งสถานศึกษา approveLevels = [] ทั้งหมด
 *    เพราะการอนุมัติสายสถานศึกษาไม่ได้ใช้บทบาทนี้เลย
 *    ระบบกำหนดผู้อนุมัติไว้ที่แท็บ "ตั้งค่าการอนุมัติ" และผู้อนุมัติต้องเป็นเจ้าหน้าที่ สพป.แพร่ เขต 2
 *    (ดู canTravelApprover → isOfficeUser)
 *    ตั้งเป็น [] เพื่อไม่ให้บทบาทฝั่งสถานศึกษาไปเปิดสิทธิ์อนุมัติที่ไม่ควรได้
 */
const ROLES = {
  admin: { label: 'ผู้ดูแลระบบ', approveLevels: [1, 2, 3], icon: '⭐', group: 'office' },
  staff: { label: 'เจ้าหน้าที่ในสำนักงาน', approveLevels: [], icon: '👤', group: 'office' },
  group_head: { label: 'ผู้อำนวยการกลุ่ม/หน่วย', approveLevels: [1], icon: '🧑‍💼', group: 'office' },
  deputy: { label: 'รองผู้อำนวยการ สพป.แพร่ เขต 2', approveLevels: [2, 3], icon: '👔', group: 'office' },
  director: { label: 'ผู้อำนวยการ สพป.แพร่ เขต 2', approveLevels: [3], icon: '🎓', group: 'office' },

  school_director: { label: 'ผู้อำนวยการสถานศึกษา', approveLevels: [], icon: '🎓', group: 'school' },
  school_deputy: { label: 'รองผู้อำนวยการสถานศึกษา', approveLevels: [], icon: '👔', group: 'school' },
  teacher: { label: 'ครู', approveLevels: [], icon: '👩‍🏫', group: 'school' },
  school_clerk: { label: 'เจ้าหน้าที่ธุรการ', approveLevels: [], icon: '🗂️', group: 'school' },
  school_staff: { label: 'เจ้าหน้าที่สถานศึกษา', approveLevels: [], icon: '🏫', group: 'school' },
};

/** ลำดับบทบาทฝั่งสถานศึกษาที่แสดงในหน้ากำหนดสิทธิ์ (สูง → ต่ำ) */
const SCHOOL_ROLE_ORDER = ['school_director', 'school_deputy', 'teacher', 'school_clerk'];

/**
 * บทบาทที่ให้เลือกได้ สำหรับ user_group นี้
 * @param {'office'|'school'} group
 * @returns {string[]} รหัสบทบาท
 */
function rolesForGroup(group) {
  if (group === 'school') return SCHOOL_ROLE_ORDER.slice();
  return Object.keys(ROLES).filter((k) => ROLES[k].group === 'office');
}

/**
 * บทบาทนี้ใช้กับ user_group นี้ได้ไหม
 *
 * ⚠️ admin ใช้ได้ทั้งสองฝั่ง เพราะคือผู้ดูแลระบบ ไม่ใช่บทบาทของหน่วยงาน
 *    (หน้าเว็บจึงแสดง admin เป็นตัวเลือกเสมอ ไม่ว่าจะอยู่ฝั่งไหน)
 */
function isValidRoleFor(role, group) {
  if (!ROLES[role]) return false;
  if (role === 'admin') return true;
  return ROLES[role].group === (group === 'school' ? 'school' : 'office');
}

function roleLabel(role) {
  return (ROLES[role] || ROLES.staff).label;
}

function roleIcon(role) {
  return (ROLES[role] || ROLES.staff).icon;
}

/** รายชื่อ user_id ที่ได้รับสิทธิ์แก้ไข/ดูบันทึกเวลาทั้งหมด (admin ตั้งค่า) */
async function getTimeEditorIds() {
  try {
    const row = await db.prepare("SELECT value FROM settings WHERE `key` = 'time_edit_users'").get();
    const arr = JSON.parse(row ? row.value : '[]');
    return Array.isArray(arr) ? arr.filter((n) => Number.isInteger(Number(n))).map(Number) : [];
  } catch (e) {
    return [];
  }
}

/** ผู้ใช้มีสิทธิ์แก้ไข/ดูบันทึกเวลาทั้งหมดหรือไม่ (admin มีเสมอ) */
async function isTimeEditor(user) {
  if (!user || user.status !== 'active') return false;
  if (user.role === 'admin') return true;
  return (await getTimeEditorIds()).includes(user.id);
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
  if (!user.can_approve) return false;
  // ⚠️ ต้องกันไว้ เพราะ role อาจไม่มีในตาราง ROLES
  //    เช่น ข้อมูลเก่าที่ role เป็นค่าว่าง หรือค่าที่ถูกลบออกจากระบบ
  //    ถ้าไม่กัน → ROLES[user.role].approveLevels จะกลายเป็น undefined.approveLevels
  //    → TypeError → route ตอบ 500 แทนที่จะตอบ 403
  //    (เคยพังกับบทบาท school_staff ที่ไม่ได้อยู่ใน ROLES เดิม)
  const meta = ROLES[user.role];
  if (!meta) return false;
  return (meta.approveLevels || []).length > 0;
}

// อายุเซสชันต้องเทียบกับ "เวลาจริง" เสมอ — ไม่ใช่เวลาจำลอง (มิฉะนั้นการเปิดโหมดจำลองจะเลื่อนทุกเซสชันออก)
const simdate = require('./simdate');

function now() {
  return simdate.realNowISO();
}

/** รูปแบบเวลาในคอลัมน์ expires_at (varchar) = 'YYYY-MM-DD HH:MM:SS' — เรียงเทียบแบบ string ได้ตรง ๆ */
function toSqlTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/** เวลาหมดอายุของเซสชัน = เวลาจริงตอนนี้ + SESSION_IDLE_MINUTES */
function idleExpiryISO() {
  return toSqlTime(simdate.realNowMs() + SESSION_IDLE_MINUTES * 60 * 1000);
}

async function newSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(
    token, userId, idleExpiryISO(),
  );
  return token;
}

/**
 * เลื่อนอายุเซสชัน (เรียกจาก POST /auth/keepalive เมื่อผู้ใช้ยังใช้งานอยู่)
 *
 * ถ้าไม่มี token หรือ session หมดอายุไปแล้ว → คืน false ให้ฝั่งหน้าเว็บรู้ว่าต้องล็อกอินใหม่
 */
async function touchSession(token) {
  if (!token) return false;
  const r = await db.prepare(
    'UPDATE sessions SET expires_at = ? WHERE token = ? AND expires_at >= ?',
  ).run(idleExpiryISO(), token, now());
  return (r.changes || 0) > 0;
}

/**
 * ลบเซสชันที่หมดอายุทิ้งทั้งหมด
 *
 * เดิมไม่มีฟังก์ชันนี้เลย → ตาราง sessions โตทางเดียว
 * @returns {Promise<number>} จำนวนแถวที่ลบ
 */
async function purgeExpiredSessions() {
  const r = await db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
  // การปลดล็อกหนังสือลับผูกกับ session — session หายแล้วต้องกรอกรหัสใหม่
  try {
    await db.prepare('DELETE FROM document_unlocks WHERE session_token NOT IN (SELECT token FROM sessions)').run();
  } catch (_e) { /* ตารางยังไม่ถูกสร้าง (เรียกก่อน migrate) — ข้ามได้ */ }
  return r.changes || 0;
}

async function destroySession(token) {
  if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

async function getSessionUser(token) {
  if (!token) return null;
  const row = await db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!row) return null;
  if (row.expires_at < now()) {
    await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return await db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
}

/**
 * เข้ารหัส/ตรวจรหัสผ่าน — แบบ async
 *
 * ⚠️ เดิมใช้ bcrypt.compareSync / hashSync ซึ่ง "บล็อก event loop ทั้งตัว"
 *    วัดได้ว่า bcryptjs (pure JS) ใช้ ~65 ms ต่อครั้งที่ cost = 10
 *    ถ้าคนเข้าใช้พร้อมกัน 20 คน → คนหลังสุดรอถึง 3.1 วินาที
 *    และระหว่างนั้นเซิร์ฟเวอร์ไม่ทำอะไรได้เลย (ทั้งผู้ที่ล็อกอินและผู้ที่กำลังใช้งานอยู่)
 *
 * แก้เป็น bcrypt.compare / bcrypt.hash (แบบ Promise)
 *   → ความเร็วเท่ากัน (61.9 vs 65.5 ms) แต่ bcryptjs ยอมให้ event loop
 *     ทำงานอื่นระหว่างรอ (วัดได้ว่างานอื่นเดินไป 20 ครั้งระหว่าง await)
 */
async function hashPassword(pw) {
  return bcrypt.hash(pw, 10);
}

/**
 * ตรวจรหัสผ่าน
 *
 * ⚠️ ครอบด้วย try/catch เพราะ bcrypt.compareSync โยน error ทันทีถ้า hash ไม่ถูกต้อง
 *    (เช่น password_hash เป็น NULL หรือเป็นข้อความธรรมดาจากข้อมูลเก่า/นำเข้าจากที่อื่น)
 *    เดิม error นั้นหลุดไปถึง error handler → ตอบ HTTP 500
 *    ทั้งที่ควรตอบ 401 "รหัสผ่านไม่ถูกต้อง" เหมือนกรณีที่ใส่รหัสผิด
 */
async function verifyPassword(pw, hash) {
  try {
    return await bcrypt.compare(pw, hash);
  } catch (e) {
    return false;
  }
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

async function publicUser(u) {
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
    is_time_editor: await isTimeEditor(u),
    status: u.status,
    created_at: u.created_at,
    approved_at: u.approved_at,
  };
}

/** Middleware: ผูกผู้ใช้จาก session cookie เข้ากับ req.user */
async function attachUser(req, res, next) {
  const cookies = parseCookies(req.headers.cookie || '');
  const user = await getSessionUser(cookies.sid);
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
async function requireApprover(req, res, next) {
  if (!req.user || req.user.status !== 'active') {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' });
  }
  const approvals = require('./approvals'); // lazy — กัน circular dependency
  if (!isApprover(req.user) && !await approvals.isSchoolTravelApprover(req.user.id)) {
    return res.status(403).json({ error: 'คุณไม่มีสิทธิ์อนุมัติคำขอในระบบนี้' });
  }
  next();
}

module.exports = {
  now, newSession, destroySession, getSessionUser, hashPassword, verifyPassword,
  touchSession, purgeExpiredSessions, idleExpiryISO,
  parseCookies, isValidCitizenId, validatePasswordStrength, publicUser,
  attachUser, requireAuth, requireAdmin, requireApprover,
  ROLES, SCHOOL_ROLE_ORDER, rolesForGroup, isValidRoleFor,
  roleLabel, roleIcon, canApprove, isApprover,
  getTimeEditorIds, isTimeEditor,
  SESSION_IDLE_MINUTES, SESSION_DAYS,
};
