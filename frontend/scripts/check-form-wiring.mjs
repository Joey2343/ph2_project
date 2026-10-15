/**
 * check-form-wiring.mjs — กันฟอร์มที่ "กรอกแล้วบันทึกไม่ได้"
 *
 * บั๊กที่เจอจริง 2 จุดใน DocumentsIncomingFormModal.vue (ลงทะเบียนรับหนังสือ)
 *
 * ① ช่อง "หนังสือจาก" ผูกกับ fromInput แต่ตอนตรวจ/บันทึกอ่าน fromOrg คนละตัว
 *    ทั้งสองตัวไม่เคยเชื่อมกัน → กรอกครบ กดบันทึก ก็ขึ้น
 *    "กรุณาเลือกหน่วยงานต้นเรื่อง" และไม่ยิง request เลย
 *
 * ② ThaiDateField อ่านค่าผ่าน document.getElementById(props.id)
 *    ถ้าไม่ไส่ id → UI.h ข้าม attribute ที่เป็น undefined → input ไม่มี id
 *    → getElementById('') = null → onChange return ทิ้ง → ไม่ emit เลย
 *    ผู้ใช้เลือกวันที่แล้วจอเปลี่ยน แต่ค่าที่บันทึกยังเป็นวันที่เดิม (ข้อมูลผิดเงียบ ๆ)
 *
 * ใช้: node scripts/check-form-wiring.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.vue$/.test(e.name)) out.push(p);
  }
  return out;
}

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
}

/* ── ① ช่องที่ผู้ใช้พิมพ์ ต้องเป็นตัวเดียวกับที่ตรวจและบันทึก ─────────────── */
console.log('\n① ช่องกรอก ↔ ค่าที่บันทึก ต้องเป็นตัวเดียวกัน');

const incFile = join(ROOT, 'src', 'components', 'documents', 'DocumentsIncomingFormModal.vue');
const incRaw = readFileSync(incFile, 'utf8');
const inc = incRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

