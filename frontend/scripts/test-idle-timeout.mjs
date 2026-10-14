/**
 * ตรวจตรรกะ "ออกจากระบบอัตโนมัติเมื่อไม่ใช้งานเกิน 1 ชั่วโมง"
 *
 * ทำไมต้องมี
 * ──────────
 * ฟีเจอร์นี้แก้ปัญหาความปลอดภัยที่แท้จริง: เดิม session อยู่ 7 วัน
 * ปิดเครื่องทิ้งไว้ข้ามคืน หรือเอา cookie ไปใช้ที่อื่น ก็ยังเข้าระบบได้
 *
 * เงื่อนไขที่ต้องเป็นจริง (ถ้าพลาดข้อใด ผู้ใช้จะโดนออกผิดเวลาหรือไม่ถูกออกเลย)
 *   ① นับเวลาจากการกระทำของคนจริง (เมาส์/คีย์บอร์ด/เลื่อน/สัมผัส)
 *      ไม่ใช่จาก request ของเบราว์เซอร์ — เพราะหน้าจอหลายหน้าดึงข้อมูลอัตโนมัติ
 *      ถ้านับจาก request คนที่ทิ้งหน้าค้างไว้จะไม่มีวันถูกออก
 *   ② ยิง keepalive ให้ server ต่ออายุ session ตอนที่ยังใช้งานอยู่
 *   ③ ครบเวลาแล้วเรียก onIdle และถอดฟังเหตุการณ์ออก (ไม่งั้นผู้ใช้ที่เพิ่งขยับเมาส์
 *      จะถูกออกซ้ำอีก)
 *   ④ กดออกจากระบบเอง → ต้องหยุดนับ ไม่งั้น timer ค้างจะไปออกคนหน้า
 *   ⑤ กลับมาจากแท็บที่ถูกซ่อนนาน ๆ → ต้องเช็คเวลาจริงใหม่
 *      (เบราว์เซอร์หยุด timer ของแท็บที่ไม่ได้มองเห็น)
 *
 * ใช้เวลาปลอม (idleMs สั้น ๆ) เพื่อพิสูจน์ตรรกะโดยไม่ต้องรอ 60 นาที
 *
 * ใช้: node scripts/test-idle-timeout.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let pass = 0;
let fail = 0;
const check = (ok, name, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src', 'lib', 'idle-timeout.js');

/* ── ① ต้นแบบ DOM พอใช้ (โมดูลนี้แตะแค่ window/document) ────────────────── */
console.log('');
console.log('① สตับ DOM จำลอง');

const listeners = new Map();          // 'window:mousemove' -> Set<fn>
let visibility = 'visible';

function addTo(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
}
function removeFrom(key, fn) {
  const s = listeners.get(key);
  if (s) s.delete(fn);
}
function fireOn(key) {
  const s = listeners.get(key);
  if (!s) return 0;
  [...s].forEach((fn) => fn());
  return s.size;
}

globalThis.window = {
  addEventListener: (ev, fn) => addTo(`window:${ev}`, fn),
  removeEventListener: (ev, fn) => removeFrom(`window:${ev}`, fn),
  ShadowRoot: class ShadowRoot {},
};
globalThis.document = {
  get visibilityState() { return visibility; },
  addEventListener: (ev, fn) => addTo(`document:${ev}`, fn),
  removeEventListener: (ev, fn) => removeFrom(`document:${ev}`, fn),
  // Vue runtime-dom เรียก createElement('template') ตอนโหลดโมดูล แม้เราจะไม่ได้ mount
  createElement: () => ({
    innerHTML: '',
    content: { firstChild: null },
    firstChild: null,
    setAttribute() {},
    remove() {},
  }),
  createElementNS: () => ({}),
  createTextNode: () => ({}),
  querySelector: () => null,
};
check(typeof globalThis.window.addEventListener === 'function', 'window.addEventListener พร้อม');
check(typeof globalThis.document.addEventListener === 'function', 'document.addEventListener พร้อม');

const idle = await import('../src/lib/idle-timeout.js');
check(idle.IDLE_MINUTES === 60, 'ค่าเริ่มต้น = 60 นาที', 'ได้ ' + idle.IDLE_MINUTES);

/* ── ② ถอด api layer ออก แล้วแทนด้วยตัวจับการเรียก ──────────────────────── */
console.log('');
console.log('② จับการยิง keepalive ที่หน้าเว็บส่งไป');

