'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../lib/auth');
const { uploadProfile, uploadErrorHandler, deleteUploadedFile, renameAsCitizen } = require('../lib/uploads');
const { sendTelegram } = require('../lib/telegram');
const approvals = require('../lib/approvals');

const router = express.Router();

// สมัครสมาชิกใหม่ (รอ admin อนุมัติ)
router.post('/register', uploadProfile.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'signature', maxCount: 1 },
]), uploadErrorHandler, async (req, res) => {
  const b = req.body || {};
  const username = (b.username || '').trim();
  const password = b.password || '';
  const citizen_id = (b.citizen_id || '').trim();
  const first_name = (b.first_name || '').trim();
  const last_name = (b.last_name || '').trim();
  const full_name = (first_name + ' ' + last_name).trim() || (b.full_name || '').trim();

  if (!username || !password || !citizen_id || !first_name || !last_name) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน (เลขบัตรประชาชน ชื่อ นามสกุล ชื่อผู้ใช้ และรหัสผ่าน)' });
  }
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) {
    return res.status(400).json({ error: 'ชื่อผู้ใช้ต้องเป็นตัวอักษร ตัวเลข หรือ _ . - และมีความยาว 3-30 ตัวอักษร' });
  }
  if (!auth.isValidCitizenId(citizen_id)) {
    return res.status(400).json({ error: 'เลขบัตรประชาชนไม่ถูกต้อง ต้องเป็นเลข 13 หลักที่ตรวจสอบได้' });
  }
  const pwErr = auth.validatePasswordStrength(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  if (await db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return res.status(400).json({ error: 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว กรุณาเลือกชื่ออื่น' });
  }
  if (await db.prepare('SELECT id FROM users WHERE citizen_id = ?').get(citizen_id)) {
    return res.status(400).json({ error: 'เลขบัตรประชาชนนี้ได้ลงทะเบียนไว้แล้วในระบบ' });
  }

  // ไฟล์รูปและลายเซ็นจะถูกตั้งชื่ออ้างอิงตามเลขบัตรประชาชน 13 หลัก
  const rawPhoto = req.files && req.files.photo ? req.files.photo[0].filename : null;
  const rawSig = req.files && req.files.signature ? req.files.signature[0].filename : null;
  const photo = renameAsCitizen(rawPhoto, citizen_id, 'photo');
  const signature = renameAsCitizen(rawSig, citizen_id, 'signature');  const userGroup = (b.user_group === 'school' || b.user_group === 'office') ? b.user_group : 'office';
  const workplaceSecondary = (b.workplace_secondary && b.user_group === 'school') ? b.workplace_secondary : '[]';
  const schoolCode = (b.user_group === 'school' && b.workplace) ? (b.workplace.match(/^(d{8})/) || [])[1] || '' : '';
  const info = await db.prepare(`INSERT INTO users
    (username, password_hash, title, full_name, first_name, last_name, nickname, blood_type,
     academic_rank, highest_education, birth_date, citizen_id, position, workplace, phone, email,
     telegram_token, telegram_chat_id, photo, signature, role, status, user_group, workplace_secondary, school_code)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'staff', 'pending', ?, ?, ?)`)
    .run(username, auth.hashPassword(password), b.title || 'นาย/นาง/นางสาว', full_name,
      first_name, last_name, (b.nickname || '').trim(), (b.blood_type || '').trim(),
      (b.academic_rank || '').trim(), (b.highest_education || '').trim(), (b.birth_date || '').trim() || null, citizen_id,
      (b.position || '').trim(), (b.workplace || '').trim(), (b.phone || '').trim(), (b.email || '').trim(),
      (b.telegram_token || '').trim(), (b.telegram_chat_id || '').trim(), photo, signature, userGroup, workplaceSecondary, schoolCode);

  res.json({ ok: true, message: 'ลงทะเบียนเรียบร้อย กรุณารอผู้ดูแลระบบอนุมัติก่อนเข้าสู่ระบบ', id: info.lastInsertRowid });
});

// เข้าสู่ระบบ

/** publicUser + สิทธิ์พิเศษที่ frontend ใช้ตัดสินเมนู (เช่น ผู้อนุมัติไปราชการสายสถานศึกษา) */
async function publicUserWithFlags(u) {
  return Object.assign(await auth.publicUser(u), { is_school_travel_approver: await approvals.isSchoolTravelApprover(u.id) });
}
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = await db.prepare('SELECT * FROM users WHERE username = ?').get((username || '').trim());
  if (!user || !auth.verifyPassword(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  }
  if (user.status === 'pending') {
    return res.status(403).json({ error: 'บัญชีของคุณยังไม่ได้รับการอนุมัติจากผู้ดูแลระบบ กรุณารอสักครู่' });
  }
  if (user.status === 'rejected') {
    return res.status(403).json({ error: 'บัญชีของคุณถูกปฏิเสธการสมัคร กรุณาติดต่อผู้ดูแลระบบ' });
  }
  if (user.status === 'inactive') {
    return res.status(403).json({ error: 'บัญชีของคุณถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ' });
  }
  const token = await auth.newSession(user.id);
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000, path: '/' });
  res.json({ ok: true, user: await publicUserWithFlags(user) });
});

