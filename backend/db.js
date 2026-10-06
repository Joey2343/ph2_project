'use strict';
/**
 * ฐานข้อมูลระบบศูนย์กลางการบริหารจัดการ สพป.แพร่ เขต 2
 *
 * รองรับ SQLite (ค่าเริ่มต้น) และ MySQL 8.0+/MariaDB 10.4+ (เมื่อตั้ง DATABASE_URL)
 * — ดู db/config.js และ docs/adr/0004-dialect-adapter.md
 *
 * โครงสร้าง schema, migrations และข้อมูลตัวอย่างทั้งหมดยกมาจากระบบรุ่นเดิม
 * เปลี่ยนเฉพาะ: เป็น async + รองรับทั้งสอง dialect
 *
 * เรียกใช้:
 *   const db = require('./db');          // ได้ facade เดียวกันที่ routes/ ใช้
 *   await db.init();                    // เปิดการเชื่อมต่อ
 *   await db.bootstrap();               // สร้าง schema + migration + seed
 */
const db = require('./db/index');
const sql = require('./db/sql');
const bcrypt = require('bcryptjs');

// ── Schema ──────────────────────────────────────────────────────────────────
// DDL ชุดเดิม แปลงชนิดข้อมูลให้ MySQL อัตโนมัติที่ db/sql.js (translateDDL)
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  username          TEXT UNIQUE NOT NULL,
  password_hash     TEXT NOT NULL,
  title             TEXT DEFAULT 'นาย/นาง/นางสาว',
  full_name         TEXT NOT NULL,
  first_name        TEXT,
  last_name         TEXT,
  nickname          TEXT,
  blood_type        TEXT,
  academic_rank     TEXT,
  highest_education TEXT,
  birth_date        TEXT,
  citizen_id        TEXT UNIQUE,
  position          TEXT,
  workplace         TEXT,
  phone             TEXT,
  email             TEXT,
  telegram_token    TEXT,
  telegram_chat_id  TEXT,
  photo             TEXT,
  signature         TEXT,
  role              TEXT NOT NULL DEFAULT 'staff',
  can_approve       INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'pending',
  created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  approved_at       TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS office_sections (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  key     TEXT UNIQUE,
  title   TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  sort    INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS schools (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT,
  name       TEXT NOT NULL,
  group_name TEXT DEFAULT '',
  district   TEXT,
  address    TEXT,
  principal  TEXT,
  phone      TEXT,
  level      TEXT,
  lat        REAL,
  lng        REAL,
  image      TEXT,
  notes      TEXT
);

CREATE TABLE IF NOT EXISTS time_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  date          TEXT NOT NULL,
  clock_in      TEXT,
  clock_out     TEXT,
  note          TEXT,
  clock_in_src  TEXT,
  clock_out_src TEXT,
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS vehicles (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  plate    TEXT,
  type     TEXT,
  capacity INTEGER DEFAULT 0,
  status   TEXT DEFAULT 'available',
  notes    TEXT
);

CREATE TABLE IF NOT EXISTS vehicle_bookings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id  INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  date        TEXT NOT NULL,
  start_time  TEXT,
  end_time    TEXT,
  purpose     TEXT,
  destination TEXT,
  passengers  TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  note            TEXT,
  decided_by      INTEGER,
  decided_at      TEXT,
  approval_level  INTEGER NOT NULL DEFAULT 0,
  approval_data   TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS vehicle_notices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER,
  user_id    INTEGER NOT NULL,
  type       TEXT NOT NULL DEFAULT 'edit', /* 'edit' = มีการแก้ไขการจอง, 'cancel' = ยกเลิกการจอง */
  text       TEXT NOT NULL,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS rooms (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  capacity INTEGER DEFAULT 0,
  location TEXT,
  equipment TEXT,
  status   TEXT DEFAULT 'available',
  notes    TEXT
);

CREATE TABLE IF NOT EXISTS room_bookings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  date        TEXT NOT NULL,
  start_time  TEXT,
  end_time    TEXT,
  topic       TEXT,
  attendees   INTEGER DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending',
  note            TEXT,
  decided_by      INTEGER,
  decided_at      TEXT,
  approval_level  INTEGER NOT NULL DEFAULT 0,
  approval_data   TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS memos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no     TEXT,
  user_id    INTEGER NOT NULL,
  title      TEXT NOT NULL,
  content    TEXT,
  date       TEXT,
  status     TEXT NOT NULL DEFAULT 'draft',
  attachment TEXT,
  office     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS travel_requests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  travel_no  TEXT,
  user_id    INTEGER NOT NULL,
  title      TEXT NOT NULL,
  destination TEXT,
  date_from  TEXT,
  date_to    TEXT,
  days       INTEGER DEFAULT 1,
  vehicle_id INTEGER,
  budget     REAL DEFAULT 0,
  detail     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  note            TEXT,
  decided_by      INTEGER,
  decided_at      TEXT,
  approval_level  INTEGER NOT NULL DEFAULT 0,
  approval_data   TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  leave_no   TEXT,
  user_id    INTEGER NOT NULL,
  leave_type TEXT NOT NULL,
  date_from  TEXT,
  date_to    TEXT,
  days       INTEGER DEFAULT 1,
  reason     TEXT,
  address    TEXT,
  phone      TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  note            TEXT,
  decided_by      INTEGER,
  decided_at      TEXT,
  approval_level  INTEGER NOT NULL DEFAULT 0,
  approval_data   TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS documents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type     TEXT NOT NULL,
  doc_no       TEXT,
  title        TEXT NOT NULL,
  from_org     TEXT,
  to_org       TEXT,
  date         TEXT,
  category     TEXT,
  file         TEXT,
  note         TEXT,
  sender_type  TEXT DEFAULT 'office',
  created_by   INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS document_staff (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_type  TEXT NOT NULL DEFAULT 'office', -- 'office' = สพป., 'school' = สถานศึกษา
  user_id     INTEGER NOT NULL,
  school_code TEXT DEFAULT '',              -- รหัสสถานศึกษา (เฉพาะ school)
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(staff_type, user_id, school_code)
);

CREATE TABLE IF NOT EXISTS document_reads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id      INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  read_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(doc_id, user_id)
);

