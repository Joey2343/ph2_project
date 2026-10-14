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

/* ── ②b ผู้อำนวยการกลุ่ม/หน่วย ต้องขึ้นเป็นคนแรกในกลุ่มงานนั้น ───────── */
console.log('');
console.log('②b ผู้อำนวยการกลุ่ม/หน่วย ขึ้นเป็นคนแรกของกลุ่มงาน');

const DIR = 'ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2';
const DEPUTY = 'รองผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2';
const GROUP_DIR = 'ผู้อำนวยการกลุ่ม/หน่วย';
const ACTING = 'ปฏิบัติหน้าที่ผู้อำนวยการกลุ่ม';

check(s.positionRank(DIR) === 0, 'ผู้อำนวยการ อันดับ 0 (สูงสุด)');
check(s.positionRank(DEPUTY) === 1, 'รองผู้อำนวยการ อันดับ 1');
check(s.positionRank(GROUP_DIR) === 2, 'ผู้อำนวยการกลุ่ม/หน่วย อันดับ 2');
check(s.positionRank(ACTING) === 3, 'ปฏิบัติหน้าที่ผู้อำนวยการกลุ่ม อันดับ 3 (ตามหัวผู้อำนวยการกลุ่ม)');
check(s.positionRank('นักวิเคราะห์นโยบายและแผน') === 4, 'ตำแหน่งอื่น อันดับ 4');
check(s.positionRank('') === 4 && s.positionRank(null) === 4, 'ไม่มีตำแหน่ง → อันดับ 4 (ไม่ใช่ error)');

check(s.positionRank(DEPUTY) > s.positionRank(DIR),
  'รองผู้อำนวยการต้องอยู่หลังผู้อำนวยการเสมอ',
  "เคยพังเพราะ startsWith('ผู้อำนวยการ') ไปเข้าทั้งสองคำ");
check(s.positionRank(GROUP_DIR) > s.positionRank(DEPUTY),
  'ผู้อำนวยการกลุ่ม/หน่วย ต้องอยู่หลังรองผู้อำนวยการ');
check(s.positionRank(ACTING) > s.positionRank(GROUP_DIR),
  'ปฏิบัติหน้าที่ผู้อำนวยการกลุ่ม ต้องอยู่หลังผู้อำนวยการกลุ่ม/หน่วย');

// กลุ่มงานธรรมดา: ผู้อำนวยการกลุ่ม/หน่วย ต้องขึ้นก่อนแม้เลขกำกับจะใหญ่กว่า
const withGroupDir = [
  { id: 30, workplace: 'กลุ่มบริหารงานบุคคล', position: 'นักทรัพยากรบุคคล', staff_no: '3' },
  { id: 31, workplace: 'กลุ่มบริหารงานบุคคล', position: 'นักวิชาการศึกษา', staff_no: '1' },
  { id: 32, workplace: 'กลุ่มบริหารงานบุคคล', position: GROUP_DIR, staff_no: '7' },
];
const gdir = s.sortStaff(withGroupDir, 'office').map((u) => u.id);
check(JSON.stringify(gdir) === JSON.stringify([32, 31, 30]),
  'กลุ่มบริหารงานบุคคล: ผู้อำนวยการกลุ่ม/หน่วย ขึ้นก่อน แม้ staff_no จะใหญ่กว่า',
  'ได้ ' + JSON.stringify(gdir));
check(s.sortStaff(withGroupDir, 'office').every((u, i) => u._seq === i + 1),
  'กลุ่มงานที่มีผู้อำนวยการกลุ่ม/หน่วย _seq ยังเรียงติดกัน');

// กฎนี้ใช้กับทุกกลุ่ม ไม่ใช่แค่กลุ่มผู้บริหารฯ
const everyGroup = [
  { id: 40, workplace: 'กลุ่มนโยบายและแผน', position: 'นักวิเคราะห์นโยบายและแผน', staff_no: '1' },
  { id: 41, workplace: 'กลุ่มนโยบายและแผน', position: GROUP_DIR, staff_no: '5' },
  { id: 42, workplace: 'กลุ่มกฎหมายและคดี', position: 'นิติกร', staff_no: '1' },
  { id: 43, workplace: 'กลุ่มกฎหมายและคดี', position: GROUP_DIR, staff_no: '5' },
];
const eg = s.sortStaff(everyGroup, 'office');
check(eg.findIndex((u) => u.id === 41) < eg.findIndex((u) => u.id === 40),
  'ใช้กับทุกกลุ่มงาน ไม่ใช่แค่กลุ่มผู้บริหารฯ (กลุ่มนโยบายและแผน)');
