'use strict';
/**
 * ทดสอบว่ารายการ "บันทึกเวลาทำงานของเจ้าหน้าที่" แสดงคนที่ "ไปราชการ" ของวันนั้น
 *
 * ความต้องการ (ผู้ใช้):
 *   ผู้ที่ไปราชการ (อนุมัติแล้วในรายการขออนุมัติ/อนุญาตเดินทางไปราชการ)
 *   ต้องมีชื่อในรายการบันทึกเวลาทำงานของวันนั้น
 *   โดยคอลัมน์ "สถานที่ทำงาน" = "ไปราชการ"
 *   และไม่แสดงเวลาเข้า/ออก (เพราะไม่ได้ลงเวลา)
 *
 * สิ่งที่ต้องผ่าน
 *   ① /time/all?date=... มีแถวของผู้ที่ไปราชการ (work_site = "ไปราชการ", clock_in/out ว่าง)
 *   ② ถ้าคนนั้นมีบันทึกเวลาของวันนั้นอยู่แล้ว ต้องไม่เกิดแถวซ้ำ
 *   ③ คำขอที่ยังไม่อนุมัติ (pending) ต้องไม่ถูกดึงมาแสดง
 *
 * ใช้: node scripts/test-clock-travel-rows.js
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

(async () => {
  console.log('');
  const db = require(path.join(__dirname, '..', 'db.js'));
  await db.init();

  const madeUsers = [];
  const mkUser = async (tag) => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, position, workplace, role, status,
       user_group, school_code, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `zztravelrow_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ ไปราชการ ${tag}`,
      'เจ้าหน้าที่', 'สพป.แพร่ เขต 2', 'staff', 'active', 'office', '',
      '2026-10-28 09:00:00', '2026-10-28 09:00:00'
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  const today = simdate.todayISO();
  const adminSid = await auth.newSession(1);

  try {
    // A = ไปราชการ (อนุมัติแล้ว) ไม่มีบันทึกเวลา
    // B = ไปราชการ (อนุมัติแล้ว) + มีบันทึกเวลาแล้ว → ต้องไม่ซ้ำ
    // C = ไปราชการแต่ยัง pending → ต้องไม่แสดง
    const A = await mkUser('a');
    const B = await mkUser('b');
    const C = await mkUser('c');

    const mkTravel = async (userId, status) => {
      const info = await db.prepare(`INSERT INTO travel_requests
        (user_id, title, destination, date_from, date_to, days, status, approval_level, approval_data, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        userId, 'ทดสอบไปราชการ', 'แพร่', today, today, 1, status, 0, '[]', '2026-10-28 09:00:00'
      );
      return Number(info.insertId);
    };
    const travelIds = [];
    travelIds.push(await mkTravel(A, 'approved'));
    travelIds.push(await mkTravel(B, 'approved'));
    travelIds.push(await mkTravel(C, 'pending'));

    await db.prepare('INSERT INTO time_records (user_id, date, clock_in, clock_out) VALUES (?,?,?,?)')
      .run(B, today, '08:30:00', '16:30:00');

    console.log('');
    console.log('① ผู้ที่ไปราชการต้องมีชื่อในรายการบันทึกเวลาของวันนั้น');
    const res = await jget('/api/time/all?date=' + today, 'sid=' + adminSid);
    check(res.status === 200, 'GET /api/time/all?date= → 200', `ได้ ${res.status}`);
    const rows = (res.body && res.body.records) || [];
    const rowA = rows.find((r) => Number(r.user_id) === A);
    check(!!rowA, 'พบชื่อผู้ที่ไปราชการในรายการ', `ไม่พบ user ${A} (มี ${rows.length} แถว)`);
    check(rowA && rowA.work_site === 'ไปราชการ', 'สถานที่ทำงาน = "ไปราชการ"', `ได้ "${rowA && rowA.work_site}"`);
    check(rowA && !rowA.clock_in && !rowA.clock_out, 'ไม่มีเวลาเข้า/ออก', JSON.stringify(rowA && { i: rowA.clock_in, o: rowA.clock_out }));
    check(rowA && rowA.id === null, 'ไม่มี id ของบันทึกเวลา (แก้ไข/ลบไม่ได้)', `ได้ ${rowA && rowA.id}`);

    console.log('');
    console.log('② คนที่มีบันทึกเวลาอยู่แล้วต้องไม่ซ้ำ');
    const rowsB = rows.filter((r) => Number(r.user_id) === B);
    check(rowsB.length === 1, `มีแถวเดียวสำหรับ user ${B} (ได้ ${rowsB.length})`);
    check(rowsB[0] && rowsB[0].clock_in === '08:30:00', 'แสดงบันทึกเวลาจริงของคนนั้น', JSON.stringify(rowsB[0] && rowsB[0].clock_in));

    console.log('');
    console.log('③ คำขอที่ยังไม่อนุมัติต้องไม่ถูกดึงมา');
    const rowC = rows.find((r) => Number(r.user_id) === C);
    check(!rowC, 'ไม่พบผู้ที่คำขอยัง pending');

    // cleanup
    for (const id of travelIds) {
      try { await db.prepare('DELETE FROM travel_requests WHERE id = ?').run(id); } catch (e) { /* ignore */ }
    }
    for (const id of madeUsers) {
      try { await db.prepare('DELETE FROM time_records WHERE user_id = ?').run(id); } catch (e) { /* ignore */ }
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
