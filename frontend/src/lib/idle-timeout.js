/**
 * ออกจากระบบอัตโนมัติเมื่อไม่ได้ใช้งานเกิน 1 ชั่วโมง
 *
 * ทำงาน 2 ชั้นร่วมกัน (ต้องมีทั้งสองชั้น ถึงจะปลอดภัยจริง)
 * ────────────────────────────────────────────
 * ① ฝั่งหน้าเว็บ (ไฟล์นี้)
 *   นับเวลาจาก "การกระทำของผู้ใช้จริง" = เมาส์ คีย์บอร์ด เลื่อน สัมผัส
 *   ครบ 60 นาที → เรียก onIdle เพื่อออกจากระบบพร้อมข้อความบอกเหตุผล
 *
 *   ⚠️ ต้องนับจากการกระทำของคน ไม่ใช่จากการที่เบราว์เซอร์ยิง API
 *      เพราะหน้าจอหลายหน้ามีการดึงข้อมูลอัตโนมัติ (นาฬิกา, แจ้งเตือน)
 *      ถ้านับจาก request → คนที่ทิ้งหน้าค้างไว้จะไม่มีวันถูกออกจากระบบเลย
 *
 * ② ฝั่ง server (POST /auth/keepalive)
 *   ตาราง sessions มีอายุ 60 นาทีนับจากการใช้งานล่าสุด
 *   ระหว่างที่ผู้ใช้ยังทำงานอยู่ หน้าเว็บยิง keepalive ทุก 5 นาทีเพื่อเลื่อนเวลา
 *   ถ้าเบราว์เซอร์ถูกปิดไปเฉย ๆ หรือ cookie ถูกขโมกไปใช้
 *   session จะหมดอายุเองฝั่ง server โดยไม่ต้องพึ่งฝั่งหน้าเว็บเลย
 *
 * ทำไมต้องมี ② ด้วย
 *   ถ้ามีแต่ ① → เปิดหน้าเว็บค้างไว้ข้ามคืน หรือเอา cookie ไปใช้ที่อื่น
 *   จะยังใช้ระบบต่อได้จนครบอายุ cookie 7 วัน
 */

/*
 * ⚠️ import นี้ห้ามตก
 *
 * เคยลืมบรรทัดนี้ทั้งหมด → pingKeepalive พังด้วย ReferenceError: api is not defined
 * แต่มันอยู่ใน try/catch → error ถูกกลืนเงียบ ไม่มีอะไรแจ้งเตือน
 * ผลคือ keepalive ไม่เคยทำงานเลย ฝั่ง server จะตัด session ทิ้งทุก 60 นาที
 * แม้ผู้ใช้กำลังทำงานอยู่ตลอด → ถูกดีดออกจากระบบทุกชั่วโมง
 *
 * เทสต์ scripts/test-idle-timeout.mjs จับได้ (ข้อ "ยิง keepalive เป็นระยะ")
 */
import api from '../api/client.js';

/** นาทีที่ถือว่า "ไม่ได้ใช้งาน" แล้วต้องออกจากระบบ */
export const IDLE_MINUTES = 60;

const IDLE_MS = IDLE_MINUTES * 60 * 1000;

/**
 * ยิง keepalive บ่อยแค่ไหน (ขณะที่ยังใช้งานอยู่)
 *
 * 5 นาที = ยิงบ่อยพอที่ session จะไม่มีทางหมดอายุตอนผู้ใช้ยังทำงาน
 *          แต่ไม่บ่อยเกินจนเปลืองทรัพยากร (1 คนที่ใช้งานหนัก = 12 ครั้ง/ชั่วโมง)
 */
const KEEPALIVE_MS = 5 * 60 * 1000;

/**
 * เหตุการณ์ที่ถือว่า "ผู้ใช้กำลังใช้งาน"
 *
 * mousemove ยิงบ่อยมาก (เดือนละหลายแสนครั้ง) จึงต้องกรองด้วยเวลา
 * ดู markActivity() ด้านล่าง
 */
const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'wheel'];

