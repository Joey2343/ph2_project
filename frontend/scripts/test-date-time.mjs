/**
 * ทดสอบ UI.dateTime() — รูปแบบวันที่+เวลา พ.ศ. สำหรับคอลัมน์ "วันที่จอง"
 *
 * ทำไมต้องมี
 * ──────────
 * คอลัมน์ "วันที่จอง" ในหน้ารายการจองยานพาหนะ/ห้องประชุม เอา created_at มาแสดง
 * created_at เก็บเป็น varchar "YYYY-MM-DD HH:MM:SS" แต่ข้อมูลเก่าอาจเป็น:
 *   · ว่าง            → ต้องขึ้น "-"
 *   · ไม่มีส่วนเวลา   → ต้องขึ้นแค่วันที่ ไม่ใช่เติม " undefined"
 *   · ไม่ใช่รูปแบบวันที่ → ต้องคืนค่าเดิม ไม่ทำให้เพี้ยนเป็น NaN
 *
 * ใช้: node scripts/test-date-time.mjs
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

/* ดึงเฉพาะฟังก์ชัน date + dateTime มาทดสอบ (ui.js เป็น ESM ที่พึ่ง DOM) */
const src = readFileSync(path.join(ROOT, 'src', 'ui', 'ui.js'), 'utf8');
const grab = (name) => {
  const i = src.indexOf(`  ${name}(`);
  if (i === -1) throw new Error('ไม่พบ ' + name);
  // นับวงเล็บปีกกาที่สมดุลเพื่อตัดฟังก์ชันออกมาทั้งก้อน
  let d = 0, j = src.indexOf('{', i), k = j;
  for (; k < src.length; k++) {
    if (src[k] === '{') d += 1;
    else if (src[k] === '}') { d -= 1; if (d === 0) { k += 1; break; } }
  }
  // ต้นฉบับเป็น object method shorthand (date(d) { … }) → เติม "function" ให้เป็นฟังก์ชันธรรมดา
  return `function ${src.slice(i, k)}`;
};
const UI = {};
// eslint-disable-next-line no-new-func
// ต้องผูกกลับเข้า UI ด้วย — ฟังก์ชันที่ประกาศใน new Function เป็น scope ของตัวเอง ไม่ใช่เมธอดของอ็อบเจกต์
// (dateTime ข้างในเรียก UI.date(...) ต้องมี UI.date อยู่จริง)
new Function('UI', `${grab('date')}\n${grab('dateTime')}\nUI.date = date; UI.dateTime = dateTime;`)(UI);

console.log('');
console.log('① รูปแบบปกติของ created_at');
check(UI.dateTime('2026-10-16 09:30:00') === '16/10/2569 09:30',
  'created_at เต็ม → วัน/เดือน/ปี พ.ศ. + เวลา 24 ชั่วโมง',
  'ได้ ' + UI.dateTime('2026-10-16 09:30:00'));
check(UI.dateTime('2026-01-05 00:07:00') === '05/01/2569 00:07',
  'เดือนมกราคม + เวลาเที่ยงคืน (ไม่เพี้ยนเป็น 0 หรือ 12 ชั่วโมง)',
  'ได้ ' + UI.dateTime('2026-01-05 00:07:00'));
check(UI.dateTime('2026-12-31 23:59:00') === '31/12/2569 23:59',
  'สิ้นปี (ไม่เพี้ยนปี)',
  'ได้ ' + UI.dateTime('2026-12-31 23:59:00'));

console.log('');
console.log('② ค่าที่ไม่ครบรูปแบบ');
check(UI.dateTime('') === '-', 'ค่าว่าง → "-"', 'ได้ ' + JSON.stringify(UI.dateTime('')));
check(UI.dateTime(null) === '-', 'null → "-"');
check(UI.dateTime(undefined) === '-', 'undefined → "-"');
check(UI.dateTime('2026-10-16') === '16/10/2569',
  'มีแต่วันที่ (ไม่มีเวลา) → แสดงแค่วันที่ ไม่ต้องมีเวลาปลอม',
  'ได้ ' + UI.dateTime('2026-10-16'));
check(UI.dateTime('ไม่ใช่วันที่') === 'ไม่ใช่วันที่',
  'ค่าที่ไม่ใช่วันที่ → คืนค่าเดิม ไม่กลายเป็น NaN',
  'ได้ ' + UI.dateTime('ไม่ใช่วันที่'));

console.log('');
console.log('③ ปี พ.ศ. ต้องบวก 543');
check(UI.dateTime('2026-10-16 09:30:00').includes('2569'),
  'ปี ค.ศ. 2026 → พ.ศ. 2569');
check(UI.dateTime('2025-01-01 08:00:00').includes('2568'),
  'ปี ค.ศ. 2025 → พ.ศ. 2568');

console.log('');
console.log('④ คอลัมน์ "วันที่จอง" ต้องอยู่ตรงตำแหน่งที่ถูก');
for (const [file, label] of [
  ['src/pages/VehiclesPage.vue', 'หน้ารายการจองยานพาหนะ'],
  ['src/pages/RoomsPage.vue', 'หน้ารายการจองห้องประชุม'],
]) {
  const page = readFileSync(path.join(ROOT, file), 'utf8');
  // ⚠️ ต้องหา <thead> ที่ "มี วันที่จอง" ไม่ใช่อันแรกของไฟล์
  //   หน้ายานพาหนะมีหลายตาราง (รายชื่อยานพาหนะ, รายการจอง, ตั้งค่าผู้อนุมัติ)
  //   ถ้าไปอ่านอันแรกจะเจอตารางคนละอันแล้วผ่านทั้งที่ยังไม่ได้เพิ่มคอลัมน์
  const heads = [...page.matchAll(/<thead>[\s\S]*?<\/thead>/g)].map((m) => m[0]);
  const head = heads.find((h) => h.includes('วันที่จอง')) || '';
  check(!!head && /<th>วันที่<\/th>\s*<th>วันที่จอง<\/th>/.test(head),
    `${label}: คอลัมน์ "วันที่จอง" อยู่ต่อจาก "วันที่"`,
    `ไม่พบลำดับ <th>วันที่</th><th>วันที่จอง</th> ในตารางรายการจอง (พบ ${heads.length} ตารางในไฟล์)`);
  check(/UI\.dateTime\(r\.created_at\)/.test(page),
    `${label}: ดึงค่าจาก created_at (ไม่ใช่วันที่ใช้งาน)`);
}

console.log('');
console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);