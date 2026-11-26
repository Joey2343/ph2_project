'use strict';
/**
 * ทดสอบ "ผู้อนุมัติขั้นต้น (สายสถานศึกษา) เลือกผู้อนุมัติเอง" (ผู้ใช้สั่ง 26 พ.ย. 2569)
 *
 * ขั้นที่ 2 ของสายสถานศึกษา (ผู้อนุมัติขั้นต้น) กดปุ่ม "อนุมัติขั้นต้น"
 * ต้องเลือก "ผู้อนุมัติ" (ขั้นที่ 3) ได้ และคนที่เลือกต้องกลายเป็นผู้อนุมัติจริง
 *
 * กติกาที่ต้องผ่าน
 *   ① GET /travel/final-approvers คืนรายชื่อจากคอลัมน์ "ผู้อนุมัติ" ของการตั้งค่า
 *   ② ผู้อนุมัติขั้นต้นอนุมัติพร้อมเลือกผู้อนุมัติ → บันทึก final_approver_id
 *   ③ ผู้อนุมัติคนเดิมที่ตั้งไว้ในสาย อนุมัติไม่ได้แล้ว (403)
 *   ④ คนที่เลือกอนุมัติขั้นสุดท้ายได้ → approved
 *   ⑤ คนที่ไม่มีสิทธิ์ในขั้นนี้ ตั้งค่าแทนไม่ได้ (403 + ไม่บันทึก)
 *   ⑥ เลือกคนที่ไม่ได้อยู่ในรายชื่อ → 400
 *
 * ใช้: node scripts/test-travel-school-approver-choose.js
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
const jget = async (p, cookie) => {
  const res = await fetch(BASE + p, { headers: { Cookie: cookie } });
  return { status: res.status, body: await res.json().catch(() => null) };
};

(async () => {
  console.log('');
  const db = require(path.join(__dirname, '..', 'db.js'));
  await db.init();

  const madeUsers = [];
  const madeTravels = [];
  const today = simdate.todayISO();
  let backupSchool = null;

  const setSetting = (key, value) => db
    .prepare('INSERT INTO settings (`key`, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
    .run(key, value);

  const mkUser = async (tag, role, canApprove, group = 'office') => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, first_name, last_name, position, workplace, role, status,
       user_group, school_code, can_approve, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `zztravelsap_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ ผู้อนุมัติขั้นต้น ${tag}`, 'ทดสอบ', `ผู้อนุมัติขั้นต้น ${tag}`,
      'เจ้าหน้าที่', group === 'school' ? 'โรงเรียนทดสอบ' : 'สพป.แพร่ เขต 2', role, 'active',
      group, group === 'school' ? '54020001' : '', canApprove ? 1 : 0,
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
      JSON.stringify({ travel_subject: subject, destination: 'แพร่', companions: 0, companion_names: [], companion_ids: [] }),
      '2026-11-26 09:00:00'
    );
    const id = Number(info.insertId);
    madeTravels.push(id);
    return id;
  };

  try {
    const requester = await mkUser('requester', 'teacher', false, 'school');
    const reviewer = await mkUser('reviewer', 'group_head', true);
    const supervisor = await mkUser('supervisor', 'deputy', true);
    const configured = await mkUser('configured', 'director', true); // ผู้อนุมัติที่ตั้งไว้ในสาย
    const chosen = await mkUser('chosen', 'director', true);         // คนที่ผู้อนุมัติขั้นต้นเลือก
    const intruder = await mkUser('intruder', 'director', true);     // คนที่ไม่ใช่ขั้นนี้

    const oldSchool = await db.prepare("SELECT value FROM settings WHERE `key` = 'travel_approvers_school'").get();
    backupSchool = oldSchool ? oldSchool.value : null;

    const mapping = {};
    mapping[String(requester)] = { reviewer, supervisor, approver: configured };
    mapping['999995'] = { reviewer: 0, supervisor: 0, approver: chosen };
    await setSetting('travel_approvers_school', JSON.stringify(mapping));

    const revCookie = 'sid=' + (await auth.newSession(reviewer));
    const supCookie = 'sid=' + (await auth.newSession(supervisor));
    const configuredCookie = 'sid=' + (await auth.newSession(configured));
    const chosenCookie = 'sid=' + (await auth.newSession(chosen));
    const intruderCookie = 'sid=' + (await auth.newSession(intruder));

    console.log('');
    console.log('① รายชื่อตัวเลือกผู้อนุมัติมาจากการตั้งค่า');
    const cands = await jget('/api/travel/final-approvers', supCookie);
    check(cands.status === 200, `GET /travel/final-approvers → 200 (ได้ ${cands.status})`,
      JSON.stringify(cands.body));
    const ids = (cands.body.approvers || []).map((a) => Number(a.id));
    check(ids.includes(configured) && ids.includes(chosen), 'มีทั้งผู้อนุมัติที่ตั้งไว้และคนที่จะเลือก',
      JSON.stringify(ids));

    const travelId = await mkTravel(requester, 'ทดสอบผู้อนุมัติขั้นต้นเลือกผู้อนุมัติ');

    console.log('');
    console.log('② ผู้ตรวจสอบเสนอเรื่อง (ขั้นที่ 1)');
    const r1 = await jput('/api/travel/' + travelId + '/approve', revCookie, {});
    check(r1.status === 200, `PUT approve (ผู้ตรวจสอบ) → 200 (ได้ ${r1.status})`, JSON.stringify(r1.body));

    console.log('');
    console.log('③ คนที่ไม่มีสิทธิ์ในขั้นนี้ ตั้งค่าแทนไม่ได้');
    const r3 = await jput('/api/travel/' + travelId + '/approve', intruderCookie, {
      final_approver_id: configured,
    });
    check(r3.status === 403, `คนนอกขั้น → 403 (ได้ ${r3.status})`, JSON.stringify(r3.body));
    const row3 = await db.prepare('SELECT final_approver_id FROM travel_requests WHERE id = ?').get(travelId);
    check(!row3.final_approver_id, 'ไม่บันทึก final_approver_id', JSON.stringify(row3));

    console.log('');
    console.log('④ ผู้อนุมัติขั้นต้นอนุมัติพร้อมเลือกผู้อนุมัติ (ขั้นที่ 3)');
    const r4 = await jput('/api/travel/' + travelId + '/approve', supCookie, {
      note: JSON.stringify({ choices: ['ควรอนุญาต'], reasonMap: {} }),
      final_approver_id: chosen,
    });
    check(r4.status === 200, `PUT approve + final_approver_id → 200 (ได้ ${r4.status})`, JSON.stringify(r4.body));
    const row4 = await db.prepare('SELECT final_approver_id, approval_level, status FROM travel_requests WHERE id = ?').get(travelId);
    check(Number(row4 && row4.final_approver_id) === chosen, 'บันทึก final_approver_id = คนที่เลือก',
      JSON.stringify(row4));
    check(row4 && row4.status === 'pending' && Number(row4.approval_level) === 2,
      'ยังรอผู้อนุมัติ (pending · ขั้น 2)', JSON.stringify(row4));

    console.log('');
    console.log('⑤ ผู้อนุมัติคนเดิมที่ตั้งไว้ในสาย อนุมัติไม่ได้แล้ว');
    const r5 = await jput('/api/travel/' + travelId + '/approve', configuredCookie, { note: '{}' });
    check(r5.status === 403, `คนที่ไม่ได้ถูกเลือก → 403 (ได้ ${r5.status})`, JSON.stringify(r5.body));

    console.log('');
    console.log('⑥ คนที่เลือกอนุมัติขั้นสุดท้ายได้ → approved');
    const r6 = await jput('/api/travel/' + travelId + '/approve', chosenCookie, {
      note: JSON.stringify({ choices: ['อนุญาต'], reasonMap: {} }),
    });
    check(r6.status === 200 && r6.body && r6.body.approved === true, 'อนุมัติครบทุกขั้นแล้ว',
      JSON.stringify(r6.body));
    const row6 = await db.prepare('SELECT status FROM travel_requests WHERE id = ?').get(travelId);
    check(row6 && row6.status === 'approved', 'สถานะในฐานเป็น approved', JSON.stringify(row6));

    console.log('');
    console.log('⑦ เลือกคนที่ไม่ได้อยู่ในรายชื่อ → 400');
    const travel2 = await mkTravel(requester, 'ทดสอบเลือกคนนอก');
    await jput('/api/travel/' + travel2 + '/approve', revCookie, {});
    const r7 = await jput('/api/travel/' + travel2 + '/approve', supCookie, {
      final_approver_id: requester,
    });
    check(r7.status === 400, `เลือกคนนอก → 400 (ได้ ${r7.status})`, JSON.stringify(r7.body));
    const row7 = await db.prepare('SELECT final_approver_id FROM travel_requests WHERE id = ?').get(travel2);
    check(!row7.final_approver_id, 'ไม่บันทึกอะไรเลย', JSON.stringify(row7));
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    try {
      if (backupSchool === null) {
        await db.prepare("DELETE FROM settings WHERE `key` = 'travel_approvers_school'").run();
      } else {
        await setSetting('travel_approvers_school', backupSchool);
      }
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
