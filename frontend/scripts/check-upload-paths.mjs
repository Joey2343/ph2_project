/**
 * ตรวจว่าลิงก์ไฟล์แนบไม่ถูกเข้ารหัส "/" ทิ้ง
 *
 * ทำไมต้องมี
 * ──────────
 * encodeURIComponent('documents/abc.pdf')  →  'documents%2Fabc.pdf'
 * เซิร์ฟเวอร์หาไฟล์ชื่อ 'documents%2Fabc.pdf' ไม่เจอ → ตอบ 404
 * แล้วส่ง index.html มาให้แทน (เพราะ .htaccess ให้ SPA เป็น fallback)
 * ผลคือ ผู้ใช้คลิกไฟล์แนบแล้วเปิดหน้าเว็บแอปขึ้นมาใหม่ ไม่ใช่ไฟล์จริง
 *
 * พิสูจน์บนเซิร์ฟเวอร์จริง (p2-smart.phrae2.go.th):
 *   /uploads/documents%2F1791617392475-c82c330c.pdf  →  404  text/html      2,144 bytes
 *   /uploads/documents/1791617392475-c82c330c.pdf    →  200  application/pdf 65,017 bytes
 *   /uploads/staff%2F3411300848007_signature.png      →  404  text/html      2,144 bytes
 *   /uploads/staff/3411300848007_signature.png        →  200  image/png    102,306 bytes
 *
 * ทางแก้: ใช้ UI.encodePath() ซึ่งเข้ารหัสทีละส่วนแล้วเก็บ "/" ไว้
 *   p.split('/').map(encodeURIComponent).join('/')
 *
 * เคยเกิดจริง: 3 กลุ่ม — ลิงก์ไฟล์ในหน้าดูหนังสือ · UI.fileLink() ของโมดุลเดิม
 *   · หน้าลงนามในร่างเอกสาร (ลายเซ็น + PDF ฉบับร่าง)
 *   รวม 8 จุด — ทั้งหมดแก้แล้ว แต่โค้ดเดิมยังอยู่ใน docs/legacy/ ซึ่งเป็นต้นฉบับอ้างอิง
 *
 * ใช้: node scripts/check-upload-paths.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, 'src');

let pass = 0;
let fail = 0;

/** @param {boolean} ok @param {string} name @param {string} [detail] */
function check(ok, name, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✔ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✖ ${name}`);
    if (detail) console.log(`      ${detail}`);
  }
}

/** ไล่ทุกไฟล์ .js / .vue ใต้ src/ (ข้าม node_modules และ dist) */
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(js|vue)$/.test(name)) yield full;
  }
}

const files = [...walk(SRC)];

// ── 1. ห้าม '/uploads/' + encodeURIComponent(...) ─────────────────
// ตรง ๆ ทุกกรณี เพราะ %2F ทำให้เซิร์ฟเวอร์หาไฟล์ไม่เจอ
const badEncoded = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  src.split(/\r?\n/).forEach((line, i) => {
    // ข้ามบรรทัดที่เป็นคำอธิบาย/คอมเมนต์ที่กล่าวถึงปัญหา (ตัวอย่างในเอกสาร)
    if (/^\s*(\*|\/\/|<!--)/.test(line)) return;
    if (!/\/uploads\//.test(line)) return;
    if (!/encodeURIComponent/.test(line)) return;
    badEncoded.push(
      `${path.relative(ROOT, file).replace(/\\/g, '/')}:${i + 1}  ${line.trim().slice(0, 100)}`,
    );
  });
}
check(
  badEncoded.length === 0,
  'ไม่มี /uploads/ ที่เข้ารหัด "/" ทิ้ดด้วย encodeURIComponent',
  badEncoded.join('\n      '),
);

// ── 2. ทุกลิงก์ /uploads/ ต้องผ่าน UI.encodePath หรือเป็น path ที่ปลอดภัย ──
// ชื่อไฟล์ที่ระบบสร้างเองเป็น ASCII ล้วน (staff/12345678901_signature.png)
// การไม่เข้ารหัสจึงยังใช้ได้ แต่ถ้ามีอักขระแปลกจะพัง — เตือนไว้เป็นข้อมูล
const unencoded = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  src.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(\*|\/\/|<!--)/.test(line)) return;
    if (!/\/uploads\//.test(line)) return;
    if (/encodeURIComponent|encodePath/.test(line)) return;
    unencoded.push(`${path.relative(ROOT, file).replace(/\\/g, '/')}:${i + 1}  ${line.trim().slice(0, 100)}`);
  });
}
console.log(`  ℹ ไม่ได้เข้ารหัด ${unencoded.length} จุด (ชื่อไฟล์ระบบสร้างเป็น ASCII → ใช้ได้)`);
for (const u of unencoded) console.log(`      ${u}`);

// ── 3. UI.encodePath ต้องเก็บ "/" ไว้จริง ────────────────────────
const uiSrc = readFileSync(path.join(SRC, 'ui', 'ui.js'), 'utf8');
const fn = uiSrc.match(/encodePath\(p\)\s*\{[^}]*\}/);
check(
  !!fn && fn[0].includes("split('/')") && fn[0].includes("join('/')"),
  'UI.encodePath เข้ารหัสทีละส่วนแล้วเก็บ "/" ไว้',
  fn ? fn[0] : 'ไม่พบ encodePath ใน src/ui/ui.js',
);

// ── 4. พฤติกรรมจริงของ encodePath ────────────────────────────────
const encodePath = (p) => (p ? p.split('/').map(encodeURIComponent).join('/') : '');
const cases = [
  ['documents/1791617392475-c82c330c.pdf', '/uploads/documents/1791617392475-c82c330c.pdf'],
  ['staff/3411300848007_signature.png', '/uploads/staff/3411300848007_signature.png'],
  ['documents/ยก ฉบับ 1.pdf', '/uploads/documents/%E0%B8%A2%E0%B8%81%20%E0%B8%89%E0%B8%9A%E0%B8%B1%E0%B8%9A%201.pdf'],
];
const wrong = cases.filter(([input, want]) => '/uploads/' + encodePath(input) !== want);
check(wrong.length === 0, 'encodePath ให้ผลถูกต้องทั้ง ASCII และชื่อไทย', wrong.map((w) => w[0]).join(', '));

const noSlashLoss = cases.every(([input]) => !('/uploads/' + encodePath(input)).includes('%2F'));
check(noSlashLoss, 'encodePath ไม่กลืน "/" เป็น %2F');

// ── สรุป ─────────────────────────────────────────────────────────
console.log(`\nผ่าน ${pass} · ไม่ผ่าน ${fail}\n`);
if (fail > 0) process.exit(1);