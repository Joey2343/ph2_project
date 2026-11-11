'use strict';
/**
 * ทดสอบสิทธิ์ "แก้ไข/ลบหนังสือของโรงเรียน" ของเจ้าหน้าที่สารบัญสถานศึกษา
 * (ผู้ใช้แจ้ง 11 พ.ย. 2569 — หนังสือส่ง 54020001 เลขที่ ศธ 04110.0001/2
 *  และ 54020002 เลขที่ ศธ 04110.0002/2 ลบไม่ได้)
 *
 * สาเหตุ: รายการเหล่านี้ลงทะเบียนโดยเจ้าหน้าที่คนก่อน/บัญชีอื่น
 *   → เดิมสิทธิ์ลบเช็คแค่ created_by → คนที่ดูแลโรงเรียนอยู่จริงลบไม่ได้
 *
 * สิ่งที่ต้องผ่าน
 *   ① สารบัญสถานศึกษาลบหนังสือของโรงเรียนตัวเองได้ แม้ผู้สร้างเป็นบัญชีอื่น
 *   ② แก้ไข (PUT) ได้เช่นกัน
 *   ③ บุคลากรของโรงเรียนที่ไม่ใช่สารบัญ → 403
 *   ④ สารบัญของโรงเรียนอื่น → 403
 *   ⑤ รายการที่ส่งมา (GET) ต้องมี can_edit = true/false ให้หน้าเว็บใช้ตัดสินปุ่ม
 *
 * ใช้: node scripts/test-school-clerk-delete.js
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const SCHOOL_A = '99999961';
const SCHOOL_B = '99999962';

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
  const madeDocs = [];

  const mkUser = async (tag, code) => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, position, workplace, role, status,
       user_group, school_code, current_school, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`).run(
      `zzclerkdel_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ ลบหนังสือ ${tag}`, 'เจ้าหน้าที่',
      `${code} โรงเรียนทดสอบ`, 'staff', 'active', 'school', code, `${code} โรงเรียนทดสอบ`
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  /** หนังสือส่งของโรงเรียน (ลงทะเบียนเลขหนังสือแล้ว) */
  const mkDoc = async (code, createdBy, docNo) => {
    const info = await db.prepare(`INSERT INTO documents
      (doc_type, doc_no, title, from_org, to_org, date, created_by, sender_type, school_code,
       is_registered, body_text, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW())`).run(
      'outgoing', docNo, 'ทดสอบลบหนังสือของโรงเรียน', `${code} โรงเรียนทดสอบ`, 'สพป.แพร่ เขต 2',
      '2026-11-11', createdBy, 'registered', code, 1, 'เนื้อหา'
    );
    const id = Number(info.insertId);
    madeDocs.push(id);
    return id;
  };

  const asSchool = async (uid, code) => {
    await db.prepare('UPDATE users SET current_school = ?, school_code = ? WHERE id = ?')
      .run(`${code} โรงเรียนทดสอบ`, code, uid);
    return 'sid=' + (await auth.newSession(uid));
  };

  const jdel = async (id, cookie) => {
    const res = await fetch(BASE + '/api/documents/' + id, { method: 'DELETE', headers: { Cookie: cookie } });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  const jput = async (id, cookie, body) => {
    const res = await fetch(BASE + '/api/documents/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body || {}),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  const registered = async (cookie) => {
    const res = await fetch(BASE + '/api/my-outgoing-registered', { headers: { Cookie: cookie } });
    const j = await res.json().catch(() => ({}));
    return j.documents || [];
  };

  try {
    const creator = await mkUser('creator', SCHOOL_A);
    const clerk = await mkUser('clerk', SCHOOL_A);
    const plain = await mkUser('plain', SCHOOL_A);
    const otherClerk = await mkUser('otherclerk', SCHOOL_B);
    const adminCookie = 'sid=' + (await auth.newSession(1));

    // กำหนดสารบัญ: โรงเรียน A = clerk · โรงเรียน B = otherClerk
    for (const [code, uid] of [[SCHOOL_A, clerk], [SCHOOL_B, otherClerk]]) {
      const res = await fetch(BASE + '/api/document-staff/school', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ school_code: code, userIds: [uid] }),
      });
      check(res.status === 200, `กำหนดเจ้าหน้าที่สารบัญโรงเรียน ${code} สำเร็จ`);
    }

    // หนังสือของโรงเรียน A ที่ "คนอื่น" เป็นผู้สร้าง (จำลองบัญชีเจ้าหน้าที่คนก่อน)
    const docEdit = await mkDoc(SCHOOL_A, creator, 'ที่ ศธ 04110.0001/2');
    const docDel = await mkDoc(SCHOOL_A, creator, 'ที่ ศธ 04110.0002/2');
    const docDeny = await mkDoc(SCHOOL_A, creator, 'ที่ ศธ 04110.0003/2');

    const clerkCookie = await asSchool(clerk, SCHOOL_A);
    const plainCookie = await asSchool(plain, SCHOOL_A);
    const otherCookie = await asSchool(otherClerk, SCHOOL_B);

    console.log('');
    console.log('① สารบัญสถานศึกษาแก้ไข/ลบหนังสือของโรงเรียนตัวเองได้ (ผู้สร้างเป็นบัญชีอื่น)');
    const edit = await jput(docEdit, clerkCookie, { title: 'แก้ไขโดยเจ้าหน้าที่สารบัญ' });
    check(edit.status === 200, `PUT /documents/:id → 200 (ได้ ${edit.status})`, JSON.stringify(edit.body));
    const after = await db.prepare('SELECT title FROM documents WHERE id = ?').get(docEdit);
    check(after && after.title === 'แก้ไขโดยเจ้าหน้าที่สารบัญ', 'แก้ไขข้อมูลลงฐานแล้ว', JSON.stringify(after));

    const del = await jdel(docDel, clerkCookie);
    check(del.status === 200, `DELETE /documents/:id → 200 (ได้ ${del.status})`, JSON.stringify(del.body));
    const gone = await db.prepare('SELECT id FROM documents WHERE id = ?').get(docDel);
    check(!gone, 'ลบออกจากฐานแล้ว');

    console.log('');
    console.log('② บุคลากรของโรงเรียนที่ไม่ใช่สารบัญ → ลบไม่ได้');
    const plainDel = await jdel(docDeny, plainCookie);
    check(plainDel.status === 403, `DELETE → 403 (ได้ ${plainDel.status})`, JSON.stringify(plainDel.body));
    const still = await db.prepare('SELECT id FROM documents WHERE id = ?').get(docDeny);
    check(!!still, 'หนังสือยังอยู่');

    console.log('');
    console.log('③ สารบัญของโรงเรียนอื่น → ลบไม่ได้');
    const otherDel = await jdel(docDeny, otherCookie);
    check(otherDel.status === 403, `DELETE → 403 (ได้ ${otherDel.status})`, JSON.stringify(otherDel.body));

    console.log('');
    console.log('④ รายการที่ส่งมา มี can_edit ให้หน้าเว็บใช้ตัดสินปุ่ม');
    const clerkRows = await registered(clerkCookie);
    const cRow = clerkRows.find((d) => Number(d.id) === docDeny);
    check(!!cRow && cRow.can_edit === true, 'สารบัญเห็น can_edit = true', JSON.stringify(cRow && cRow.can_edit));
    const plainRows = await registered(plainCookie);
    const pRow = plainRows.find((d) => Number(d.id) === docDeny);
    check(pRow && pRow.can_edit === false, 'บุคลากรทั่วไป can_edit = false (หรือไม่เห็นแถว)', JSON.stringify(pRow && pRow.can_edit));
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    try {
      for (const id of madeDocs) {
        try { await db.prepare('DELETE FROM document_recipients WHERE document_id = ?').run(id); } catch (e) { /* ignore */ }
        try { await db.prepare('DELETE FROM document_school_targets WHERE document_id = ?').run(id); } catch (e) { /* ignore */ }
        try { await db.prepare('DELETE FROM documents WHERE id = ?').run(id); } catch (e) { /* ignore */ }
      }
      for (const id of madeUsers) {
        try { await db.prepare('DELETE FROM document_staff WHERE user_id = ?').run(id); } catch (e) { /* ignore */ }
        try { await db.prepare('DELETE FROM document_recipients WHERE user_id = ?').run(id); } catch (e) { /* ignore */ }
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
