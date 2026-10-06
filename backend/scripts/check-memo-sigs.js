'use strict';
const db = require('../db');

/**
 * คำสั่งบำรุงรักษาฐานข้อมูล — port มาใช้ DB adapter แบบ async แล้ว
 *
 * ใช้: node scripts/check-memo-sigs.js
 */

async function main() {
  await db.init();
  await db.bootstrap();

  // ตรวจสอบ signature ใน memos
  const memos = await db.prepare("SELECT id, approval_data FROM memos WHERE approval_data IS NOT NULL AND approval_data != '[]'").all();
  console.log('Memos with approval_data:', memos.length);

  memos.forEach(m => {
    try {
      const data = JSON.parse(m.approval_data || '[]');
      data.forEach((level, i) => {
        if (level.signature) {
          console.log('  memo ' + m.id + ' level ' + i + ': sig=' + level.signature);
        }
      });
    } catch(e) {}
  });

  // ตรวจสอบ user signatures
  const users = await db.prepare("SELECT id, full_name, signature FROM users WHERE signature IS NOT NULL").all();
  console.log('\nUser signatures:');
  users.forEach(u => {
    console.log('  ' + u.full_name + ': ' + u.signature);
  });
}

main()
  .then(async () => {
    await db.close();
  })
  .catch(async (err) => {
    console.error(err);
    try {
      await db.close();
    } catch {
      /* ปิดการเชื่อมต่อไม่สำเร็จ — ไม่เป็นไร */
    }
    process.exit(1);
  });