check(eg.findIndex((u) => u.id === 43) < eg.findIndex((u) => u.id === 42),
  'ใช้กับทุกกลุ่มงาน (กลุ่มกฎหมายและคดี)');

// ตำแหน่งที่ใช้จัดอันดับ ต้องเป็นตำแหน่งที่ระบบให้เลือกได้จริง
console.log('');
console.log('②c ตำแหน่งที่ใช้จัดอันดับ ต้องอยู่ในรายการตำแหน่งจริง');
const mPos = constSrc.match(/POSITIONS:\s*\[([\s\S]*?)\]/);
const fePos = mPos ? [...mPos[1].matchAll(/'([^']*)'/g)].map((x) => x[1]) : [];
for (const p of [DIR, DEPUTY, GROUP_DIR, ACTING]) {
  check(fePos.includes(p), `ระบบมีตำแหน่ง "${p}" ให้เลือก`, 'ไม่พบใน CONSTANTS.POSITIONS');
}

// กลุ่มที่ไม่อยู่ในรายการ WORKPLACES ต้องไปท้ายสุด ไม่ใช่อันดับ 0
const unknownGroup = [
  { id: 50, workplace: '54020001 บ้านน้ำริน (คุรุราษฎร์ฯ)', position: 'เจ้าหน้าที่ธุรการ' },
  { id: 51, workplace: 'กลุ่มอำนวยการ', staff_no: '5' },
  { id: 52, workplace: 'หน่วยตรวจสอบภายใน', staff_no: '1' },
];
const ug = s.sortStaff(unknownGroup, 'office').map((u) => u.workplace);
check(ug[0] === 'กลุ่มอำนวยการ' && ug[ug.length - 1] === 'หน่วยตรวจสอบภายใน'
  && ug[1] === '54020001 บ้านน้ำริน (คุรุราษฎร์ฯ)',
  'กลุ่มที่ไม่อยู่ใน WORKPLACES ไปท้ายสุด (ก่อนหน่วยตรวจสอบภายใน) ไม่ใช่ขึ้นเป็นคนแรก',
  'ได้ ' + JSON.stringify(ug));

/* ── ②d ฝั่งหน้าเว็บต้องเรียงแบบเดียวกัน ──────────────────────────────── */
console.log('');
console.log('②d ฝั่งหน้าเว็บ (StaffPage.vue) ต้องเรียงเหมือนกัน');

const staffVue = fs.readFileSync(path.join(ROOT, '..', 'frontend', 'src', 'pages', 'StaffPage.vue'), 'utf8');
const mRank = staffVue.match(/function positionRank\([^)]*\)\s*\{([\s\S]*?)\n\}/);
check(!!mRank, 'StaffPage.vue มีฟังก์ชัน positionRank()');
if (mRank) {
  // เทียบลำดับการตรวจเงื่อนไข — สลับลำดับแล้วรองผู้อำนวยการจะขึ้นก่อนผู้อำนวยการจริง
  const rules = [
    ["s.startsWith('รองผู้อำนวยการ')) return 1;", 'รองผอ.→1'],
    ["s.startsWith('ผู้อำนวยการกลุ่ม')) return 2;", 'ผอ.กลุ่ม→2'],
    ["s.startsWith('ปฏิบัติหน้าที่ผู้อำนวยการกลุ่ม')) return 3;", 'ปฏิบัติหน้าที่→3'],
    ["s.startsWith('ผู้อำนวยการ')) return 0;", 'ผอ.→0'],
  ];
  const found = rules.filter(([code]) => mRank[1].includes(code)).map(([, label]) => label);
  check(found.join('|') === 'รองผอ.→1|ผอ.กลุ่ม→2|ปฏิบัติหน้าที่→3|ผอ.→0',
    'ลำดับการตรวจเงื่อนไขตรงกับ backend (รอง ผอ. ต้องมาก่อน ผอ.)',
    'ได้: ' + found.join(' | '));
  check(/!s\s*\)\s*return 4;/.test(mRank[1]), 'ไม่มีตำแหน่ง → 4 เหมือน backend');
}
check(/positionRank\(a\.position\)/.test(staffVue) && /positionRank\(b\.position\)/.test(staffVue),
  'sortStaff() เรียงด้วย positionRank ใน comparator');
