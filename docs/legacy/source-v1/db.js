'use strict';
/**
 * ฐานข้อมูลระบบศูนย์กลางการบริหารจัดการ สพป.แพร่ เขต 2
 * ใช้ SQLite ผ่าน better-sqlite3
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'data.db');
if (!fs.existsSync(path.dirname(DB_PATH))) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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
)`);


// Add missing columns to documents table
try { db.exec('ALTER TABLE documents ADD COLUMN reg_no TEXT DEFAULT ""'); } catch(e) {}
try { db.exec('ALTER TABLE documents ADD COLUMN workgroup TEXT DEFAULT ""'); } catch(e) {}
// สถานะลงทะเบียนรับหนังสือ: 1 = ลงทะเบียนแล้ว (แสดงในแทปทะเบียนหนังสือรับ)
try { db.exec('ALTER TABLE documents ADD COLUMN is_registered INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE documents ADD COLUMN body_text TEXT DEFAULT ""'); } catch(e) {}
try { db.exec('ALTER TABLE documents ADD COLUMN priority TEXT DEFAULT "normal"'); } catch(e) {}
try { db.exec('ALTER TABLE documents ADD COLUMN cert_status TEXT DEFAULT "กำลังดำเนินการ"'); } catch(e) {} // สถานะหนังสือรับรอง

db.exec(`
CREATE TABLE IF NOT EXISTS document_staff (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_type  TEXT NOT NULL DEFAULT 'office', -- 'office' = สพป., 'school' = สถานศึกษา
  user_id     INTEGER NOT NULL,
  school_code TEXT DEFAULT '',              -- รหัสสถานศึกษา (เฉพาะ school)
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(staff_type, user_id, school_code)
)`);

db.exec(`
CREATE TABLE IF NOT EXISTS document_reads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id      INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  read_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(doc_id, user_id)
)`);

db.exec(`

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
)`);


// ---- Migration: เพิ่มคอลัมน์ใหม่สำหรับฐานข้อมูลเดิม ----
function ensureColumn(table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}

[
  ['users', 'first_name', 'TEXT'],
  ['users', 'last_name', 'TEXT'],
  ['users', 'nickname', 'TEXT'],
  ['users', 'birth_date', 'TEXT'],
  ['users', 'blood_type', 'TEXT'],
  ['users', 'academic_rank', 'TEXT'],
  ['users', 'highest_education', 'TEXT'],
  ['users', 'staff_no', 'TEXT'], /* ลำดับเจ้าหน้าที่ (ใส่หรือไม่ใส่ก็ได้ — ใช้จัดเรียงในบางเมนู) */
  ['schools', 'disaster', 'TEXT'], /* ภัยธรรมชาติ จากไฟล์ Definition (น้ำท่วม/พายุ/แผ่นดินไหว/ไม่เกิดภัยธรรมชาติ) */
  ['schools', 'disaster_image', 'TEXT'], /* รูปภาพความเสียหายจากภัยธรรมชาติ (path ใน uploads) */
  ['users', 'telegram_token', 'TEXT'],
  ['users', 'telegram_chat_id', 'TEXT'],
  ['users', 'can_approve', 'INTEGER NOT NULL DEFAULT 0'],
  ['vehicles', 'photo', 'TEXT'],
  ['vehicle_bookings', 'approval_level', 'INTEGER NOT NULL DEFAULT 0'],
  ['vehicle_bookings', 'approval_data', 'TEXT NOT NULL DEFAULT \'[]\''],
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
  ['room_bookings', 'approval_level', 'INTEGER NOT NULL DEFAULT 0'],
  ['room_bookings', 'approval_data', 'TEXT NOT NULL DEFAULT \'[]\''],
  ['travel_requests', 'approval_level', 'INTEGER NOT NULL DEFAULT 0'],
  ['travel_requests', 'approval_data', 'TEXT NOT NULL DEFAULT \'[]\''],
  ['leave_requests', 'approval_level', 'INTEGER NOT NULL DEFAULT 0'],
  ['leave_requests', 'approval_data', 'TEXT NOT NULL DEFAULT \'[]\''],
  ['leave_requests', 'writing_at', 'TEXT'],
  ['leave_requests', 'last_leave_from', 'TEXT'],
  ['leave_requests', 'last_leave_to', 'TEXT'],
  ['leave_requests', 'last_leave_days', 'INTEGER'],
  ['users', 'user_group', "TEXT DEFAULT 'office'"],
  ['users', 'workplace_secondary', "TEXT DEFAULT '[]'"],
  ['users', 'current_school', "TEXT DEFAULT ''"],
  ['leave_requests', 'attachment', 'TEXT'],
  ['leave_requests', 'delegate_to', 'INTEGER'],
  ['leave_requests', 'reviewed', 'INTEGER NOT NULL DEFAULT 0'],
  ['leave_requests', 'reviewed_stats', 'TEXT'],
  ['leave_requests', 'cancel_status', "TEXT DEFAULT ''"], /* ขอยกเลิกวันลา: 'cancel_requested' = รอผู้ตรวจสอบยกเลิก */
  ['vehicle_bookings', 'booking_no', 'TEXT'],
  ['room_bookings', 'booking_no', 'TEXT'],
].forEach(([t, c, d]) => ensureColumn(t, c, d));

