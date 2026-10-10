'use strict';
/**
 * ระบบอนุมัติหลายขั้น (Multi-level approval)
 * แต่ละระบบ (ยานพาหนะ/ห้องประชุม/ไปราชการ/ลา) กำหนดจำนวนขั้นที่ต้องอนุมัติผ่าน settings
 * - ขั้นที่ 1 (ผู้ตรวจสอบ) : ผู้ตรวจสอบ
 * - ขั้นที่ 2 (ผู้อนุมัติขั้นต้น) : ผู้อนุมัติขั้นต้น
 * - ขั้นที่ 3 (ผู้อนุมัติ) : ผู้อนุมัติ
 * ทุกขั้นต้องได้รับสิทธิ์อนุมัติ (can_approve) จาก admin ก่อน
 */
const db = require('../db');
const auth = require('./auth');

const APPROVAL_SYSTEMS = ['vehicle', 'room', 'travel', 'leave', 'memo'];

const LEVEL_NAMES = {
  1: 'ขั้นที่ 1 (ผู้ตรวจสอบ)',
  2: 'ขั้นที่ 2 (ผู้อนุมัติขั้นต้น)',
  3: 'ขั้นที่ 3 (ผู้อนุมัติ)',
};

function levelLabel(level) {
  return LEVEL_NAMES[level] || `ขั้นที่ ${level}`;
}

/** จำนวนขั้นการอนุมัติที่ระบบต้องการ (1-3) ตั้งค่าโดย admin ใน settings */
async function getRequiredLevels(system) {
  const row = await db.prepare('SELECT value FROM settings WHERE `key` = ?').get('approval_' + system);
  const n = row ? parseInt(row.value, 10) : 1;
  return Math.min(3, Math.max(1, isNaN(n) ? 1 : n));
}

