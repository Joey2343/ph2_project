'use strict';
/**
 * ทดสอบ "เลขหนังสือสถานศึกษาเป็นค่าเดียวกันทั้งโรงเรียน" (ผู้ใช้สั่ง 26 พ.ย. 2569)
 *
 * ปัญหาเดิม
 * ──────────
 * กำหนดเลขหนังสือสถานศึกษาได้จากเจ้าหน้าที่สารบัญสถานศึกษาเท่านั้น
 * แต่ GET /document-staff/school-prefix ตอบค่าว่างให้ "คนที่ไม่ใช่สารบัญ"
 * → ผู้ใช้คนอื่นในโรงเรียนเดียวกันลงทะเบียนหนังสือส่ง แล้วได้เลขคนละชุด (ไม่มีเลขนำหน้า)
 *
 * กติกาที่ต้องผ่าน
 *   ① เจ้าหน้าที่สารบัญกำหนดเลข → ผู้ใช้ทุกคนของโรงเรียนนั้นอ่านได้ค่าเดียวกัน
 *   ② โรงเรียนอื่นต้องไม่เห็นเลขของโรงเรียนนี้
 *   ③ ผู้ใช้ทั่วไปแก้ไขเลขเองไม่ได้ (403)
 *   ④ เจ้าหน้าที่สารบัญเปลี่ยนเลข → ผู้ใช้ทุกคนเห็นค่าใหม่ทันที
 *
 * ใช้: node scripts/test-school-prefix-shared.js
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
// รหัสโรงเรียนสมมติ (ไม่ชนกับโรงเรียนจริงในฐาน)
const SCHOOL_A = '99000001';
const SCHOOL_B = '99000002';

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
}

const jget = async (p, cookie) => {
  const res = await fetch(BASE + p, { headers: { Cookie: cookie } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
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
  const madeStaff = [];

  const mkUser = async (tag, schoolCode, role = 'teacher') => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, first_name, last_name, position, workplace, role, status,
       user_group, school_code, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `zzprefix_${tag}_${Date.now()}`, hash, 'นาง', `ทดสอบ เลขหนังสือ ${tag}`, 'ทดสอบ', `เลขหนังสือ ${tag}`,
      'ครู', `${schoolCode} โรงเรียนทดสอบเลขหนังสือ`, role, 'active', 'school', schoolCode,
      '2026-10-01 09:00:00', '2026-10-01 09:00:00'
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  const mkClerk = async (userId, schoolCode) => {
    const info = await db.prepare("INSERT INTO document_staff (staff_type, user_id, school_code) VALUES ('school', ?, ?)")
      .run(userId, schoolCode);
    madeStaff.push(Number(info.insertId));
  };

  try {
    const clerk = await mkUser('clerk', SCHOOL_A, 'school_clerk');
    const teacherA1 = await mkUser('a1', SCHOOL_A);
    const teacherA2 = await mkUser('a2', SCHOOL_A, 'school_director');
    const teacherB = await mkUser('b1', SCHOOL_B);
    await mkClerk(clerk, SCHOOL_A);
    // เริ่มจากค่าว่างทั้ง 2 โรงเรียน
    await db.prepare('DELETE FROM school_doc_prefix WHERE school_code IN (?, ?)').run(SCHOOL_A, SCHOOL_B);

    const cClerk = 'sid=' + (await auth.newSession(clerk));
    const cA1 = 'sid=' + (await auth.newSession(teacherA1));
    const cA2 = 'sid=' + (await auth.newSession(teacherA2));
    const cB = 'sid=' + (await auth.newSession(teacherB));

    console.log('');
    console.log('① เจ้าหน้าที่สารบัญกำหนดเลขหนังสือของโรงเรียน');
    const set = await jput('/api/document-staff/school-prefix', cClerk, { doc_prefix: '0001' });
    check(set.status === 200 && set.body && set.body.doc_prefix === '0001',
      `PUT (สารบัญ) → 200 และได้ 0001 (HTTP ${set.status})`, JSON.stringify(set.body));

    console.log('');
    console.log('② ผู้ใช้ทุกคนของโรงเรียนเดียวกันอ่านได้ค่าเดียวกัน');
    for (const [label, cookie] of [['สารบัญ', cClerk], ['ครูคนที่ 1', cA1], ['ผอ.สถานศึกษา', cA2]]) {
      const r = await jget('/api/document-staff/school-prefix', cookie);
      check(r.status === 200 && r.body && r.body.doc_prefix === '0001' && r.body.school_code === SCHOOL_A,
        `${label}: ได้เลข 0001 ของโรงเรียน ${SCHOOL_A}`, JSON.stringify(r.body));
    }

    console.log('');
    console.log('③ โรงเรียนอื่นต้องไม่เห็นเลขของโรงเรียนนี้');
    const rB = await jget('/api/document-staff/school-prefix', cB);
    check(rB.status === 200 && rB.body && rB.body.doc_prefix !== '0001' && rB.body.school_code === SCHOOL_B,
      'โรงเรียน B ไม่เห็นเลขของโรงเรียน A', JSON.stringify(rB.body));

    console.log('');
    console.log('④ ผู้ใช้ทั่วไปแก้ไขเลขเองไม่ได้');
    const putA1 = await jput('/api/document-staff/school-prefix', cA1, { doc_prefix: '9999' });
    check(putA1.status === 403, `PUT (ครูที่ไม่ใช่สารบัญ) → 403 (ได้ ${putA1.status})`, JSON.stringify(putA1.body));
    const afterAttempt = await jget('/api/document-staff/school-prefix', cClerk);
    check(afterAttempt.body && afterAttempt.body.doc_prefix === '0001', 'เลขไม่ถูกแก้',
      JSON.stringify(afterAttempt.body));

    console.log('');
    console.log('⑤ เจ้าหน้าที่สารบัญเปลี่ยนเลข → ทุกคนเห็นค่าใหม่');
    const set2 = await jput('/api/document-staff/school-prefix', cClerk, { doc_prefix: '0042' });
    check(set2.status === 200, `PUT ใหม่ → 200 (ได้ ${set2.status})`, JSON.stringify(set2.body));
    const r1 = await jget('/api/document-staff/school-prefix', cA1);
    const r2 = await jget('/api/document-staff/school-prefix', cA2);
    check(r1.body && r1.body.doc_prefix === '0042' && r2.body && r2.body.doc_prefix === '0042',
      'ทั้ง 2 บัญชีเห็นเลขใหม่ 0042', JSON.stringify({ a1: r1.body, a2: r2.body }));
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    try {
      for (const id of madeStaff) {
        try { await db.prepare('DELETE FROM document_staff WHERE id = ?').run(id); } catch (e) { /* ignore */ }
      }
      for (const id of madeUsers) {
        try { await db.prepare('DELETE FROM document_staff WHERE user_id = ?').run(id); } catch (e) { /* ignore */ }
        try { await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); } catch (e) { /* ignore */ }
        try { await db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch (e) { /* ignore */ }
      }
      await db.prepare('DELETE FROM school_doc_prefix WHERE school_code IN (?, ?)').run(SCHOOL_A, SCHOOL_B);
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
