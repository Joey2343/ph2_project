/**
 * ทดสอบบทบาท (สิทธิ์) ของ สพป.แพร่ เขต 2 กับ สถานศึกษา แยกกัน
 *
 * ทำไมต้องมี
 * ──────────
 * ก่อนแก้ หน้ากำหนดสิทธิ์แสดงรายการเดียวกันทั้งสองฝั่ง
 * → เจ้าหน้าที่สถานศึกษาที่กดปุ่ม "สิทธิ์" จะเห็นตัวเลือกของ สพป. เช่น
 *   "รองผู้อำนวยการ สพป.แพร่ เขต 2" และเลือกผิดฝั่งได้
 *
 * และเจอบั๊กซ่อน: isApprover() เรียก ROLES[user.role].approveLevels โดยไม่กัน
 *   ถ้า role ไม่อยู่ในตาราง (เช่น school_staff ที่เพิ่งมีในฝั่งหน้าเว็บแต่ไม่มีใน backend)
 *   และ can_approve = 1 → TypeError → route ตอบ 500 แทน 403
 *
 * ต้องรันหลังเซิร์ฟเวอร์เริ่มแล้ว (ส่วนที่ยิง API)
 * ใช้: node scripts/test-school-roles.js
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
const FE = path.join(ROOT, '..', 'frontend', 'src');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const ADMIN_USER = process.env.TEST_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.TEST_ADMIN_PASS || 'Joey2343**';

const auth = require(path.join(ROOT, 'lib', 'auth.js'));

/* ── ① บทบาทฝั่งสถานศึกษา 4 บทบาทตามที่กำหนด ────────────────────────── */
console.log('');
console.log('① บทบาทฝั่งสถานศึกษา');

const WANT_SCHOOL = [
  ['school_director', 'ผู้อำนวยการสถานศึกษา'],
  ['school_deputy', 'รองผู้อำนวยการสถานศึกษา'],
  ['teacher', 'ครู'],
  ['school_clerk', 'เจ้าหน้าที่ธุรการ'],
];

check(auth.SCHOOL_ROLE_ORDER.length === 4,
  `มีบทบาทฝั่งสถานศึกษา 4 บทบาท (ได้ ${auth.SCHOOL_ROLE_ORDER.length})`);
for (const [v, label] of WANT_SCHOOL) {
  check(auth.SCHOOL_ROLE_ORDER.includes(v), `มีบทบาท ${v}`);
  check(!!auth.ROLES[v], `backend รู้จัก ${v}`);
  check(auth.ROLES[v] && auth.roleLabel(v) === label,
    `ป้ายของ ${v} = "${label}"`,
    auth.ROLES[v] ? 'ได้ "' + auth.roleLabel(v) + '"' : 'ไม่มีใน ROLES');
}
check(JSON.stringify(auth.SCHOOL_ROLE_ORDER) === JSON.stringify(WANT_SCHOOL.map((x) => x[0])),
  'ลำดับบทบาทฝั่งสถานศึกษาเรียงจากสูงไปต่ำ',
  'ได้ ' + auth.SCHOOL_ROLE_ORDER.join(' , '));

/* ── ② บทบาทสองฝั่งแยกกันจริง ─────────────────────────────────────────── */
console.log('');
console.log('② บทบาทสองฝั่งต้องแยกกัน');

for (const [v, label] of WANT_SCHOOL) {
  check(auth.isValidRoleFor(v, 'school'), `ตั้ง ${label} ให้เจ้าหน้าที่สถานศึกษาได้`);
  check(!auth.isValidRoleFor(v, 'office'), `ตั้ง ${label} ให้เจ้าหน้าที่ สพป. ไม่ได้`);
}
for (const v of ['staff', 'group_head', 'deputy', 'director']) {
  check(auth.isValidRoleFor(v, 'office'), `ตั้ง ${auth.roleLabel(v)} ให้เจ้าหน้าที่ สพป. ได้`);
  check(!auth.isValidRoleFor(v, 'school'), `ตั้ง ${auth.roleLabel(v)} ให้เจ้าหน้าที่สถานศึกษาไม่ได้`);
}
check(auth.isValidRoleFor('admin', 'school') && auth.isValidRoleFor('admin', 'office'),
  'ผู้ดูแลระบบ (admin) ใช้ได้ทั้งสองฝั่ง');