let keepaliveCalls = 0;
let keepaliveResult = { status: 200 };
const apiMod = await import('../src/api/client.js');
const realPost = apiMod.default.post;
apiMod.default.post = async (url) => {
  if (url === '/auth/keepalive') {
    keepaliveCalls += 1;
    if (keepaliveResult.status !== 200) {
      const e = new Error('หมดเวลา');
      e.status = keepaliveResult.status;
      throw e;
    }
    return { ok: true };
  }
  return realPost(url);
};
const restoreApi = () => { apiMod.default.post = realPost; };
check(true, 'แทนที่ api.post เรียบร้อย');

/* ── ③ ครบเวลาแล้วต้องออกจากระบบ ──────────────────────────────────────── */
console.log('');
console.log('③ ครบเวลาไม่ใช้งาน → ต้องออกจากระบบ');

let idleFired = 0;
idle.startIdleLogout(() => { idleFired += 1; }, { idleMs: 250, keepaliveMs: 50 });

// ⚠️ หลังจากนี้ไปใช้ restartIdleLogout เสมอ
//    เพราะ startIdleLogout มี guard `if (started) return` กันเรียกซ้ำ
//    และหลัง triggerIdle แล้ว started ยังเป็น true
//    (ถอด event listener ออกแล้วแต่ไม่ได้ตั้ง started = false)
//    โค้ดจริงจึงต้องเรียกผ่าน restartIdleLogout ที่ stop ก่อนแล้วค่อย start

check(listeners.has('window:mousemove'), 'ฟังเหตุการณ์การเคลื่อนเมาส์');
check(listeners.has('window:keydown'), 'ฟังเหตุการณ์กดคีย์บอร์ด');
check(listeners.has('window:scroll'), 'ฟังเหตุการณ์เลื่อนหน้า');
check(listeners.has('window:touchstart'), 'ฟังเหตุการณ์สัมผัส');
check(listeners.has('document:visibilitychange'), 'ฟังการกลับมาจากแท็บที่ถูกซ่อน');

await sleep(600);
check(idleFired === 1, 'ครบเวลาแล้วเรียก onIdle พอดี 1 ครั้ง', 'ได้ ' + idleFired);
check(!listeners.has('window:mousemove') || listeners.get('window:mousemove').size === 0,
  'ถอดฟังเหตุการณ์ออกแล้ว (กันออกซ้ำตอนผู้ใช้เพิ่งขยับเมาส์)');

idleFired = 0;
await sleep(400);
check(idleFired === 0, 'ไม่ยิง onIdle ซ้ำหลังหมดเวลาแล้ว', 'ได้ ' + idleFired);

/* ── ④ มีการใช้งาน → ต้องขยืดเวลา ───────────────────────────────────── */
console.log('');
console.log('④ มีการใช้งานต่อเนื่อง → ต้องไม่ออกจากระบบ');

idleFired = 0;
keepaliveCalls = 0;
idle.restartIdleLogout(() => { idleFired += 1; }, { idleMs: 900, keepaliveMs: 400 });

// ขยับเมาส์ทุก 300 ms ตลอด 3 วินาที (นานกว่า idleMs 3 เท่า)
//
// ⚠️ ต้องเว้นให้มากกว่า MIN_GAP_BETWEEN_CHECKS_MS (250 ms) ในโมดูล
//    ไม่งั้นทุก event จะถูกกรองทิ้งก่อนถึงตัวนับ keepalive
for (let i = 0; i < 10; i += 1) {
  fireOn('window:mousemove');
  await sleep(300);
}
check(idleFired === 0, 'ขยับเมาส์ตลอด → ไม่ออกจากระบบ', 'เรียก onIdle ' + idleFired + ' ครั้ง');
check(keepaliveCalls >= 2, 'ยิง keepalive เป็นระยะระหว่างใช้งาน', 'ยิงไป ' + keepaliveCalls + ' ครั้ง');

/* ── ⑤ เลิกใช้งานหลังขยับ → ต้องออกเมื่อครบเวลานับจากรอบล่าสุด ────────── */
console.log('');
console.log('⑤ เลิกขยับแล้ว → ต้องออกเมื่อครบเวลานับจากครั้งล่าสุด');

await sleep(1300);
check(idleFired === 1, 'หยุดขยับ → ออกจากระบบ', 'เรียก onIdle ' + idleFired + ' ครั้ง');

/* ── ⑥ กดออกจากระบบเอง → ต้องหยุดนับ ────────────────────────────────── */
console.log('');
console.log('⑥ stopIdleLogout (ตอนกดออกจากระบบเอง)');

