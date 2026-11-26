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
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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

/* ── ⑥ ปั้มรับทับไฟล์เดิม + ส่งไฟล์แนบทั้งหมดเข้า "ส่งไปรษณีย์ภายในเขต" ────
 *
 * ผู้ใช้สั่ง 11 พ.ย. 2569
 *   "ลงทะเบียนรับหนังสือ-ลงเลขหนังสือรับ-ปั้มรับ (ทับไฟล์เดิม ไม่สร้างไฟล์ใหม่)-บันทึก
 *    จะเปิดหน้าต่างส่งไปรษณีย์ภายในเขต (ให้ดึงไฟล์แนบทั้งหมดมาแนบส่งด้วย)"
 */
console.log('\n⑥ ปั้มรับทับไฟล์เดิม + ส่งไฟล์แนบทั้งหมดไปหน้าส่งไปรษณีย์');

check(/fd\.append\('stamp_replace',\s*stampReplacePath\.value\)/.test(inc),
  'DocumentsIncomingFormModal: ส่ง stamp_replace ไปกับ FormData',
  'ถ้าไม่ส่ง ไฟล์ที่ปั้มจะถูกเพิ่มเป็นไฟล์ใหม่ (มี 2 ฉบับ) แทนที่จะทับไฟล์เดิม');
check(/stampReplacePath\.value\s*=\s*existingFirstFile\.value/.test(inc),
  'DocumentsIncomingFormModal: จำ path ไฟล์เดิมตอนปั้มจากไฟล์เดิม');
check(/stampReplacePath\.value\s*=\s*''\s*;\s*\n\s*stampFile\.value\s*=\s*src/.test(inc),
  'DocumentsIncomingFormModal: ปั้มจากไฟล์ที่เพิ่งเลือก → ไม่แทนที่ไฟล์เดิม');
check(/const savedPaths\s*=\s*Array\.isArray\(res\s*&&\s*res\.files\)\s*\?\s*res\.files\s*:\s*\[\]/.test(inc),
  'DocumentsIncomingFormModal: อ่านรายการไฟล์แนบทั้งหมดจากผลบันทึก (res.files)');
check(/loadAttachmentsAsFiles\(savedPaths,\s*savedNames\)/.test(inc),
  'DocumentsIncomingFormModal: ดาวน์โหลดไฟล์แนบเดิมกลับมาเป็น File');
check(/files:\s*allFiles\.length\s*\?\s*allFiles\s*:\s*files/.test(inc),
  'DocumentsIncomingFormModal: ส่งไฟล์ทั้งหมด (ไม่ใช่แค่ไฟล์ที่เพิ่งอัปโหลด) เข้า open-postal');

