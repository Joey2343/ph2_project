'use strict';
/**
 * ทดสอบไวยากรณ์ DDL ของ MySQL/MariaDB โดยตรง
 * ใช้หา syntax ที่ MySQL ยอมรับจริง แทนการเดา
 *
 * ใช้: node scripts/probe-mysql-ddl.js
 */
const mysql = require('mysql2/promise');

const DB_URL =
  process.env.DATABASE_URL || 'mysql://admin_ph2:admin_ph2pass@127.0.0.1:3307/admin_ph2';

const CASES = [
  ['varchar literal default', "CREATE TABLE {T} (a VARCHAR(255) NOT NULL DEFAULT 'x')"],
  ['varchar expression default', "CREATE TABLE {T} (a VARCHAR(255) NOT NULL DEFAULT ('x'))"],
  ['varchar explicit default clause', "CREATE TABLE {T} (a VARCHAR(255) NOT NULL, DEFAULT 'x' FOR a)"],
  ['mediumtext no default', 'CREATE TABLE {T} (a MEDIUMTEXT)'],
  ['mediumtext not null no default', 'CREATE TABLE {T} (a MEDIUMTEXT NOT NULL)'],
  ['int default', 'CREATE TABLE {T} (a INT NOT NULL DEFAULT 0)'],
  ['double default', 'CREATE TABLE {T} (a DOUBLE NOT NULL DEFAULT 0)'],
  ['varchar(30) default now()', 'CREATE TABLE {T} (a VARCHAR(30) NOT NULL DEFAULT (NOW()))'],
  ['varchar(30) literal ts default', "CREATE TABLE {T} (a VARCHAR(30) NOT NULL DEFAULT '2020-01-01 00:00:00')"],
  ['table unique on varchar', 'CREATE TABLE {T} (a VARCHAR(191), b INT, UNIQUE (a, b))'],
  ['backtick reserved key', 'CREATE TABLE {T} (`key` VARCHAR(191) PRIMARY KEY, v VARCHAR(255) NOT NULL DEFAULT \'\')'],
  ['on duplicate key update', "CREATE TABLE {T} (a VARCHAR(191) PRIMARY KEY, v VARCHAR(255))"],
  ['pipes as concat select', "SELECT 'a' || 'b' AS c"],
  ['row_number window', 'SELECT ROW_NUMBER() OVER (ORDER BY a) AS rn FROM (SELECT 1 AS a) x'],
];

async function main() {
  const u = new URL(DB_URL);
  const conn = await mysql.createConnection({
    host: u.hostname,
    port: Number(u.port) || 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
  });
  const [ver] = await conn.query('SELECT VERSION() AS v');
  console.log('เซิร์ฟเวอร์:', ver[0].v);
  const [mode] = await conn.query('SELECT @@SESSION.sql_mode AS m');
  console.log('sql_mode :', mode[0].m);
  console.log('');

  let n = 0;
  for (const [label, sqlTemplate] of CASES) {
    const table = `probe_${n++}`;
    const sql = sqlTemplate.replace('{T}', table);
    try {
      await conn.query(sql);
      console.log(`✔ ${label}`);
      await conn.query(`DROP TABLE IF EXISTS ${table}`);
    } catch (err) {
      console.log(`✖ ${label}  →  ${err.code}: ${err.message.slice(0, 120)}`);
      await conn.query(`DROP TABLE IF EXISTS ${table}`).catch(() => {});
    }
  }

  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