// ผู้ใช้เดิม role 'member' → เปลี่ยนเป็น 'staff' (เจ้าหน้าที่ในสำนักงาน)
db.prepare("UPDATE users SET role = 'staff' WHERE role = 'member'").run();

// ห้องประชุม: 2 ขั้นการอนุมัติ (อนุมัติขั้นต้น → อนุมัติขั้นสุดท้าย)
const approvalRoom = db.prepare("SELECT value FROM settings WHERE key = 'approval_room'").get();
if (approvalRoom && approvalRoom.value === '1') {
  db.prepare("UPDATE settings SET value = '2' WHERE key = 'approval_room'").run();
  console.log('[migrate] ตั้งค่าการอนุมัติห้องประชุมเป็น 2 ขั้น');
}

// ยานพาหนะ: 2 ขั้นการอนุมัติ (อนุมัติขั้นต้น → อนุมัติขั้นสุดท้าย)
const approvalVehicle = db.prepare("SELECT value FROM settings WHERE key = 'approval_vehicle'").get();
if (approvalVehicle && approvalVehicle.value === '1') {
  db.prepare("UPDATE settings SET value = '2' WHERE key = 'approval_vehicle'").run();
  console.log('[migrate] ตั้งค่าการอนุมัติยานพาหนะเป็น 2 ขั้น');
}

// รวมรายการผู้อนุมัติห้องประชุม + ยานพาหนะเป็นชุดเดียว (approvers_booking)
// เพื่อให้คนที่ admin ตั้งสิทธิ์ไว้ ใช้ร่วมกันทั้ง 2 ระบบ
if (!db.prepare("SELECT value FROM settings WHERE key = 'approvers_booking'").get()) {
  const read = (key) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    try { const o = JSON.parse(row ? row.value : '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
  };
  const merge = (a, b) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])];
  const r = read('room_approvers'), v = read('vehicle_approvers');
  const merged = {
    1: merge(r['1'], v['1']).map(Number),
    2: merge(r['2'], v['2']).map(Number),
  };
  db.prepare("INSERT INTO settings (key, value) VALUES ('approvers_booking', ?)").run(JSON.stringify(merged));
  console.log('[migrate] รวมรายการผู้อนุมัติห้องประชุม+ยานพาหนะเป็น approvers_booking:', JSON.stringify(merged));
}

// เพิ่มคอลัมน์บันทึกแหล่งที่มาของการลงเวลา (GPS/IP) ในตาราง time_records
{
  const cols = db.prepare('PRAGMA table_info(time_records)').all().map((c) => c.name);
  for (const col of ['clock_in_src', 'clock_out_src']) {
    if (!cols.includes(col)) {
      db.exec(`ALTER TABLE time_records ADD COLUMN ${col} TEXT`);
      console.log(`[migrate] เพิ่มคอลัมน์ ${col} ในตาราง time_records`);
    }
  }
}