const docsPageSrc = readFileSync(join(ROOT, 'src', 'pages', 'DocumentsPage.vue'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
check(/DocumentsView\.openPostalForm\(files\s*\|\|\s*\[\],\s*prefill\s*\|\|\s*\{\}\)/.test(docsPageSrc),
  'DocumentsPage: เปิดหน้าส่งไปรษณีย์พร้อมไฟล์ที่ได้รับจากฟอร์ม');

const viewSrc = readFileSync(join(ROOT, 'src', 'views', 'DocumentsView.js'), 'utf8');
check(/prefilledFiles\.slice\(0,\s*7\)\.forEach\(function\s*\(f\)\s*\{\s*addPostalFileRow\(f\)/.test(viewSrc),
  'DocumentsView.openPostalForm: เติมไฟล์ที่ส่งมาให้อัตโนมัติ');

/* ── ⑦ ตำแหน่งที่เลือกตอน "อนุมัติขั้นต้น" ของสายสถานศึกษา ───────────────
 *
 * ผู้ใช้สั่ง 12 พ.ย. 2569
 *   · ไปราชการ (สถานศึกษา) → ตัวเลือกตำแหน่งต่อจาก "กรุณาเลือกการพิจารณา"
 *   · ลา (แท็บสถานศึกษา) → ตัวเลือกตำแหน่ง "ก่อน" ความเห็นผู้บังคับบัญชา
 */
console.log('\n⑦ ตัวเลือกตำแหน่งในหน้าอนุมัติขั้นต้น (สายสถานศึกษา)');

const travelDecide = readFileSync(join(ROOT, 'src', 'components', 'ui', 'TravelDecide.vue'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '');
check(/const showPosition = computed\([\s\S]{0,160}?mode === 'final' \|\| \(props\.mode === 'level1' && isSchool\.value\)/.test(travelDecide),
  'TravelDecide: แสดงตัวเลือกตำแหน่งในขั้นอนุมัติขั้นต้นของสถานศึกษา');
check(/<template v-if="showPosition">/.test(travelDecide),
  'TravelDecide: ตำแหน่งแสดงหลังส่วนเลือกการพิจารณา (v-if="showPosition")');
check(/position: showPosition\.value \? position\.value : ''/.test(travelDecide),
  'TravelDecide: ส่งตำแหน่งที่เลือกกลับไปกับผลยืนยัน');

const travelPage = readFileSync(join(ROOT, 'src', 'pages', 'TravelPage.vue'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
check(/if \(out && out\.position\) body\.position = out\.position/.test(travelPage),
  'TravelPage: ส่ง position ไปกับ PUT /travel/:id/approve เมื่อมี');

const leaveNote = readFileSync(join(ROOT, 'src', 'components', 'ui', 'LeaveApproveNote.vue'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '');
check(/scope: \{ type: String, default: 'office' \}/.test(leaveNote),
  'LeaveApproveNote: รับ prop scope (office | school)');
check(/scope === 'school'/.test(leaveNote),
  'LeaveApproveNote: แสดงตัวเลือกตำแหน่งเฉพาะสายสถานศึกษา');
{
  const posAt = leaveNote.indexOf('lv-level1-position');
  const noteAt = leaveNote.indexOf('ความเห็นผู้บังคับบัญชา');
  check(posAt > -1 && noteAt > -1 && posAt < noteAt,
    'LeaveApproveNote: ตัวเลือกตำแหน่งอยู่ "ก่อน" ความเห็นผู้บังคับบัญชา',
    'ผู้ใช้สั่ง: เพิ่มส่วนตัวเลือกตำแหน่งไว้ก่อนส่วนความเห็นผู้บังคับบัญชา');
}
check(/emit\('confirm', \{\s*\n\s*note: note\.value,/.test(leaveNote),
  'LeaveApproveNote: ส่ง note + position กลับไป');

const leavePageSrc = readFileSync(join(ROOT, 'src', 'pages', 'LeavePage.vue'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
check(/:scope="current === 'general-school' \? 'school' : 'office'"/.test(leavePageSrc),
  'LeavePage: ส่ง scope ให้หน้าต่างอนุมัติขั้นต้นตามแท็บ');
check(/if \(position\) body\.position = position/.test(leavePageSrc),
  'LeavePage: ส่ง position ไปกับ PUT /leaves/:id/approve เมื่อมี');

/* ---------- ตัวเลือกตำแหน่ง: ต้องมี 3 ตัวเลือกของรอง ผอ.สพป. ---------- */
{
  const posHelper = readFileSync(join(ROOT, 'src', 'lib', 'approve-position.js'), 'utf8');
  check(/DEPUTY_OPTIONS/.test(posHelper) && posHelper.includes('รักษาราชการแทน') && posHelper.includes('ปฏิบัติราชการแทน'),
    'approve-position.js: มี 3 ตัวเลือกของรอง ผอ.สพป.');
  check(/approvePositionOptions\(Auth\.user\?\.position\)/.test(travelDecide),
    'TravelDecide: ใช้ตัวช่วยกลาง approvePositionOptions()');
  check(/approvePositionOptions\(Auth\.user/.test(leaveNote),
    'LeaveApproveNote: ใช้ตัวช่วยกลาง approvePositionOptions()');
  check(/approvePositionOptions\(Auth\.user\?\.position\)/.test(leavePageSrc),
    'LeavePage: ใช้ตัวช่วยกลาง approvePositionOptions()');

  const { approvePositionOptions } = await import('../src/lib/approve-position.js');
  const deputy = approvePositionOptions('รองผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2');
  check(deputy.length === 3 && deputy[1].includes('รักษาราชการแทน') && deputy[2].includes('ปฏิบัติราชการแทน'),
    'ตัวช่วยคืน 3 ตัวเลือกสำหรับรอง ผอ.สพป. (ตำแหน่งจริง/รักษาราชการแทน/ปฏิบัติราชการแทน)',
    JSON.stringify(deputy));
  const other = approvePositionOptions('เจ้าหน้าที่ธุรการ');
  check(other.length === 4 && other[1].includes('รองผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2'),
    'ตำแหน่งอื่น ๆ ยังมี 3 ตัวเลือกของรอง ผอ.สพป. ให้เลือก',
    JSON.stringify(other));
}

/* ── ⑧ ลงนามในร่างเอกสาร: คลิกแล้วต้องถามก่อนวางลายเซ็น (ผู้ใช้สั่ง 12 พ.ย. 2569) ──
 *
 * เดิมคลิกที่หน้าเอกสาร = วางลายเซ็นทันที (เผลอคลิกก็ได้ลายเซ็นเกิน)
 * ตอนนี้ต้องขึ้นเมนู 1) วางลายเซ็น 2) ยกเลิก ก่อน
 * การลากจากแถบเครื่องมือ/ลากย้าย/ลบ/ย่อ-ขยาย ต้องยังทำงานเหมือนเดิม
 */
console.log('\n⑧ ลงนามในร่างเอกสาร: คลิกในเอกสารต้องเลือกก่อนวางลายเซ็น');

const signEditor = readFileSync(join(ROOT, 'src', 'sign-editor', 'main.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
check(/function openPlaceMenu\(pageIndex, clientX, clientY\)/.test(signEditor),
  'sign-editor: มีเมนูยืนยันการวางลายเซ็น');
check(/ok\.textContent = '1\. วางลายเซ็น'/.test(signEditor), 'เมนูมีตัวเลือก “1. วางลายเซ็น”');
check(/cancel\.textContent = '2\. ยกเลิก'/.test(signEditor), 'เมนูมีตัวเลือก “2. ยกเลิก”');
check(/openPlaceMenu\(pageWraps\.indexOf\(wrap\), e\.clientX, e\.clientY\)/.test(signEditor),
  'คลิกในหน้าเอกสาร → เปิดเมนู (ไม่วางลายเซ็นทันที)',
  'ถ้าเรียก placeStamp ตรง ๆ ผู้ใช้เผลอคลิกแล้วจะได้ลายเซ็นเกิน');
check(!/if \(e\.target !== canvas && e\.target !== wrap\) return;\s*\n\s*placeStamp\(/.test(signEditor),
  'ไม่มีทางวางลายเซ็นทันทีจากการคลิกหน้าเอกสาร');
check(/onMenuKeyDown[\s\S]{0,120}?Escape/.test(signEditor), 'กด Esc ปิดเมนูได้');
check(/placeMenu\.contains\(e\.target\)\) closePlaceMenu\(\)/.test(signEditor),
  'คลิกที่อื่นปิดเมนู (ไม่วางลายเซ็น)');
// ของเดิมต้องยังอยู่
check(/del\.title = 'ลบลายเซ็นนี้'/.test(signEditor), 'ยังลบลายเซ็นได้ (ปุ่ม ✕)');
check(/rz\.title = 'ปรับขนาดลายเซ็น \(ลากมุมขวาล่าง\)'/.test(signEditor), 'ยังย่อ/ขยายลายเซ็นได้ (⤡)');
check(/stamp\.addEventListener\('pointermove'/.test(signEditor), 'ยังลากย้ายลายเซ็นได้');
check(/source\.addEventListener\('pointerup'[\s\S]{0,400}?placeStamp\(i, e\.clientX, e\.clientY\)/.test(signEditor),
  'ลากลายเซ็นจากแถบเครื่องมือลงเอกสารยังวางทันทีเหมือนเดิม');

const signHtml = readFileSync(join(ROOT, 'sign-editor.html'), 'utf8');
check(/\.sig-place-menu \{/.test(signHtml), 'sign-editor.html: มีสไตล์เมนูวางลายเซ็น');

/* ── ⑨ หน้าต่างอนุมัติบันทึกข้อความ: ตัวเลือกต้องไม่ซ้อนกันบนแท็บเล็ต ──────
 *
 * ผู้ใช้แจ้ง 12 พ.ย. 2569: "ปฏิบัติราชการ/รักษาราชการแทน" บนแท็บเล็ต
 * ตัวหนังสือกับช่องติ๊กซ้อนกัน อ่านไม่ออก
 * สาเหตุ: flex + whiteSpace: nowrap → ข้อความล้นทับกัน
 */
console.log('\n⑨ MemoDecide: แถวตัวเลือกไม่ซ้อนกัน (เดสก์ท็อป + แท็บเล็ต)');

const memoDecide = readFileSync(join(ROOT, 'src', 'components', 'ui', 'MemoDecide.vue'), 'utf8');
const memoDecideCode = memoDecide
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '');
check(!/whiteSpace: 'nowrap'/.test(memoDecideCode),
  'MemoDecide: ไม่มี whiteSpace nowrap ในแถวตัวเลือกแล้ว',
  'nowrap ทำให้ข้อความล้นออกมาทับช่องติ๊ก/ตัวเลือกถัดไปบนจอแคบ');
check(!/:style="radioStyle"/.test(memoDecideCode), 'MemoDecide: เลิกใช้ inline radioStyle แล้ว');
check(/\.choice-row \{[\s\S]{0,200}?display: grid;[\s\S]{0,120}?repeat\(auto-fit, minmax\(190px, 1fr\)\)/.test(memoDecideCode),
  'MemoDecide: แถวตัวเลือกใช้ grid ตัดบรรทัดอัตโนมัติ');
check(/\.choice-label \{[\s\S]{0,220}?white-space: normal;/.test(memoDecideCode),
  'MemoDecide: ข้อความตัวเลือกตัดขึ้นบรรทัดใหม่ได้');
check(/\.choice-label input\[type='checkbox'\][\s\S]{0,160}?flex: 0 0 auto/.test(memoDecideCode),
  'MemoDecide: ช่องติ๊กไม่ถูกบีบ (flex: 0 0 auto)');
check(/@media \(max-width: 700px\)[\s\S]{0,80}?\.choice-row[\s\S]{0,60}?grid-template-columns: 1fr/.test(memoDecideCode),
  'MemoDecide: จอแคบ (< 700px) แสดงตัวเลือกเป็นคอลัมน์เดียว');
{
  const rows = (memoDecideCode.match(/class="choice-row"/g) || []).length;
  check(rows >= 4, `MemoDecide: ใช้ .choice-row ครบทุกส่วน (พบ ${rows} จุด)`,
    'อนุมัติขั้นต้น · ขั้นตอนการพิจารณา · ผ่านเรื่อง/เสนอต่อ · ปฏิบัติราชการฯ · บันทึกสั่งการ');
}

/* ── ⑩ ใบลา: วันลาพักผ่อนสะสมต้องเป็นยอดของผู้ขอลา + ปีของใบลา ────────────
 *
 * ผู้ใช้แจ้ง 16 พ.ย. 2569: ใบลา 76/2570 แสดงสะสม 5 วัน แต่ยอดจริง 20 วัน
 * สาเหตุ: LeaveDoc เรียก /my-leave-balance โดยไม่ส่ง userId/year → ได้ยอดของผู้เปิดดู
 */
console.log('\n⑩ ใบลา: วันลาพักผ่อนสะสมของผู้ขอลา');

const leaveDoc = readFileSync(join(ROOT, 'src', 'components', 'ui', 'LeaveDoc.vue'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
check(/api\.get\('\/my-leave-balance' \+ qs\)/.test(leaveDoc), 'LeaveDoc: เรียก /my-leave-balance พร้อม query');
check(/userId=' \+ encodeURIComponent\(r\.value\.user_id/.test(leaveDoc),
  'LeaveDoc: ส่ง userId ของ "ผู้ขอลา" (ไม่ใช่ของผู้เปิดดู)');
check(/&year=' \+ fy/.test(leaveDoc), 'LeaveDoc: ส่งปีงบประมาณของใบลาไปด้วย');
check(/function fiscalYearBE\(iso\)/.test(leaveDoc), 'LeaveDoc: มีฟังก์ชันคำนวณปีงบประมาณจากวันที่ลา');
check(/m >= 10 \? be \+ 1 : be/.test(leaveDoc), 'LeaveDoc: ต.ค. นับเป็นปีงบประมาณถัดไป');

const reqSrc = readFileSync(join(ROOT, '..', 'backend', 'routes', 'requests.js'), 'utf8');
check(/const targetId = Number\(req\.query\.userId\) \|\| req\.user\.id/.test(reqSrc),
  'backend: /my-leave-balance รับ userId ได้');
check(/canViewLeaveBalanceOfUser\(req\.user, targetId\)/.test(reqSrc),
  'backend: ตรวจสิทธิ์ก่อนดูยอดของคนอื่น');

/* ── ⑪ เขียนบันทึกข้อความ: ช่อง "เรียน" ต้องพิมพ์แก้ได้ (ค่าเริ่มต้นคงเดิม) ──
 *
 * ผู้ใช้สั่ง 17 พ.ย. 2569
 */
console.log('\n⑪ เขียนบันทึกข้อความ: ช่อง "เรียน" พิมพ์ได้');

const memoForm = readFileSync(join(ROOT, 'src', 'components', 'ui', 'MemoForm.vue'), 'utf8');
const memoFormCode = memoForm
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '');
check(/const toText = ref\(m\.value\.to_text \|\| 'ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2'\)/.test(memoFormCode),
  'MemoForm: ค่าเริ่มต้นของ "เรียน" = ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2');
check(/<input v-model="toText"[^>]*\/>/.test(memoFormCode) && !/<input v-model="toText"[^>]*readonly/.test(memoFormCode),
  'MemoForm: ช่อง "เรียน" ไม่ readonly แล้ว (พิมพ์แก้ได้)',
  'ผู้ใช้สั่ง 17 พ.ย. 2569 — ยังคงค่าเริ่มต้นเดิมไว้');

/* ── ⑫ หน้าเจ้าหน้าที่: แท็บ "ผู้อำนวยการสถานศึกษา" ────────────────────────
 *
 * ผู้ใช้สั่ง 18 พ.ย. 2569: แยกผู้ที่กำหนดสิทธิ์เป็น ผอ.สถานศึกษา มาอยู่แท็บนี้
 */
console.log('\n⑫ หน้าเจ้าหน้าที่: แท็บผู้อำนวยการสถานศึกษา');

const staffSrc = readFileSync(join(ROOT, 'src', 'pages', 'StaffPage.vue'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '');
check(/\{ key: 'director', label: '[^']*ผู้อำนวยการสถานศึกษา' \}/.test(staffSrc),
  'StaffPage: มีแท็บ "ผู้อำนวยการสถานศึกษา"');
check(/staffGroup = computed\([\s\S]{0,120}?tab\.value === 'director' \? 'school' : 'office'/.test(staffSrc),
  'StaffPage: แท็บนี้ดึงรายชื่อฝั่งสถานศึกษา (user_group=school)');
check(/function isSchoolDirector\(u\)[\s\S]{0,260}?role === 'school_director'/.test(staffSrc),
  'StaffPage: นับผู้ที่ role = school_director เป็น ผอ.สถานศึกษา');
check(/function isSchoolDirector\(u\)[\s\S]{0,420}?pos\.includes\('ผู้อำนวยการสถานศึกษา'\)[\s\S]{0,120}?!pos\.startsWith\('รอง'\)/.test(staffSrc),
  'StaffPage: ตำแหน่ง "ผู้อำนวยการสถานศึกษา" ก็นับ (ยกเว้น "รอง…")');
check(/tab\.value === 'director' \? list\.filter\(isSchoolDirector\) : list/.test(staffSrc) ||
  /if \(tab\.value === 'director'\) staff\.value = list\.filter\(isSchoolDirector\)/.test(staffSrc),
  'StaffPage: กรองเฉพาะ ผอ.สถานศึกษา ในแท็บผู้อำนวยการสถานศึกษา');
check(/tab\.value === 'school'\) staff\.value = list\.filter\(\(u\) => !isSchoolDirector\(u\)\)/.test(staffSrc),
  'StaffPage: แท็บเจ้าหน้าที่สถานศึกษาไม่แสดง ผอ.สถานศึกษา (มีแท็บแยกแล้ว)',
  'ผู้ใช้สั่ง 19 พ.ย. 2569');

/* ── ⑬ เจ้าหน้าที่การลาของสถานศึกษา: แสดงเฉพาะ ผอ.สถานศึกษา ───────────────
 *
 * ผู้ใช้สั่ง 19 พ.ย. 2569
 */
console.log('\n⑬ เจ้าหน้าที่การลาของสถานศึกษา: เฉพาะ ผอ.สถานศึกษา');

const leaveApproversSrc = readFileSync(join(ROOT, 'src', 'components', 'ui', 'LeaveApprovers.vue'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '');
check(/function isSchoolDirector\(u\)[\s\S]{0,260}?role === 'school_director'/.test(leaveApproversSrc),
  'LeaveApprovers: นับ role = school_director เป็น ผอ.สถานศึกษา');
check(/pos\.includes\('ผู้อำนวยการสถานศึกษา'\)[\s\S]{0,120}?!pos\.startsWith\('รอง'\)/.test(leaveApproversSrc),
  'LeaveApprovers: ตำแหน่ง "ผู้อำนวยการสถานศึกษา" นับด้วย (ยกเว้น "รอง…")');
check(/return isSchoolScope\.value \? isSchoolDirector\(u\) : true/.test(leaveApproversSrc),
  'LeaveApprovers: ฝั่งสถานศึกษากรองเฉพาะ ผอ.สถานศึกษา');

/* ── ⑭ กำหนดผู้อนุมัติไปราชการ: แท็บสถานศึกษาแสดงเฉพาะ ผอ.สถานศึกษา ─────────
 *
 * ผู้ใช้สั่ง 19 พ.ย. 2569
 */
console.log('\n⑭ กำหนดผู้อนุมัติไปราชการ: แท็บสถานศึกษาเฉพาะ ผอ.สถานศึกษา');

const travelApproversSrc = readFileSync(join(ROOT, 'src', 'components', 'ui', 'TravelApprovers.vue'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '');
check(/function isSchoolDirector\(u\)[\s\S]{0,260}?role === 'school_director'/.test(travelApproversSrc),
  'TravelApprovers: นับ role = school_director เป็น ผอ.สถานศึกษา');
check(/const schoolDirectors = computed\(\(\) => schoolStaff\.value\.filter\(isSchoolDirector\)\)/.test(travelApproversSrc),
  'TravelApprovers: มีรายชื่อเฉพาะ ผอ.สถานศึกษา');
check(/tab\.value === 'office' \? officeStaff\.value : schoolDirectors\.value/.test(travelApproversSrc),
  'TravelApprovers: แท็บสถานศึกษาแสดงเฉพาะ ผอ.สถานศึกษา');
check(/🎓 ผู้อำนวยการสถานศึกษา \(\{\{ schoolDirectors\.length \}\}\)/.test(travelApproversSrc),
  'TravelApprovers: ชื่อแท็บเป็น "ผู้อำนวยการสถานศึกษา"',
  'ผู้ใช้สั่ง 19 พ.ย. 2569 — เปลี่ยนจาก "เจ้าหน้าที่สถานศึกษา"');
check(/for \(const u of schoolStaff\.value\)[\s\S]{0,200}?schoolMap\.value\[String\(u\.id\)\]/.test(travelApproversSrc),
  'TravelApprovers: ตอนบันทึกยังวนทุกคน (ค่าเดิมของคนที่ไม่แสดงไม่หาย)');

/* ── ⑮ รายงานการลงเวลาทำงาน: ตัวกรอง "ชื่อบุคลากร" เป็นตัวกรองแรก ─────────
 *
 * ผู้ใช้สั่ง 20 พ.ย. 2569 (เฉพาะเจ้าหน้าที่ สพป. · พิมพ์ค้นหาได้)
 */
console.log('\n⑮ รายงานการลงเวลาทำงาน: ตัวกรองชื่อบุคลากร');

const clockSrc = readFileSync(join(ROOT, 'src', 'pages', 'ClockPage.vue'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '');
check(/id="rp-person"/.test(clockSrc), 'ClockPage: มีช่อง "ชื่อบุคลากร" (rp-person)');
{
  const modalAt = clockSrc.indexOf('รายงานการลงเวลาทำงาน');
  const personAt = clockSrc.indexOf('id="rp-person"');
  const yearAt = clockSrc.indexOf('id="rp-year"');
  check(modalAt > -1 && personAt > modalAt && yearAt > personAt,
    'ช่อง "ชื่อบุคลากร" อยู่ก่อนตัวกรองปี พ.ศ. (เป็นตัวกรองแรก)',
    `ตำแหน่ง: modal=${modalAt} person=${personAt} year=${yearAt}`);
}
check(/<datalist id="rp-person-list">/.test(clockSrc), 'มี datalist ให้เลือก/พิมพ์ค้นหาชื่อ');
check(/personPool\.value = list\.filter\(\(u\) => \(u\.user_group \|\| 'office'\) !== 'school'\)/.test(clockSrc),
  'รายชื่อตัวเลือกเอาเฉพาะเจ้าหน้าที่ สพป. (ไม่รวมสถานศึกษา)');
check(/user_ids=' \+ encodeURIComponent\(ids\.join\(','\)\)/.test(clockSrc),
  'ส่ง user_ids ไปกรองที่เซิร์ฟเวอร์ (สร้าง query จาก id ที่ตรงกับชื่อ)');
check(/api\.get\('\/time\/report\?period='[\s\S]{0,220}?\+ qs\)/.test(clockSrc) &&
      /report\.xlsx\?period='[\s\S]{0,220}?\+ qs/.test(clockSrc),
  'ทั้งรายงานบนจอและไฟล์ Excel ใช้ตัวกรองเดียวกัน');

/* ── ⑯ ลงเวลาทำงานล่วงเวลา (OT) ─────────────────────────────────────────
 *
 * ผู้ใช้สั่ง 24 พ.ย. 2569 — ปุ่มสีฟ้าต่อจากปุ่มออกงาน + หน้าต่างลงเวลา OT
 */
console.log('\n⑯ ลงเวลาทำงานล่วงเวลา (OT)');

const clockOtSrc = readFileSync(join(ROOT, 'src', 'pages', 'ClockPage.vue'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '');
check(/id="clock-ot-btn"[\s\S]{0,80}?ทำงานล่วงเวลา/.test(clockOtSrc),
  'ClockPage: มีปุ่ม "ทำงานล่วงเวลา"');
{
  const outBtn = clockOtSrc.indexOf('clock-btn-out');
  const otBtn = clockOtSrc.indexOf('id="clock-ot-btn"');
  check(outBtn > -1 && otBtn > outBtn, 'ปุ่มทำงานล่วงเวลาอยู่ต่อจากปุ่มออกงาน',
    `ตำแหน่ง: out=${outBtn} ot=${otBtn}`);
}
check(/\.clock-ot-btn \{[\s\S]{0,120}?background: #2563eb/.test(clockOtSrc), 'ปุ่มเป็นสีฟ้า');
check(/v-if="otOpen" title="⏱ ลงเวลาทำงานล่วงเวลา"/.test(clockOtSrc), 'มีหน้าต่าง "ลงเวลาทำงานล่วงเวลา"');
check(/id="ot-in-btn"/.test(clockOtSrc) && /id="ot-out-btn"/.test(clockOtSrc),
  'มีปุ่ม "ลงเวลาทำงานล่วงเวลา" และ "ลงเวลาออกงานล่วงเวลา"');
check(/api\.post\('\/time\/overtime', payload\)/.test(clockOtSrc), 'เรียก POST /time/overtime');
check(/const isWeekend = computed/.test(clockOtSrc) && /dow === 0 \|\| dow === 6/.test(clockOtSrc),
  'ตรวจวันหยุดเสาร์–อาทิตย์ในหน้าเว็บด้วย');
check(/v-if="canViewAll && stats" class="card" id="clock-ot-card"/.test(clockOtSrc),
  'มีการ์ด "ทำงานล่วงเวลา" แสดงรายชื่อ');
check(/stats\.overtime/.test(clockOtSrc), 'การ์ดอ่านรายชื่อจาก stats.overtime');
check(/r\.ot_in \? UI\.time\(r\.ot_in\)/.test(clockOtSrc), 'ตารางบันทึกเวลาแสดงช่วง OT');

/* หน้าแรก (ยินดีต้อนรับ + กล่องลงเวลา) ต้องมีปุ่ม/หน้าต่าง/การ์ดเช่นกัน */
const homeSrc = readFileSync(join(ROOT, 'src', 'pages', 'HomePage.vue'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '');
check(/id="home-clock-ot"[\s\S]{0,80}?ทำงานล่วงเวลา/.test(homeSrc),
  'HomePage: ปุ่ม "ทำงานล่วงเวลา" ต่อจากปุ่มออกงาน');
check(/id="home-ot-in-btn"/.test(homeSrc) && /id="home-ot-out-btn"/.test(homeSrc),
  'HomePage: หน้าต่าง OT มีปุ่มเข้า/ออกล่วงเวลา');
check(/key: 'overtime'/.test(homeSrc) && /⏱ ทำงานล่วงเวลาวันนี้/.test(homeSrc),
  'HomePage: มีการ์ด "ทำงานล่วงเวลา"');
check(/s\.overtime/.test(homeSrc), 'HomePage: การ์ดอ่านจาก /today-summary → overtime');

/* OT: ใช้พิกัด GPS เหมือนลงเวลาเข้างาน + ปุ่ม OT/ประวัติอยู่บรรทัดเดียวกัน (ผู้ใช้สั่ง 24 พ.ย. 2569) */
check(/const payload = \{ type \};[\s\S]{0,400}?payload\.lat = pos\.coords\.latitude/.test(clockOtSrc),
  'ClockPage: ลงเวลาเข้าล่วงเวลาขอพิกัด GPS');
check(/const payload = \{ type \};[\s\S]{0,400}?payload\.lat = pos\.coords\.latitude/.test(homeSrc),
  'HomePage: ลงเวลาเข้าล่วงเวลาขอพิกัด GPS');
check(/api\.post\('\/time\/overtime', payload\)/.test(clockOtSrc) && /api\.post\('\/time\/overtime', payload\)/.test(homeSrc),
  'ส่ง lat/lng ไปกับ POST /time/overtime (ทั้งสองหน้า)');
check(/<span class="home-clock-extra">[\s\S]{0,400}?id="home-clock-ot"[\s\S]{0,400}?home-clock-history/.test(homeSrc),
  'ปุ่มทำงานล่วงเวลา + ดูประวัติ อยู่ในบล็อกเดียวกัน (บรรทัดเดียวกัน)');
check(/\.home-clock-extra \{[\s\S]{0,140}?flex-wrap: nowrap/.test(homeSrc),
  'บล็อกนั้นไม่ตัดบรรทัด (nowrap)');
check(/\.home-clock \{[\s\S]{0,80}?max-width: 430px/.test(homeSrc),
  'ขยายกล่องลงเวลาให้ปุ่ม 4 ตัวอยู่บรรทัดเดียวกัน (max-width 430px)');
check(/\.home-clock-btns \{[\s\S]{0,80}?flex-wrap: nowrap/.test(homeSrc),
  'แถวปุ่มลงเวลาไม่ตัดบรรทัด (nowrap)');

/* ลงเวลาเข้างานแล้วยังไม่ออกงาน → กด OT ไม่ได้ (ผู้ใช้สั่ง 24 พ.ย. 2569) */
const opsSrc = readFileSync(join(ROOT, '..', 'backend', 'routes', 'ops.js'), 'utf8');
check(/rec\.clock_in && !rec\.clock_out[\s\S]{0,160}?กรุณาลงเวลาออกงานก่อน/.test(opsSrc),
  'เซิร์ฟเวอร์: ยังไม่ออกงาน → ปฏิเสธการลงเวลาล่วงเวลา (403)');
check(/const otInBlocked = computed/.test(clockOtSrc) &&
      /:disabled="isWeekend \|\| otInBlocked \|\| !!otIn/.test(clockOtSrc),
  'ClockPage: ปุ่มลงเวลาเข้าล่วงเวลาถูกปิดเมื่อยังไม่ออกงาน');
check(/const otInBlocked = computed/.test(homeSrc) &&
      /:disabled="otWeekend \|\| otInBlocked \|\| !!otIn/.test(homeSrc),
  'HomePage: ปุ่มลงเวลาเข้าล่วงเวลาถูกปิดเมื่อยังไม่ออกงาน');
check(/กรุณาลงเวลาออกงานก่อน จึงจะลงเวลาทำงานล่วงเวลาได้/.test(clockOtSrc) &&
      /กรุณาลงเวลาออกงานก่อน จึงจะลงเวลาทำงานล่วงเวลาได้/.test(homeSrc),
  'ทั้งสองหน้าแจ้งเหตุผลให้ลงเวลาออกงานก่อน');

/* ── ⑰ หัวเว็บ: โลโก้ สพป.แพร่ เขต 2 + ลิงก์เว็บไซต์หลัก ───────────────────
 *
 * ผู้ใช้สั่ง 24 พ.ย. 2569 — อยู่ในกลุ่มเดียวกับโลโก้ P2-SMART กดแล้วเปิดแท็บใหม่
 */
console.log('\n⑰ หัวเว็บ: โลโก้และลิงก์เว็บไซต์หลัก สพป.แพร่ เขต 2');

const appSrc = readFileSync(join(ROOT, 'src', 'App.vue'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '');
check(/id="brand-main-site"/.test(appSrc), 'App.vue: มีบล็อกโลโก้/ลิงก์เว็บไซต์หลัก');
check(/href="https:\/\/www\.phrae2\.go\.th\/"/.test(appSrc), 'ลิงก์ไปที่ https://www.phrae2.go.th/');
check(/target="_blank"/.test(appSrc) && /rel="noopener noreferrer"/.test(appSrc),
  'เปิดแท็บใหม่ (target=_blank + rel noopener)');
check(/src="\/phrae2-logo\.png"/.test(appSrc), 'ใช้รูป /phrae2-logo.png (runtime URL จาก public/)');
check(/phrae2\.go\.th<\/span>/.test(appSrc) && /เว็บไซต์หลัก สพป\.แพร่ เขต 2/.test(appSrc),
  'มีข้อความ "phrae2.go.th เว็บไซต์หลัก สพป.แพร่ เขต 2"');
{
  const after = appSrc.indexOf('brand-sub');
  const ext = appSrc.indexOf('id="brand-main-site"');
  check(after > -1 && ext > after, 'วางต่อจากโลโก้ P2-SMART (ในกลุ่ม .brand เดียวกัน)',
    `ตำแหน่ง: brand-sub=${after} ext=${ext}`);
}
check(existsSync(join(ROOT, 'public', 'phrae2-logo.png')), 'มีไฟล์ public/phrae2-logo.png');
check(/\.brand-ext-logo \{[\s\S]{0,160}?object-fit: contain/.test(appSrc), 'โลโก้ถูกจัดขนาดพอดี (object-fit: contain)');
check(!/brand-ext:hover \.brand-ext-domain \{ text-decoration: underline/.test(appSrc),
  'ไม่ขีดเส้นใต้เมื่อเอาเมาส์วาง (ผู้ใช้สั่ง 24 พ.ย. 2569)');
check(/\.brand-ext-text \{[\s\S]{0,120}?gap: 4px/.test(appSrc),
  'มีช่องว่างระหว่างบรรทัด "phrae2.go.th" กับ "เว็บไซต์หลัก…"');

/* ── ⑱ ประเภทการลา "ลาบวช" (ผู้ใช้สั่ง 25 พ.ย. 2569) ─────────────────────
 *
 * เพิ่มตัวเลือกในช่อง "เรื่อง" ของฟอร์มยื่นคำลา (ทั้ง 2 ฟอร์ม) แล้วต้องไปครบทุกที่
 * ที่แยกประเภทการลา — ไม่งั้นวันลาบวชจะหายจากสถิติ/ใบลา
 */
console.log('\n⑱ ประเภทการลา "ลาบวช"');

const leaveFormSrc = readFileSync(join(ROOT, 'src', 'components', 'ui', 'LeaveForm.vue'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '');
const leaveDocSrc = readFileSync(join(ROOT, 'src', 'components', 'ui', 'LeaveDoc.vue'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '');
const leaveReviewSrc = readFileSync(join(ROOT, 'src', 'components', 'ui', 'LeaveReview.vue'), 'utf8');
const leaveStatsSrc = readFileSync(join(ROOT, 'src', 'components', 'ui', 'LeaveStats.vue'), 'utf8');
const leaveExportSrc = readFileSync(join(ROOT, 'src', 'components', 'ui', 'LeaveStatsExport.vue'), 'utf8');
const opsLeaveSrc = readFileSync(join(ROOT, '..', 'backend', 'routes', 'requests.js'), 'utf8');

check(/const TYPES = \['ลาป่วย', 'ลากิจ', 'ลาคลอดบุตร', 'ลาบวช'\]/.test(leaveFormSrc),
  'LeaveForm: ช่อง "เรื่อง" มีตัวเลือก "ลาบวช"');
check(/f\.value\.leave_type === 'ลาบวช'/.test(leaveFormSrc),
  'LeaveForm: เลือกลาบวชแล้วมีช่อง "เนื่องจาก"');
check(/\{ label: 'บวช'[\s\S]{0,120}?usedOf\('ลาบวช'\)/.test(leaveFormSrc),
  'LeaveForm: ตารางสถิติในฟอร์มมีแถว "บวช"');
check(/\['ลาป่วย', 'ลากิจ', 'ลาคลอดบุตร', 'ลาบวช'\]/.test(opsLeaveSrc),
  'เซิร์ฟเวอร์: /leave-stats นับ "ลาบวช" ด้วย');
check(/\['ลาป่วย', 'ลากิจ', 'ลาคลอดบุตร', 'ลาบวช'\]/.test(leaveReviewSrc),
  'หน้าตรวจสอบคำขอลา: ตารางสถิติมีคอลัมน์ "บวช"');
check(/t === 'ลาบวช'\) return HEAD\.monk/.test(leaveReviewSrc),
  'หน้าตรวจสอบคำขอลา: หัวคอลัมน์ของลาบวช = "บวช"');
check(/r\.value\.leave_type === 'ลาบวช'/.test(leaveDocSrc),
  'ใบลา: แสดง "เนื่องจาก" ของลาบวชด้วย');
check(/<td style="text-align: left">บวช<\/td>/.test(leaveDocSrc),
  'ใบลา: ตารางสถิติมีแถว "บวช"');
check(/u\.monk \+= d/.test(leaveStatsSrc) && /ลาบวช \(วัน\)/.test(leaveStatsSrc),
  'หน้าสถิติการลา: นับและแสดงคอลัมน์ "ลาบวช (วัน)"');
check(/u\.monk \+= d/.test(leaveExportSrc) && /'ลาบวช \(วัน\)'/.test(leaveExportSrc),
  'ไฟล์ Excel สถิติการลา: มีคอลัมน์ "ลาบวช (วัน)"');

/* ── ⑲ ฟอร์มไปราชการของสถานศึกษา: เรื่อง = "ขออนุญาตเดินทางไปราชการในราชอาณาจักร" ──
 *
 * ผู้ใช้สั่ง 25 พ.ย. 2569 — ต้องตรงกับหัวแบบฟอร์มและใบลา (TravelDoc)
 */
console.log('\n⑲ ฟอร์มไปราชการ (สถานศึกษา): ชื่อเรื่อง');

const travelFormSrc = readFileSync(join(ROOT, 'src', 'components', 'ui', 'TravelForm.vue'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '');
check(/isSchoolScope \? 'ขออนุญาตเดินทางไปราชการในราชอาณาจักร' : 'ขออนุมัติ\/อนุญาตเดินทางไปราชการ'/
  .test(travelFormSrc), 'ช่อง "เรื่อง" ของสถานศึกษาใช้ชื่อใหม่ (สพป. คงเดิม)');
check(/title:[\s\S]{0,200}?isSchoolScope\.value \? 'ขออนุญาตเดินทางไปราชการในราชอาณาจักร'/
  .test(travelFormSrc), 'ชื่อเรื่องที่บันทึกของสถานศึกษาใช้ชื่อใหม่ด้วย');
{
  const docSrc = readFileSync(join(ROOT, 'src', 'components', 'ui', 'TravelDoc.vue'), 'utf8');
  check(/reqIsSchool \? 'ขออนุญาตเดินทางไปราชการในราชอาณาจักร'/.test(docSrc),
    'ใบลา (TravelDoc) ใช้ชื่อเรื่องเดียวกัน → ฟอร์มกับใบลาตรงกัน');
}

/* ── ⑳ ผู้บังคับบัญชาขั้นต้นเลือกผู้อนุมัติ (ผู้ใช้สั่ง 26 พ.ย. 2569) ──────────
 *
 * ในหน้าต่างพิจารณาคำขอไปราชการ (ขั้นควรอนุญาต) ต้องเลือกผู้อนุมัติได้
 * รายชื่อมาจากหน้า ⊛ กำหนดผู้อนุมัติไปราชการ (คอลัมน์ผู้อนุมัติ)
 * และคนที่เลือกเป็นผู้อนุมัติขั้นสุดท้ายของคำขอใบนั้น
 */
console.log('\n⑳ ผู้บังคับบัญชาขั้นต้นเลือกผู้อนุมัติ');

const decideSrc = readFileSync(join(ROOT, 'src', 'components', 'ui', 'TravelDecide.vue'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '');
const travelPageSrc = readFileSync(join(ROOT, 'src', 'pages', 'TravelPage.vue'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '');
const tripsBackend = readFileSync(join(ROOT, '..', 'backend', 'routes', 'requests.js'), 'utf8');
const approvalsSrc = readFileSync(join(ROOT, '..', 'backend', 'lib', 'approvals.js'), 'utf8');
const dbSrc = readFileSync(join(ROOT, '..', 'backend', 'db.js'), 'utf8');

check(/showFinalApprover = computed\(\(\) => props\.mode === 'level1'\)/.test(decideSrc),
  'หน้าต่างพิจารณา: แสดงตัวเลือกผู้อนุมัติเฉพาะขั้นก่อนผู้อนุมัติ (สาย สพป. ขั้น 1 · สายสถานศึกษา ขั้น 2)');
check(/id="travel-final-approver"/.test(decideSrc), 'มี dropdown เลือกผู้อนุมัติ (#travel-final-approver)');
check(/api\.get\('\/travel\/final-approvers'\)/.test(decideSrc), 'ดึงรายชื่อจาก GET /travel/final-approvers');
check(/final_approver_id: showFinalApprover\.value \? Number\(finalApproverId\.value\) \|\| 0 : 0/.test(decideSrc),
  'ส่ง final_approver_id กลับไปกับผลการพิจารณา');
check(/finalApprovers\.value\.length && !finalApproverId\.value/.test(decideSrc),
  'ต้องเลือกผู้อนุมัติก่อนยืนยัน (เมื่อมีรายชื่อให้เลือก)');
check(/body\.final_approver_id = Number\(out\.final_approver_id\)/.test(travelPageSrc),
  'TravelPage: ส่ง final_approver_id ไปกับ PUT /travel/:id/approve');
check(/Number\(r\.final_approver_id\) && next === finalLv/.test(travelPageSrc),
  'TravelPage: ปุ่มอนุมัติขั้นสุดท้ายเป็นของคนที่ถูกเลือกเท่านั้น');
check(/router\.get\('\/travel\/final-approvers'/.test(tripsBackend),
  'เซิร์ฟเวอร์: มี endpoint รายชื่อผู้อนุมัติให้เลือก');
check(/final_approver_id/.test(tripsBackend) && /UPDATE travel_requests SET final_approver_id = \?/.test(tripsBackend),
  'เซิร์ฟเวอร์: บันทึก final_approver_id ตอนผู้บังคับบัญชาขั้นต้นเลือก');
check(/final_approver_id/.test(approvalsSrc) && /travelFinalApproverCandidates/.test(approvalsSrc),
  'approvals: สายของคำขอใช้คนที่เลือก + มีรายชื่อตัวเลือก');
check(/final_approver_id/.test(dbSrc), 'ฐานข้อมูล: มีคอลัมน์ travel_requests.final_approver_id');

/* ── ㉑ ผู้ตรวจสอบเลือกผู้บังคับบัญชาขั้นต้น (ผู้ใช้สั่ง 26 พ.ย. 2569) ──────────
 *
 * สายสถานศึกษา ขั้นที่ 1 (ผู้ตรวจสอบ) → หน้าต่าง "⊙ เสนอเรื่อง…" ต้องมี "เสนอเรื่องถึง"
 * รายชื่อมาจากคอลัมน์ "ผู้บังคับบัญชาขั้นต้น" ของหน้า ⊛ กำหนดผู้อนุมัติไปราชการ
 * คนที่เลือกเป็นผู้บังคับบัญชาขั้นต้น (ขั้นที่ 2) ของคำขอใบนั้น
 */
console.log('\n㉑ ผู้ตรวจสอบเลือกผู้บังคับบัญชาขั้นต้น');

check(/showSupervisorPicker = computed\(\(\) => props\.mode === 'forward' && isSchool\.value\)/.test(decideSrc),
  'หน้าต่างเสนอเรื่อง: แสดงตัวเลือกเฉพาะขั้นผู้ตรวจสอบ (สายสถานศึกษา)');
check(/id="travel-supervisor"/.test(decideSrc), 'มี dropdown "เสนอเรื่องถึง" (#travel-supervisor)');
check(/api\.get\('\/travel\/supervisor-candidates'\)/.test(decideSrc), 'ดึงรายชื่อจาก GET /travel/supervisor-candidates');
check(/chosen_supervisor_id: showSupervisorPicker\.value \? Number\(supervisorId\.value\) \|\| 0 : 0/.test(decideSrc),
  'ส่ง chosen_supervisor_id กลับไปกับผลการพิจารณา');
check(/supervisors\.value\.length && !supervisorId\.value/.test(decideSrc),
  'ต้องเลือกผู้บังคับบัญชาขั้นต้นก่อนยืนยัน (เมื่อมีรายชื่อให้เลือก)');
check(/body\.chosen_supervisor_id = Number\(out\.chosen_supervisor_id\)/.test(travelPageSrc),
  'TravelPage: ส่ง chosen_supervisor_id ไปกับ PUT /travel/:id/approve');
check(/Number\(r\.chosen_supervisor_id\) && next === 2/.test(travelPageSrc),
  'TravelPage: ปุ่มอนุมัติขั้นที่ 2 เป็นของคนที่ผู้ตรวจสอบเลือก');
check(/router\.get\('\/travel\/supervisor-candidates'/.test(tripsBackend),
  'เซิร์ฟเวอร์: มี endpoint รายชื่อผู้บังคับบัญชาขั้นต้น');
check(/UPDATE travel_requests SET chosen_supervisor_id = \?/.test(tripsBackend),
  'เซิร์ฟเวอร์: บันทึก chosen_supervisor_id ตอนผู้ตรวจสอบเลือก');
check(/travelSupervisorCandidates/.test(approvalsSrc) && /chosen_supervisor_id/.test(approvalsSrc),
  'approvals: สายของคำขอใช้ผู้บังคับบัญชาที่เลือก');
check(/chosen_supervisor_id/.test(dbSrc), 'ฐานข้อมูล: มีคอลัมน์ travel_requests.chosen_supervisor_id');

/* ── ㉓ เลขหนังสือสถานศึกษา = ค่าเดียวกันทั้งโรงเรียน (ผู้ใช้สั่ง 26 พ.ย. 2569) ──
 *
 * เดิม GET /document-staff/school-prefix ตอบค่าว่างให้คนที่ไม่ใช่เจ้าหน้าที่สารบัญ
 * → ผู้ใช้คนอื่นในโรงเรียนเดียวกันลงทะเบียนหนังสือส่งแล้วได้เลขคนละชุด
 */
console.log('\n㉓ เลขหนังสือสถานศึกษาใช้ร่วมกันทั้งโรงเรียน');

const adminRouteSrc = readFileSync(join(ROOT, '..', 'backend', 'routes', 'admin.js'), 'utf8');
const prefixGet = adminRouteSrc.slice(
  adminRouteSrc.indexOf("router.get('/document-staff/school-prefix'"),
  adminRouteSrc.indexOf("router.put('/document-staff/school-prefix'"),
);
check(prefixGet.length > 0, 'เซิร์ฟเวอร์: มี GET /document-staff/school-prefix');
check(!/isClerk/.test(prefixGet), 'GET เลขหนังสือไม่เช็ค isClerk แล้ว (ทุกคนในโรงเรียนอ่านได้)');
check(/school_doc_prefix WHERE school_code = \?/.test(prefixGet), 'อ่านค่าจากตาราง school_doc_prefix ตามรหัสโรงเรียน');
{
  const putSrc = adminRouteSrc.slice(adminRouteSrc.indexOf("router.put('/document-staff/school-prefix'"));
  check(/document_staff WHERE staff_type = \? AND user_id = \? AND school_code = \?/.test(putSrc),
    'PUT ยังจำกัดสิทธิ์เจ้าหน้าที่สารบัญเท่านั้น');
}

/* ── ㉒ ผู้อนุมัติขั้นต้น (สายสถานศึกษา) เลือกผู้อนุมัติ (ผู้ใช้สั่ง 26 พ.ย. 2569) ──
 *
 * ขั้นที่ 2 (อนุมัติขั้นต้น) → เลือกผู้อนุมัติ (ขั้นที่ 3) จากคอลัมน์ "ผู้อนุมัติ"
 * คนที่เลือกเป็นผู้อนุมัติขั้นสุดท้ายของคำขอใบนั้น
 */
console.log('\n㉒ ผู้อนุมัติขั้นต้น (สถานศึกษา) เลือกผู้อนุมัติ');

check(/showFinalApprover = computed\(\(\) => props\.mode === 'level1'\)/.test(decideSrc),
  'หน้าต่างอนุมัติขั้นต้น: มีตัวเลือกผู้อนุมัติทั้ง 2 สาย');
check(/travelFinalApproverCandidates/.test(approvalsSrc), 'approvals: มีรายชื่อผู้อนุมัติให้เลือก');
check(!/การเลือกผู้อนุมัติใช้กับสายเจ้าหน้าที่ สพป/.test(tripsBackend),
  'เซิร์ฟเวอร์: ไม่ปฏิเสธการเลือกผู้อนุมัติของสายสถานศึกษาแล้ว');
check(/const curLevel = Number\(currentLevels\[doneCount\]\) \|\| 0/.test(tripsBackend),
  'เซิร์ฟเวอร์: ตรวจว่าขั้นปัจจุบันไม่ใช่ขั้นผู้อนุมัติก่อนบันทึก');
check(/canTravelApprover\(user, curLevel, id\)/.test(tripsBackend),
  'เซิร์ฟเวอร์: คนที่ตั้งค่าต้องมีสิทธิ์ในขั้นนั้นจริง');
check(/if \(Number\(r\.final_approver_id\) && next === finalLv\)/.test(travelPageSrc),
  'TravelPage: ปุ่มอนุมัติขั้นสุดท้ายเป็นของคนที่ถูกเลือก (ทั้ง 2 สาย)');

/* ผู้ใช้สั่ง 26 พ.ย. 2569: ตำแหน่งมาก่อนผู้อนุมัติ + เปลี่ยนชื่อส่วนในขั้นอนุมัติขั้นต้น */
{
  const posIdx = decideSrc.indexOf('id="travel-position-label"');
  const apprIdx = decideSrc.indexOf('id="travel-final-approver"');
  check(posIdx > -1 && apprIdx > -1 && posIdx < apprIdx,
    'หน้าต่างอนุมัติขั้นต้น: "เลือกตำแหน่ง" อยู่ก่อน "เลือกผู้อนุมัติ"',
    `ตำแหน่ง: position=${posIdx} approver=${apprIdx}`);
}
check(/mode === 'level1' \? 'เลือกตำแหน่งของท่าน\/อนุมัติขั้นต้น' : 'กรุณาเลือกตำแหน่งที่จะอนุมัติ\/อนุญาต'/.test(decideSrc),
  'หัวข้อ "เลือกตำแหน่งของท่าน/อนุมัติขั้นต้น" ในขั้นอนุมัติขั้นต้น (ขั้นสุดท้ายยังใช้ข้อความเดิม)');

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