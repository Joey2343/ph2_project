'use strict';
/**
 * ทดสอบ "งานหนังสือราชการของสำนักงานเขต" ต้องเป็นของ **สำนักงาน** ไม่ใช่ของบัญชีผู้ใช้
 *
 * ทำไมต้องมี
 * ──────────
 * ผู้ใช้แจ้ง: สพป. 54020000 มีเจ้าหน้าที่สารบัญเขตคนหนึ่ง ทำงานไว้หลายรายการ
 * แล้วบัญชีนั้นถูกลบออกจากระบบ และเพิ่มเจ้าหน้าที่สารบัญเขตคนใหม่แทน
 * → คนใหม่ต้องเห็นรายการเดิมทั้งหมดตั้งแต่แรก
 *   (หนังสือรับ · หนังสือส่ง · ทะเบียนหนังสือส่ง · ทะเบียนหนังสือรับ)
 *
 * บั๊กที่เจอ
 *  ① แท็บ "▲ หนังสือส่ง" (`GET /documents?doc_type=outgoing`) กรอง `d.created_by = ตัวเอง`
 *     → หนังสือที่คนเก่าส่งไว้หายหมดจากสายตาคนใหม่
 *  ② หนังสือรับ (`/my-incoming`) ผูกกับ `document_recipients.user_id`
 *     ซึ่งเป็น `ON DELETE CASCADE` → ต้อง sync ผู้รับย้อนหลังตอนเพิ่มสารบัญคนใหม่
 *     (มีอยู่แล้วใน `POST /document-staff/office` — เทสต์นี้กันไม่ให้หลุด)
 *
 * สิ่งที่ต้องผ่าน
 *  ① เจ้าหน้าที่สารบัญเขตคนใหม่เห็น "หนังสือรับ" ที่โรงเรียนส่งมาก่อนหน้า
 *  ② เห็น "หนังสือส่ง" ที่คนเก่าส่งไว้ + ที่เจ้าหน้าที่คนอื่นในสำนักงานส่งไว้
 *  ③ เห็น "ทะเบียนหนังสือส่ง" ที่คนเก่าลงทะเบียนไว้
 *  ④ เห็น "ทะเบียนหนังสือรับ" ที่คนเก่าลงทะเบียนไว้
 *  ⑤ เจ้าหน้าที่ทั่วไป (ไม่ใช่สารบัญเขต) ยังเห็นหนังสือส่งเฉพาะของตัวเอง
 *  ⑥ หนังสือของโรงเรียนต้องไม่หลุดมาอยู่ในรายการของสำนักงานเขต
 *
 * ใช้: node scripts/test-office-doc-handover.js
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const ADMIN_USER = process.env.TEST_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.TEST_ADMIN_PASS || 'Joey2343**';

// รหัสโรงเรียนสมมติ — ห้ามใช้รหัสจริง
const SCHOOL = '99999998';
const SCHOOL_NAME = SCHOOL + ' โรงเรียนทดสอบสารบัญเขต';

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
}

async function login(user, pw) {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pw }),
  });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

const jget = async (p, cookie) => {
  const res = await fetch(BASE + p, { headers: { Cookie: cookie } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const jpostJson = async (p, cookie, body) => {
  const res = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

/** สร้างเซสชันให้ผู้ใช้ที่ id กำหนด โดยไม่ต้องรู้รหัสผ่าน */
async function loginAs(userId) {
  try {
    const token = await auth.newSession(userId);
    return 'sid=' + token;
  } catch (e) {
    console.log(`  – สร้างเซสชันให้ user ${userId} ไม่สำเร็จ: ${e.message}`);
    return '';
  }
}

