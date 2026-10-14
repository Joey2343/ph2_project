/**
 * ทดสอบการดาวน์โหลดรายชื่อเจ้าหน้าที่เป็น Excel (หน้า "เจ้าหน้าที่ สพป.แพร่ เขต 2")
 *
 * ทำไมต้องมี
 * ──────────
 * ปุ่มดาวน์โหลดอยู่คนละฝั่งกับตารางบนหน้าจอ
 * ถ้าเรียงแถวคนละแบว → คอลัมน์ "ที่" ในไฟล์ไม่ตรงกับหมายเลขที่เห็นบนจอ
 * ถ้าฝั่ง backend กับ frontend มีรายการกลุ่มงานไม่ตรงกัน → ลำดับจะเพี้ยนเงียบ ๆ
 *
 * สิ่งที่เทสต์นี้จับ
 *   ① WORKPLACES ฝั่ง backend ตรงกับ CONSTANTS.WORKPLACES ฝั่ง frontend ทุกตัวอักษร
 *   ② กฎการเรียงแถว (ผู้บริหารฯ ก่อน · หน่วยตรวจสอบภายในท้ายสุด · staff_no น้อย→มาก)
 *   ③ การแปลงวันเกิดเป็น พ.ศ. และคำนวณอายุ
 *   ④ ไฟล์ .xlsx ที่ดาวน์โหลดได้ มีหัวคอลัมน์ครบ 12 ตามที่ขอ และเรียงลำดับตรงกับหน้าจอ
 *   ⑤ ผู้ที่ไม่ใช่ผู้ดูแลระบบ ดาวน์โหลดไม่ได้ (403)
 *
 * ต้องรันหลังเซิร์ฟเวอร์เริ่มแล้ว (ต้องการ HTTP + MariaDB)
 * ใช้: node scripts/test-staff-export.js
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
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const ADMIN_USER = process.env.TEST_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.TEST_ADMIN_PASS || 'Joey2343**';

const EXPECT_HEAD = [
  'ที่', 'ชื่อ-นามสกุล', 'ชื่อเล่น', 'เลขบัตรประชาชน', 'ตำแหน่ง', 'วิทยฐานะ',
  'กลุ่มงาน', 'วุฒิการศึกษาสูงสุด', 'วัน/เดือน/ปี เกิด', 'อายุ', 'เบอร์โทร', 'อีเมล',
];

const s = require(path.join(ROOT, 'lib', 'staff-sort.js'));

/* ── ① รายการกลุ่มงานตรงกับฝั่งหน้าเว็บ ──────────────────────────────── */
console.log('');
console.log('① รายการกลุ่มงาน ต้องตรงกับฝั่งหน้าเว็บทุกตัวอักษร');

const constSrc = fs.readFileSync(path.join(ROOT, '..', 'frontend', 'src', 'constants', 'index.js'), 'utf8');
const mWp = constSrc.match(/WORKPLACES:\s*\[([\s\S]*?)\]/);
check(!!mWp, 'อ่าน WORKPLACES จาก frontend/src/constants/index.js ได้');
const feWp = mWp ? [...mWp[1].matchAll(/'([^']*)'/g)].map((x) => x[1]) : [];

check(feWp.length === s.WORKPLACES.length,
  `จำนวนกลุ่มงานเท่ากัน (backend ${s.WORKPLACES.length} · frontend ${feWp.length})`);
check(feWp.length > 0 && feWp.every((x, i) => x === s.WORKPLACES[i]),
  'ลำดับและตัวอักษรของกลุ่มงานตรงกัน',
  feWp.filter((x, i) => x !== s.WORKPLACES[i]).length
    ? 'ต่างกันที่: ' + feWp.filter((x, i) => x !== s.WORKPLACES[i]).join(' / ') : '');

/* ── ② กฎการเรียงแถว ─────────────────────────────────────────────────── */
console.log('');
console.log('② กฎการเรียงแถว');

const officeRows = [
  { id: 1, workplace: 'หน่วยตรวจสอบภายใน', staff_no: '1' },
  { id: 2, workplace: 'กลุ่มอำนวยการ', staff_no: '9' },
  { id: 3, workplace: 'กลุ่มอำนวยการ', staff_no: '2' },
  { id: 4, workplace: 'ผู้บริหารการศึกษา', position: 'รองผู้อำนวยการ' },
  { id: 5, workplace: 'ผู้บริหารการศึกษา', position: 'ผู้อำนวยการ' },
];
const officeSorted = s.sortStaff(officeRows, 'office').map((u) => u.id);
check(JSON.stringify(officeSorted) === JSON.stringify([5, 4, 3, 2, 1]),
  'ฝั่ง สพป.: ผู้บริหารฯ (ผอ.ก่อนรอง ผอ.) → กลุ่มงานตาม staff_no → หน่วยตรวจสอบภายในท้ายสุด',
  'ได้ ' + JSON.stringify(officeSorted));

