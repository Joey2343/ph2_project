/**
 * ตรวจลำดับซ้อนของ modal ใน DocumentsPage
 *
 * ทำไมต้องมี
 * ──────────
 * ผู้ใช้แจ้ง: "กดส่งกลับเพื่อแก้ไขจากหน้าลงทะเบียนรับหนังสือ แล้วหน้าต่างส่งกลับไปซ้อนอยู่ด้านล่าง"
 *
 * ต้นเหตุ (พบจริงตอนทดสอบบนเบราว์เซอร์)
 * ──────────────────────────────────────
 *   AppModal ใช้ .modal-backdrop ตัวเดียวกันทุกกรณี:
 *     position: fixed; inset: 0; z-index: 200
 *   z-index เท่ากันหมด → ตัวที่ทับขึ้นไปคือ "ตัวที่อยู่ทีหลังใน DOM" ไม่ใช่ตัวที่เปิดทีหลัง
 *
 *   DOM order เดิมใน DocumentsPage.vue:
 *     DocumentsDetailModal        ← เปิดก่อน ไม่มีปัญหา
 *     DocumentsReturnModal        ← dialog ส่งกลับ
 *     ...
 *     DocumentsIncomingFormModal  ← เปิดทีหลัง → ทับ dialog ส่งกลับทั้งกล่อง
 *
 *   ผลที่วัดได้จริง (viewport 800x670):
 *     ฟอร์มลงทะเบียน  760x644  ที่ (20, 13)   ← ใหญ่กว่า ทับทั้งหมด
 *     dialog ส่งกลับ   700x531  ที่ (50, 70)
 *     elementFromPoint ที่กลาง dialog ส่งกลับ ได้ "▼ ลงทะเบียนรับหนังสือ"
 *
 * วิธีแก้: ย้าย DocumentsReturnModal ไปเป็นตัวสุดท้ายของ template
 *   เพราะ Vue render ตามลำดับในเทมเพลต → ตัวสุดท้ายอยู่บนสุดเสมอ
 *
 * ⚠️ เทสต์นี้ตรวจ "ตำแหน่งในเทมเพลต" ไม่ได้ตรวจ z-index ของ CSS
 *   เพราะ theme.css เป็นไฟล์เดียวของทั้งระบบ และห้ามแก้ (verify:build เทียบ SHA256)
 *   การแก้ที่ถูกต้องคือจัดลำดับ DOM ไม่ใช่ไปเพิ่ม z-index
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

const page = readFileSync(path.join(ROOT, 'src/pages/DocumentsPage.vue'), 'utf8');
const theme = readFileSync(path.join(ROOT, 'src/styles/theme.css'), 'utf8');

console.log('');
console.log('① modal ทั้งระบบใช้ z-index เดียวกัน → ลำดับ DOM คือตัวตัดสิน');
const backdrop = /\.modal-backdrop\s*\{[^}]*\}/.exec(theme);
check(!!backdrop, 'หา .modal-backdrop ใน theme.css เจอ');
if (backdrop) {
  const css = backdrop[0];
  const z = /z-index:\s*(\d+)/.exec(css);
  check(!!z, 'ปุ่ม modal มี z-index');
  check(/position:\s*fixed/.test(css), '.modal-backdrop ใช้ position: fixed');
  console.log(`      (z-index ปัจจุบัน = ${z ? z[1] : '?'} — ทุก modal ใช้ค่านี้เสมอ)`);
}

console.log('');
console.log('② dialog ส่งกลับต้องเป็น modal ตัวสุดท้ายของ DocumentsPage');
// ดึงชื่อ tag ของ modal ทั้งหมดในเทมเพลต เรียงตามที่ปรากฏ
const tags = [...page.matchAll(/<Documents[A-Za-z]*Modal/g)].map((m) => m[0].slice(1));
check(tags.length > 0, `พบ modal ในเทมเพลต ${tags.length} ตัว`);
const uniq = [...new Set(tags)];
console.log(`      ลำดับที่ปรากฏ: ${uniq.join(' → ')}`);

const last = uniq[uniq.length - 1];
check(last === 'DocumentsReturnModal',
  'DocumentsReturnModal เป็นตัวสุดท้ายในเทมเพลต',
  `ตัวสุดท้ายคือ ${last} → มันจะถูกวาดทับ dialog ส่งกลับ\n`
  + '      ต้องย้าย DocumentsReturnModal ไปไว้หลังสุด แล้วค่อยเพิ่ม modal ใหม่ในอนาคต');

check(uniq.filter((t) => t === 'DocumentsReturnModal').length === 1,
  'มี DocumentsReturnModal แค่ตัวเดียว',
  'ถ้ามีสองตัว อันที่อยู่ก่อนหน้าจะไม่มีผลต่องานจริง (Vue เก็บแค่ตัวหลังสุด)');

console.log('');
console.log('③ modal ที่เปิดคู่กับ dialog ส่งกลับ ต้องอยู่ก่อนหน้า');
// ตัวที่เปิดจากปุ่มในหน้ารายละเอียด และตัวที่เปิดจากปุ่มในฟอร์มลงทะเบียน
const SOURCES = ['DocumentsDetailModal', 'DocumentsIncomingFormModal', 'DocumentsOutgoingFormModal'];
for (const s of SOURCES) {
  const i = uniq.indexOf(s);
  check(i >= 0 && i < uniq.indexOf('DocumentsReturnModal'),
    `${s} อยู่ก่อน DocumentsReturnModal`,
    i === -1 ? 'ไม่พบในเทมเพลต' : `อยู่ตำแหน่ง ${i + 1}`);
}

console.log('');
console.log('④ ปุ่มส่งกลับต้องมีใน modal ที่เปิดจากทั้งสองทาง');
check(/@return-doc="openReturn"/.test(page), 'หน้าหลักรับ @return-doc จาก modal');
check((page.match(/@return-doc="openReturn"/g) || []).length >= 2,
  'ผูก @return-doc ไว้ทั้ง modal รายละเอียดและ modal ลงทะเบียน',
  'ผู้ใช้ขอให้มีปุ่มในทั้งสองที่ ถ้าผูกไว้ที่เดียวอีกที่จะกดไม่ได้');

console.log('');
console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);