(async () => {
  console.log('');
  console.log('เชื่อมต่อเซิร์ฟเวอร์');
  let admin = '';
  try {
    admin = await login(ADMIN_USER, ADMIN_PASS);
  } catch (e) {
    console.log(`  – ข้าม: ติดต่อ ${BASE} ไม่ได้ (${e.message})`);
    console.log('');
    console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    process.exit(fail ? 1 : 0);
  }
  if (!admin) {
    console.log('  – ข้าม: ล็อกอินไม่สำเร็จ');
    console.log('');
    console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    process.exit(fail ? 1 : 0);
  }

  const db = require(path.join(__dirname, '..', 'db.js'));
  await db.init();

  const madeUsers = [];
  const madeDocs = [];
  const hash = await auth.hashPassword('Test1234**');

  const mkUser = async (username, fields) => {
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, position, workplace, role, status,
       user_group, school_code, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      username, hash, 'นาย', 'ทดสอบ ' + username, 'เจ้าหน้าที่', fields.workplace || '',
      'staff', 'active', fields.user_group || 'office', fields.school_code || '',
      '2026-10-25 09:00:00', '2026-10-25 09:00:00'
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  const mkDoc = async (fields) => {
    const info = await db.prepare(`INSERT INTO documents
      (doc_type, doc_no, title, from_org, to_org, date, created_by, sender_type,
       school_code, is_registered, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      fields.doc_type || 'outgoing', fields.doc_no || '', fields.title,
      fields.from_org || '', fields.to_org || '', fields.date || '2026-10-25',
      fields.created_by, fields.sender_type == null ? '' : fields.sender_type,
      fields.school_code == null ? '' : fields.school_code,
      fields.is_registered == null ? 0 : fields.is_registered,
      '2026-10-25 09:00:00'
    );
    const id = Number(info.insertId);
    madeDocs.push(id);
    return id;
  };

  const docIds = (res) => ((res.body && res.body.documents) || []).map((d) => Number(d.id));

  try {
    /* ── ① เตรียมบัญชี: A = สารบัญเขตคนก่อน, B = คนใหม่, C = เจ้าหน้าที่ทั่วไป ── */
    console.log('');
    console.log('① เตรียมบัญชีเจ้าหน้าที่สารบัญเขตคนก่อน + คนใหม่ + เจ้าหน้าที่ทั่วไป');
    const userA = await mkUser('__t_off_a', { workplace: 'กลุ่มทดสอบสำนักงานเขต' });
    const userB = await mkUser('__t_off_b', { workplace: 'กลุ่มทดสอบสำนักงานเขต' });
    const userC = await mkUser('__t_off_c', { workplace: 'กลุ่มทดสอบสำนักงานเขต' });
    const schoolUser = await mkUser('__t_off_s', {
      user_group: 'school', school_code: SCHOOL, workplace: SCHOOL_NAME,
    });
    check(!!userA && !!userB && !!userC && !!schoolUser,
      `สร้างบัญชีทดสอบได้ (A=${userA}, B=${userB}, C=${userC}, school=${schoolUser})`);

    await db.prepare("INSERT INTO document_staff (staff_type, user_id) VALUES ('office', ?)").run(userA);

    // หนังสือที่โรงเรียนส่งมาสำนักงานเขต (ยังไม่มีผู้รับ — จะ sync ตอนเพิ่มสารบัญคนใหม่)
    const docIn = await mkDoc({
      title: 'ทดสอบหนังสือรับของสำนักงานเขต (โรงเรียนส่งมา)',
      doc_no: 'ที่ ศธ 04110.9/1', from_org: SCHOOL_NAME, to_org: 'สพป.แพร่ เขต 2',
      created_by: schoolUser, sender_type: 'school', school_code: SCHOOL, is_registered: 1,
    });
    // หนังสือส่งที่ A (สารบัญเขตคนก่อน) ส่งไว้
    const docOut = await mkDoc({
      title: 'ทดสอบหนังสือส่งของสำนักงานเขต (A ส่งไว้)',
      doc_no: 'ที่ ศธ 04110/11', from_org: 'สพป.แพร่ เขต 2', to_org: 'กลุ่มทดสอบปลายทาง',
      created_by: userA, sender_type: 'office', school_code: '',
    });
    // หนังสือส่งที่เจ้าหน้าที่ทั่วไป (C) สร้างไว้
    const docCOut = await mkDoc({
      title: 'ทดสอบหนังสือส่งของเจ้าหน้าที่ทั่วไป (C สร้าง)',
      doc_no: 'ที่ ศธ 04110/12', from_org: 'สพป.แพร่ เขต 2', to_org: 'กลุ่มทดสอบปลายทาง',
      created_by: userC, sender_type: 'office', school_code: '',
    });
    // ทะเบียนหนังสือส่งที่ A ลงทะเบียนไว้
    const docReg = await mkDoc({
      title: 'ทดสอบทะเบียนหนังสือส่ง (A ลงทะเบียน)',
      doc_no: 'ที่ ศธ 04110/13', from_org: 'สพป.แพร่ เขต 2', to_org: 'กลุ่มทดสอบปลายทาง',
      created_by: userA, sender_type: 'registered', school_code: '', is_registered: 1,
    });
    // ทะเบียนหนังสือรับที่ A ลงทะเบียนไว้
    const docInReg = await mkDoc({
      title: 'ทดสอบทะเบียนหนังสือรับ (A ลงทะเบียน)',
      doc_no: 'ที่ รับ 1/2569', from_org: 'หน่วยงานภายนอก', to_org: 'สพป.แพร่ เขต 2',
      doc_type: 'incoming', created_by: userA, sender_type: 'office',
      school_code: '', is_registered: 1,
    });
    check(docIn && docOut && docCOut && docReg && docInReg,
      `สร้างหนังสือทดสอบได้ (${[docIn, docOut, docCOut, docReg, docInReg].join(', ')})`);

    /* ── ② ลบสารบัญเขตคนก่อนออกจากระบบ แล้วเพิ่มคนใหม่ ────────────── */
    console.log('');
    console.log('② ลบเจ้าหน้าที่สารบัญเขตคนก่อน แล้วเพิ่มคนใหม่แทน');
    await db.prepare('DELETE FROM users WHERE id = ?').run(userA);
    const still = await db.prepare('SELECT COUNT(*) c FROM documents WHERE id IN (?,?,?,?)')
      .get(docIn, docOut, docReg, docInReg);
    check(Number(still.c) === 4, 'ลบบัญชีแล้วหนังสือในระบบยังอยู่ครบ',
      `เหลือ ${still.c} ฉบับ (ควรได้ 4)`);

    const addStaff = await jpostJson('/api/document-staff/office', admin, { userIds: [userB] });
    check(addStaff.status === 200, `เพิ่มเจ้าหน้าที่สารบัญเขตคนใหม่ได้ (HTTP ${addStaff.status})`,
      JSON.stringify(addStaff.body));

    const cookieB = await loginAs(userB);
    if (!cookieB) {
      check(false, 'สร้างเซสชันให้บัญชีใหม่ได้');
    } else {
      /* ── ③ หนังสือรับ ─────────────────────────────────────────── */
      console.log('');
      console.log('③ เจ้าหน้าที่สารบัญเขตคนใหม่เห็น "หนังสือรับ" ที่โรงเรียนส่งมาก่อนหน้า');
      const rIn = await jget('/api/my-incoming', cookieB);
      check(docIds(rIn).includes(docIn), 'เห็นหนังสือที่โรงเรียนส่งมาก่อนหน้าตัวเอง',
        `ได้ id: ${docIds(rIn).join(',')} · ต้องมี ${docIn}`);

      /* ── ④ หนังสือส่ง ─────────────────────────────────────────── */
      console.log('');
      console.log('④ เจ้าหน้าที่สารบัญเขตคนใหม่เห็น "หนังสือส่ง" ของสำนักงานเขตทั้งหมด');
      const rOut = await jget('/api/documents?doc_type=outgoing', cookieB);
      const outIds = docIds(rOut);
      check(outIds.includes(docOut), 'เห็นหนังสือส่งที่เจ้าหน้าที่คนก่อนส่งไว้',
        `ได้ id: ${outIds.join(',')} · ต้องมี ${docOut}`);
      check(outIds.includes(docCOut), 'เห็นหนังสือส่งที่เจ้าหน้าที่คนอื่นในสำนักงานสร้าง',
        `ได้ id: ${outIds.join(',')} · ต้องมี ${docCOut}`);
      check(!outIds.includes(docIn), 'ไม่เห็นหนังสือของโรงเรียนในแท็บหนังสือส่งของสำนักงานเขต',
        `ได้ id: ${outIds.join(',')} · ต้องไม่มี ${docIn}`);
      check(!outIds.includes(docReg), 'ไม่เห็นรายการที่ลงทะเบียนแล้วในแท็บหนังสือส่ง (แยกกับทะเบียน)',
        `ได้ id: ${outIds.join(',')} · ต้องไม่มี ${docReg}`);

      /* ── ⑤ ทะเบียนหนังสือส่ง ─────────────────────────────────── */
      console.log('');
      console.log('⑤ เจ้าหน้าที่สารบัญเขตคนใหม่เห็น "ทะเบียนหนังสือส่ง" ที่คนเก่าลงทะเบียนไว้');
      const rReg = await jget('/api/my-outgoing-registered', cookieB);
      check(docIds(rReg).includes(docReg), 'เห็นรายการทะเบียนหนังสือส่งของคนก่อน',
        `ได้ id: ${docIds(rReg).join(',')} · ต้องมี ${docReg}`);

      /* ── ⑥ ทะเบียนหนังสือรับ ─────────────────────────────────── */
      console.log('');
      console.log('⑥ เจ้าหน้าที่สารบัญเขตคนใหม่เห็น "ทะเบียนหนังสือรับ" ที่คนเก่าลงทะเบียนไว้');
      const rInReg = await jget('/api/my-incoming-registered', cookieB);
      const inRegIds = docIds(rInReg);
      check(inRegIds.includes(docInReg), 'เห็นรายการทะเบียนหนังสือรับของคนก่อน',
        `ได้ id: ${inRegIds.join(',')} · ต้องมี ${docInReg}`);
      check(inRegIds.includes(docIn), 'เห็นหนังสือที่โรงเรียนส่งมาอยู่ในทะเบียนหนังสือรับ',
        `ได้ id: ${inRegIds.join(',')} · ต้องมี ${docIn}`);
    }

    /* ── ⑦ เจ้าหน้าที่ทั่วไปยังเห็นเฉพาะหนังสือส่งของตัวเอง ────────── */
    console.log('');
    console.log('⑦ เจ้าหน้าที่ทั่วไป (ไม่ใช่สารบัญเขต) เห็นหนังสือส่งเฉพาะของตัวเอง');
    const cookieC = await loginAs(userC);
    if (!cookieC) {
      check(false, 'สร้างเซสชันให้เจ้าหน้าที่ทั่วไปได้');
    } else {
      const rC = await jget('/api/documents?doc_type=outgoing', cookieC);
      const cIds = docIds(rC);
      check(cIds.includes(docCOut), 'เห็นหนังสือส่งของตัวเอง',
        `ได้ id: ${cIds.join(',')} · ต้องมี ${docCOut}`);
      check(!cIds.includes(docOut), 'ไม่เห็นหนังสือส่งของเจ้าหน้าที่คนอื่น',
        `ได้ id: ${cIds.join(',')} · ต้องไม่มี ${docOut}`);
    }
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    /* ── เก็บกวาด: ลบทุกอย่างที่เทสต์สร้าง ─────────────────────────── */
    try {
      for (const id of madeDocs) {
        await db.prepare('DELETE FROM document_recipients WHERE document_id = ?').run(id);
        await db.prepare('DELETE FROM document_school_targets WHERE document_id = ?').run(id);
        await db.prepare('DELETE FROM documents WHERE id = ?').run(id);
      }
      /*
       * ⚠️ document_staff ไม่มี FK ไป users → ลบ user แล้วแถวเจ้าหน้าที่ค้างเป็นขยะ
       *    ต้องลบด้วย user_id ที่เก็บไว้ (ไม่ใช่ subquery จาก users ที่อาจถูกลบไปแล้ว)
       */
      for (const id of madeUsers) {
        await db.prepare('DELETE FROM document_staff WHERE user_id = ?').run(id);
        await db.prepare('DELETE FROM document_recipients WHERE user_id = ?').run(id);
        await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id).catch(() => {});
        await db.prepare('DELETE FROM users WHERE id = ?').run(id);
      }
    } catch (e) {
      console.log('  – เก็บกวาดไม่สำเร็จ: ' + e.message);
    }
    console.log('');
    console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    process.exit(fail ? 1 : 0);
  }
})();