// ออกจากระบบ
router.post('/logout', async (req, res) => {
  await auth.destroySession(req.sessionToken);
  res.clearCookie('sid', { path: '/' });
  res.json({ ok: true });
});

// ข้อมูลผู้ใช้ปัจจุบัน
router.get('/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'ยังไม่ได้เข้าสู่ระบบ' });
  // สิทธิ์ผู้ตรวจสอบ (ขั้นที่ 1) สายสถานศึกษา → เปิดเมนู ขออนุญาตไปราชการ (สถานศึกษา)
  const extra = { is_school_travel_approver: await approvals.isSchoolTravelApprover(req.user.id) };
  res.json({ user: await publicUserWithFlags(req.user) });
});

// เลือกสถานศึกษาที่ต้องการทำงาน (เฉพาะเจ้าหน้าที่สถานศึกษา)
router.post('/select-school', auth.requireAuth, async (req, res) => {
  const { school } = req.body || {};
  if (!school) return res.status(400).json({ error: 'กรุณาระบุสถานศึกษา' });
  var schoolVal = String(school).trim();
  await db.prepare('UPDATE users SET current_school = ? WHERE id = ?').run(schoolVal, req.user.id);
  // Extract school code from selection (e.g. '54020055 name' -> '54020055')
  var selectedCode = (schoolVal.split(' ')[0] || '').trim();
  if (selectedCode && selectedCode !== req.user.school_code) {
    await db.prepare('UPDATE users SET school_code = ? WHERE id = ?').run(selectedCode, req.user.id);
  }
  const fresh = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, user: await auth.publicUser(fresh) });
});

