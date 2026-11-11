'use strict';
/**
 * ทดสอบข้อมูลเจ้าหน้าที่การลา (public) — ต้องแยกให้รู้ว่าใครอยู่ "สายสถานศึกษา"
 * (ผู้ใช้สั่ง 11 พ.ย. 2569: เจ้าหน้าที่การลาของสถานศึกษาเห็นแท็บลาของสถานศึกษา)
 *
 *   GET /leave-approvers-public
 *     · approvers        = รวมทั้ง 2 สาย (ใช้ตัดสินสิทธิ์พิจารณา)
 *     · schoolApprovers  = เฉพาะสายสถานศึกษา (ใช้ตัดสินการเห็นแท็บ)
 *
 * ใช้: node scripts/test-leave-approvers-public.js
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

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
  let backupOffice = null;
  let backupSchool = null;

  const mkUser = async (tag) => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, position, workplace, role, status, user_group, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,NOW(),NOW())`).run(
      `zzlap_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ สายการลา ${tag}`, 'เจ้าหน้าที่',
      'กลุ่มงานทดสอบ', 'staff', 'active', 'office'
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  const setSetting = (key, value) => db
    .prepare('INSERT INTO settings (`key`, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
    .run(key, value);

  try {
    const officeApprover = await mkUser('office');
    const schoolApprover = await mkUser('school');

    const o = await db.prepare("SELECT value FROM settings WHERE `key` = 'leave_approvers'").get();
    const s = await db.prepare("SELECT value FROM settings WHERE `key` = 'leave_approvers_school'").get();
    backupOffice = o ? o.value : null;
    backupSchool = s ? s.value : null;

    // สาย สพป.: ผู้ตรวจสอบ (ขั้น 1) = officeApprover
    await setSetting('leave_approvers', JSON.stringify({ 1: { 900001: officeApprover }, 2: {}, 3: {} }));
    // สายสถานศึกษา: ผู้อนุมัติขั้นต้น (ขั้น 2) = schoolApprover
    await setSetting('leave_approvers_school', JSON.stringify({ 1: {}, 2: { 900002: schoolApprover }, 3: {} }));

    const cookie = 'sid=' + (await auth.newSession(officeApprover));
    const res = await fetch(BASE + '/api/leave-approvers-public', { headers: { Cookie: cookie } });
    const body = await res.json().catch(() => ({}));
    check(res.status === 200, `GET /leave-approvers-public → 200 (ได้ ${res.status})`);

    const allIds = ['1', '2', '3'].flatMap((lv) => (body.approvers || {})[lv] || []);
    check(allIds.includes(officeApprover), 'approvers รวมสาย สพป.', JSON.stringify(allIds));
    check(allIds.includes(schoolApprover), 'approvers รวมสายสถานศึกษา', JSON.stringify(allIds));

    const schoolIds = ['1', '2', '3'].flatMap((lv) => (body.schoolApprovers || {})[lv] || []);
    check(schoolIds.includes(schoolApprover), 'schoolApprovers มีคนของสายสถานศึกษา', JSON.stringify(schoolIds));
    check(!schoolIds.includes(officeApprover), 'schoolApprovers ไม่มีคนของสาย สพป.', JSON.stringify(schoolIds));
    check(Array.isArray(body.schoolApprovers && body.schoolApprovers['3']), 'schoolApprovers มีครบ 3 ลำดับ',
      JSON.stringify(body.schoolApprovers));
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    try {
      // คืนค่า settings เดิม
      if (backupOffice === null) await db.prepare("DELETE FROM settings WHERE `key` = 'leave_approvers'").run();
      else await setSetting('leave_approvers', backupOffice);
      if (backupSchool === null) await db.prepare("DELETE FROM settings WHERE `key` = 'leave_approvers_school'").run();
      else await setSetting('leave_approvers_school', backupSchool);

      for (const id of madeUsers) {
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
