/**
 * ค่าคงที่และฟังก์ชันบริสุทธิ์ของหนังสือราชการ
 *
 * ย้ายออกจาก src/views/DocumentsView.js เพราะ:
 *   1. `<script setup>` ของ Vue export ค่าข้าม component ไม่ได้
 *   2. DocumentsPage.vue ต้องใช้ docTypeMeta() ตอน render ตาราง
 *      ถ้ายังพึ่ง DocumentsView ก็ยังผูก Vue กับโค้ด legacy
 *   3. ฟังก์ชันเหล่านี้ไม่มี side effect จึงทดสอบ/ใช้ซ้ำได้อิสระจาก DOM
 */

/* ---------- ประเภทหนังสือ ---------- */
const DOC_TYPES = {
  incoming: { label: '▼ หนังสือรับ', short: '▼ หนังสือรับ' },
  outgoing: { label: '▲ หนังสือส่ง', short: '▲ หนังสือส่ง' },
  incoming_reg: { label: '▭ ทะเบียนหนังสือรับ', short: '▭ ทะเบียนรับ' },
  outgoing_reg: { label: '▭ ทะเบียนหนังสือส่ง', short: '▭ ทะเบียนส่ง' },
  order: { label: '▭ ทะเบียนคำสั่ง', short: '▭ คำสั่ง' },
  certificate: { label: '▭ ทะเบียนหนังสือรับรอง', short: '▭ รับรอง' },
  honor: { label: '▭ ทะเบียนเกียรติบัตร', short: '▭ เกียรติบัตร' },
};

/**
 * ข้อมูลประเภทหนังสือ
 * @param {string} type
 * @returns {{label: string, short: string}}
 */
export function docTypeMeta(type) {
  return DOC_TYPES[type] || { label: type, short: type };
}

/* ---------- ที่อยู่สำนักงานบนแบบฟอร์มหนังสือรับรอง ---------- */
export const CERT_OFFICE_NAME = 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2';
export const CERT_OFFICE_ADDR = '234 หมู่ 14 ตำบลห้วยอ้อ อำเภอลอง';
export const CERT_OFFICE_ADDR2 = 'จังหวัดแพร่ 54150';

/* ---------- เดือนแบบไทย ---------- */
export const TH_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

export const TH_M_ABBR = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

export const pad2 = (n) => (n < 10 ? '0' : '') + n;

/* ---------- ชุดคอลัมน์ตอนส่งออก Excel ---------- */
/** ลำดับตามตารางจริงของแต่ละแท็บ (ไม่รวมคอลัมน์ปุ่มจัดการ) */
export const EXPORT_COLS = {
  incoming: [
    ['is_read', 'สถานะ'], ['doc_no', 'เลขที่หนังสือ'], ['title', 'เรื่อง'],
    ['from_org', 'จาก'], ['to_org', 'ถึง'], ['date', 'วันที่'], ['file', 'ไฟล์แนบ'],
  ],
  incoming_reg: [
    ['reg_no', 'เลขหนังสือรับ'], ['doc_no', 'เลขที่หนังสือ'], ['title', 'เรื่อง'],
    ['from_org', 'จาก'], ['workgroup', 'กลุ่มปฏิบัติ'], ['date', 'วันที่'], ['file', 'ไฟล์แนบ'],
  ],
  outgoing: [
    ['recipients', 'ผู้รับ'], ['doc_no', 'เลขที่หนังสือ'], ['title', 'เรื่อง'],
    ['from_org', 'จาก'], ['to_org', 'ถึง'], ['date', 'วันที่'], ['file', 'ไฟล์แนบ'],
  ],
  outgoing_reg: [
    ['doc_no', 'เลขที่หนังสือ'], ['title', 'เรื่อง'], ['to_org', 'ถึง'],
    ['workgroup', 'กลุ่มปฏิบัติ'], ['date', 'วันที่'], ['file', 'ไฟล์แนบ'],
  ],
  order: [
    ['doc_no', 'เลขที่คำสั่ง'], ['date', 'สั่ง ณ วันที่'], ['title', 'เรื่อง'],
    ['owner_group', 'เจ้าของคำสั่ง'], ['order_registrar', 'ผู้ลงทะเบียน'], ['file', 'ไฟล์แนบ'],
  ],
  certificate: [
    ['cert_status', 'สถานะ'], ['doc_no', 'เลขที่หนังสือ'], ['date', 'วันที่'], ['title', 'เรื่อง'],
    ['requester', 'ผู้ขอ'], ['cert_position', 'ตำแหน่ง'], ['officer', 'เจ้าหน้าที่(ผู้ปฏิบัติ)'], ['file', 'ไฟล์แนบ'],
  ],
  honor: [
    ['doc_no', 'เลขเกียรติบัตร'], ['person', 'ชื่อ-นามสกุล, โรงเรียน ฯลฯ'], ['title', 'เรื่อง'],
    ['date', 'วันที่'], ['signer_name', 'ผู้ลงนาม'], ['file', 'ไฟล์แนบ'],
  ],
};

export const EXPORT_COLS_DEFAULT = [
  ['doc_no', 'เลขที่หนังสือ'], ['title', 'เรื่อง'], ['from_org', 'จาก'], ['to_org', 'ถึง'], ['date', 'วันที่'],
];

/** คอลัมน์ export ของแท็บที่ระบุ (มีค่า default ถ้าไม่รู้จักประเภทนั้น) */
export function exportColsFor(type) {
  return EXPORT_COLS[type] || EXPORT_COLS_DEFAULT;
}

/* ---------- URL รายการเอกสารตามแท็บ ---------- */
/**
 * endpoint ของแต่ละแท็บ
 *
 * ต้องตรงกับ URL ที่ DocumentsPage.vue ใช้โหลดตาราง ไม่งั้น export จะได้ข้อมูลไม่ตรงกับที่เห็นบนจอ
 */
export const LIST_ENDPOINT = {
  incoming: '/my-incoming',
  incoming_reg: '/my-incoming-registered',
  outgoing_reg: '/my-outgoing-registered',
  order: '/my-orders',
  certificate: '/my-certificates',
  honor: '/my-honors',
};

/** endpoint รายการเอกสารของแท็บ (รองรับ doc_type สำหรับ outgoing และ fallback) */
export function listUrlFor(type, qs = []) {
  const q = qs.length ? '?' + qs.join('&') : '';
  const ep = LIST_ENDPOINT[type];
  if (ep) return ep + q;
  // outgoing ใช้ /documents เพราะเป็นรายการที่ส่งออกเอง (ไม่ใช่กล่องขาเข้า)
  const extra = qs.length ? qs.join('&') + '&' : '';
  return '/documents?' + extra + 'doc_type=' + encodeURIComponent(type);
}

/* ---------- การแยกไฟล์แนบ ---------- */
/**
 * ค่าในคอลัมน์ file เป็น JSON array หรือ path เดี่ยว — ให้ array เสมอ
 * @param {string|Array} file
 * @returns {string[]}
 */
export function parseFiles(file) {
  if (!file) return [];
  if (Array.isArray(file)) return file;
  try {
    const arr = JSON.parse(file);
    return Array.isArray(arr) ? arr : [file];
  } catch {
    return [file];
  }
}

/** แค่ชื่อไฟล์ (ไม่เอาพาธ) คั่นด้วยจุลภาค ใช้ตอน export เป็น Excel */
export function fileNamesText(file) {
  return parseFiles(file)
    .map((p) => String(p).split('/').pop())
    .join(', ');
}