/**
 * กันไม่ให้รูปแบบการกรองเดิม (REGEX จากข้อมูลธรรมดา)
 *
 * mousemove ยิงได้ 60-120 ครั้ง/วินาทีตอนขยับเมาส์ต่อเนื่อง
 * ถ้าไม่กรอง จะเป็นการเรียก clearTimeout + setTimeout หลายร้อยครั้งต่อวินาที
 *
 * ต้องเล็กกว่า keepaliveMs เสมอ ไม่งั้น keepalive จะยิงไม่ได้เลย
 * (เพราะติดกับตัวกรองเดียวกันนี้) — ตอนนี้คือ 250 ms vs 5 นาที
 */
const MIN_GAP_BETWEEN_CHECKS_MS = 250;

let idleTimer = null;
let lastKeepaliveAt = 0;
let lastActivityAt = 0;
let started = false;
let handler = null;
let onIdleCb = null;
/** กันไม่ให้ยิง onIdle ซ้ำ (เช่น timer ตรงกับ keepalive ที่ได้ 401) */
let fired = false;

/**
 * ค่าที่กำหนดไว้ของรอบที่กำลังนับอยู่
 *
 * แยกเป็นตัวแปรกลางเพื่อให้ armIdleTimer() ที่ไม่รับ argument อ่านค่าที่ใช้จริงได้
 * และเพื่อให้เทสต์ส่ง idleMs สั้น ๆ เข้ามาได้โดยไม่ต้องรอ 60 นาทีจริง
 */
const cfg = { idleMs: IDLE_MS, keepaliveMs: KEEPALIVE_MS };

/** เปิดหน้าเว็บล็อกอิน — ตั้งค่าจาก main.js (store พร้อมแล้วจึงเรียกได้) */
let openLoginFn = null;
export function setIdleLoginOpener(fn) {
  openLoginFn = fn;
}

/** แสดงข้อความบอกผู้ใช้ — ตั้งค่าจาก main.js */
let toastFn = null;
export function setIdleToast(fn) {
  toastFn = fn;
}

/** ยิง POST /auth/keepalive เพื่อเลื่อนอายุเซสชันฝั่ง server */
async function pingKeepalive() {
  try {
    await api.post('/auth/keepalive');
  } catch (e) {
    // 401 = server หมดเวลาให้แล้ว (เช่นเปิดเครื่องมานานจน session ตาย)
    // ต้องออกจากระบบเหมือนกรณีฝั่งหน้าเว็บจับเวลาได้
    if (e && e.status === 401) triggerIdle();
    // เครือข่าย/เซิร์ฟเวอร์ล่ม → ไม่ต้องออก ให้ผู้ใช้ลองใหม่เอง
  }
}

/** ตั้งนาฬิกานับถอยหลังใหม่ทุกครั้งที่มีการใช้งาน */
function armIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(triggerIdle, cfg.idleMs);
}

/**
 * ตัวเรียกจริงเมื่อครบเวลา
 *
 * ต้องหยุดฟังเหตุการณ์ก่อน ไม่งั้นผู้ใช้ที่เพิ่งขยับเมาส์
 * จะเด้งกลับเข้าระบบแล้วถูกออกอีกครั้งทันที
 */
function triggerIdle() {
  if (fired) return;
  fired = true;
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (handler) {
    ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, handler));
    document.removeEventListener('visibilitychange', onVisibility);
    handler = null;
  }
  if (onIdleCb) onIdleCb();
}

/** ผู้ใช้ "แตะ" หน้าจอ — ขยืดเวลา และยิง keepalive ถ้าถึงรอบ */
function markActivity() {
  const t = Date.now();
  // กรองความถี่ (mousemove ยิงบ่อยเกินไป) — ไม่งั้นแต่ละ event ต้อง clearTimeout
  if (t - lastActivityAt < MIN_GAP_BETWEEN_CHECKS_MS) return;
  lastActivityAt = t;

  if (!fired) armIdleTimer();

  if (t - lastKeepaliveAt >= cfg.keepaliveMs) {
    lastKeepaliveAt = t;
    pingKeepalive();
  }
}

