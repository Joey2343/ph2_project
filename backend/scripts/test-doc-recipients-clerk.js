'use strict';
/**
 * ทดสอบ "คอลัมน์ผู้รับ" ของหนังสือส่งฝั่ง สพป. (ผู้ใช้สั่ง 11 พ.ย. 2569)
 *
 * กติกา
 *   - ส่งหนังสือถึงสถานศึกษา → แสดง "สถานศึกษาละ 1 คน" = เจ้าหน้าที่สารบัญสถานศึกษา
 *     (บุคลากรคนอื่นของโรงเรียนยังได้รับหนังสือจริง แต่ไม่แสดงในรายการนี้)
 *   - โรงเรียนที่ยังไม่กำหนดเจ้าหน้าที่สารบัญ → แสดง 1 คน พร้อมธง clerk_fallback
 *   - ผู้รับที่ไม่ผูกกับโรงเรียน (เจ้าหน้าที่สำนักงาน) → แสดงครบทุกคนเหมือนเดิม
 *   - เปลี่ยนตัวเจ้าหน้าที่สารบัญ → รายชื่อที่แสดงเปลี่ยนตามคนใหม่
 *
 * ใช้: node scripts/test-doc-recipients-clerk.js
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const SCHOOL_A = '99999981';
const SCHOOL_B = '99999982';
const SCHOOL_C = '99999983';

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

  const mkUser = async (tag, code, group = 'school') => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, position, workplace, role, status,
       user_group, school_code, current_school, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`).run(
      `zzrecip_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ ผู้รับ ${tag}`, 'เจ้าหน้าที่',
      code ? `${code} โรงเรียนทดสอบ` : 'กลุ่มงานทดสอบ', 'staff', 'active',
      group, code || '', code ? `${code} โรงเรียนทดสอบ` : ''
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  try {
    const clerkA1 = await mkUser('clerkA1', SCHOOL_A);
    const clerkA2 = await mkUser('clerkA2', SCHOOL_A);
    const otherA = await mkUser('otherA', SCHOOL_A);
    const otherB1 = await mkUser('otherB1', SCHOOL_B);
    const otherB2 = await mkUser('otherB2', SCHOOL_B);
    const officeGuy = await mkUser('office', '', 'office');

    // เอกสารส่งของ สพป. (ผู้สร้าง = admin)
    const info = await db.prepare(`INSERT INTO documents
      (doc_type, doc_no, title, from_org, to_org, date, created_by, sender_type, school_code, body_text, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,NOW())`).run(
      'outgoing', 'ที่ ทดสอบ/1', 'ทดสอบผู้รับสถานศึกษาละ 1 คน', 'สพป.แพร่ เขต 2',
      'ทุกโรงเรียน', '2026-11-11', 1, 'office', '', 'เนื้อหา'
    );
    const docId = Number(info.insertId);
    madeDocs.push(docId);

    const ins = db.prepare('INSERT INTO document_recipients (document_id, user_id, as_school) VALUES (?,?,?)');
    // โรงเรียน A: 3 คน (ยังไม่กำหนดclerks)
    for (const uid of [clerkA1, clerkA2, otherA]) await ins.run(docId, uid, SCHOOL_A);
    // โรงเรียน B: 2 คน (ยังไม่กำหนดclerks)
    for (const uid of [otherB1, otherB2]) await ins.run(docId, uid, SCHOOL_B);
    // ผู้รับฝั่งสำนักงาน (ไม่ผูกโรงเรียน)
    await ins.run(docId, officeGuy, null);
    // โรงเรียนปลายทางที่ยังไม่มีบัญชีผู้ใช้เลย (มีแต่เป้าหมายใน document_school_targets)
    await db.prepare('INSERT INTO document_school_targets (document_id, school_code) VALUES (?,?)')
      .run(docId, SCHOOL_C);
    await db.prepare('INSERT INTO document_school_targets (document_id, school_code) VALUES (?,?)')
      .run(docId, SCHOOL_A);

    // กำหนด clerkA1 เป็นเจ้าหน้าที่สารบัญของโรงเรียน A (ผ่าน API ของ admin)
    const adminCookie = 'sid=' + (await auth.newSession(1));
    const assign = await fetch(BASE + '/api/document-staff/school', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ school_code: SCHOOL_A, userIds: [clerkA1] }),
    });
    check(assign.status === 200, `POST /document-staff/school → 200 (ได้ ${assign.status})`);

    const getRecips = async () => {
      const res = await fetch(BASE + '/api/document-recipients/' + docId, { headers: { Cookie: adminCookie } });
      const j = await res.json().catch(() => ({}));
      return { status: res.status, body: j, ids: (j.recipients || []).map((r) => Number(r.user_id)) };
    };

    console.log('');
    console.log('① โรงเรียนที่มีเจ้าหน้าที่สารบัญ → แสดงเฉพาะคนนั้น');
    const r1 = await getRecips();
    check(r1.status === 200, `GET /document-recipients/:id → 200 (ได้ ${r1.status})`);
    check(r1.ids.includes(clerkA1), 'มีชื่อเจ้าหน้าที่สารบัญของโรงเรียน A', JSON.stringify(r1.ids));
    check(!r1.ids.includes(clerkA2) && !r1.ids.includes(otherA),
      'ไม่แสดงบุคลากรคนอื่นของโรงเรียน A', JSON.stringify(r1.ids));

    console.log('');
    console.log('② โรงเรียนที่ยังไม่กำหนดเจ้าหน้าที่สารบัญ → แสดง 1 คน + ธง clerk_fallback');
    const bRows = (r1.body.recipients || []).filter((r) => String(r.as_school) === SCHOOL_B);
    check(bRows.length === 1, `โรงเรียน B แสดง 1 คน (ได้ ${bRows.length})`, JSON.stringify(bRows.map((r) => r.user_id)));
    check(!!(bRows[0] && Number(bRows[0].clerk_fallback) === 1), 'แถวนั้นมี clerk_fallback = 1',
      JSON.stringify(bRows[0] && bRows[0].clerk_fallback));

    console.log('');
    console.log('③ ผู้รับฝั่งสำนักงาน (ไม่ผูกโรงเรียน) → แสดงครบทุกคน');
    check(r1.ids.includes(officeGuy), 'ยังแสดงผู้รับฝั่งสำนักงาน', JSON.stringify(r1.ids));

    console.log('');
    console.log('④ ตัวเลข total / hidden ตรงกับของจริง');
    check(Number(r1.body.total) === 6, `total = 6 แถวผู้รับจริง (ได้ ${r1.body.total})`);
    check((r1.body.recipients || []).length === 4,
      `แสดง 4 แถว (A 1 · B 1 · สำนักงาน 1 · โรงเรียนที่ไม่มีผู้ใช้ 1) — ได้ ${(r1.body.recipients || []).length}`);
    check(Number(r1.body.hidden) === 3, `hidden = 3 (ได้ ${r1.body.hidden})`);

    console.log('');
    console.log('⑤ โรงเรียนปลายทางที่ไม่มีบัญชีผู้ใช้ → มีแถวแทน (ไม่ขาดจำนวนโรงเรียน)');
    const cRow = (r1.body.recipients || []).find((r) => String(r.as_school) === SCHOOL_C);
    check(!!cRow, 'มีแถวของโรงเรียน C', JSON.stringify((r1.body.recipients || []).map((r) => r.as_school)));
    check(!!(cRow && Number(cRow.no_user) === 1), 'แถวนั้นมีธง no_user = 1', JSON.stringify(cRow && cRow.no_user));

    console.log('');
    console.log('⑥ เปลี่ยนตัวเจ้าหน้าที่สารบัญ → รายชื่อที่แสดงเปลี่ยนตามคนใหม่');
    const assign2 = await fetch(BASE + '/api/document-staff/school', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ school_code: SCHOOL_A, userIds: [clerkA2] }),
    });
    check(assign2.status === 200, `กำหนดเจ้าหน้าที่สารบัญคนใหม่ → 200 (ได้ ${assign2.status})`);
    const r2 = await getRecips();
    check(r2.ids.includes(clerkA2) && !r2.ids.includes(clerkA1),
      'แสดงคนใหม่ ไม่แสดงคนเก่า', JSON.stringify(r2.ids));
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
