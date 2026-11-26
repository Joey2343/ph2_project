'use strict';
/**
 * ทดสอบ "แก้ไขรูปโปรไฟล์ของฉัน" (ผู้ใช้สั่ง 26 พ.ย. 2569)
 *
 * กติกาที่ต้องผ่าน
 *   ① PUT /auth/profile อัปโหลดรูปได้ และคืน user.photo ใหม่
 *   ② ชื่อไฟล์รูปใหม่ต้อง "ไม่ซ้ำเดิม" (เดิมชื่อคงที่ → เบราว์เซอร์แสดงรูปเก่าจากแคช)
 *   ③ อัปโหลดครั้งที่ 2 ได้ไฟล์ชื่อใหม่ และไฟล์เก่าถูกลบออกจากดิสก์
 *   ④ GET /auth/me คืนรูปใหม่ล่าสุด
 *
 * ใช้: node scripts/test-profile-photo.js
 */
const path = require('path');
const fs = require('fs');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
}

// PNG 1x1 (สองสีต่างกัน เพื่อให้ไฟล์ต่างกันจริง)
const PNG_RED = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);
const PNG_BLUE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const putPhoto = async (cookie, buf) => {
  const fd = new FormData();
  fd.append('photo', new Blob([buf], { type: 'image/png' }), 'photo.png');
  const res = await fetch(BASE + '/api/auth/profile', { method: 'PUT', headers: { Cookie: cookie }, body: fd });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const fileOnDisk = (photo) => path.join(UPLOAD_DIR, String(photo || ''));

(async () => {
  console.log('');
  const db = require(path.join(__dirname, '..', 'db.js'));
  await db.init();

  let userId = 0;
  const filesToClean = [];

  try {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, first_name, last_name, position, workplace, role, status,
       user_group, school_code, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `zzprofile_${Date.now()}`, hash, 'นาย', 'ทดสอบ รูปโปรไฟล์', 'ทดสอบ', 'รูปโปรไฟล์',
      'เจ้าหน้าที่', 'สพป.แพร่ เขต 2', 'staff', 'active', 'office', '',
      '2026-10-01 09:00:00', '2026-10-01 09:00:00'
    );
    userId = Number(info.insertId);
    const cookie = 'sid=' + (await auth.newSession(userId));

    console.log('');
    console.log('① อัปโหลดรูปโปรไฟล์ครั้งแรก');
    const r1 = await putPhoto(cookie, PNG_RED);
    check(r1.status === 200, `PUT /auth/profile (รูป) → 200 (ได้ ${r1.status})`, JSON.stringify(r1.body));
    const photo1 = r1.body && r1.body.user ? r1.body.user.photo : '';
    check(!!photo1, 'คืน user.photo เป็นชื่อไฟล์', JSON.stringify(photo1));
    if (photo1) filesToClean.push(photo1);
    check(photo1 && fs.existsSync(fileOnDisk(photo1)), 'ไฟล์รูปถูกบันทึกบนดิสก์', String(photo1));

    console.log('');
    console.log('② อัปโหลดครั้งที่ 2 ต้องได้ชื่อไฟล์ใหม่ (กันแคชรูปเก่า)');
    const r2 = await putPhoto(cookie, PNG_BLUE);
    check(r2.status === 200, `PUT ครั้งที่ 2 → 200 (ได้ ${r2.status})`, JSON.stringify(r2.body));
    const photo2 = r2.body && r2.body.user ? r2.body.user.photo : '';
    if (photo2) filesToClean.push(photo2);
    check(!!photo2 && photo2 !== photo1, 'ชื่อไฟล์รูปใหม่ไม่ซ้ำของเดิม',
      JSON.stringify({ first: photo1, second: photo2 }));
    check(photo2 && fs.existsSync(fileOnDisk(photo2)), 'ไฟล์รูปใหม่มีอยู่จริง');
    check(!!photo1 && !fs.existsSync(fileOnDisk(photo1)), 'ไฟล์รูปเก่าถูกลบออกจากดิสก์', String(photo1));

    console.log('');
    console.log('③ GET /auth/me คืนรูปใหม่ล่าสุด');
    const me = await fetch(BASE + '/api/auth/me', { headers: { Cookie: cookie } });
    const meBody = await me.json().catch(() => null);
    check(me.status === 200 && meBody && meBody.user && meBody.user.photo === photo2,
      'โปรไฟล์ล่าสุดใช้รูปที่เพิ่งอัปโหลด', JSON.stringify(meBody && meBody.user && meBody.user.photo));
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    try {
      for (const f of filesToClean) {
        try { fs.unlinkSync(fileOnDisk(f)); } catch (e) { /* ignore */ }
      }
      if (userId) {
        try { await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId); } catch (e) { /* ignore */ }
        try { await db.prepare('DELETE FROM users WHERE id = ?').run(userId); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      console.log('  – เก็บกวาดไม่สำเร็จ: ' + e.message);
    }
    await db.close();
  }

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
