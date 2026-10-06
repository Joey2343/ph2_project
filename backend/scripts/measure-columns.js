'use strict';
/**
 * วัดความยาวค่าสูงสุดของแต่ละคอลัมน์ เพื่อเลือกขนาด VARCHAR ให้เหมาะสมตอนแปลงเป็น MySQL
 *
 * สาเหตุที่ต้องวัด: MySQL บังคับความยาว VARCHAR และตัดข้อมูลทิ้งถ้าเกิน (strict mode)
 * ขณะที่ SQLite ไม่จำกัด — ถ้าเลือกสั้นเกินข้อมูลจะหายเงียบ
 *
 * ใช้: node scripts/measure-columns.js [ไฟล์.db]
 */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const file = process.argv[2] || path.join(__dirname, '..', 'data.db');
const db = new DatabaseSync(file);

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all()
  .map((r) => r.name)
  .filter((t) => !t.startsWith('sqlite_'));

const report = [];

for (const t of tables) {
  let count = 0;
  try {
    count = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
  } catch {
    continue;
  }
  if (!count) continue;
  const cols = db.prepare(`PRAGMA table_info("${t}")`).all();
  for (const c of cols) {
    let max = 0;
    try {
      const r = db.prepare(`SELECT MAX(LENGTH("${c.name}")) m FROM "${t}"`).get();
      max = Number(r.m) || 0;
    } catch {
      continue;
    }
    if (max > 0) report.push({ table: t, column: c.name, max, rows: count });
  }
}

report.sort((a, b) => b.max - a.max);

console.log('คอลัมน์ที่เก็บข้อมูลยาวที่สุด (เรียงจากมากไปน้อย)\n');
console.log('ขนาด'.padStart(8) + '  ' + 'ตาราง.คอลัมน์'.padEnd(40) + 'แถว');
console.log('-'.repeat(60));
for (const r of report.slice(0, 25)) {
  console.log(String(r.max).padStart(8) + '  ' + `${r.table}.${r.column}`.padEnd(40) + r.rows);
}

db.close();