check(!auth.isValidRoleFor('member', 'office') && !auth.isValidRoleFor('member', 'school'),
  'บทบาทเก่า "member" ใช้ไม่ได้แล้ว');
check(!auth.isValidRoleFor('โกง', 'office'), 'บทบาทมั่วปันธงค์ ใช้ไม่ได้');
check(auth.rolesForGroup('school').length === 4, 'rolesForGroup("school") ได้ 4 บทบาท');
check(auth.rolesForGroup('office').length === 5, 'rolesForGroup("office") ได้ 5 บทบาท');

/* ── ③ บทบาทฝั่งสถานศึกษาต้องไม่ให้สิทธิ์อนุมัติ ─────────────────────── */
console.log('');
console.log('③ บทบาทฝั่งสถานศึกษาไม่ให้สิทธิ์อนุมัติ');

for (const v of auth.SCHOOL_ROLE_ORDER) {
  check((auth.ROLES[v].approveLevels || []).length === 0,
    `${auth.roleLabel(v)} ไม่มีสิทธิ์อนุมัติจากบทบาท`,
    'การอนุมัติสายสถานศึกษากำหนดที่แท็บ "ตั้งค่าการอนุมัติ" และผู้อนุมัติต้องเป็น สพป.');
}

/* ── ④ isApprover ต้องไม่พังเมื่อ role ไม่มีในตาราง ──────────────────── */
console.log('');
console.log('④ isApprover ต้องไม่พังเมื่อบทบาทไม่รู้จัก');

const active = { status: 'active', can_approve: 1 };
check(auth.isApprover({ ...active, role: 'admin' }) === true, 'admin → เป็นผู้อนุมัติ');
check(auth.isApprover({ ...active, role: 'deputy' }) === true, 'รองผู้อำนวยการ → เป็นผู้อนุมัติ');
check(auth.isApprover({ ...active, role: 'staff' }) === false, 'เจ้าหน้าที่ทั่วไป → ไม่อนุมัติ');
check(auth.isApprover({ ...active, role: 'teacher' }) === false, 'ครู → ไม่อนุมัติ');
// ⚠️ เคยพังตรงนี้ — role ที่ไม่มีใน ROLES เดิม (school_staff) → undefined.approveLevels
let crashed = null;
try {
  auth.isApprover({ ...active, role: 'school_staff' });
} catch (e) {
  crashed = e.message;
}
check(crashed === null, 'role ที่ไม่มีในตาราง (school_staff) ไม่ทำให้พัง', crashed || '');
try {
  auth.isApprover({ ...active, role: '' });
  auth.isApprover({ ...active, role: 'บทบาทที่ไม่มีอยู่จริง' });
} catch (e) {
  crashed = e.message;
}
check(crashed === null, 'role ว่าง/ไม่มีอยู่จริง ไม่ทำให้พัง', crashed || '');
// requireApprover เรียก isApprover → ถ้าพัง route จะตอบ 500
const canApproveCrash = (() => {
  try { return auth.canApprove({ ...active, role: 'school_staff' }, 1); } catch (e) { return e.message; }
})();
check(canApproveCrash === false, 'canApprove คืน false เมื่อบทบาทไม่รู้จัก', String(canApproveCrash));

/* ── ⑤ ฝั่งหน้าเว็บต้องตรงกับ backend ─────────────────────────────────── */
console.log('');
console.log('⑤ ฝั่งหน้าเว็บ (constants/index.js) ต้องตรงกับ backend');