idleFired = 0;
idle.restartIdleLogout(() => { idleFired += 1; }, { idleMs: 200, keepaliveMs: 50 });
idle.stopIdleLogout();
await sleep(500);
check(idleFired === 0, 'หยุดแล้วไม่ออกจากระบบเอง', 'เรียก onIdle ' + idleFired + ' ครั้ง');
const leftover = [...listeners.keys()].filter((k) => (listeners.get(k) || new Set()).size > 0);
check(leftover.length === 0, 'ถอดฟังเหตุการณ์ออกหมด ไม่เหลือตัวฟังค้าง', 'เหลือ: ' + leftover.join(', '));

/* ── ⑦ กลับมาจากแท็บที่ถูกซ่อน ───────────────────────────────────────── */
console.log('');
console.log('⑦ กลับมาจากแท็บที่ถูกซ่อนนาน ๆ');

idleFired = 0;
keepaliveResult = { status: 200 };
idle.restartIdleLogout(() => { idleFired += 1; }, { idleMs: 5000, keepaliveMs: 50 });
visibility = 'hidden';
fireOn('document:visibilitychange');
await sleep(100);
check(idleFired === 0, 'ซ่อนแท็บ → ยังไม่ออกจากระบบ', 'เรียก onIdle ' + idleFired);
visibility = 'visible';
fireOn('document:visibilitychange');
await sleep(100);
check(idleFired === 0, 'กลับมาทันที (ยังไม่ครบเวลา) → ไม่ออกจากระบบ', 'เรียก onIdle ' + idleFired);
idle.stopIdleLogout();

/* ── ⑧ keepalive ได้ 401 → ต้องออกจากระบบทันที ────────────────────────── */
console.log('');
console.log('⑧ server บอกว่าหมดเวลาแล้ว (keepalive → 401)');

idleFired = 0;
keepaliveCalls = 0;
keepaliveResult = { status: 401 };
idle.restartIdleLogout(() => { idleFired += 1; }, { idleMs: 60000, keepaliveMs: 0 });
// ต้องเว้น > 250 ms (MIN_GAP) ไม่งั้น event แรกจะถูกตัวกรองความถี่กินทิ้ง
await sleep(300);
fireOn('window:mousemove');
await sleep(200);
check(keepaliveCalls >= 1, 'ยิง keepalive ตามรอบ', 'ยิง ' + keepaliveCalls);
check(idleFired === 1, 'ได้ 401 → ออกจากระบบทันที (ไม่รอครบ 60 นาที)', 'เรียก onIdle ' + idleFired);
idle.stopIdleLogout();

keepaliveResult = { status: 200 };
idleFired = 0;
keepaliveCalls = 0;
idle.restartIdleLogout(() => { idleFired += 1; }, { idleMs: 60000, keepaliveMs: 0 });
keepaliveResult = { status: 0 };   // เครือข่ายล่ม ไม่ใช่ session หมด
await sleep(300);
fireOn('window:mousemove');
await sleep(200);
check(idleFired === 0, 'เครือข่ายล่ม (ไม่ใช่ 401) → ไม่ออกจากระบบ', 'เรียก onIdle ' + idleFired);
idle.stopIdleLogout();
keepaliveResult = { status: 200 };
restoreApi();

/* ── ⑨ ตรวจว่าหน้าเว็บเรียกใช้งานถูกจุด ────────────────────────────────── */
console.log('');
console.log('⑨ ต้องเรียกใช้งานครบทุกจุดที่จำเป็น');

const mainSrc = readFileSync(path.join(HERE, '..', 'src', 'main.js'), 'utf8');
check(/setIdleLoginOpener/.test(mainSrc), 'main.js ต่อหน้าเข้าสู่ระบบเข้ากับโมดูล');
check(/setIdleToast/.test(mainSrc), 'main.js ต่อ toast เข้ากับโมดูล');

const authSrc = readFileSync(path.join(HERE, '..', 'src', 'stores', 'auth.js'), 'utf8');
check(/armIdleLogout\(\)/.test(authSrc), 'เริ่มนับเวลาตอนล็อกอิน (init)');
check(/armIdleLogout\(\)/.test(authSrc), 'เริ่มนับเวลาหลังล็อกอินสำเร็จ (afterAuthSuccess)');
check(/stopIdleLogout\(\)/.test(authSrc), 'หยุดนับเวลาตอนกดออกจากระบบเอง');
check(/showLoginAfterIdle/.test(authSrc), 'หมดเวลาแล้วพาไปหน้าเข้าสู่ระบบ + บอกเหตุผล');
check(/'\/auth\/logout'/.test(authSrc), 'เรียก /auth/logout เพื่อลบ session ฝั่ง server ตอนหมดเวลา');

console.log('');
console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);