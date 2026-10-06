'use strict';
/**
 * นาฬิกาจำลอง (Simulated clock) — ใช้ทดสอบระบบเมื่อ "เปลี่ยนปี พ.ศ."
 * ตั้งค่าผ่านตาราง settings: key = 'sim_today' (เช่น '2027-01-01') เพื่อจำลองว่า "วันนี้" คือวันดังกล่าว
 * ลบ/ว่าง = ใช้เวลาจริงทั้งหมด ทุกอย่างกลับสู่ปกติทันที ไม่มีการแก้ไขข้อมูลจริงใด ๆ
 *
 * หลักการ: patch global Date ของโปรเซส Node.js ให้ "วันนี้" (new Date(), Date.now())
 * เป็นวันที่จำลอง โดยคงตัวสร้างแบบกำหนดค่าไว้ตามจริง (new Date(ts), new Date(str) ฯลฯ)
 * และเพิ่ม SimDate.today() / SimDate.simulating() สำหรับโค้ดที่ต้องแยกรูปแบบวันที่
 */

const db = require('../db');

const RealDate = Date;
let simOffsetMs = 0; // ms ที่ต้องบวกเข้าไปจากเวลาจริง (ค่าลบเมื่อจำลองอดีต)
let simToday = '';   // 'YYYY-MM-DD' เมื่อกำลังจำลอง

function settingsRow() {
  try {
    return db.prepare("SELECT value FROM settings WHERE key = 'sim_today'").get();
  } catch (e) { return null; }
}

/** อ่านค่าจำลองจาก DB แล้วตั้ง offset (เรียกตอนเริ่ม server และเมื่อ admin เปลี่ยนค่า) */
function reload() {
  const row = settingsRow();
  const val = row ? String(row.value || '').trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    simToday = '';
    simOffsetMs = 0;
    return '';
  }
  // เที่ยงวันของวันที่จำลอง (เวลาท้องถิ่น) — ทำให้ "วันนี้" ตรงตามวันที่ที่ตั้งไว้ตลอดวัน
  const target = new RealDate(val + 'T12:00:00');
  const realNow = RealDate.now();
  simOffsetMs = target.getTime() - realNow;
  simToday = val;
  return val;
}

/** เปิดโหมดจำลองอยู่หรือไม่ + วันที่จำลอง */
function simulating() { return simToday || null; }

/** วันที่ "วันนี้" (YYYY-MM-DD) — วันจำลองเมื่อเปิดโหมดจำลอง */
function todayISO() {
  const d = new RealDate(RealDate.now() + simOffsetMs);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** เวลาจำลอง (ms) — เดินต่อเนื่องตามเวลาจริงแต่อิงฐานวันที่จำลอง */
function simNowMs() { return RealDate.now() + simOffsetMs; }

/** วันที่จริงของเครื่อง (YYYY-MM-DD) — สำหรับแสดงเทียบในหน้าตั้งค่า */
function realTodayISO() {
  const d = new RealDate();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** เวลาจริง (ms) — สิ่งที่ต้องไม่ควรถูกจำลอง เช่น อายุเซสชัน */
function realNowMs() { return RealDate.now(); }

/** เวลาจริงรูปแบบ 'YYYY-MM-DD HH:MM:SS' (UTC) — ใช้เทียบ expires_at ของเซสชัน */
function realNowISO() { return new RealDate().toISOString().replace('T', ' ').slice(0, 19); }

// ---- Patch global Date ----
const SimDate = function Date(...args) {
  if (args.length === 0) return new RealDate(RealDate.now() + simOffsetMs); // new Date() → วันจำลอง
  return new RealDate(...args); // new Date(ts), new Date(str) ฯลฯ ยังทำงานปกติ
};
SimDate.prototype = RealDate.prototype;
Object.setPrototypeOf(SimDate, RealDate); // ให้ static (Date.now, Date.parse, from, UTC ฯลฯ) ต่อกัน
SimDate.now = function () { return RealDate.now() + simOffsetMs; };

function install() {
  reload();
  global.Date = SimDate;
  console.log(simToday
    ? '[simdate] โหมดจำลองเวลา: วันนี้ = ' + simToday
    : '[simdate] ใช้เวลาจริง (ไม่มีการจำลอง)');
}

module.exports = { install, reload, simulating, todayISO, simNowMs, realTodayISO, realNowMs, realNowISO };
