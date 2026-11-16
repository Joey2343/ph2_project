'use strict';
/**
 * ทดสอบ "วันลาพักผ่อนสะสม" ของใบลา — ต้องเป็นยอดของ "ผู้ขอลา" และปีของใบลา
 * (ผู้ใช้แจ้ง 16 พ.ย. 2569: ใบลาพักผ่อน 76/2570 แสดงสะสม 5 วัน แต่ยอดจริง 20 วัน)
 *
 *   GET /my-leave-balance?userId=&year=
 *     · เจ้าของดูของตัวเองได้
 *     · admin / ผู้อนุมัติสายลาของคนนั้นดูได้
 *     · คนอื่นได้ 403
 *     · ไม่ส่ง userId = ของตัวเอง
 *
 * ใช้: node scripts/test-leave-balance-user.js
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const YEAR = 2570;
const YEAR_OLD = 2569;

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
  const madeLeave = [];
  const backup = {};

  const mkUser = async (tag, canApprove) => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, position, workplace, role, status,
       user_group, can_approve, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`).run(
      `zzbal_${tag}_${Date.now()}`, hash, 'นางสาว', `ทดสอบ ยอดลา ${tag}`, 'เจ้าหน้าที่',
      'กลุ่มงานทดสอบ', 'staff', 'active', 'office', canApprove ? 1 : 0
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  const setSetting = (key, value) => db
    .prepare('INSERT INTO settings (`key`, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
    .run(key, value);

  const jget = async (p, cookie) => {
    const res = await fetch(BASE + p, { headers: { Cookie: cookie } });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  try {
    const owner = await mkUser('owner', false);
    const approver = await mkUser('approver', true);
    const outsider = await mkUser('outsider', false);

    // ยอดสะสม: ปี 2570 = 20 วัน · ปี 2569 = 5 วัน (จำลองเคสที่ผู้ใช้แจ้ง)
    await db.prepare(`INSERT INTO user_leave_balances (user_id, year, vacation_accumulated, vacation_annual)
      VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE vacation_accumulated=VALUES(vacation_accumulated), vacation_annual=VALUES(vacation_annual)`)
      .run(owner, YEAR, 20, 10);
    await db.prepare(`INSERT INTO user_leave_balances (user_id, year, vacation_accumulated, vacation_annual)
      VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE vacation_accumulated=VALUES(vacation_accumulated), vacation_annual=VALUES(vacation_annual)`)
      .run(owner, YEAR_OLD, 5, 10);

    // ใบลาพักผ่อนในปีงบประมาณ 2570 (1 ต.ค. 2569 - 30 ก.ย. 2570)
    const info = await db.prepare(`INSERT INTO leave_requests
      (user_id, leave_type, date_from, date_to, days, reason, status, approval_level, approval_data, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,NOW())`).run(
      owner, 'ลาพักผ่อน', '2026-11-25', '2026-11-27', 3, 'ทดสอบยอดสะสม', 'pending', 0, '[]'
    );
    madeLeave.push(Number(info.insertId));

    // สายอนุมัติ: approver เป็นผู้ตรวจสอบขั้น 1 ของ owner
    const keyRow = await db.prepare("SELECT value FROM settings WHERE `key` = 'leave_approvers'").get();
    backup.leave_approvers = keyRow ? keyRow.value : null;
    await setSetting('leave_approvers', JSON.stringify({ 1: { [String(owner)]: approver }, 2: {}, 3: {} }));

    const cOwner = 'sid=' + (await auth.newSession(owner));
    const cApprover = 'sid=' + (await auth.newSession(approver));
    const cOutsider = 'sid=' + (await auth.newSession(outsider));

    console.log('① เจ้าของดูกยอดตัวเอง (ระบุ userId ตัวเอง)');
    const self = await jget(`/api/my-leave-balance?userId=${owner}&year=${YEAR}`, cOwner);
    check(self.status === 200, `→ 200 (ได้ ${self.status})`);
    check(Number(self.body.accumulated) === 20, `สะสม 20 วัน (ได้ ${self.body.accumulated})`, JSON.stringify(self.body));
    check(Number(self.body.total) === 30, `รวม 30 วัน (สะสม 20 + ประจำปี 10) — ได้ ${self.body.total}`);

    console.log('');
    console.log('② ผู้อนุมัติดูยอดของผู้ขอลา → ได้ยอดของเจ้าของ ไม่ใช่ของตัวเอง');
    const byApprover = await jget(`/api/my-leave-balance?userId=${owner}&year=${YEAR}`, cApprover);
    check(byApprover.status === 200, `→ 200 (ได้ ${byApprover.status})`);
    check(Number(byApprover.body.accumulated) === 20,
      `สะสม 20 วัน (ได้ ${byApprover.body.accumulated})`,
      'เดิมดึงยอดของผู้เปิดดู → แสดง 5 วันในใบลา 76/2570');
    check(Number(byApprover.body.userId) === owner, 'คืน userId ของเจ้าของยอด', JSON.stringify(byApprover.body.userId));

    console.log('');
    console.log('③ เลือกปีงบประมาณได้ (2570 = 20 วัน · 2569 = 5 วัน)');
    const old = await jget(`/api/my-leave-balance?userId=${owner}&year=${YEAR_OLD}`, cApprover);
    check(Number(old.body.accumulated) === 5, `ปี 2569 สะสม 5 วัน (ได้ ${old.body.accumulated})`, JSON.stringify(old.body));
    const cur = await jget(`/api/my-leave-balance?userId=${owner}&year=${YEAR}`, cApprover);
    check(Number(cur.body.accumulated) === 20, `ปี 2570 สะสม 20 วัน (ได้ ${cur.body.accumulated})`);

    console.log('');
    console.log('④ คนที่ไม่เกี่ยวข้อง → 403');
    const deny = await jget(`/api/my-leave-balance?userId=${owner}&year=${YEAR}`, cOutsider);
    check(deny.status === 403, `→ 403 (ได้ ${deny.status})`, JSON.stringify(deny.body));

    console.log('');
    console.log('⑤ ไม่ส่ง userId → ของตัวเอง (ไม่รั่วข้อมูลคนอื่น)');
    const mine = await jget(`/api/my-leave-balance?year=${YEAR}`, cOutsider);
    check(mine.status === 200, `→ 200 (ได้ ${mine.status})`);
    check(Number(mine.body.userId) === outsider, 'คืน userId ของตัวเอง', JSON.stringify(mine.body.userId));
    check(Number(mine.body.accumulated) === 0, 'คนที่ยังไม่ตั้งยอด → 0', JSON.stringify(mine.body.accumulated));
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    try {
      for (const id of madeLeave) {
        try { await db.prepare('DELETE FROM leave_requests WHERE id = ?').run(id); } catch (e) { /* ignore */ }
      }
      if (backup.leave_approvers === undefined || backup.leave_approvers === null) {
        await db.prepare("DELETE FROM settings WHERE `key` = 'leave_approvers'").run();
      } else {
        await setSetting('leave_approvers', backup.leave_approvers);
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
