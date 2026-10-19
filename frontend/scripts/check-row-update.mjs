/**
 * ตรวจว่าทุกเมนูอัปเดตสถานะเฉพาะแถว ไม่โหลดตารางใหม่ทั้งหน้า
 *
 * ทำไมต้องมี
 * ──────────
 * ผู้ใช้แจ้งว่า "กดอนุมัติ/กดตรวจสอบ/กดดูหนังสือ แล้วสถานะไม่เปลี่ยน ต้องรีเฟรชเอง"
 *
 *   · ปุ่ม "อ่านหนังสือ" — เดิมไม่อัปเดตเลย จนกว่าผู้ใช้รีเฟรชเอง (บั๊กจริง)
 *   · ปุ่มอนุมัติ/ตรวจสอบ — เดิม reload ทั้งตาราง ตารางหายไปเหลือ "กำลังโหลดข้อมูล..."
 *     ทุกครั้ง (ใช้งานช้าและดูเหมือนหน้าเว็บค้าง)
 *
 * วิธีนี้: backend คืน `row` = สถานะจริงหลังบันทึก → หน้าเว็บทับแถวเดิมเฉพาะตัว
 *
 * ⚠️ สิ่งที่ต้องระวังตอนอ่านโค้ดหน้าเว็บ
 *   · `load()` ยังถูกต้องในบางกรณี (บันทึกฟอร์มที่เปลี่ยนหลายคอลัมน์, เปลี่ยนแท็บ)
 *     → เทสต์นี้ตรวจเฉพาะ "หลังกดปุ่มเปลี่ยนสถานะ" เท่านั้น
 *   · ต้องมี fallback เมื่อหาแถวไม่เจอ → โหลดใหม่ดีกว่าค้างเงียบ
 *
 * ใช้: node scripts/check-row-update.mjs
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

/**
 * ตัดคอมเมนต์ออกจากโค้ดก่อนตรวจด้วย regex
 *
 * จำเป็นมาก ๆ เพราะคอมเมนต์ในไฟล์นี้เขียนตัวอย่างโค้ดไว้ข้างใน
 * ถ้าไม่ตัด บรรทัดที่ "อธิบายบั๊ก" จะถูกนับเป็นการเรียกจริง (เคยเจอ)
 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

console.log('');
console.log('① ตัวช่วยอัปเดตแถว (lib/row-update.js) ต้องมีอยู่และถูกต้อง');
const lib = read('src/lib/row-update.js');
for (const fn of ['patchRow', 'rowOf', 'applyRow', 'removeRow']) {
  check(new RegExp(`export function ${fn}\\s*\\(`).test(lib), `มีฟังก์ชัน ${fn}()`);
}
check(/list\[i\] = Object\.assign\(\{\}, list\[i\], patch\)/.test(lib),
  'patchRow แทนที่ทั้งออบเจกต์ (ไม่ใช่ Object.assign เดิม)',
  'ต้องแทนที่ทั้งออบเจกต์ ไม่งั้น Vue จะตรวจไม่พบการเปลี่ยนและหน้าจอไม่อัปเดต');
check(/String\(r\.id\) === String\(id\)/.test(lib),
  'เทียบ id แบบ string (ไม่ต้องพึ่งชนิดข้อมูลตรงกัน)');
check(/typeof reload === 'function'/.test(lib),
  'applyRow มี fallback เรียก reload เมื่ออัปเดตไม่ได้ (กันข้อมูลค้างเงียบ)');

console.log('');
console.log('② ทุกหน้าที่เปลี่ยนสถานะ ต้องอัปเดตเฉพาะแถว');
const PAGES = [
  ['src/pages/DocumentsPage.vue', 'หนังสือราชการ', ['markCertDone', 'removeDoc', 'unregister']],
  ['src/pages/LeavePage.vue', 'ลา', ['decide', 'sendApproveNote', 'remove', 'requestCancel', 'confirmCancel']],
  ['src/pages/TravelPage.vue', 'ไปราชการ', ['onDecide', 'remove']],
  ['src/pages/MemosPage.vue', 'บันทึกข้อความ', ['afterChange', 'remove']],
  ['src/pages/VehiclesPage.vue', 'จองยานพาหนะ', ['decideDirect', 'submitApproveLevel1', 'removeBooking']],
  ['src/pages/RoomsPage.vue', 'จองห้องประชุม', ['decideDirect', 'removeBooking']],
];

for (const [file, label, fns] of PAGES) {
  const src = read(file);
  check(/from '\.\.\/lib\/row-update\.js'/.test(src), `${label}: import ตัวช่วยอัปเดตแถว`);

  // แต่ละฟังก์ชันที่เปลี่ยนสถานะ ต้องมี applyRow หรือ removeRow อยู่ในตัวมันเอง
  for (const fn of fns) {
    const start = src.indexOf(`function ${fn}(`);
    if (start === -1) { check(false, `${label}: พบฟังก์ชัน ${fn}()`); continue; }
    // ตัดทั้งฟังก์ชันออกมา (นับวงเล็บปีกกา)
    let d = 0;
    let end = src.indexOf('{', start);
    for (let k = end; k < src.length; k += 1) {
      if (src[k] === '{') d += 1;
      else if (src[k] === '}') { d -= 1; if (d === 0) { end = k + 1; break; } }
    }
    const body = src.slice(start, end);
    const updatesRow = /\bapplyRow\s*\(/.test(body) || /\bremoveRow\s*\(/.test(body);
    /*
     * ทางสำรองมี 2 รูปแบบ ต้องเช็กให้ครบ ไม่งั้นจะเพี้ยนผิด
     *   ① เรียกเอง   → if (!applyRow(...)) await load();
     *   ② ส่งเป็น callback → applyRow(list, id, res, load)
     *      ⚠️ รูปแบบ ② ไม่มีเครื่องหมาย "(" ต่อ load เลย
     *         ถ้ามองหาแค่ "load(" จะเข้าใจผิดว่าไม่มี fallback
     */
    const hasFallback = /\bload\s*\(/.test(body)
      || /\bloadBookings\s*\(/.test(body)
      || /\bapplyRow\s*\([^;]*?,\s*(load|loadBookings)\s*\)/.test(body);
    check(updatesRow, `${label}: ${fn}() อัปเดตเฉพาะแถว ไม่โหลดทั้งตาราง`,
      'ยังไม่พบ applyRow()/removeRow() ในตัวฟังก์ชันนี้');
    check(hasFallback, `${label}: ${fn}() มีทางสำรองถ้าอัปเดตไม่ได้`,
      'ถ้าไม่มี fallback ข้อมูลจะค้างผิดเงียบ ๆ โดยไม่มี error');
  }
}

