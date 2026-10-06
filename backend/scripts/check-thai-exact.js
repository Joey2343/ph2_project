'use strict';
/**
 * เทียบ seed text ภาษาไทยแบบ exact ระดับ codepoint ระหว่างไฟล์ใหม่กับต้นฉบับ
 *
 * ทำหน้าที่เหมือน check-thai-diff.js แต่รายงานเป็น codepoint จึงไม่มีปัญหา encoding
 * และชี้จุดที่ต่างกันให้ชัดเจน
 *
 * ใช้: node scripts/check-thai-exact.js [ไฟล์ใหม่] [ไฟล์ต้นฉบับ]
 */
const fs = require('fs');
const path = require('path');

const NEW = process.argv[2] || path.join(__dirname, '..', 'db.js');
const OLD = process.argv[3] || path.join(__dirname, '..', '..', 'docs', 'legacy', 'source-v1', 'db.js');

/** คืนทุก "บรรทัด seed" ที่มีอักษรไทย พร้อม hash ของมัน */
function lines(text) {
  const map = new Map();
  text.split(/\r?\n/).forEach((line, i) => {
    if (!/[฀-๿]/.test(line)) return;
    const norm = line.trim();
    if (norm.length < 8) return;
    if (!map.has(norm)) map.set(norm, i + 1);
  });
  return map;
}

const newLines = lines(fs.readFileSync(NEW, 'utf8'));
const oldLines = lines(fs.readFileSync(OLD, 'utf8'));

const missing = [...oldLines.keys()].filter((l) => !newLines.has(l));
const added = [...newLines.keys()].filter((l) => !oldLines.has(l));

console.log(`ไฟล์ใหม่  : ${path.relative(process.cwd(), NEW)}`);
console.log(`ต้นฉบับ  : ${path.relative(process.cwd(), OLD)}`);
console.log(`\nบรรทัดไทย: ต้นฉบับ ${oldLines.size} · ใหม่ ${newLines.size}`);
console.log(`\n=== ไม่พบในไฟล์ใหม่ (${missing.length}) ===`);
for (const l of missing) {
  console.log(`  [บรรทัด ${oldLines.get(l)}] ${JSON.stringify(l)}`);
  // หา "ก้อนไทย" ที่ต่างกันจริง ๆ
  const candidates = [...newLines.keys()].filter((n) => similar(n, l));
  for (const c of candidates) {
    const diff = firstDiff(l, c);
    console.log(`      ↳ คล้าย: ${JSON.stringify(c)}`);
    if (diff) console.log(`        ต่างที่: ต้นฉบับ=${diff[0]} (U+${diff[0].codePointAt(0).toString(16).toUpperCase()}) · ใหม่=${diff[1]} (U+${diff[1].codePointAt(0).toString(16).toUpperCase()})`);
  }
}
console.log(`\n=== มีในไฟล์ใหม่แต่ไม่มีในต้นฉบับ (${added.length}) ===`);
for (const l of added) console.log(`  [บรรทัด ${newLines.get(l)}] ${JSON.stringify(l)}`);

function similar(a, b) {
  if (Math.abs(a.length - b.length) > 6) return false;
  let same = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] === b[i]) same += 1;
  return same / Math.min(a.length, b.length) > 0.85;
}

function firstDiff(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return [a[i] || '(จบ)', b[i] || '(จบ)'];
  }
  return null;
}
