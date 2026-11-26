'use strict';
/**
 * ทดสอบ "ผู้บังคับบัญชาขั้นต้นเลือกผู้อนุมัติ" (ผู้ใช้สั่ง 26 พ.ย. 2569)
 *
 * ในหน้าต่างพิจารณาคำขอไปราชการ ขั้นผู้บังคับบัญชาขั้นต้น (สาย สพป.)
 * ต้องเลือกได้ว่าจะให้ใครเป็น "ผู้อนุมัติ" ของคำขอใบนั้น
 * และคนที่เลือกต้องกลายเป็นผู้อนุมัติขั้นสุดท้ายจริง
 *
 * กติกาที่ต้องผ่าน
 *   ① GET /travel/final-approvers คืนรายชื่อจากคอลัมน์ "ผู้อนุมัติ" ของการตั้งค่า
 *   ② ผู้บังคับบัญชาขั้นต้นอนุมัติพร้อมเลือกผู้อนุมัติ → บันทึก final_approver_id
 *   ③ ผู้อนุมัติคนเดิมที่ตั้งไว้ในสาย อนุมัติไม่ได้แล้ว (403) — ต้องเป็นคนที่เลือก
 *   ④ คนที่เลือกอนุมัติขั้นสุดท้ายได้ → รายการเป็น approved ครบทุกขั้น
 *   ⑤ เลือกคนที่ไม่ได้อยู่ในรายชื่อ → 400
 *   ⑥ เลือกผู้อนุมัติซ้ำตอนขั้นที่ 2 → 400
 *
 * ใช้: node scripts/test-travel-final-approver.js
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
  let backupSetting = null;

  const setSetting = (key, value) => db
    .prepare('INSERT INTO settings (`key`, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
    .run(key, value);

  const mkUser = async (tag, canApprove, role = 'staff') => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, first_name, last_name, position, workplace, role, status,
       user_group, school_code, can_approve, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `zztravelfinal_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ ผู้อนุมัติ ${tag}`, 'ทดสอบ', `ผู้อนุมัติ ${tag}`,
      'เจ้าหน้าที่', 'สพป.แพร่ เขต 2', role, 'active', 'office', '', canApprove ? 1 : 0,
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
    const requester = await mkUser('requester', false, 'staff');
    const supervisor = await mkUser('supervisor', true, 'group_head');
    const configured = await mkUser('configured', true, 'deputy'); // ผู้อนุมัติที่ตั้งไว้ในสาย
    const chosen = await mkUser('chosen', true, 'director');       // ผู้อนุมัติที่ผู้บังคับบัญชาเลือก

    // เก็บของเดิมไว้คืนตอนจบ
    const oldRow = await db.prepare("SELECT value FROM settings WHERE `key` = 'travel_approvers'").get();
    backupSetting = oldRow ? oldRow.value : null;
    // สายของ requester: ผู้บังคับบัญชาขั้นต้น = supervisor · ผู้อนุมัติ = configured
    // และเพิ่มรายการอื่นที่มี approver = chosen → ให้ chosen อยู่ในรายชื่อตัวเลือก
    const mapping = {};
    mapping[String(requester)] = { supervisor, approver: configured };
    mapping['999999'] = { supervisor: 0, approver: chosen };
    await setSetting('travel_approvers', JSON.stringify(mapping));

    const supCookie = 'sid=' + (await auth.newSession(supervisor));
    const configuredCookie = 'sid=' + (await auth.newSession(configured));
    const chosenCookie = 'sid=' + (await auth.newSession(chosen));

    console.log('');
    console.log('① รายชื่อตัวเลือกผู้อนุมัติมาจากการตั้งค่า');
    const cands = await jget('/api/travel/final-approvers', supCookie);
    check(cands.status === 200, `GET /travel/final-approvers → 200 (ได้ ${cands.status})`,
      JSON.stringify(cands.body));
    const ids = (cands.body.approvers || []).map((a) => Number(a.id));
    check(ids.includes(configured) && ids.includes(chosen), 'มีทั้งผู้อนุมัติที่ตั้งไว้และคนที่จะเลือก',
      JSON.stringify(ids));
    check(!ids.includes(requester) && !ids.includes(supervisor), 'ไม่มีคนที่ไม่ได้เป็นผู้อนุมัติในรายชื่อ',
      JSON.stringify(ids));

    const travelId = await mkTravel(requester, 'ทดสอบเลือกผู้อนุมัติ');

    console.log('');
    console.log('② ผู้บังคับบัญชาขั้นต้นอนุมัติพร้อมเลือกผู้อนุมัติ');
    const r2 = await jput('/api/travel/' + travelId + '/approve', supCookie, {
      note: JSON.stringify({ choices: ['ควรอนุญาต'], reasonMap: {} }),
      final_approver_id: chosen,
    });
    check(r2.status === 200, `PUT approve + final_approver_id → 200 (ได้ ${r2.status})`, JSON.stringify(r2.body));
    const row2 = await db.prepare('SELECT final_approver_id, status, approval_level FROM travel_requests WHERE id = ?').get(travelId);
    check(Number(row2 && row2.final_approver_id) === chosen, 'บันทึก final_approver_id = คนที่เลือก',
      JSON.stringify(row2));
    check(row2 && row2.status === 'pending' && Number(row2.approval_level) === 1,
      'ยังรออนุมัติขั้นสุดท้าย (pending · ขั้น 1)', JSON.stringify(row2));

    console.log('');
    console.log('③ ผู้อนุมัติคนเดิมที่ตั้งไว้ในสาย อนุมัติไม่ได้แล้ว');
    const r3 = await jput('/api/travel/' + travelId + '/approve', configuredCookie, { note: '{}' });
    check(r3.status === 403, `คนที่ไม่ได้ถูกเลือก → 403 (ได้ ${r3.status})`, JSON.stringify(r3.body));

    console.log('');
    console.log('④ คนที่เลือกอนุมัติขั้นสุดท้ายได้ → approved');
    const r4 = await jput('/api/travel/' + travelId + '/approve', chosenCookie, {
      note: JSON.stringify({ choices: ['อนุญาต'], reasonMap: {} }),
    });
    check(r4.status === 200, `PUT approve (คนที่เลือก) → 200 (ได้ ${r4.status})`, JSON.stringify(r4.body));
    check(r4.body && r4.body.approved === true, 'อนุมัติครบทุกขั้นแล้ว', JSON.stringify(r4.body && r4.body.message));
    const row4 = await db.prepare('SELECT status FROM travel_requests WHERE id = ?').get(travelId);
    check(row4 && row4.status === 'approved', 'สถานะในฐานเป็น approved', JSON.stringify(row4));

    console.log('');
    console.log('⑤ เลือกคนที่ไม่ได้อยู่ในรายชื่อ → 400');
    const travel2 = await mkTravel(requester, 'ทดสอบเลือกคนนอก');
    const r5 = await jput('/api/travel/' + travel2 + '/approve', supCookie, {
      note: '{}', final_approver_id: requester,
    });
    check(r5.status === 400, `เลือกคนนอก → 400 (ได้ ${r5.status})`, JSON.stringify(r5.body));
    const row5 = await db.prepare('SELECT final_approver_id, approval_level FROM travel_requests WHERE id = ?').get(travel2);
    check(!row5.final_approver_id && Number(row5.approval_level) === 0, 'ไม่บันทึกอะไรเลย',
      JSON.stringify(row5));

    console.log('');
    console.log('⑥ เลือกผู้อนุมัติซ้ำตอนขั้นที่ 2 → 400');
    const r6 = await jput('/api/travel/' + travel2 + '/approve', supCookie, {
      note: '{}', final_approver_id: chosen,
    });
    check(r6.status === 200, `ขั้นที่ 1 ของคำขอที่ 2 → 200 (ได้ ${r6.status})`, JSON.stringify(r6.body));
    const r6b = await jput('/api/travel/' + travel2 + '/approve', supCookie, {
      note: '{}', final_approver_id: configured,
    });
    check(r6b.status === 400, `เลือกซ้ำตอนขั้นที่ 2 → 400 (ได้ ${r6b.status})`, JSON.stringify(r6b.body));
    const row6 = await db.prepare('SELECT final_approver_id FROM travel_requests WHERE id = ?').get(travel2);
    check(Number(row6 && row6.final_approver_id) === chosen, 'final_approver_id เดิมไม่ถูกทับ',
      JSON.stringify(row6));
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    try {
      if (backupSetting === null) {
        await db.prepare("DELETE FROM settings WHERE `key` = 'travel_approvers'").run();
      } else {
        await setSetting('travel_approvers', backupSetting);
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
