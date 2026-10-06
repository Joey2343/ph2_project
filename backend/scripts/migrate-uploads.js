'use strict';
const path = require('path');
const fs = require('fs');
const db = require('../db');

/**
 * คำสั่งบำรุงรักษาฐานข้อมูล — port มาใช้ DB adapter แบบ async แล้ว
 *
 * ใช้: node scripts/migrate-uploads.js
 */

async function main() {
  await db.init();
  await db.bootstrap();

  const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

  // สร้างโฟล์เดอร์ย่อย
  const SUBFOLDERS = ['documents', 'staff', 'vehicles', 'memos', 'travel', 'leaves', 'profile'];
  SUBFOLDERS.forEach(sub => {
    const dir = path.join(UPLOAD_DIR, sub);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  let moved = 0, skipped = 0, errors = 0;

  function moveFile(filename, subfolder) {
    if (!filename) return;
    // ข้ามไฟล์ที่มี subfolder อยู่แล้ว
    if (filename.includes('/')) { skipped++; return; }
    const src = path.join(UPLOAD_DIR, filename);
    const dest = path.join(UPLOAD_DIR, subfolder, filename);
    if (!fs.existsSync(src)) { skipped++; return; }
    if (fs.existsSync(dest)) { skipped++; return; }
    try {
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
      moved++;
      console.log(`  ${filename} -> ${subfolder}/`);
    } catch (e) {
      errors++;
      console.error(`  ERROR: ${filename}: ${e.message}`);
    }
  }

  console.log('=== Migration: Move uploaded files to subfolders ===\n');

  // 1. Documents (หนังสือราชการ)
  console.log('📂 documents/');
  const docs = await db.prepare('SELECT file FROM documents WHERE file IS NOT NULL').all();
  docs.forEach(r => moveFile(r.file, 'documents'));

  // 2. Users (เจ้าหน้าที่ - photo, signature)
  console.log('📂 staff/');
  const users = await db.prepare('SELECT photo, signature FROM users WHERE photo IS NOT NULL OR signature IS NOT NULL').all();
  users.forEach(r => { moveFile(r.photo, 'staff'); moveFile(r.signature, 'staff'); });

  // 3. Vehicles (ยานพาหนะ)
  console.log('📂 vehicles/');
  const vehicles = await db.prepare('SELECT photo FROM vehicles WHERE photo IS NOT NULL').all();
  vehicles.forEach(r => moveFile(r.photo, 'vehicles'));

  // 4. Memos (บันทึกข้อความ)
  console.log('📂 memos/');
  const memos = await db.prepare('SELECT ref_files, enc_files, draft_file FROM memos WHERE ref_files IS NOT NULL OR enc_files IS NOT NULL OR draft_file IS NOT NULL').all();
  memos.forEach(r => {
    try { JSON.parse(r.ref_files || '[]').forEach(f => moveFile(f.file, 'memos')); } catch (_e) {}
    try { JSON.parse(r.enc_files || '[]').forEach(f => moveFile(f.file, 'memos')); } catch (_e) {}
    try { const df = JSON.parse(r.draft_file || 'null'); if (df && df.file) moveFile(df.file, 'memos'); } catch (_e) {}
  });

  // 5. Travel (ไปราชการ)
  console.log('📂 travel/');
  const travels = await db.prepare('SELECT form_data FROM travel_requests WHERE form_data IS NOT NULL').all();
  travels.forEach(r => {
    try { const fd = JSON.parse(r.form_data || '{}'); if (fd.attachment) moveFile(fd.attachment, 'travel'); } catch (_e) {}
  });

  // 6. Leaves (ขอลา)
  console.log('📂 leaves/');
  const leaves = await db.prepare('SELECT attachment FROM leave_requests WHERE attachment IS NOT NULL').all();
  leaves.forEach(r => moveFile(r.attachment, 'leaves'));

  // 7. Leave signatures (ลายเซ็นผู้อนุมัติ)
  console.log('📂 leaves/ (signatures)');
  const leaveSigs = await db.prepare('SELECT approver1_sig, approver2_sig FROM leave_requests WHERE approver1_sig IS NOT NULL OR approver2_sig IS NOT NULL').all();
  leaveSigs.forEach(r => { moveFile(r.approver1_sig, 'leaves'); moveFile(r.approver2_sig, 'leaves'); });

  // 8. Travel signatures (ลายเซ็นผู้อนุมัติ)
  console.log('📂 travel/ (signatures)');
  const travelSigs = await db.prepare('SELECT user_signature, approver1_sig, approver2_sig, approver3_sig FROM travel_requests WHERE user_signature IS NOT NULL OR approver1_sig IS NOT NULL OR approver2_sig IS NOT NULL OR approver3_sig IS NOT NULL').all();
  travelSigs.forEach(r => {
    moveFile(r.user_signature, 'travel');
    moveFile(r.approver1_sig, 'travel');
    moveFile(r.approver2_sig, 'travel');
    moveFile(r.approver3_sig, 'travel');
  });

  console.log(`\n=== Done: moved=${moved}, skipped=${skipped}, errors=${errors} ===`);
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
