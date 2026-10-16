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
console.log('⑥ backend ต้องคืน row จาก endpoint เปลี่ยนสถานะ');
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
console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);