'use strict';
/**
 * ดู DDL ดิบที่ SQLite เก็บไว้ใน sqlite_master
 * (หลัง ALTER TABLE ADD COLUMN ตารางจะถูก SQLite เขียน CREATE TABLE ใหม่)
 *
 * ใช้: node scripts/show-ddl.js [ตาราง]
 */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const file = process.env.SQLITE_FILE || path.join(__dirname, '..', 'data.db');
const only = process.argv[2];

const db = new DatabaseSync(file);
const rows = db
  .prepare(
    only
      ? 'SELECT name, sql FROM sqlite_master WHERE type = ? AND name = ?'
      : 'SELECT name, sql FROM sqlite_master WHERE type = ? ORDER BY name'
  )
  .all('table', only);

for (const r of rows) {
  console.log(`===== ${r.name} =====`);
  console.log(r.sql);
  console.log('');
}

db.close();
