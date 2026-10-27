'use strict';
/**
 * ทดสอบว่าป้ายแจ้งเตือนบนการ์ด "ขออนุญาตลา" นับเฉพาะคำขอที่ "ฉันเป็นผู้อนุมัติจริง"
 *
 * ทำไมต้องมี
 * ──────────
 * ผู้ใช้แจ้ง: ป้ายวงกลมแดงบนการ์ด "ขออนุญาตลา" ขึ้น 2 แต่พอกดเข้าไปในรายการมีให้อนุมัติ 1
 *
 * สาเหตุ
 *   `/my-pending` เดิมใช้ `countAwaiting('leave_requests', levels)` โดย levels มาจาก
 *   `getUserSystemLevels(user,'leave')` ซึ่ง **flatten รายชื่อผู้อนุมัติทุกคนทุกระดับ**
 *   → ถ้าฉันเป็นผู้อนุมัติขั้น 1 ของ "บางคน" ระบบจะนับ **ทุกคำขอ pending ขั้น 1 ของทั้งองค์กร**
 *   ทั้งที่คำขอของคนอื่นตั้งผู้อนุมัติเป็นคนอื่น
 *
 *   หน้า #/leave ใช้สูตรต่างกัน (myLevels = per-person map + nextLevel ตามสายของผู้ขอ)
 *   → ตัวเลขจึงไม่ตรงกัน
 *
 * สิ่งที่ต้องผ่าน
 *   ① ตั้งผู้อนุมัติขั้น 1 ของผู้ขอ A = X (per-person) → X เห็นป้าย = 1 (เฉพาะของ A)
 *   ② คำขอของผู้ขอ B (ไม่ได้ตั้ง X เป็นผู้อนุมัติ) ต้องไม่ถูกนับให้ X
 *   ③ admin ยังเห็นครบทุกคำขอ (2)
 *
 * ใช้: node scripts/test-leave-badge-count.js
 * ⚠️ รันผ่าน `npm run verify` (เซิร์ฟเวอร์ทดสอบปิด Telegram) และคืนค่า settings เดิมทุกครั้ง
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));
const approvals = require(path.join(__dirname, '..', 'lib', 'approvals.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
}

async function sessionOf(userId) {
  return 'sid=' + (await auth.newSession(userId));
}
async function jget(p, cookie) {
  const res = await fetch(BASE + p, { headers: { Cookie: cookie } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

(async () => {
  console.log('');
  const db = require(path.join(__dirname, '..', 'db.js'));
  await db.init();

  const madeUsers = [];
  const madeSessions = [];
  const madeLeaves = [];

  const mkUser = async (tag) => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, position, workplace, role, status,
       user_group, school_code, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `zzbadge_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ ป้าย ${tag}`, 'เจ้าหน้าที่',
      'สพป.แพร่ เขต 2', 'staff', 'active', 'office', '',
      '2026-10-27 09:00:00', '2026-10-27 09:00:00'
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    const sid = await auth.newSession(id);
    madeSessions.push(sid);
    return { id, sid };
  };

  // สำรองค่าเดิมของ settings ที่จะแก้
  const backup = await db.prepare("SELECT value FROM settings WHERE `key` = 'leave_approvers'").get();
  const restore = async () => {
    if (backup) {
      await db.prepare("UPDATE settings SET value = ? WHERE `key` = 'leave_approvers'").run(backup.value);
    } else {
      await db.prepare("DELETE FROM settings WHERE `key` = 'leave_approvers'").run();
    }
  };

  try {
    // X = ผู้อนุมัติ, A = ผู้ขอที่ตั้ง X ไว้, B = ผู้ขอที่ไม่ได้ตั้ง X
    const X = await mkUser('x');
    const A = await mkUser('a');
    const B = await mkUser('b');

    // per-person: ขั้น 1 ของ A → X เท่านั้น
    await db.prepare(`INSERT INTO settings (\`key\`, value) VALUES (?,?)
      ON DUPLICATE KEY UPDATE value = VALUES(value)`)
      .run('leave_approvers', JSON.stringify({ 1: { [String(A.id)]: String(X.id) }, 2: {}, 3: {} }));

    const mkLeave = async (userId, type) => {
      const info = await db.prepare(`INSERT INTO leave_requests
        (user_id, leave_type, date_from, date_to, days, status, approval_level, approval_data, created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
        userId, type, '2027-02-01', '2027-02-01', 1, 'pending', 0, '[]', '2026-10-27 09:00:00'
      );
      const id = Number(info.insertId);
      madeLeaves.push(id);
      return id;
    };
    await mkLeave(A.id, 'ลาป่วย');
    await mkLeave(B.id, 'ลากิจ');

    console.log('');
    console.log('① ผู้อนุมัติ X เห็นเฉพาะคำขอที่ตั้งตัวเองไว้');
    const xCookie = 'sid=' + X.sid;
    const xPend = await jget('/api/my-pending', xCookie);
    const xLeave = (xPend.body && xPend.body.approve && xPend.body.approve.leave) || {};
    const xTotal = Object.keys(xLeave).filter((k) => k !== 'group').reduce((n, k) => n + Number(xLeave[k] || 0), 0);
    check(xPend.status === 200, 'GET /api/my-pending → 200', `ได้ ${xPend.status}`);
    check(xTotal === 1, `ป้าย "ขออนุญาตลา" ของ X = 1 (ได้ ${xTotal})`,
      `รายละเอียดต่อขั้น: ${JSON.stringify(xLeave)} — ถ้าเป็น 2 แสดงว่านับคำขอของคนอื่นมาด้วย`);

    console.log('');
    console.log('② admin เห็นครบทุกคำขอ');
    const adminSid = await auth.newSession(1);
    madeSessions.push(adminSid);
    const adPend = await jget('/api/my-pending', 'sid=' + adminSid);
    const adLeave = (adPend.body && adPend.body.approve && adPend.body.approve.leave) || {};
    const adTotal = Object.keys(adLeave).filter((k) => k !== 'group').reduce((n, k) => n + Number(adLeave[k] || 0), 0);
    check(adTotal === 2, `ป้ายของ admin = 2 (ได้ ${adTotal})`, JSON.stringify(adLeave));

    console.log('');
    console.log('③ ตัวเลขต้องตรงกับหน้า #/leave (รายการที่กดอนุมัติได้จริง)');
    const leaves = await jget('/api/leaves?status=pending', xCookie);
    const rows = (leaves.body && leaves.body.requests) || [];
    // สูตรเดียวกับ LeavePage: next level ตาม chain + per-person map
    const mine = [];
    for (const r of rows) {
      const chain = Array.isArray(r.chain) && r.chain.length ? r.chain : [1, 2, 3];
      const next = chain[(r.approvals || []).length];
      const ids = next ? await approvals.leaveApproverIdsFor(r.user_id, next) : [];
      if (next && ids.includes(X.id)) mine.push(r.id);
    }
    check(mine.length === xTotal, `จำนวนในรายการ (${mine.length}) ตรงกับป้าย (${xTotal})`,
      `รายการที่อนุมัติได้: ${JSON.stringify(mine)}`);
  } finally {
    for (const id of madeLeaves) {
      try { await db.prepare('DELETE FROM leave_requests WHERE id = ?').run(id); } catch (e) { /* ignore */ }
    }
    for (const sid of madeSessions) {
      try { await db.prepare('DELETE FROM sessions WHERE token = ?').run(sid); } catch (e) { /* ignore */ }
    }
    for (const id of madeUsers) {
      try { await db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch (e) { /* ignore */ }
    }
    try { await restore(); } catch (e) { console.log('  ⚠ คืนค่า settings ไม่สำเร็จ: ' + e.message); }
    await db.close();
  }

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ทดสอบล้มเหลว:', e);
  process.exit(1);
});
