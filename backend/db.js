'use strict';
/**
 * ฐานข้อมูลระบบศูนย์กลางการบริหารจัดการ สพป.แพร่ เขต 2
 *
 * ใช้ MariaDB 11.4 ตัวเดียว (ตรงกับเซิร์ฟเวอร์จริง) — ดู docs/adr/0007-mariadb-only.md
 *
 * โครงสร้าง schema, migrations และข้อมูลตั้งต้นทั้งหมดยกมาจากระบบรุ่นเดิม
 * เปลี่ยนเฉพาะ: เป็น async และเขียน SQL ให้เป็น MariaDB โดยตรง
 *
 * เรียกใช้:
 *   const db = require('./db');          // ได้ facade เดียวกันที่ routes/ ใช้
 *   await db.init();                    // เปิดการเชื่อมต่อ
 *   await db.bootstrap();               // สร้าง schema + migration + seed
 */
const db = require('./db/index');
const bcrypt = require('bcryptjs');

// ── Schema ──────────────────────────────────────────────────────────────────
// DDL เป็น MariaDB จริง ไม่ต้องแปลงอะไรอีก
// ─────────────────────────────────────────────────────────────────────────────
//  SCHEMA_SQL — schema จริงของ MariaDB 11.4
//
//  ทุกครั้งที่แก้ ให้แก้ที่นี่ที่เดียว แล้วให้ server สร้าง/ปรับตอนบูต
//  (server.js → bootstrap() → exec(SCHEMA_SQL) แล้ว migrate() เติมคอลัมน์ที่ขาด)
//
//  ⚠️ เพิ่มคอลัมน์ใหม่ต้องเพิ่มใน COLUMN_MIGRATIONS ด้วยเสมอ
//     ครอบคลุมแล้ว CI จะเตือนถ้าตกหล่น
// ─────────────────────────────────────────────────────────────────────────────
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS \`academic_projects\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`name\` mediumtext NOT NULL,
  \`kind\` varchar(255) DEFAULT 'project',
  \`detail\` mediumtext DEFAULT NULL,
  \`date_from\` mediumtext DEFAULT NULL,
  \`date_to\` mediumtext DEFAULT NULL,
  \`status\` varchar(255) NOT NULL DEFAULT 'planned',
  \`responsible\` mediumtext DEFAULT NULL,
  \`budget\` double DEFAULT 0,
  \`result\` mediumtext DEFAULT NULL,
  \`created_at\` varchar(30) NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`budgets\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`year\` int(11) DEFAULT NULL,
  \`category\` mediumtext NOT NULL,
  \`plan\` double DEFAULT 0,
  \`note\` mediumtext DEFAULT NULL,
  \`sort\` int(11) DEFAULT 0,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`budget_transactions\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`budget_id\` int(11) NOT NULL,
  \`date\` mediumtext DEFAULT NULL,
  \`description\` mediumtext DEFAULT NULL,
  \`amount\` double NOT NULL,
  \`type\` varchar(255) NOT NULL DEFAULT 'expense',
  \`created_at\` varchar(30) NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`disasters\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`type\` mediumtext NOT NULL,
  \`title\` mediumtext NOT NULL,
  \`location\` mediumtext DEFAULT NULL,
  \`district\` mediumtext DEFAULT NULL,
  \`date\` mediumtext DEFAULT NULL,
  \`time\` mediumtext DEFAULT NULL,
  \`detail\` mediumtext DEFAULT NULL,
  \`damage\` mediumtext DEFAULT NULL,
  \`status\` varchar(255) NOT NULL DEFAULT 'reported',
  \`user_id\` int(11) DEFAULT NULL,
  \`created_at\` varchar(30) NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`documents\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`doc_type\` mediumtext NOT NULL,
  \`doc_no\` mediumtext DEFAULT NULL,
  \`title\` mediumtext NOT NULL,
  \`from_org\` mediumtext DEFAULT NULL,
  \`to_org\` mediumtext DEFAULT NULL,
  \`date\` mediumtext DEFAULT NULL,
  \`category\` mediumtext DEFAULT NULL,
  \`file\` mediumtext DEFAULT NULL,
  \`note\` mediumtext DEFAULT NULL,
  \`created_by\` int(11) DEFAULT NULL,
  \`created_at\` varchar(30) NOT NULL DEFAULT current_timestamp(),
  \`sender_type\` varchar(255) DEFAULT 'office',
  \`priority\` varchar(255) DEFAULT 'normal',
  \`body_text\` varchar(8000) DEFAULT '',
  \`reg_no\` varchar(255) DEFAULT '',
  \`workgroup\` varchar(255) DEFAULT '',
  \`school_code\` mediumtext DEFAULT NULL,
  \`person_name\` varchar(255) DEFAULT '',
  \`person_school\` varchar(255) DEFAULT '',
  \`honor_signer\` varchar(255) DEFAULT '',
  \`honor_template\` varchar(255) DEFAULT '',
  \`honor_saved_file\` varchar(255) DEFAULT '',
  \`is_registered\` int(11) DEFAULT 0,
  \`requester\` varchar(255) DEFAULT '',
  \`officer\` varchar(255) DEFAULT '',
  \`cert_status\` varchar(255) DEFAULT 'กำลังดำเนินการ',
  \`cert_position\` varchar(255) DEFAULT '',
  \`owner_group\` varchar(255) DEFAULT '',
  \`order_registrar\` varchar(255) DEFAULT '',
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`document_reads\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`doc_id\` int(11) NOT NULL,
  \`user_id\` int(11) NOT NULL,
  \`read_at\` varchar(30) NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`doc_id\` (\`doc_id\`,\`user_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`users\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`username\` varchar(191) NOT NULL,
  \`password_hash\` mediumtext NOT NULL,
  \`title\` varchar(255) DEFAULT 'นาย/นาง/นางสาว',
  \`full_name\` mediumtext NOT NULL,
  \`first_name\` mediumtext DEFAULT NULL,
  \`last_name\` mediumtext DEFAULT NULL,
  \`nickname\` mediumtext DEFAULT NULL,
  \`blood_type\` mediumtext DEFAULT NULL,
  \`academic_rank\` mediumtext DEFAULT NULL,
  \`highest_education\` mediumtext DEFAULT NULL,
  \`citizen_id\` varchar(191) DEFAULT NULL,
  \`position\` mediumtext DEFAULT NULL,
  \`workplace\` mediumtext DEFAULT NULL,
  \`phone\` mediumtext DEFAULT NULL,
  \`email\` mediumtext DEFAULT NULL,
  \`telegram_token\` mediumtext DEFAULT NULL,
  \`telegram_chat_id\` mediumtext DEFAULT NULL,
  \`photo\` mediumtext DEFAULT NULL,
  \`signature\` mediumtext DEFAULT NULL,
  \`role\` varchar(255) NOT NULL DEFAULT 'staff',
  \`can_approve\` int(11) NOT NULL DEFAULT 0,
  \`status\` varchar(255) NOT NULL DEFAULT 'pending',
  \`created_at\` varchar(30) NOT NULL DEFAULT current_timestamp(),
  \`approved_at\` varchar(30) DEFAULT NULL,
  \`birth_date\` mediumtext DEFAULT NULL,
  \`staff_no\` mediumtext DEFAULT NULL,
  \`user_group\` varchar(255) DEFAULT 'office',
  \`workplace_secondary\` varchar(255) DEFAULT '[]',
  \`current_school\` varchar(255) DEFAULT '',
  \`school_code\` mediumtext DEFAULT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`username\` (\`username\`),
  UNIQUE KEY \`citizen_id\` (\`citizen_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`document_recipients\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`document_id\` int(11) NOT NULL,
  \`user_id\` int(11) NOT NULL,
  \`is_read\` int(11) DEFAULT 0,
  \`read_at\` varchar(30) DEFAULT NULL,
  \`created_at\` varchar(30) DEFAULT current_timestamp(),
  \`as_school\` varchar(255) DEFAULT '',
  PRIMARY KEY (\`id\`),
  KEY \`document_id\` (\`document_id\`),
  KEY \`user_id\` (\`user_id\`),
  CONSTRAINT \`document_recipients_ibfk_1\` FOREIGN KEY (\`document_id\`) REFERENCES \`documents\` (\`id\`) ON DELETE CASCADE,
  CONSTRAINT \`document_recipients_ibfk_2\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`document_staff\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`staff_type\` varchar(191) NOT NULL DEFAULT 'office',
  \`user_id\` int(11) NOT NULL,
  \`school_code\` varchar(191) DEFAULT '',
  \`created_at\` varchar(30) NOT NULL DEFAULT current_timestamp(),
  \`doc_prefix\` varchar(255) DEFAULT '',
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`staff_type\` (\`staff_type\`,\`user_id\`,\`school_code\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`leave_requests\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`leave_no\` mediumtext DEFAULT NULL,
  \`user_id\` int(11) NOT NULL,
  \`leave_type\` mediumtext NOT NULL,
  \`date_from\` mediumtext DEFAULT NULL,
  \`date_to\` mediumtext DEFAULT NULL,
  \`days\` int(11) DEFAULT 1,
  \`reason\` mediumtext DEFAULT NULL,
  \`address\` mediumtext DEFAULT NULL,
  \`phone\` mediumtext DEFAULT NULL,
  \`status\` varchar(255) NOT NULL DEFAULT 'pending',
  \`note\` mediumtext DEFAULT NULL,
  \`decided_by\` int(11) DEFAULT NULL,
  \`decided_at\` varchar(30) DEFAULT NULL,
  \`approval_level\` int(11) NOT NULL DEFAULT 0,
  \`approval_data\` varchar(8000) NOT NULL DEFAULT '[]',
  \`created_at\` varchar(30) NOT NULL DEFAULT current_timestamp(),
  \`writing_at\` mediumtext DEFAULT NULL,
  \`last_leave_from\` mediumtext DEFAULT NULL,
  \`last_leave_to\` mediumtext DEFAULT NULL,
  \`last_leave_days\` int(11) DEFAULT NULL,
  \`attachment\` mediumtext DEFAULT NULL,
  \`delegate_to\` int(11) DEFAULT NULL,
  \`reviewed\` int(11) NOT NULL DEFAULT 0,
  \`reviewed_stats\` mediumtext DEFAULT NULL,
  \`cancel_status\` varchar(255) DEFAULT '',
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`memos\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`doc_no\` mediumtext DEFAULT NULL,
  \`user_id\` int(11) NOT NULL,
  \`title\` mediumtext NOT NULL,
  \`content\` mediumtext DEFAULT NULL,
  \`date\` mediumtext DEFAULT NULL,
  \`status\` varchar(255) NOT NULL DEFAULT 'draft',
  \`attachment\` mediumtext DEFAULT NULL,
  \`created_at\` varchar(30) NOT NULL DEFAULT current_timestamp(),
  \`office\` mediumtext DEFAULT NULL,
  \`to_text\` mediumtext DEFAULT NULL,
  \`ref_files\` mediumtext DEFAULT NULL,
  \`enc_files\` mediumtext DEFAULT NULL,
  \`draft_file\` mediumtext DEFAULT NULL,
  \`send_to\` mediumtext DEFAULT NULL,
  \`urgency\` mediumtext DEFAULT NULL,
  \`approval_level\` int(11) NOT NULL DEFAULT 0,
  \`approval_data\` varchar(8000) NOT NULL DEFAULT '[]',
  \`approval_chain\` mediumtext DEFAULT NULL,
  \`decided_by\` int(11) DEFAULT NULL,
  \`decided_at\` varchar(30) DEFAULT NULL,
  \`note\` mediumtext DEFAULT NULL,
  \`revision_note\` mediumtext DEFAULT NULL,
  \`next_approver_id\` int(11) DEFAULT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`office_sections\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`key\` varchar(191) DEFAULT NULL,
  \`title\` mediumtext NOT NULL,
  \`content\` varchar(8000) NOT NULL DEFAULT '',
  \`sort\` int(11) DEFAULT 0,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`key\` (\`key\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`rooms\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`name\` mediumtext NOT NULL,
  \`capacity\` int(11) DEFAULT 0,
  \`location\` mediumtext DEFAULT NULL,
  \`equipment\` mediumtext DEFAULT NULL,
  \`status\` varchar(255) DEFAULT 'available',
  \`notes\` mediumtext DEFAULT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`room_bookings\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`room_id\` int(11) NOT NULL,
  \`user_id\` int(11) NOT NULL,
  \`date\` mediumtext NOT NULL,
  \`start_time\` mediumtext DEFAULT NULL,
  \`end_time\` mediumtext DEFAULT NULL,
  \`topic\` mediumtext DEFAULT NULL,
  \`attendees\` int(11) DEFAULT 0,
  \`status\` varchar(255) NOT NULL DEFAULT 'pending',
  \`note\` mediumtext DEFAULT NULL,
  \`decided_by\` int(11) DEFAULT NULL,
  \`decided_at\` varchar(30) DEFAULT NULL,
  \`approval_level\` int(11) NOT NULL DEFAULT 0,
  \`approval_data\` varchar(8000) NOT NULL DEFAULT '[]',
  \`created_at\` varchar(30) NOT NULL DEFAULT current_timestamp(),
  \`booking_no\` mediumtext DEFAULT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`schools\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`code\` mediumtext DEFAULT NULL,
  \`name\` mediumtext NOT NULL,
  \`district\` mediumtext DEFAULT NULL,
  \`address\` mediumtext DEFAULT NULL,
  \`principal\` mediumtext DEFAULT NULL,
  \`phone\` mediumtext DEFAULT NULL,
  \`level\` mediumtext DEFAULT NULL,
  \`lat\` double DEFAULT NULL,
  \`lng\` double DEFAULT NULL,
  \`image\` mediumtext DEFAULT NULL,
  \`notes\` mediumtext DEFAULT NULL,
  \`disaster\` mediumtext DEFAULT NULL,
  \`group_name\` varchar(255) DEFAULT '',
  \`disaster_image\` mediumtext DEFAULT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`sessions\` (
  \`token\` varchar(191) NOT NULL,
  \`user_id\` int(11) NOT NULL,
  \`expires_at\` varchar(30) NOT NULL,
  PRIMARY KEY (\`token\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`settings\` (
  \`key\` varchar(191) NOT NULL,
  \`value\` varchar(8000) NOT NULL DEFAULT '',
  PRIMARY KEY (\`key\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`time_records\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`user_id\` int(11) NOT NULL,
  \`date\` varchar(191) NOT NULL,
  \`clock_in\` mediumtext DEFAULT NULL,
  \`clock_out\` mediumtext DEFAULT NULL,
  \`note\` mediumtext DEFAULT NULL,
  \`clock_in_src\` mediumtext DEFAULT NULL,
  \`clock_out_src\` mediumtext DEFAULT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`user_id\` (\`user_id\`,\`date\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`travel_requests\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`travel_no\` mediumtext DEFAULT NULL,
  \`user_id\` int(11) NOT NULL,
  \`title\` mediumtext NOT NULL,
  \`destination\` mediumtext DEFAULT NULL,
  \`date_from\` mediumtext DEFAULT NULL,
  \`date_to\` mediumtext DEFAULT NULL,
  \`days\` int(11) DEFAULT 1,
  \`vehicle_id\` int(11) DEFAULT NULL,
  \`budget\` double DEFAULT 0,
  \`detail\` mediumtext DEFAULT NULL,
  \`status\` varchar(255) NOT NULL DEFAULT 'pending',
  \`note\` mediumtext DEFAULT NULL,
  \`decided_by\` int(11) DEFAULT NULL,
  \`decided_at\` varchar(30) DEFAULT NULL,
  \`approval_level\` int(11) NOT NULL DEFAULT 0,
  \`approval_data\` varchar(8000) NOT NULL DEFAULT '[]',
  \`created_at\` varchar(30) NOT NULL DEFAULT current_timestamp(),
  \`form_data\` varchar(8000) DEFAULT '{}',
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`user_leave_balances\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`user_id\` int(11) NOT NULL,
  \`year\` int(11) NOT NULL,
  \`vacation_accumulated\` double NOT NULL DEFAULT 0,
  \`vacation_annual\` double NOT NULL DEFAULT 0,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`user_id\` (\`user_id\`,\`year\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`vehicles\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`name\` mediumtext NOT NULL,
  \`plate\` mediumtext DEFAULT NULL,
  \`type\` mediumtext DEFAULT NULL,
  \`capacity\` int(11) DEFAULT 0,
  \`status\` varchar(255) DEFAULT 'available',
  \`notes\` mediumtext DEFAULT NULL,
  \`photo\` mediumtext DEFAULT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`vehicle_bookings\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`vehicle_id\` int(11) NOT NULL,
  \`user_id\` int(11) NOT NULL,
  \`date\` mediumtext NOT NULL,
  \`start_time\` mediumtext DEFAULT NULL,
  \`end_time\` mediumtext DEFAULT NULL,
  \`purpose\` mediumtext DEFAULT NULL,
  \`destination\` mediumtext DEFAULT NULL,
  \`passengers\` mediumtext DEFAULT NULL,
  \`status\` varchar(255) NOT NULL DEFAULT 'pending',
  \`note\` mediumtext DEFAULT NULL,
  \`decided_by\` int(11) DEFAULT NULL,
  \`decided_at\` varchar(30) DEFAULT NULL,
  \`approval_level\` int(11) NOT NULL DEFAULT 0,
  \`approval_data\` varchar(8000) NOT NULL DEFAULT '[]',
  \`created_at\` varchar(30) NOT NULL DEFAULT current_timestamp(),
  \`date_to\` mediumtext DEFAULT NULL,
  \`total_days\` int(11) NOT NULL DEFAULT 1,
  \`passenger_count\` int(11) NOT NULL DEFAULT 0,
  \`controller\` mediumtext DEFAULT NULL,
  \`fuel_choice\` mediumtext DEFAULT NULL,
  \`fuel_project\` mediumtext DEFAULT NULL,
  \`fuel_activity\` mediumtext DEFAULT NULL,
  \`fuel_amount\` double NOT NULL DEFAULT 0,
  \`self_drive\` int(11) NOT NULL DEFAULT 0,
  \`driver_name\` mediumtext DEFAULT NULL,
  \`booking_no\` mediumtext DEFAULT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS \`vehicle_notices\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`booking_id\` int(11) DEFAULT NULL,
  \`user_id\` int(11) NOT NULL,
  \`type\` varchar(255) NOT NULL DEFAULT 'edit',
  \`text\` mediumtext NOT NULL,
  \`read\` int(11) NOT NULL DEFAULT 0,
  \`created_at\` varchar(30) NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
`;