// เพิ่มคอลัมน์ในตาราง memos: ส่วนราชการ (office), เรียน (to_text), ไฟล์แนบอ้างถึง/สิ่งที่ส่งมาด้วย/ร่างหนังสือส่ง, ผู้รับ (send_to)
{
  const cols = db.prepare('PRAGMA table_info(memos)').all().map((c) => c.name);
  for (const [col, ddl] of [
    ['office', 'TEXT'],
    ['urgency', 'TEXT'],
    ['to_text', 'TEXT'],
    ['ref_files', 'TEXT'],
    ['enc_files', 'TEXT'],
    ['draft_file', 'TEXT'],
    ['send_to', 'TEXT'],
    ['approval_level', 'INTEGER NOT NULL DEFAULT 0'],
    ['approval_data', 'TEXT NOT NULL DEFAULT \'[]\''],
    ['approval_chain', 'TEXT'],
    ['decided_by', 'INTEGER'],
    ['decided_at', 'TEXT'],
    ['note', 'TEXT'],
    ['revision_note', 'TEXT'],
    ['next_approver_id', 'INTEGER'],
  ]) {
    if (!cols.includes(col)) {
      db.exec(`ALTER TABLE memos ADD COLUMN ${col} ${ddl}`);
      console.log(`[migrate] เพิ่มคอลัมน์ ${col} ในตาราง memos`);
    }
  }
}

