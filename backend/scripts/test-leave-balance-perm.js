/**
 * ตรวจว่าสิทธิ์ "หน้าวันลาพักผ่อนสะสม" ไม่ drift ออกจากกัน
 *
 * ประวัติ
 * ──────
 * เดิม GET /leave-balances ให้สิทธิ์ admin · can_approve · ผู้ตรวจสอบ (ขั้นที่ 1)
 * แต่ PUT /leave-balances/:userId ตรวจแค่ admin · ผู้ตรวจสอบ — ไม่เอา can_approve
 * → ผู้มี can_approve เห็นปุ่ม ✎ แต่กดบันทึกแล้ว 403
 *
 * 11 พ.ย. 2569 ผู้ใช้เปลี่ยนกติกา
 * ──────────────────────────────
 * "เพิ่มปุ่ม เจ้าหน้าที่วันลาพักผ่อนสะสม … เจ้าหน้าที่ส่วนนี้จะมีปุ่มแก้ไข
 *  วันลาพักผ่อนสะสมของทุกคน ส่วนคนที่ไม่ใช่จะไม่มีปุ่มแก้ไข"
 *   → ดูตาราง (GET)  = canViewLeaveBalance()  (admin · can_approve · ผู้ตรวจสอบ · เจ้าหน้าที่วันลาพักผ่อนสะสม)
 *   → แก้ไข (PUT)     = canEditLeaveBalance()  (admin · เจ้าหน้าที่วันลาพักผ่อนสะสม เท่านั้น)
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
console.log('สิทธิ์หน้าวันลาพักผ่อนสะสม:');

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
  check(/canViewLeaveBalance\s*\(/.test(getBody),
    'GET ใช้ helper canViewLeaveBalance()',
    'การดูใช้ helper กลาง ไม่เขียนเงื่อนไขเอง');
  check(/canEditLeaveBalance\s*\(/.test(putBody),
    'PUT ใช้ helper canEditLeaveBalance()',
    'การแก้ไขต้องใช้ helper ตัวเดียวกับที่หน้าเว็บใช้ตัดสินปุ่ม ✎');

  // ห้ามตรวจสิทธิ์ inline ในตัว route แล้ว (จะ drift ได้อีก)
  check(!/req\.user\.role\s*===\s*'admin'/.test(getBody),
    'GET ไม่ตรวจสิทธิ์ inline (ต้องพึ่ง helper)');
  check(!/req\.user\.role\s*===\s*'admin'/.test(putBody),
    'PUT ไม่ตรวจสิทธิ์ inline (ต้องพึ่ง helper)');
  check(!/leave_approvers/.test(getBody),
    'GET ไม่อ่าน settings leave_approvers เอง (helper ดูแลแล้ว)');
  check(!/leave_approvers/.test(putBody),
    'PUT ไม่อ่าน settings leave_approvers เอง (helper ดูแลแล้ว)');

  console.log('');
  console.log('helper ฝั่ง "ดู" (canViewLeaveBalance):');
  const hv = SRC.indexOf('async function canViewLeaveBalance');
  check(hv !== -1, 'มีฟังก์ชัน canViewLeaveBalance()');
  if (hv !== -1) {
    const helper = SRC.slice(hv, hv + 900);
    check(/user\.role\s*===\s*'admin'/.test(helper), 'ให้สิทธิ์ admin');
    check(/user\.can_approve/.test(helper), 'ให้สิทธิ์ can_approve');
    check(/canViewLeaveBalance/.test(helper) === false || /la\['1'\]/.test(helper) || /isLeaveBalanceStaff/.test(helper),
      'ครอบคลุมผู้ตรวจสอบ/เจ้าหน้าที่วันลาพักผ่อนสะสม');
    check(/isLeaveBalanceStaff\s*\(/.test(helper), 'ให้สิทธิ์เจ้าหน้าที่วันลาพักผ่อนสะสม');
  }

  console.log('');
  console.log('helper ฝั่ง "แก้ไข" (canEditLeaveBalance):');
  const h = SRC.indexOf('async function canEditLeaveBalance');
  check(h !== -1, 'มีฟังก์ชัน canEditLeaveBalance()');
  if (h !== -1) {
    const helper = SRC.slice(h, h + 400);
    check(/user\.role\s*===\s*'admin'/.test(helper), 'ให้สิทธิ์ admin');
    check(/isLeaveBalanceStaff\s*\(/.test(helper), 'ให้สิทธิ์เฉพาะเจ้าหน้าที่วันลาพักผ่อนสะสม');
    check(!/user\.can_approve/.test(helper),
      'ไม่ให้ can_approve แก้ไขเอง (ผู้ใช้สั่ง 11 พ.ย. 2569)',
      'คนที่ไม่ใช่เจ้าหน้าที่วันลาพักผ่อนสะสมต้องไม่มีปุ่มแก้ไข');
  }

  // endpoint กำหนดรายชื่อเจ้าหน้าที่
  check(/router\.put\('\/leave-balance-staff'[\s\S]{0,120}?requireAdmin/.test(SRC),
    'กำหนดเจ้าหน้าที่วันลาพักผ่อนสะสมได้เฉพาะ admin');
  check(/leave_balance_staff/.test(SRC), 'เก็บรายชื่อใน settings key leave_balance_staff');

  // ปีงบประมาณต้องเป็นตัวเลขจริง — กันการบันทึกผิดปีแบบเงียบ ๆ
  check(/Number\.isInteger\s*\(\s*year\s*\)/.test(putBody),
    'PUT ปฏิเสธปีงบประมาณที่ไม่ใช่ตัวเลข (กันบันทึกผิดปี)',
    'ถ้า year เป็น object (เช่น Vue ref) Number() จะได้ NaN แล้วบันทึกลงปีปัจจุบันเงียบ ๆ');
}

console.log('');
console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);