check(!/const\s+fromOrg\s*=\s*ref\(/.test(inc),
  'DocumentsIncomingFormModal: ไม่มีตัวแปร fromOrg คนละตัวกับช่องกรอกแล้ว',
  'ถ้ามีอีกตัว ต้องเชื่อมให้ช่องกรอกเขียนลงตัวเดียวกับที่ตรวจ/บันทึก');

// ตัวแปรที่ผูกกับ input ต้องถูกใช้ทั้งตอนตรวจว่าว่าง และตอน append ลง FormData
const validateFrom = /if\s*\(\s*!\s*fromInput\.value\.trim\(\)\s*\)/.test(inc);
const sendFrom = /fd\.append\(\s*'from_org'\s*,\s*fromInput\.value/.test(inc);
check(validateFrom,
  'DocumentsIncomingFormModal: ตอนตรวจ "หนังสือจาก" ว่าง ใช้ fromInput',
  'ต้องอ่านจากตัวเดียวกับที่ v-model ผูกกับช่อง ไม่ใช่ตัวแปรอีกตัวที่ไม่เคยถูกเขียน');
check(sendFrom,
  'DocumentsIncomingFormModal: ตอนบันทึก "หนังสือจาก" ใช้ fromInput',
  'ต้องอ่านจากตัวเดียวกับที่ v-model ผูกกับช่อง');

// ช่องวันที่ใหม่ต้องมีและต้องส่งค่าไปด้วย
check(/<label>ลงวันที่<\/label>/.test(inc),
  'DocumentsIncomingFormModal: มีช่อง "ลงวันที่"');
check(/fd\.append\('letter_date',/.test(inc),
  'DocumentsIncomingFormModal: ส่ง letter_date ไปกับ FormData');
check(/letterDate\.value\s*=\s*d\.value\.letter_date/.test(inc),
  'DocumentsIncomingFormModal: เติมค่า letter_date เดิมตอนแก้ไข');

/* ── ② ThaiDateField ต้องไม่พึ่ง document.getElementById ───────────────── */
console.log('\n② ThaiDateField ต้องผูกกับ input ของตัวเอง ไม่ใช่ id');

const tdfRaw = readFileSync(join(ROOT, 'src', 'components', 'ui', 'ThaiDateField.vue'), 'utf8');
// ตัดคอมเมนต์ออกก่อนตรวจ ไม่งั้นบรรทัดที่ "อธิบายบั๊ก" จะทำให้ตรวจผิด
const tdf = tdfRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
check(!/document\.getElementById\s*\(\s*props\.id\s*\)/.test(tdf),
  'ThaiDateField: ไม่อ่าน input ผ่าน document.getElementById(props.id)',
  'ถ้าไม่ใส่ id จะได้ null แล้ว onChange ไม่ emit → เลือกวันที่แล้วค่าไม่เปลี่ยน');
check(/inputEl\.value\s*=\s*picker\.querySelector\('input'\)/.test(tdf),
  'ThaiDateField: เก็บ reference ของ input ตัวเอง');
check(/UI\.readThaiDateInput\(el\)/.test(tdf),
  'ThaiDateField: อ่านค่าจาก element ที่ถือไว้');

const ui = readFileSync(join(ROOT, 'src', 'ui', 'ui.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
check(/readThaiDateInput\(idOrEl\)/.test(ui),
  'UI.readThaiDateInput รับได้ทั้ง id และ element');

/* ── ③ ทุกจุดที่ใช้ ThaiDateField ต้องใช้งานได้ ─────────────────────────── */
console.log('\n③ การใช้งาน ThaiDateField');

const files = walk(join(ROOT, 'src'));
let usages = 0;
const withoutId = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const re = /<ThaiDateField\b([^>]*)>/g;
  let m;
  while ((m = re.exec(src))) {
    usages += 1;
    if (!/\bid=/.test(m[1])) withoutId.push(relative(ROOT, f));
  }
}
check(usages > 0, `พบ ThaiDateField ${usages} จุดในโปรเจกต์`);
check(withoutId.length === 0,
  'ไม่มีจุดไหนเรียก ThaiDateField โดยไม่ส่ง id',
  'ไม่บังคับต้องมี id แล้ว แต่ถ้าไม่มีจะตรวจตอน runtime ไม่ได้ — ควรใส่: ' + withoutId.join(', '));

/* ── ④ ช่องที่ map มาจากข้อมูลเดิม ต้องพาคีย์ที่จำเป็นไปด้วย ──────── */
console.log('\n④ คีย์ที่ต้องพาไปกับฟอร์มแก้ไข (ถ้าหลุด = บันทึกซ้ำเป็นแถวใหม่)');

const office = readFileSync(join(ROOT, 'src', 'pages', 'OfficePage.vue'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const openEdit = office.match(/function\s+openEdit\s*\(\)\s*\{[\s\S]*?\n\}/);
// คอลัมน์ key ของ office_sections เป็น UNIQUE — ถ้า key หลุดจาก draft จะเป็น NULL
// → ON DUPLICATE KEY ไม่มีอะไรชนซ้ำ → INSERT แถวใหม่ทุกครั้งที่บันทึก
check(!!openEdit, 'OfficePage: พบฟังก์ชัน openEdit()');
if (openEdit) {
  const body = openEdit[0];
  check(/key:\s*s\.key/.test(body),
    'OfficePage.openEdit: พา `key` ไปกับ draft',
    'ถ้าไม่พา key ฝั่ง backend จะ INSERT แถวใหม่ทุกครั้งที่บันทึก (หน้าจะเติบโตไม่หยุด)');
  check(/sort:\s*(?:Number\()?s\.sort/.test(body),
    'OfficePage.openEdit: พา `sort` ไปกับ draft',
    'ถ้าไม่พา sort ลำดับหัวข้อจะเพี้ยนทุกครั้งที่บันทึก');
}

/* ── ⑤ ช่องที่ checkbox เป็นตัวคุม ต้องผูก disabled กับ "ติ๊กไว้" ไม่ใช่ "ค่าในช่อง" ──
 *
 * บั๊กที่เจอจริงใน TravelForm.vue (ยื่นคำขอไปราชการ)
 *   :disabled="f.expense_items[it.key] <= 0"
 *   ค่าเริ่มต้นของช่องคือ 0 → 0 <= 0 → disabled ถาวร
 *   และ @change ของ checkbox ล้างค่าเฉพาะตอน "เอาติ๊กออก" ไม่เคยเปิดช่องให้
 *   → ตัวตายวน: พิมพ์ไม่ได้เพราะค่าเป็น 0 · ค่าจะบวกได้ก็ต่อเมื่อพิมพ์ · ติ๊กก็ไม่ช่วย
 *   → ผู้ใช้กรอกค่าเบี้ยเลี้ยง/ค่าเช่าที่พัก/ค่าพาหนะ/ค่าใช้จ่ายอื่น ไม่ได้เลย
 *
 * โค้ดเดิม (docs/legacy/source-v1/js/views/travel.js) ทำถูกแล้ว:
 *   checkbox onchange → input.disabled = !checkbox.checked
 *   ค่าเริ่มต้น disabled = true แล้วติ๊กแล้วถึงพิมพ์ได้
 */
console.log('\n⑤ ช่องที่ checkbox เป็นตัวคุม ต้องผูก disabled กับการติ๊ก ไม่ใช่ค่าในช่อง');

const travel = readFileSync(join(ROOT, 'src', 'components', 'ui', 'TravelForm.vue'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '');

check(!/:disabled="f\.expense_items\[it\.key\]\s*<=\s*0"/.test(travel),
  'TravelForm: ไม่ผูก disabled กับค่าในช่อง (ช่องจะถูกล็อกถาวร กรอกไม่ได้)',
  'ถ้าผูกกับค่า: ค่าเริ่มต้น 0 → disabled → พิมพ์ไม่ได้ → ค่าก็ไม่มีทางเป็นบวก');
check(/:disabled="!expenseChecked\[it\.key\]"/.test(travel),
  'TravelForm: disabled ผูกกับสถานะการติ๊ก (expenseChecked)');
check(/expenseChecked\.value\[key\]\s*=\s*!!on/.test(travel),
  'TravelForm: มี toggleExpense() จำสถานะการติ๊ก');
check(/function toggleExpense\(key, on\)[\s\S]{0,200}?if \(!on\)[\s\S]{0,80}?expense_items\[key\]\s*=\s*0/.test(travel),
  'TravelForm: เอาติ๊กออกแล้วล้างค่าในช่อง (ไม่ใช่ค้างยอดเก่าไว้แล้วส่งต่อไป)');
check(/expenseChecked\.value\.baht\s*\?/.test(travel),
  'TravelForm: ตอนส่งข้อมูลเช็ค "ติ๊กไว้" ไม่ใช่ "ค่ามากกว่า 0"',
  'ถ้าเช็คแค่ค่า: ติ๊กแล้วลืมพิมพ์จำนวน → ยอด 0 ถูกส่งไปเหมือนไม่ได้ติ๊ก');

console.log('');
console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);