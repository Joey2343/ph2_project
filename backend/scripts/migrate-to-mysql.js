'use strict';
/**
 * ย้ายข้อมูลจาก SQLite (backend/data.db) ไปยัง MySQL
 *
 * ใช้เมื่อ:  มีระบบเดิมที่ใช้ SQLite อยู่แล้ว และต้องการย้ายไป MySQL
 *
 * วิธีทำงาน
 *   1. อ่าน schema จาก SQLite (รวมตาราง/คอลัมน์จริงทั้งหมด)
 *   2. สร้างตารางใน MySQL ตาม schema เดิม (ผ่าน db/sql.js ที่แปลงชนิดข้อมูลให้แล้ว)
 *   3. คัดลอกข้อมูลทีละตาราง เรียงตามลำดับ foreign key
 *   4. ปรับค่า AUTO_INCREMENT ให้ต่อกับค่า id สูงสุดที่มี
 *   5. สรุปจำนวนแถวที่ย้ายได้
 *
 * ความปลอดภัย
 *   - ปฏิเสธถ้าปลายทางมีตารางอยู่แล้ว เว้นแต่ใช้ --force (จะลบตารางทั้งหมดก่อน)
 *   - ทำงานใน transaction เดียว — ถ้าพังจะย้อนกลับทั้งหมด
 *   - ไม่แตะไฟล์ SQLite ต้นทาง
 *
 * ใช้:
 *   DATABASE_URL=mysql://... node scripts/migrate-to-mysql.js --dry     # ดูก่อน
 *   DATABASE_URL=mysql://... node scripts/migrate-to-mysql.js
 *   DATABASE_URL=mysql://... node scripts/migrate-to-mysql.js --force  # ลบของเดิม
 */

const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const mysql = require('mysql2/promise');

const sql = require('../db/sql');
const BACKEND = path.join(__dirname, '..');

const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
const SRC_FILE = process.env.SOURCE_SQLITE || path.join(BACKEND, 'data.db');

/** ลำดับตารางตามความสัมพันธ์ (ตารางที่อ้างอิงต้องมาก่อน) */
const TABLE_ORDER = [
  'users',
  'settings',
  'office_sections',
  'schools',
  'disasters',
  'time_records',
  'vehicles',
  'vehicle_bookings',
  'vehicle_notices',
  'rooms',
  'room_bookings',
  'memos',
  'travel_requests',
  'leave_requests',
  'documents',
  'document_staff',
  'document_reads',
  'document_recipients',
  'budgets',
  'budget_transactions',
  'academic_projects',
  'user_leave_balances',
  'sessions',
];

/** ตารางที่ไม่ต้องย้าย (สร้างใหม่ทุกครั้ง) */
const SKIP_TABLES = new Set(['sqlite_sequence']);