/**
 * กลับมาที่แท็บหลังจากซ่อนไปนาน ๆ (เช่นปิดเครื่องทิ้งไว้ข้ามคืน)
 *
 * เบราว์เซอร์จะหยุด/ชะลอ timer ของแท็บที่ไม่ได้มองเห็น
 * พอกลับมาต้องเช็คเองอีกครั้ง ไม่งั้นจะนับเวลาผิด
 */
function onVisibility() {
  if (document.visibilityState !== 'visible') return;
  if (!started || fired) return;
  if (Date.now() - lastActivityAt >= cfg.idleMs) {
    triggerIdle();
    return;
  }
  armIdleTimer();
  // กลับมาหน้าจอ = มีการใช้งานแน่นอน
  markActivity();
}

/**
 * เริ่มนับเวลา (เรียกครั้งเดียวตอนบูตแอป)
 *
 * @param {() => void} onIdle  เรียกเมื่อครบเวลาไม่ใช้งาน
 * @param {{idleMs?:number, keepaliveMs?:number}} [opts]
 *        ไม่ต้องใส่ในการใช้งานจริง — มีไว้ให้เทสต์ส่งค่าสั้น ๆ
 *        เพื่อพิสูจน์ตรรกะโดยไม่ต้องรอ 60 นาที
 *
 * ⚠️ ใช้ ?? ไม่ใช่ ||
 *    เพราะ keepaliveMs: 0 หมายถึง "ยิงทุกครั้งที่ผู้ใช้แตะ" (สำหรับเทสต์)
 *    ถ้าใช้ || ค่า 0 จะเป็น falsy → กลับไปใช้ค่าเริ่มต้น 5 นาที
 *    แล้ว keepalive ไม่ยิงตลอดการทดสอบ โดยไม่มีอะไรฟ้อง
 */
export function startIdleLogout(onIdle, opts = {}) {
  if (started) return;
  started = true;
  fired = false;
  onIdleCb = onIdle;
  cfg.idleMs = opts.idleMs ?? IDLE_MS;
  cfg.keepaliveMs = opts.keepaliveMs ?? KEEPALIVE_MS;
  lastActivityAt = Date.now();
  lastKeepaliveAt = Date.now();

  handler = markActivity;
  ACTIVITY_EVENTS.forEach((ev) => {
    window.addEventListener(ev, handler, { passive: true });
  });
  document.addEventListener('visibilitychange', onVisibility);
  armIdleTimer();
}

/** หยุดนับเวลาและถอดฟังเหตุการณ์ออกให้ครบ (ใช้ตอนออกจากระบบเอง) */
export function stopIdleLogout() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (handler) {
    ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, handler));
    handler = null;
  }
  document.removeEventListener('visibilitychange', onVisibility);
  started = false;
  fired = false;
  cfg.idleMs = IDLE_MS;
  cfg.keepaliveMs = KEEPALIVE_MS;
}

/**
 * เรียกเมื่อผู้ใช้ล็อกอินใหม่ — ตั้งนาฬิกาใหม่ให้นับจากตอนล็อกอิน
 *
 * ต้องเรียกทุกครั้งที่ล็อกอิน ไม่งั้นผู้ใช้ที่ล็อกอินครั้งที่แล้วนาน ๆ
 * จะเด้งออกทันทีหลังล็อกอิน เพราะนาฬิกาเดิมนับไปครบ 60 นาทีแล้ว
 */
export function restartIdleLogout(onIdle, opts) {
  stopIdleLogout();
  startIdleLogout(onIdle, opts);
}

/** ใช้ตอนหมดเวลาแล้วต้องพาผู้ใช้ไปหน้าเข้าสู่ระบบ */
export function showLoginAfterIdle() {
  if (toastFn) toastFn('ออกจากระบบอัตโนมัติ เพราะไม่มีการใช้งานเกิน 1 ชั่วโมง', 'error');
  if (openLoginFn) openLoginFn();
}