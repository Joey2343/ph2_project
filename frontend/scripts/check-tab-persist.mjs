/**
 * ตรวจว่าแท็บของแต่ละหน้าคงอยู่หลังกดรีเฟรช
 *
 * ทำไมต้องมี
 * ──────────
 * ผู้ใช้แจ้งว่า "หน้าขออนุญาตลา กดรีเฟรชแล้วกลับไปแท็บแรกตลอด"
 *
 * ต้นเหตุจริง (LeavePage.vue)
 * ─────────────────────────
 *   pickInitialTab() เขียนแบบนี้:
 *     if (!groups.value.some((g) => g.key === t)) t = 'general';   ← ถูก
 *     if (!LEAVE_GROUPS.some((g) => g.key === t)) t = 'general';   ← ผิด
 *
 *   LEAVE_GROUPS มีแค่ 3 แท็บ (general / vacation / general-school)
 *   ส่วน "วันลาพักผ่อนสะสม" "สถิติ" "ตั้งค่าเจ้าหน้าที่" อยู่ใน ADMIN_GROUPS
 *   บรรทัดที่สองจึงปฏิเสธแท็บพวกนั้นทุกครั้งที่เปิดหน้า
 *   → localStorage เก็บค่าถูกต้องเสมอ (setTab เขียนทุกครั้ง)
 *     แต่ตอนอ่านกลับมาถูกตัดทิ้ง = "เขียนอย่างเดียว ไม่เคยอ่านกลับสำเร็จ"
 *     ลักษณะแบบนี้เทสต์ที่รันแล้วผ่านเสมอ เพราะมันแค่เช็คว่ามีคีย์อยู่
 *
 * ⚠️ เทสต์นี้เช็คโค้ด ไม่ได้รันเบราว์เซอร์
 *   เพราะการกดรีเฟรชจริงต้องเขียน/อ่าน localStorage ข้ามการโหลดหน้าใหม่
 *   ซึ่ง harness แบบ headless ทำแทนได้ยากและช้า
 *   ดังนั้นต้อง "นับในโค้ด" ให้ตรงกับตรรกะที่ใช้จริง
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
}

const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
/** ตัดคอมเมนต์ทิ้ง ไม่งั้นบรรทัดที่ "อธิบายบั๊ก" จะถูกนับเป็นโค้ดจริง */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

console.log('');
console.log('① หน้าขออนุญาตลา — แท็บต้องอยู่หลังรีเฟรช');
const leave = read('src/pages/LeavePage.vue');
const leaveCode = stripComments(leave);

// ดึงเฉพาะ body ของ pickInitialTab
const pickBody = (() => {
  const i = leaveCode.indexOf('function pickInitialTab()');
  if (i === -1) return '';
  const start = leaveCode.indexOf('{', i);
  let d = 0;
  for (let k = start; k < leaveCode.length; k += 1) {
    if (leaveCode[k] === '{') d += 1;
    else if (leaveCode[k] === '}') { d -= 1; if (d === 0) return leaveCode.slice(i, k); }
  }
  return '';
})();
check(!!pickBody, 'หา pickInitialTab() เจอ');

check(/if \(!groups\.value\.some\(\(g\) => g\.key === t\)\) t = 'general';/.test(pickBody),
  'กรันแท็บด้วย groups (รายการที่ผู้ใช้คนนี้เข้าถึงได้จริง)');
check(!/LEAVE_GROUPS\.some/.test(pickBody),
  'ไม่ตรวจกับ LEAVE_GROUPS อีกแล้ว',
  'LEAVE_GROUPS มีแค่ 3 แท็บ ส่วนแท็บสถิติ/ยอดคงเหลือ/ตั้งค่าอยู่ใน ADMIN_GROUPS\n'
  + '      → ตรวจกับ LEAVE_GROUPS = ตีออกทุกครั้งที่เปิดหน้า กดรีเฟรชแล้วเด้งกลับแท็บแรก');
check(/localStorage\.getItem\('leave_tab'\)/.test(pickBody),
  'อ่านค่าแท็บที่บันทึกไว้กลับมา');
check(!/if \(q\) localStorage\.setItem\('leave_tab', t\);/.test(pickBody),
  'บันทึกค่าที่ใช้จริงเสมอ ไม่ใช่เฉพาะตอนมี ?tab=',
  'ถ้าบันทึกเฉพาะตอนมี ?tab= แท็บที่เข้าไม่ได้จะค้างใน localStorage\n'
  + '      แล้วทุกครั้งที่เปิดหน้าจะลองค่าเดิมแล้วสะดุดอีก');
check(/^ {2}localStorage\.setItem\('leave_tab', t\);$/m.test(pickBody),
  'มี localStorage.setItem ใน pickInitialTab ที่ทำงานทุกครั้ง');
