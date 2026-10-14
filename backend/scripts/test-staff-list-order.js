/**
 * ตรวจว่า endpoint ที่คืนรายชื่อเจ้าหน้าที่ เรียงตามกฎเดียวกับหน้าเจ้าหน้าที่ทุกจุด
 *
 * ทำไมต้องมี
 * ──────────
 * กฎเรียงรายชื่อถูกกำหนดไว้ที่ lib/staff-sort.js และใช้ในหน้าเจ้าหน้าที่ + ไฟล์ Excel
 * แต่เดิมมีแค่ 2 จุดเท่านั้นที่เรียงตามกฎ ที่เหลือเรียงคนละแบบ:
 *   · ORDER BY full_name          → A-Z ตามชื่อ ไม่ตรงกับกลุ่มงาน/ตำแหน่ง
 *   · ORDER BY staff_no อย่างเดียว → ไม่ได้จัดกลุ่มงานและอันดับตำแหน่ง
 *   · ไม่มี ORDER BY เลย          → ลำดับตาม id โดยไม่ตั้งใจ
 *   · แยก office/school ไม่ถูก  → คนสองฝั่งปนกันเรียงด้วยกฎเดียว
 *
 * ผลคือ dropdown ทุกจุด (ผู้อนุมัติการลา · ผู้อนุมัติห้องประชุม/ยานพาหนะ · สารบัญเขต
 * · ผู้ลงนามเกียรติบัตร · มอบหมายงานลา ฯลฯ) ไม่ตรงกับที่เห็นในหน้าเจ้าหน้าที่
 *
 * ใช้: node scripts/test-staff-list-order.js
 */
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
}

const ROOT = path.join(__dirname, '..');
const ROUTES = path.join(ROOT, 'routes');

/**
 * จุดที่ต้องเรียงตามกฎ — { route, group, note }
 * group: 'office' | 'school' | 'split' (คนละฝั่งคนละกฎ)
 */
const EXPECTED = [
  { file: 'admin.js', route: "'/staff'", group: 'split', note: 'หน้าเจ้าหน้าที่ + dialog ตั้งค่า 6 จุด' },
  { file: 'admin.js', route: "'/staff.xlsx'", group: 'split', note: 'ไฟล์ Excel' },
  { file: 'admin.js', route: "'/office-staff'", group: 'office', note: 'ผู้รับหนังสือ · ผู้ลงนามเกียรติบัตร · ผู้ลงทะเบียน · ผู้ปฏิบัติ' },
  { file: 'admin.js', route: "'/document-staff'", group: 'split', note: 'สารบัญเขต / สารบัญสถานศึกษา' },
  { file: 'admin.js', route: "'/cert-staff'", group: 'office', note: 'เจ้าหน้าที่หนังสือรับรอง' },
  { file: 'ops.js', route: "'/vehicle/approvers'", group: 'office', note: 'ผู้อนุมัติยานพาหนะ' },
  { file: 'ops.js', route: "'/room/approvers'", group: 'office', note: 'ผู้อนุมัติห้องประชุม' },
  { file: 'ops.js', route: "'/users/active'", group: 'split', note: 'พนักงานขับรถ ฯลฯ' },
  { file: 'requests.js', route: "'/memo/approvers'", group: 'office', note: 'ผู้อนุมัติบันทึกข้อความ' },
  { file: 'requests.js', route: "'/leave-users'", group: 'split', note: 'มอบหมายงานลา' },
  { file: 'requests.js', route: "'/leave-balances'", group: 'split', note: 'ตารางวันลาพักผ่อนรายคน' },
];

/** ดึง body ของ route handler ตั้งแต่ router.get(...) ไปจนกว่าจะเจอ '});' ระดับเดียวกัน */
function handlerBody(src, routeExpr) {
  const i = src.indexOf('router.get(' + routeExpr);
  if (i === -1) return '';
  // ไปหาประโยคปิดของ arrow function: หา '\n});' หรือ '\n  });' หลังจากนั้น
  const rest = src.slice(i);
  const m = rest.match(/\n\s*\}\);\r?\n/);
  return m ? rest.slice(0, m.index) : rest.slice(0, 4000);
}

