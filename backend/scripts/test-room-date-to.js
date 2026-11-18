'use strict';
/**
 * ทดสอบ "ถึงวันที่" ของการจองห้องประชุม (ผู้ใช้สั่ง 18 พ.ย. 2569)
 *
 *   ① จองหลายวันได้ — บันทึก date_to และคืนรายการพร้อม date_to
 *   ② ชนกันต้องเทียบทั้งช่วงวันที่และเวลา (จองวันที่ 2 ทับ → 409)
 *   ③ เวลาต่างกันในวันเดียวกันของช่วง → จองได้
 *   ④ ถึงวันที่ก่อนวันที่ใช้ → 400
 *   ⑤ /room-bookings/conflicts เห็นการจองหลายวันในวันที่ 2 ด้วย
 *
 * ใช้: node scripts/test-room-date-to.js
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

  let roomId = 0;
  const madeBookings = [];

  const jpost = async (p, cookie, body) => {
    const res = await fetch(BASE + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body || {}),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const jget = async (p, cookie) => {
    const res = await fetch(BASE + p, { headers: { Cookie: cookie } });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  try {
    const info = await db.prepare("INSERT INTO rooms (name, capacity, status) VALUES (?,?,?)")
      .run('ห้องทดสอบถึงวันที่ ' + Date.now(), 10, 'available');
    roomId = Number(info.insertId);

    const adminCookie = 'sid=' + (await auth.newSession(1));

    console.log('① จองหลายวัน (18–19 พ.ย. 2569) และเก็บ date_to');
    const b1 = await jpost('/api/room-bookings', adminCookie, {
      room_id: roomId, date: '2026-11-18', date_to: '2026-11-19',
      start_time: '09:00', end_time: '12:00', topic: 'ประชุมสองวัน', attendees: 5,
    });
    check(b1.status === 200, `POST → 200 (ได้ ${b1.status})`, JSON.stringify(b1.body));
    const id1 = Number(b1.body.id) || 0;
    if (id1) madeBookings.push(id1);
    const row1 = id1 ? await db.prepare('SELECT date, date_to FROM room_bookings WHERE id = ?').get(id1) : null;
    check(row1 && String(row1.date_to).slice(0, 10) === '2026-11-19', 'บันทึก date_to = 2026-11-19',
      JSON.stringify(row1));

    console.log('');
    console.log('② จองทับวันที่ 2 ในเวลาเดียวกัน → 409');
    const b2 = await jpost('/api/room-bookings', adminCookie, {
      room_id: roomId, date: '2026-11-19', date_to: '2026-11-19',
      start_time: '10:00', end_time: '11:00', topic: 'จองทับ', attendees: 3,
    });
    check(b2.status === 409, `POST → 409 (ได้ ${b2.status})`, JSON.stringify(b2.body));

    console.log('');
    console.log('③ วันเดียวกันของช่วง แต่เวลาต่างกัน → จองได้');
    const b3 = await jpost('/api/room-bookings', adminCookie, {
      room_id: roomId, date: '2026-11-19', date_to: '2026-11-19',
      start_time: '13:00', end_time: '14:00', topic: 'ช่วงบ่าย', attendees: 2,
    });
    check(b3.status === 200, `POST → 200 (ได้ ${b3.status})`, JSON.stringify(b3.body));
    if (b3.body.id) madeBookings.push(Number(b3.body.id));

    console.log('');
    console.log('④ ถึงวันที่ก่อนวันที่ใช้ → 400');
    const b4 = await jpost('/api/room-bookings', adminCookie, {
      room_id: roomId, date: '2026-11-20', date_to: '2026-11-19',
      start_time: '09:00', end_time: '10:00', topic: 'วันที่ผิด', attendees: 2,
    });
    check(b4.status === 400, `POST → 400 (ได้ ${b4.status})`, JSON.stringify(b4.body));

    console.log('');
    console.log('⑤ conflicts เห็นการจองหลายวันในวันที่ 2');
    const cf = await jget('/api/room-bookings/conflicts?room_id=' + roomId +
      '&date=2026-11-19&date_to=2026-11-19&start_time=09:30&end_time=10:30', adminCookie);
    check(cf.status === 200, `GET conflicts → 200 (ได้ ${cf.status})`);
    check((cf.body.conflicts || []).some((c) => Number(c.id) === id1), 'เห็นการจอง 2 วันเป็นคู่ชน',
      JSON.stringify(cf.body.conflicts));

    console.log('');
    console.log('⑥ รายการที่คืนมี date_to ให้หน้าเว็บแสดงช่วงวันที่');
    const list = await jget('/api/room-bookings?room_id=' + roomId, adminCookie);
    const found = (list.body.bookings || []).find((b) => Number(b.id) === id1);
    check(found && String(found.date_to).slice(0, 10) === '2026-11-19', 'รายการมี date_to',
      JSON.stringify(found && found.date_to));
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    try {
      for (const id of madeBookings) {
        try { await db.prepare('DELETE FROM room_bookings WHERE id = ?').run(id); } catch (e) { /* ignore */ }
      }
      if (roomId) {
        try { await db.prepare('DELETE FROM room_bookings WHERE room_id = ?').run(roomId); } catch (e) { /* ignore */ }
        try { await db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId); } catch (e) { /* ignore */ }
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