function parseApprovals(data) {
  try {
    const arr = JSON.parse(data || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

/**
 * ผู้ที่ได้รับมอบหมายให้อนุมัติของแต่ละระบบ (admin ตั้งค่า)
 * ห้องประชุม + ยานพาหนะใช้รายการชุดเดียวกัน (approvers_booking)
 * เพื่อให้คนที่ admin ตั้งสิทธิ์ไว้ เห็นคำขอของทั้ง 2 ระบบ
 */
async function getSystemApprovers(system) {
  const key = (system === 'room' || system === 'vehicle') ? 'approvers_booking' : system + '_approvers';
  const row = await db.prepare('SELECT value FROM settings WHERE `key` = ?').get(key);
  let obj = {};
  try {
    const parsed = JSON.parse(row ? row.value : '{}');
    if (parsed && typeof parsed === 'object') obj = parsed;
  } catch (e) { /* ignore */ }
  // รองรับ 3 รูปแบบ: array (เดิม), per-person object, และ { per, flat } (บันทึกข้อความแบบรายบุคคล)
  if (obj.flat && typeof obj.flat === 'object') {
    const f = obj.flat;
    return { 1: (f['1'] || []).map(Number), 2: (f['2'] || []).map(Number), 3: (f['3'] || []).map(Number) };
  }
  const toIds = (v) => {
    if (Array.isArray(v)) return v.map(Number).filter(Boolean);
    if (v && typeof v === 'object') {
      const ids = new Set();
      for (const k in v) { const n = Number(v[k]); if (n) ids.add(n); }
      return [...ids];
    }
    return [];
  };
  return {
    1: toIds(obj['1']),
    2: toIds(obj['2']),
    3: toIds(obj['3']),
  };
}

/** ลำดับขั้นบันทึกข้อความแบบรายบุคคล: { level: { staffId: approverId } } — แต่ละคนมีสายอนุมัติของตัวเอง */
async function getMemoApproversPerPerson() {
  const row = await db.prepare('SELECT value FROM settings WHERE `key` = ?').get('memo_approvers');
  let obj = {};
  try { const parsed = JSON.parse(row ? row.value : '{}'); if (parsed && typeof parsed === 'object') obj = parsed; } catch (e) { /* ignore */ }
  // รูปแบบใหม่ { per: {...} } / รูปแบบเก่า { 1: {...} }
  const src = (obj.per && typeof obj.per === 'object') ? obj.per : obj;
  const per = (v) => {
    const out = {};
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const k in v) { const sid = Number(k), aid = Number(v[k]); if (sid > 0 && aid > 0) out[String(sid)] = aid; }
    }
    return out;
  };
  return { 1: per(src['1']), 2: per(src['2']), 3: per(src['3']) };
}

/** ผู้อนุมัติบันทึกข้อความของบุคคลหนึ่ง ณ ขั้นที่ level (fallback: คนแรกของลำดับรวม) */
async function getMemoApproverFor(staffId, level) {
  const per = await getMemoApproversPerPerson();
  const v = Number((per[level] || {})[String(staffId)]) || 0;
  if (v) return v;
  const flat = (await getSystemApprovers('memo'))[level] || [];
  return flat.length ? flat[0] : 0;
}

/** ผู้ใช้สามารถอนุมัติขั้นที่ level ของระบบนี้ได้หรือไม่ (admin มีสิทธิ์เสมอ) */
async function canApproveSystem(user, system, level) {
  if (!user || user.status !== 'active') return false;
  if (user.role === 'admin') return true;
  if (system === 'leave') {
    const la = await getLeaveApprovers();
    return (la[level] || []).includes(user.id);
  }
  if (system === 'memo') {
    // รายบุคคล: ต้องเป็นผู้อนุมัติของ "ผู้จัดทำ" เท่านั้น (admin ผ่านอยู่แล้วด้านบน)
    return await canApproveMemoFor(user, rowMakerId, level);
  }
  const approvers = await getSystemApprovers(system);
  return (approvers[level] || []).includes(user.id);
}

/** ผู้ใช้เป็นผู้อนุมัติบันทึกข้อความของ staffId ที่ขั้น level หรือไม่ (รายบุคคล + fallback ลำดับรวม) */
async function canApproveMemoFor(user, staffId, level) {
  if (!user || user.status !== 'active') return false;
  if (user.role === 'admin') return true;
  const per = await getMemoApproversPerPerson();
  const v = Number((per[level] || {})[String(staffId)]) || 0;
  if (v) return v === Number(user.id);
  const flat = (await getSystemApprovers('memo'))[level] || [];
  return flat.includes(Number(user.id));
}

/** เจ้าหน้าที่การลา 3 ลำดับ (admin กำหนด) */
async function getLeaveApprovers() {
  const row = await db.prepare("SELECT value FROM settings WHERE `key` = 'leave_approvers'").get();
  let obj = {};
  try {
    const parsed = JSON.parse(row ? row.value : '{}');
    if (parsed && typeof parsed === 'object') obj = parsed;
  } catch (e) { /* ignore */ }
  // Support both old array format and new per-person object format
  const flatten = (lvData) => {
    if (Array.isArray(lvData)) return lvData.map(Number).filter(Boolean);
    if (lvData && typeof lvData === 'object') {
      const ids = new Set();
      for (const k in lvData) { const v = Number(lvData[k]); if (v) ids.add(v); }
      return [...ids];
    }
    return [];
  };
  return {
    1: flatten(obj['1']),
    2: flatten(obj['2']),
    3: flatten(obj['3']),
  };
}

/** ขั้นที่ผู้ใช้ได้รับมอบหมายให้อนุมัติของระบบนี้ (admin ได้ทุกขั้น) */
async function getUserSystemLevels(user, system) {
  if (!user || user.status !== 'active') return [];
  if (user.role === 'admin') return [1, 2, 3];
  if (system === 'leave') {
    // ลา: ใช้ leave_approvers (admin กำหนดเจ้าหน้าที่ 3 ลำดับ)
    const la = await getLeaveApprovers();
    return [1, 2, 3].filter((l) => (la[l] || []).includes(user.id));
  }
  if (system === 'travel') {
    // ไปราชการ: สิทธิ์ตามตำแหน่ง (เมื่อ admin กำหนด can_approve ให้)
    if (user.can_approve) {
      const meta = auth.ROLES[user.role];
      if (meta) return (meta.approveLevels || []).slice();
    }
    return [];
  }
  const approvers = await getSystemApprovers(system);
  return [1, 2, 3].filter((l) => (approvers[l] || []).includes(user.id));
}

/**
/** กลุ่มของ user: office = สพป.แพร่ เขต 2 | school = สถานศึกษา */
async function userGroupOf(userId) {
  const u = await db.prepare('SELECT user_group, school_code FROM users WHERE id = ?').get(Number(userId));
  if (!u) return 'office';
  return u.user_group || 'office';
}

/** เป็นเจ้าหน้าที่ สพป.แพร่ เขต 2 หรือไม่ */
async function isOfficeUser(userId) { return await userGroupOf(userId) !== 'school'; }

/** สายอนุมัติไปราชการของผู้ขอ: office 2 ขั้น (supervisor→approver) | school 3 ขั้น (reviewer→supervisor→approver ทุกขั้นเป็นเจ้าหน้าที่ สพป.แพร่ เขต 2) */
async function getTravelChain(requesterId) {
  const group = await userGroupOf(requesterId);
  const key = group === 'school' ? 'travel_approvers_school' : 'travel_approvers';
  const settingRow = await db.prepare('SELECT value FROM settings WHERE `key` = ?').get(key);
  let mapping = {};
  try { mapping = JSON.parse(settingRow ? settingRow.value : '{}'); } catch (e) { /* ignore */ }
  return { group, entry: mapping[String(requesterId)] || null };
}

/** จำนวนขั้นอนุมัติไปราชการของผู้ขอแต่ละคน: office = ตาม settings (เดิม) | school = 3 ขั้น */
async function travelRequiredLevels(requesterId) {
  return await userGroupOf(requesterId) === 'school' ? 3 : await getRequiredLevels('travel');
}

/** ชื่อขั้นอนุมัติไปราชการของผู้ขอแต่ละคน */
async function travelLevelLabel(requesterId, level) {
  if (await userGroupOf(requesterId) !== 'school') return levelLabel(level);
  return { 1: 'ขั้นที่ 1 (ผู้ตรวจสอบ)', 2: 'ขั้นที่ 2 (ผู้บังคับบัญชาขั้นต้น)', 3: 'ขั้นที่ 3 (ผู้อนุมัติ)' }[level] || ('ขั้นที่ ' + level);
}

/**
 * ตรวจสอบสิทธิ์อนุมัติไปราชการโดยใช้ travel_approvers (per-user mapping)
 * Level 1 = ผู้บังคับบัญชาขั้นต้น (supervisor)
 * Level 2 = ผู้อนุมัติ (approver)
 */
async function canTravelApprover(user, level, travelRequestId) {
  if (!user || user.status !== 'active') return false;
  if (user.role === 'admin') return true;
  if (!user.can_approve) return false;
  // ดึง user_id ของผู้ขอจาก travel_requests
  const row = await db.prepare('SELECT user_id FROM travel_requests WHERE id = ?').get(travelRequestId);
  if (!row) return false;
  const chain = await getTravelChain(row.user_id);
  const entry = chain.entry;
  if (!entry) return false;
  // ผู้อนุมัติทุกขั้น (ทั้งสาย office และ school) ต้องเป็นเจ้าหน้าที่ สพป.แพร่ เขต 2 เท่านั้น
  if (!await isOfficeUser(user.id)) return false;
  if (chain.group === 'school') {
    // สายสถานศึกษา 3 ขั้น: ผู้ตรวจสอบ → ผู้บังคับบัญชาขั้นต้น → ผู้อนุมัติ
    if (level === 1) return Number(entry.reviewer) === user.id;
    if (level === 2) return Number(entry.supervisor) === user.id;
    if (level === 3) return Number(entry.approver) === user.id;
    return false;
  }
  // สาย สพป.แพร่ เขต 2 (คงเดิม): ผู้บังคับบัญชาขั้นต้น → ผู้อนุมัติ
  if (level === 1) return Number(entry.supervisor) === user.id;
  if (level === 2) return Number(entry.approver) === user.id;
  return false;
}

/** ผู้ใช้นี้ถูกกำหนดเป็นผู้ตรวจสอบ (ขั้นที่ 1), ผู้บังคับบัญชาขั้นต้น (ขั้นที่ 2) หรือผู้อนุมัติ (ขั้นที่ 3) ของสายสถานศึกษาหรือไม่ — ใช้เปิดเมนู ขออนุมัติ/อนุญาตเดินทางไปราชการ (สถานศึกษา) */
async function isSchoolTravelApprover(userId) {
  try {
    const row = await db.prepare("SELECT value FROM settings WHERE `key` = ?").get('travel_approvers_school');
    const mapping = JSON.parse(row ? row.value : '{}');
    return Object.values(mapping).some((e) => e && (Number(e.reviewer) === Number(userId) || Number(e.supervisor) === Number(userId) || Number(e.approver) === Number(userId)));
  } catch (e) { return false; }
}

/** ตรวจสอบว่าผู้อนุมัติและผู้ขออยู่กลุ่มเดียวกัน (office = สพป.แพร่ เขต 2 | school = สถานศึกษา) — ใช้เสริมความเข้มข้นให้ canTravelApprover */
async function sameTravelGroup(approverId, requesterId) {
  const a = await db.prepare('SELECT user_group, school_code FROM users WHERE id = ?').get(Number(approverId));
  const r = await db.prepare('SELECT user_group, school_code FROM users WHERE id = ?').get(Number(requesterId));
  if (!a || !r) return false;
  var ga = a.user_group || 'office';
  var gr = r.user_group || 'office';
  return ga === gr;
}

/**
 * อนุมัติคำขอหนึ่งขั้น
 * @param {object} opts
 * @param {string} opts.table     ชื่อตาราง (จาก whitelist เท่านั้น)
 * @param {string} opts.system    ระบบ (vehicle/room/travel/leave)
 * @param {number} opts.id        id ของคำขอ
 * @param {object} opts.user      ผู้ที่กดอนุมัติ
 * @param {string} opts.note      หมายเหตุ
 * @param {Function} [opts.onFinal] callback เรียกก่อนอนุมัติขั้นสุดท้าย ถ้าคืนค่า object {error,code} จะหยุด
 * @param {Function} [opts.canApproveFn] ตรวจสิทธิ์อนุมัติขั้นถัดไป (user, level) → bool (ค่าเริ่มต้น: ตามบทบาท)
 * @param {Function} [opts.levelLabelFn] ชื่อขั้นที่ใช้ในข้อความ (level) → string
 * @returns {object} {ok, message, approved, level, error?, code?}
 */
async function approveRequest({ table, system, id, user, note, onFinal, canApproveFn, levelLabelFn, requiredFn }) {
  if (!APPROVAL_SYSTEMS.includes(system)) return { error: 'ระบบไม่ถูกต้อง', code: 400 };
  const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) return { error: 'ไม่พบรายการ', code: 404 };
  if (row.status !== 'pending') return { error: 'รายการนี้ไม่รอการอนุมัติแล้ว', code: 400 };

  const required = requiredFn ? requiredFn(row) : await getRequiredLevels(system);
  const approvals = parseApprovals(row.approval_data);
  const nextLevel = approvals.length + 1;
  const label = levelLabelFn ? levelLabelFn(nextLevel) : levelLabel(nextLevel);
  if (nextLevel > required) return { error: 'รายการนี้ได้รับการอนุมัติครบทุกขั้นแล้ว', code: 400 };
  const check = canApproveFn || ((u, lvl) => auth.canApprove(u, lvl));
  if (!check(user, nextLevel)) {
    return { error: `คุณไม่มีสิทธิ์อนุมัติ${label} (เฉพาะผู้ที่ได้รับมอบหมายเท่านั้น)`, code: 403 };
  }

  if (nextLevel >= required && onFinal) {
    // ⚠️ ต้อง await — callback ที่ส่งมาหลายตัวเป็น async
    //   ถ้าไม่ await จะได้ Promise ซึ่ง "truthy เสมอ" → if (err) ผ่านเสมอ
    //   → return Promise ออกไปก่อนถึงบรรทัด UPDATE → อนุมัติขั้นสุดท้ายไม่เคยบันทึก
    //   และผู้ใช้ได้ error 500 (เจอจริงที่หน้าจองยานพาหนะ/ห้องประชุม ขั้นสุดท้าย)
    const err = await onFinal(row);
    if (err) return err;
  }

  approvals.push({
    level: nextLevel,
    by: user.id,
    name: user.full_name,
    title: user.title || '',
    position: user.position || '',
    workplace: user.workplace || '',
    signature: user.signature || '',
    role: user.role,
    at: auth.now(),
    note: (note || '').trim(),
  });

  const done = nextLevel >= required;
  await db.prepare(`UPDATE ${table} SET approval_level = ?, approval_data = ?, status = ?, note = ?, decided_by = ?, decided_at = ? WHERE id = ?`)
    .run(nextLevel, JSON.stringify(approvals), done ? 'approved' : 'pending',
      (note || '').trim(), user.id, auth.now(), id);

  return {
    ok: true,
    approved: done,
    level: nextLevel,
    required,
    message: done
      ? `✅ อนุมัติครบทุกขั้นแล้ว รายการได้รับการอนุมัติอย่างเป็นทางการ`
      : `✅ อนุมัติ${label}แล้ว ยังเหลืออีก ${required - nextLevel} ขั้น`,
  };
}