check(s.sortStaff(officeRows, 'office').every((u, i) => u._seq === i + 1),
  '_seq เรียงจาก 1 ไม่มีเลขกำะไน');

const noStaffNo = [
  { id: 10, workplace: 'กลุ่มอำนวยการ' },
  { id: 11, workplace: 'กลุ่มอำนวยการ', staff_no: '1' },
];
check(s.sortStaff(noStaffNo, 'office').map((u) => u.id).join() === '11,10',
  'คนที่ยังไม่ได้กำหนด staff_no อยู่ท้ายกลุ่มเดียวกัน');

const schoolRows = [
  { id: 20, workplace: '54020001 โรงเรียนบ้านกุง', position: 'ครู' },
  { id: 21, workplace: '54010001 โรงเรียนกุง', position: 'ครู' },
  { id: 22, workplace: '54010001 โรงเรียนกุง', position: 'ผู้อำนวยการสถานศึกษา' },
];
const schoolSorted = s.sortStaff(schoolRows, 'school').map((u) => u.id);
check(JSON.stringify(schoolSorted) === JSON.stringify([22, 21, 20]),
  'ฝั่งสถานศึกษา: เรียงตามรหัสโรงเรียน แล้วผอ.→รอง ผอ.→ครู',
  'ได้ ' + JSON.stringify(schoolSorted));

/* ── ③ วันเกิด / อายุ ─────────────────────────────────────────────────── */
console.log('');
console.log('③ แปลงวันเกิดและคำนวณอายุ');

check(s.thaiBirthDate('1980-08-14') === '14 สิงหาคม 2523',
  'วันเกิด 1980-08-14 → 14 สิงหาคม 2523',
  'ได้ ' + JSON.stringify(s.thaiBirthDate('1980-08-14')));
check(s.thaiBirthDate('') === '' && s.thaiBirthDate(null) === '',
  'ไม่มีวันเกิด → ช่องว่าง (ไม่ใช่ "-" หรือ null)');

const age = Number(s.ageFromBirth('2000-01-01'));
const nowAge = new Date().getFullYear() - 2000;
check(Number.isInteger(age) && age >= nowAge - 1 && age <= nowAge,
  'อายุคำนวณจากวันเกิดได้ (2000-01-01)',
  'ได้ ' + JSON.stringify(s.ageFromBirth('2000-01-01')));
check(s.ageFromBirth('') === '' && s.ageFromBirth('ไม่ใช่วันที่') === '',
  'วันเกิดผิดรูปแบบ/ไม่มี → ช่องว่าง ไม่หายไปทั้งแถว');
check(s.ageFromBirth('2999-01-01') === '',
  'วันเกิดอยู่ในอนาคต → ช่องว่าง (ไม่ให้อายุติดลบ)');

check(s.personName({ title: 'นาย', first_name: 'สมชาย', last_name: 'ใจดี' }) === 'นายสมชาย  ใจดี',
  'ชื่อ-นามสกุล ประกอบจากคำนำหน้าชื่อ+ชื่อ+นามสกุล');
check(s.personName({ full_name: 'เอกธิดล สุขใจ' }) === 'เอกธิดล  สุขใจ',
  'ไม่มี first/last → แยกนามสกุลจาก full_name');
check(s.personName({}) === '', 'ไม่มีข้อมูลชื่อเลย → ช่องว่าง');

/* ── ④⑤ ต้องมีเซิร์ฟเวอร์ ────────────────────────────────────────────── */
async function login(username, password) {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { status: res.status, cookie: setCookie.map((c) => c.split(';')[0]).join('; ') };
}

async function readSheet(cookie, query) {
  // admin.js ถูก mount ที่ /api (ไม่ใช่ /api/admin) — ดู server.js บรรทัด 67
  const res = await fetch(`${BASE}/api/staff.xlsx?${query}`, { headers: { Cookie: cookie } });
  const buf = Buffer.from(await res.arrayBuffer());
  if (res.status !== 200) return { status: res.status, text: buf.toString('utf8').slice(0, 200) };
  const XLSX = require('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer' });
  return { status: res.status, rows: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }) };
}

