'use strict';
/**
 * ทดสอบ "เจ้าหน้าที่วันลาพักผ่อนสะสม" (ผู้ใช้สั่ง 11 พ.ย. 2569)
 *
 * กติกา
 *   - admin กำหนดเจ้าหน้าที่วันลาพักผ่อนสะสมได้ (เพิ่มได้หลายคน)
 *   - เจ้าหน้าที่ที่ถูกกำหนด → เห็นปุ่มแก้ไข (✎) + บันทึกวันลาของทุกคนได้
 *   - คนที่ไม่ใช่ (แม้มี can_approve) → ไม่มีสิทธิ์แก้ไข (PUT = 403)
 *   - ลบชื่อออกจากรายชื่อ → สิทธิ์แก้ไขหายทันที
 *
 * ใช้: node scripts/test-leave-balance-staff.js
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const YEAR = 2570;
const KEY = 'leave_balance_staff';

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
  let backup = null;

  const mkUser = async (tag, canApprove) => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, position, workplace, role, status,
       user_group, can_approve, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`).run(
      `zzlbs_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ วันลาสะสม ${tag}`, 'เจ้าหน้าที่',
      'กลุ่มงานทดสอบ', 'staff', 'active', 'office', canApprove ? 1 : 0
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  const jget = async (p, cookie) => {
    const res = await fetch(BASE + p, { headers: { Cookie: cookie } });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  const jput = async (p, cookie, body) => {
    const res = await fetch(BASE + p, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body || {}),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  try {
    const row = await db.prepare('SELECT value FROM settings WHERE `key` = ?').get(KEY);
    backup = row ? row.value : null;

    const officer = await mkUser('officer', false);
    const approver = await mkUser('approver', true); // มี can_approve แต่ไม่ใช่เจ้าหน้าที่วันลาสะสม
    const adminCookie = 'sid=' + (await auth.newSession(1));
    const officerCookie = 'sid=' + (await auth.newSession(officer));
    const approverCookie = 'sid=' + (await auth.newSession(approver));

    // เริ่มจากยังไม่มีเจ้าหน้าที่วันลาพักผ่อนสะสม
    await db.prepare('DELETE FROM settings WHERE `key` = ?').run(KEY);

    console.log('① ยังไม่กำหนดเจ้าหน้าที่ → แก้ไม่ได้');
    const o1 = await jput('/api/leave-balances/' + officer, officerCookie, {
      year: YEAR, vacation_accumulated: 5, vacation_annual: 10,
    });
    check(o1.status === 403, `PUT /leave-balances/:id → 403 (ได้ ${o1.status})`, JSON.stringify(o1.body));
    const perm0 = await jget('/api/leave-balance-staff', officerCookie);
    check(perm0.status === 200 && perm0.body.canEdit === false, 'canEdit = false',
      JSON.stringify(perm0.body && perm0.body.canEdit));

    console.log('');
    console.log('② admin กำหนดเจ้าหน้าที่วันลาพักผ่อนสะสม');
    const add1 = await jput('/api/leave-balance-staff', adminCookie, { userIds: [officer] });
    check(add1.status === 200, `PUT /leave-balance-staff → 200 (ได้ ${add1.status})`, JSON.stringify(add1.body));
    check(Array.isArray(add1.body.staffIds) && add1.body.staffIds.includes(officer), 'รายชื่อมีเจ้าหน้าที่คนนี้',
      JSON.stringify(add1.body && add1.body.staffIds));

    console.log('');
    console.log('③ เจ้าหน้าที่ที่ถูกกำหนด → แก้ไขได้');
    const perm1 = await jget('/api/leave-balance-staff', officerCookie);
    check(perm1.body.canEdit === true, 'canEdit = true', JSON.stringify(perm1.body && perm1.body.canEdit));
    const list = await jget('/api/leave-balances?year=' + YEAR, officerCookie);
    check(list.status === 200, `GET /leave-balances → 200 (ได้ ${list.status})`);
    const o2 = await jput('/api/leave-balances/' + officer, officerCookie, {
      year: YEAR, vacation_accumulated: 7, vacation_annual: 10,
    });
    check(o2.status === 200, `PUT /leave-balances/:id → 200 (ได้ ${o2.status})`, JSON.stringify(o2.body));
    const saved = await db
      .prepare('SELECT vacation_accumulated FROM user_leave_balances WHERE user_id = ? AND year = ?')
      .get(officer, YEAR);
    check(saved && Number(saved.vacation_accumulated) === 7, 'บันทึกวันลาพักผ่อนสะสมลงฐานแล้ว', JSON.stringify(saved));

    console.log('');
    console.log('④ คนที่ไม่ใช่เจ้าหน้าที่ (ถึงมี can_approve) → ยังแก้ไม่ได้');
    const permA = await jget('/api/leave-balance-staff', approverCookie);
    check(permA.body.canEdit === false, 'canEdit = false', JSON.stringify(permA.body && permA.body.canEdit));
    const a1 = await jput('/api/leave-balances/' + approver, approverCookie, {
      year: YEAR, vacation_accumulated: 3, vacation_annual: 10,
    });
    check(a1.status === 403, `PUT → 403 (ได้ ${a1.status})`, JSON.stringify(a1.body));

    console.log('');
    console.log('⑤ เพิ่มได้หลายคน');
    const add2 = await jput('/api/leave-balance-staff', adminCookie, { userIds: [officer, approver] });
    check(add2.status === 200 && (add2.body.staffIds || []).length === 2, 'มีเจ้าหน้าที่ 2 คน',
      JSON.stringify(add2.body && add2.body.staffIds));
    const permA2 = await jget('/api/leave-balance-staff', approverCookie);
    check(permA2.body.canEdit === true, 'คนที่เพิ่มเข้าไปแก้ไขได้ทันที',
      JSON.stringify(permA2.body && permA2.body.canEdit));
    const adminList = await jget('/api/leave-balance-staff', adminCookie);
    check((adminList.body.staffUsers || []).length === 2 && (adminList.body.candidates || []).length > 0,
      'admin เห็นรายชื่อเจ้าหน้าที่ + รายชื่อให้เลือก',
      JSON.stringify({
        staff: (adminList.body.staffUsers || []).length,
        candidates: (adminList.body.candidates || []).length,
      }));

    console.log('');
    console.log('⑥ ลบชื่อออก → สิทธิ์แก้ไขหายทันที');
    const del = await jput('/api/leave-balance-staff', adminCookie, { userIds: [approver] });
    check(del.status === 200 && !(del.body.staffIds || []).includes(officer), 'ลบเจ้าหน้าที่คนแรกออก',
      JSON.stringify(del.body && del.body.staffIds));
    const perm2 = await jget('/api/leave-balance-staff', officerCookie);
    check(perm2.body.canEdit === false, 'คนที่ถูกลบแก้ไม่ได้แล้ว', JSON.stringify(perm2.body && perm2.body.canEdit));
    const o3 = await jput('/api/leave-balances/' + officer, officerCookie, {
      year: YEAR, vacation_accumulated: 1, vacation_annual: 10,
    });
    check(o3.status === 403, `PUT → 403 (ได้ ${o3.status})`);

    console.log('');
    console.log('⑦ ไม่ใช่ admin → กำหนดรายชื่อไม่ได้');
    const notAdmin = await jput('/api/leave-balance-staff', officerCookie, { userIds: [officer] });
    check(notAdmin.status === 403, `PUT /leave-balance-staff → 403 (ได้ ${notAdmin.status})`);
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    try {
      // คืนค่า settings เดิม
      if (backup === null) await db.prepare('DELETE FROM settings WHERE `key` = ?').run(KEY);
      else {
        await db.prepare('INSERT INTO settings (`key`, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
          .run(KEY, backup);
      }
      for (const id of madeUsers) {
        try { await db.prepare('DELETE FROM user_leave_balances WHERE user_id = ?').run(id); } catch (e) { /* ignore */ }
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
