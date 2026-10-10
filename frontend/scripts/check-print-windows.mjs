/**
 * ตรวจสองกับดักของ "หน้าต่างพิมพ์" ที่เจอจริง
 *
 * 1) selector ของ CSS ต้องระบุ rel="stylesheet"
 * ──────────────────────────────────────────────
 *   หน้าต่างพิมพ์ทุกแบบฟอร์ม (ยานพาหนะ · ห้องประชุม · บันทึกข้อความ ·
 *   ไปราชการ · ลา) เปิดหน้าต่างใหม่แล้วดึง CSS ของระบบไปด้วย
 *
 *   เดิมเขียน:
 *     document.querySelector('link[href*="theme"], link[href*="index-"]')
 *
 *   ใน index.html ลำดับคือ
 *     <link rel="modulepreload" href="/assets/theme-XXXX.js">   ← มาก่อน
 *     <link rel="stylesheet"    href="/assets/theme-YYYY.css">
 *
 *   querySelector เอาตัวแรก = ไฟล์ .js
 *   แล้วประกาศเป็น <link rel="stylesheet"> → หน้าต่างพิมพ์ไม่มีสไตล์เลย
 *
 * 2) :disabled ต้องห่อด้วย !!
 * ───────────────────────────
 *   Vue ถือว่า '' เป็น "จริง" สำหรับ boolean attribute:
 *     includeBooleanAttr = (value) => !!value || value === ''
 *
 *   เดิมเขียน:  :disabled="loading || error"
 *   ตอนโหลดเสร็จ: loading = false, error = ''
 *   → false || '' = ''  → Vue ใส่ disabled="" เสมอ → ปุ่มกดไม่ได้ตลอด
 *
 *   เจอจริงที่ปุ่ม "⬢ พิมพ์" ในหน้าต่าง "บันทึกการขอใช้ยานพาหนะ"
 *
 * ใช้: node scripts/check-print-windows.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
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

/** ไล่ทุกไฟล์ .js / .vue ใต��� src/ */
function* walk(dir) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = path.join(dir, name.name);
    if (full.endsWith('node_modules') || full.endsWith('dist')) continue;
    if (name.isDirectory()) yield* walk(full);
    else if (/\.(js|vue)$/.test(name.name)) yield full;
  }
}

const files = [...walk(SRC)];

// ── 1. selector ของ CSS ต้องระบุ rel="stylesheet" ─────────────────
const badCssSelector = [];
for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const src = readFileSync(file, 'utf8');
  src.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(\*|\/\/|<!--)/.test(line)) return;
    if (!/querySelector(All)?\(\s*['"]link\[href\*=/.test(line)) return;
    if (/rel="stylesheet"/.test(line)) return;
    badCssSelector.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
  });
}
check(
  badCssSelector.length === 0,
  'ทุกจุดที่ดึง CSS ระบุ rel="stylesheet"',
  badCssSelector.join('\n      '),
);

// ต้องมีจุดที่ดึง CSS อยู่บ้าง (กันเขียนชื่อ selector ผิดจนไม่เจออะไรเลย)
const hasCssPickers = files.some((f) => /rel="stylesheet"\]\[href\*/.test(readFileSync(f, 'utf8')));
check(hasCssPickers, 'ยังมีจุดที่ดึง CSS สำหรับหน้าต่างพิมพ์อยู่');

// ── 2. :disabled ที่ต่อด้วย string ref ต้องห่อด้วย !! ────────────────
// อักขระพิเศษของ Vue: '' ถือเป็นจริง → ต้องแปลงเป็น boolean ก่อน
//
// ข้อจำกัด: ตรวจได้เฉพาะตัวแปรที่ประกาศเป็น string ในไฟล์เดียวกัน เช่น ref('')
// ตัวแปร boolean ปกติ (saving, loading, x.length > 0) ไม่อันตราย จึงไม่ต้องแตะ
const badDisabled = [];
for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const src = readFileSync(file, 'utf8');

  // ตัวแปรที่ประกาศเป็น string ในไฟล์นี้
  const stringRefs = new Set(
    [...src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*ref\(\s*(['"])\2\s*\)/g)].map((m) => m[1]),
  );
  if (!stringRefs.size) continue;

  src.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(\*|\/\/|<!--)/.test(line)) return;
    const m = line.match(/:disabled="([^"]+)"/);
    if (!m) return;
    const expr = m[1].trim();
    if (!expr.includes('||')) return;   // ไม่ได้ต่อด้วย || → ไม่มีทางได้ ''
    if (/^!!/.test(expr)) return;        // ห่อด้วย !! แล้ว
    const used = [...stringRefs].filter((n) => {
      // ต้องเป็น "operand เปล่า" เท่านั้นที่อันตราย
      // ถ้าตามด้วย ==/!==/==>/.< หรือใช้เป็นสมาชิก → ผลลัพธ์เป็น boolean อยู่แล้ว
      for (const m of expr.matchAll(new RegExp(`\\b${n}\\b`, 'g'))) {
        const after = expr.slice(m.index + n.length).trimStart();
        if (/^(===|!==|==|!=|>=|<=|>|<|\.)/.test(after)) continue;
        return true;
      }
      return false;
    });
    if (!used.length) return;
    badDisabled.push(`${rel}:${i + 1}  :disabled ใช้ string ref [${used.join(', ')}] เป็น operand เปล่าโดยไม่ห่อด้วย !!`);
  });
}
check(
  badDisabled.length === 0,
  'ไม่มี :disabled ที่ต่อ string ref ด้วย || โดยไม่ห่อด้วย !!',
  badDisabled.join('\n      '),
);

// ── 3. ยืนยันกติกาของ Vue ───────────────────────────────────────────
const includeBooleanAttr = (v) => !!v || v === '';
check(
  includeBooleanAttr(false || '') === true,
  "Vue ถือว่า '' เป็นจริงสำหรับ boolean attribute (นี่คือที่มาของบั๊ก)",
  'includeBooleanAttr(false || \'\') = ' + includeBooleanAttr(false || ''),
);
check(
  includeBooleanAttr(!!(false || '')) === false,
  'ห่อด้วย !! แล้วหลุดจากปัญหา',
  'includeBooleanAttr(!!(false || \'\')) = ' + includeBooleanAttr(!!(false || '')),
);

// ── สรุป ───────────────────────────────────────────────────────────
console.log(`\nผ่าน ${pass} · ไม่ผ่าน ${fail}\n`);
if (fail > 0) process.exit(1);