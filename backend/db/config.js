'use strict';
/**
 * การตั้งค่าการเชื่อมต่อฐานข้อมูล
 *
 * รองรับ 2 dialect โดยเลือกตอน deploy-time จาก DATABASE_URL:
 *   - ไม่ตั้ง DATABASE_URL หรือขึ้นต้นด้วย sqlite:  → SQLite (ไฟล์ backend/data.db)
 *   - DATABASE_URL=mysql://user:pass@host:3306/db   → MySQL 8.0+ / MariaDB 10.4+
 *
 * ตัวแปรสภาพแวดล้อมที่รองรับ:
 *   DATABASE_URL              mysql://user:pass@host:port/database?charset=utf8mb4
 *   DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME DB_CONNECTION_LIMIT DB_COLLATION
 *   SQLITE_FILE               ตำแหน่งไฟล์ SQLite (default backend/data.db)
 *   DB_SQL_MODE               กำหนด sql_mode ของ session MySQL (ดูค่าเริ่มต้นด้านล่าง)
 */
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..');

/**
 * ค่าเริ่มต้นของ sql_mode ตั้งใจให้ "ใกล้เคียงพฤติกรรม SQLite เดิม" มากที่สุด
 *
 * ต้องเอา ONLY_FULL_GROUP_BY ออก เพราะโค้ดเดิมมี GROUP BY ที่เลือกคอลัมน์
 * ที่ไม่ได้ aggregate (SQLite อนุญาต, MySQL ปกติจะ error) เช่นรายงานงบประมาณ/โรงเรียน
 * ต้องเอา STRICT_TRANS_TABLES ออก เพราะ SQLite ไม่เข้มเรื่องชนิดข้อมูล แต่ถ้าเข้มจะทำให้
 * insert ที่เคยผ่านบน SQLite ไม่ผ่านบน MySQL
 *
 * ต้องใส่ PIPES_AS_CONCAT เพราะโค้ดเดิมใช้ `||` ต่อสตริงตามมาตรฐาน SQLite
 * (เช่น `(title || ' ' || full_name)`) ถ้าไม่ใส่ MySQL จะตีความเป็น logical OR
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
    database: decodeURIComponent((url.pathname || '/').replace(/^\//, '')) || 'ph2',
  };
  // ?charset= / ?connectionLimit=
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

  if (/^mysql(2)?:\/\//i.test(url)) {
    const fromUrl = parseMysqlUrl(url);
    const cfg = {
      dialect: 'mysql',
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

  return {
    dialect: 'sqlite',
    file: process.env.SQLITE_FILE
      ? path.resolve(BACKEND_ROOT, process.env.SQLITE_FILE)
      : path.join(BACKEND_ROOT, 'data.db'),
  };
}

/** ข้อความสรุปการตั้งค่าสำหรับแสดงตอนเริ่มโปรแกรม (ไม่เผยรหัสผ่าน) */
function describe(cfg) {
  if (cfg.dialect === 'mysql') {
    return `MySQL ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database} (pool=${cfg.connectionLimit})`;
  }
  return `SQLite ${cfg.file}`;
}

module.exports = { resolve, describe, BACKEND_ROOT, DEFAULT_SQL_MODE };