const constSrc = fs.readFileSync(path.join(FE, 'constants', 'index.js'), 'utf8');
const mSchool = constSrc.match(/SCHOOL_ROLES:\s*\[([\s\S]*?)\]/);
check(!!mSchool, 'อ่าน SCHOOL_ROLES จาก constants/index.js ได้');
const feSchool = mSchool ? [...mSchool[1].matchAll(/value:\s*'([^']*)'/g)].map((x) => x[1]) : [];
check(JSON.stringify(feSchool) === JSON.stringify(auth.SCHOOL_ROLE_ORDER),
  'รายการและลำดับตรงกับ backend',
  'หน้าเว็บ: ' + feSchool.join(',') + ' · backend: ' + auth.SCHOOL_ROLE_ORDER.join(','));

const mOffice = constSrc.match(/OFFICE_ROLES:\s*\[([\s\S]*?)\]/);
const feOffice = mOffice ? [...mOffice[1].matchAll(/value:\s*'([^']*)'/g)].map((x) => x[1]) : [];
const beOffice = auth.rolesForGroup('office');
check(JSON.stringify(feOffice) === JSON.stringify(beOffice),
  'รายการบทบาทฝั่ง สพป. ตรงกับ backend',
  'หน้าเว็บ: ' + feOffice.join(',') + ' · backend: ' + beOffice.join(','));
check(!feOffice.some((v) => auth.SCHOOL_ROLE_ORDER.includes(v)),
  'บทบาทฝั่งสถานศึกษาไม่โผล่ในรายการของ สพป.');
check(!feSchool.some((v) => beOffice.includes(v) && v !== 'admin'),
  'บทบาทฝั่ง สพป. ไม่โผล่ในรายการของสถานศึกษา');

const mFn = constSrc.match(/rolesForGroup\((group)\)\s*\{([\s\S]*?)\n  \},/);
check(!!mFn, 'มีฟังก์ชัน rolesForGroup()');
if (mFn) {
  check(/group === 'school'/.test(mFn[2]), 'rolesForGroup แยกกรณี school');
  check(/SCHOOL_ROLES/.test(mFn[2]), 'rolesForGroup คืน SCHOOL_ROLES เมื่อเป็นฝั่งสถานศึกษา');
  check(/OFFICE_ROLES/.test(mFn[2]), 'rolesForGroup คืน OFFICE_ROLES เมื่อเป็นฝั่งสำนักงาน');
}

