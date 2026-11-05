'use strict';
/**
 * ทดสอบ "ผู้จองแก้ไขรายการจองยานพาหนะของตัวเองได้"
 *
 * ผู้ใช้สั่ง 5 พ.ย. 2569
 * ──────────────────────
 * ในแท็บ "ของฉัน" ของหน้าจองยานพาหนะ ต้องมีปุ่มแก้ไข และแก้ไขรายการของตัวเองได้
 *
 * กติกาที่ต้องผ่าน
 *   ① ผู้จองแก้ไขข้อมูลคำขอของตัวเองได้ (วัน/เวลา · สถานที่ · วัตถุประสงค์ · จำนวนผู้โดยสาร)
 *   ② ผู้จอง **เปลี่ยนยานพาหนะ/พนักงานขับรถไม่ได้** (การจัดรถเป็นหน้าที่เจ้าหน้าที่/ผู้อนุมัติ)
 *   ③ ผู้จองแก้รายการของคนอื่นไม่ได้ (403)
 *   ④ admin ยังแก้ได้ทุกอย่างเหมือนเดิม (รวมจัดรถ)
 *   ⑤ **อนุมัติครบทุกขั้น (approved) แล้ว ผู้จองแก้ไขไม่ได้ (403)**
 *
 * ใช้: node scripts/test-vehicle-owner-edit.js
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

const jput = async (p, cookie, body) => {
  const res = await fetch(BASE + p, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

(async () => {
  console.log('');
  const db = require(path.join(__dirname, '..', 'db.js'));
  await db.init();

  const madeUsers = [];
  const madeBookings = [];
  const today = simdate.todayISO();

  const mkUser = async (tag) => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, position, workplace, role, status,
       user_group, school_code, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `zzvehicleowner_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ ผู้จอง ${tag}`,
      'เจ้าหน้าที่', 'สพป.แพร่ เขต 2', 'staff', 'active', 'office', '',
      '2026-10-01 09:00:00', '2026-10-01 09:00:00'
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  const mkBooking = async (userId, purpose) => {
    const info = await db.prepare(`INSERT INTO vehicle_bookings
      (user_id, vehicle_id, date, date_to, start_time, end_time, total_days,
       purpose, destination, passenger_count, status, approval_level)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      userId, 0, today, today, '09:00', '12:00', 1, purpose, 'แพร่', 2, 'pending', 0
    );
    const id = Number(info.insertId);
    madeBookings.push(id);
    return id;
  };

  try {
    const owner = await mkUser('owner');
    const other = await mkUser('other');
    const ownerBooking = await mkBooking(owner, 'ทดสอบแก้ไขของฉัน');
    const otherBooking = await mkBooking(other, 'ทดสอบรายการคนอื่น');

    const ownerCookie = 'sid=' + (await auth.newSession(owner));
    const adminCookie = 'sid=' + (await auth.newSession(1));

    console.log('');
    console.log('① ผู้จองแก้ไขข้อมูลคำขอของตัวเองได้');
    const r1 = await jput('/api/vehicle-bookings/' + ownerBooking + '/edit', ownerCookie, {
      date: today,
      date_to: today,
      start_time: '10:00',
      end_time: '15:00',
      destination: 'เชียงใหม่',
      purpose: 'แก้ไขวัตถุประสงค์แล้ว',
      passenger_count: 5,
    });
    check(r1.status === 200, `PUT /vehicle-bookings/:id/edit → 200 (ได้ ${r1.status})`, JSON.stringify(r1.body));

    const after = await db.prepare('SELECT * FROM vehicle_bookings WHERE id = ?').get(ownerBooking);
    check(after && after.purpose === 'แก้ไขวัตถุประสงค์แล้ว', 'บันทึกวัตถุประสงค์ใหม่แล้ว', `ได้ "${after && after.purpose}"`);
    check(after && after.destination === 'เชียงใหม่', 'บันทึกสถานที่ใหม่แล้ว', `ได้ "${after && after.destination}"`);
    check(after && Number(after.passenger_count) === 5, 'บันทึกจำนวนผู้โดยสารใหม่แล้ว', `ได้ ${after && after.passenger_count}`);
    check(after && String(after.start_time).slice(0, 5) === '10:00', 'บันทึกเวลาเริ่มใหม่แล้ว', `ได้ ${after && after.start_time}`);
    check(after && String(after.end_time).slice(0, 5) === '15:00', 'บันทึกเวลาสิ้นสุดใหม่แล้ว', `ได้ ${after && after.end_time}`);

    console.log('');
    console.log('② ผู้จองเปลี่ยนยานพาหนะ/พนักงานขับรถไม่ได้');
    const r2 = await jput('/api/vehicle-bookings/' + ownerBooking + '/edit', ownerCookie, {
      vehicle_id: 1,
      driver_name: 'คนขับที่ผู้จองตั้งเอง',
      date: today,
      purpose: 'ทดสอบเปลี่ยนรถ',
      destination: 'แพร่',
      passenger_count: 5,
      start_time: '10:00',
      end_time: '15:00',
    });
    check(r2.status === 200, `ส่ง vehicle_id มาก็ยังบันทึกได้ (ได้ ${r2.status})`, JSON.stringify(r2.body));
    const after2 = await db.prepare('SELECT * FROM vehicle_bookings WHERE id = ?').get(ownerBooking);
    check(!Number(after2.vehicle_id), 'ยานพาหนะไม่ถูกเปลี่ยนโดยผู้จอง', `ได้ vehicle_id = ${after2 && after2.vehicle_id}`);
    check(!after2.driver_name, 'พนักงานขับรถไม่ถูกตั้งโดยผู้จอง', `ได้ driver_name = ${after2 && after2.driver_name}`);

    console.log('');
    console.log('③ ผู้จองแก้รายการของคนอื่นไม่ได้');
    const r3 = await jput('/api/vehicle-bookings/' + otherBooking + '/edit', ownerCookie, {
      date: today,
      purpose: 'พยายามแก้ของคนอื่น',
    });
    check(r3.status === 403, `แก้รายการคนอื่น → 403 (ได้ ${r3.status})`, JSON.stringify(r3.body));
    const otherAfter = await db.prepare('SELECT purpose FROM vehicle_bookings WHERE id = ?').get(otherBooking);
    check(otherAfter && otherAfter.purpose === 'ทดสอบรายการคนอื่น', 'รายการของคนอื่นไม่ถูกแก้',
      `ได้ "${otherAfter && otherAfter.purpose}"`);

    console.log('');
    console.log('④ admin ยังจัดรถ/แก้ได้ทุกอย่าง');
    const r4 = await jput('/api/vehicle-bookings/' + ownerBooking + '/edit', adminCookie, {
      vehicle_id: 1,
      date: today,
      date_to: today,
      start_time: '10:00',
      end_time: '15:00',
      purpose: 'admin แก้',
      destination: 'แพร่',
      passenger_count: 4,
      driver_name: 'พนักงานขับทดสอบ',
    });
    // อาจได้ 409 ถ้ารถคันนั้นถูกจองช่วงเวลานี้อยู่แล้ว — ถือว่าผ่านการตรวจสิทธิ์แล้ว
    check(r4.status === 200 || r4.status === 409,
      `admin แก้ไขได้ (ได้ ${r4.status})`, JSON.stringify(r4.body));
    if (r4.status === 200) {
      const after4 = await db.prepare('SELECT vehicle_id, driver_name FROM vehicle_bookings WHERE id = ?').get(ownerBooking);
      check(Number(after4.vehicle_id) === 1, 'admin จัดยานพาหนะได้', `ได้ vehicle_id = ${after4.vehicle_id}`);
      check(after4.driver_name === 'พนักงานขับทดสอบ', 'admin ตั้งพนักงานขับรถได้', `ได้ "${after4.driver_name}"`);
    }

    console.log('');
    console.log('⑤ อนุมัติครบทุกขั้น (approved) แล้ว ผู้จองแก้ไขไม่ได้');
    await db.prepare("UPDATE vehicle_bookings SET status = 'approved', approval_level = 2 WHERE id = ?").run(ownerBooking);
    const r5 = await jput('/api/vehicle-bookings/' + ownerBooking + '/edit', ownerCookie, {
      date: today,
      purpose: 'พยายามแก้หลังอนุมัติ',
      destination: 'แพร่',
      passenger_count: 2,
      start_time: '09:00',
      end_time: '12:00',
    });
    check(r5.status === 403, `ผู้จองแก้รายการที่อนุมัติแล้ว → 403 (ได้ ${r5.status})`, JSON.stringify(r5.body));
    const after5 = await db.prepare('SELECT purpose, status FROM vehicle_bookings WHERE id = ?').get(ownerBooking);
    check(after5 && after5.purpose !== 'พยายามแก้หลังอนุมัติ', 'ข้อมูลไม่ถูกแก้หลังอนุมัติ', `ได้ "${after5 && after5.purpose}"`);
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    try {
      for (const id of madeBookings) {
        try { await db.prepare('DELETE FROM vehicle_notices WHERE booking_id = ?').run(id); } catch (e) { /* ignore */ }
        try { await db.prepare('DELETE FROM vehicle_bookings WHERE id = ?').run(id); } catch (e) { /* ignore */ }
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
