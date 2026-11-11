'use strict';
/**
 * ทดสอบ "เจ้าหน้าที่สารบัญสถานศึกษาดูหนังสือแล้ว → คนอื่นในโรงเรียนเดียวกันเป็นอ่านแล้วด้วย"
 * (ผู้ใช้สั่ง 11 พ.ย. 2569)
 *
 * กติกา
 *   · เจ้าหน้าที่สารบัญเปิดดู → ทุกคนในโรงเรียนเดียวกันเห็น "อ่านแล้ว"
 *     (แม้ไม่มีแถวผู้รับของตัวเอง และแถวเดิมของคนอื่นก็ถูกทำเครื่องหมายว่าอ่านแล้ว)
 *   · บุคลากรคนอื่นกดเอง → ไม่เปลี่ยนสถานะของใคร (ทั้งของตัวเองและของโรงเรียน)
 *   · โรงเรียนอื่นต้องไม่กระทบ
 *
 * ใช้: node scripts/test-school-clerk-read-all.js
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const SCHOOL_A = '99999951';
const SCHOOL_B = '99999952';

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
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `zzreadall_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ อ่านทั้งโรงเรียน ${tag}`, 'เจ้าหน้าที่',
      `${code} โรงเรียนทดสอบ`, 'staff', 'active', 'school', code, `${code} โรงเรียนทดสอบ`,
      '2026-10-01 09:00:00', '2026-10-01 09:00:00'
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  const mkDoc = async (title) => {
    const info = await db.prepare(`INSERT INTO documents
      (doc_type, doc_no, title, from_org, to_org, date, created_by, sender_type, school_code, body_text, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,NOW())`).run(
      'incoming', '', title, 'สพป.แพร่ เขต 2', 'ส่งทุกโรงเรียน', '2026-11-11', 1, 'office', '', 'เนื้อหา'
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

  const incoming = async (cookie) => {
    const res = await fetch(BASE + '/api/my-incoming', { headers: { Cookie: cookie } });
    const j = await res.json().catch(() => ({}));
    return j.documents || [];
  };

  const readRow = async (cookie, docId) => {
    const res = await fetch(BASE + '/api/document-recipients/' + docId + '/read', {
      method: 'PUT',
      headers: { Cookie: cookie },
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  const isReadOf = async (cookie, docId) => {
    const docs = await incoming(cookie);
    const d = docs.find((x) => Number(x.id) === docId);
    return d ? Number(d.is_read) : null;
  };

  try {
    const clerk = await mkUser('clerk', SCHOOL_A);
    const plain1 = await mkUser('plain1', SCHOOL_A);
    const plain2 = await mkUser('plain2', SCHOOL_A);
    const outsider = await mkUser('outsider', SCHOOL_B);
    const adminCookie = 'sid=' + (await auth.newSession(1));

    // กำหนดเจ้าหน้าที่สารบัญของโรงเรียน A และ B
    const assignSchool = async (code, uid) => fetch(BASE + '/api/document-staff/school', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ school_code: code, userIds: [uid] }),
    }).then((r) => r.status);
    check(await assignSchool(SCHOOL_A, clerk) === 200, 'กำหนดเจ้าหน้าที่สารบัญโรงเรียน A สำเร็จ');
    check(await assignSchool(SCHOOL_B, outsider) === 200, 'กำหนดเจ้าหน้าที่สารบัญโรงเรียน B สำเร็จ');

    const docA = await mkDoc('หนังสือถึงโรงเรียน A');
    await db.prepare('INSERT INTO document_school_targets (document_id, school_code) VALUES (?,?)').run(docA, SCHOOL_A);
    // ให้มีแถวผู้รับของบุคลากรคนหนึ่งก่อน (กรณีโรงเรียนมีผู้รับรายคนอยู่แล้ว)
    await db.prepare('INSERT INTO document_recipients (document_id, user_id, as_school) VALUES (?,?,?)')
      .run(docA, plain1, SCHOOL_A);

    const docB = await mkDoc('หนังสือถึงโรงเรียน B');
    await db.prepare('INSERT INTO document_school_targets (document_id, school_code) VALUES (?,?)').run(docB, SCHOOL_B);

    const cookieClerk = await asSchool(clerk, SCHOOL_A);
    const cookieP1 = await asSchool(plain1, SCHOOL_A);
    const cookieP2 = await asSchool(plain2, SCHOOL_A);
    const cookieOut = await asSchool(outsider, SCHOOL_B);

    console.log('');
    console.log('① เริ่มต้น: ทุกคนในโรงเรียน A เห็น "ยังไม่อ่าน"');
    check(await isReadOf(cookieClerk, docA) === 0, 'เจ้าหน้าที่สารบัญ: ยังไม่อ่าน');
    check(await isReadOf(cookieP1, docA) === 0, 'บุคลากรคนที่ 1: ยังไม่อ่าน');
    check(await isReadOf(cookieP2, docA) === 0, 'บุคลากรคนที่ 2 (ไม่มีแถวผู้รับ): ยังไม่อ่าน');

    console.log('');
    console.log('② บุคลากรที่ไม่ใช่เจ้าหน้าที่สารบัญกดอ่าน → สถานะไม่เปลี่ยน');
    const pRead = await readRow(cookieP1, docA);
    check(pRead.status === 200, `PUT read → 200 (ได้ ${pRead.status})`);
    check(Number((pRead.body.row || {}).is_read) !== 1, 'เซิร์ฟเวอร์ไม่ทำเครื่องหมายว่าอ่านแล้ว',
      JSON.stringify(pRead.body && pRead.body.row));
    check(await isReadOf(cookieClerk, docA) === 0, 'เจ้าหน้าที่สารบัญยังเห็น "ยังไม่อ่าน"');
    check(await isReadOf(cookieP2, docA) === 0, 'บุคลากรคนที่ 2 ยังเห็น "ยังไม่อ่าน"');

    console.log('');
    console.log('③ เจ้าหน้าที่สารบัญเปิดดู → ทุกคนในโรงเรียน A เป็น "อ่านแล้ว"');
    const cRead = await readRow(cookieClerk, docA);
    check(cRead.status === 200, `PUT read (สารบัญ) → 200 (ได้ ${cRead.status})`);
    check(await isReadOf(cookieClerk, docA) === 1, 'เจ้าหน้าที่สารบัญ: อ่านแล้ว');
    check(await isReadOf(cookieP1, docA) === 1, 'บุคลากรคนที่ 1: อ่านแล้ว');
    check(await isReadOf(cookieP2, docA) === 1, 'บุคลากรคนที่ 2 (ไม่มีแถวผู้รับ): อ่านแล้ว');
    const rowP1 = await db
      .prepare('SELECT is_read FROM document_recipients WHERE document_id = ? AND user_id = ? AND as_school = ?')
      .get(docA, plain1, SCHOOL_A);
    check(rowP1 && Number(rowP1.is_read) === 1, 'แถวผู้รับเดิมของบุคลากรคนที่ 1 ถูกทำเครื่องหมายด้วย',
      JSON.stringify(rowP1));

    console.log('');
    console.log('④ โรงเรียนอื่นไม่กระทบ');
    check(await isReadOf(cookieOut, docB) === 0, 'โรงเรียน B: หนังสือของตัวเองยังไม่อ่าน');
    const outDocs = await incoming(cookieOut);
    check(!outDocs.some((d) => Number(d.id) === docA), 'โรงเรียน B ไม่เห็นหนังสือของโรงเรียน A');

    console.log('');
    console.log('⑤ โรงเรียน B ยังอ่านแยกของตัวเอง');
    const bRead = await readRow(cookieOut, docB);
    check(bRead.status === 200, `PUT read (โรงเรียน B) → 200 (ได้ ${bRead.status})`);
    check(await isReadOf(cookieOut, docB) === 1, 'โรงเรียน B: อ่านแล้ว');
    check(await isReadOf(cookieClerk, docA) === 1, 'โรงเรียน A ยังเป็นอ่านแล้ว (ไม่ถูกแก้กลับ)');
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