// modal ต้องดึงรายการตาม user_group ไม่ใช่ ROLES ทั้งหมด
const modalSrc = fs.readFileSync(path.join(FE, 'components', 'ui', 'StaffRoleModal.vue'), 'utf8');
check(/rolesForGroup\(/.test(modalSrc),
  'StaffRoleModal ใช้ rolesForGroup() ตาม user_group',
  'ถ้าใช้ CONSTANTS.ROLES ตรง ๆ จะเห็นบทบาทข้ามฝั่ง');
check(/v-for="r in roleOptions"/.test(modalSrc), 'dropdown ใช้ roleOptions');
check(!/v-for="r in CONSTANTS\.ROLES"/.test(modalSrc),
  'dropdown ไม่ได้วน ROLES ทั้งหมด',
  'นี่คือต้นเหตุที่เห็นบทบาทของ สพป. ในหน้าสถานศึกษา');

// StaffEditModal ต้องใช้รายการเดียวกัน
const editSrc = fs.readFileSync(path.join(FE, 'components', 'ui', 'StaffEditModal.vue'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ''); // ตัดคอมเมนต์ออก — ไม่งั้นข้อความอธิบายจะถูกนับเป็นโค้ด
check(/rolesForGroup\(/.test(editSrc), 'StaffEditModal ใช้ rolesForGroup() ตาม user_group');
check(!/school_staff/.test(editSrc),
  'StaffEditModal ไม่ hardcode บทบาท school_staff ในโค้ดแล้ว',
  'เดิม filter ด้วย ["admin","school_staff"] ซึ่งตัดบทบาทฝั่งสถานศึกษาทิ้งหมด');

/* ── ⑥ API: ตั้งบทบาทข้ามฝั่งต้องถูกปฏิเสธ ──────────────────────────── */
async function login() {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { status: res.status, cookie: setCookie.map((c) => c.split(';')[0]).join('; ') };
}

async function setRole(cookie, id, role) {
  const res = await fetch(`${BASE}/api/staff/${id}/role`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  let body = null;
  try { body = await res.json(); } catch (e) { /* ignore */ }
  return { status: res.status, body };
}

(async () => {
  console.log('');
  console.log('⑥ API ตั้งบทบาทข้ามฝั่งต้องถูกปฏิเสธ');

  let cookie = '';
  try {
    cookie = (await login()).cookie;
  } catch (e) {
    console.log(`  – ข้าม: ติดต่อ ${BASE} ไม่ได้ (${e.message}) — ให้เปิดเซิร์ฟเวอร์ก่อน`);
    console.log('');
    console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    process.exit(fail ? 1 : 0);
  }
  if (!cookie) {
    console.log(`  – ข้าม: ล็อกอินไม่สำเร็จ (${ADMIN_USER})`);
    console.log('');
    console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    process.exit(fail ? 1 : 0);
  }

  const listRes = await fetch(BASE + '/api/staff', { headers: { Cookie: cookie } });
  const list = await listRes.json();
  const schoolU = (list.staff || []).find((u) => u.user_group === 'school');
  const officeU = (list.staff || []).find((u) => u.user_group === 'office' && u.role === 'admin');

  if (!schoolU) {
    console.log('  – ข้าม: ฐานทดสอบยังไม่มีเจ้าหน้าที่สถานศึกษา');
  } else {
    // ⚠️ ทดสอบด้วยการตั้งผิดฝั่งเท่านั้น (ไม่แตะบทบาทที่ถูกต้องของจริง)
    const bad = await setRole(cookie, schoolU.id, 'deputy');
    check(bad.status === 400, `ให้เจ้าหน้าที่สถานศึกษาเป็น "รองผู้อำนวยการ สพป." → ถูกปฏิเสธ (HTTP ${bad.status})`,
      'ได้: ' + (bad.body && bad.body.error));
    check(!!(bad.body && /สถานศึกษา/.test(bad.body.error || '')),
      'ข้อความ error บอกว่าต้องใช้บทบาทฝั่งสถานศึกษา');
  }

  if (!officeU) {
    console.log('  – ข้าม: ฐานทดสอบไม่มีเจ้าหน้าที่ สพป. ที่ใช้ทดสอบ');
  } else {
    const bad2 = await setRole(cookie, officeU.id, 'teacher');
    check(bad2.status === 400, `ให้เจ้าหน้าที่ สพป. เป็น "ครู" → ถูกปฏิเสธ (HTTP ${bad2.status})`,
      'ได้: ' + (bad2.body && bad2.body.error));
  }

  // ยืนยันว่าบทบาทเดิมไม่ถูกแก้จากการทดสอบข้างบน
  const after = await (await fetch(BASE + '/api/staff', { headers: { Cookie: cookie } })).json();
  const schoolAfter = (after.staff || []).find((u) => u.user_group === 'school');
  if (schoolU && schoolAfter) {
    check(schoolAfter.role === schoolU.role,
      'บทบาทเดิมของเจ้าหน้าที่สถานศึกษาไม่ถูกเปลี่ยนจากการทดสอบ',
      `ก่อน ${schoolU.role} → หลัง ${schoolAfter.role}`);
  }

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  // เซิร์ฟเวอร์ล่มกลางคัน = ข้าม ไม่ใช่บั๊กของโค้ด
  console.log(`  – ข้าม: เรียก API ไม่สำเร็จ (${e.message})`);
  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
});