/**
 * ไม่อนุมัติคำขอ (ผู้มีสิทธิ์อนุมัติหรือ admin)
 */
async function rejectRequest({ table, id, user, note, allowFn }) {
  const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) return { error: 'ไม่พบรายการ', code: 404 };
  if (row.status !== 'pending') return { error: 'รายการนี้ไม่รอการอนุมัติแล้ว', code: 400 };
  const ok = allowFn ? allowFn(user) : auth.isApprover(user);
  if (!ok) return { error: 'คุณไม่มีสิทธิ์พิจารณาคำขอ', code: 403 };
  await db.prepare(`UPDATE ${table} SET status = 'rejected', note = ?, decided_by = ?, decided_at = ? WHERE id = ?`)
    .run((note || '').trim(), user.id, auth.now(), id);
  return { ok: true, message: 'ไม่อนุมัติรายการนี้แล้ว' };
}

module.exports = {
  APPROVAL_SYSTEMS, LEVEL_NAMES, levelLabel, getRequiredLevels, parseApprovals,
  getSystemApprovers, canApproveSystem, getUserSystemLevels, getLeaveApprovers,
  getMemoApproversPerPerson, getMemoApproverFor, canApproveMemoFor,
  canTravelApprover, isSchoolTravelApprover, sameTravelGroup, userGroupOf, isOfficeUser, getTravelChain, travelRequiredLevels, travelLevelLabel, approveRequest, rejectRequest,
};
