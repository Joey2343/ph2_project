'use strict';
/**
 * ทดสอบภาพรวมการลงเวลาวันนี้ — นับเฉพาะเจ้าหน้าที่ สพป. (ผู้ใช้สั่ง 20 พ.ย. 2569)
 *
 *   GET /time/stats → activeUsers / checkedIn / checkedOut ไม่นับบัญชีสถานศึกษา
 *
 * ใช้: node scripts/test-time-stats-scope.js
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));
const simdate = require(path.join(__dirname, '..', 'lib', 'simdate.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
}

(async () => {
  console.log('');
  const db = require(path.join(__dirname, '..', 'db.js'));
  await db.init();

  const madeUsers = [];
  const madeRecords = [];
  const today = simdate.todayISO();

  const mkUser = async (tag, group) => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, first_name, last_name, position, workplace,
       role, status, user_group, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`).run(
      `zzstat_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ สถิติ ${tag}`, `ทดสอบ${tag}`, 'สถิติ',
      'เจ้าหน้าที่', group === 'school' ? '54020001 โรงเรียนทดสอบ' : 'กลุ่มงานทดสอบ',
      'staff', 'active', group
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  const stats = async (cookie) => {
    const res = await fetch(BASE + '/api/time/stats', { headers: { Cookie: cookie } });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  try {
    const adminCookie = 'sid=' + (await auth.newSession(1));
    const before = await stats(adminCookie);
    check(before.status === 200, `GET /time/stats → 200 (ได้ ${before.status})`);

    console.log('① บัญชีสถานศึกษาใหม่ → ตัวเลข "เจ้าหน้าที่ทั้งหมด" ไม่เพิ่ม');
    await mkUser('school', 'school');
    const afterSchool = await stats(adminCookie);
    check(Number(afterSchool.body.activeUsers) === Number(before.body.activeUsers),
      `activeUsers ไม่เปลี่ยน (${before.body.activeUsers} → ${afterSchool.body.activeUsers})`);

    console.log('');
    console.log('② บัญชี สพป. ใหม่ → ตัวเลขเพิ่ม 1');
    await mkUser('office', 'office');
    const afterOffice = await stats(adminCookie);
    check(Number(afterOffice.body.activeUsers) === Number(before.body.activeUsers) + 1,
      `activeUsers +1 (${before.body.activeUsers} → ${afterOffice.body.activeUsers})`);

    console.log('');
    console.log('③ บันทึกเวลาของบัญชีสถานศึกษา → ไม่ถูกนับใน "เข้างานแล้ว"');
    const schoolUser = await db.prepare("SELECT id FROM users WHERE username LIKE 'zzstat_school_%' ORDER BY id DESC LIMIT 1").get();
    if (schoolUser) {
      const info = await db.prepare(`INSERT INTO time_records (user_id, date, clock_in, clock_out)
        VALUES (?,?,?,?)`).run(schoolUser.id, today, '08:30:00', '16:30:00');
      madeRecords.push(Number(info.insertId));
    }
    const afterRec = await stats(adminCookie);
    check(Number(afterRec.body.checkedIn) === Number(afterOffice.body.checkedIn),
      `checkedIn ไม่เปลี่ยน (${afterOffice.body.checkedIn} → ${afterRec.body.checkedIn})`);
    check(Number(afterRec.body.checkedOut) === Number(afterOffice.body.checkedOut),
      `checkedOut ไม่เปลี่ยน (${afterOffice.body.checkedOut} → ${afterRec.body.checkedOut})`);
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    try {
      for (const id of madeRecords) {
        try { await db.prepare('DELETE FROM time_records WHERE id = ?').run(id); } catch (e) { /* ignore */ }
      }
      for (const id of madeUsers) {
        try { await db.prepare('DELETE FROM time_records WHERE user_id = ?').run(id); } catch (e) { /* ignore */ }
        try { await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); } catch (e) { /* ignore */ }
        try { await db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch (e) { /* ignore */ }
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
