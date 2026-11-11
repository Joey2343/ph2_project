'use strict';
/**
 * ทดสอบสิทธิ์การเห็นหนังสือของสถานศึกษา (ผู้ใช้สั่ง 11 พ.ย. 2569)
 *
 * ① เจ้าหน้าที่สารบัญสถานศึกษาเห็นรายการทั้งหมดที่ผ่านมาของโรงเรียน
 *    (แม้ผู้ใช้คนก่อนถูกลบออกจากระบบ — หนังสือยังอยู่ในฐาน)
 * ② ผู้ใช้ใหม่ของโรงเรียนที่ "ไม่ใช่" เจ้าหน้าที่สารบัญ → ไม่เห็นรายการก่อนหน้าที่มีอยู่ก่อนเขาเข้ามา
 * ③ คนเดียวเป็นเจ้าหน้าที่สารบัญได้หลายโรงเรียน
 *
 * ใช้: node scripts/test-school-clerk-scope.js
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const SCHOOL_A = '99999993';
const SCHOOL_B = '99999994';

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

  const mkUser = async (tag, code, createdAt) => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, position, workplace, role, status,
       user_group, school_code, current_school, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `zzclerk_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ ${tag}`, 'เจ้าหน้าที่',
      `${code} โรงเรียนทดสอบ`, 'staff', 'active', 'school', code, `${code} โรงเรียนทดสอบ`,
      createdAt, createdAt
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  const mkDoc = async (fields) => {
    const info = await db.prepare(`INSERT INTO documents
      (doc_type, doc_no, title, from_org, to_org, date, created_by, sender_type, school_code,
       body_text, is_registered, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      fields.doc_type, fields.doc_no || '', fields.title, fields.from_org || '', fields.to_org || '',
      fields.date || '2026-11-11', fields.created_by, fields.sender_type || 'office',
      fields.school_code || '', 'เนื้อหา', fields.is_registered ? 1 : 0, fields.created_at
    );
    const id = Number(info.insertId);
    madeDocs.push(id);
    return id;
  };

  try {
    const clerk = await mkUser('clerk', SCHOOL_A, '2026-10-01 09:00:00');
    const newbie = await mkUser('new', SCHOOL_A, '2026-11-10 09:00:00');

    // เอกสาร "ก่อน" ผู้ใช้ใหม่เข้ามา (1 พ.ย.) และ "หลัง" (11 พ.ย.)
    const inOld = await mkDoc({ doc_type: 'incoming', title: 'หนังสือรับเก่า', to_org: `${SCHOOL_A} โรงเรียนทดสอบ`, created_by: 1, sender_type: 'office', is_registered: 1, created_at: '2026-11-01 09:00:00' });
    const inNew = await mkDoc({ doc_type: 'incoming', title: 'หนังสือรับใหม่', to_org: `${SCHOOL_A} โรงเรียนทดสอบ`, created_by: 1, sender_type: 'office', is_registered: 1, created_at: '2026-11-11 09:00:00' });
    await db.prepare('INSERT INTO document_school_targets (document_id, school_code) VALUES (?,?)').run(inOld, SCHOOL_A);
    await db.prepare('INSERT INTO document_school_targets (document_id, school_code) VALUES (?,?)').run(inNew, SCHOOL_A);

    const outOld = await mkDoc({ doc_type: 'outgoing', title: 'หนังสือส่งเก่า', school_code: SCHOOL_A, sender_type: 'school', created_by: clerk, created_at: '2026-11-01 09:00:00' });
    const outNew = await mkDoc({ doc_type: 'outgoing', title: 'หนังสือส่งใหม่', school_code: SCHOOL_A, sender_type: 'school', created_by: clerk, created_at: '2026-11-11 09:00:00' });
    const regOld = await mkDoc({ doc_type: 'outgoing', title: 'ทะเบียนส่งเก่า', school_code: SCHOOL_A, sender_type: 'registered', created_by: clerk, is_registered: 1, created_at: '2026-11-01 09:00:00' });
    const regNew = await mkDoc({ doc_type: 'outgoing', title: 'ทะเบียนส่งใหม่', school_code: SCHOOL_A, sender_type: 'registered', created_by: clerk, is_registered: 1, created_at: '2026-11-11 09:00:00' });

    const clerkCookie = 'sid=' + (await auth.newSession(clerk));
    const newbieCookie = 'sid=' + (await auth.newSession(newbie));
    const adminCookie = 'sid=' + (await auth.newSession(1));

    const ids = async (p, cookie) => {
      const res = await fetch(BASE + p, { headers: { Cookie: cookie } });
      const j = await res.json().catch(() => ({}));
      return (j.documents || []).map((d) => Number(d.id));
    };

    console.log('');
    console.log('① เจ้าหน้าที่สารบัญสถานศึกษาเห็นรายการทั้งหมดของโรงเรียน');
    const clerkIn = await ids('/api/my-incoming', clerkCookie);
    check(clerkIn.includes(inOld) && clerkIn.includes(inNew), 'หนังสือรับ: เห็นทั้งรายการเก่าและใหม่',
      `ได้ ${clerkIn.join(',')}`);
    const clerkOut = await ids('/api/documents?doc_type=outgoing', clerkCookie);
    check(clerkOut.includes(outOld) && clerkOut.includes(outNew), 'หนังสือส่ง: เห็นทั้งรายการเก่าและใหม่',
      `ได้ ${clerkOut.join(',')}`);
    const clerkReg = await ids('/api/my-outgoing-registered', clerkCookie);
    check(clerkReg.includes(regOld) && clerkReg.includes(regNew), 'ทะเบียนหนังสือส่ง: เห็นทั้งเก่าและใหม่',
      `ได้ ${clerkReg.join(',')}`);
    const clerkRegIn = await ids('/api/my-incoming-registered', clerkCookie);
    check(clerkRegIn.includes(inOld) && clerkRegIn.includes(inNew), 'ทะเบียนหนังสือรับ: เห็นทั้งเก่าและใหม่',
      `ได้ ${clerkRegIn.join(',')}`);

    console.log('');
    console.log('② ผู้ใช้ใหม่ (ไม่ใช่เจ้าหน้าที่สารบัญ) ไม่เห็นรายการก่อนหน้า');
    const newIn = await ids('/api/my-incoming', newbieCookie);
    check(!newIn.includes(inOld) && newIn.includes(inNew), 'หนังสือรับ: ไม่เห็นเก่า เห็นเฉพาะใหม่',
      `ได้ ${newIn.join(',')}`);
    const newOut = await ids('/api/documents?doc_type=outgoing', newbieCookie);
    check(!newOut.includes(outOld) && newOut.includes(outNew), 'หนังสือส่ง: ไม่เห็นเก่า เห็นเฉพาะใหม่',
      `ได้ ${newOut.join(',')}`);
    const newReg = await ids('/api/my-outgoing-registered', newbieCookie);
    check(!newReg.includes(regOld) && newReg.includes(regNew), 'ทะเบียนหนังสือส่ง: ไม่เห็นเก่า เห็นเฉพาะใหม่',
      `ได้ ${newReg.join(',')}`);
    const newRegIn = await ids('/api/my-incoming-registered', newbieCookie);
    check(!newRegIn.includes(inOld) && newRegIn.includes(inNew), 'ทะเบียนหนังสือรับ: ไม่เห็นเก่า เห็นเฉพาะใหม่',
      `ได้ ${newRegIn.join(',')}`);

    console.log('');
    console.log('③ คนเดียวเป็นเจ้าหน้าที่สารบัญได้หลายโรงเรียน');
    const post = async (code) => {
      const res = await fetch(BASE + '/api/document-staff/school', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ school_code: code, userIds: [clerk] }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    const a1 = await post(SCHOOL_A);
    const a2 = await post(SCHOOL_B);
    check(a1.status === 200 && a2.status === 200, 'กำหนดเจ้าหน้าที่สารบัญให้ 2 โรงเรียนได้',
      JSON.stringify({ a1, a2 }));
    const rows = await db.prepare("SELECT school_code FROM document_staff WHERE staff_type = 'school' AND user_id = ? ORDER BY school_code").all(clerk);
    const codes = rows.map((r) => String(r.school_code));
    check(codes.includes(SCHOOL_A) && codes.includes(SCHOOL_B), 'มีแถวเจ้าหน้าที่สารบัญทั้ง 2 โรงเรียน',
      JSON.stringify(codes));
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
