'use strict';
/**
 * พิมพ์ codepoint ของช่วงข้อความที่ระบุ เพื่อตัดข้อสงสัยเรื่องสระ/วรรณยุกต์ไทย
 * (อักขระไทยมีวรรณยุกต์ซ้อนทำให้การอ่านด้วยตาเชื่อถือไม่ได้)
 *
 * ใช้: node scripts/cp.js <ไฟล์> <คำค้นหา> [จำนวนตัวอักษรรอบข้าง]
 */
const fs = require('fs');

const file = process.argv[2];
const needle = process.argv[3];
const around = Number(process.argv[4] || 6);

const text = fs.readFileSync(file, 'utf8');
const i = text.indexOf(needle);
if (i === -1) {
  console.log(`ไม่พบ "${needle}" ใน ${file}`);
  process.exit(1);
}
const from = Math.max(0, i - around);
const to = Math.min(text.length, i + needle.length + around);
const slice = text.slice(from, to);

console.log(`ไฟล์: ${file}`);
console.log(`ตำแหน่ง: ${i}`);
console.log(`ข้อความ: ${slice}`);
console.log('\ncodepoint:');
for (const ch of slice) {
  const cp = ch.codePointAt(0);
  const hex = 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
  console.log(`  ${hex}  ${JSON.stringify(ch)}`);
}
