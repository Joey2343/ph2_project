/**
 * อัปเดตสถานะเฉพาะแถวที่เปลี่ยน โดยไม่ต้องโหลดตารางใหม่ทั้งหน้า
 *
 * ทำไมต้องมี
 * ──────────
 * เดิมทุกครั้งที่กดอนุมัติ/ตรวจสอบ/อ่านหนังสือ หน้าเว็บเรียก load() ใหม่ทั้งตาราง
 *   → ตารางหายไป เหลือ "กำลังโหลดข้อมูล..." แล้วโผล่มาใหม่
 *   → ผู้ใช้ต้องรอ และดูเหมือนหน้าเว็บค้าง
 *   → แย่กว่านั้น การ "อ่านหนังสือ" ไม่ได้เรียก load() เลย คงไม่อัปเดตเลย
 *      ต้องรีเฟรชเองถึงจะเห็นว่า "อ่านแล้ว" (เจอจริง)
 *
 * วิธีนี้
 * ─────
 * backend คืนค่าจริงของแถวหลังบันทึกมาใน `res.row` แล้ว (ดู lib/approvals.js)
 * หน้าเว็บเอาไปทับแถวเดิมเฉพาะตัว → ตารางไม่หาย ไม่มีจอโหลดซ้ำ
 * ไม่ต้องเดาค่าเอง เช่น "อนุมัติแล้วต้องเป็นสถานะอะไร" เพราะ backend เป็นคนตอบ
 */

/**
 * ทับค่าของแถวหนึ่งในรายการ (list ต้องเป็น array แบบ reactive)
 *
 * @returns {boolean} true = อัปเดตสำเร็จ · false = หาแถวไม่เจอ (ต้อง fallback ไป load())
 */
export function patchRow(list, id, patch) {
  if (!Array.isArray(list) || !patch) return false;
  const i = list.findIndex((r) => String(r.id) === String(id));
  if (i === -1) return false;
  // แทนที่ทั้งออบเจกต์ (ไม่ใช่ Object.assign) เพื่อให้ Vue ตรวจจับการเปลี่ยนแน่นอน
  list[i] = Object.assign({}, list[i], patch);
  return true;
}

/** ดึง `row` ที่ backend คืนมา ถ้าไม่มีคืน null (ปลอดภัยเผื่อ backend รุ่นเก่า) */
export function rowOf(res) {
  return (res && typeof res === 'object' && res.row && typeof res.row === 'object') ? res.row : null;
}

/**
 * อัปเดตแถวจากคำตอบของ backend ถ้าอัปเดตไม่ได้ ให้เรียก reload แทน
 *
 * @param {Function} reload  fallback เมื่อหาแถวไม่เจอ หรือ backend ไม่ได้คืน row
 * @returns {boolean} true = อัปเดตทันที · false = ต้องรอ reload
 */
export function applyRow(list, id, res, reload) {
  const row = rowOf(res);
  const patched = patchRow(list, id, row || {});
  if (!patched && typeof reload === 'function') reload();
  return patched;
}

/** เอาแถวออกจากรายการ (ใช้ตอนลบ หรือสถานะเปลี่ยนแล้วไม่ควรอยู่ในแท็บนี้แล้ว) */
export function removeRow(list, id) {
  if (!Array.isArray(list)) return false;
  const i = list.findIndex((r) => String(r.id) === String(id));
  if (i === -1) return false;
  list.splice(i, 1);
  return true;
}