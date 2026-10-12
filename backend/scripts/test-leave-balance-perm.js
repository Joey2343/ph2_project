/**
 * ตรวจว่าสิทธิ์ "หน้าวันลาพักผ่อนสะสม" ของ GET และ PUT ไม่ drift ออกจากกัน
 *
 * ทำไมต้องมี
 * ──────────
 * GET  /leave-balances          เคยให้สิทธิ์แก่ admin · can_approve · ผู้ตรวจสอบ (ขั้นที่ 1)
 * PUT  /leave-balances/:userId  เคยตรวจแค่ admin · ผู้ตรวจสอบ (ขั้นที่ 1) — ไม่เอา can_approve
 *
 * ผลคือ ผู้ที่มี can_approve เห็นตารางและกดปุ่ม ✎ ได้ (ฝั่งหน้าเช็ค leave_approvers ทุกขั้น)
 * แต่กด "บันทึก" แล้วโดน 403 → หน้าต่างแก้ไขวันลาพักผ่อนสะสมบันทึกค่าไม่ได้
 *
 * กันไม่ให้เกิดซ้ำ: ทั้งสอง route ต้องเรียก helper ตัวเดียวกัน (canEditLeaveBalance)
 *
 * ใช้: node scripts/test-leave-balance-perm.js
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
const SRC = fs.readFileSync(path.join(ROOT, 'routes', 'requests.js'), 'utf8');

console.log('');
console.log('สิทธิ์หน้าวันลาพักผ่อนสะสม (GET ต้องตรงกับ PUT):');

/** ดึง body ของ route handler ที่คีย์ตรงกัน */
function handlerBody(marker) {
  const i = SRC.indexOf(marker);
  if (i === -1) return '';
  // ไปหาวงเล็บเปิดของ callback หลังจากนั้น
  const open = SRC.indexOf('{', i);
  let depth = 0;
  for (let k = open; k < SRC.length; k += 1) {
    if (SRC[k] === '{') depth += 1;
    else if (SRC[k] === '}') { depth -= 1; if (depth === 0) return SRC.slice(open, k + 1); }
  }
  return '';
}

const getBody = handlerBody("router.get('/leave-balances'");
const putBody = handlerBody("router.put('/leave-balances/:userId'");

check(!!getBody, 'พบ route GET /leave-balances');
check(!!putBody, 'พบ route PUT /leave-balances/:userId');

if (getBody && putBody) {
  check(/canEditLeaveBalance\s*\(/.test(getBody),
    'GET ใช้ helper canEditLeaveBalance()',
    'GET ต้องใช้ helper ตัวเดียวกับ PUT');
  check(/canEditLeaveBalance\s*\(/.test(putBody),
    'PUT ใช้ helper canEditLeaveBalance()',
    'PUT ต้องใช้ helper ตัวเดียวกับ GET');

  // ห้ามตรวจสิทธิ์ inline ในตัว route แล้ว (จะ drift ได้อีก)
  check(!/req\.user\.role\s*===\s*'admin'/.test(getBody),
    'GET ไม่ตรวจสิทธิ์ inline (ต้องพึ่ง helper)');
  check(!/req\.user\.role\s*===\s*'admin'/.test(putBody),
    'PUT ไม่ตรวจสิทธิ์ inline (ต้องพึ่ง helper)');
  check(!/leave_approvers/.test(getBody),
    'GET ไม่อ่าน settings leave_approvers เอง (helper ดูแลแล้ว)');
  check(!/leave_approvers/.test(putBody),
    'PUT ไม่อ่าน settings leave_approvers เอง (helper ดูแลแล้ว)');

  // helper ต้องครอบคลุม can_approve (จุดที่เคยตกหล่น)
  const h = SRC.indexOf('async function canEditLeaveBalance');
  check(h !== -1, 'มีฟังก์ชัน canEditLeaveBalance()');
  if (h !== -1) {
    const helper = SRC.slice(h, h + 700);
    check(/user\.role\s*===\s*'admin'/.test(helper), 'helper ให้สิทธิ์ admin');
    check(/user\.can_approve/.test(helper), 'helper ให้สิทธิ์ can_approve (จุดที่เคยตกหล่น)');
    check(/la\['1'\]/.test(helper), 'helper ให้สิทธิ์ผู้ตรวจสอบ (leave_approvers ขั้นที่ 1)');
  }

  // ปีงบประมาณต้องเป็นตัวเลขจริง — กันการบันทึกผิดปีแบบเงียบ ๆ
  check(/Number\.isInteger\s*\(\s*year\s*\)/.test(putBody),
    'PUT ปฏิเสธปีงบประมาณที่ไม่ใช่ตัวเลข (กันบันทึกผิดปี)',
    'ถ้า year เป็น object (เช่น Vue ref) Number() จะได้ NaN แล้วบันทึกลงปีปัจจุบันเงียบ ๆ');
}

console.log('');
console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);