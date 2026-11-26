'use strict';
/**
 * ทดสอบ "ผู้ตรวจสอบเลือกผู้บังคับบัญชาขั้นต้น" (ผู้ใช้สั่ง 26 พ.ย. 2569)
 *
 * สายสถานศึกษา ขั้นที่ 1 (ผู้ตรวจสอบ) กดปุ่มตรวจสอบ → หน้าต่าง "⊙ เสนอเรื่องคำขออนุญาตเดินทางไปราชการ"
 * ต้องเลือก "เสนอเรื่องถึง" (ผู้บังคับบัญชาขั้นต้น ขั้นที่ 2) ได้
 * และคนที่เลือกต้องกลายเป็นผู้บังคับบัญชาขั้นต้นของคำขอใบนั้นจริง
 *
 * กติกาที่ต้องผ่าน
 *   ① GET /travel/supervisor-candidates คืนรายชื่อจากคอลัมน์ "ผู้บังคับบัญชาขั้นต้น"
 *   ② ผู้ตรวจสอบเสนอเรื่องพร้อมเลือกผู้บังคับบัญชาขั้นต้น → บันทึก chosen_supervisor_id
 *   ③ ผู้บังคับบัญชาขั้นต้นคนเดิมที่ตั้งไว้ในสาย อนุมัติไม่ได้แล้ว (403)
 *   ④ คนที่เลือกอนุมัติขั้นที่ 2 ได้ → ไปต่อขั้นที่ 3 (ผู้อนุมัติ) → approved
 *   ⑤ เลือกคนที่ไม่ได้อยู่ในรายชื่อ → 400
 *   ⑥ สาย สพป. ใช้ chosen_supervisor_id ไม่ได้ → 400
 *
 * ใช้: node scripts/test-travel-supervisor-choose.js
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
  let backupOffice = null;

  const setSetting = (key, value) => db
    .prepare('INSERT INTO settings (`key`, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
    .run(key, value);

  const mkUser = async (tag, role, canApprove, group = 'office') => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, first_name, last_name, position, workplace, role, status,
       user_group, school_code, can_approve, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `zztravelsup_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ ผู้บังคับบัญชา ${tag}`, 'ทดสอบ', `ผู้บังคับบัญชา ${tag}`,
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
    const configured = await mkUser('configured', 'deputy', true); // ผู้บังคับบัญชาขั้นต้นที่ตั้งไว้ในสาย
    const chosen = await mkUser('chosen', 'deputy', true);         // คนที่ผู้ตรวจสอบเลือก
    const approver = await mkUser('approver', 'director', true);

    const oldSchool = await db.prepare("SELECT value FROM settings WHERE `key` = 'travel_approvers_school'").get();
    const oldOffice = await db.prepare("SELECT value FROM settings WHERE `key` = 'travel_approvers'").get();
    backupSchool = oldSchool ? oldSchool.value : null;
    backupOffice = oldOffice ? oldOffice.value : null;

    const mapping = {};
    mapping[String(requester)] = { reviewer, supervisor: configured, approver };
    mapping['999997'] = { reviewer: 0, supervisor: chosen, approver: 0 };
    await setSetting('travel_approvers_school', JSON.stringify(mapping));

    const revCookie = 'sid=' + (await auth.newSession(reviewer));
    const configuredCookie = 'sid=' + (await auth.newSession(configured));
    const chosenCookie = 'sid=' + (await auth.newSession(chosen));
    const approverCookie = 'sid=' + (await auth.newSession(approver));

    console.log('');
    console.log('① รายชื่อตัวเลือก "เสนอเรื่องถึง" มาจากการตั้งค่า');
    const cands = await jget('/api/travel/supervisor-candidates', revCookie);
    check(cands.status === 200, `GET /travel/supervisor-candidates → 200 (ได้ ${cands.status})`,
      JSON.stringify(cands.body));
    const ids = (cands.body.supervisors || []).map((s) => Number(s.id));
    check(ids.includes(configured) && ids.includes(chosen), 'มีทั้งคนที่ตั้งไว้และคนที่จะเลือก', JSON.stringify(ids));
    check(!ids.includes(reviewer) && !ids.includes(requester), 'ไม่มีคนที่ไม่ได้เป็นผู้บังคับบัญชาในรายชื่อ',
      JSON.stringify(ids));

    const travelId = await mkTravel(requester, 'ทดสอบเสนอเรื่องถึง');

    console.log('');
    console.log('② ผู้ตรวจสอบเสนอเรื่องพร้อมเลือกผู้บังคับบัญชาขั้นต้น');
    const r2 = await jput('/api/travel/' + travelId + '/approve', revCookie, {
      chosen_supervisor_id: chosen,
    });
    check(r2.status === 200, `PUT approve + chosen_supervisor_id → 200 (ได้ ${r2.status})`, JSON.stringify(r2.body));
    const row2 = await db.prepare('SELECT chosen_supervisor_id, status, approval_level FROM travel_requests WHERE id = ?').get(travelId);
    check(Number(row2 && row2.chosen_supervisor_id) === chosen, 'บันทึก chosen_supervisor_id = คนที่เลือก',
      JSON.stringify(row2));
    check(row2 && row2.status === 'pending' && Number(row2.approval_level) === 1,
      'ยังรอผู้บังคับบัญชาขั้นต้น (pending · ขั้น 1)', JSON.stringify(row2));

    console.log('');
    console.log('③ ผู้บังคับบัญชาขั้นต้นคนเดิมที่ตั้งไว้ในสาย อนุมัติไม่ได้แล้ว');
    const r3 = await jput('/api/travel/' + travelId + '/approve', configuredCookie, { note: '{}' });
    check(r3.status === 403, `คนที่ไม่ได้ถูกเลือก → 403 (ได้ ${r3.status})`, JSON.stringify(r3.body));

    console.log('');
    console.log('④ คนที่เลือกอนุมัติขั้นที่ 2 ได้ → ต่อไปขั้นที่ 3 → approved');
    const r4 = await jput('/api/travel/' + travelId + '/approve', chosenCookie, { note: '{}' });
    check(r4.status === 200, `PUT approve (คนที่เลือก) → 200 (ได้ ${r4.status})`, JSON.stringify(r4.body));
    check(r4.body && r4.body.approved === false, 'ยังไม่จบ (เหลือขั้นผู้อนุมัติ)',
      JSON.stringify(r4.body && r4.body.message));
    const r4b = await jput('/api/travel/' + travelId + '/approve', approverCookie, { note: '{}' });
    check(r4b.status === 200 && r4b.body && r4b.body.approved === true, 'ผู้อนุมัติขั้น 3 อนุมัติจบ',
      JSON.stringify(r4b.body));
    const row4 = await db.prepare('SELECT status FROM travel_requests WHERE id = ?').get(travelId);
    check(row4 && row4.status === 'approved', 'สถานะในฐานเป็น approved', JSON.stringify(row4));

    console.log('');
    console.log('⑤ เลือกคนที่ไม่ได้อยู่ในรายชื่อ → 400');
    const travel2 = await mkTravel(requester, 'ทดสอบเลือกคนนอก');
    const r5 = await jput('/api/travel/' + travel2 + '/approve', revCookie, {
      chosen_supervisor_id: requester,
    });
    check(r5.status === 400, `เลือกคนนอก → 400 (ได้ ${r5.status})`, JSON.stringify(r5.body));
    const row5 = await db.prepare('SELECT chosen_supervisor_id, approval_level FROM travel_requests WHERE id = ?').get(travel2);
    check(!row5.chosen_supervisor_id && Number(row5.approval_level) === 0, 'ไม่บันทึกอะไรเลย', JSON.stringify(row5));

    console.log('');
    console.log('⑥ สาย สพป. ใช้ chosen_supervisor_id ไม่ได้ → 400');
    const officeRequester = await mkUser('officereq', 'staff', false, 'office');
    const officeSup = await mkUser('officesup', 'group_head', true, 'office');
    const officeAppr = await mkUser('officeappr', 'deputy', true, 'office');
    const officeMap = {};
    officeMap[String(officeRequester)] = { supervisor: officeSup, approver: officeAppr };
    await setSetting('travel_approvers', JSON.stringify(officeMap));
    const travel3 = await mkTravel(officeRequester, 'ทดสอบสาย สพป.');
    const officeSupCookie = 'sid=' + (await auth.newSession(officeSup));
    const r6 = await jput('/api/travel/' + travel3 + '/approve', officeSupCookie, {
      chosen_supervisor_id: officeAppr,
    });
    check(r6.status === 400, `สาย สพป. ส่ง chosen_supervisor_id → 400 (ได้ ${r6.status})`, JSON.stringify(r6.body));
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    try {
      if (backupSchool === null) {
        await db.prepare("DELETE FROM settings WHERE `key` = 'travel_approvers_school'").run();
      } else {
        await setSetting('travel_approvers_school', backupSchool);
      }
      if (backupOffice === null) {
        await db.prepare("DELETE FROM settings WHERE `key` = 'travel_approvers'").run();
      } else {
        await setSetting('travel_approvers', backupOffice);
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
