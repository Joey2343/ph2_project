'use strict';
/**
 * ทดสอบ "ผู้จองแก้ไขคำขอไปราชการของตัวเองได้"
 *
 * ผู้ใช้สั่ง 5 พ.ย. 2569
 * ──────────────────────
 * รายการขออนุมัติ/อนุญาตเดินทางไปราชการ ต้องมีปุ่มแก้ไข และแก้ไขรายการของตัวเองได้
 *
 * กติกาที่ต้องผ่าน
 *   ① ผู้จองแก้ไขคำขอของตัวเองได้ (เรื่อง/สถานที่/วันเดินทาง/form_data)
 *   ② อนุมัติขั้นต้นแล้ว (approval_level >= 1) → 403 แก้ไม่ได้
 *   ③ ผู้จองแก้รายการของคนอื่นไม่ได้ (403)
 *   ④ admin แก้ได้ตราบที่ยัง pending
 *
 * ใช้: node scripts/test-travel-owner-edit.js
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
  const madeTravels = [];
  const today = simdate.todayISO();

  const mkUser = async (tag) => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, position, workplace, role, status,
       user_group, school_code, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `zztravelowner_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ ผู้ขอไปราชการ ${tag}`,
      'เจ้าหน้าที่', 'สพป.แพร่ เขต 2', 'staff', 'active', 'office', '',
      '2026-10-01 09:00:00', '2026-10-01 09:00:00'
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  const mkTravel = async (userId, subject) => {
    const info = await db.prepare(`INSERT INTO travel_requests
      (travel_no, user_id, title, destination, date_from, date_to, days, status, approval_level, approval_data, form_data, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'ทดสอบ/' + Date.now() + '/2569', userId, subject, 'แพร่', today, today, 1, 'pending', 0, '[]',
      JSON.stringify({ travel_subject: subject, destination: 'แพร่', writing_at: 'สพป.แพร่ เขต 2', companions: 0, companion_names: [], companion_ids: [], expense_type: 'none' }),
      '2026-11-05 09:00:00'
    );
    const id = Number(info.insertId);
    madeTravels.push(id);
    return id;
  };

  try {
    const owner = await mkUser('owner');
    const other = await mkUser('other');
    const myTravel = await mkTravel(owner, 'ทดสอบแก้ไขของฉัน');
    const otherTravel = await mkTravel(other, 'ทดสอบรายการคนอื่น');

    const ownerCookie = 'sid=' + (await auth.newSession(owner));
    const adminCookie = 'sid=' + (await auth.newSession(1));

    const payload = (over) => ({
      travel_subject: 'ทดสอบแก้ไขของฉัน',
      destination: 'แพร่',
      date_from: today,
      date_to: today,
      budget: 0,
      detail: '',
      form_data: {
        travel_subject: 'ทดสอบแก้ไขของฉัน',
        destination: 'แพร่',
        writing_at: 'สพป.แพร่ เขต 2',
        companions: 0,
        companion_names: [],
        companion_ids: [],
        expense_type: 'none',
      },
      ...over,
    });

    console.log('');
    console.log('① ผู้จองแก้ไขคำขอของตัวเองได้');
    const r1 = await jput('/api/travel/' + myTravel, ownerCookie, payload({
      travel_subject: 'แก้ไขเรื่องแล้ว',
      destination: 'เชียงใหม่',
      form_data: {
        travel_subject: 'แก้ไขเรื่องแล้ว',
        destination: 'เชียงใหม่',
        writing_at: 'สพป.แพร่ เขต 2',
        companions: 1,
        companion_names: ['ทดสอบ ผู้ขอไปราชการ owner'],
        companion_ids: [owner],
        expense_type: 'none',
      },
    }));
    check(r1.status === 200, `PUT /travel/:id → 200 (ได้ ${r1.status})`, JSON.stringify(r1.body));

    const row1 = await db.prepare('SELECT title, destination, form_data FROM travel_requests WHERE id = ?').get(myTravel);
    check(row1 && row1.title === 'แก้ไขเรื่องแล้ว', 'บันทึกเรื่องใหม่แล้ว', `ได้ "${row1 && row1.title}"`);
    check(row1 && row1.destination === 'เชียงใหม่', 'บันทึกสถานที่ใหม่แล้ว', `ได้ "${row1 && row1.destination}"`);
    const fd1 = (() => { try { return JSON.parse(row1.form_data || '{}'); } catch (e) { return {}; } })();
    check(fd1.travel_subject === 'แก้ไขเรื่องแล้ว' && fd1.destination === 'เชียงใหม่',
      'form_data ถูกอัปเดตตาม', JSON.stringify({ s: fd1.travel_subject, d: fd1.destination }));
    check(Array.isArray(fd1.companion_names) && fd1.companion_names.length === 1,
      'คณะผู้ร่วมเดินทางถูกบันทึกตาม', JSON.stringify(fd1.companion_names));

    console.log('');
    console.log('② อนุมัติขั้นต้นแล้ว ผู้จองแก้ไขไม่ได้');
    await db.prepare("UPDATE travel_requests SET approval_level = 1 WHERE id = ?").run(myTravel);
    const r2 = await jput('/api/travel/' + myTravel, ownerCookie, payload({ destination: 'ลำปาง' }));
    check(r2.status === 403, `แก้หลังอนุมัติขั้นต้น → 403 (ได้ ${r2.status})`, JSON.stringify(r2.body));
    const row2 = await db.prepare('SELECT destination FROM travel_requests WHERE id = ?').get(myTravel);
    check(row2 && row2.destination === 'เชียงใหม่', 'ข้อมูลไม่ถูกแก้หลังอนุมัติขั้นต้น', `ได้ "${row2 && row2.destination}"`);

    console.log('');
    console.log('③ ผู้จองแก้รายการของคนอื่นไม่ได้');
    const r3 = await jput('/api/travel/' + otherTravel, ownerCookie, payload({ destination: 'พะเยา' }));
    check(r3.status === 403, `แก้รายการคนอื่น → 403 (ได้ ${r3.status})`, JSON.stringify(r3.body));

    console.log('');
    console.log('④ admin แก้ได้ตราบที่ยัง pending');
    // ตั้งกลับเป็นยังไม่อนุมัติ เพื่อทดสอบ admin
    await db.prepare("UPDATE travel_requests SET approval_level = 0 WHERE id = ?").run(otherTravel);
    const r4 = await jput('/api/travel/' + otherTravel, adminCookie, payload({ destination: 'น่าน', travel_subject: 'admin แก้' }));
    check(r4.status === 200, `admin แก้ไข → 200 (ได้ ${r4.status})`, JSON.stringify(r4.body));
    const row4 = await db.prepare('SELECT destination, title FROM travel_requests WHERE id = ?').get(otherTravel);
    check(row4 && row4.destination === 'น่าน' && row4.title === 'admin แก้', 'admin แก้ไขข้อมูลได้จริง',
      JSON.stringify({ d: row4 && row4.destination, t: row4 && row4.title }));
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    try {
      for (const id of madeTravels) {
        try { await db.prepare('DELETE FROM travel_requests WHERE id = ?').run(id); } catch (e) { /* ignore */ }
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
