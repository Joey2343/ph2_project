'use strict';
/**
 * ตัวช่วยลบข้อมูลที่เกี่ยวโยงกันทั้งหมดเมื่อ admin ลบรายการ
 * กันข้อมูลตกค้างใน DB ที่ส่วนอื่น (นับ pending / สถิติ / สายอนุมัติ) ไปอ่านแล้วไม่ตรงกับรายการที่แสดง
 */
const db = require('../db');

/** เอา userId ออกจากโครงสร้าง JSON ทุกรูปแบบ (array ของ id / object แบบ per-person / ซ้อนลึก) */
function stripUserFromValue(val, userId) {
  if (Array.isArray(val)) {
    const out = [];
    for (const item of val) {
      if (typeof item === 'number' || (typeof item === 'string' && /^\d+$/.test(item.trim()))) {
        if (Number(item) === userId) continue;
        out.push(item);
      } else if (item && typeof item === 'object') {
        out.push(stripUserFromValue(item, userId));
      } else {
        out.push(item);
      }
    }
    return out;
  }
  if (val && typeof val === 'object') {
    const out = {};
    for (const k in val) {
      const v = val[k];
      // รูปแบบ per-person: { staffId: approverId } → ลบ key ที่ชี้ไปยังผู้ใช้ที่ถูกลบ
      if ((typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v.trim())))) {
        if (Number(v) === userId) continue;
        out[k] = v;
        continue;
      }
      out[k] = stripUserFromValue(v, userId);
    }
    return out;
  }
  return val;
}

/** keys ใน settings ที่เก็บรายชื่อผู้ใช้/ผู้อนุมัติ (id) */
const USER_SETTING_KEYS = [
  'approvers_booking',        // ยานพาหนะ + ห้องประชุม (ชุดเดียวกัน)
  'vehicle_approvers',
  'room_approvers',
  'travel_approvers',
  'travel_approvers_school',
  'memo_approvers',           // แบบรายบุคคล { level: { staffId: approverId } }
  'leave_approvers',
  'leave_approvers_school',
  'leave_final_approvers',
  'leave_group_approvers',
  'time_edit_users',
];

/** เอา userId ออกจาก settings สายอนุมัติ/สิทธิ์ทั้งหมด */
async function removeUserFromSettings(userId) {
  const id = Number(userId);
  if (!id) return;
  for (const key of USER_SETTING_KEYS) {
    const row = await db.prepare('SELECT value FROM settings WHERE `key` = ?').get(key);
    if (!row || !row.value) continue;
    let obj;
    try { obj = JSON.parse(row.value); } catch (e) { continue; }
    const cleaned = stripUserFromValue(obj, id);
    const before = JSON.stringify(obj);
    const after = JSON.stringify(cleaned);
    if (before !== after) await db.prepare('UPDATE settings SET value = ? WHERE `key` = ?').run(after, key);
  }
}

/**
 * ลบผู้ใช้ + ทุกข้อมูลลูกที่อ้างถึงเขา (sessions, ลงเวลา, คำขอทุกระบบ, ผู้รับ/ผู้อ่านหนังสือ,
 * เจ้าหน้าที่สารบัญ/หนังสือรับรอง, วงเงินลา, ภัยธรรมชาติ) + เอาออกจากสายอนุมัติใน settings
 * (เรียกก่อน DELETE FROM users เสมอ)
 */
async function purgeUser(userId) {
  const id = Number(userId);
  if (!id) return;
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  await db.prepare('DELETE FROM time_records WHERE user_id = ?').run(id);
  await db.prepare('DELETE FROM vehicle_bookings WHERE user_id = ?').run(id);
  await db.prepare('DELETE FROM vehicle_notices WHERE user_id = ?').run(id);
  await db.prepare('DELETE FROM room_bookings WHERE user_id = ?').run(id);
  await db.prepare('DELETE FROM travel_requests WHERE user_id = ?').run(id);
  await db.prepare('DELETE FROM leave_requests WHERE user_id = ?').run(id);
  await db.prepare('DELETE FROM user_leave_balances WHERE user_id = ?').run(id);
  await db.prepare('DELETE FROM memos WHERE user_id = ?').run(id);
  await db.prepare('DELETE FROM document_staff WHERE user_id = ?').run(id);
  await db.prepare('DELETE FROM document_recipients WHERE user_id = ?').run(id);
  await db.prepare('DELETE FROM document_reads WHERE user_id = ?').run(id);
  await db.prepare('DELETE FROM disasters WHERE user_id = ?').run(id);
  await removeUserFromSettings(id);
}

/** ลบข้อมูลลูกของหนังสือราชการ (ผู้รับ + สถานะการอ่าน) — เรียกก่อน DELETE FROM documents */
async function purgeDocumentChildren(docId) {
  const id = Number(docId);
  if (!id) return;
  await db.prepare('DELETE FROM document_recipients WHERE document_id = ?').run(id);
  await db.prepare('DELETE FROM document_reads WHERE doc_id = ?').run(id);
}

/** ลบการจองที่ผูกกับยานพาหนะ (พร้อมข้อความแจ้งเตือนของการจองนั้น) — เรียกก่อน DELETE FROM vehicles */
async function purgeVehicleBookings(vehicleId) {
  const id = Number(vehicleId);
  if (!id) return;
  const bookingIds = (await db.prepare('SELECT id FROM vehicle_bookings WHERE vehicle_id = ?').all(id)).map((r) => r.id);
  if (bookingIds.length) {
    await db.prepare(`DELETE FROM vehicle_notices WHERE booking_id IN (${bookingIds.map(() => '?').join(',')})`).run(...bookingIds);
  }
  await db.prepare('DELETE FROM vehicle_bookings WHERE vehicle_id = ?').run(id);
}

/** ลบการจองที่ผูกกับห้องประชุม — เรียกก่อน DELETE FROM rooms */
async function purgeRoomBookings(roomId) {
  const id = Number(roomId);
  if (!id) return;
  await db.prepare('DELETE FROM room_bookings WHERE room_id = ?').run(id);
}

module.exports = {
  stripUserFromValue,
  removeUserFromSettings,
  purgeUser,
  purgeDocumentChildren,
  purgeVehicleBookings,
  purgeRoomBookings,
};
