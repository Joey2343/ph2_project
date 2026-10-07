'use strict';
/**
 * การตั้งค่าการเชื่อมต่อฐานข้อมูล — MariaDB 11.4
 *
 * ระบบใช้ฐานข้อมูล dialect เดียวคือ MariaDB 11.4 (ตรงกับเซิร์ฟเวอร์จริง)
 * ไม่มี SQLite หรือ MySQL แยกอีกแล้ว
 *
 * ตัวแปรสภาพแวดล้อมที่รองรับ:
 *   DATABASE_URL              mysql://user:pass@host:port/database?charset=utf8mb4
 *   DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME DB_CONNECTION_LIMIT DB_COLLATION
 *   DB_SQL_MODE               กำหนด sql_mode ของ session (ดูค่าเริ่มต้นด้านล่าง)
 */
require('dotenv').config();

const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..');

/**
 * ค่าเริ่มต้นของ sql_mode
 *
 * ต้องใส่ PIPES_AS_CONCAT เพราะโค้ดใช้ `||` ต่อสตริงมาตั้งแต่สมัย SQLite
 * ถ้าไม่ใส่ MariaDB จะตีความเป็น logical OR แทน
 *
 * ต้องเอา ONLY_FULL_GROUP_BY ออก เพราะมี GROUP BY ที่เลือกคอลัมน์ที่ไม่ได้ aggregate
 * (เช่นรายงานงบประมาณ / โรงเรียน) ซึ่ง MariaDB เปิดบังคับจะ error
 *
 * ต้องเอา STRICT_TRANS_TABLES ออก เพื่อไม่ให้ insert ที่เคยผ่านจะพัง
 */
const DEFAULT_SQL_MODE =
  'NO_ENGINE_SUBSTITUTION,ONLY_FULL_GROUP_BY,NO_ZERO_DATE,NO_ZERO_IN_DATE,PIPES_AS_CONCAT';

function parseMysqlUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`DATABASE_URL ไม่ถูกต้อง: ${raw}`);
  }
  const cfg = {
    host: url.hostname || '127.0.0.1',
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username || 'root'),
    password: decodeURIComponent(url.password || ''),
    database: decodeURIComponent((url.pathname || '/').replace(/^\//, '')),
  };
  for (const [k, v] of url.searchParams.entries()) {
    if (k === 'charset') cfg.charset = v;
    if (k === 'connectionLimit') cfg.connectionLimit = Number(v);
  }
  return cfg;
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function resolve() {
  const url = (process.env.DATABASE_URL || '').trim();

  if (!url) {
    throw new Error(
      'ไม่ได้ตั้ง DATABASE_URL — ระบบต้องใช้ MariaDB เท่านั้น\n' +
      '  ตั้งค่าใน backend/.env เช่น\n' +
      '  DATABASE_URL=mysql://admin_ph2:admin_ph2pass@127.0.0.1:3308/admin_ph2\n' +
      '  หรือสร้างจากไฟล์ตัวอย่าง:  cp .env.example .env'
    );
  }

  if (!/^mysql(2)?:\/\//i.test(url)) {
    throw new Error(`DATABASE_URL ต้องขึ้นต้นด้วย mysql:// — ได้รับ: ${url}`);
  }

  const fromUrl = parseMysqlUrl(url);
  const cfg = {
    host: process.env.DB_HOST || fromUrl.host,
    port: num(process.env.DB_PORT, fromUrl.port),
    user: process.env.DB_USER || fromUrl.user,
    password: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : fromUrl.password,
    database: process.env.DB_NAME || fromUrl.database,
    connectionLimit: num(process.env.DB_CONNECTION_LIMIT, fromUrl.connectionLimit || 10),
    charset: process.env.DB_CHARSET || fromUrl.charset || 'utf8mb4',
    collation: process.env.DB_COLLATION || 'utf8mb4_bin',
    sqlMode: process.env.DB_SQL_MODE || DEFAULT_SQL_MODE,
  };

  if (!cfg.database) {
    throw new Error('MySQL: ไม่ระบุชื่อฐานข้อมูล (DB_NAME หรือ path ใน DATABASE_URL)');
  }
  return cfg;
}

/** ข้อความสรุปการตั้งค่าสำหรับแสดงตอนเริ่มโปรแกรม (ไม่เผยรหัสผ่าน) */
function describe(cfg) {
  return `MariaDB ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database} (pool=${cfg.connectionLimit})`;
}

module.exports = { resolve, describe, BACKEND_ROOT, DEFAULT_SQL_MODE };