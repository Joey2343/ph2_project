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
 * อันดับตำแหน่ง **ภายในกลุ่มงานเดียวกัน** — เลขยิ่งน้อยยิ่งขึ้นก่อน
 *
 * ลำดับที่ต้องการ (ผู้ใช้กำหนด):
 *   0 ผู้อำนวยการ            เช่น ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2
 *   1 รองผู้อำนวยการ
 *   2 ผู้อำนวยการกลุ่ม/หน่วย  ← ขึ้นเป็นคนแรกของกลุ่มงานนั้น
 *   3 ปฏิบัติหน้าที่ผู้อำนวยการกลุ่ม  (รักษาการแทนผู้อำนวยการกลุ่ม จึงตามมา)
 *   4 ตำแหน่งอื่น ๆ            เรียงตามเลขกำกับ
 *
 * ⚠️ ต้องเช็ค "รองผู้อำนวยการ" ก่อน "ผู้อำนวยการ" เสมอ
 *    เพราะ String.startsWith('ผู้อำนวยการ') จะไปเข้าทั้งสองคำ
 *    (ถ้าสลับลำดับ → รองผู้อำนวยการจะถูกจัดเป็นผู้อำนวยการ แล้วขึ้นมาก่อนผู้อำนวยการจริง)
 */
function positionRank(position) {
  const s = String(position || '').trim();
  if (!s) return 4;
  if (s.startsWith('รองผู้อำนวยการ')) return 1;
  if (s.startsWith('ผู้อำนวยการกลุ่ม')) return 2;
  if (s.startsWith('ปฏิบัติหน้าที่ผู้อำนวยการกลุ่ม')) return 3;
  if (s.startsWith('ผู้อำนวยการ')) return 0;
  return 4;
}

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
    /*
     * ⚠️ กลุ่มที่ไม่อยู่ใน WORKPLACES ต้องไปท้ายสุด ไม่ใช่อันดับ 0
     *
     *   เคยเขียนเป็น  1 + mids.indexOf(w)
     *   indexOf คืน -1 ตอนไม่เจอ → 1 + (-1) = 0
     *   → ได้อันดับเท่ากับ "ผู้บริหารการศึกษา" พอดี
     *   → เจ้าหน้าที่สถานศษาที่ workplace เป็น "54020001 บ้านน้ำริน (…)"
     *     จะโผล่เป็นคนแรก ทั้งที่ควรอยู่ท้ายสุด
     *   (เจอจริงใน /api/vehicle/approvers ที่ไม่ได้กรอง user_group)
     */
    const wpRank = (w) => {
      if (w === 'ผู้บริหารการศึกษา') return 0;
      if (w === 'หน่วยตรวจสอบภายใน') return 999;
      const i = mids.indexOf(w);
      return i === -1 ? 998 : 1 + i;
    };
    const staffNo = (u) => {
      const n = parseInt(u.staff_no, 10);
      return isNaN(n) ? 9999 : n;
    };
    out.sort((a, b) => {
      const wa = wpRank(a.workplace || '');
      const wb = wpRank(b.workplace || '');
      if (wa !== wb) return wa - wb;
      // ภายในกลุ่มงานเดียวกัน → เรียงตามตำแหน่งก่อน แล้วค่อยเรียงตามเลขกำกับ
      const pa = positionRank(a.position);
      const pb = positionRank(b.position);
      if (pa !== pb) return pa - pb;
      return staffNo(a) - staffNo(b) || a.id - b.id;
    });
  } else {
    // สถานศึกษา: เรียงตามเลขรหัสสถานศึกษา (น้อย→มาก) แล้วตามตำแหน่ง
    out.sort((a, b) => compareSchool(a, b) || a.id - b.id);
  }
  return out.map((u, i) => ({ ...u, _seq: i + 1 }));
}

/**
 * อันดับตำแหน่งของ **สถานศึกษา**
 *
 * 0 ผู้อำนวยการสถานศึกษา → 1 รองผู้อำนวยการสถานศึกษา → 2 ครู
 * → 3 เจ้าหน้าที่ธุรการ → 4 อื่น ๆ
 *
 * ⚠️ ต้องเช็ค "รองผู้อำนวยการ" ก่อน "ผู้อำนวยการ" เสมอ
 *    เพราะ startsWith('ผู้อำนวยการ') ไปเข้าทั้งสองคำ
 *    (ถ้าสลับ → รองผู้อำนวยการจะขึ้นก่อนผู้อำนวยการ ซึ่งผิด)
 *
 * ข้อดีของการใช้ startsWith('ผู้อำนวยการ') แทนข้อความเต็ม
 * → ข้อมูลเก่าที่เก็บเป็น "ผู้อำนวยการ" ลอย ๆ (ไม่มีคำว่า "สถานศึกษา")
 *   ยังถูกจัดเป็นอันดับ 0 ไม่หลุดไปอยู่ท้ายสุด
 *   (เดิมเช็คเต็มว่า "ผู้อำนวยการสถานศึกษา" → ถ้าไม่ตรงจะได้ 4 = ท้ายสุด ซึ่งผิด)
 */
function schoolPositionRank(position) {
  const s = String(position || '').trim();
  if (!s) return 4;
  if (s.startsWith('รองผู้อำนวยการ')) return 1;
  if (s.startsWith('ผู้อำนวยการ')) return 0;
  if (s.startsWith('ครู')) return 2;
  if (s.startsWith('เจ้าหน้าที่ธุรการ')) return 3;
  return 4;
}

/**
 * หารหัสสถานศึกษาของเจ้าหน้าที่ 1 คน — คืน '' ถ้าไม่มี
 *
 * ไล่หาจาก 3 ที่ ตามลำดับความน่าเชื่อถือ:
 *   ① school_code     คอลัมน์ที่ระบบตั้งไว้เฉพาะสถานศึกษา (ข้อมูลสะอาดที่สุด)
 *   ② workplace       "54020001 บ้านน้ำริน (…)" → เลขนำหน้าคือรหัส
 *   ③ current_school  ใช้ตอนส่งหนังสือ รูปแบบเดียวกับ workplace
 *
 * ⚠️ เดิมอ่านจาก workplace อย่างเดียว
 *    ถ้าข้อมูลไม่ได้เริ่มด้วยเลข → ได้ '99999999' ทุกคน
 *    แล้วไปกองอยู่ท้ายสุดปนกันหลายโรงเรียน (ดูเหมือนรหัสไม่เรียง)
 */
function schoolCodeOf(u) {
  if (!u) return '';
  const fromCol = String(u.school_code || '').trim();
  if (/^\d{6,10}$/.test(fromCol)) return fromCol;
  const fromWorkplace = String(u.workplace || '').match(/^(\d{6,10})/);
  if (fromWorkplace) return fromWorkplace[1];
  const fromCurrent = String(u.current_school || '').match(/^(\d{6,10})/);
  return fromCurrent ? fromCurrent[1] : '';
}

/**
 * เทียบสองคนฝั่งสถานศึกษา — คืน <0 / 0 / >0
 *
 * เรียงตามเลขรหัสสถานศึกษาจริง (54010001 < 54020001 < 54120001)
 * แล้วจึงเรียงตามอันดับตำแหน่ง
 * คนที่ไม่มีรหัสสถานศึกษา → ท้ายสุด (แยกออกจากโรงเรียนที่มีรหัส)
 */
function compareSchool(a, b) {
  const ca = schoolCodeOf(a);
  const cb = schoolCodeOf(b);
  if (ca !== cb) {
    if (!ca) return 1;          // ไม่มีรหัส → ท้ายสุด
    if (!cb) return -1;
    const na = Number(ca);
    const nb = Number(cb);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb; // เรียงตามค่าตัวเลข
    return ca.localeCompare(cb);
  }
  return schoolPositionRank(a.position) - schoolPositionRank(b.position);
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

module.exports = {
  WORKPLACES,
  positionRank,
  schoolPositionRank,
  schoolCodeOf,
  compareSchool,
  sortStaff,
  thaiBirthDate,
  ageFromBirth,
  personName,
};