CREATE TABLE IF NOT EXISTS budgets (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  year     INTEGER,
  category TEXT NOT NULL,
  plan     REAL DEFAULT 0,
  note     TEXT,
  sort     INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS budget_transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  budget_id   INTEGER NOT NULL,
  date        TEXT,
  description TEXT,
  amount      REAL NOT NULL,
  type        TEXT NOT NULL DEFAULT 'expense',
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS academic_projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  kind        TEXT DEFAULT 'project',
  detail      TEXT,
  date_from   TEXT,
  date_to     TEXT,
  status      TEXT NOT NULL DEFAULT 'planned',
  responsible TEXT,
  budget      REAL DEFAULT 0,
  result      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS user_leave_balances (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  year       INTEGER NOT NULL,
  vacation_accumulated REAL NOT NULL DEFAULT 0,
  vacation_annual     REAL NOT NULL DEFAULT 0,
  UNIQUE(user_id, year)
);

-- ตารางผู้รับหนังสือ (ที่เดิมถูกสร้างนอกซอร์ส — ย้ายเข้ามาให้ครบ)
CREATE TABLE IF NOT EXISTS document_recipients (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id  INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  is_read      INTEGER DEFAULT 0,
  read_at      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ตารางภัยธรรมชาติ (เก็บข้อมูลไว้ใน schools แต่ยังมีโค้ดอ้างถึงตารางนี้)
CREATE TABLE IF NOT EXISTS disasters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  location   TEXT,
  district   TEXT,
  date       TEXT,
  time       TEXT,
  detail     TEXT,
  damage     TEXT,
  status     TEXT NOT NULL DEFAULT 'reported',
  user_id    INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;

// ── Migrations ──────────────────────────────────────────────────────────────
// คอลัมน์ที่ฐานข้อมูลเดิมมี แต่ DDL ไม่ได้ประกาศ (บางส่วนเคยถูกสร้างจาก
// การรันระบบจริงนอกซอร์ส) — ต้องอยู่ในรายการนี้ มิฉะนั้น MySQL ที่ติดตั้งใหม่จะ query ไม่ผ่าน
const COLUMN_MIGRATIONS = [
  ['users', 'first_name', 'TEXT'],
  ['users', 'last_name', 'TEXT'],
  ['users', 'nickname', 'TEXT'],
  ['users', 'birth_date', 'TEXT'],
  ['users', 'blood_type', 'TEXT'],
  ['users', 'academic_rank', 'TEXT'],
  ['users', 'highest_education', 'TEXT'],
  ['users', 'staff_no', 'TEXT'], /* ลำดับเจ้าหน้าที่ (ใส่หรือไม่ใส่ก็ได้ — ใช้จัดเรียงในบางเมนู) */
  ['users', 'telegram_token', 'TEXT'],
  ['users', 'telegram_chat_id', 'TEXT'],
  ['users', 'can_approve', 'INTEGER NOT NULL DEFAULT 0'],
  // ↓ เคยถูกสร้างนอกซอร์ส — จำเป็นต่อการเลือกโรงเรียนและการจัดทะเบียน
  ['users', 'school_code', "TEXT DEFAULT ''"],
  ['users', 'user_group', "TEXT DEFAULT 'office'"],
  ['users', 'workplace_secondary', "TEXT DEFAULT '[]'"],
  ['users', 'current_school', "TEXT DEFAULT ''"],

  ['schools', 'disaster', 'TEXT'], /* ภัยธรรมชาติ จากไฟล์ Definition (น้ำท่วม/พายุ/แผ่นดินไหว/ไม่เกิดภัยธรรมชาติ) */
  ['schools', 'disaster_image', 'TEXT'], /* รูปภาพความเสียหายจากภัยธรรมชาติ (path ใน uploads) */

  ['vehicles', 'photo', 'TEXT'],

  ['vehicle_bookings', 'approval_level', 'INTEGER NOT NULL DEFAULT 0'],
  ['vehicle_bookings', 'approval_data', "TEXT NOT NULL DEFAULT '[]'"],
  ['vehicle_bookings', 'date_to', 'TEXT'],
  ['vehicle_bookings', 'total_days', 'INTEGER NOT NULL DEFAULT 1'],
  ['vehicle_bookings', 'passenger_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['vehicle_bookings', 'controller', 'TEXT'],
  ['vehicle_bookings', 'fuel_choice', 'TEXT'],
  ['vehicle_bookings', 'fuel_project', 'TEXT'],
  ['vehicle_bookings', 'fuel_activity', 'TEXT'],
  ['vehicle_bookings', 'fuel_amount', 'REAL NOT NULL DEFAULT 0'],
  ['vehicle_bookings', 'self_drive', 'INTEGER NOT NULL DEFAULT 0'],
  ['vehicle_bookings', 'driver_name', 'TEXT'],
  ['vehicle_bookings', 'booking_no', 'TEXT'],

  ['room_bookings', 'approval_level', 'INTEGER NOT NULL DEFAULT 0'],
  ['room_bookings', 'approval_data', "TEXT NOT NULL DEFAULT '[]'"],
  ['room_bookings', 'booking_no', 'TEXT'],

  ['travel_requests', 'approval_level', 'INTEGER NOT NULL DEFAULT 0'],
  ['travel_requests', 'approval_data', "TEXT NOT NULL DEFAULT '[]'"],
  // ↓ เก็บรายละเอียดค่าใช้จ่าย/ไฟล์แนบของแบบฟอร์มไปราชการ
  ['travel_requests', 'form_data', "TEXT DEFAULT '{}'"],

  ['leave_requests', 'approval_level', 'INTEGER NOT NULL DEFAULT 0'],
  ['leave_requests', 'approval_data', "TEXT NOT NULL DEFAULT '[]'"],
  ['leave_requests', 'writing_at', 'TEXT'],
  ['leave_requests', 'last_leave_from', 'TEXT'],
  ['leave_requests', 'last_leave_to', 'TEXT'],
  ['leave_requests', 'last_leave_days', 'INTEGER'],
  ['leave_requests', 'attachment', 'TEXT'],
  ['leave_requests', 'delegate_to', 'INTEGER'],
  ['leave_requests', 'reviewed', 'INTEGER NOT NULL DEFAULT 0'],
  ['leave_requests', 'reviewed_stats', 'TEXT'],
  ['leave_requests', 'cancel_status', "TEXT DEFAULT ''"], /* ขอยกเลิกวันลา: 'cancel_requested' = รอผู้ตรวจสอบยกเลิก */

  // ตาราง documents (เดิมเพิ่มผ่าน ALTER TABLE ที่ระดับ module ใน routes/admin.js)
  ['documents', 'reg_no', 'TEXT DEFAULT ""'],
  ['documents', 'workgroup', 'TEXT DEFAULT ""'],
  ['documents', 'is_registered', 'INTEGER DEFAULT 0'], // สถานะลงทะเบียนรับหนังสือ: 1 = ลงทะเบียนแล้ว
  ['documents', 'body_text', 'TEXT DEFAULT ""'],
  ['documents', 'priority', 'TEXT DEFAULT "normal"'],
  ['documents', 'cert_status', 'TEXT DEFAULT "กำลังดำเนินการ"'], // สถานะหนังสือรับรอง
  ['documents', 'person_name', 'TEXT DEFAULT ""'], // ชื่อ-นามสกุล ผู้ได้รับเกียรติบัตร
  ['documents', 'person_school', 'TEXT DEFAULT ""'], // โรงเรียนของผู้ได้รับเกียรติบัตร
  ['documents', 'honor_signer', 'TEXT DEFAULT ""'], // ผู้ลงนามเกียรติบัตร (staff id)
  ['documents', 'honor_template', 'TEXT DEFAULT ""'], // แบบเกียรติบัตรที่เลือก (form/certificate/1.png หรือ 2.png)
  ['documents', 'honor_saved_file', 'TEXT DEFAULT ""'], // ไฟล์เกียรติบัตรที่บันทึกไว้ (honors/xxx.jpg)
  ['documents', 'requester', 'TEXT DEFAULT ""'], // ผู้ขอ (หนังสือรับรอง)
  ['documents', 'cert_position', 'TEXT DEFAULT ""'], // ตำแหน่งผู้ขอ (หนังสือรับรอง)
  ['documents', 'owner_group', 'TEXT DEFAULT ""'], // เจ้าของเรื่อง (สถานศึกษา/หน่วยงาน)
  ['documents', 'order_registrar', 'TEXT DEFAULT ""'], // ผู้ลงทะเบียนคำสั่ง (รายชื่อ ผอ.สพป.แพร่ เขต 2)
  ['documents', 'officer', 'TEXT DEFAULT ""'], // เจ้าหน้าที่(ผู้ปฏิบัติ) (หนังสือรับรอง)
  ['documents', 'school_code', "TEXT DEFAULT ''"], // รหัสสถานศึกษาผู้ส่ง (ใช้แยกหนังสือระหว่างโรงเรียน)

  ['document_staff', 'doc_prefix', "TEXT DEFAULT ''"], // คำนำหน้าเลขหนังสือของโรงเรียน
  ['document_recipients', 'as_school', 'TEXT DEFAULT ""'],

  ['time_records', 'clock_in_src', 'TEXT'],
  ['time_records', 'clock_out_src', 'TEXT'],

  // ตาราง memos (คอลัมน์ชุดที่สองของระบบบันทึกข้อความ)
  ['memos', 'office', 'TEXT'],
  ['memos', 'urgency', 'TEXT'],
  ['memos', 'to_text', 'TEXT'],
  ['memos', 'ref_files', 'TEXT'],
  ['memos', 'enc_files', 'TEXT'],
  ['memos', 'draft_file', 'TEXT'],
  ['memos', 'send_to', 'TEXT'],
  ['memos', 'approval_level', 'INTEGER NOT NULL DEFAULT 0'],
  ['memos', 'approval_data', "TEXT NOT NULL DEFAULT '[]'"],
  ['memos', 'approval_chain', 'TEXT'],
  ['memos', 'decided_by', 'INTEGER'],
  ['memos', 'decided_at', 'TEXT'],
  ['memos', 'note', 'TEXT'],
  ['memos', 'revision_note', 'TEXT'],
  ['memos', 'next_approver_id', 'INTEGER'],
];

/**
 * เพิ่มคอลัมน์ถ้ายังไม่มี
 * ใช้ information_schema ของ MySQL / PRAGMA table_info ของ SQLite
 * (MySQL 8 ไม่มี ALTER TABLE ADD COLUMN IF NOT EXISTS)
 *
 * นิยามคอลัมน์ใน COLUMN_MIGRATIONS เขียนแบบ SQLite ไว้ (เช่น "TEXT DEFAULT 'x'")
 * จึงต้องผ่าน addColumnSql เพื่อแปลงเป็นชนิดข้อมูลของ dialect ปัจจุบัน
 */
async function ensureColumn(table, col, ddl) {
  const cols = await db.columns(table);
  if (!cols.some((c) => c.name === col)) {
    await db.exec(sql.addColumnSql(table, col, ddl, db.isMaria, db.collation));
    return true;
  }
  return false;
}

async function migrate() {
  for (const [table, col, ddl] of COLUMN_MIGRATIONS) {
    await ensureColumn(table, col, ddl);
  }

  // ผู้ใช้เดิม role 'member' → เปลี่ยนเป็น 'staff' (เจ้าหน้าที่ในสำนักงาน)
  await db.prepare("UPDATE users SET role = 'staff' WHERE role = 'member'").run();

  // ห้องประชุม: 2 ขั้นการอนุมัติ (อนุมัติขั้นต้น → อนุมัติขั้นสุดท้าย)
  const approvalRoom = await db.prepare("SELECT value FROM settings WHERE `key` = 'approval_room'").get();
  if (approvalRoom && approvalRoom.value === '1') {
    await db.prepare("UPDATE settings SET value = '2' WHERE `key` = 'approval_room'").run();
    console.log('[migrate] ตั้งค่าการอนุมัติห้องประชุมเป็น 2 ขั้น');
  }

  // ยานพาหนะ: 2 ขั้นการอนุมัติ (อนุมัติขั้นต้น → อนุมัติขั้นสุดท้าย)
  const approvalVehicle = await db.prepare("SELECT value FROM settings WHERE `key` = 'approval_vehicle'").get();
  if (approvalVehicle && approvalVehicle.value === '1') {
    await db.prepare("UPDATE settings SET value = '2' WHERE `key` = 'approval_vehicle'").run();
    console.log('[migrate] ตั้งค่าการอนุมัติยานพาหนะเป็น 2 ขั้น');
  }

  // รวมรายการผู้อนุมัติห้องประชุม + ยานพาหนะเป็นชุดเดียว (approvers_booking)
  // เพื่อให้คนที่ admin ตั้งสิทธิ์ไว้ ใช้ร่วมกันทั้ง 2 ระบบ
  const existingBooking = await db
    .prepare("SELECT value FROM settings WHERE `key` = 'approvers_booking'")
    .get();
  if (!existingBooking) {
    const read = async (key) => {
      const row = await db.prepare('SELECT value FROM settings WHERE `key` = ?').get(key);
      try {
        const o = JSON.parse(row ? row.value : '{}');
        return o && typeof o === 'object' ? o : {};
      } catch (e) {
        return {};
      }
    };
    const merge = (a, b) => [
      ...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]),
    ];
    const r = await read('room_approvers');
    const v = await read('vehicle_approvers');
    const merged = {
      1: merge(r['1'], v['1']).map(Number),
      2: merge(r['2'], v['2']).map(Number),
    };
    await db
      .prepare("INSERT INTO settings (`key`, value) VALUES ('approvers_booking', ?)")
      .run(JSON.stringify(merged));
    console.log(
      '[migrate] รวมรายการผู้อนุมัติห้องประชุม+ยานพาหนะเป็น approvers_booking:',
      JSON.stringify(merged)
    );
  }
}

// ── Seed ────────────────────────────────────────────────────────────────────
async function seed() {
  // จำนวนขั้นการอนุมัติของแต่ละระบบ (ห้องประชุม = 2 ขั้น: อนุมัติขั้นต้น → อนุมัติขั้นสุดท้าย)
  for (const [key, def] of [
    ['approval_vehicle', '2'],
    ['approval_room', '2'],
    ['approval_travel', '1'],
    ['approval_leave', '1'],
    ['time_edit_users', '[]'],
    ['room_approvers', '{}'],
    ['vehicle_approvers', '{}'],
    ['approvers_booking', '{}'],
    ['memo_approvers', '{}'],
  ]) {
    const found = await db.prepare('SELECT value FROM settings WHERE `key` = ?').get(key);
    if (!found) {
      await db.prepare('INSERT INTO settings (`key`, value) VALUES (?,?)').run(key, def);
    }
  }

  // บัญชีผู้ดูแลระบบ: username = admin (เดิมใช้ joey2343 — เปลี่ยนชื่อให้เป็น admin, ข้อมูลอื่นคงเดิม)
  const admin = await db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!admin) {
    const old = await db.prepare('SELECT id FROM users WHERE username = ?').get('joey2343');
    if (old) {
      await db.prepare('UPDATE users SET username = ? WHERE id = ?').run('admin', old.id);
      console.log('[seed] เปลี่ยนชื่อบัญชีผู้ดูแลระบบ: joey2343 → admin');
    } else {
      const hash = bcrypt.hashSync('Joey2343**', 10);
      await db
        .prepare(`INSERT INTO users (username, password_hash, title, full_name, citizen_id, position, workplace, role, status, approved_at)
                  VALUES (?,?,?,?,?,?,?,?,?, datetime('now','localtime'))`)
        .run(
          'admin',
          hash,
          'นาย',
          'ผู้ดูแลระบบ (Admin)',
          '0000000000000',
          'ผู้ดูแลระบบ',
          'กลุ่มอำนวยการ',
          'admin',
          'active'
        );
      console.log('[seed] สร้างบัญชีผู้ดูแลระบบ: admin');
    }
  }

  const count = await db.prepare('SELECT COUNT(*) c FROM office_sections').get();
  if (count.c === 0) {
    const insert = db.prepare(
      'INSERT INTO office_sections (`key`, title, content, sort) VALUES (?,?,?,?)'
    );
    await insert.run(
      'history',
      'ประวัติความเป็นมา',
      `สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2 เป็นหน่วยงานราชการสังกัดสำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน (สพฐ.) กระทรวงศึกษาธิการ รับผิดชอบการบริหารจัดการศึกษาระดับประถมศึกษาและขยายโอกาสทางการศึกษาในเขตพื้นที่จังหวัดแพร่ เขต 2 ครอบคลุมอำเภอเด่นชัย อำเภอลอง อำเภอวังชิ้น อำเภอสอง อำเภอสบเมย อำเภอหนองม่วงไข่ และอำเภอร้องกวาง\n\n(สามารถแก้ไขเนื้อหาส่วนนี้ได้โดยผู้ดูแลระบบ)`,
      1
    );
    await insert.run(
      'vision',
      'วิสัยทัศน์ (Vision)',
      `"องค์กรคุณภาพ บริหารจัดการศึกษาให้ทันสมัย บุคลากรเป็นมืออาชีพ ผู้เรียนมีคุณภาพตามมาตรฐานสู่ความสุขอย่างยั่งยืน"\n\n**พันธกิจ (Mission)**\n1. ส่งเสริมการจัดการศึกษาให้มีคุณภาพตามมาตรฐานการศึกษา\n2. พัฒนาบุคลากรทางการศึกษาให้เป็นมืออาชีพ\n3. บริหารจัดการทรัพยากรอย่างมีประสิทธิภาพ โปร่งใส ตรวจสอบได้\n4. ส่งเสริมการมีส่วนร่วมของทุกภาคส่วนในการจัดการศึกษา`,
      2
    );
    await insert.run(
      'structure',
      'โครงสร้างหน่วยงาน',
      `- กลุ่มอำนวยการ\n- กลุ่มบริหารงานบุคคล\n- กลุ่มนโยบายและแผน\n- กลุ่มส่งเสริมการจัดการศึกษา\n- กลุ่มนิเทศ ติดตาม และประเมินผลการจัดการศึกษา\n- กลุ่มบริหารการเงินและสินทรัพย์\n- หน่วยตรวจสอบภายใน\n\n(สามารถแก้ไขเนื้อหาส่วนนี้ได้โดยผู้ดูแลระบบ)`,
      3
    );
    await insert.run(
      'contact',
      'ที่อยู่และการติดต่อ',
      `ที่อยู่ : สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2\nโทรศัพท์ : 0-0000-0000\nโทรสาร : 0-0000-0000\nอีเมล : phrae2@example.go.th\nเว็บไซต์ : www.phrae2.example.go.th\n\n(สามารถแก้ไขเนื้อหาส่วนนี้ได้โดยผู้ดูแลระบบ)`,
      4
    );
    await insert.run(
      'duty',
      'อำนาจหน้าที่',
      `1. อำนาจหน้าที่ตามกฎหมายว่าด้วยระเบียบบริหารราชการกระทรวงศึกษาธิการ\n2. จัดทำนโยบาย แผนพัฒนา และมาตรฐานการศึกษาของเขตพื้นที่การศึกษา ให้สอดคล้องกับนโยบายและมาตรฐานการศึกษาชาติ\n3. วิเคราะห์ จัดสรรงบประมาณเงินอุดหนุนทั่วไปของสถานศึกษา และหน่วยงานในสังกัด\n4. ประสาน ส่งเสริม สนับสนุน และพัฒนาหลักสูตรการศึกษาร่วมกับสถานศึกษาในสังกัด\n5. ศึกษาวิเคราะห์ วิจัย ติดตาม ตรวจสอบ และประเมินผลการจัดการศึกษา\n6. กำกับดูแล ดูแล ปลดเปลื้องและพิทักษ์สิทธิเด็กและเยาวชนในเขตพื้นที่การศึกษา\n7. ปฏิบัติภารกิจอื่นตามที่ได้รับมอบหมาย\n\n(สามารถแก้ไขเนื้อหาส่วนนี้ได้โดยผู้ดูแลระบบ)`,
      5
    );
    console.log('[seed] สร้างข้อมูลพื้นฐานหน่วยงาน');
  }

  const schoolCount = await db.prepare('SELECT COUNT(*) c FROM schools').get();
  if (schoolCount.c === 0) {
    const insert = db.prepare(
      `INSERT INTO schools (code, name, district, address, principal, phone, level, lat, lng, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    );
    const schools = [
      ['10130101', 'โรงเรียนอนุบาลเด่นชัย', 'เด่นชัย', 'ต.เด่นชัย อ.เด่นชัย จ.แพร่', 'นายสมชาย ใจดี', '054-000000', 'อนุบาล - ป.6', 18.228, 100.143, 'ข้อมูลตัวอย่าง'],
      ['10130102', 'โรงเรียนเด่นชัยวิทยาคม', 'เด่นชัย', 'ต.เด่นชัย อ.เด่นชัย จ.แพร่', 'นางสาววิไล รักเรียน', '054-000001', 'ม.1 - ม.6', 18.235, 100.135, 'ข้อมูลตัวอย่าง'],
      ['10130201', 'โรงเรียนบ้านแม่คำมี', 'ลอง', 'ต.แม่ปาน อ.ลอง จ.แพร่', 'นายประเสริฐ มากมี', '054-000002', 'อนุบาล - ป.6', 18.100, 99.855, 'ข้อมูลตัวอย่าง'],
      ['10130202', 'โรงเรียนชุมชนบ้านแม่หล่าย', 'ลอง', 'ต.แม่หล่าย อ.ลอง จ.แพร่', 'นางทองดี ใจบุญ', '054-000003', 'อนุบาล - ม.3', 18.085, 99.845, 'ข้อมูลตัวอย่าง'],
      ['10130301', 'โรงเรียนวังชิ้นวิทยา', 'วังชิ้น', 'ต.วังชิ้น อ.วังชิ้น จ.แพร่', 'นายไกรสร แก้วใส', '054-000004', 'ม.1 - ม.6', 17.900, 99.610, 'ข้อมูลตัวอย่าง'],
      ['10130401', 'โรงเรียนสบเมยวิทยาคม', 'สบเมย', 'ต.แม่เกิ๋ง อ.สบเมย จ.แพร่', 'นางสาวศรีวรรณ แสงจันทร์', '054-000005', 'ม.1 - ม.6', 18.080, 99.780, 'ข้อมูลตัวอย่าง'],
      ['10130501', 'โรงเรียนหนองม่วงไข่พิทยาคม', 'หนองม่วงไข่', 'ต.หนองม่วงไข่ อ.หนองม่วงไข่ จ.แพร่', 'นายอดิศักดิ์ หมื่นศรี', '054-000006', 'ม.1 - ม.6', 18.290, 100.060, 'ข้อมูลตัวอย่าง'],
      ['10130601', 'โรงเรียนร้องกวางอนุสรณ์', 'ร้องกวาง', 'ต.ร้องกวาง อ.ร้องกวาง จ.แพร่', 'นางพัชรี วงศ์ใหม่', '054-000007', 'อนุบาล - ม.3', 18.330, 100.175, 'ข้อมูลตัวอย่าง'],
      ['10130701', 'โรงเรียนบ้านสองแคว', 'สอง', 'ต.สอง อ.สอง จ.แพร่', 'นายสามารถ วัฒนา', '054-000008', 'อนุบาล - ป.6', 18.190, 100.100, 'ข้อมูลตัวอย่าง'],
    ];
    for (const s of schools) await insert.run(...s);
    console.log('[seed] สร้างข้อมูลโรงเรียนตัวอย่าง');
  }

  const vCount = await db.prepare('SELECT COUNT(*) c FROM vehicles').get();
  if (vCount.c === 0) {
    const insert = db.prepare(
      'INSERT INTO vehicles (name, plate, type, capacity, status, notes) VALUES (?,?,?,?,?,?)'
    );
    await insert.run('รถตู้โดยสาร 12 ที่นั่ง', 'กฉ 1234 แพร่', 'รถตู้', 12, 'available', 'ข้อมูลตัวอย่าง');
    await insert.run('รถยนต์นั่งส่วนกลาง', 'กท 5678 แพร่', 'รถยนต์', 5, 'available', 'ข้อมูลตัวอย่าง');
    await insert.run('รถกระบะบรรทุกของ', 'บฉ 9012 แพร่', 'รถกระบะ', 4, 'available', 'ข้อมูลตัวอย่าง');
    console.log('[seed] สร้างข้อมูลยานพาหนะตัวอย่าง');
  }

  const rCount = await db.prepare('SELECT COUNT(*) c FROM rooms').get();
  if (rCount.c === 0) {
    const insert = db.prepare(
      'INSERT INTO rooms (name, capacity, location, equipment, status) VALUES (?,?,?,?,?)'
    );
    await insert.run('ห้องประชุมใหญ่ ชั้น 2', 60, 'อาคารอำนวยการ ชั้น 2', 'โปรเจกเตอร์, จอ, ไมโครโฟน, เครื่องเสียง', 'available');
    await insert.run('ห้องประชุมกลุ่มบริหาร', 20, 'อาคารอำนวยการ ชั้น 1', 'ทีวี LED, กระดานไวท์บอร์ด', 'available');
    await insert.run('ห้องประชุมอบรมสัมมนา', 40, 'อาคารเอนกประสงค์', 'โปรเจกเตอร์, คอมพิวเตอร์, เครื่องเสียง', 'available');
    console.log('[seed] สร้างข้อมูลห้องประชุมตัวอย่าง');
  }

  const bCount = await db.prepare('SELECT COUNT(*) c FROM budgets').get();
  if (bCount.c === 0) {
    const insert = db.prepare(
      'INSERT INTO budgets (year, category, plan, note, sort) VALUES (?,?,?,?,?)'
    );
    await insert.run(2569, 'งบบุคลากร', 0, 'ค่าตอบแทนบุคลากร', 1);
    await insert.run(2569, 'งบดำเนินงาน', 0, 'ค่าใช้จ่ายในการดำเนินงานประจำ', 2);
    await insert.run(2569, 'งบลงทุน', 0, 'ครุภัณฑ์และที่ดินสิ่งก่อสร้าง', 3);
    await insert.run(2569, 'งบรายจ่ายอื่น', 0, 'ค่าใช้จ่ายอื่น ๆ', 4);
    console.log('[seed] สร้างข้อมูลงบประมาณตัวอย่าง');
  }

  const aCount = await db.prepare('SELECT COUNT(*) c FROM academic_projects').get();
  if (aCount.c === 0) {
    const insert = db.prepare(
      `INSERT INTO academic_projects (name, kind, detail, date_from, date_to, status, responsible, budget, result)
       VALUES (?,?,?,?,?,?,?,?,?)`
    );
    await insert.run('โครงการยกระดับผลสัมฤทธิ์ทางการเรียน O-NET', 'project', 'พัฒนาครูและนักเรียนเพื่อยกระดับผลการทดสอบระดับชาติ', '2569-05-01', '2569-09-30', 'planned', 'กลุ่มนิเทศ ติดตามฯ', 50000, '');
    await insert.run('กิจกรรมพัฒนาการอ่านออกเขียนได้', 'activity', 'ส่งเสริมการอ่านของนักเรียนระดับประถมศึกษา', '2569-06-01', '2569-12-31', 'ongoing', 'กลุ่มส่งเสริมการจัดการศึกษา', 20000, '');
    await insert.run('โครงการโรงเรียนปลอดขยะ', 'project', 'ส่งเสริมการจัดการขยะในสถานศึกษา', '2569-07-01', '2569-11-30', 'planned', 'กลุ่มนิเทศ ติดตามฯ', 15000, '');
    console.log('[seed] สร้างข้อมูลงานวิชาการตัวอย่าง');
  }
}

// ── Bootstrap ───────────────────────────────────────────────────────────────

/** สร้าง schema + migration + seed — ปลอดภัยเมื่อเรียกซ้ำ (idempotent) */
async function bootstrap() {
  await db.exec(SCHEMA_SQL);
  await migrate();
  await seed();
  return true;
}

module.exports = db;
module.exports.bootstrap = bootstrap;
module.exports.migrate = migrate;
module.exports.seed = seed;
module.exports.COLUMN_MIGRATIONS = COLUMN_MIGRATIONS;
module.exports.SCHEMA_SQL = SCHEMA_SQL;

// รองรับคำสั่ง: node db.js --seed  |  node db.js --init
if (require.main === module) {
  const wantSeed = process.argv.includes('--seed');
  const wantInit = process.argv.includes('--init');
  if (wantSeed || wantInit) {
    db.init()
      .then(() => bootstrap())
      .then(() => {
        console.log(`ฐานข้อมูล: ${db.connectionInfo}`);
        console.log(wantInit ? 'สร้าง schema เสร็จเรียบร้อย' : 'Seeding database เสร็จเรียบร้อย');
        return db.close();
      })
      .then(() => process.exit(0))
      .catch((err) => {
        console.error('เกิดข้อผิดพลาด:', err);
        process.exit(1);
      });
  }
}
