'use strict';
/**
 * สร้างฐานว่างสำหรับจำลอง CI
 *   admin_ph2_ci       (ฐานหลัก — โค้ดจะสร้าง schema + seed เอง)
 *   admin_ph2_ci_test  (ฐาน smoke)
 *
 * ต้องเชื่อมต่อเป็น root เพราะ user admin_ph2 ไม่มีสิทธิ์ CREATE DATABASE
 * ใช้: node scripts/make-ci-db.js
 */
const mysql = require('mysql2/promise');

const CFG = {
  host: process.env.CI_DB_HOST || '127.0.0.1',
  port: Number(process.env.CI_DB_PORT || 3308),
  user: process.env.CI_DB_ROOT_USER || 'root',
  password: process.env.CI_DB_ROOT_PASS || 'rootpass',
};

const DBS = ['admin_ph2_ci', 'admin_ph2_ci_test'];

(async () => {
  const conn = await mysql.createConnection(CFG);
  for (const name of DBS) {
    await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
    await conn.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
    await conn.query(`GRANT ALL PRIVILEGES ON \`${name}\`.* TO 'admin_ph2'@'%'`);
    console.log('สร้างฐานว่าง', name);
  }
  await conn.query('FLUSH PRIVILEGES');
  await conn.end();
  console.log('เสร็จ');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });