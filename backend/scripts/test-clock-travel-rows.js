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
    // D = คณะผู้ร่วมเดินทางของ A (ไม่ได้ยื่นคำขอเอง)
    const D = await mkUser('d');

    const mkTravel = async (userId, status, formData = null) => {
      const info = await db.prepare(`INSERT INTO travel_requests
        (user_id, title, destination, date_from, date_to, days, status, approval_level, approval_data, form_data, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
        userId, 'ทดสอบไปราชการ', 'แพร่', today, today, 1, status, 0, '[]',
        formData ? JSON.stringify(formData) : null, '2026-10-28 09:00:00'
      );
      return Number(info.insertId);
    };
    const travelIds = [];
    // A ไปราชการพร้อมคณะ = D (เก็บทั้งชื่อและ id)
    travelIds.push(await mkTravel(A, 'approved', {
      companions: 1,
      companion_ids: [D],
      companion_names: ['ทดสอบ ไปราชการ d'],
    }));
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

    console.log('');
    console.log('④ คณะผู้ร่วมเดินทาง (companion_ids) ถือว่าไปราชการด้วย');
    const rowD = rows.find((r) => Number(r.user_id) === D);
    check(!!rowD, 'พบชื่อคณะผู้ร่วมเดินทางในรายการ', `ไม่พบ user ${D}`);
    check(rowD && rowD.work_site === 'ไปราชการ', 'คณะก็แสดงสถานที่ทำงาน = "ไปราชการ"', `ได้ "${rowD && rowD.work_site}"`);
    check(rowD && !rowD.clock_in && !rowD.clock_out, 'คณะไม่มีเวลาเข้า/ออก');

    // การ์ด "ไปราชการ" บนหน้าแรก ต้องมีชื่อคณะด้วย
    const sum = await jget('/api/today-summary', 'sid=' + adminSid);
    const sumTravel = (sum.body && sum.body.travel) || [];
    const hasA = sumTravel.some((t) => Number(t.user_id) === A);
    const hasD = sumTravel.some((t) => Number(t.user_id) === D);
    check(sum.status === 200 && hasA && hasD,
      'การ์ด "ไปราชการ" (today-summary) แสดงทั้งผู้ขอและคณะ',
      `ผู้ขอ ${hasA ? 'มี' : 'ไม่มี'} · คณะ ${hasD ? 'มี' : 'ไม่มี'} (${sumTravel.length} คน)`);

    // รายงานการลงเวลา (period=day) ต้องมีไปราชการด้วย และเรียงเหมือนหน้ารายการ
    const rep = await jget('/api/time/report?period=day&date=' + today, 'sid=' + adminSid);
    const repRows = (rep.body && rep.body.records) || [];
    const repA = repRows.find((r) => Number(r.user_id) === A);
    const repD = repRows.find((r) => Number(r.user_id) === D);
    check(rep.status === 200 && !!repA && !!repD, 'รายงานการลงเวลามีทั้งผู้ขอและคณะไปราชการ',
      `ผู้ขอ ${repA ? 'มี' : 'ไม่มี'} · คณะ ${repD ? 'มี' : 'ไม่มี'} (${repRows.length} แถว)`);
    check(repA && repA.work_site === 'ไปราชการ', 'รายงาน: สถานที่ทำงาน = "ไปราชการ"', `ได้ "${repA && repA.work_site}"`);
    check(repRows.length && Number(repRows[0].user_id) === B,
      'รายงานเรียงเหมือนหน้ารายการ (คนที่มีเวลาเข้าก่อนแถวไปราชการ)',
      `แถวแรก user ${repRows[0] && repRows[0].user_id} (ต้องเป็น ${B})`);

    console.log('');
    console.log('⑤ ผู้ที่ไปราชการลงเวลาเข้า/ออกไม่ได้');
    const dCookie = 'sid=' + (await auth.newSession(D));
    const todayD = await jget('/api/time/today', dCookie);
    check(todayD.body && todayD.body.on_travel === true, '/time/today บอกว่าไปราชการ (on_travel = true)',
      JSON.stringify(todayD.body && todayD.body.on_travel));
    const inB = await fetch(BASE + '/api/time/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: dCookie },
      body: JSON.stringify({ type: 'in', lat: 18.1, lng: 100.1 }),
    });
    const inBody = await inB.json().catch(() => ({}));
    check(inB.status === 403, 'คณะกดลงเวลาเข้างาน → 403', `ได้ ${inB.status}`);
    check(String(inBody.error || '').includes('ไปราชการ'), 'ข้อความแจ้งว่าอยู่ระหว่างไปราชการ', JSON.stringify(inBody.error));

    const aCookie = 'sid=' + (await auth.newSession(A));
    const outA = await fetch(BASE + '/api/time/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: aCookie },
      body: JSON.stringify({ type: 'out' }),
    });
    check(outA.status === 403, 'ผู้ยื่นคำขอกดลงเวลาออกงาน → 403', `ได้ ${outA.status}`);

    // cleanup
    for (const id of travelIds) {
      try { await db.prepare('DELETE FROM travel_requests WHERE id = ?').run(id); } catch (e) { /* ignore */ }
    }
    for (const id of madeUsers) {
      try { await db.prepare('DELETE FROM time_records WHERE user_id = ?').run(id); } catch (e) { /* ignore */ }
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
