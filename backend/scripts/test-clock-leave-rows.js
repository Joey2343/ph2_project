'use strict';
/**
 * ทดสอบว่า "ผู้ที่ลา (อนุมัติแล้ว)" ของวันนั้น
 *   ① ลงเวลาเข้า/ออกไม่ได้ (403)
 *   ② มีชื่อในรายการบันทึกเวลาทำงานของเจ้าหน้าที่
 *      โดยคอลัมน์สถานที่ทำงาน = ประเภทการลา และไม่แสดงเวลาเข้า/ออก
 *   ③ คำขอที่ยังไม่อนุมัติ (pending) ต้องไม่ถูกบล็อก/ไม่ถูกดึงมาแสดง
 *
 * ใช้: node scripts/test-clock-leave-rows.js
 * ⚠️ รันผ่าน `npm run verify` (เซิร์ฟเวอร์ทดสอบปิด Telegram)
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

async function jget(p, cookie) {
  const res = await fetch(BASE + p, { headers: { Cookie: cookie } });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function jpost(p, cookie, body) {
  const res = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

(async () => {
  console.log('');
  const db = require(path.join(__dirname, '..', 'db.js'));
  await db.init();

  const madeUsers = [];
  const madeLeaves = [];
  const mkUser = async (tag) => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, position, workplace, role, status,
       user_group, school_code, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `zzleaveclock_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ ลาในวันนี้ ${tag}`,
      'เจ้าหน้าที่', 'สพป.แพร่ เขต 2', 'staff', 'active', 'office', '',
      '2026-10-29 09:00:00', '2026-10-29 09:00:00'
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  const today = simdate.todayISO();
  const adminSid = await auth.newSession(1);

  try {
    const L1 = await mkUser('approved');
    const L2 = await mkUser('pending');

    const mkLeave = async (userId, status, type) => {
      const info = await db.prepare(`INSERT INTO leave_requests
        (user_id, leave_type, date_from, date_to, days, reason, status, approval_level, approval_data, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        userId, type, today, today, 1, 'ทดสอบลา', status, 0, '[]', '2026-10-29 09:00:00'
      );
      const id = Number(info.insertId);
      madeLeaves.push(id);
      return id;
    };
    await mkLeave(L1, 'approved', 'ลาป่วย');
    await mkLeave(L2, 'pending', 'ลากิจ');

    console.log('');
    console.log('① รายการบันทึกเวลาทำงานแสดงผู้ที่ลา พร้อมประเภทการลา');
    const all = await jget('/api/time/all?date=' + today, 'sid=' + adminSid);
    check(all.status === 200, 'GET /api/time/all?date= → 200', `ได้ ${all.status}`);
    const rows = (all.body && all.body.records) || [];
    const row1 = rows.find((r) => Number(r.user_id) === L1);
    check(!!row1, 'พบชื่อผู้ที่ลาในรายการ', `ไม่พบ user ${L1}`);
    check(row1 && row1.work_site === 'ลาป่วย', 'สถานที่ทำงาน = ประเภทการลา ("ลาป่วย")', `ได้ "${row1 && row1.work_site}"`);
    check(row1 && !row1.clock_in && !row1.clock_out, 'ไม่มีเวลาเข้า/ออก');
    check(row1 && row1.id === null, 'ไม่มี id ของบันทึกเวลา (แก้ไข/ลบไม่ได้)');
    check(row1 && row1.is_leave === 1, 'ทำเครื่องหมาย is_leave = 1', `ได้ ${row1 && row1.is_leave}`);

    console.log('');
    console.log('② ผู้ที่ลาลงเวลาไม่ได้');
    const l1Cookie = 'sid=' + (await auth.newSession(L1));
    const todayL1 = await jget('/api/time/today', l1Cookie);
    check(todayL1.body && todayL1.body.on_leave === true, '/time/today บอกว่าลา (on_leave = true)',
      JSON.stringify(todayL1.body && todayL1.body.on_leave));
    check(todayL1.body && todayL1.body.leave_type === 'ลาป่วย', 'คืนประเภทการลา', `ได้ "${todayL1.body && todayL1.body.leave_type}"`);
    const inTry = await jpost('/api/time/check', l1Cookie, { type: 'in' });
    check(inTry.status === 403, 'กดลงเวลาเข้างาน → 403', `ได้ ${inTry.status}`);
    check(String((inTry.body || {}).error || '').includes('ลา'), 'ข้อความแจ้งว่า "ลา"', JSON.stringify(inTry.body && inTry.body.error));
    const outTry = await jpost('/api/time/check', l1Cookie, { type: 'out' });
    check(outTry.status === 403, 'กดลงเวลาออกงาน → 403', `ได้ ${outTry.status}`);

    console.log('');
    console.log('③ คำขอที่ยังไม่อนุมัติต้องไม่บล็อกและไม่แสดง');
    const l2Cookie = 'sid=' + (await auth.newSession(L2));
    const todayL2 = await jget('/api/time/today', l2Cookie);
    check(todayL2.body && todayL2.body.on_leave === false, 'ผู้ที่ลายัง pending → on_leave = false',
      JSON.stringify(todayL2.body && todayL2.body.on_leave));
    const row2 = rows.find((r) => Number(r.user_id) === L2);
    check(!row2, 'ไม่แสดงแถวของผู้ที่ลายัง pending');

    // รายงานการลงเวลาต้องมีผู้ที่ลาด้วย (สถานที่ทำงาน = ประเภทการลา)
    const rep = await jget('/api/time/report?period=day&date=' + today, 'sid=' + adminSid);
    const repRows = (rep.body && rep.body.records) || [];
    const repL1 = repRows.find((r) => Number(r.user_id) === L1);
    check(rep.status === 200 && !!repL1, 'รายงานการลงเวลามีผู้ที่ลาด้วย', `มี ${repRows.length} แถว`);
    check(repL1 && repL1.work_site === 'ลาป่วย', 'รายงาน: สถานที่ทำงาน = "ลาป่วย"', `ได้ "${repL1 && repL1.work_site}"`);
    check(repRows.every((r) => Number(r.user_id) !== L2), 'รายงานไม่แสดงผู้ที่ลายัง pending');

    for (const id of madeLeaves) {
      try { await db.prepare('DELETE FROM leave_requests WHERE id = ?').run(id); } catch (e) { /* ignore */ }
    }
    for (const id of madeUsers) {
      try { await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); } catch (e) { /* ignore */ }
      try { await db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch (e) { /* ignore */ }
    }
    try { await db.prepare('DELETE FROM sessions WHERE token = ?').run(adminSid); } catch (e) { /* ignore */ }
  } catch (e) {
    console.error('  ⚠ ' + e.message);
    fail += 1;
  } finally {
    await db.close();
  }

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ทดสอบล้มเหลว:', e);
  process.exit(1);
});
