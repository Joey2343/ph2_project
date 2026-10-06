'use strict';
const db = require('../db');

/**
 * คำสั่งบำรุงรักษาฐานข้อมูล — port มาใช้ DB adapter แบบ async แล้ว
 *
 * ใช้: node scripts/update-memo-sigs.js
 *
 * ⚠ สคริปต์นี้เขียน/ลบข้อมูลจริง ควรรันกับสำเนาฐานข้อมูลก่อนเสมอ
 */

async function main() {
  await db.init();
  await db.bootstrap();

  console.log('=== Update memo approval_data signatures to include staff/ prefix ===\n');

  const memos = await db.prepare("SELECT id, approval_data FROM memos WHERE approval_data IS NOT NULL AND approval_data != '[]'").all();
  let updated = 0;

  for (const m of memos) {
  try {
    const data = JSON.parse(m.approval_data || '[]');
    let changed = false;
    data.forEach(level => {
      if (level.signature && !level.signature.startsWith('staff/') && !level.signature.includes('/')) {
        level.signature = 'staff/' + level.signature;
        changed = true;
      }
    });
    if (changed) {
      await db.prepare("UPDATE memos SET approval_data = ? WHERE id = ?").run(JSON.stringify(data), m.id);
      updated++;
      console.log('Updated memo #' + m.id);
    }
  } catch(e) {
    console.error('Error in memo #' + m.id + ': ' + e.message);
  }
  };

  // ตรวจสอบ travel_requests ด้วย
  const travels = await db.prepare("SELECT id, form_data FROM travel_requests WHERE form_data IS NOT NULL").all();
  for (const t of travels) {
  try {
    const fd = JSON.parse(t.form_data || '{}');
    let changed = false;
    // user_signature
    if (fd.user_signature && !fd.user_signature.startsWith('staff/') && !fd.user_signature.includes('/')) {
      fd.user_signature = 'staff/' + fd.user_signature;
      changed = true;
    }
    // approver signatures
    ['approver1_sig', 'approver2_sig', 'approver3_sig'].forEach(key => {
      if (fd[key] && !fd[key].startsWith('staff/') && !fd[key].includes('/')) {
        fd[key] = 'staff/' + fd[key];
        changed = true;
      }
    });
    // approval_data signatures
    if (fd.approval_data) {
      try {
        const ad = JSON.parse(fd.approval_data || '[]');
        ad.forEach(level => {
          if (level.signature && !level.signature.startsWith('staff/') && !level.signature.includes('/')) {
            level.signature = 'staff/' + level.signature;
            changed = true;
          }
        });
        fd.approval_data = JSON.stringify(ad);
      } catch(_e) {}
    }
    if (changed) {
      await db.prepare("UPDATE travel_requests SET form_data = ? WHERE id = ?").run(JSON.stringify(fd), t.id);
      updated++;
      console.log('Updated travel #' + t.id);
    }
  } catch(e) {}
  };

  console.log('\nDone! Updated ' + updated + ' records');
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
