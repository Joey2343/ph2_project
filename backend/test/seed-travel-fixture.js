/**
 * ใส่ข้อมูล travel ชั่วคราวเพื่อพิสูจน์ว่าตัวกรองปีใช้ช่วงวันที่ (ไม่ใช่เลขเอกสาร)
 *
 * จุดประสงค์: ฐานข้อมูลตัวอย่างยังไม่มีรายการ travel และรายการที่มีอยู่ก็ไม่มี travel_no
 * ทำให้ตรวจไม่ได้ว่าตัวกรองแก้จริงหรือยัง เพราะ 0 == 0 ทั้งสองทาง
 * สคริปต์นี้ใส่ 2 รายการ: ปีนี้ 1 รายการ + ปีก่อน 1 รายการ โดยตั้ง travel_no = ''
 * ถ้าตัวกรองยังใช้ LIKE '%/<ปี>' จะได้ 0 ทั้งสองปี → สังเกตได้ชัด
 *
 * ใช้: node test/seed-travel-fixture.js
 */
const path = require('node:path');
const BACKEND = path.join(__dirname, '..');

const TITLES = {
  current: 'ทดสอบตัวกรองปี (ปีนี้)',
  previous: 'ทดสอบตัวกรองปี (ปีก่อน)',
};
const DEST = 'กรุงเทพมหานคร';

/** ปี ค.ศ. ปัจจุบัน */
function thisYear() {
  return new Date().getFullYear();
}

/** แทรก 2 รายการลง SQLite (ใช้ค่าว่างแทนเลขเอกสาร) */
function seedSqlite() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(BACKEND, 'data.db'));
  const y = thisYear();
  const sql = `INSERT INTO travel_requests
    (user_id, travel_no, title, destination, date_from, date_to, days, detail, budget, status, form_data, created_at)
    VALUES (1, '', ?, ?, ?, ?, 1, '', 0, 'pending', '{}', datetime('now'))`;
  db.prepare(sql).run(TITLES.current, DEST, `${y}-03-15`, `${y}-03-17`);
  db.prepare(sql).run(TITLES.previous, DEST, `${y - 1}-05-10`, `${y - 1}-05-11`);
  const total = db.prepare('SELECT COUNT(*) AS c FROM travel_requests').get().c;
  db.close();
  return total;
}

/** แทรก 2 รายการลง MySQL (ใช้ค่าว่างแทนเลขเอกสาร) */
async function seedMysql(url) {
  const mysql = require('mysql2/promise');
  const c = await mysql.createConnection({ uri: url });
  const y = thisYear();
  const sql = `INSERT INTO travel_requests
    (user_id, travel_no, title, destination, date_from, date_to, days, detail, budget, status, form_data, created_at)
    VALUES (1, '', ?, ?, ?, ?, 1, '', 0, 'pending', '{}', NOW())`;
  await c.execute(sql, [TITLES.current, DEST, `${y}-03-15`, `${y}-03-17`]);
  await c.execute(sql, [TITLES.previous, DEST, `${y - 1}-05-10`, `${y - 1}-05-11`]);
  const [[row]] = await c.query('SELECT COUNT(*) AS c FROM travel_requests');
  await c.end();
  return row.c;
}

/** ลบเฉพาะรายการที่สคริปต์นี้สร้าง */
function cleanSqlite() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(BACKEND, 'data.db'));
  const r = db.prepare('DELETE FROM travel_requests WHERE title LIKE ?').run('ทดสอบตัวกรองปี%');
  db.close();
  return r.changes;
}

async function cleanMysql(url) {
  const mysql = require('mysql2/promise');
  const c = await mysql.createConnection({ uri: url });
  const [r] = await c.execute('DELETE FROM travel_requests WHERE title LIKE ?', ['ทดสอบตัวกรองปี%']);
  await c.end();
  return r.affectedRows;
}

module.exports = { seedSqlite, seedMysql, cleanSqlite, cleanMysql, TITLES };

if (require.main === module) {
  const cmd = process.argv[2] || 'seed';
  const url = process.env.DATABASE_URL || '';
  (async () => {
    if (cmd === 'clean') {
      console.log(`  ลบ SQLite: ${cleanSqlite()} แถว`);
      // ต้อง await — ถ้าไม่ await จะได้ [object Promise] และลบไม่ทันก่อน process จบ
      if (url) console.log(`  ลบ MySQL : ${await cleanMysql(url)} แถว`);
      return;
    }
    console.log(`  seed SQLite: ${seedSqlite()} รายการรวม`);
    if (url) console.log(`  seed MySQL : ${await seedMysql(url)} รายการรวม`);
  })();
}