check(/function setTab\(k\)[\s\S]{0,200}?localStorage\.setItem\('leave_tab', k\)/.test(leaveCode),
  'setTab ยังบันทึกแท็บที่ผู้ใช้กด (เขียน-อ่านต้องครบวงจร)');

console.log('');
console.log('② deep-link ?tab= ต้องทำงานแม้ยังอยู่ในหน้าเดิม');
check(/const route = useRoute\(\);/.test(leaveCode),
  'มี useRoute() เพื่ออ่าน query แบบ reactive');
check(/watch\(\(\) => route\.query\.tab, \(\) => pickInitialTab\(\)\)/.test(leaveCode),
  'เฝ้า route.query.tab แล้วเรียก pickInitialTab()',
  'ถ้าไม่ watch การกดการ์ดบนหน้าแรกที่ลิงก์ #/leave?tab=xxx\n'
  + '      จะไม่มีผล เพราะ router ไม่ remount component เดิม (route เดิม เปลี่ยนแค่ query)');
check(!/location\.hash\.split\('\?'\)\[1\]/.test(leaveCode),
  'เลิกอ่าน location.hash ตรง ๆ แล้ว (อ่านได้แต่ตอนเปิดหน้าใหม่เท่านั้น)');

console.log('');
console.log('③ หน้าอื่นต้องไม่มีบั๊กแบบเดียวกัน');
/*
 * ตรวจทุกหน้าที่เก็บแท็บไว้: ต้องอ่านค่ากลับมาได้จริง
 * ถ้ามีหน้าไหน "เขียนแต่ไม่อ่าน" ให้จับได้ตรงนี้
 */
const TAB_PAGES = [
  ['LeavePage.vue', 'leave_tab'],
  ['DocumentsPage.vue', 'doc_tab'],
  ['VehiclesPage.vue', 'vehicle_tab'],
];
for (const [file, key] of TAB_PAGES) {
  const code = stripComments(read(`src/pages/${file}`));
  const writes = new RegExp(`localStorage\\.setItem\\('${key}'`).test(code);
  const reads = new RegExp(`localStorage\\.getItem\\('${key}'`).test(code);
  check(!(writes && !reads), `${file}: '${key}' ไม่ได้เขียนอย่างเดียว`,
    `เขียน ${writes ? 'มี' : 'ไม่มี'} · อ่านกลับ ${reads ? 'มี' : 'ไม่มี'} → เก็บค่าไว้แต่ไม่เคยใช้`);
}

console.log('');
console.log('④ ลิงก์ ?tab= ที่เหลืออยู่ต้องตรงกับ key ของแท็บจริง');
/*
 * เคยมีการ์ดบนหน้าแรกที่ลิงก์ #/leave?tab=vacation / ?tab=general
 *   ตอนนี้หัวข้อ "งานที่ค้าง / รออนุมัติของฉัน" ถูกถอนออกตามคำสั่งผู้ใช้แล้ว
 *   ลิงก์เหล่านั้นจึงหายไป แต่เส้นทาง ?tab= ยังใช้ได้ (พิสูจน์แล้วในเบราว์เซอร์)
 *   เช็คนี้ไว้กันกรณีมีการ์ดแบบนั้นกลับมาแล้วลิงก์ผิด key
 */
const home = read('src/pages/HomePage.vue');
const leaveLinks = [...home.matchAll(/href: '#\/leave\?tab=([a-z-]+)'/g)].map((m) => m[1]);
const REAL_KEYS = ['general', 'vacation', 'general-school', 'balance', 'leave-stats', 'vac-stats', 'my-stats', 'settings-approver', 'settings-approver-school'];
for (const k of leaveLinks) {
  check(REAL_KEYS.includes(k), `ลิงก์ ?tab=${k} ตรงกับ key ของแท็บที่มีอยู่จริง`,
    `ต้องเป็นหนึ่งใน: ${REAL_KEYS.join(', ')}`);
}
check(REAL_KEYS.every((k) => new RegExp(`key: '${k}'`).test(leave)),
  'ทุก key ที่ระบบรู้จักต้องมีแท็บนิยามไว้ใน LeavePage.vue',
  'ถ้าเพิ่ม key ใหม่ใน groups แต่ลืมเพิ่มใน LEAVE_GROUPS/ADMIN_GROUPS จะเลือกไม่ได้');
check(/if \(!groups\.value\.some\(\(g\) => g\.key === t\)\) t = 'general';/.test(pickBody),
  'deep-link ที่ชี้ไปแท็บที่ไม่มี ต้องตกกลับไปแท็บแรก ไม่ใช่ค้างว่าง');

console.log('');
console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);