// ---- Seed ข้อมูลเริ่มต้น ----
function seed() {
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
    if (!db.prepare('SELECT value FROM settings WHERE key = ?').get(key)) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?,?)').run(key, def);
    }
  }

  // บัญชีผู้ดูแลระบบ: username = admin (เดิมใช้ joey2343 — เปลี่ยนชื่อให้เป็น admin, ข้อมูลอื่นคงเดิม)
  const admin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!admin) {
    const old = db.prepare('SELECT id FROM users WHERE username = ?').get('joey2343');
    if (old) {
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run('admin', old.id);
      console.log('[seed] เปลี่ยนชื่อบัญชีผู้ดูแลระบบ: joey2343 → admin');
    } else {
      const hash = bcrypt.hashSync('Joey2343**', 10);
      db.prepare(`INSERT INTO users (username, password_hash, title, full_name, citizen_id, position, workplace, role, status, approved_at)
                  VALUES (?,?,?,?,?,?,?,?,?, datetime('now','localtime'))`)
        .run('admin', hash, 'นาย', 'ผู้ดูแลระบบ (Admin)', '0000000000000', 'ผู้ดูแลระบบ', 'กลุ่มอำนวยการ', 'admin', 'active');
      console.log('[seed] สร้างบัญชีผู้ดูแลระบบ: admin');
    }
  }

  const count = db.prepare('SELECT COUNT(*) c FROM office_sections').get().c;
  if (count === 0) {
    const insert = db.prepare('INSERT INTO office_sections (key, title, content, sort) VALUES (?,?,?,?)');
    insert.run('history', 'ประวัติความเป็นมา',
      `สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2 เป็นหน่วยงานราชการสังกัดสำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน (สพฐ.) กระทรวงศึกษาธิการ รับผิดชอบการบริหารจัดการศึกษาระดับประถมศึกษาและขยายโอกาสทางการศึกษาในเขตพื้นที่จังหวัดแพร่ เขต 2 ครอบคลุมอำเภอเด่นชัย อำเภอลอง อำเภอวังชิ้น อำเภอสอง อำเภอสบเมย อำเภอหนองม่วงไข่ และอำเภอร้องกวาง\n\n(สามารถแก้ไขเนื้อหาส่วนนี้ได้โดยผู้ดูแลระบบ)`, 1);
    insert.run('vision', 'วิสัยทัศน์ (Vision)',
      `"องค์กรคุณภาพ บริหารจัดการศึกษาให้ทันสมัย บุคลากรเป็นมืออาชีพ ผู้เรียนมีคุณภาพตามมาตรฐานสู่ความสุขอย่างยั่งยืน"\n\n**พันธกิจ (Mission)**\n1. ส่งเสริมการจัดการศึกษาให้มีคุณภาพตามมาตรฐานการศึกษา\n2. พัฒนาบุคลากรทางการศึกษาให้เป็นมืออาชีพ\n3. บริหารจัดการทรัพยากรอย่างมีประสิทธิภาพ โปร่งใส ตรวจสอบได้\n4. ส่งเสริมการมีส่วนร่วมของทุกภาคส่วนในการจัดการศึกษา`, 2);
    insert.run('structure', 'โครงสร้างหน่วยงาน',
      `- กลุ่มอำนวยการ\n- กลุ่มบริหารงานบุคคล\n- กลุ่มนโยบายและแผน\n- กลุ่มส่งเสริมการจัดการศึกษา\n- กลุ่มนิเทศ ติดตาม และประเมินผลการจัดการศึกษา\n- กลุ่มบริหารการเงินและสินทรัพย์\n- หน่วยตรวจสอบภายใน\n\n(สามารถแก้ไขเนื้อหาส่วนนี้ได้โดยผู้ดูแลระบบ)`, 3);
    insert.run('contact', 'ที่อยู่และการติดต่อ',
      `ที่อยู่ : สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2\nโทรศัพท์ : 0-0000-0000\nโทรสาร : 0-0000-0000\nอีเมล : phrae2@example.go.th\nเว็บไซต์ : www.phrae2.example.go.th\n\n(สามารถแก้ไขเนื้อหาส่วนนี้ได้โดยผู้ดูแลระบบ)`, 4);
    insert.run('duty', 'อำนาจหน้าที่',
      `1. อำนาจหน้าที่ตามกฎหมายว่าด้วยระเบียบบริหารราชการกระทรวงศึกษาธิการ\n2. จัดทำนโยบาย แผนพัฒนา และมาตรฐานการศึกษาของเขตพื้นที่การศึกษา ให้สอดคล้องกับนโยบายและมาตรฐานการศึกษาชาติ\n3. วิเคราะห์ จัดสรรงบประมาณเงินอุดหนุนทั่วไปของสถานศึกษา และหน่วยงานในสังกัด\n4. ประสาน ส่งเสริม สนับสนุน และพัฒนาหลักสูตรการศึกษาร่วมกับสถานศึกษาในสังกัด\n5. ศึกษาวิเคราะห์ วิจัย ติดตาม ตรวจสอบ และประเมินผลการจัดการศึกษา\n6. กำกับดูแล ดูแล ปลดเปลื้องและพิทักษ์สิทธิเด็กและเยาวชนในเขตพื้นที่การศึกษา\n7. ปฏิบัติภารกิจอื่นตามที่ได้รับมอบหมาย\n\n(สามารถแก้ไขเนื้อหาส่วนนี้ได้โดยผู้ดูแลระบบ)`, 5);
    console.log('[seed] สร้างข้อมูลพื้นฐานหน่วยงาน');
  }

  const schoolCount = db.prepare('SELECT COUNT(*) c FROM schools').get().c;
  if (schoolCount === 0) {
    const insert = db.prepare(`INSERT INTO schools (code, name, district, address, principal, phone, level, lat, lng, notes)
                               VALUES (?,?,?,?,?,?,?,?,?,?)`);
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
    for (const s of schools) insert.run(...s);
    console.log('[seed] สร้างข้อมูลโรงเรียนตัวอย่าง');
  }

  const vCount = db.prepare('SELECT COUNT(*) c FROM vehicles').get().c;
  if (vCount === 0) {
    const insert = db.prepare('INSERT INTO vehicles (name, plate, type, capacity, status, notes) VALUES (?,?,?,?,?,?)');
    insert.run('รถตู้โดยสาร 12 ที่นั่ง', 'กฉ 1234 แพร่', 'รถตู้', 12, 'available', 'ข้อมูลตัวอย่าง');
    insert.run('รถยนต์นั่งส่วนกลาง', 'กท 5678 แพร่', 'รถยนต์', 5, 'available', 'ข้อมูลตัวอย่าง');
    insert.run('รถกระบะบรรทุกของ', 'บฉ 9012 แพร่', 'รถกระบะ', 4, 'available', 'ข้อมูลตัวอย่าง');
    console.log('[seed] สร้างข้อมูลยานพาหนะตัวอย่าง');
  }

  const rCount = db.prepare('SELECT COUNT(*) c FROM rooms').get().c;
  if (rCount === 0) {
    const insert = db.prepare('INSERT INTO rooms (name, capacity, location, equipment, status) VALUES (?,?,?,?,?)');
    insert.run('ห้องประชุมใหญ่ ชั้น 2', 60, 'อาคารอำนวยการ ชั้น 2', 'โปรเจกเตอร์, จอ, ไมโครโฟน, เครื่องเสียง', 'available');
    insert.run('ห้องประชุมกลุ่มบริหาร', 20, 'อาคารอำนวยการ ชั้น 1', 'ทีวี LED, กระดานไวท์บอร์ด', 'available');
    insert.run('ห้องประชุมอบรมสัมมนา', 40, 'อาคารเอนกประสงค์', 'โปรเจกเตอร์, คอมพิวเตอร์, เครื่องเสียง', 'available');
    console.log('[seed] สร้างข้อมูลห้องประชุมตัวอย่าง');
  }

  const bCount = db.prepare('SELECT COUNT(*) c FROM budgets').get().c;
  if (bCount === 0) {
    const insert = db.prepare('INSERT INTO budgets (year, category, plan, note, sort) VALUES (?,?,?,?,?)');
    insert.run(2569, 'งบบุคลากร', 0, 'ค่าตอบแทนบุคลากร', 1);
    insert.run(2569, 'งบดำเนินงาน', 0, 'ค่าใช้จ่ายในการดำเนินงานประจำ', 2);
    insert.run(2569, 'งบลงทุน', 0, 'ครุภัณฑ์และที่ดินสิ่งก่อสร้าง', 3);
    insert.run(2569, 'งบรายจ่ายอื่น', 0, 'ค่าใช้จ่ายอื่น ๆ', 4);
    console.log('[seed] สร้างข้อมูลงบประมาณตัวอย่าง');
  }

  const aCount = db.prepare('SELECT COUNT(*) c FROM academic_projects').get().c;
  if (aCount === 0) {
    const insert = db.prepare('INSERT INTO academic_projects (name, kind, detail, date_from, date_to, status, responsible, budget, result) VALUES (?,?,?,?,?,?,?,?,?)');
    insert.run('โครงการยกระดับผลสัมฤทธิ์ทางการเรียน O-NET', 'project', 'พัฒนาครูและนักเรียนเพื่อยกระดับผลการทดสอบระดับชาติ', '2569-05-01', '2569-09-30', 'planned', 'กลุ่มนิเทศ ติดตามฯ', 50000, '');
    insert.run('กิจกรรมพัฒนาการอ่านออกเขียนได้', 'activity', 'ส่งเสริมการอ่านของนักเรียนระดับประถมศึกษา', '2569-06-01', '2569-12-31', 'ongoing', 'กลุ่มส่งเสริมการจัดการศึกษา', 20000, '');
    insert.run('โครงการโรงเรียนปลอดขยะ', 'project', 'ส่งเสริมการจัดการขยะในสถานศึกษา', '2569-07-01', '2569-11-30', 'planned', 'กลุ่มนิเทศ ติดตามฯ', 15000, '');
    console.log('[seed] สร้างข้อมูลงานวิชาการตัวอย่าง');
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS user_leave_balances (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  year       INTEGER NOT NULL,
  vacation_accumulated REAL NOT NULL DEFAULT 0,
  vacation_annual     REAL NOT NULL DEFAULT 0,
  UNIQUE(user_id, year)
);
`);

seed();

module.exports = db;

// รองรับคำสั่ง: node db.js --seed
if (require.main === module && process.argv.includes('--seed')) {
  console.log('Seeding database เสร็จเรียบร้อย');
  process.exit(0);
}
