/**
 * ตรวจแท็บ/มุมมองเริ่มต้นของแต่ละหน้า (เช็คจากซอร์สโค้ด ไม่ได้รันเบราว์เซอร์)
 *
 * ประวัติ
 * ──────
 * เดิมผู้ใช้แจ้งว่า "หน้าขออนุญาตลา กดรีเฟรชแล้วกลับไปแท็บแรกตลอด"
 *   → แก้ให้จำแท็บใน localStorage (`leave_tab`) แล้วเทสต์นี้กันไม่ให้ "เขียนแต่ไม่อ่าน"
 *
 * 5 พ.ย. 2569 ผู้ใช้เปลี่ยนความต้องการ
 *   · เปิดหน้า ขออนุญาตลา → ต้องอยู่แท็บ "ขออนุญาตลาพักผ่อน" เสมอ (ไม่จำแท็บเดิม)
 *   · เปิดหน้า จองยานพาหนะ / จองห้องประชุม → ต้องอยู่ "มุมมองตาราง" เสมอ
 *   → เทสต์นี้จึงเปลี่ยนมาตรวจ "ค่าเริ่มต้นที่ถูกต้อง" + "ไม่มีการอ่านค่าที่จำไว้"
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
console.log('① หน้าขออนุญาตลา — เปิดมาที่แท็บ "ลาพักผ่อน" เสมอ');
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

check(/let t = q \|\| 'vacation';/.test(pickBody),
  'ค่าเริ่มต้นคือแท็บ "ลาพักผ่อน" (vacation)');
check(!/localStorage\.getItem\('leave_tab'\)/.test(pickBody),
  'ไม่อ่านแท็บที่เคยจำไว้ใน localStorage',
  'ผู้ใช้สั่ง: เปิดหน้าแล้วต้องอยู่แท็บลาพักผ่อนเสมอ');
check(!/localStorage\.setItem\('leave_tab'/.test(leaveCode),
  'ไม่เขียน leave_tab แล้ว (ทั้ง pickInitialTab และ setTab)');
check(/if \(!groups\.value\.some\(\(g\) => g\.key === t\)\)[\s\S]{0,200}?'vacation'/.test(pickBody),
  'แท็บที่เข้าไม่ได้ → ตกกลับแท็บลาพักผ่อน (หรือแท็บลาแรกที่เข้าได้)');
check(!/LEAVE_GROUPS\.some/.test(pickBody),
  'ไม่ตรวจกับ LEAVE_GROUPS อีกแล้ว',
  'LEAVE_GROUPS มีแค่ 3 แท็บ ส่วนแท็บสถิติ/ยอดคงเหลือ/ตั้งค่าอยู่ใน ADMIN_GROUPS\n'
  + '      → ตรวจกับ LEAVE_GROUPS = ตีออกทุกครั้งที่เปิดหน้า');
check(/applyListScope\(t\)/.test(pickBody),
  'เปิดหน้าแล้วตั้งตัวกรองรายการให้อยู่ที่ "ขออนุญาตลาทั้งหมด"');
check(/function setTab\(k\)[\s\S]{0,220}?applyListScope\(k\)/.test(leaveCode),
  'สลับแท็บรายการลาแล้วกลับไปที่ "ขออนุญาตลาทั้งหมด" ด้วย');
check(/function applyListScope\(tabKey\)[\s\S]{0,260}?myOnly\.value = !canSeeAll\.value;/.test(leaveCode),
  'applyListScope ตั้ง myOnly = !canSeeAll (ทั้งหมด เมื่อมีสิทธิ์เห็นทั้งหมด)');

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
console.log('③ หน้าอื่นต้องไม่เจอบั๊ก "เขียนแต่ไม่อ่าน" + เริ่มมุมมองที่ถูกต้อง');
/*
 * ตรวจทุกหน้าที่เก็บแท็บไว้: ต้องอ่านค่ากลับมาได้จริง
 * (LeavePage ถอดออกแล้ว — ผู้ใช้สั่งให้เปิดที่แท็บลาพักผ่อนเสมอ)
 */
const TAB_PAGES = [
  ['VehiclesPage.vue', 'vehicle_tab'],
];
for (const [file, key] of TAB_PAGES) {
  const code = stripComments(read(`src/pages/${file}`));
  const writes = new RegExp(`localStorage\\.setItem\\('${key}'`).test(code);
  const reads = new RegExp(`localStorage\\.getItem\\('${key}'`).test(code);
  check(!(writes && !reads), `${file}: '${key}' ไม่ได้เขียนอย่างเดียว`,
    `เขียน ${writes ? 'มี' : 'ไม่มี'} · อ่านกลับ ${reads ? 'มี' : 'ไม่มี'} → เก็บค่าไว้แต่ไม่เคยใช้`);
}

/* ผู้ใช้สั่ง 5 พ.ย. 2569: เข้าหน้าจองแล้วต้องอยู่ "มุมมองตาราง" เสมอ */
for (const [file, key] of [['VehiclesPage.vue', 'vehicle_view'], ['RoomsPage.vue', 'room_view']]) {
  const code = stripComments(read(`src/pages/${file}`));
  check(!new RegExp(`localStorage\\.(get|set)Item\\('${key}'`).test(code),
    `${file}: ไม่จำมุมมอง (${key}) แล้ว`);
  check(/const calView = ref\(false\);/.test(code),
    `${file}: เริ่มที่มุมมองตารางเสมอ (calView = false)`);
}

/* ผู้ใช้สั่ง 5 พ.ย. 2569: เปิดหน้าหนังสือราชการ → อยู่แท็บ "หนังสือรับ" เสมอ */
{
  const code = stripComments(read('src/pages/DocumentsPage.vue'));
  check(!/localStorage\.(get|set)Item\('doc_tab'/.test(code),
    'DocumentsPage.vue: ไม่จำแท็บ (doc_tab) แล้ว');
  check(/const currentType = ref\('incoming'\);/.test(code),
    'DocumentsPage.vue: เปิดมาที่แท็บ "หนังสือรับ" เสมอ');
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
check(/if \(!groups\.value\.some\(\(g\) => g\.key === t\)\)[\s\S]{0,200}?'vacation'/.test(pickBody),
  'deep-link ที่ชี้ไปแท็บที่ไม่มี ต้องตกกลับไปแท็บลาพักผ่อน ไม่ใช่ค้างว่าง');

console.log('');
console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);
