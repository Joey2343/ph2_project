/**
 * ตรวจตารางรายการจอง (ยานพาหนะ + ห้องประชุม)
 *
 * ที่ต้องผ่าน
 * ────────
 * คอลัมน์ในตารางรายการจองเรียงเป็น  วันที่ → เวลา → วันเขียนจอง → …
 *   · "เวลา" ต้องอยู่ติด "วันที่" (ย้ายมาจากท้ายตาราง)
 *   · "วันเขียนจอง" เป็นชื่อที่ใช้จริง (ไม่ใช่ "วันที่จอง" แบบเดิม)
 *
 * ค่าในคอลัมน์ "วันเขียนจอง" มาจาก created_at แต่โชว์ "วันเขียนจอง ไม่เอาเวลา"
 *   ต้องใช้ UI.date() ซึ่งตัดทิ้งส่วนเวลาทิ้ง (slice(0,10))
 *   ถ้าไปใช้ตัวแสดงเวลา จะเห็น "16/10/2569 09:30" ซึ่งผิดจากที่สั่ง
 *
 * ใช้: node scripts/check-booking-columns.mjs
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

/* ดึงฟังก์ชัน date() มาทดสอบ (ui.js เป็น ESM ที่พึ่ง DOM → โหลดตรงไม่ได้) */
const uiSrc = readFileSync(path.join(ROOT, 'src', 'ui', 'ui.js'), 'utf8');
const i = uiSrc.indexOf('  date(');
if (i === -1) throw new Error('ไม่พบฟังก์ชัน date() ใน ui.js');
let depth = 0;
let end = uiSrc.indexOf('{', i);
for (let k = end; k < uiSrc.length; k += 1) {
  if (uiSrc[k] === '{') depth += 1;
  else if (uiSrc[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
}
const UI = {};
// eslint-disable-next-line no-new-func
new Function('UI', `function ${uiSrc.slice(i, end)}\nUI.date = date;`)(UI);

console.log('');
console.log('① UI.date() ตัดส่วนเวลาทิ้ง (คอลัมน์ "วันเขียนจอง" ห้ามโชว์เวลา)');
check(UI.date('2026-10-16 09:30:00') === '16/10/2569',
  'created_at ที่มีเวลา → เหลือแค่วัน/เดือน/ปี พ.ศ.',
  'ได้ ' + JSON.stringify(UI.date('2026-10-16 09:30:00')));
check(!/\d{2}:\d{2}/.test(String(UI.date('2026-10-16 09:30:00'))),
  'ผลลัพธ์ไม่มีรูปแบบเวลาหลงเหลือ');
check(UI.date('2026-01-05 23:59:59') === '05/01/2569',
  'เวลา 23:59:59 ต้องไม่ทำให้วันเพี้ยน',
  'ได้ ' + UI.date('2026-01-05 23:59:59'));

console.log('');
console.log('② ปี พ.ศ. ต้องบวก 543');
check(UI.date('2026-10-16') === '16/10/2569', 'ค.ศ. 2026 → พ.ศ. 2569');
check(UI.date('2025-01-01') === '01/01/2568', 'ค.ศ. 2025 → พ.ศ. 2568');
check(UI.date('1943-01-01') === '01/01/2486', 'ปี พ.ศ. ต้องยังบวกได้ถูกต้อง');

console.log('');
console.log('③ ค่าที่ไม่ใช่วันที่');
check(UI.date('') === '-', 'ค่าว่าง → "-"', 'ได้ ' + JSON.stringify(UI.date('')));
check(UI.date(null) === '-', 'null → "-"');
check(UI.date(undefined) === '-', 'undefined → "-"');
check(UI.date('ไม่ใช่วันที่') === 'ไม่ใช่วันที่',
  'ค่าที่ไม่ใช่วันที่ → คืนค่าเดิม ไม่กลายเป็น NaN',
  'ได้ ' + UI.date('ไม่ใช่วันที่'));
check(!/NaN/.test(String(UI.date('ไม่ใช่วันที่'))), 'ไม่มี NaN โผล่บนหน้าเว็บ');

console.log('');
console.log('④ หัวตาราง + เซลล์ ในหน้ารายการจอง');
const PAGES = [
  ['src/pages/VehiclesPage.vue', 'หน้ารายการจองยานพาหนะ'],
  ['src/pages/RoomsPage.vue', 'หน้ารายการจองห้องประชุม'],
];
for (const [file, label] of PAGES) {
  const page = readFileSync(path.join(ROOT, file), 'utf8');

  // ⚠️ ต้องหา <table> ที่ "มี วันเขียนจอง" ไม่ใช่ตารางแรกของไฟล์
  //   หน้ายานพาหนะมีหลายตาราง (รายชื่อยานพาหนะ, รายการจอง, ตั้งค่าผู้อนุมัติ)
  //   ถ้าไปอ่านอันแรกจะเจอตารางคนละอัน แล้วผ่านทั้งที่ยังไม่ได้เพิ่มคอลัมน์
  //   — และต้องผูก <thead> กับ <tbody> ของ "ตารางเดียวกัน"
  //     ถ้าเอา thead จากตารางหนึ่ง แต่ tbody จากอีกตารางหนึ่ง
  //     จะได้จำนวนคอลัมน์ไม่ตรงกันเสมอ (false fail) หรือตรงกันทั้งที่ผิดตาราง (false pass)
  const tables = [...page.matchAll(/<table[^>]*>[\s\S]*?<\/table>/g)].map((m) => m[0]);
  const table = tables.find((t) => t.includes('วันเขียนจอง')) || '';
  const head = (/<thead>[\s\S]*?<\/thead>/.exec(table) || [''])[0];
  const cells = (/<tbody>[\s\S]*?<\/tbody>/.exec(table) || [''])[0];

  check(!!table, `${label}: มีตารางรายการจองที่มีคอลัมน์ "วันเขียนจอง"`,
    `ไม่พบ <table> ที่มี "วันเขียนจอง" (ในไฟล์มี ${tables.length} ตาราง)`);
  check(/<th>วันที่<\/th>\s*<th>เวลา<\/th>\s*<th>วันเขียนจอง<\/th>/.test(head),
    `${label}: เรียงเป็น วันที่ → เวลา → วันเขียนจอง`,
    'ยังไม่พบลำดับ <th>วันที่</th><th>เวลา</th><th>วันเขียนจอง</th>');
  check(!/<th>วันที่จอง<\/th>/.test(page),
    `${label}: ไม่มีชื่อคอลัมน์เก่า "วันที่จอง" เหลืออยู่`);

  check(/UI\.date\(r\.created_at\)/.test(cells),
    `${label}: เซลล์ "วันเขียนจอง" ดึงค่าจาก created_at`);
  check(!/dateTime/.test(cells),
    `${label}: ไม่มีการโชว์เวลาในเซลล์ (ห้ามใช้ตัวแสดงวัน+เวลา)`);
  check(!/:title="r\.created_at/.test(cells),
    `${label}: ไม่มี tooltip ที่แอบโชว์ created_at เต็ม (มีเวลาติดมาด้วย)`);

  // ย้ายเซลล์ "เวลา" ขึ้นมาต่อ "วันที่" ด้วย — นับลำดับ <td> ในแถวแรก
  // ⚠️ นับด้วย /<th[\s>]/ ไม่ใช่ /<th/g
  //   <thead> ขึ้นต้นด้วย "<th" เหมือนกัน → จะนับเกินมา 1 ทุกครั้ง
  //   ผลคือทั้ง 2 หน้าเพี้ยนเท่ากันหมด ดูเหมือน "ผิดทั้งคู่" แต่จริงๆ แค่ regex พลาด
  const firstRow = /<tr v-for="r in [^"]+"[^>]*>[\s\S]*?<\/tr>/.exec(cells);
  const tds = firstRow ? (firstRow[0].match(/<td[\s>]/g) || []).length : 0;
  const thCount = (head.match(/<th[\s>]/g) || []).length;
  check(tds === thCount && thCount > 0,
    `${label}: จำนวน <td> ตรงกับ <th> (${tds} / ${thCount}) — ไม่มีคอลัมน์หลุด`,
    'ถ้าไม่ตรง แปลว่าย้าย <th> แล้วลืมย้าย <td> (หรือสลับ) → ข้อมูลจะผิดคอลัมน์');
  const timeAt = cells.indexOf('UI.time(r.start_time)');
  const bookingAt = cells.indexOf('UI.date(r.created_at)');
  const dateAt = cells.search(/\{\{ (?:dateCell\(r\)|UI\.date\(r\.date\)) \}\}/);
  check(timeAt > -1 && bookingAt > -1 && dateAt > -1 && dateAt < timeAt && timeAt < bookingAt,
    `${label}: เซลล์เรียง วันที่ → เวลา → วันเขียนจอง ตรงกับหัวตาราง`,
    `ตำแหน่ง: วันที่=${dateAt} เวลา=${timeAt} วันเขียนจอง=${bookingAt}`);
}

console.log('');
console.log('⑤ ไม่มีตัวแสดงวัน+เวลา ค้างเป็นโค้ดตาย');
check(!/dateTime/.test(uiSrc),
  'ui.js ไม่มีฟังก์ชันที่ไม่มีใครเรียกใช้แล้ว (dead code)');

console.log('');
console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);