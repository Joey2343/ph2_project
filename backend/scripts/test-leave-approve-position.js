'use strict';
/**
 * ทดสอบ "ตำแหน่งที่เลือกตอนอนุมัติคำขอลา" — ผู้ใช้สั่ง 10 พ.ย. 2569
 *
 * หน้าต่าง "ยืนยันการดำเนินการ" มีส่วน "กรุณาเลือกตำแหน่งที่จะอนุมัติ/อนุญาต"
 * (เหมือนหน้าอนุมัติไปราชการ) → ตำแหน่งที่เลือกต้องถูกบันทึกลง approval_data
 *
 * สิ่งที่ต้องผ่าน
 *   ① ส่ง position มา → approval_data.position = ค่าที่ส่ง
 *   ② ไม่ส่ง position → ใช้ตำแหน่งจริงของผู้ใช้
 *
 * ใช้: node scripts/test-leave-approve-position.js
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
  const savedRow = await db.prepare("SELECT value FROM settings WHERE `key` = 'leave_approvers'").get();
  const savedRaw = savedRow ? savedRow.value : null;

  const mkUser = async (tag, position) => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, position, workplace, role, status,
       user_group, school_code, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `zzleavepos_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ ตำแหน่ง ${tag}`, position || 'เจ้าหน้าที่',
      'สพป.แพร่ เขต 2', 'staff', 'active', 'office', '', '2026-10-01 09:00:00', '2026-10-01 09:00:00'
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  const mkLeave = async (userId) => {
    const info = await db.prepare(`INSERT INTO leave_requests
      (user_id, leave_type, date_from, date_to, days, reason, status, approval_level, approval_data, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      userId, 'ลากิจ', '2026-11-10', '2026-11-10', 1, 'ทดสอบตำแหน่งลงนาม', 'pending', 0, '[]', '2026-11-10 09:00:00'
    );
    const id = Number(info.insertId);
    madeLeaves.push(id);
    return id;
  };

  try {
    const requester = await mkUser('req', 'เจ้าหน้าที่');
    const approver = await mkUser('ap', 'รองผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2');
    const leaveA = await mkLeave(requester);
    const leaveB = await mkLeave(requester);

    // สายอนุมัติ 1 ขั้น: ผู้ขอคนนี้ → ผู้อนุมัติ = approver
    await db.prepare("INSERT INTO settings (`key`, value) VALUES ('leave_approvers', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)")
      .run(JSON.stringify({ 1: { [requester]: approver } }));

    const cookie = 'sid=' + (await auth.newSession(approver));

    console.log('');
    console.log('① ส่ง position มา → บันทึกตำแหน่งที่เลือก');
    const r1 = await fetch(BASE + '/api/leaves/' + leaveA + '/approve', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ position: 'ตำแหน่งที่เลือกทดสอบ' }),
    });
    check(r1.status === 200, `PUT /leaves/:id/approve → 200 (ได้ ${r1.status})`);
    const row1 = await db.prepare('SELECT status, approval_data FROM leave_requests WHERE id = ?').get(leaveA);
    const ap1 = (() => { try { return JSON.parse(row1.approval_data || '[]'); } catch (e) { return []; } })();
    check(ap1.length === 1, `มีข้อมูลอนุมัติ 1 รายการ (ได้ ${ap1.length})`);
    check(ap1[0] && ap1[0].position === 'ตำแหน่งที่เลือกทดสอบ', 'บันทึกตำแหน่งที่เลือกไว้',
      JSON.stringify(ap1[0] && ap1[0].position));
    check(row1.status === 'approved', 'อนุมัติครบขั้นแล้ว (status = approved)', JSON.stringify(row1.status));

    console.log('');
    console.log('② ไม่ส่ง position → ใช้ตำแหน่งจริงของผู้ใช้');
    const r2 = await fetch(BASE + '/api/leaves/' + leaveB + '/approve', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({}),
    });
    check(r2.status === 200, `PUT /leaves/:id/approve (ไม่มี position) → 200 (ได้ ${r2.status})`);
    const row2 = await db.prepare('SELECT approval_data FROM leave_requests WHERE id = ?').get(leaveB);
    const ap2 = (() => { try { return JSON.parse(row2.approval_data || '[]'); } catch (e) { return []; } })();
    check(ap2[0] && ap2[0].position === 'รองผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2',
      'ใช้ตำแหน่งของผู้ใช้เมื่อไม่ได้เลือก', JSON.stringify(ap2[0] && ap2[0].position));
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
      if (savedRaw === null) await db.prepare("DELETE FROM settings WHERE `key` = 'leave_approvers'").run();
      else await db.prepare("UPDATE settings SET value = ? WHERE `key` = 'leave_approvers'").run(savedRaw);
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
