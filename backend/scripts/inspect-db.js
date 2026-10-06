'use strict';
/**
 * ตรวจสอบ schema จริงในฐานข้อมูล และเทียบกับคอลัมน์ที่โค้ดคาดว่าจะมี
 *
 * จุดประสงค์: จับคอลัมน์ที่ถูกสร้าง "นอกโค้ด" เช่น จาก live-migration ที่ไม่มีในซอร์สแล้ว
 * ถ้าไม่ย้ายมาไว้ในรายการ migration การติดตั้ง MySQL ใหม่จะ query ไม่ผ่านทันที
 *
 * ใช้: node scripts/inspect-db.js [พาธ/data.db]
 */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const target = process.argv[2] || path.join(__dirname, '..', 'data.db');
const db = new DatabaseSync(target);

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all()
  .map((r) => r.name);

let total = 0;
const schema = {};

for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info("${t}")`).all();
  schema[t] = cols.map((c) => c.name);
  let count = 0;
  try {
    count = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;
  } catch (e) {
    count = -1;
  }
  total += count;
  console.log(`${t} (${count} แถว, ${cols.length} คอลัมน์)`);
  console.log(`   ${cols.map((c) => c.name).join(', ')}`);
}

console.log(`\nรวม ${tables.length} ตาราง · ${total} แถว`);
db.close();
