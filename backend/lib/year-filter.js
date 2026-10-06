'use strict';

/**
 * ตัวช่วยกรอง "ปี พ.ศ." จากช่วงวันที่
 *
 * ปัญหาที่แก้
 * ─────────
 * เดิมทุก endpoint กรองปีด้วย `doc_no LIKE '%/<ปี>'` (travel_no / booking_no / doc_no)
 * ซึ่งพังเงียบ ๆ กับรายการที่ยังไม่มีเลขเอกสาร เช่น
 *   - ข้อมูลที่ import/seed มา (ไม่ได้สร้างเลขเอกสารให้)
 *   - รายการเก่าที่แปลงมาจากระบบเดิม
 * → ผู้ใช้เลือกปีปัจจุบันแล้วเห็น "ยังไม่มีรายการ" ทั้งที่มีข้อมูลอยู่จริง
 *   (เจอจริงตอนทดสอบหน้าจองยานพาหนะ: ปี 2569 ได้ 0 รายการ จากทั้งหมด 6)
 *
 * การกรองด้วยช่วงวันที่ตรงกับความหมายของ "ปี พ.ศ." จริง และใช้ได้กับทุกรายการ
 * ไม่ว่าจะมีเลขเอกสารหรือไม่
 *
 * หมายเหตุ: ใช้การเทียบสตริง ISO (YYYY-MM-DD) ซึ่งเรียงตามลำดับเวลาแล้ว
 * จึงใช้ได้ทั้งกับ SQLite และ MySQL โดยไม่ต้องแยกฟังก์ชันตาม dialect
 */

/**
 * แปลงปี พ.ศ. เป็นช่วงวันที่ ค.ศ.
 * @param {string|number} yearBE
 * @returns {{from: string, to: string}|null} null ถ้าปีไม่ถูกต้อง
 */
function yearBEToDateRange(yearBE) {
  const yBE = parseInt(yearBE, 10);
  if (!Number.isFinite(yBE)) return null;
  const yCE = yBE - 543;
  if (yCE < 1 || yCE > 9999) return null;
  const y = String(yCE).padStart(4, '0');
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

/**
 * เติมเงื่อนไขช่วงวันที่ให้คำสั่ง SQL ที่กำลังสร้าง
 *
 * @param {string} sql    คำสั่ง SQL
 * @param {any[]}  args   อาร์กิวเมนต์ — จะถูก push ค่าเพิ่ม
 * @param {string} col    คอลัมน์วันที่ที่ต้องการกรอง เช่น 'v.date' หรือ 'm.date_from'
 * @param {string} yearBE ปี พ.ศ. — ถ้าไม่ถูกต้องจะไม่กรอง (คืน SQL เดิม)
 * @returns {string} SQL ที่ปรับแล้ว
 */
function applyYearFilter(sql, args, col, yearBE) {
  const range = yearBEToDateRange(yearBE);
  if (!range) return sql;
  sql += ` AND ${col} >= ? AND ${col} <= ?`;
  args.push(range.from, range.to);
  return sql;
}

module.exports = { yearBEToDateRange, applyYearFilter };
