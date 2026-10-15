/**
 * ตรวจว่าปุ่ม "ลบ" ในหน้าเดียวกันมีการเรียกฟังก์ชันเดียวกันซ้ำหรือไม่
 *
 * ทำไมต้องมี
 * ──────────
 * เจอจริงใน LeavePage.vue — มีปุ่ม ✕ สองปุ่มติดกัน ทำงานเหมือนกันเป๊ะ
 *   · v-if="showOwnerDelete(r)"  → เจ้าของรายการ (ยังไม่อนุมัติขั้น 2)
 *   · v-if="Auth.isAdmin()"      → ผู้ดูแลระบบ
 *   คนที่เป็นทั้งสองอย่าง (admin ที่ยื่นลาเอง) จะเห็นปุ่ม 2 ปุ่ม
 *
 * ⚠️ บทเรียนเรื่องวิธีตรวจ
 *   รุ่นแรกใช้ regex <button … @click="…" … </button> ที่ [\s\S] ข้ามผ่าน </button> ได้
 *   → ปุ่มแรกไปจับคู่กับปุ่มที่สองแทน → รายงาน "ไม่มีปุ่มซ้ำ" ทั้งที่มีจริง
 *   → เจอเพราะตอนพิสูจน์ว่าเทสต์จับได้ แต่เทสต์บอกว่าไม่ซ้ำ
 *   แก้โดยแบ่งไฟล์เป็นชิ้นตาม <button> แล้วอ่านแต่ละชิ้นจนกว่าจะเจอ </button> แรก
 *
 * ใช้: node scripts/check-dup-buttons.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGES = path.join(HERE, '..', 'src', 'pages');

let pass = 0;
let fail = 0;
const check = (ok, name, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
};

/** แบ่งไฟล์เป็นชิ้นตาม <button> แต่ละชิ้นจบที่ </button> แรกเท่านั้น */
function buttonsIn(src) {
  const out = [];
  const re = /<button\b/g;
  let m = re.exec(src);
  while (m) {
    const start = m.index;
    const end = src.indexOf('</button>', start);
    const html = end === -1 ? src.slice(start, start + 800) : src.slice(start, end);
    out.push({ line: src.slice(0, start).split('\n').length, html });
    re.lastIndex = end === -1 ? src.length : end;
    m = re.exec(src);
  }
  return out;
}

/** จับปุ่มที่ "ลบ" (เรียก remove/del/delete) */
/**
 * จับปุ่มที่ "ลบ" (เรียก remove / del / delete)
 *
 * ⚠️ ส่วนชื่อฟังก์ชันต้องเป็น optional
 *   เคยเขียน (remove|del|delete)([a-zA-Z_$][\w$]*)\( ซึ่ง "บังคับต้องมีอักษรต่อท้าย"
 *   → พอดีกับ removeRow(x) แต่ไม่ match remove(x) เลย
 *   → หน้าที่ปุ่มซ้ำคือ remove(x) พอดี → ตัวตรวจจึงบอกว่า "ไม่มีปุ่มซ้ำ"
 *   เจอตอนทดสอบย้อนโค้ด เพราะเทสต์ผ่านทั้งที่ไม่ควรผ่าน
 */
const CLICK = /@click="(remove|del|delete)([a-zA-Z_$][\w$]*)?\(([a-zA-Z_$][\w$.]*)\)"/;

console.log('');
console.log('① หน้าเว็บต้องไม่มีปุ่มที่เรียกฟังก์ชันเดียวกันซ้ำ');

const problems = [];
const total = [];

for (const f of readdirSync(PAGES).filter((x) => x.endsWith('.vue'))) {
  const src = readFileSync(path.join(PAGES, f), 'utf8');
  const found = new Map();
  for (const b of buttonsIn(src)) {
    const c = CLICK.exec(b.html);
    if (!c) continue;
    // c[2] เป็น undefined เมื่อชื่อฟังก์ชันไม่มีท้าย (remove ไม่ใช่ removeRow)
    // ใช้ ?? '' ไม่ใช้ + ไม่งั้นข้อความจะขึ้นว่า "removeundefined(r)"
    const key = `${c[1]}${c[2] ?? ''}(${c[3]})`;
    if (!found.has(key)) found.set(key, []);
    found.get(key).push(b.line);
  }
  for (const [key, lines] of found) {
    total.push({ f, key, lines });
    if (lines.length > 1) problems.push({ f, key, lines });
  }
}

if (!total.length) {
  console.log('  ✔ ไม่พบปุ่มลบแบบเรียกฟังก์ชันในไฟล์เหล่านี้');
} else if (!problems.length) {
  console.log(`  ✔ สแกน ${total.length} ปุ่มลบใน ${new Set(total.map((t) => t.f)).size} หน้า — ไม่มีปุ่มซ้ำ`);
} else {
  for (const p of problems) {
    console.log(`  ✖ ${p.f}: ปุ่ม ${p.key} เรียก ${p.lines.length} ครั้ง (บรรทัด ${p.lines.join(', ')})`);
    console.log('      → ผู้ใช้ที่เข้าเงื่อนไขทั้งสองจะเห็นปุ่มซ้ำ');
  }
}
check(problems.length === 0, 'ไม่มีปุ่มซ้ำในหน้าใด', `${problems.length} จุด`);

console.log('');
console.log('② จุดที่เคยพังต้องรวมเป็นปุ่มเดียว');
const leave = readFileSync(path.join(PAGES, 'LeavePage.vue'), 'utf8');
const delCalls = (leave.match(/@click="remove\(r\)"/g) || []).length;
check(delCalls === 1,
  'LeavePage.vue มีปุ่มลบที่เรียก remove(r) เพียงปุ่มเดียว',
  `เจอ ${delCalls} ปุ่ม — เดิมมี 2 ปุ่ม (showOwnerDelete + Auth.isAdmin)`);
check(/v-if="showOwnerDelete\(r\) \|\| Auth\.isAdmin\(\)"/.test(leave),
  'เงื่อนไขรวมเป็น OR (ครอบคลุมทั้งเจ้าของและ admin โดยไม่ซ้ำ)');

console.log('');
console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);