// ── Migrations ──────────────────────────────────────────────────────────────
// คอลัมน์ที่ฐานข้อมูลเดิมมี แต่ DDL ไม่ได้ประกาศ (บางส่วนเคยถูกสร้างจาก
// การรันระบบจริงนอกซอร์ส) — ต้องอยู่ในรายการนี้ มิฉะนั้น MySQL ที่ติดตั้งใหม่จะ query ไม่ผ่าน
const COLUMN_MIGRATIONS = [
  ['users', 'first_name', "first_name VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['users', 'last_name', "last_name VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['users', 'nickname', "nickname VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['users', 'birth_date', "birth_date VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['users', 'blood_type', "blood_type VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['users', 'academic_rank', "academic_rank VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['users', 'highest_education', "highest_education VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['users', 'staff_no', "staff_no VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['users', 'telegram_token', "telegram_token VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['users', 'telegram_chat_id', "telegram_chat_id VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['users', 'can_approve', "can_approve INT NOT NULL DEFAULT 0"],
  ['users', 'school_code', "school_code VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT ''"],
  ['users', 'user_group', "user_group VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT 'office'"],
  ['users', 'workplace_secondary', "workplace_secondary VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT '[]'"],
  ['users', 'current_school', "current_school VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT ''"],
  ['schools', 'disaster', "disaster VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['schools', 'disaster_image', "disaster_image VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['vehicles', 'photo', "photo VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['vehicle_bookings', 'approval_level', "approval_level INT NOT NULL DEFAULT 0"],
  ['vehicle_bookings', 'approval_data', "approval_data VARCHAR(1000) COLLATE utf8mb4_bin NOT NULL DEFAULT '[]'"],
  ['vehicle_bookings', 'date_to', "date_to VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['vehicle_bookings', 'total_days', "total_days INT NOT NULL DEFAULT 1"],
  ['vehicle_bookings', 'passenger_count', "passenger_count INT NOT NULL DEFAULT 0"],
  ['vehicle_bookings', 'controller', "controller VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['vehicle_bookings', 'fuel_choice', "fuel_choice VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['vehicle_bookings', 'fuel_project', "fuel_project VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['vehicle_bookings', 'fuel_activity', "fuel_activity VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['vehicle_bookings', 'fuel_amount', "fuel_amount DOUBLE NOT NULL DEFAULT 0"],
  ['vehicle_bookings', 'self_drive', "self_drive INT NOT NULL DEFAULT 0"],
  ['vehicle_bookings', 'driver_name', "driver_name VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['vehicle_bookings', 'booking_no', "booking_no VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['room_bookings', 'approval_level', "approval_level INT NOT NULL DEFAULT 0"],
  ['room_bookings', 'approval_data', "approval_data VARCHAR(1000) COLLATE utf8mb4_bin NOT NULL DEFAULT '[]'"],
  ['room_bookings', 'booking_no', "booking_no VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['travel_requests', 'approval_level', "approval_level INT NOT NULL DEFAULT 0"],
  ['travel_requests', 'approval_data', "approval_data VARCHAR(1000) COLLATE utf8mb4_bin NOT NULL DEFAULT '[]'"],
  ['travel_requests', 'form_data', "form_data VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT '{}'"],
  ['leave_requests', 'approval_level', "approval_level INT NOT NULL DEFAULT 0"],
  ['leave_requests', 'approval_data', "approval_data VARCHAR(1000) COLLATE utf8mb4_bin NOT NULL DEFAULT '[]'"],
  ['leave_requests', 'writing_at', "writing_at VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['leave_requests', 'last_leave_from', "last_leave_from VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['leave_requests', 'last_leave_to', "last_leave_to VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['leave_requests', 'last_leave_days', "last_leave_days INT"],
  ['leave_requests', 'attachment', "attachment VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['leave_requests', 'delegate_to', "delegate_to INT"],
  ['leave_requests', 'reviewed', "reviewed INT NOT NULL DEFAULT 0"],
  ['leave_requests', 'reviewed_stats', "reviewed_stats VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['leave_requests', 'cancel_status', "cancel_status VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT ''"],
  ['documents', 'reg_no', "reg_no VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT \"\""],
  ['documents', 'workgroup', "workgroup VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT \"\""],
  ['documents', 'is_registered', "is_registered INT DEFAULT 0"],
  ['documents', 'body_text', "body_text VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT \"\""],
  ['documents', 'priority', "priority VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT \"normal\""],
  ['documents', 'cert_status', "cert_status VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT \"กำลังดำเนินการ\""],
  ['documents', 'person_name', "person_name VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT \"\""],
  ['documents', 'person_school', "person_school VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT \"\""],
  ['documents', 'honor_signer', "honor_signer VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT \"\""],
  ['documents', 'honor_template', "honor_template VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT \"\""],
  ['documents', 'honor_saved_file', "honor_saved_file VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT \"\""],
  ['documents', 'requester', "requester VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT \"\""],
  ['documents', 'cert_position', "cert_position VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT \"\""],
  ['documents', 'owner_group', "owner_group VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT \"\""],
  ['documents', 'order_registrar', "order_registrar VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT \"\""],
  ['documents', 'officer', "officer VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT \"\""],
  ['documents', 'school_code', "school_code VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT ''"],
  ['document_staff', 'doc_prefix', "doc_prefix VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT ''"],
  ['document_recipients', 'as_school', "as_school VARCHAR(1000) COLLATE utf8mb4_bin DEFAULT \"\""],
  ['time_records', 'clock_in_src', "clock_in_src VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['time_records', 'clock_out_src', "clock_out_src VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['memos', 'office', "office VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['memos', 'urgency', "urgency VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['memos', 'to_text', "to_text VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['memos', 'ref_files', "ref_files MEDIUMTEXT COLLATE utf8mb4_bin"],
  ['memos', 'enc_files', "enc_files MEDIUMTEXT COLLATE utf8mb4_bin"],
  ['memos', 'draft_file', "draft_file MEDIUMTEXT COLLATE utf8mb4_bin"],
  ['memos', 'send_to', "send_to VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['memos', 'approval_level', "approval_level INT NOT NULL DEFAULT 0"],
  ['memos', 'approval_data', "approval_data VARCHAR(1000) COLLATE utf8mb4_bin NOT NULL DEFAULT '[]'"],
  ['memos', 'approval_chain', "approval_chain VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['memos', 'decided_by', "decided_by INT"],
  ['memos', 'decided_at', "decided_at VARCHAR(30) NOT NULL"],
  ['memos', 'note', "`note` VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['memos', 'revision_note', "revision_note VARCHAR(2000) COLLATE utf8mb4_bin"],
  ['memos', 'next_approver_id', "next_approver_id INT"]
];

/**
 * เพิ่มคอลัมน์ถ้ายังไม่มี
 * ใช้ information_schema เพื่อเช็ค (MariaDB ไม่มี ALTER TABLE ADD COLUMN IF NOT EXISTS)
 *
 * นิยามคอลัมน์ใน COLUMN_MIGRATIONS เป็นชนิด MariaDB เต็มรูปแบบแล้ว
 * เช่น "note VARCHAR(2000) COLLATE utf8mb4_bin" หรือ "approved_at VARCHAR(30) NOT NULL"
 */
async function ensureColumn(table, col, ddl) {
  const cols = await db.columns(table);
  if (!cols.some((c) => c.name === col)) {
    await db.exec(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
    console.log(`[migrate] เพิ่มคอลัมน์ ${table}.${col}`);
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
                  VALUES (?,?,?,?,?,?,?,?,?, NOW())`)
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

  // ── ตัวอย่างรายการจอง (ยานพาหนะ + ห้องประชุม) ─────────────────────────
  // ตารางจองต้องมีข้อมูลอย่างน้อย 1 แถว ไม่งั้นหน้าจองจะว่างเปล่า
  // และปุ่ม "รายละเอียด (แบบฟอร์มทางการ)" จะไม่มีให้กด
  //
  // ⚠️ ช่อง date เก็บเป็น ค.ศ. (YYYY-MM-DD) ไม่ใช่ พ.ศ.
  //    เพราะ applyYearFilter() แปลงปี พ.ศ. → ช่วง ค.ศ. ก่อนเทียบ
  //    ถ้าใส่ปี พ.ศ. รายการจะถูกกรองทิ้ง และหน้าจองจะดูว่างเปล่า
  const todayISO = new Date().toISOString().slice(0, 10);

  const vBooking = await db.prepare('SELECT COUNT(*) c FROM vehicle_bookings').get();
  if (vBooking.c === 0) {
    const vehicle = await db.prepare('SELECT id FROM vehicles ORDER BY id LIMIT 1').get();
    if (vehicle) {
      await db
        .prepare(
          `INSERT INTO vehicle_bookings (vehicle_id, user_id, date, start_time, end_time,
             purpose, destination, passengers, status, note, total_days, passenger_count, controller)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          vehicle.id,
          1,
          todayISO,
          '09:00',
          '12:00',
          'ประชุมผู้บริหารสำนักงาน',
          'ห้องประชุมใหญ่ ชั้น 2',
          8,
          'pending',
          'รายการตัวอย่าง',
          1,
          8,
          'ผู้ควบคุมยาน (ตัวอย่าง)'
        );
      console.log('[seed] สร้างรายการจองยานพาหนะตัวอย่าง');
    }
  }

  const rBooking = await db.prepare('SELECT COUNT(*) c FROM room_bookings').get();
  if (rBooking.c === 0) {
    const room = await db.prepare('SELECT id FROM rooms ORDER BY id LIMIT 1').get();
    if (room) {
      await db
        .prepare(
          `INSERT INTO room_bookings (room_id, user_id, date, start_time, end_time,
             topic, attendees, status, note)
           VALUES (?,?,?,?,?,?,?,?,?)`
        )
        .run(room.id, 1, todayISO, '13:30', '16:30', 'ประชุมกลุ่มงานส่งเสริมฯ', 25, 'pending', 'รายการตัวอย่าง');
      console.log('[seed] สร้างรายการจองห้องประชุมตัวอย่าง');
    }
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
