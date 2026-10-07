'use strict';
/**
 * ดูโครงสร้างฐานข้อมูลจริง — ตาราง คอลัมน์ ชนิดข้อมูล และจำนวนแถว
 *
 * ใช้ตอนตรวจว่า schema ที่ประกาศใน db.js ตรงกับฐานจริงหรือไม่
 * และดูว่ามีข้อมูลอะไรบ้าง
 *
 * ใช้: node scripts/inspect-db.js
 */
const db = require('../db');

async function main() {
  await db.init();
  console.log(`\n${db.connectionInfo}`);
  console.log(`MariaDB: ${db.driverVersion || 'n/a'}\n`);

  const tables = await db.tables();
  console.log(`${'ตาราง'.padEnd(24)} ${'คอลัมน์'.padStart(6)} ${'แถว'.padStart(8)}`);
  console.log('─'.repeat(42));

  let totalRows = 0;
  for (const t of tables) {
    const cols = await db.columns(t);
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM \`${t}\``).get();
    totalRows += Number(row.n);
    console.log(`${t.padEnd(24)} ${String(cols.length).padStart(6)} ${String(row.n).padStart(8)}`);
  }

  console.log('─'.repeat(42));
  console.log(`รวม ${tables.length} ตาราง · ${totalRows} แถว\n`);

  // แสดงรายละเอียดตารางที่สั่งมา (ถ้ามี)
  const only = process.argv[2];
  if (only && tables.includes(only)) {
    const cols = await db.columns(only);
    console.log(`── ${only} ──`);
    for (const c of cols) {
      console.log(
        `  ${c.name.padEnd(24)} ${String(c.type).padEnd(14)}` +
        `${c.notnull ? 'NOT NULL' : '         '}${c.pk ? '  PRIMARY KEY' : ''}`
      );
    }
    console.log('');
  }

  await db.close();
}

main().catch((e) => {
  console.error('ผิดพลาด:', e.message);
  process.exit(1);
});