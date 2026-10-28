'use strict';
/**
 * ลงเวลาออกงานอัตโนมัติ เมื่อครบกำหนดเวลา 17:00 น.
 *
 * ความต้องการ (ผู้ใช้):
 *   "เมื่อเวลา 17.00 น. คนที่ลงเวลาเข้างาน แต่ยังไม่ได้ลงเวลาออกงาน
 *    ให้ลงเวลาออกงานอัตโนมัติ"
 *
 * วิธีทำงาน
 *   - เรียก startAutoClockOut() ตอน server บูต
 *   - ตรวจทุก 30 วินาที (ใช้ simulated clock ของ simdate → ทดสอบด้วย sim_today ได้)
 *   - เมื่อเวลาผ่าน 17:00 น. ของวันนั้น และยังไม่เคยทำวันนี้
 *     → UPDATE time_records ของวันนี้ที่ "มีเวลาเข้า แต่ยังไม่มีเวลาออก"
 *        ให้ clock_out = '17:00:00' และ clock_out_src = 'อัตโนมัติ ...'
 *   - จำวันที่ทำล่าสุดใน settings (`clock_auto_out_last`) → รีสตาร์ทก็ไม่ทำซ้ำ
 *
 * หมายเหตุ
 *   - ไม่กระทบการลงเวลาออกงานด้วยตัวเอง (ไม่ต้องมีพิกัด)
 *   - ปิดในเซิร์ฟเวอร์ทดสอบ (TELEGRAM_DISABLED=1) เพื่อไม่ให้ปิดเวลาของเทสต์
 *     ที่สร้าง clock-in ไว้แล้วยังไม่ทันตรวจ
 */

const db = require('../db');
const simdate = require('./simdate');

/** เวลาที่ใช้บันทึกเมื่อปิดอัตโนมัติ — ตรงกับเวลาที่กำหนด (ไม่ใช่เวลาที่ตื่นมาเห็น) */
const AUTO_OUT_TIME = '17:00:00';
const TARGET_HOUR = 17;
const TARGET_MIN = 0;
const SRC = 'อัตโนมัติ (ครบกำหนดเวลา 17:00 น.)';
const SETTING_KEY = 'clock_auto_out_last';

async function lastRunDate() {
  const r = await db.prepare('SELECT value FROM settings WHERE `key` = ?').get(SETTING_KEY);
  return r ? String(r.value || '').trim() : '';
}

async function setLastRunDate(date) {
  await db
    .prepare('INSERT INTO settings (`key`, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
    .run(SETTING_KEY, date);
}

/**
 * ปิดเวลาออกงานให้ทุกคนที่ลงเวลาเข้าแล้วแต่ยังไม่ออก ของวันที่กำหนด
 *
 * @param {object} opts
 * @param {string} [opts.date]    วันที่ YYYY-MM-DD (ค่าเริ่มต้น = วันนี้ตาม simdate)
 * @param {number} [opts.userId]  จำกัดเฉพาะผู้ใช้คนเดียว (ใช้ในเทสต์ — ไม่ให้ไปปิดของคนอื่น)
 * @returns {Promise<number>} จำนวนแถวที่ถูกปิด
 */
async function autoClockOut({ date = null, userId = null } = {}) {
  const day = date || simdate.todayISO();
  let sql = `UPDATE time_records SET clock_out = ?, clock_out_src = ?
    WHERE date = ? AND clock_in IS NOT NULL AND (clock_out IS NULL OR clock_out = '')`;
  const args = [AUTO_OUT_TIME, SRC, day];
  if (userId) {
    sql += ' AND user_id = ?';
    args.push(Number(userId));
  }
  const res = await db.prepare(sql).run(...args);
  return res && res.changes ? Number(res.changes) : 0;
}

/** เวลาปัจจุบันผ่าน 17:00 แล้วหรือยัง */
function passedTarget(now) {
  const h = now.getHours();
  const m = now.getMinutes();
  return h > TARGET_HOUR || (h === TARGET_HOUR && m >= TARGET_MIN);
}

async function tick() {
  try {
    const now = new Date(); // simulated (simdate patches Date)
    if (!passedTarget(now)) return;
    const today = simdate.todayISO();
    if ((await lastRunDate()) === today) return;
    // จำวันก่อนทำงาน — กันรอบถัดไป (30 วินาที) ทำซ้ำถ้างานรอบนี้ใช้เวลานาน
    await setLastRunDate(today);
    const n = await autoClockOut({ date: today });
    if (n) console.log(`[clock-autoout] ลงเวลาออกงานอัตโนมัติ ${n} รายการ (${today} 17:00 น.)`);
  } catch (e) {
    console.error('[clock-autoout] tick error:', e.message);
  }
}

function startAutoClockOut() {
  // ตรวจครั้งแรกหลังบูต 12 วินาที (กรณีรีสตาร์ทหลัง 17:00) แล้วทุก 30 วินาที
  setTimeout(() => { tick().catch((e) => console.error('[clock-autoout]', e.message)); }, 12000);
  setInterval(() => { tick().catch((e) => console.error('[clock-autoout]', e.message)); }, 30 * 1000);
  console.log('[clock-autoout] ตั้งลงเวลาออกงานอัตโนมัติ 17:00 น. แล้ว');
}

module.exports = { startAutoClockOut, autoClockOut };