// แก้ไขข้อมูลส่วนตัว (สมาชิก)
router.put('/profile', auth.requireAuth, uploadProfile.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'signature', maxCount: 1 },
]), uploadErrorHandler, async (req, res) => {
  const b = req.body || {};
  const u = req.user;
  const updates = [];
  const vals = [];

  const setIf = (field, col) => {
    if (b[field] !== undefined && String(b[field]) !== '') {
      updates.push(`${col} = ?`);
      vals.push(String(b[field]).trim());
    }
  };
  setIf('title', 'title');
  setIf('first_name', 'first_name');
  setIf('last_name', 'last_name');
  setIf('nickname', 'nickname');
  setIf('blood_type', 'blood_type');
  setIf('academic_rank', 'academic_rank');
  setIf('highest_education', 'highest_education');
  if (b.birth_date !== undefined) {
    updates.push('birth_date = ?');
    vals.push(String(b.birth_date).trim() || null);
  }
  setIf('position', 'position');
  setIf('workplace', 'workplace');
  setIf('workplace_secondary', 'workplace_secondary');
  setIf('phone', 'phone');
  setIf('email', 'email');
  setIf('telegram_token', 'telegram_token');
  setIf('telegram_chat_id', 'telegram_chat_id');
  if (b.first_name !== undefined || b.last_name !== undefined) {
    const fn = (b.first_name !== undefined && String(b.first_name) !== '') ? String(b.first_name).trim() : u.first_name || '';
    const ln = (b.last_name !== undefined && String(b.last_name) !== '') ? String(b.last_name).trim() : u.last_name || '';
    updates.push('full_name = ?');
    vals.push((fn + ' ' + ln).trim() || u.full_name);
  }

  let newPhoto = null, newSignature = null;
  if (req.files && req.files.photo) {
    newPhoto = renameAsCitizen(req.files.photo[0].filename, u.citizen_id || 'user' + u.id, 'photo');
    updates.push('photo = ?');
    vals.push(newPhoto);
  }
  if (req.files && req.files.signature) {
    newSignature = renameAsCitizen(req.files.signature[0].filename, u.citizen_id || 'user' + u.id, 'signature');
    updates.push('signature = ?');
    vals.push(newSignature);
  }

  if (updates.length === 0) return res.status(400).json({ error: 'ไม่มีข้อมูลที่จะแก้ไข' });
  vals.push(u.id);
  await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...vals);

  // ลบไฟล์เก่าหลังอัปเดตสำเร็จ
  if (newPhoto && u.photo && u.photo !== newPhoto) deleteUploadedFile(u.photo);
  if (newSignature && u.signature && u.signature !== newSignature) deleteUploadedFile(u.signature);

  const fresh = await db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
  res.json({ ok: true, user: await publicUserWithFlags(fresh), message: 'บันทึกข้อมูลเรียบร้อย' });
});

// ทดสอบส่งข้อความ Telegram — ใช้ค่าจากฟอร์ม (ถ้ากรอก) หรือค่าที่บันทึกไว้
router.post('/profile/test-telegram', auth.requireAuth, async (req, res) => {
  const b = req.body || {};
  const token = (b.telegram_token || req.user.telegram_token || '').trim();
  const chatId = (b.telegram_chat_id || req.user.telegram_chat_id || '').trim();
  if (!token || !chatId) return res.status(400).json({ error: 'กรุณากรอก Telegram Token Key และ Telegram Chat ID ก่อนทดสอบ' });
  const text = ['🔔 ข้อความแจ้งเตือน จากระบบ P2-SMART สพป.แพร่ เขต 2', '', 'นี่คือข้อความทดสอบ — ระบบแจ้งเตือนของคุณพร้อมใช้งาน'].join(String.fromCharCode(10));
  try {
    const ok = await sendTelegram({ token, chatId, text });
    if (!ok) return res.status(400).json({ error: 'ส่งข้อความไม่สำเร็จ — กรุณาตรวจสอบ Token และ Chat ID อีกครั้ง' });
    res.json({ ok: true, message: 'ส่งข้อความทดสอบสำเร็จ ตรวจสอบที่ Telegram ของคุณ' });
  } catch (e) {
    res.status(500).json({ error: 'ส่งข้อความไม่สำเร็จ: ' + e.message });
  }
});

// เปลี่ยนรหัสผ่าน
router.post('/change-password', auth.requireAuth, async (req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!auth.verifyPassword(old_password || '', req.user.password_hash)) {
    return res.status(400).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
  }
  const pwErr = auth.validatePasswordStrength(new_password || '');
  if (pwErr) return res.status(400).json({ error: pwErr });
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(new_password), req.user.id);
  res.json({ ok: true, message: 'เปลี่ยนรหัสผ่านเรียบร้อย' });
});

// ห่อ router เพื่อจับ error จาก async handler (Express 4 ไม่ catch promise เอง)
const { wrapRouter } = require('../lib/async-route');
module.exports = wrapRouter(router);
