'use strict';
/**
 * แก้บั๊กที่ค้นพบระหว่างตรวจสอบระบบ (มีที่มา ไม่ใช่การเดา)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BUG-001  memos.created_by ไม่มีอยู่จริง
 *
 *   พบที่   : routes/requests.js  —  GET /api/memos  และ  GET /api/memos/next-no
 *   อาการ  : SQLite error "no such column: created_by" → เซิร์ฟเวอร์ crash
 *             เกิดเฉพาะเมื่อผู้ใช้มี school_code (ผู้ใช้ฝั่งสถานศึกษา)
 *   ต้นตอ : บั๊กนี้มีอยู่ในระบบรุ่นเดิม (docs/legacy/source-v1) ไม่ใช่ที่เกิดจากการ port
 *   เหตุผล : ตาราง memos เก็บผู้บันทึกไว้ในคอลัมน์ `user_id`
 *             (ดู INSERT ใน POST /api/memos) ไม่มีคอลัมน์ created_by เลย
 *             ส่วน `created_by` เป็นคอลัมน์ของ **documents** ซึ่งเป็นคนละตาราง
 *   แก้    : เปลี่ยน created_by → user_id
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ใช้: node scripts/fix-known-bugs.js [--dry]
 */
const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const ROOT = path.join(__dirname, '..');

const FIXES = [
  {
    id: 'BUG-001',
    file: 'routes/requests.js',
    reason: 'memos.created_by ไม่มีใน schema — ตาราง memos ใช้ user_id เก็บผู้บันทึก',
    find: '" AND created_by IN (SELECT id FROM users WHERE school_code = ?)"',
    replace: '" AND user_id IN (SELECT id FROM users WHERE school_code = ?)"',
  },
  {
    id: 'BUG-001',
    file: 'routes/requests.js',
    reason: 'memos.created_by ไม่มีใน schema — ตาราง memos ใช้ user_id เก็บผู้บันทึก',
    find: '"SELECT doc_no FROM memos WHERE created_by IN (SELECT id FROM users WHERE school_code = ?)"',
    replace: '"SELECT doc_no FROM memos WHERE user_id IN (SELECT id FROM users WHERE school_code = ?)"',
  },
];

function main() {
  let applied = 0;
  let alreadyOk = 0;

  for (const f of FIXES) {
    const p = path.join(ROOT, f.file);
    let src = fs.readFileSync(p, 'utf8');

    if (src.includes(f.replace)) {
      alreadyOk += 1;
      continue;
    }
    if (!src.includes(f.find)) {
      console.error(`✖ ${f.id} ${f.file}: ไม่พบข้อความที่ต้องแก้`);
      console.error(`   คาดว่าจะเจอ: ${f.find}`);
      process.exitCode = 1;
      continue;
    }

    src = src.split(f.find).join(f.replace);
    if (!DRY) fs.writeFileSync(p, src, 'utf8');
    applied += 1;
    console.log(`✔ ${f.id} ${f.file}`);
    console.log(`   ${f.reason}`);
  }

  console.log(
    `\nแก้ ${applied} จุด · ถูกต้องอยู่แล้ว ${alreadyOk} จุด${DRY ? ' (dry run — ไม่ได้เขียนไฟล์)' : ''}`
  );
}

if (require.main === module) main();

module.exports = { main };
