'use strict';
/**
 * รหัสสถานศึกษา (8 หลักแรก) ของผู้ใช้ — ใช้ร่วมกันทุกจุดที่ต้องรู้ "โรงเรียนไหน"
 *
 * ทำไมต้องมี helper นี้
 * ──────────────────────
 * `users.school_code` ถูกตั้งตอนลงทะเบียน (ดึง 8 หลักจาก workplace) หรือตอน
 * เลือกสถานศึกษาที่หน้าเข้าสู่ระบบ แต่เดิม regex ที่ดึง 8 หลักเขียนผิดเป็น /^d{8}/
 * (ขาด backslash → หมายถึงตัวอักษร "d" 8 ตัว) จึงไม่มีวัน match
 *   → บัญชีสถานศึกษาใหม่ได้ school_code = ''
 *   → ทะเบียนหนังสือส่ง/รับของโรงเรียนหายทั้งกระดาน (กรอง d.school_code = '')
 *   → ตั้งเลขหนังสือของสถานศึกษาไม่ได้ (ต้องมีรหัสโรงเรียน)
 * (เจอจริง 25 ต.ค. 2569 — โรงเรียน 54020071 เปลี่ยนเจ้าหน้าที่สารบัญ)
 *
 * → ทุกจุดที่ต้องรู้รหัสโรงเรียนให้เรียก schoolCodeOf(user) เสมอ
 *   ลำดับความน่าเชื่อถือ: school_code → 8 หลักแรกของ workplace → 8 หลักแรกของ current_school
 */

/** ดึง 8 หลักแรก (รูปแบบรหัสโรงเรียน สพฐ.) จากข้อความใด ๆ */
function eightDigits(value) {
  const m = String(value == null ? '' : value).trim().match(/^(\d{8})/);
  return m ? m[1] : '';
}

/**
 * รหัสสถานศึกษาของผู้ใช้ ('' ถ้าไม่ใช่คนของสถานศึกษา)
 * @param {{school_code?:string, workplace?:string, current_school?:string}} user
 * @returns {string} รหัส 8 หลัก หรือ ''
 */
function schoolCodeOf(user) {
  if (!user) return '';
  return eightDigits(user.school_code)
    || eightDigits(user.workplace)
    || eightDigits(user.current_school)
    || '';
}

module.exports = { schoolCodeOf, eightDigits };
