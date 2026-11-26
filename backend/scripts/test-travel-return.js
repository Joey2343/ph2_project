'use strict';
/**
 * ทดสอบ "ส่งกลับเพื่อแก้ไข" ของคำขอไปราชการ (ผู้ใช้สั่ง 26 พ.ย. 2569)
 *
 * ผู้ตรวจสอบ (ขั้นที่ 1 สายสถานศึกษา) กด "ส่งกลับเพื่อแก้ไข" ได้
 *   → status = returned + เหตุผล (revision_note) + แจ้งเตือนผู้ยื่น
 *   → ผู้ยื่นแก้ไขแล้วบันทึก ระบบส่งเข้าสายอนุมัติใหม่ให้เอง (status = pending)
 *
 * กติกาที่ต้องผ่าน
 *   ① ไม่กรอกเหตุผล → 400
 *   ② ผู้ที่ไม่มีสิทธิ์ในขั้นนี้ ส่งกลับไม่ได้ → 403
 *   ③ ผู้ตรวจสอบส่งกลับได้ → returned + revision_note
 *   ④ ผู้ยื่นแก้ไขได้ (แม้สถานะ returned) → กลับเป็น pending + ล้าง revision_note
 *   ⑤ อนุมัติขั้นที่ 1 แล้ว ส่งกลับไม่ได้ → 400
 *
 * ใช้: node scripts/test-travel-return.js
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
      `zztrvret_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ ส่งกลับ ${tag}`, 'ทดสอบ', `ส่งกลับ ${tag}`,
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
    const approver = await mkUser('approver', 'director', true);

    const oldSchool = await db.prepare("SELECT value FROM settings WHERE `key` = 'travel_approvers_school'").get();
    backupSchool = oldSchool ? oldSchool.value : null;
    const mapping = {};
    mapping[String(requester)] = { reviewer, supervisor, approver };
    await setSetting('travel_approvers_school', JSON.stringify(mapping));

    const revCookie = 'sid=' + (await auth.newSession(reviewer));
    const supCookie = 'sid=' + (await auth.newSession(supervisor));
    const reqCookie = 'sid=' + (await auth.newSession(requester));

    const travelId = await mkTravel(requester, 'ทดสอบส่งกลับเพื่อแก้ไข');

    console.log('');
    console.log('① ไม่กรอกเหตุผล → 400');
    const r1 = await jput('/api/travel/' + travelId + '/return', revCookie, { note: '' });
    check(r1.status === 400, `ส่งกลับโดยไม่มีเหตุผล → 400 (ได้ ${r1.status})`, JSON.stringify(r1.body));

    console.log('');
    console.log('② ผู้ที่ไม่มีสิทธิ์ในขั้นนี้ ส่งกลับไม่ได้');
    const r2 = await jput('/api/travel/' + travelId + '/return', supCookie, { note: 'ทดสอบ' });
    check(r2.status === 403, `ผู้บังคับบัญชาขั้นต้น (ขั้น 2) กดส่งกลับตอนขั้น 1 → 403 (ได้ ${r2.status})`,
      JSON.stringify(r2.body));

    console.log('');
    console.log('③ ผู้ตรวจสอบส่งกลับได้ → returned + revision_note');
    const note = 'วันเดินทางไม่ถูกต้อง / ไม่ได้แนบหนังสืออนุมัติ';
    const r3 = await jput('/api/travel/' + travelId + '/return', revCookie, { note });
    check(r3.status === 200, `ส่งกลับ → 200 (ได้ ${r3.status})`, JSON.stringify(r3.body));
    const row3 = await db.prepare('SELECT status, revision_note, returned_by, approval_level FROM travel_requests WHERE id = ?').get(travelId);
    check(row3 && row3.status === 'returned', 'สถานะเป็น returned', JSON.stringify(row3 && row3.status));
    check(row3 && row3.revision_note === note, 'บันทึกเหตุผลที่ให้แก้ไข', JSON.stringify(row3 && row3.revision_note));
    check(row3 && Number(row3.returned_by) === reviewer, 'บันทึกผู้ส่งกลับ', JSON.stringify(row3 && row3.returned_by));
    check(row3 && Number(row3.approval_level) === 0, 'ยังไม่มีขั้นใดถูกอนุมัติ', JSON.stringify(row3 && row3.approval_level));

    console.log('');
    console.log('④ ผู้ยื่นแก้ไขได้ → กลับเป็น pending');
    const edit = await jput('/api/travel/' + travelId, reqCookie, {
      travel_subject: 'แก้ไขเรื่องแล้ว',
      destination: 'เชียงใหม่',
      date_from: today,
      date_to: today,
      form_data: { travel_subject: 'แก้ไขเรื่องแล้ว', destination: 'เชียงใหม่', companions: 0, companion_names: [], companion_ids: [] },
    });
    check(edit.status === 200, `PUT /travel/:id (ผู้ยื่น) → 200 (ได้ ${edit.status})`, JSON.stringify(edit.body));
    check(edit.body && edit.body.resubmitted === true, 'แจ้งว่าเป็นการส่งคำขอใหม่', JSON.stringify(edit.body && edit.body.resubmitted));
    const row4 = await db.prepare('SELECT status, revision_note, title, destination FROM travel_requests WHERE id = ?').get(travelId);
    check(row4 && row4.status === 'pending', 'สถานะกลับเป็น pending', JSON.stringify(row4 && row4.status));
    check(row4 && !row4.revision_note, 'ล้างเหตุผลที่ให้แก้ไขแล้ว', JSON.stringify(row4 && row4.revision_note));
    check(row4 && row4.destination === 'เชียงใหม่', 'บันทึกข้อมูลใหม่แล้ว', JSON.stringify(row4 && row4.destination));

    console.log('');
    console.log('⑤ อนุมัติขั้นที่ 1 แล้ว ส่งกลับไม่ได้');
    const appr = await jput('/api/travel/' + travelId + '/approve', revCookie, {});
    check(appr.status === 200, `ผู้ตรวจสอบอนุมัติขั้น 1 → 200 (ได้ ${appr.status})`, JSON.stringify(appr.body));
    const r5 = await jput('/api/travel/' + travelId + '/return', supCookie, { note: 'ทดสอบ' });
    check(r5.status === 400, `ส่งกลับหลังอนุมัติขั้น 1 → 400 (ได้ ${r5.status})`, JSON.stringify(r5.body));
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
