'use strict';
/**
 * ทดสอบ "เรียนเสนอ" ของบันทึกข้อความ — เลือกผู้อนุมัติขั้นที่ 2 จากรายชื่อที่กำหนดไว้
 * (ผู้ใช้สั่ง 27 พ.ย. 2569)
 *
 * กติกาที่ต้องผ่าน
 *   ① ตัวเลือกขั้นที่ 2 = สายของผู้จัดทำ + ทุกคนในคอลัมน์ขั้นที่ 2 ของหน้า
 *      "+ เพิ่มเจ้าหน้าที่ (ลำดับขั้นบันทึกข้อความ)"
 *   ② ผู้อนุมัติขั้นที่ 1 เลือกคนไหน → บันทึก next_approver_id + ส่งถึงคนนั้น
 *   ③ คนที่ถูกเลือกเห็นบันทึกข้อความในรายการของตัวเอง และอนุมัติต่อได้
 *   ④ เลือกคนที่ไม่ได้ถูกกำหนดไว้ → 400
 *
 * ใช้: node scripts/test-memo-next-approver.js
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
  const madeMemos = [];
  let backupSetting = null;

  const setSetting = (key, value) => db
    .prepare('INSERT INTO settings (`key`, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
    .run(key, value);

  const mkUser = async (tag) => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, first_name, last_name, position, workplace, role, status,
       user_group, school_code, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `zzmemo_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ บันทึก ${tag}`, 'ทดสอบ', `บันทึก ${tag}`,
      'เจ้าหน้าที่', 'สพป.แพร่ เขต 2', 'staff', 'active', 'office', '',
      '2026-10-01 09:00:00', '2026-10-01 09:00:00'
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  const mkMemo = async (userId, subject, chain = '[]') => {
    const info = await db.prepare(`INSERT INTO memos
      (doc_no, user_id, title, content, date, status, approval_level, approval_data, approval_chain, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      'ทดสอบ/' + Date.now(), userId, subject, 'เนื้อหาทดสอบ', simdate.todayISO(), 'submitted', 0, '[]', chain,
      '2026-11-27 09:00:00'
    );
    const id = Number(info.insertId);
    madeMemos.push(id);
    return id;
  };

  try {
    const requester = await mkUser('requester');
    const approver1 = await mkUser('approver1');
    const approver2own = await mkUser('approver2own');
    const approver2other = await mkUser('approver2other');
    const approver3 = await mkUser('approver3');
    const outsider = await mkUser('outsider');

    const oldRow = await db.prepare("SELECT value FROM settings WHERE `key` = 'memo_approvers'").get();
    backupSetting = oldRow ? oldRow.value : null;
    const per = {
      1: { [String(requester)]: approver1 },
      2: { [String(requester)]: approver2own, '999999': approver2other },
      3: { [String(requester)]: approver3 },
    };
    await setSetting('memo_approvers', JSON.stringify({ per }));

    const c1 = 'sid=' + (await auth.newSession(approver1));
    const cOther = 'sid=' + (await auth.newSession(approver2other));
    const cReq = 'sid=' + (await auth.newSession(requester));

    console.log('');
    console.log('① ผู้อนุมัติขั้นที่ 1 เลือกผู้อนุมัติขั้นที่ 2 (คนที่กำหนดไว้ในคอลัมน์ขั้นที่ 2)');
    const memoId = await mkMemo(requester, 'ทดสอบเรียนเสนอ');
    const r1 = await jput('/api/memos/' + memoId + '/approve', c1, {
      decide: 'เพื่อโปรดพิจารณา',
      next_approver_id: approver2other,
    });
    check(r1.status === 200, `PUT approve + next_approver_id → 200 (ได้ ${r1.status})`, JSON.stringify(r1.body));
    const row1 = await db.prepare('SELECT next_approver_id, approval_level, status FROM memos WHERE id = ?').get(memoId);
    check(Number(row1 && row1.next_approver_id) === approver2other, 'บันทึก next_approver_id = คนที่เลือก',
      JSON.stringify(row1));
    check(row1 && row1.status === 'submitted' && Number(row1.approval_level) === 1,
      'ยังรออนุมัติขั้นที่ 2 (submitted · ขั้น 1)', JSON.stringify(row1));

    console.log('');
    console.log('② คนที่ถูกเลือกเห็นบันทึกข้อความในรายการของตัวเอง');
    const list = await jget('/api/memos', cOther);
    const found = (list.body && list.body.memos ? list.body.memos : []).some((x) => Number(x.id) === memoId);
    check(list.status === 200 && found, 'รายการของคนที่ถูกเลือกมีบันทึกข้อความนี้', JSON.stringify({ status: list.status }));

    console.log('');
    console.log('③ คนที่ถูกเลือกอนุมัติต่อได้ (ปฏิบัติราชการ/รักษาราชการแทน)');
    const r3 = await jput('/api/memos/' + memoId + '/approve', cOther, {
      mode: 'act',
      act_choices: ['ทราบ'],
      comment: 'ทดสอบส่งต่อ',
    });
    check(r3.status === 200, `PUT approve (ขั้น 2) → 200 (ได้ ${r3.status})`, JSON.stringify(r3.body));
    const row3 = await db.prepare('SELECT status, approval_level FROM memos WHERE id = ?').get(memoId);
    check(row3 && row3.status === 'approved', 'อนุมัติครบทุกขั้นแล้ว', JSON.stringify(row3));

    console.log('');
    console.log('④ เลือกคนที่ไม่ได้ถูกกำหนดไว้ → 400');
    const memo2 = await mkMemo(requester, 'ทดสอบเลือกคนนอก');
    const r4 = await jput('/api/memos/' + memo2 + '/approve', c1, {
      decide: 'เพื่อโปรดทราบ',
      next_approver_id: outsider,
    });
    check(r4.status === 400, `เลือกคนนอก → 400 (ได้ ${r4.status})`, JSON.stringify(r4.body));
    const row4 = await db.prepare('SELECT next_approver_id, approval_level FROM memos WHERE id = ?').get(memo2);
    check(!row4.next_approver_id && Number(row4.approval_level) === 0, 'ไม่บันทึกอะไรเลย', JSON.stringify(row4));

    console.log('');
    console.log('⑤ ผู้จัดทำยังเห็นบันทึกข้อความของตัวเอง');
    const reqList = await jget('/api/memos', cReq);
    const reqFound = (reqList.body && reqList.body.memos ? reqList.body.memos : []).some((x) => Number(x.id) === memoId);
    check(reqList.status === 200 && reqFound, 'รายการของผู้จัดทำยังมีเรื่องนี้', JSON.stringify({ status: reqList.status }));
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    try {
      if (backupSetting === null) {
        await db.prepare("DELETE FROM settings WHERE `key` = 'memo_approvers'").run();
      } else {
        await setSetting('memo_approvers', backupSetting);
      }
      for (const id of madeMemos) {
        try { await db.prepare('DELETE FROM memos WHERE id = ?').run(id); } catch (e) { /* ignore */ }
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