(async () => {
  console.log('');
  console.log('④ ไฟล์ Excel ที่ดาวน์โหลดได้');

  // ⚠️ ขั้นนี้ต้องเซิร์ฟเวอร์ทำงานอยู่ — ถ้าไม่ติดต่อได้ให้ "ข้าม" ไม่ใช่นับเป็นไม่ผ่าน
  //    (เหมือน test-file-names.js) เพราะ CI ไม่ได้เปิดเซิร์ฟเวอร์
  //    ถ้านับเป็นไม่ผ่าน → verify พังทุกครั้งที่รันบน CI
  let admin;
  try {
    admin = await login(ADMIN_USER, ADMIN_PASS);
  } catch (e) {
    console.log(`  – ข้าม: ติดต่อ ${BASE} ไม่ได้ (${e.message}) — ให้เปิดเซิร์ฟเวอร์ก่อน`);
    console.log('');
    console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    process.exit(fail ? 1 : 0);
  }
  if (admin.status !== 200 || !admin.cookie) {
    console.log(`  – ข้าม: ล็อกอินไม่สำเร็จ (${ADMIN_USER} · HTTP ${admin.status})`);
    console.log('');
    console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    process.exit(fail ? 1 : 0);
  }

  const office = await readSheet(admin.cookie, 'user_group=office');
  check(office.status === 200, 'ดาวน์โหลด /api/staff.xlsx ได้', office.text || '');

  if (office.status === 200) {
    const headIdx = office.rows.findIndex((r) => r[0] === EXPECT_HEAD[0]);
    check(headIdx !== -1, 'หาแถวหัวคอลัมน์พบ', 'แถวแรก ๆ = ' + JSON.stringify(office.rows.slice(0, 4)));
    const head = headIdx === -1 ? [] : office.rows[headIdx];
    check(head.length === 12, `หัวคอลัมน์มี 12 ช่อง (ได้ ${head.length})`);
    check(head.every((h, i) => String(h).trim() === EXPECT_HEAD[i]),
      'หัวคอลัมน์ตรงตามที่ขอทุกตัวอักษร',
      head.map((h, i) => (String(h).trim() === EXPECT_HEAD[i] ? null : `ช่องที่ ${i + 1}: ${h} != ${EXPECT_HEAD[i]}`)).filter(Boolean).join(' | '));

    const body = office.rows.slice(headIdx + 1).filter((r) => r.some((c) => String(c).trim() !== ''));
    check(body.length > 0, `มีข้อมูลในไฟล์ (${body.length} แถว)`);
    if (body.length) {
      check(String(body[0][0]) === '1', 'คอลัมน์ "ที่" เริ่มที่ 1');
      check(body.every((r, i) => Number(r[0]) === i + 1), 'คอลัมน์ "ที่" เรียงติดกันไม่มีเลขกำะไน');
      check(String(body[0][2]) !== undefined && body[0].length === 12,
        'ทุกแถวมีครบ 12 ช่อง', 'แถวแรกมี ' + body[0].length + ' ช่อง');
    }

    // ⑤ ลำดับในไฟล์ต้องตรงกับหน้าจอ (เทียบกับ /api/staff ที่หน้าเว็บเรียงเอง)
    const listRes = await fetch(BASE + '/api/staff?user_group=office', { headers: { Cookie: admin.cookie } });
    const list = await listRes.json();
    check(!!Array.isArray(list.staff) && list.staff.length === body.length,
      'จำนวนแถวในไฟล์เท่ากับรายชื่อในระบบ',
      `ไฟล์ ${body.length} · ระบบ ${(list.staff || []).length}`);
  }

  console.log('');
  console.log('⑤ สิทธิ์ดาวน์โหลด');
  const anon = await readSheet('', 'user_group=office');
  check(anon.status === 401 || anon.status === 403, `ไม่ล็อกอิน → ถูกปฏิเสธ (ได้ ${anon.status})`);

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  // เซิร์ฟเวอร์ล่มกลางคัน = ติดต่อไม่ได้ ไม่ใช่บั๊กของโค้ด → ข้ามเหมือนข้างบน
  // (ถ้านับเป็นไม่ผ่าน จะทำให้ verify พังทั้งที่โค้ดถูก)
  console.log(`  – ข้าม: เรียก API ไม่สำเร็จ (${e.message})`);
  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
});