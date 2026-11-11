'use strict';
/**
 * ทดสอบ "อ่านแล้ว" แยกตามโรงเรียน ของเจ้าหน้าที่สารบัญคนเดียวหลายโรงเรียน
 * (ผู้ใช้สั่ง 11 พ.ย. 2569)
 *
 * สถานการณ์จริง: user 3540300144598 เป็นเจ้าหน้าที่สารบัญของ 54020001 และ 54020002
 *   - อยู่ใน 54020001 เปิดดูหนังสือ → 54020001 เปลี่ยนเป็น "อ่านแล้ว"
 *   - 54020002 ต้องยังเป็น "ยังไม่อ่าน" จนกว่าจะเข้าไปเปิดดูใน 54020002 เอง
 *
 * สิ่งที่ต้องผ่าน
 *   ① กำหนดเจ้าหน้าที่สารบัญ 2 โรงเรียน → มีแถวผู้รับแยกโรงเรียนละ 1 แถว
 *      (เดิมสร้างแถวเดียว → สถานะ 2 โรงเรียนปนกัน)
 *   ② อ่านที่โรงเรียน A → แถว A = อ่านแล้ว · แถว B = ยังไม่อ่าน
 *   ③ เข้าโรงเรียน B → รายการยังขึ้น "ยังไม่อ่าน" (ไม่เห็นสถานะของ A)
 *   ④ อ่านที่โรงเรียน B → แถว B = อ่านแล้ว · แถว A ยังเป็นอ่านแล้วเหมือนเดิม
 *   ⑤ หนังสือที่ส่งถึงโรงเรียน B ต้องไม่โผล่ในรายการของโรงเรียน A
 *
 * ใช้: node scripts/test-school-multi-school-read.js
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const SCHOOL_A = '99999971';
const SCHOOL_B = '99999972';

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
      `zzmulti_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ หลายโรงเรียน ${tag}`, 'เจ้าหน้าที่',
      `${code} โรงเรียนทดสอบ`, 'staff', 'active', 'school', code, `${code} โรงเรียนทดสอบ`
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  const mkDoc = async (title) => {
    const info = await db.prepare(`INSERT INTO documents
      (doc_type, doc_no, title, from_org, to_org, date, created_by, sender_type, school_code, body_text, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,NOW())`).run(
      'incoming', '', title, 'สพป.แพร่ เขต 2',
      `ส่งทุกโรงเรียน`, '2026-11-11', 1, 'office', '', 'เนื้อหา'
    );
    const id = Number(info.insertId);
    madeDocs.push(id);
    return id;
  };

  /** เข้าสู่ระบบเป็นบัญชีนี้ "ในโรงเรียนที่เลือก" (จำลองการเลือกโรงเรียนตอนล็อกอิน) */
  const asSchool = async (uid, code) => {
    await db.prepare('UPDATE users SET current_school = ?, school_code = ? WHERE id = ?')
      .run(`${code} โรงเรียนทดสอบ`, code, uid);
    return 'sid=' + (await auth.newSession(uid));
  };

  const incoming = async (cookie) => {
    const res = await fetch(BASE + '/api/my-incoming', { headers: { Cookie: cookie } });
    const j = await res.json().catch(() => ({}));
    return { status: res.status, docs: j.documents || [] };
  };

  const markRead = async (cookie, docId) => {
    const res = await fetch(BASE + '/api/document-recipients/' + docId + '/read', {
      method: 'PUT',
      headers: { Cookie: cookie },
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  const rowOf = (docId, uid, code) => db
    .prepare('SELECT id, is_read, as_school FROM document_recipients WHERE document_id = ? AND user_id = ? AND as_school = ?')
    .get(docId, uid, code);

  try {
    const clerk = await mkUser('clerk', SCHOOL_A);
    const adminCookie = 'sid=' + (await auth.newSession(1));

    // หนังสือ 1 ฉบับส่งถึง "ทั้ง 2 โรงเรียน"
    const docBoth = await mkDoc('หนังสือถึง 2 โรงเรียน');
    for (const code of [SCHOOL_A, SCHOOL_B]) {
      await db.prepare('INSERT INTO document_school_targets (document_id, school_code) VALUES (?,?)').run(docBoth, code);
    }
    // หนังสืออีกฉบับส่งถึง "โรงเรียน B" เท่านั้น
    const docBOnly = await mkDoc('หนังสือถึงโรงเรียน B เท่านั้น');
    await db.prepare('INSERT INTO document_school_targets (document_id, school_code) VALUES (?,?)').run(docBOnly, SCHOOL_B);

    const assign = async (code) => {
      const res = await fetch(BASE + '/api/document-staff/school', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ school_code: code, userIds: [clerk] }),
      });
      return res.status;
    };

    console.log('① กำหนดเจ้าหน้าที่สารบัญ 2 โรงเรียน → มีแถวผู้รับแยกกันโรงเรียนละ 1 แถว');
    check(await assign(SCHOOL_A) === 200, 'กำหนดโรงเรียน A สำเร็จ');
    check(await assign(SCHOOL_B) === 200, 'กำหนดโรงเรียน B สำเร็จ');
    const rows = await db
      .prepare('SELECT as_school, is_read FROM document_recipients WHERE document_id = ? AND user_id = ? ORDER BY as_school')
      .all(docBoth, clerk);
    check(rows.length === 2, `มีแถวผู้รับ 2 แถว (โรงเรียนละ 1) — ได้ ${rows.length}`, JSON.stringify(rows));
    const codes = rows.map((r) => String(r.as_school));
    check(codes.includes(SCHOOL_A) && codes.includes(SCHOOL_B), 'แถวผูกกับทั้ง 2 โรงเรียน', JSON.stringify(codes));

    console.log('');
    console.log('② อ่านที่โรงเรียน A → เฉพาะแถวของ A');
    const cookieA = await asSchool(clerk, SCHOOL_A);
    const listA1 = await incoming(cookieA);
    const docA1 = listA1.docs.find((d) => Number(d.id) === docBoth);
    check(!!docA1, 'โรงเรียน A เห็นหนังสือฉบับนี้');
    check(docA1 && Number(docA1.is_read) === 0, 'สถานะเริ่มต้น = ยังไม่อ่าน',
      JSON.stringify(docA1 && docA1.is_read));
    const readA = await markRead(cookieA, docBoth);
    check(readA.status === 200, `PUT read → 200 (ได้ ${readA.status})`);
    const aRow = await rowOf(docBoth, clerk, SCHOOL_A);
    const bRow = await rowOf(docBoth, clerk, SCHOOL_B);
    check(aRow && Number(aRow.is_read) === 1, 'แถวของโรงเรียน A = อ่านแล้ว', JSON.stringify(aRow));
    check(bRow && Number(bRow.is_read) === 0, 'แถวของโรงเรียน B ยังเป็นยังไม่อ่าน', JSON.stringify(bRow));

    console.log('');
    console.log('③ เข้าโรงเรียน B → ยังขึ้น "ยังไม่อ่าน" (ไม่เห็นสถานะของ A)');
    const cookieB = await asSchool(clerk, SCHOOL_B);
    const listB1 = await incoming(cookieB);
    const docB1 = listB1.docs.find((d) => Number(d.id) === docBoth);
    check(!!docB1, 'โรงเรียน B เห็นหนังสือฉบับนี้');
    check(docB1 && Number(docB1.is_read) === 0, 'สถานะในรายการของ B = ยังไม่อ่าน',
      JSON.stringify(docB1 && docB1.is_read));

    console.log('');
    console.log('④ อ่านที่โรงเรียน B → เฉพาะแถวของ B (A ยังอ่านแล้วเหมือนเดิม)');
    const readB = await markRead(cookieB, docBoth);
    check(readB.status === 200, `PUT read (B) → 200 (ได้ ${readB.status})`);
    const aRow2 = await rowOf(docBoth, clerk, SCHOOL_A);
    const bRow2 = await rowOf(docBoth, clerk, SCHOOL_B);
    check(bRow2 && Number(bRow2.is_read) === 1, 'แถวของโรงเรียน B = อ่านแล้ว', JSON.stringify(bRow2));
    check(aRow2 && Number(aRow2.is_read) === 1, 'แถวของโรงเรียน A ยังเป็นอ่านแล้ว', JSON.stringify(aRow2));
    const listB2 = await incoming(cookieB);
    const docB2 = listB2.docs.find((d) => Number(d.id) === docBoth);
    check(docB2 && Number(docB2.is_read) === 1, 'รายการของ B แสดงอ่านแล้ว', JSON.stringify(docB2 && docB2.is_read));

    console.log('');
    console.log('⑤ หนังสือที่ส่งถึงโรงเรียน B ต้องไม่โผล่ในรายการของโรงเรียน A');
    const listB3 = await incoming(cookieB);
    check(listB3.docs.some((d) => Number(d.id) === docBOnly), 'โรงเรียน B ยังเห็นหนังสือของตัวเอง');
    const cookieA2 = await asSchool(clerk, SCHOOL_A);
    const listA2 = await incoming(cookieA2);
    check(!listA2.docs.some((d) => Number(d.id) === docBOnly), 'โรงเรียน A ไม่เห็นหนังสือของ B',
      JSON.stringify(listA2.docs.map((d) => d.id)));
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
