'use strict';

/**
 * ตัวช่วยเรียงลำดับรายชื่อเจ้าหน้าที่ + แปลงวันเกิดเป็น พ.ศ.
 *
 * ทำไมต้องมีไฟล์นี้
 * ─────────────
 * หน้า "เจ้าหน้าที่ในระบบ" เรียงแถวในตารางด้วย sortStaff() ที่ฝั่งหน้าเว็บ
 * (frontend/src/pages/StaffPage.vue) แต่ไฟล์ Excel ที่กดดาวน์โหลดต้องเรียง
 * ให้ตรงกับที่เห็นบนจอ ไม่งั้นคอลัมน์ "ที่" ในไฟล์จะไม่ตรงกับหมายเลขบนหน้าจอ
 *
 * กฎการเรียงเดิม (ย้ายมาจาก sortStaff เดิม 1:1 ห้ามแก้ลำดับ)
 *   ฝั่ง สพป.: ผู้บริหารการศึกษาอันดับแรก · หน่วยตรวจสอบภายในท้ายสุด
 *            กลุ่มอื่นตามลำดับใน WORKPLACES · ในกลุ่มผู้บริหารฯ ผู้อำนวยการมาก่อนรองผู้อำนวยการ
 *   ฝั่งสถานศึกษา: รหัสสถานศึกษา (น้อย→มาก) แล้วตามตำแหน่ง ผอ.→รอง ผอ.→ครู→เจ้าหน้าที่ธุรการ
 *
 * ⚠️ WORKPLACES ต้องเหมือน frontend/src/constants/index.js ทุกตัวอักษร
 *    มีตัวตรวจ (backend/scripts/test-staff-export.js) คอยเทียบให้อยู่แล้ว
 */

/**
 * กลุ่มงานของสำนักงานฯ ต้องเรียงตามลำดับนี้ (ตรงกับ CONSTANTS.WORKPLACES)
 */
const WORKPLACES = [
  'กลุ่มอำนวยการ',
  'กลุ่มนโยบายและแผน',
  'กลุ่มบริหารการเงินและสินทรัพย์',
  'กลุ่มบริหารงานบุคคล',
  'กลุ่มนิเทศติดตามและประเมินผลการจัดการศึกษา',
  'กลุ่มกฎหมายและคดี',
  'กลุ่มส่งเสริมการจัดการศึกษา',
  'หน่วยตรวจสอบภายใน',
  'กลุ่มส่งเสริมการศึกษาทางไกล เทคโนโลยีสารสนเทศฯ',
  'กลุ่มพัฒนาครูและบุคลากรทางการศึกษา',
  'ผู้บริหารการศึกษา',
];

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/**
 * เรียงรายชื่อเจ้าหน้าที่และใส่หมายเลขลำดับ (_seq) ให้ด้วย
 *
 * @param {Array<object>} rows  แถวผู้ใช้
 * @param {'office'|'school'} group
 * @returns {Array<object>} แถวใหม่ (ไม่แก้ของเดิม) พร้อม _seq เริ่มที่ 1
 */
function sortStaff(rows, group) {
  const out = (rows || []).slice();
  if (group === 'office') {
    const mids = WORKPLACES.filter(
      (w) => w !== 'ผู้บริหารการศึกษา' && w !== 'หน่วยตรวจสอบภายใน',
    );
    const wpRank = (w) =>
      w === 'ผู้บริหารการศึกษา' ? 0 : w === 'หน่วยตรวจสอบภายใน' ? 999 : 1 + mids.indexOf(w);
    const staffNo = (u) => {
      const n = parseInt(u.staff_no, 10);
      return isNaN(n) ? 9999 : n;
    };
    out.sort((a, b) => {
      const wa = wpRank(a.workplace || '');
      const wb = wpRank(b.workplace || '');
      if (wa !== wb) return wa - wb;
      if ((a.workplace || '') === 'ผู้บริหารการศึกษา') {
        const pa = (a.position || '').startsWith('ผู้อำนวยการ') && !(a.position || '').startsWith('รองผู้อำนวยการ') ? 0 : 1;
        const pb = (b.position || '').startsWith('ผู้อำนวยการ') && !(b.position || '').startsWith('รองผู้อำนวยการ') ? 0 : 1;
        if (pa !== pb) return pa - pb;
      }
      return staffNo(a) - staffNo(b) || a.id - b.id;
    });
  } else {
    const schoolCode = (u) => {
      const m = (u.workplace || '').match(/^(\d{8})/);
      return m ? m[1] : '99999999';
    };
    const posRank = (p) => {
      const s = p || '';
      if (s.startsWith('ผู้อำนวยการสถานศึกษา')) return 0;
      if (s.startsWith('รองผู้อำนวยการ')) return 1;
      if (s.startsWith('ครู')) return 2;
      if (s.startsWith('เจ้าหน้าที่ธุรการ')) return 3;
      return 4;
    };
    out.sort(
      (a, b) =>
        schoolCode(a).localeCompare(schoolCode(b)) ||
        posRank(a.position) - posRank(b.position) ||
        a.id - b.id,
    );
  }
  return out.map((u, i) => ({ ...u, _seq: i + 1 }));
}

/** แปลงวันเกิด YYYY-MM-DD (ค.ศ.) เป็น "วัน เดือน พ.ศ." เช่น 14 ตุลาคม 2512 — คืน '' ถ้าไม่มีข้อมูล */
function thaiBirthDate(d) {
  if (!d) return '';
  const parts = String(d).slice(0, 10).split('-');
  if (parts.length !== 3) return String(d);
  const m = parseInt(parts[1], 10);
  if (!(m >= 1 && m <= 12)) return String(d);
  return `${parseInt(parts[2], 10)} ${THAI_MONTHS[m - 1]} ${parseInt(parts[0], 10) + 543}`;
}

/** คำนวณอายุ (ปี) จากวันเกิด YYYY-MM-DD — คืน '' ถ้าไม่มี/ไม่ถูกต้อง */
function ageFromBirth(birth, today = new Date()) {
  if (!birth) return '';
  const m = String(birth).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const bd = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(bd.getTime()) || bd > today) return '';
  let age = today.getFullYear() - bd.getFullYear();
  const dm = today.getMonth() - bd.getMonth();
  if (dm < 0 || (dm === 0 && today.getDate() < bd.getDate())) age -= 1;
  return age >= 0 ? String(age) : '';
}

/**
 * จัดรูปแบบชื่อบุคคล — คำนำหน้าชื่อ+ชื่อ ติดกัน แล้วเว้น 2 วรรค ตามด้วยนามสกุล
 * เช่น "นายสมชาย  ใจดี"  (เครื่องหมายเว้นวรรคสองครั้งตรงกับ UI.personName ฝั่งหน้าเว็บ)
 *
 * ถ้าไม่มี first/last จะแยกจาก full_name โดยถือว่า "คำสุดท้ายคือนามสกุล"
 */
function personName(p) {
  if (!p) return '';
  const title = p.title || '';
  let first = p.first_name || '';
  let last = p.last_name || '';
  if (!first && !last && p.full_name) {
    const parts = String(p.full_name).trim().split(/\s+/);
    if (parts.length > 1) {
      last = parts.pop();
      first = parts.join(' ');
    } else {
      first = parts[0] || '';
    }
  }
  if (!first && !last) return String(p.full_name || '');
  return `${title}${first}  ${last}`.trim();
}

module.exports = { WORKPLACES, sortStaff, thaiBirthDate, ageFromBirth, personName };