'use strict';
/**
 * ทดสอบ "ไม่ได้ลงชื่อปฏิบัติงาน" หลังเวลา 17:01
 *
 * ความต้องการ (ผู้ใช้):
 *   ในรายการบันทึกเวลาทำงานของเจ้าหน้าที่ เมื่อถึงเวลา 17:01 น.
 *   ให้ดึงรายชื่อเจ้าหน้าที่ที่เหลือทั้งหมด (ยกเว้น admin) มาแสดงบนสุด
 *   และคอลัมน์สถานที่ทำงาน = "ไม่ได้ลงชื่อปฏิบัติงาน"
 *
 * วิธีทดสอบ: ใช้โหมดจำลองวันที่ (PUT /api/sim-date) ให้ "วันนี้" เป็นวันในอนาคต
 *   แล้วดูรายงานของวันในอดีต → ถือว่าวันนั้นจบแล้ว (มีรายชื่อผู้ขาดงาน)
 *
 * สิ่งที่ต้องผ่าน
 *   ① คนที่ไม่มีบันทึกเวลา/ไปราชการ/ลา → ถูกแสดงเป็น "ไม่ได้ลงชื่อปฏิบัติงาน"
 *   ② คนที่มีบันทึกเวลาของวันนั้น → ไม่ถูกทำเครื่องหมายขาดงาน
 *   ③ admin ไม่ถูกนับว่าขาดงาน
 *
 * ใช้: node scripts/test-clock-absent-rows.js
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const PAST = '2026-01-15';

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
async function jput(p, cookie, body) {
  const res = await fetch(BASE + p, {
    method: 'PUT',
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
  const mkUser = async (tag) => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, position, workplace, role, status,
       user_group, school_code, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `zzabsent_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ ขาดงาน ${tag}`,
      'เจ้าหน้าที่', 'สพป.แพร่ เขต 2', 'staff', 'active', 'office', '',
      '2026-01-10 09:00:00', '2026-01-10 09:00:00'
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  let admin = '';
  try {
    admin = 'sid=' + (await auth.newSession(1));

    const A = await mkUser('present'); // มีบันทึกเวลา
    const B = await mkUser('absent');  // ไม่มีอะไรเลย

    await db.prepare('INSERT INTO time_records (user_id, date, clock_in, clock_out) VALUES (?,?,?,?)')
      .run(A, PAST, '08:30:00', '16:30:00');

    // ให้ "วันนี้" ของระบบเป็นอนาคต → วันที่ PAST ถือว่าจบแล้ว
    const sim = await jput('/api/sim-date', admin, { date: '2026-06-01' });
    check(sim.status === 200, 'ตั้งโหมดจำลองวันที่ได้', `ได้ ${sim.status}`);

    const res = await jget('/api/time/all?date=' + PAST, admin);
    const rows = (res.body && res.body.records) || [];
    const rowA = rows.find((r) => Number(r.user_id) === A);
    const rowB = rows.find((r) => Number(r.user_id) === B);
    const adminRow = rows.find((r) => Number(r.user_id) === 1 && r.is_absent);

    console.log('');
    console.log('① เจ้าหน้าที่ที่ไม่มีบันทึกเวลา → "ไม่ได้ลงชื่อปฏิบัติงาน"');
    check(res.status === 200, 'GET /api/time/all → 200', `ได้ ${res.status}`);
    check(!!rowB, 'พบรายชื่อผู้ที่ไม่ได้ลงชื่อปฏิบัติงาน', `ไม่พบ user ${B} (${rows.length} แถว)`);
    check(rowB && rowB.is_absent === 1, 'ทำเครื่องหมาย is_absent = 1', `ได้ ${rowB && rowB.is_absent}`);
    check(rowB && rowB.work_site === 'ไม่ได้ลงชื่อปฏิบัติงาน', 'สถานที่ทำงาน = "ไม่ได้ลงชื่อปฏิบัติงาน"',
      `ได้ "${rowB && rowB.work_site}"`);
    check(rowB && !rowB.clock_in && !rowB.clock_out, 'ไม่มีเวลาเข้า/ออก');

    console.log('');
    console.log('② คนที่มีบันทึกเวลาไม่ถูกนับว่าขาดงาน');
    check(rowA && !rowA.is_absent, 'ผู้ที่มีบันทึกเวลาไม่ถูกทำเครื่องหมายขาดงาน',
      JSON.stringify(rowA && { absent: rowA.is_absent, ci: rowA.clock_in }));

    console.log('');
    console.log('③ admin ไม่ถูกนับว่าขาดงาน');
    check(!adminRow, 'ไม่มีแถวขาดงานของ admin');

    console.log('');
    console.log('④ รายงานการลงเวลาทำงานก็ต้องแสดงผู้ที่ไม่ได้ลงชื่อปฏิบัติงาน');
    const rep = await jget('/api/time/report?period=day&date=' + PAST, admin);
    const repRows = (rep.body && rep.body.records) || [];
    const repB = repRows.find((r) => Number(r.user_id) === B);
    check(rep.status === 200 && !!repB, 'รายงานมีรายชื่อผู้ที่ไม่ได้ลงชื่อปฏิบัติงาน', `มี ${repRows.length} แถว`);
    check(repB && repB.is_absent === 1 && repB.work_site === 'ไม่ได้ลงชื่อปฏิบัติงาน',
      'รายงาน: สถานที่ทำงาน = "ไม่ได้ลงชื่อปฏิบัติงาน"',
      JSON.stringify(repB && { a: repB.is_absent, s: repB.work_site }));
    const idxAbsent = repRows.findIndex((r) => Number(r.user_id) === B);
    const idxPresent = repRows.findIndex((r) => Number(r.user_id) === A);
    check(idxAbsent >= 0 && idxPresent >= 0 && idxAbsent < idxPresent,
      'รายงานเรียงแถวขาดงานไว้บนสุดของวันนั้น',
      `ขาดงาน=${idxAbsent} · มีเวลาเข้า=${idxPresent}`);

    // ไฟล์ Excel ต้องดาวน์โหลดได้ (สร้างจากแถวชุดเดียวกัน)
    const xr = await fetch(BASE + '/api/time/report.xlsx?period=day&date=' + PAST, { headers: { Cookie: admin } });
    check(xr.status === 200, 'ดาวน์โหลด .xlsx ของวันนั้นได้', `ได้ ${xr.status}`);
    check(String(xr.headers.get('content-type') || '').includes('spreadsheetml'),
      'ไฟล์ที่ได้เป็น Excel', xr.headers.get('content-type') || '-');
  } catch (e) {
    console.error('  ⚠ ' + e.message);
    fail += 1;
  } finally {
    try { await jput('/api/sim-date', admin, { date: null }); } catch (e) { /* ignore */ }
    for (const id of madeUsers) {
      try { await db.prepare('DELETE FROM time_records WHERE user_id = ?').run(id); } catch (e) { /* ignore */ }
      try { await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); } catch (e) { /* ignore */ }
      try { await db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch (e) { /* ignore */ }
    }
    await db.close();
  }

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ทดสอบล้มเหลว:', e);
  process.exit(1);
});