const srcs = {};
for (const f of ['admin.js', 'ops.js', 'requests.js']) {
  // ตัดคอมเมนต์ออกก่อน
  // ไม่งั้นคำที่เราอธิบายไว้ในคอมเมนต์ (เช่น "เดิม ORDER BY full_name")
  // จะถูกนับว่ายังมีอยู่ แล้วเทสต์จะผิดเสมอ
  srcs[f] = fs.readFileSync(path.join(ROUTES, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
}

/* ── ① ทุก endpoint ต้องเรียงด้วย staffSort ──────────────────────────────── */
console.log('');
console.log('① endpoint รายชื่อเจ้าหน้าที่ ต้องเรียงด้วย staffSort.sortStaff()');

for (const e of EXPECTED) {
  const body = handlerBody(srcs[e.file], e.route);
  if (!body) {
    check(false, `พบ ${e.file} ${e.route}`, 'ไม่พบ route นี้ในไฟล์');
    continue;
  }
  check(/staffSort\.sortStaff\(/.test(body),
    `${e.file} ${e.route} เรียงด้วย staffSort`,
    `${e.note}\n        ถ้า endpoint นี้ไม่เรียง รายการใน dropdown จะไม่ตรงกับหน้าเจ้าหน้าที่`);

  // ห้ามมี ORDER BY full_name ทิ้งไว้ (จะทับลำดับที่ sortStaff เรียง)
  check(!/ORDER BY\s+(u\.)?full_name/i.test(body),
    `${e.file} ${e.route} ไม่มี ORDER BY full_name ทิ้งไว้`,
    'A-Z ตามชื่อจะทับลำดับของ sortStaff');

  // SELECT ต้องมีคอลัมน์ที่ sortStaff ใช้
  const need = ['position', 'workplace', 'staff_no'];
  const selMatch = body.match(/SELECT([\s\S]*?)\s*FROM/i);
  const sel = selMatch ? selMatch[1] : '';
  const missing = need.filter((c) => !new RegExp('\\b' + c + '\\b').test(sel));
  check(missing.length === 0,
    `${e.file} ${e.route} SELECT มีคอลัมน์ที่ sortStaff ต้องใช้ครบ`,
    missing.length ? 'ขาด: ' + missing.join(', ') + ' → เรียงผิดเงียบ ๆ' : '');
}

/* ── ② ฝั่งสถานศึกษาต้อง SELECT school_code ──────────────────────────── */
console.log('');
console.log('② endpoint ที่คืนรายชื่อฝั่งสถานศึกษา ต้อง SELECT school_code');

for (const e of EXPECTED.filter((x) => x.group === 'split' || x.group === 'school')) {
  const body = handlerBody(srcs[e.file], e.route);
  const selMatch = body.match(/SELECT([\s\S]*?)\s*FROM/i);
  const sel = selMatch ? selMatch[1] : '';
  const ok = /school_code/.test(sel) || /school_code/.test(body);
  check(ok, `${e.file} ${e.route} มี school_code`,
    'schoolCodeOf() อ่าน school_code ก่อน → ไม่มีคอลัมน์นี้คนสถานศึกษาจะไปกองท้ายสุด');
}

/* ── ③ ห้ามมีการเรียงซ้ำ/ทับฝั่งหน้าเว็บด้วยเกณฑ์ที่ไม่มีจริง ──────────── */
console.log('');
console.log('③ ห้ามเรียงซ้ำฝั่งหน้าเว็บด้วยคอลัมน์ที่ไม่มีอยู่จริง');

const usersCols = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
for (const [file, bad] of [['TravelApprovers.vue', 'sort_order']]) {
  const p = path.join(ROOT, '..', 'frontend', 'src', 'components', 'ui', file);
  const src = fs.readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
  check(!new RegExp('\\.' + bad + '\\b').test(src),
    `${file} ไม่เรียงด้วย "${bad}"`,
    `ตาราง users ไม่มีคอลัมน์ ${bad} → ทุกคนได้ค่าเดียวกัน → ตกไปเรียงตาม id ทับลำดับจริง`);
  void usersCols;
}

/* ── ④ กฎใน lib ต้องถูก require ในทุกไฟล์ route ที่ต้องใช้ ─────────────── */
console.log('');
console.log('④ ไฟล์ route ที่ใช้ staffSort ต้อง require ด้วย');

for (const f of ['admin.js', 'ops.js', 'requests.js']) {
  const usesIt = EXPECTED.some((e) => e.file === f);
  const hasRequire = /require\('\.\.\/lib\/staff-sort'\)/.test(srcs[f]);
  check(!usesIt || hasRequire,
    `${f} ${hasRequire ? 'require staff-sort แล้ว' : 'ยังไม่ได้ require staff-sort'}`);
}

/* ── ⑤ หน้าเจ้าหน้าที่ + Excel ต้องใช้กฎเดียวกัน ─────────────────────── */
console.log('');
console.log('⑤ ต้องไม่มี ORDER BY staff_no เปลี่ยวที่ใครเรียงเองแล้วไม่ตรงกฎ');

for (const f of ['admin.js', 'ops.js', 'requests.js']) {
  const body = srcs[f];
  // นับจุดที่ยัง ORDER BY staff_no ตรง ๆ (ไม่ผ่าน sortStaff)
  const direct = (body.match(/ORDER BY[^;]*staff_no/gi) || []).length;
  check(direct === 0,
    `${f} ไม่มีการ ORDER BY staff_no ตรง ๆ แล้ว`,
    direct ? `เหลือ ${direct} จุด — เรียงแค่ staff_no ไม่ได้จัดกลุ่มงาน/ตำแหน่ง` : '');
}

console.log('');
console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);