check(!/=== 'ผู้บริหารการศึกษา'\s*\)[\s\S]{0,200}position/.test(staffVue),
  'ไม่มีการจัดอันดับตำแหน่งเฉพาะกลุ่มผู้บริหารฯ แล้ว (ใช้กับทุกกลุ่ม)');

/* ── ②e ฝั่งสถานศึกษา ─────────────────────────────────────────────────── */
console.log('');
console.log('②e ฝั่งสถานศึกษา: เรียงตามเลขรหัส แล้วตามตำแหน่ง');

const SDIR = 'ผู้อำนวยการสถานศึกษา';
const SDEPUTY = 'รองผู้อำนวยการสถานศึกษา';
const STEA = 'ครู';
const SCLERK = 'เจ้าหน้าที่ธุรการ';

check(s.schoolPositionRank(SDIR) === 0, 'ผู้อำนวยการสถานศึกษา → 0');
check(s.schoolPositionRank(SDEPUTY) === 1, 'รองผู้อำนวยการสถานศึกษา → 1');
check(s.schoolPositionRank(STEA) === 2, 'ครู → 2');
check(s.schoolPositionRank(SCLERK) === 3, 'เจ้าหน้าที่ธุรการ → 3');
check(s.schoolPositionRank('') === 4, 'ไม่มีตำแหน่ง → 4');
check(s.schoolPositionRank('ผู้อำนวยการ') === 0,
  'ข้อมูลเก่าที่เป็น "ผู้อำนวยการ" ลอย ๆ ยังเป็นอันดับ 0',
  'เดิมเช็คเต็ม "ผู้อำนวยการสถานศึกษา" → ไม่ตรงจะได้ 4 = ท้ายสุด (ผิด)');
check(s.schoolPositionRank(SDEPUTY) > s.schoolPositionRank(SDIR),
  'รองผู้อำนวยการสถานศึกษา ต้องอยู่หลังผู้อำนวยการสถานศึกษา',
  "เคยพังเพราะ startsWith('ผู้อำนวยการ') ไปเข้าทั้งสองคำ");

// หารหัสสถานศึกษา: ต้องหาได้จาก 3 ที่
check(s.schoolCodeOf({ school_code: '54020001', workplace: '54030001 อื่น' }) === '54020001',
  'ใช้ school_code เป็นอันดับแรก (ข้อมูลสะอาดที่สุด)');
check(s.schoolCodeOf({ workplace: '54020001 บ้านน้ำริน (คุรุราษฎร์ฯ)' }) === '54020001',
  'ไม่มี school_code → ตัดเลขนำหน้าจาก workplace');
check(s.schoolCodeOf({ workplace: '', current_school: '54040001 บ้านข่าย' }) === '54040001',
  'workplace ไม่มี → ใช้ current_school เป็นตัวสำรอง');
check(s.schoolCodeOf({ workplace: 'โรงเรียนบ้านกุง' }) === '',
  'ไม่มีรหัสเลย → คืนค่าว่าง (ไม่ใช่ 99999999 ที่ชนกันเอง)');
check(s.schoolCodeOf(null) === '' && s.schoolCodeOf({}) === '', 'ไม่มีข้อมูลเลย → ค่าว่าง ไม่ error');

// เรียงตามเลขรหัสจริง (น้อย → มาก) และตามตำแหน่งภายในโรงเรียนเดียว
let sid = 0;
const S = (workplace, position, school_code) => ({ id: ++sid, workplace, position, school_code });
const schoolRows2 = [
  S('54020001 บ้านน้ำริน', STEA, '54020001'),
  S('54020001 บ้านน้ำริน', SCLERK, '54020001'),
  S('54020001 บ้านน้ำริน', SDIR, '54020001'),
  S('54020001 บ้านน้ำริน', SDEPUTY, '54020001'),
  S('54010001 เขตเมือง', STEA, '54010001'),
  S('54010001 เขตเมือง', SDIR, '54010001'),
  S('54120001 รองชัยมีมา', STEA, '54120001'),
];
const ss = s.sortStaff(schoolRows2, 'school');
check(ss.map((u) => u.school_code).join(',') === '54010001,54010001,54020001,54020001,54020001,54020001,54120001',
  'เรียงสถานศึกษาตามเลขน้อยไปมาก (54010001 → 54020001 → 54120001)',
  'ได้ ' + ss.map((u) => u.school_code).join(','));
check(ss[0].position === SDIR && ss[1].position === STEA,
  'โรงเรียนแรก: ผู้อำนวยการสถานศึกษา ก่อนครู');