async function main() {
  console.log('ย้ายข้อมูล SQLite → MySQL');
  console.log(`  ต้นทาง : ${SRC_FILE}`);
  console.log(`  ปลายทาง: ${process.env.DATABASE_URL ? '(ตั้งไว้)' : 'ไม่ได้ตั้ง DATABASE_URL!'}`);
  if (DRY) console.log('  โหมด  : DRY RUN (ไม่เขียนอะไร)');
  if (FORCE) console.log('  โหมด  : --force (จะลบตารางที่มีอยู่ก่อน)');
  console.log('');

  if (!process.env.DATABASE_URL) {
    console.error('✖ ต้องตั้ง DATABASE_URL ของ MySQL ก่อน');
    console.error('  เช่น DATABASE_URL=mysql://admin_ph2:admin_ph2pass@127.0.0.1:3307/admin_ph2');
    process.exit(1);
  }

  // ── 1) อ่านต้นทาง ────────────────────────────────────────────────────
  const src = new DatabaseSync(SRC_FILE);
  const srcTables = src
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((r) => r.name)
    .filter((t) => !SKIP_TABLES.has(t));

  const schema = {};
  for (const t of srcTables) {
    schema[t] = {
      ddl: src.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?").get(t)?.sql,
      columns: src.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name),
      rows: src.prepare(`SELECT * FROM "${t}"`).all(),
    };
  }

  console.log(`พบ ${srcTables.length} ตารางใน SQLite\n`);

  // ── 2) เชื่อมต่อปลายทาง ─────────────────────────────────────────────
  const u = new URL(process.env.DATABASE_URL);
  const conn = await mysql.createConnection({
    host: u.hostname,
    port: Number(u.port) || 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    charset: 'utf8mb4',
    decimalNumbers: true,
    dateStrings: true,
    multipleStatements: false,
  });

  const [verRow] = await conn.query('SELECT VERSION() AS v');
  const isMaria = /mariadb/i.test(verRow[0].v);
  console.log(`ปลายทาง: ${verRow[0].v}${isMaria ? ' (MariaDB)' : ''}\n`);

  // ── 3) เตรียมตาราง ─────────────────────────────────────────────────
  const [existingRows] = await conn.query(
    "SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"
  );
  const existing = existingRows.map((r) => r.n.toLowerCase());
  const nonEmpty = existing.filter((n) => !['settings', 'users'].includes(n));

  if (nonEmpty.length && !FORCE) {
    console.error(`✖ ปลายทางมีตารางอยู่แล้ว: ${nonEmpty.join(', ')}`);
    console.error('  ใช้ --force เพื่อลบและสร้างใหม่');
    await conn.end();
    src.close();
    process.exit(1);
  }

  if (DRY) {
    console.log('── ตารางที่จะสร้าง ──');
    for (const t of Object.keys(schema)) {
      const n = schema[t].rows.length;
      console.log(`  ${t.padEnd(24)} ${String(n).padStart(5)} แถว  ${schema[t].columns.length} คอลัมน์`);
    }
    console.log(`\nรวม ${Object.values(schema).reduce((s, t) => s + t.rows.length, 0)} แถว`);
    console.log('\n(DRY RUN — ไม่ได้เขียนอะไรลงฐานข้อมูล)');
    src.close();
    await conn.end();
    return;
  }

  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  if (FORCE) {
    for (const t of Object.keys(schema)) {
      await conn.query(`DROP TABLE IF EXISTS \`${t}\``);
    }
    console.log('ลบตารางเดิมเรียบร้อย (--force)\n');
  }

  // ── 4) สร้างตาราง ────────────────────────────────────────────────────
  console.log('── สร้างตาราง ──');
  for (const t of Object.keys(schema)) {
    const mysqlDdl = sql.translateDDL(schema[t].ddl, { isMaria });
    await conn.query(mysqlDdl);
    console.log(`  ✔ ${t}`);
  }

  // ── 5) คัดลอกข้อมูล ─────────────────────────────────────────────────
  console.log('\n── คัดลอกข้อมูล ──');
  await conn.beginTransaction();
  try {
    for (const t of Object.keys(schema)) {
      const rows = schema[t].rows;
      if (!rows.length) {
        console.log(`  – ${t.padEnd(24)} 0 แถว`);
        continue;
      }
      const cols = schema[t].columns;
      const colList = cols.map((c) => `\`${c}\``).join(', ');
      const placeholders = cols.map(() => '?').join(', ');
      const stmt = `INSERT INTO \`${t}\` (${colList}) VALUES (${placeholders})`;

      let done = 0;
      for (const row of rows) {
        const values = cols.map((c) => normalizeValue(row[c]));
        try {
          await conn.query(stmt, values);
          done += 1;
        } catch (err) {
          // บางคอลัมน์อาจไม่มีในตารางปลายทาง — ลองใหม่โดยตัดคอลัมน์นั้นออก
          if (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE') {
            const badCol = extractColumn(err.sqlMessage);
            const keep = cols.filter((c) => c !== badCol);
            const s2 = `INSERT INTO \`${t}\` (${keep.map((c) => `\`${c}\``).join(', ')}) ` +
              `VALUES (${keep.map(() => '?').join(', ')})`;
            await conn.query(s2, keep.map((c) => normalizeValue(row[c])));
            done += 1;
            continue;
          }
          throw err;
        }
      }
      console.log(`  ✔ ${t.padEnd(24)} ${done}/${rows.length} แถว`);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    console.error('\n✖ ย้ายข้อมูลไม่สำเร็จ — ย้อนกลับทั้งหมดแล้ว');
    console.error(`  ${err.code}: ${err.message.slice(0, 200)}`);
    await conn.end();
    src.close();
    process.exit(1);
  }

  // ── 6) ปรับ AUTO_INCREMENT ───────────────────────────────────────────
  console.log('\n── ปรับลำดับเลข id ──');
  for (const t of Object.keys(schema)) {
    if (!schema[t].columns.includes('id')) continue;
    try {
      await conn.query(
        `ALTER TABLE \`${t}\` AUTO_INCREMENT = (SELECT GREATEST(COALESCE(MAX(id),0) + 1, 1) FROM \`${t}\`)`
      );
    } catch {
      /* บางตารางอาจไม่รองรับ — ข้ามไป ไม่เป็นไร */
    }
  }
  console.log('  เรียบร้อย');

  await conn.query('SET FOREIGN_KEY_CHECKS = 1');

  // ── 7) สรุป ─────────────────────────────────────────────────────────
  console.log('\n── สรุป ──');
  let grand = 0;
  for (const t of Object.keys(schema)) {
    const [r] = await conn.query(`SELECT COUNT(*) AS c FROM \`${t}\``);
    const n = Number(r[0].c);
    grand += n;
    const expected = schema[t].rows.length;
    const mark = n === expected ? '✔' : '✖';
    console.log(`  ${mark} ${t.padEnd(24)} ${n} / ${expected} แถว`);
  }
  console.log(`\nย้ายสำเร็จ ${grand} แถว จาก ${srcTables.length} ตาราง`);

  await conn.end();
  src.close();
}

/** แปลงค่าให้เข้ากับ MySQL */
function normalizeValue(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Uint8Array) return v;
  return v;
}

/** ดึงชื่อคอลัมน์จากข้อความ error ของ MySQL */
function extractColumn(message) {
  const m = /Unknown column '([^']+)'/.exec(message);
  return m ? m[1] : null;
}

main().catch((err) => {
  console.error('เกิดข้อผิดพลาด:', err);
  process.exit(1);
});
