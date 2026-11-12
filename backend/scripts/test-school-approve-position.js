'use strict';
/**
 * ทดสอบ "ตำแหน่งที่เลือก" ของขั้นอนุมัติขั้นต้น (สายสถานศึกษา)
 * (ผู้ใช้สั่ง 12 พ.ย. 2569)
 *
 *   · ไปราชการ (สถานศึกษา) ขั้นที่ 2 = ผู้อนุมัติขั้นต้น → เลือกตำแหน่งได้
 *   · ลา (สถานศึกษา) ขั้นที่ 2 = ผู้อนุมัติขั้นต้น (หน้าต่าง "อนุมัติขั้นต้น") → เลือกตำแหน่งได้
 *
 * ค่าที่เลือกต้องถูกบันทึกใน approval_data[].position (เอกสารใช้แสดงตำแหน่งลงนาม)
 *
 * ใช้: node scripts/test-school-approve-position.js
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
  const madeTravel = [];
  const madeLeave = [];
  const backup = {};

  const mkUser = async (tag, group, canApprove) => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, position, workplace, role, status,
       user_group, can_approve, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`).run(
      `zzpos_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ ตำแหน่ง ${tag}`, 'เจ้าหน้าที่',
      group === 'school' ? '54020001 โรงเรียนทดสอบ' : 'กลุ่มงานทดสอบ', 'staff', 'active',
      group, canApprove ? 1 : 0
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  const setSetting = (key, value) => db
    .prepare('INSERT INTO settings (`key`, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
    .run(key, value);

  const jput = async (p, cookie, body) => {
    const res = await fetch(BASE + p, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body || {}),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  try {
    const requester = await mkUser('requester', 'school', false);
    const reviewer = await mkUser('reviewer', 'office', true);
    const supervisor = await mkUser('supervisor', 'office', true);
    const approver = await mkUser('approver', 'office', true);

    for (const key of ['travel_approvers_school', 'leave_approvers_school']) {
      const row = await db.prepare('SELECT value FROM settings WHERE `key` = ?').get(key);
      backup[key] = row ? row.value : null;
    }

    // สาย 3 ขั้น: reviewer → supervisor (ผู้อนุมัติขั้นต้น) → approver
    await setSetting('travel_approvers_school', JSON.stringify({
      [String(requester)]: { reviewer, supervisor, approver },
    }));
    await setSetting('leave_approvers_school', JSON.stringify({
      1: { [String(requester)]: reviewer },
      2: { [String(requester)]: supervisor },
      3: { [String(requester)]: approver },
    }));

    const cReviewer = 'sid=' + (await auth.newSession(reviewer));
    const cSupervisor = 'sid=' + (await auth.newSession(supervisor));

    /* ---------- ① ไปราชการ (สถานศึกษา) ---------- */
    const tInfo = await db.prepare(`INSERT INTO travel_requests
      (user_id, title, destination, date_from, date_to, days, status, approval_level, approval_data, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,NOW())`).run(
      requester, 'ทดสอบตำแหน่งขั้นต้น', 'สพป.แพร่ เขต 2', '2026-11-20', '2026-11-20', 1,
      'pending', 0, '[]'
    );
    const travelId = Number(tInfo.insertId);
    madeTravel.push(travelId);

    const t1 = await jput('/api/travel/' + travelId + '/approve', cReviewer, {});
    check(t1.status === 200, `ไปราชการ: ผู้ตรวจสอบส่งต่อ → 200 (ได้ ${t1.status})`, JSON.stringify(t1.body));
    const t2 = await jput('/api/travel/' + travelId + '/approve', cSupervisor, {
      note: JSON.stringify({ choices: ['ควรอนุญาต'], reasonMap: {} }),
      position: 'ผู้อำนวยการโรงเรียนทดสอบ',
    });
    check(t2.status === 200, `ไปราชการ: ผู้อนุมัติขั้นต้น + ตำแหน่ง → 200 (ได้ ${t2.status})`, JSON.stringify(t2.body));
    const tRow = await db.prepare('SELECT approval_level, status, approval_data FROM travel_requests WHERE id = ?').get(travelId);
    let tData = [];
    try { tData = JSON.parse(tRow.approval_data || '[]'); } catch (e) { tData = []; }
    check(tData.length === 2, `ไปราชการ: มี 2 ขั้นที่บันทึกแล้ว (ได้ ${tData.length})`, JSON.stringify(tData));
    check(tData[1] && tData[1].position === 'ผู้อำนวยการโรงเรียนทดสอบ',
      'ไปราชการ: บันทึกตำแหน่งที่เลือกในขั้นอนุมัติขั้นต้น', JSON.stringify(tData[1] && tData[1].position));
    check(Number(tRow.status !== 'approved'), 'ไปราชการ: ยังไม่จบสาย (รอขั้นที่ 3)');

    /* ---------- ② ลา (สถานศึกษา) ---------- */
    const lInfo = await db.prepare(`INSERT INTO leave_requests
      (user_id, leave_type, date_from, date_to, days, reason, status, approval_level, approval_data, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,NOW())`).run(
      requester, 'ลาป่วย', '2026-11-20', '2026-11-20', 1, 'ทดสอบตำแหน่งขั้นต้น',
      'pending', 0, '[]'
    );
    const leaveId = Number(lInfo.insertId);
    madeLeave.push(leaveId);

    const l1 = await jput('/api/leaves/' + leaveId + '/review', cReviewer, {});
    check(l1.status === 200, `ลา: ผู้ตรวจสอบส่งต่อ → 200 (ได้ ${l1.status})`, JSON.stringify(l1.body));
    const l2 = await jput('/api/leaves/' + leaveId + '/approve', cSupervisor, {
      note: 'เห็นควรอนุญาต',
      position: 'ผู้อำนวยการโรงเรียนทดสอบ',
    });
    check(l2.status === 200, `ลา: อนุมัติขั้นต้น + ตำแหน่ง → 200 (ได้ ${l2.status})`, JSON.stringify(l2.body));
    const lRow = await db.prepare('SELECT approval_level, status, approval_data FROM leave_requests WHERE id = ?').get(leaveId);
    let lData = [];
    try { lData = JSON.parse(lRow.approval_data || '[]'); } catch (e) { lData = []; }
    check(lData.length === 2, `ลา: มี 2 ขั้นที่บันทึกแล้ว (ได้ ${lData.length})`, JSON.stringify(lData));
    check(lData[1] && lData[1].position === 'ผู้อำนวยการโรงเรียนทดสอบ',
      'ลา: บันทึกตำแหน่งที่เลือกในขั้นอนุมัติขั้นต้น', JSON.stringify(lData[1] && lData[1].position));
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    try {
      for (const id of madeTravel) {
        try { await db.prepare('DELETE FROM travel_requests WHERE id = ?').run(id); } catch (e) { /* ignore */ }
      }
      for (const id of madeLeave) {
        try { await db.prepare('DELETE FROM leave_requests WHERE id = ?').run(id); } catch (e) { /* ignore */ }
      }
      for (const [key, value] of Object.entries(backup)) {
        if (value === null) await db.prepare('DELETE FROM settings WHERE `key` = ?').run(key);
        else await setSetting(key, value);
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