console.log('');
console.log('③ ปุ่มอ่านหนังสือ (ต้นเหตุที่ผู้ใช้เจอ)');
const detail = read('src/components/documents/DocumentsDetailModal.vue');
check(/defineEmits\(\[[^\]]*'read'/.test(detail),
  'dialog ประกาศ emit "read"',
  'ไม่งั้นหน้าหลักจะไม่รู้ว่าอ่านแล้ว และต้องรอผู้ใช้รีเฟรชเอง (บั๊กเดิม)');
check(/api\.put\('\/document-recipients\/'\s*\+\s*d\.id\s*\+\s*'\/read'\)[\s\S]{0,160}emit\('read'/.test(detail),
  'หลังบันทึกว่าอ่านแล้ว ต้อง emit "read" ต่อให้หน้าหลัก');
const docsPage = read('src/pages/DocumentsPage.vue');
check(/@read="onDetailRead"/.test(docsPage), 'หน้าหลักผูก @read ไว้');
check(/function onDetailRead\([\s\S]{0,400}?is_read\s*=\s*1/.test(docsPage),
  'onDetailRead แก้ is_read = 1 ในแถวนั้นทันที',
  'ต้องแก้ state ของแถวโดยตรง ไม่ใช่เรียกโหลดใหม่');

console.log('');
console.log('④ dialog ที่ส่งสถานะกลับ ต้องส่ง id มาด้วย');
check(/emit\('done',\s*\{\s*id:[\s\S]{0,60}row:/.test(read('src/components/ui/LeaveReview.vue')),
  'LeaveReview ส่ง { id, row } — หน้าหลักต้องรู้ว่าจะแก้แถวไหน');
check(/emit\('done',\s*\{\s*id:[\s\S]{0,60}row:/.test(read('src/components/ui/MemoDecide.vue')),
  'MemoDecide ส่ง { id, row }');

console.log('');
console.log('⑤ หน้าที่รับ payload ต้องรองรับทั้งแบบมีและไม่มี row');
for (const [file, label] of [
  ['src/pages/LeavePage.vue', 'ลา'],
  ['src/pages/MemosPage.vue', 'บันทึกข้อความ'],
]) {
  const src = read(file);
  const m = /async function afterChange\(([^)]*)\)/.exec(src);
  check(!!m, `${label}: afterChange รับ payload`);
  const body = m ? src.slice(src.indexOf('async function afterChange('), src.indexOf('async function afterChange(') + 500) : '';
  check(/payload\s*&&\s*payload\.row/.test(body),
    `${label}: ตรวจ payload.row ก่อนใช้`,
    'ถ้าไม่ตรวจ ฟอร์มที่ emit done โดยไม่มี payload จะพัง');
  check(/await load\(\)/.test(body),
    `${label}: ถ้าไม่มี row ให้โหลดใหม่ (บันทึกฟอร์มยังต้องโหลด)`);
}

console.log('');
console.log('');
console.log('');
console.log('⑥ รูปแบบการส่งแถวเข้า applyRow ต้องถูก — ส่งผิดแล้วเงียบทั้งหน้า');
/*
 * ⚠️ เคยเป็นบั๊กจริง (DocumentsPage.onReturned)
 *
 *   applyRow(list, id, res, reload) รอ "คำตอบของ backend" แล้วเอา res.row ออกมาใช้เอง
 *   ถ้าส่ง row เข้าไปตรง ๆ → rowOf() หา res.row ไม่เจอ → ได้ null
 *   → patchRow ทำงานด้วย {} → ทับแถวด้วยค่าเดิมทั้งก้อน = ไม่มีอะไรเปลี่ยน
 *   → และเพราะ patchRow คืน true หน้าเว็บจะไม่ reload ด้วย
 *   ผลคือคอลัมน์ "สถานะ" ยังเป็นค่าเก่าจนกว่าผู้ใช้กดรีเฟรช
 *   และไม่มี error ไม่มีเตือนอะไรเลย (เจอจริงตอนทดสอบด้วยเบราว์เซอร์)
 *
 * กฎ
 *   · ตัวแปรที่เป็น "แถว"          (row / payload.row) → ต้องห่อเป็น { row }
 *   · ตัวแปรที่เป็น "คำตอบจาก api" (res)             → ส่งตรง ๆ ได้
 */
const PAGES_APPLYROW = [
  'DocumentsPage.vue', 'LeavePage.vue', 'MemosPage.vue',
  'TravelPage.vue', 'VehiclesPage.vue', 'RoomsPage.vue',
];
for (const file of PAGES_APPLYROW) {
  // ตัดคอมเมนต์ทิ้งก่อน ไม่งั้นตัวอย่างในคอมเมนต์จะถูกนับเป็นโค้ดจริง
  const src = stripComments(read(`src/pages/${file}`));
  // ไม่ยึดว่าต้องลงท้ายด้วย ";" เพราะมีทั้งแบบ if (...) return; และแบบประกอบเงื่อนไข
  const calls = [...src.matchAll(/applyRow\s*\(([^()]*)\)/g)].map((m) => m[1]);
  check(calls.length > 0, `${file}: มีการเรียก applyRow`);
  for (const call of calls) {
    const third = (call.split(',')[2] || '').trim();
    check(third !== 'row' && third !== 'payload.row',
      `${file}: ไม่ส่งแถวเข้า applyRow ตรง ๆ`,
      `พบอาร์กิวเมนต์ที่ 3 เป็น "${third}" — ต้องห่อเป็น { ${third} }`
      + '\n      ไม่งั้น rowOf() จะหา .row ไม่เจอ แล้วอัปเดตแถวด้วย {}'
      + ' (ไม่มีอะไรเปลี่ยน และไม่แจ้ง error)');
    check(third !== 'null',
      `${file}: reload ต้องเป็นฟังก์ชัน ไม่ใช่ null`,
      'ถ้าหาแถวไม่เจอและไม่มี reload → รายการค้างค่าเก่าถาวรโดยไม่บอกอะไร');
  }
}

console.log('');
console.log('⑦ backend ต้องคืน row จาก endpoint เปลี่ยนสถานะ');
// ⚠️ ช่วง [\s\S]{0,N} ต้องกว้างพอ ไม่งั้นจะได้ false negative
//   ต้นฉบับใช้ 2600 / 900 แต่โค้ดจริงห่างกัน 3677 / 1089 ตัวอักษร
//   → เทสต์ fail ทั้งที่โค้ดถูกแล้ว (เจอแล้วระหว่างเขียนรอบนี้)
//
// ⚠️⚠️ ต้องเขียนเป็น "[\\s\\S]" (สองแท็งแบ็กสแลช)
//   ถ้าเขียน '[\s\S]' ใน string literal → \s ไม่ใช่ escape → กลายเป็น [sS]
//   แล้วจะ match ได้เฉพาะตัวอักษร s กับ S เท่านั้น → พังทั้งข้อแบบเงียบ ๆ
//   (เจอแล้วระหว่างเขียนรอบนี้ ข้อ ⑥ ล้มทั้ง 7 ข้อ ทั้งที่โค้ดถูก)
const WIN = '[\\s\\S]{0,6000}?';
const approve = read(path.join('..', 'backend', 'lib', 'approvals.js'));
check(new RegExp('row:\\s*\\{\\s*\\n\\s*approval_level:' + WIN + 'approvals,' + WIN + 'status:').test(approve),
  'approveRequest คืน approvals + status',
  '⚠️ ต้องคืน approvals ด้วย เพราะ UI.approvalDone() ใช้ approvals.length ก่อน approval_level');
check(/row:\s*\{\s*\n\s*status:\s*'rejected'/.test(approve), 'rejectRequest คืน status rejected');
const adminRoute = read(path.join('..', 'backend', 'routes', 'admin.js'));
check(new RegExp('document-recipients/:docId/read' + WIN + 'is_read:\\s*1').test(adminRoute),
  'ปุ่มอ่านหนังสือ คืน is_read: 1 (บั๊กเดิมคืนแค่ { ok: true })');
check(new RegExp("cert-status/:id" + WIN + "cert_status:\\s*'เสร็จแล้ว'").test(adminRoute),
  'ปุ่มดำเนินการเสร็จแล้ว คืน cert_status');
const opsRoute = read(path.join('..', 'backend', 'routes', 'ops.js'));
check(new RegExp('vehicle-bookings/:id/approve' + WIN + 'driver_name:' + WIN + 'vehicle_name:\\s*vh').test(opsRoute),
  'อนุมัติยานพาหนะ คืน vehicle_name/driver_name ด้วย',
  '⚠️ ขั้นต้นเลือกจัดรถให้ แต่ถ้าไม่คืนค่า คอลัมน์ "ยานพาหนะ" จะโชว์ค่าเก่า\n'
  + '      (โค้ดเขียน driver_name ก่อน vehicle_name — ลำดับใน regex ต้องตรงกับโค้ดจริง)');
const reqRoute = read(path.join('..', 'backend', 'routes', 'requests.js'));
check(new RegExp('leaves/:id/review' + WIN + 'reviewed:\\s*1').test(reqRoute),
  'ปุ่มตรวจสอบแล้ว คืน reviewed + status');
check(new RegExp('memos/:id/reject' + WIN + "status:\\s*'rejected'").test(reqRoute),
  'ไม่อนุมัติบันทึกข้อความ คืน status rejected');
check(new RegExp('leaves/:id/cancel-request' + WIN + "cancel_status:\\s*'cancel_requested'").test(reqRoute),
  'ขอยกเลิกวันลา คืน cancel_status');

console.log('');
console.log('⑦ จุดที่เทสต์รันตรวจไม่ได้ — ต้องนับในโค้ด');
/*
 * ⚠️ เรื่องนี้เคยหลอกเราไปแล้ว
 *
 * คิดจะเช็กว่า `approvals[last].at === row.decided_at` ด้วยการรันจริง
 *   → ผ่านทุกครั้ง แม้ตอนเรียก auth.now() สองครั้งแยกจุดจริง ๆ
 *   เพราะสองครั้งมักอยู่ในวินาทีเดียวกัน → ค่าเท่ากัน → มองไม่เห็นบั๊ก
 *   = เทสต์ที่ผ่านเพราะบั๊กมองไม่เห็น ซึ่งแย่กว่าไม่มีเทสต์
 *
 * วิธีที่ใช้ได้จริง: นับจำนวนการเรียก auth.now() ในแต่ละ handler
 *   ต้องมีค่าเดียว แล้วเอาไปใช้ทั้ง approval_data และ decided_at
 */
// นับการเรียก auth.now() ใน handler เดียว
//   ⚠️ ต้อง (1) หาขอบเขตด้วยการนับวงเล็บ ไม่ใช่ไล่หา "\n});"
//     เพราะ route จบด้วย "});" แต่ฟังก์ชันช่วยจบด้วย "}"
//     และถ้าไล่หาช้าเกิน จะไปนับ auth.now() ของ handler ถัดไปมาด้วย
//   ⚠️ ต้อง (2) ตัดคอมเมนต์ทิ้งก่อน ไม่งั้นบรรทัดที่อธิบายเรื่องนี้พอดี
//     จะถูกนับเป็นการเรียกจริง (เคยเจอ: คอมเมนต์ที่เขียนว่า "ถ้าเรียก auth.now() สองครั้ง")

const nowInHandler = (rawSrc, anchor) => {
  const src = stripComments(rawSrc);
  const i = src.indexOf(anchor);
  if (i === -1) return -1;

  /*
   * ⚠️ หาเปิด body ยากกว่าที่คิด เพราะ anchor มี 2 รูปแบบ
   *
   *   A) async function approveRequest({ table, system, ... }) {
   *        ตัวแรกคือ { ของ destructuring parameter → ต้องข้ามไป
   *
   *   B) router.put('/path', mw, async (req, res) => {
   *        ตัวแรกคือ { ของ body จริง แต่ "router.put(" ยังไม่ปิดวงเล็บ
   *        (Express ปิดท้างสุดหลัง handler) → parenDepth ยังเป็น 1
   *        ถ้าใช้เงื่อนไข parenDepth===0 จะหาไม่เจอเลย (เคยเจอตอนรีวิว)
   *
   * วิธีแยก: ดูตัวอักษรก่อน { — ถ้าลงท้ายด้วย ( หรือ , แปลว่าเป็น parameter → ข้าม
   */
  let k = i;
  while (k < src.length && k - i < 4000) {
    const ch = src[k];
    if (ch !== '{') { k += 1; continue; }
    // ดูตัวอักษรที่ไม่ใช่ช่องว่าง ก่อน { ตัวนี้
    let p = k - 1;
    while (p >= i && /\s/.test(src[p])) p -= 1;
    const before = src[p];
    if (before === '(' || before === ',') {
      // เป็น destructuring parameter → ข้ามไปหลัง } ที่ปิดมัน
      let d = 0;
      for (; k < src.length; k += 1) {
        if (src[k] === '{') d += 1;
        else if (src[k] === '}') { d -= 1; if (d === 0) { k += 1; break; } }
      }
      continue;
    }
    // เจอเปิด body จริง → นับวงเล็บให้สมดุลเพื่อหาปิดท้าย
    let depth = 0;
    for (let j = k; j < src.length; j += 1) {
      if (src[j] === '{') depth += 1;
      else if (src[j] === '}') {
        depth -= 1;
        if (depth === 0) return (src.slice(k, j).match(/auth\.now\(\)/g) || []).length;
      }
    }
    return -1;
  }
  return -1;
};

const HANDLERS = [
  [approve, 'approveRequest', 'async function approveRequest({'],
  [approve, 'rejectRequest', 'async function rejectRequest({'],
  [reqRoute, 'อนุมัติบันทึกข้อความ', "router.put('/memos/:id/approve'"],
  [reqRoute, 'ไม่อนุมัติบันทึกข้อความ', "router.put('/memos/:id/reject'"],
  [reqRoute, 'ส่งกลับให้แก้ไข (บันทึกข้อความ)', "router.put('/memos/:id/return'"],
  [reqRoute, 'ตรวจสอบคำขอลา', "router.put('/leaves/:id/review'"],
];
for (const [src, label, anchor] of HANDLERS) {
  const n = nowInHandler(src, anchor);
  check(n === 1, `${label}: เรียก auth.now() พอ 1 ครั้งใน handler (ได้ ${n})`,
    n === -1 ? `ไม่พบ handler "${anchor}" ในไฟล์`
      : 'ถ้าเรียกมากกว่า 1 ครั้ง ค่าจะต่างกันได้ข้ามวินาที\n'
        + '      → approvals[].at กับ decided_at ในฐานจะไม่ตรงกัน');
}
check(/approvals\.push\(\{[\s\S]{0,400}?at: decidedAt/.test(approve),
  'approveRequest ใส่ decidedAt เดียวลง approvals[].at ตั้งแต่ตอน push',
  'ต้องใช้ค่าเดียวตั้งแต่แรก ไม่ใช่ push แล้วค่อยทับทีหลัง');
check(/existingApprovals\.push\(\{[^}]*at: decidedAt/.test(reqRoute),
  'ตรวจสอบคำขอลา ใช้ decidedAt เดียวกับทั้ง approvals[].at และ decided_at');
check(!/row: \{ id: docId, is_read: 1, read_at/.test(adminRoute),
  'ปุ่มอ่านหนังสือไม่คืน read_at ที่ประดัษฐานบันทึก (ฐานใช้ NOW() ของ MariaDB)',
  'read_at ที่ได้จาก auth.now() เป็นค่าที่ไม่ได้บันทึกจริง → ห้ามคืน');

/*
 * ⑧ ปุ่ม "ส่งกลับเพื่อแก้ไข" ต้องไม่หลุดสิทธิ์
 *
 * ⚠️ เคยพลาดตรงนี้จริง
 *   ปุ่มถูกซ่อนด้วยเงื่อนไข `sender_type === 'school'` อย่างเดียว
 *   แต่โรงเรียนที่เป็นเจ้าของหนังสือก็มี sender_type = 'school' เหมือนกัน
 *   → โรงเรียนเห็นปุ่ม "ส่งกลับ" ในหนังสือของตัวเอง กดแล้วได้แค่ข้อความ 403
 *
 * ต้องมาจากหน้าหลัก (canReturnDocs = admin หรือสารบัญเขต) ส่งลงเป็น prop
 *   ไม่ใช่เดาเองใน component
 */
console.log('');
console.log('⑧ ปุ่มส่งกลับเพื่อแก้ไข — ต้องเช็คสิทธิ์ฝั่งหน้าเว็บ');
const docPage = read('src/pages/DocumentsPage.vue');
const detailModal = read('src/components/documents/DocumentsDetailModal.vue');
const incomingModal = read('src/components/documents/DocumentsIncomingFormModal.vue');
const retModal = read('src/components/documents/DocumentsReturnModal.vue');

check(/const canReturnDocs = computed\(\(\) => isAdmin\.value \|\| isOfficeDocStaff\.value\)/.test(docPage),
  'หน้าหลักมี canReturnDocs = admin หรือสารบัญเขต',
  'ต้องคำนวณสิทธิ์รวมไว้ที่เดียว แล้วส่งลง modal เป็น prop');
check(/:can-return="canReturnDocs"/.test(docPage),
  'ส่ง :can-return="canReturnDocs" ให้ modal รายละเอียดและ modal ลงทะเบียน',
  'ถ้าไม่ส่ง prop ปุ่มจะถูกซ่อนตลอด (คนที่ควรได้ใช้ก็กดไม่ได้)');
for (const [name, src] of [['modal รายละเอียด', detailModal], ['modal ลงทะเบียน', incomingModal]]) {
  check(/canReturn: \{ type: Boolean, default: false \}/.test(src),
    `${name} รับ prop can-return เป็น boolean`);
  check(/props\.canReturn\s*&&/.test(src),
    `${name} เช็ค props.canReturn ก่อนแสดงปุ่ม`,
    'ถ้าเช็คแค่ sender_type โรงเรียนจะเห็นปุ่มของตัวเอง');
  check(!/const canReturn = computed\(\(\) => !!props\.doc/.test(src),
    `${name} ไม่เดาสิทธิ์จาก doc เอง`);
}
check(/v-if="showReturn"/.test(detailModal) && /v-if="showReturn"/.test(incomingModal),
  'ปุ่มส่งกลับใช้ v-if="showReturn" (รวมสิทธิ์และชนิดหนังสือแล้ว)');
check(/@return-doc="openReturn"/.test(docPage),
  'หน้าหลักรับ @return-doc จาก modal ทั้งสอง');
check(/emit\('returned', \{ id: info\.value\.id, row: res\.row \|\| null \}\)/.test(retModal),
  'dialog ส่งกลับ { id, row } ให้หน้าหลักอัปเดตเฉพาะแถวนั้น',
  'ต้องส่ง row ที่ backend คืนมาจริง ไม่ใช่เดาค่าเองฝั่งหน้าเว็บ');
check(/if \(!t\) return UI\.toast\('กรุณากรอกสาเหตุที่ส่งกลับเพื่อแก้ไข'/.test(retModal),
  'dialog บังคับกรอกสาเหตุก่อนส่งกลับ',
  'ไม่กรอก = โรงเรียนไม่รู้จะแก้อะไร');
check(/sender_type: row\.sender_type \|\| ''/.test(docPage) && /revision_note: row\.revision_note \|\| ''/.test(docPage),
  'openIncomingRegister ส่งต่อ sender_type / revision_note ไปฟอร์ม',
  'ถ้าไม่ส่งต่อ ปุ่มส่งกลับจะไม่โผล่ตอนลงทะเบียนหนังสือจากโรงเรียน');

console.log('');
console.log('⑨ ตัวเลขบนหน้าแรกต้องเป็นตัวเลขจริง (ไม่ใช่ Promise ที่หลุด await)');
/*
 * ⚠️ เคยเป็นบั๊กจริงใน backend/routes/ops.js
 *   `const count = async (sql) => ...` แล้วเอาไปใส่ใน res.json({...}) โดยไม่ await
 *   → JSON.stringify(Promise) = {}
 *   → หน้าแรกเช็ค `count > 0` ซึ่ง {} > 0 เป็น false → การ์ดหน้าแรกไม่ขึ้นเลยทั้งหน้า
 *   เทสต์รันตรวจไม่ได้ (JSON ยัง "มีคีย์" แค่ค่าเป็น {}) จึงต้องนับในโค้ด
 */
const myPendingOps = readFileSync(path.join(ROOT, '..', 'backend', 'routes', 'ops.js'), 'utf8');
/** โค้ดทั้ง handler /my-pending — นับวงเล็บปีกกา (ไม่ไล่หา "\n});") */
const opsBody = (() => {
  const i = myPendingOps.indexOf("router.get('/my-pending'");
  if (i === -1) return '';
  const start = myPendingOps.indexOf('{', myPendingOps.indexOf('=>', i));
  let d = 0;
  for (let k = start; k < myPendingOps.length; k += 1) {
    if (myPendingOps[k] === '{') d += 1;
    else if (myPendingOps[k] === '}') { d -= 1; if (d === 0) return myPendingOps.slice(i, k); }
  }
  return '';
})();
check(!!opsBody, 'หา handler /my-pending ใน backend/routes/ops.js เจอ');
const CARD_FIELDS = ['vehicleNotices', 'vehicle', 'room', 'travel', 'leave', 'memo', 'memoReturned', 'docReturned'];
for (const f of CARD_FIELDS) {
  check(new RegExp('^\\s*' + f + ',?\\s*' + '$', 'm').test(opsBody),
    `my-pending ส่ง ${f} จากตัวแปรที่รอผลแล้ว`,
    'ถ้าเขียน `xxx: count(...)` โดยไม่ await จะได้ Promise → JSON เป็น {} → การ์ดไม่ขึ้น');
}
check(/await Promise\.all\(\[/.test(opsBody),
  'my-pending รอผลนับทั้งชุดด้วย await Promise.all');
check(!/docReturned: count\(/.test(opsBody),
  'ไม่มีการส่ง Promise ที่ยังไม่ await ออกไปหน้าเว็บ');
const homePage = read('src/pages/HomePage.vue');
// ต้องเช็คเฉพาะส่วนที่แสดงผลจริง ไม่ใช่คอมเมนต์ที่อธิบายว่าเคยมี
//   (คอมเมนต์บรรทัดนี้เองก็พูดถึงหัวข้อนั้นอยู่แล้ว)
check(!/section-title[^>]*>[^<]*งานที่ค้าง \/ รออนุมัติของฉัน/.test(homePage),
  'หน้าแรกไม่มีหัวข้อ งานที่ค้าง / รออนุมัติของฉัน อีกแล้ว',
  'ผู้ใช้สั่งเอาออกเพราะซ้ำกับป้ายแจ้งเตือนบนการ์ดเมนู และยอดรวมบนหัวข้อมักไม่ตรงกับที่เห็นจริง');
check(!/const myCards = computed/.test(homePage) && !/const myTotal = computed/.test(homePage),
  'ลบ myCards / myTotal ทิ้งแล้ว (ไม่มีใครใช้แล้ว)');
check(!/cardStyle\(/.test(homePage),
  'ลบฟังก์ชัน cardStyle ที่ไม่มีใครเรียกแล้วทิ้ง');
check(/myPending\.value = await api\.get\('\/my-pending'\)/.test(homePage),
  'ยังโหลด /my-pending ไว้ เพราะป้ายบนการ์ดเมนูอ่านจากที่นี่');

/*
 * ป้ายแจ้งเตือนบนการ์ดหนังสือราชการ
 *
 * ผู้ใช้สั่ง: หนังสือที่ต้องแก้ ต้องแสดงเป็นวงกลมสีแดงอีกอันหนึ่งบนการ์ดหนังสือราชการ
 *           (คนละอันกับป้ายหนังสือเข้าที่ยังไม่ได้อ่าน) และวงนั้นต้องกระพริบ
 */
check(/class="menu-count menu-count-fix"/.test(homePage),
  'ป้ายวงกลมที่สองบนการ์ดใช้คลาส menu-count-fix');
check(/v-if="m\.key === 'documents' && fixBadgeOf\(\)"/.test(homePage),
  'ป้ายใหม่แสดงเฉพาะการ์ดหนังสือราชการ และเฉพาะเมื่อมีหนังสือรอแก้จริง',
  'ถ้าใช้เงื่อนไขเดียวกับป้ายเดิม จะกลืนกันจนมองไม่เห็น');
check(/function fixBadgeOf\(\)/.test(homePage) && /Number\(p\.docReturned\) \|\| 0/.test(homePage),
  'fixBadgeOf() อ่าน docReturned (หนังสือที่ถูกส่งกลับ) ไม่ใช่ documentsUnread',
  'สองตัวนี้คนละเรื่องกัน ถ้าใช้ผิดจะโผล่ผิดเวลา');
check(/\.menu-count-fix\s*\{[\s\S]*?top:\s*41px/.test(homePage),
  'ป้ายใหม่อยู่ต่อกันลงล่างป้ายเดิมในมุมเดียวกัน (ขวาบน)',
  'ผู้ใช้สั่งให้อยู่ใกล้กับป้ายเตือนหนังสือเดิม ไม่ใช่คนละมุม\n'
  + '      ตำแหน่ง: 12 (ขอบบนตาม .menu-count) + 22 (ความสูงป้ายเดิม) + 7 (ช่องว่าง) = 41');
check(!/\.menu-count-fix\s*\{[\s\S]*?left:\s*12px/.test(homePage),
  'ป้ายใหม่ไม่ถูกย้ายไปมุมซ้ายบน (ห่างจากป้ายเดิมเกินไป)');
check(/\.menu-count-fix\s*\{[\s\S]*?animation:\s*ph2-fix-pulse/.test(homePage),
  'ป้ายใหม่กระพริบด้วย animation');
check(/@keyframes ph2-fix-pulse/.test(homePage),
  'มี keyframes ของการกระพริบ');
check(/prefers-reduced-motion: reduce/.test(homePage),
  'เคารพการตั้งค่าลดการเคลื่อนไหวของระบบ (หยุดกระพริบ)',
  'ผู้ใช้ที่เครื่องตั้งค่าลดการเคลื่อนไหวจะเห็นวงกระพริบตลอด = อาการลอกเลิง');

console.log('');
console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);