check(ss[2].position === SDIR && ss[3].position === SDEPUTY && ss[4].position === STEA && ss[5].position === SCLERK,
  'โรงเรียนที่สอง: ผอ. → รอง ผอ. → ครู → เจ้าหน้าที่ธุรการ',
  'ได้ ' + ss.slice(2, 6).map((u) => u.position).join(' , '));
check(ss.every((u, i) => u._seq === i + 1), '_seq เรียงติดกัน ไม่มีเลขกำะไน');

// ไม่มีรหัสสถานศึกษา → ท้ายสุด แต่ยังเรียงตามตำแหน่งของตัวเอง
const noCodeSchool = [
  S('โรงเรียนบ้านกุง', STEA),
  S('โรงเรียนบ้านกุง', SDIR),
  S('54010001 เขตเมือง', STEA, '54010001'),
];
const ncs = s.sortStaff(noCodeSchool, 'school');
check(ncs[0].school_code === '54010001',
  'โรงเรียนที่มีรหัส ต้องมาก่อนคนที่ไม่มีรหัส',
  'ได้ ' + ncs.map((u) => u.school_code || '(ไม่มีรหัส)').join(' , '));
check(ncs[1].position === SDIR && ncs[2].position === STEA,
  'คนที่ไม่มีรหัส ยังเรียงตามตำแหน่งของตัวเอง',
  'ได้ ' + ncs.slice(1).map((u) => u.position).join(' , '));

// ตำแหน่งสถานศึกษาต้องอยู่ในรายการจริง
const mSPos = constSrc.match(/SCHOOL_POSITIONS:\s*\[([\s\S]*?)\]/);
const feSPos = mSPos ? [...mSPos[1].matchAll(/'([^']*)'/g)].map((x) => x[1]) : [];
for (const p of [SDIR, SDEPUTY, STEA, SCLERK]) {
  check(feSPos.includes(p), `SCHOOL_POSITIONS มี "${p}"`, 'ไม่พบใน CONSTANTS.SCHOOL_POSITIONS');
}

// ฝั่งหน้าเว็บต้องตรงกัน
const mSRank = staffVue.match(/function schoolPositionRank\([^)]*\)\s*\{([\s\S]*?)\n\}/);
check(!!mSRank, 'StaffPage.vue มีฟังก์ชัน schoolPositionRank()');
if (mSRank) {
  const rules = [
    ["s.startsWith('รองผู้อำนวยการ')) return 1;", 'รองผอ.→1'],
    ["s.startsWith('ผู้อำนวยการ')) return 0;", 'ผอ.→0'],
    ["s.startsWith('ครู')) return 2;", 'ครู→2'],
    ["s.startsWith('เจ้าหน้าที่ธุรการ')) return 3;", 'เจ้าหน้าที่ธุรการ→3'],
  ];
  const found = rules.filter(([code]) => mSRank[1].includes(code)).map(([, l]) => l);
  check(found.join('|') === 'รองผอ.→1|ผอ.→0|ครู→2|เจ้าหน้าที่ธุรการ→3',
    'ลำดับการตรวจเงื่อนไขตรงกับ backend', 'ได้: ' + found.join(' | '));
}
const feCodeOf = staffVue.match(/function schoolCodeOf\([^)]*\)\s*\{([\s\S]*?)\n\}/);
check(!!feCodeOf && /school_code/.test(feCodeOf[1]),
  'StaffPage.vue อ่านรหัสสถานศึกษาจาก school_code ก่อน');
// ต้องเทียบด้วยค่าตัวเลขจริง (แปลงก่อน แล้วมีการกันค่าที่ไม่ใช่ตัวเลข)
const feCmp = staffVue.match(/function compareSchool\([^)]*\)\s*\{([\s\S]*?)\n\}/);
check(!!feCmp && /Number\.isFinite\(na\)\s*&&\s*Number\.isFinite\(nb\)/.test(feCmp[1])
  && /return na - nb;/.test(feCmp[1]),
  'เทียบรหัสสถานศึกษาแบบตัวเลขจริง ไม่ใช่ localeCompare',
  'localeCompare เปราะเมื่อความยาวรหัสไม่เท่ากัน');
check(!!feCmp && /if\s*\(\s*!ca\s*\)\s*return 1;/.test(feCmp[1]),
  'คนที่ไม่มีรหัสสถานศึกษา ถูกจัดไว้ท้ายสุด');

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