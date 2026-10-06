'use strict';
/**
 * เทียบข้อความภาษาไทยในซอร์สใหม่กับต้นฉบับ เพื่อจับการคัดลอกผิด
 *
 * ข้อความไทยเป็นส่วนที่อัตโนมัติแก้ไม่ได้ (ไม่มี refactor ช่วย) จึงต้องตรวจด้วยเครื่องมือ
 * เทียบ: เก็บ "ประโยคไทย" ทุกชิ้นจากทั้งสองไฟล์ แล้วหาชิ้นที่หายไปหรือเพิ่มเข้ามาใหม่
 *
 * ใช้: node scripts/check-thai-diff.js
 */
const fs = require('fs');
const path = require('path');

const NEW = process.argv[2] || path.join(__dirname, '..', 'db.js');
const OLD = process.argv[3] || path.join(__dirname, '..', '..', 'docs', 'legacy', 'source-v1', 'db.js');

/** ดึงชิ้นข้อความที่มีอักษรไทย พร้อมตำแหน่งอ้างอิง */
function thaiChunks(text) {
  const chunks = new Set();
  // จับลำดับตัวอักษรไทยความยาว >= 6 พร้อมเลข/อังกฤษ/ช่องว่างที่ติดกัน
  const re = /[฀-๿][฀-๿0-9A-Za-z .,/:()\-–—]*[฀-๿]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const s = m[0].trim();
    if (s.length >= 6) chunks.add(s);
  }
  return chunks;
}

if (!fs.existsSync(OLD)) {
  console.log(`ไม่พบไฟล์ต้นฉบับ: ${OLD}`);
  process.exit(0);
}

const newChunks = thaiChunks(fs.readFileSync(NEW, 'utf8'));
const oldChunks = thaiChunks(fs.readFileSync(OLD, 'utf8'));

const missing = [...oldChunks].filter((c) => !newChunks.has(c));
const added = [...newChunks].filter((c) => !oldChunks.has(c));

console.log(`ต้นฉบับ ${oldChunks.size} ชิ้น · ใหม่ ${newChunks.size} ชิ้น`);
console.log(`\n❌ หายไปจากต้นฉบับ (${missing.length}):`);
missing.forEach((c) => console.log('  - ' + JSON.stringify(c)));
console.log(`\n➕ เพิ่มใหม่ในไฟล์ใหม่ (${added.length}):`);
added.forEach((c) => console.log('  + ' + JSON.stringify(c)));
