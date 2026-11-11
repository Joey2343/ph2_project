'use strict';
/**
 * ทดสอบ "หนังสือรับของสถานศึกษา" — เห็นหนังสือที่ส่งถึงโรงเรียน แม้ไม่ได้เป็นผู้รับรายคน
 *
 * ผู้ใช้แจ้ง 11 พ.ย. 2569
 * ─────────────────────
 * สพป. ส่งหนังสือถึงโรงเรียน 54020001 แต่หน้า "หนังสือรับ" ของโรงเรียนไม่แสดง
 * เพราะผู้รับถูกบันทึกให้บัญชีเดียวของโรงเรียน (เจ้าหน้าที่สารบัญ/ผอ.)
 * บัญชีอื่นของโรงเรียนเดียวกันจึงมองไม่เห็น ทั้งที่เป็นหนังสือของโรงเรียน
 *
 * สิ่งที่ต้องผ่าน
 *   ① บัญชีโรงเรียนที่ไม่ได้เป็นผู้รับรายคน แต่หนังสือถูกส่งถึงโรงเรียน → เห็นใน /my-incoming
 *   ② โรงเรียนอื่นต้องไม่เห็น
 *   ③ บัญชีที่ไม่ใช่เจ้าหน้าที่สารบัญ: เปิดดูแล้วสถานะไม่เปลี่ยน (ไม่สร้างแถวผู้รับ)
 *   ④ เจ้าหน้าที่สารบัญสถานศึกษา: เปิดดูแล้วเปลี่ยนเป็นอ่านแล้ว
 *
 * ใช้: node scripts/test-school-incoming-by-target.js
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const SCHOOL_A = '99999995';
const SCHOOL_B = '99999996';

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
      `zzschoolin_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ โรงเรียน ${tag}`, 'เจ้าหน้าที่',
      `${code} โรงเรียนทดสอบ ${tag}`, 'staff', 'active', 'school', code, `${code} โรงเรียนทดสอบ ${tag}`,
      '2026-10-01 09:00:00', '2026-10-01 09:00:00'
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  try {
    const clerk = await mkUser('clerk', SCHOOL_A);   // ผู้รับรายคน
    const other = await mkUser('other', SCHOOL_A);   // บัญชีอื่นของโรงเรียนเดียวกัน (ไม่ใช่ผู้รับ)
    const outsider = await mkUser('out', SCHOOL_B);  // โรงเรียนอื่น

    const insDoc = await db.prepare(`INSERT INTO documents
      (doc_type, doc_no, title, from_org, to_org, date, created_by, sender_type, school_code, body_text, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      'outgoing', 'ทดสอบ/รับ/1', 'ทดสอบหนังสือถึงโรงเรียน', 'สพป.แพร่ เขต 2', `${SCHOOL_A} โรงเรียนทดสอบ clerk`,
      '2026-11-11', 1, 'office', '', 'เนื้อหา', '2026-11-11 09:00:00'
    );
    const docId = Number(insDoc.insertId);
    madeDocs.push(docId);
    await db.prepare('INSERT INTO document_school_targets (document_id, school_code) VALUES (?,?)').run(docId, SCHOOL_A);
    await db.prepare('INSERT INTO document_recipients (document_id, user_id, as_school) VALUES (?,?,?)')
      .run(docId, clerk, SCHOOL_A);

    const cookieOther = 'sid=' + (await auth.newSession(other));
    const cookieClerk = 'sid=' + (await auth.newSession(clerk));
    const cookieOut = 'sid=' + (await auth.newSession(outsider));

    const jget = async (p, cookie) => {
      const res = await fetch(BASE + p, { headers: { Cookie: cookie } });
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    const ids = (r) => ((r.body && r.body.documents) || []).map((d) => Number(d.id));

    console.log('');
    console.log('① บัญชีอื่นของโรงเรียนเห็นหนังสือที่ส่งถึงโรงเรียน');
    const inc = await jget('/api/my-incoming', cookieOther);
    check(inc.status === 200, `GET /my-incoming → 200 (ได้ ${inc.status})`);
    check(ids(inc).includes(docId), 'เห็นหนังสือที่ส่งถึงโรงเรียน แม้ไม่ได้เป็นผู้รับรายคน',
      `ได้ id: ${ids(inc).join(',')} · ต้องมี ${docId}`);
    const row = ((inc.body && inc.body.documents) || []).find((d) => Number(d.id) === docId);
    check(row && Number(row.is_read) === 0, 'สถานะเริ่มต้น = ยังไม่อ่าน', JSON.stringify(row && row.is_read));

    console.log('');
    console.log('② โรงเรียนอื่นไม่เห็นหนังสือนี้');
    const incOut = await jget('/api/my-incoming', cookieOut);
    check(!ids(incOut).includes(docId), 'โรงเรียนอื่นไม่เห็น', `ได้ id: ${ids(incOut).join(',')}`);

    console.log('');
    console.log('③ บัญชีที่ไม่ใช่เจ้าหน้าที่สารบัญ: เปิดดูแล้วสถานะไม่เปลี่ยน');
    const rd = await fetch(BASE + '/api/document-recipients/' + docId + '/read', {
      method: 'PUT',
      headers: { Cookie: cookieOther },
    });
    const rdBody = await rd.json().catch(() => ({}));
    check(rd.status === 200, `PUT /document-recipients/:id/read → 200 (ได้ ${rd.status})`);
    check(Number(rdBody && rdBody.row && rdBody.row.is_read) !== 1, 'เซิร์ฟเวอร์ไม่ทำเครื่องหมายว่าอ่านแล้ว',
      JSON.stringify(rdBody && rdBody.row));
    const after = await jget('/api/my-incoming', cookieOther);
    const rowAfter = ((after.body && after.body.documents) || []).find((d) => Number(d.id) === docId);
    check(!rowAfter || Number(rowAfter.is_read) !== 1, 'สถานะในรายการยังไม่เป็นอ่านแล้ว',
      JSON.stringify(rowAfter && rowAfter.is_read));
    const own = await db.prepare('SELECT id FROM document_recipients WHERE document_id = ? AND user_id = ?')
      .get(docId, other);
    check(!own, 'ไม่สร้างแถวผู้รับให้บัญชีที่ไม่ใช่เจ้าหน้าที่สารบัญ', JSON.stringify(own));

    console.log('');
    console.log('④ เจ้าหน้าที่สารบัญสถานศึกษา: เปิดดูแล้วเปลี่ยนเป็นอ่านแล้ว');
    await db.prepare("INSERT INTO document_staff (staff_type, user_id, school_code) VALUES ('school', ?, ?)")
      .run(clerk, SCHOOL_A);
    const rdClerk = await fetch(BASE + '/api/document-recipients/' + docId + '/read', {
      method: 'PUT',
      headers: { Cookie: cookieClerk },
    });
    check(rdClerk.status === 200, `เจ้าหน้าที่สารบัญกดอ่าน → 200 (ได้ ${rdClerk.status})`);
    const afterClerk = await jget('/api/my-incoming', cookieClerk);
    const rowClerk = ((afterClerk.body && afterClerk.body.documents) || []).find((d) => Number(d.id) === docId);
    check(rowClerk && Number(rowClerk.is_read) === 1, 'สถานะของเจ้าหน้าที่สารบัญเป็นอ่านแล้ว',
      JSON.stringify(rowClerk && rowClerk.is_read));
    const clerkRow = await db.prepare('SELECT is_read, as_school FROM document_recipients WHERE document_id = ? AND user_id = ?')
      .get(docId, clerk);
    check(clerkRow && Number(clerkRow.is_read) === 1, 'บันทึก is_read = 1 ในฐานข้อมูล',
      JSON.stringify(clerkRow));
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
