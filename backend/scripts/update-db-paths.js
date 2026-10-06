'use strict';
const db = require('../db');

/**
 * คำสั่งบำรุงรักษาฐานข้อมูล — port มาใช้ DB adapter แบบ async แล้ว
 *
 * ใช้: node scripts/update-db-paths.js
 *
 * ⚠ สคริปต์นี้เขียน/ลบข้อมูลจริง ควรรันกับสำเนาฐานข้อมูลก่อนเสมอ
 */

async function main() {
  await db.init();
  await db.bootstrap();

  console.log('=== Update DB paths to include subfolder ===\n');

  // documents
  const docs = await db.prepare("SELECT id, file FROM documents WHERE file IS NOT NULL AND file NOT LIKE 'documents/%'").all();
  for (const r of docs) {
  await db.prepare("UPDATE documents SET file = ? WHERE id = ?").run('documents/' + r.file, r.id);
  console.log('documents: ' + r.file + ' -> documents/' + r.file);
  };

  // vehicles
  const vehs = await db.prepare("SELECT id, photo FROM vehicles WHERE photo IS NOT NULL AND photo NOT LIKE 'vehicles/%'").all();
  for (const r of vehs) {
  await db.prepare("UPDATE vehicles SET photo = ? WHERE id = ?").run('vehicles/' + r.photo, r.id);
  console.log('vehicles: ' + r.photo + ' -> vehicles/' + r.photo);
  };

  // users - photo
  const usersPhoto = await db.prepare("SELECT id, photo FROM users WHERE photo IS NOT NULL AND photo NOT LIKE 'staff/%'").all();
  for (const r of usersPhoto) {
  await db.prepare("UPDATE users SET photo = ? WHERE id = ?").run('staff/' + r.photo, r.id);
  console.log('users photo: ' + r.photo + ' -> staff/' + r.photo);
  };

  // users - signature
  const usersSig = await db.prepare("SELECT id, signature FROM users WHERE signature IS NOT NULL AND signature NOT LIKE 'staff/%'").all();
  for (const r of usersSig) {
  await db.prepare("UPDATE users SET signature = ? WHERE id = ?").run('staff/' + r.signature, r.id);
  console.log('users sig: ' + r.signature + ' -> staff/' + r.signature);
  };

  console.log('\nDone!');
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
