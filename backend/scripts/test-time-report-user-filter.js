'use strict';
/**
 * ทดสอบตัวกรอง "ชื่อบุคลากร" ของรายงานการลงเวลาทำงาน
 * (ผู้ใช้สั่ง 20 พ.ย. 2569)
 *
 *   GET /time/report?user_ids=1,2 → กรองเฉพาะคนเหล่านั้น
 *   ไม่ส่ง user_ids → แสดงทุกคน (เหมือนเดิม)
 *   ค่าที่ไม่ใช่ตัวเลข → ไม่ทำให้พัง (ถือว่าไม่กรอง)
 *
 * ใช้: node scripts/test-time-report-user-filter.js
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const DATE = '2026-11-02';

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
  const madeRecords = [];

  const mkUser = async (tag) => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, first_name, last_name, position, workplace,
       role, status, user_group, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`).run(
      `zzrp_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ รายงาน ${tag}`, `ทดสอบ${tag}`, 'รายงาน',
      'เจ้าหน้าที่', 'กลุ่มงานทดสอบ', 'staff', 'active', 'office'
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  const mkRecord = async (userId, clockIn, clockOut) => {
    const info = await db.prepare(`INSERT INTO time_records (user_id, date, clock_in, clock_out, clock_in_src, clock_out_src)
      VALUES (?,?,?,?,?,?)`).run(userId, DATE, clockIn, clockOut, 'GPS (ทดสอบ)', 'ทดสอบ');
    madeRecords.push(Number(info.insertId));
  };

  const getReport = async (qs, cookie) => {
    const res = await fetch(BASE + '/api/time/report?period=day&date=' + DATE + qs, { headers: { Cookie: cookie } });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  try {
    const u1 = await mkUser('one');
    const u2 = await mkUser('two');
    await mkRecord(u1, '08:30:00', '16:30:00');
    await mkRecord(u2, '08:45:00', '16:30:00');

    const adminCookie = 'sid=' + (await auth.newSession(1));

    console.log('① ไม่ส่งตัวกรอง → ได้ทั้ง 2 คน');
    const all = await getReport('', adminCookie);
    check(all.status === 200, `GET /time/report → 200 (ได้ ${all.status})`);
    const idsAll = (all.body.records || []).map((r) => Number(r.user_id));
    check(idsAll.includes(u1) && idsAll.includes(u2), 'มีทั้งสองคน',
      JSON.stringify([u1, u2, idsAll.slice(0, 10)]));

    console.log('');
    console.log('② กรองเฉพาะคนที่ 1');
    const one = await getReport('&user_ids=' + u1, adminCookie);
    const idsOne = (one.body.records || []).map((r) => Number(r.user_id));
    check(idsOne.includes(u1), 'มีคนที่ 1');
    check(!idsOne.includes(u2), 'ไม่มีคนที่ 2', JSON.stringify(idsOne.slice(0, 10)));
    check(Array.isArray(one.body.user_ids) && one.body.user_ids.length === 1,
      'คืน user_ids ที่ใช้กรอง', JSON.stringify(one.body.user_ids));

    console.log('');
    console.log('③ กรอง 2 คนพร้อมกัน (พิมพ์ค้นหาแล้วตรงหลายคน)');
    const both = await getReport('&user_ids=' + u1 + ',' + u2, adminCookie);
    const idsBoth = (both.body.records || []).map((r) => Number(r.user_id));
    check(idsBoth.includes(u1) && idsBoth.includes(u2), 'มีทั้งสองคนตามที่ส่งไป',
      JSON.stringify(idsBoth.slice(0, 10)));

    console.log('');
    console.log('④ ค่าที่ไม่ใช่ตัวเลข → ไม่กรอง (ไม่พัง)');
    const bad = await getReport('&user_ids=abc,%20,', adminCookie);
    check(bad.status === 200, `GET → 200 (ได้ ${bad.status})`);
    check(Array.isArray(bad.body.user_ids) && bad.body.user_ids.length === 0, 'อ่าน user_ids ได้เป็น []',
      JSON.stringify(bad.body.user_ids));

    console.log('');
    console.log('⑤ คนที่ไม่มีบันทึกเวลา → ไม่มีแถวของเขา');
    const other = await getReport('&user_ids=99999999', adminCookie);
    check((other.body.records || []).every((r) => Number(r.user_id) === 99999999),
      'ไม่มีแถวของคนอื่นหลุดมา', JSON.stringify((other.body.records || []).map((r) => r.user_id).slice(0, 10)));
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    try {
      for (const id of madeRecords) {
        try { await db.prepare('DELETE FROM time_records WHERE id = ?').run(id); } catch (e) { /* ignore */ }
      }
      for (const id of madeUsers) {
        try { await db.prepare('DELETE FROM time_records WHERE user_id = ?').run(id); } catch (e) { /* ignore */ }
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
