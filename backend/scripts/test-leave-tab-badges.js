'use strict';
/**
 * ทดสอบตัวเลขแจ้งเตือนบนแท็บของหน้า #/leave
 * (ผู้ใช้สั่ง 11 พ.ย. 2569: ป้ายวงกลมแดงแบบเดียวกับบนการ์ดเมนูหน้าแรก หลังชื่อแท็บ)
 *
 * ตัวเลขมาจาก GET /my-pending → approve.leave_tabs = { general, vacation, 'general-school' }
 *   · general        = ลาป่วย/กิจ/คลอด ของเจ้าหน้าที่ สพป. ที่รอฉันอนุมัติ
 *   · vacation       = ลาพักผ่อน ของเจ้าหน้าที่ สพป. ที่รอฉันอนุมัติ
 *   · general-school = ลาของสถานศึกษา (ไม่ใช่พักผ่อน) ที่รอฉันอนุมัติ
 *
 * ใช้ผลต่าง (delta) เพื่อไม่พังเมื่อฐานมีรายการค้างจากเทสต์อื่น
 *
 * ใช้: node scripts/test-leave-tab-badges.js
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
  const madeLeaves = [];

  const mkUser = async (tag, group) => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, position, workplace, role, status, user_group, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,NOW(),NOW())`).run(
      `zztab_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ ป้ายแท็บ ${tag}`, 'เจ้าหน้าที่',
      'กลุ่มงานทดสอบ', 'staff', 'active', group
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  const mkLeave = async (userId, leaveType) => {
    const info = await db.prepare(`INSERT INTO leave_requests
      (user_id, leave_type, date_from, date_to, days, reason, status, approval_level, approval_data, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,NOW())`).run(
      userId, leaveType, '2026-11-20', '2026-11-20', 1, 'ทดสอบป้ายแท็บ',
      'pending', 0, JSON.stringify([])
    );
    const id = Number(info.insertId);
    madeLeaves.push(id);
    return id;
  };

  const badges = async (cookie) => {
    const res = await fetch(BASE + '/api/my-pending', { headers: { Cookie: cookie } });
    const j = await res.json().catch(() => ({}));
    return { status: res.status, tabs: (j.approve && j.approve.leave_tabs) || {}, leave: (j.approve && j.approve.leave) || {} };
  };

  try {
    const adminCookie = 'sid=' + (await auth.newSession(1));
    const officeUser = await mkUser('office', 'office');
    const schoolUser = await mkUser('school', 'school');

    const before = await badges(adminCookie);
    check(before.status === 200, `GET /my-pending → 200 (ได้ ${before.status})`);
    check(typeof before.tabs === 'object', 'มี approve.leave_tabs');

    // สร้างคำขอ pending 3 รายการ: ลาป่วย (office) · ลาพักผ่อน (office) · ลากิจ (school)
    await mkLeave(officeUser, 'ลาป่วย');
    await mkLeave(officeUser, 'ลาพักผ่อน');
    await mkLeave(schoolUser, 'ลากิจ');

    const after = await badges(adminCookie);
    const d = {
      general: (Number(after.tabs.general) || 0) - (Number(before.tabs.general) || 0),
      vacation: (Number(after.tabs.vacation) || 0) - (Number(before.tabs.vacation) || 0),
      school: (Number(after.tabs['general-school']) || 0) - (Number(before.tabs['general-school']) || 0),
    };
    check(d.general === 1, `แท็บ "ลาป่วย ลากิจ ลาคลอด" เพิ่ม 1 (ได้ ${d.general})`, JSON.stringify(after.tabs));
    check(d.vacation === 1, `แท็บ "ลาพักผ่อน" เพิ่ม 1 (ได้ ${d.vacation})`, JSON.stringify(after.tabs));
    check(d.school === 1, `แท็บ "ลาของสถานศึกษา" เพิ่ม 1 (ได้ ${d.school})`, JSON.stringify(after.tabs));

    const sumTabs = ['general', 'vacation', 'general-school']
      .reduce((n, k) => n + (Number(after.tabs[k]) || 0), 0);
    const sumLevels = Object.values(after.leave || {}).reduce((n, v) => n + (Number(v) || 0), 0);
    check(sumTabs === sumLevels, `ผลรวมแท็บ = ผลรวมขั้นอนุมัติ (${sumTabs} / ${sumLevels})`,
      JSON.stringify({ tabs: after.tabs, levels: after.leave }));
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    try {
      for (const id of madeLeaves) {
        try { await db.prepare('DELETE FROM leave_requests WHERE id = ?').run(id); } catch (e) { /* ignore */ }
      }
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
