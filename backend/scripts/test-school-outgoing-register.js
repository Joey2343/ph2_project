'use strict';
/**
 * ทดสอบ "ทะเบียนหนังสือส่งของสถานศึกษา" ต้องเป็นของ **โรงเรียน** ไม่ใช่ของบัญชีผู้ใช้
 *
 * ทำไมต้องมี
 * ──────────
 * ผู้ใช้แจ้ง: โรงเรียน 54020071 มีเจ้าหน้าที่สารบัญชื่อ "Montana" ลงทะเบียนหนังสือส่งไว้
 * แล้ว Montana ถูกลบออกจากระบบ และเพิ่มบัญชีใหม่ (55555) เป็นเจ้าหน้าที่สารบัญแทน
 * → บัญชีใหม่ต้องเห็นรายการทะเบียนหนังสือส่ง **ทั้งหมดตั้งแต่แรก**
 *
 * บั๊กที่เจอ
 *  ① `school_code` ของบัญชีสถานศึกษาใหม่ถูกดึงด้วย regex ผิด (/^d{8}/ ขาด backslash)
 *     → ได้ '' → ทะเบียนกรองด้วยรหัสโรงเรียนจึงไม่เห็นอะไรเลย
 *  ② หนังสือที่ลงทะเบียนตอน school_code ยังว่าง ก็ถูกบันทึกโดยไม่มีรหัสโรงเรียน
 *     → ไม่มีใครที่มีรหัสถูกต้องเห็นอีกเลย
 *  ③ ผู้ใช้ที่ไม่รู้รหัสโรงเรียนเลย ถูกปล่อยให้กรองด้วย `to_org LIKE '%%'`
 *     → เห็นทะเบียนหนังสือรับของทุกโรงเรียนในประเทศ
 *
 * สิ่งที่ต้องผ่าน
 *  ① หนังสือที่ลงทะเบียนโดยเจ้าหน้าที่คนก่อน ยังอยู่ในทะเบียนหลังลบบัญชีนั้น
 *  ② เจ้าหน้าที่คนใหม่ (school_code ว่าง แต่ workplace ขึ้นต้นด้วยรหัสโรงเรียน) เห็นรายการเดิม
 *  ③ ลงทะเบียนใหม่ → หนังสือต้องได้รหัสโรงเรียนจริง (ไม่ใช่ '')
 *  ④ แถวเก่าที่ไม่มีรหัสโรงเรียนแต่ผู้สร้างเป็นคนของโรงเรียนนี้ → ยังเห็น
 *  ⑤ ทะเบียนของสำนักงานเขต ต้องไม่ปนกับของโรงเรียน (และกลับกัน)
 *  ⑥ เจ้าหน้าที่สารบัญคนใหม่ใช้เลขหนังสือของโรงเรียนได้
 *  ⑦ ผู้ใช้ที่ไม่รู้รหัสโรงเรียน เห็นเฉพาะหนังสือที่ตัวเองเป็นผู้รับ
 *
 * ใช้: node scripts/test-school-outgoing-register.js
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const ADMIN_USER = process.env.TEST_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.TEST_ADMIN_PASS || 'Joey2343**';

// รหัสโรงเรียนสมมติ — ห้ามใช้รหัสจริง เพื่อไม่ให้ไปทับเลขหนังสือของโรงเรียนจริง
const SCHOOL = '99999999';
const WORKPLACE = SCHOOL + ' โรงเรียนทดสอบทะเบียนส่ง';

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
const jput = async (p, cookie, body) => {
  const res = await fetch(BASE + p, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const jpostForm = async (p, cookie, fields) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  const res = await fetch(BASE + p, { method: 'POST', headers: { Cookie: cookie }, body: fd });
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
      'staff', 'active', 'school', fields.school_code || '',
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
      fields.created_by, fields.sender_type, fields.school_code == null ? '' : fields.school_code,
      fields.is_registered == null ? 0 : fields.is_registered,
      '2026-10-25 09:00:00'
    );
    const id = Number(info.insertId);
    madeDocs.push(id);
    return id;
  };

  const docIds = (res) => ((res.body && res.body.documents) || []).map((d) => Number(d.id));

  try {
    /* ── ① เตรียมบัญชี: A = เจ้าหน้าที่คนก่อน (มีรหัสโรงเรียน), B = คนใหม่ (รหัสว่าง) ── */
    console.log('');
    console.log('① เตรียมบัญชีเจ้าหน้าที่สารบัญคนก่อน + คนใหม่');
    const userA = await mkUser('__t_out_a', { school_code: SCHOOL, workplace: WORKPLACE });
    const userB = await mkUser('__t_out_b', { school_code: '', workplace: WORKPLACE });
    check(!!userA && !!userB, `สร้างบัญชีทดสอบได้ (A=${userA}, B=${userB})`);

    // A ลงทะเบียนหนังสือส่ง 2 ฉบับ (แบบที่ระบบบันทึกจริง: มีรหัสโรงเรียน)
    const docOld1 = await mkDoc({
      title: 'ทดสอบทะเบียนส่ง (A ฉบับที่ 1)', doc_no: 'ที่ ศธ 04110.1/1',
      from_org: 'โรงเรียนทดสอบทะเบียนส่ง', to_org: 'สพป.แพร่ เขต 2',
      created_by: userA, sender_type: 'registered', school_code: SCHOOL,
    });
    const docOld2 = await mkDoc({
      title: 'ทดสอบทะเบียนส่ง (A ฉบับที่ 2)', doc_no: 'ที่ ศธ 04110.1/2',
      from_org: 'โรงเรียนทดสอบทะเบียนส่ง', to_org: 'สพป.แพร่ เขต 2',
      created_by: userA, sender_type: 'registered', school_code: SCHOOL,
    });
    check(!!docOld1 && !!docOld2, `สร้างหนังสือของ A ได้ (id=${docOld1}, ${docOld2})`);

    /* ── ② ลบ A ออกจากระบบ ─────────────────────────────────────────── */
    console.log('');
    console.log('② ลบเจ้าหน้าที่คนก่อนออกจากระบบ');
    await db.prepare('DELETE FROM users WHERE id = ?').run(userA);
    madeUsers.splice(madeUsers.indexOf(userA), 1);
    const stillThere = await db.prepare('SELECT COUNT(*) c FROM documents WHERE id IN (?,?)').get(docOld1, docOld2);
    check(Number(stillThere.c) === 2, 'ลบบัญชีแล้วหนังสือในทะเบียนยังอยู่ครบ',
      `เหลือ ${stillThere.c} ฉบับ (ควรได้ 2)`);

    /* ── ③ บัญชีใหม่ (school_code ว่าง) ต้องเห็นรายการเดิมทั้งหมด ─────── */
    console.log('');
    console.log('③ บัญชีใหม่เห็นทะเบียนหนังสือส่งของโรงเรียน (บั๊กเดิม: ไม่เห็นเลย)');
    const cookieB = await loginAs(userB);
    if (!cookieB) {
      check(false, 'สร้างเซสชันให้บัญชีใหม่ได้');
    } else {
      const r1 = await jget('/api/my-outgoing-registered', cookieB);
      const ids1 = docIds(r1);
      check(ids1.includes(docOld1) && ids1.includes(docOld2),
        'เห็นรายการที่เจ้าหน้าที่คนก่อนลงทะเบียนไว้ (ทั้ง 2 ฉบับ)',
        `ได้ id: ${ids1.join(',')} · ต้องมี ${docOld1},${docOld2}`);

      /* ── ④ ลงทะเบียนใหม่ → ต้องได้รหัสโรงเรียนจริง ────────────────── */
      console.log('');
      console.log('④ ลงทะเบียนหนังสือส่งใหม่ → ต้องบันทึกพร้อมรหัสโรงเรียน');
      const mk = await jpostForm('/api/documents', cookieB, {
        doc_type: 'outgoing',
        sender_type: 'registered',
        doc_no: 'ที่ ศธ 04110.1/3',
        date: '2026-10-25',
        title: 'ทดสอบทะเบียนส่ง (B ลงทะเบียนเอง)',
        from_org: 'โรงเรียนทดสอบทะเบียนส่ง',
        to_org: 'สพป.แพร่ เขต 2',
        note: '',
      });
      const newId = Number((mk.body && mk.body.id) || 0);
      if (newId) madeDocs.push(newId);
      check(mk.status === 200 && newId > 0, `ลงทะเบียนหนังสือส่งได้ (HTTP ${mk.status}, id=${newId})`,
        JSON.stringify(mk.body));
      const newRow = newId ? await db.prepare('SELECT school_code FROM documents WHERE id = ?').get(newId) : null;
      check(newRow && newRow.school_code === SCHOOL,
        `หนังสือที่ลงทะเบียนใหม่มีรหัสโรงเรียน ${SCHOOL}`,
        `ได้ "${newRow ? newRow.school_code : '(ไม่มีแถว)'}"`);

      /* ── ⑤ แถวเก่าที่ไม่มีรหัสโรงเรียน (ข้อมูลก่อนแก้บั๊ก) ───────────── */
      console.log('');
      console.log('⑤ รายการเก่าที่ไม่มีรหัสโรงเรียน ต้องยังเห็นได้');
      const docLegacy = await mkDoc({
        title: 'ทดสอบทะเบียนส่ง (แถวเก่าไม่มีรหัสโรงเรียน)', doc_no: 'ที่ ศธ 04110.1/4',
        from_org: 'โรงเรียนทดสอบทะเบียนส่ง', to_org: 'สพป.แพร่ เขต 2',
        created_by: userB, sender_type: 'registered', school_code: '',
      });
      const r2 = await jget('/api/my-outgoing-registered', cookieB);
      check(docIds(r2).includes(docLegacy), 'เห็นรายการเก่าที่ไม่มีรหัสโรงเรียน (แต่ผู้สร้างเป็นคนของโรงเรียนนี้)',
        `ได้ id: ${docIds(r2).join(',')} · ต้องมี ${docLegacy}`);

      /* ── ⑥ ทะเบียนของสำนักงานเขต ต้องไม่ปนกับของโรงเรียน ──────────── */
      console.log('');
      console.log('⑥ ทะเบียนของสำนักงานเขต ต้องไม่ปนกับของโรงเรียน');
      const adminRow = await db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
      const docOffice = await mkDoc({
        title: 'ทดสอบทะเบียนส่ง (ของสำนักงานเขต)', doc_no: 'ที่ ศธ 04110/99',
        from_org: 'สพป.แพร่ เขต 2', to_org: 'กลุ่มงานทดสอบ',
        created_by: adminRow.id, sender_type: 'registered', school_code: '',
      });
      const rAdmin = await jget('/api/my-outgoing-registered', admin);
      const adminIds = docIds(rAdmin);
      check(adminIds.includes(docOffice), 'สำนักงานเขตเห็นรายการของตัวเอง',
        `ได้ id: ${adminIds.join(',')} · ต้องมี ${docOffice}`);
      check(!adminIds.includes(docOld1) && !adminIds.includes(docOld2) && !adminIds.includes(docLegacy),
        'สำนักงานเขตไม่เห็นรายการของโรงเรียน',
        `ได้ id: ${adminIds.join(',')} · ต้องไม่มี ${docOld1},${docOld2},${docLegacy}`);
      const r3 = await jget('/api/my-outgoing-registered', cookieB);
      check(!docIds(r3).includes(docOffice), 'โรงเรียนไม่เห็นรายการของสำนักงานเขต',
        `ได้ id: ${docIds(r3).join(',')} · ต้องไม่มี ${docOffice}`);

      /* ── ⑦ เจ้าหน้าที่สารบัญคนใหม่ใช้เลขหนังสือของโรงเรียนได้ ─────── */
      console.log('');
      console.log('⑦ เจ้าหน้าที่สารบัญคนใหม่ใช้เลขหนังสือของโรงเรียนได้');
      await db.prepare("INSERT INTO document_staff (staff_type, user_id, school_code) VALUES ('school', ?, ?)")
        .run(userB, SCHOOL);
      const gPrefix = await jget('/api/document-staff/school-prefix', cookieB);
      check(gPrefix.status === 200 && gPrefix.body && gPrefix.body.school_code === SCHOOL,
        `อ่านเลขหนังสือของโรงเรียนได้ (school_code=${gPrefix.body && gPrefix.body.school_code})`,
        JSON.stringify(gPrefix.body));
      const pPrefix = await jput('/api/document-staff/school-prefix', cookieB, { doc_prefix: '1' });
      check(pPrefix.status === 200 && pPrefix.body && pPrefix.body.school_code === SCHOOL,
        `บันทึกเลขหนังสือของโรงเรียนได้ (HTTP ${pPrefix.status})`,
        JSON.stringify(pPrefix.body));

      /* ── ⑧ ผู้ใช้ที่ไม่รู้รหัสโรงเรียน ต้องไม่เห็นของทุกโรงเรียน ────── */
      console.log('');
      console.log('⑧ ผู้ใช้ที่ไม่รู้รหัสโรงเรียน เห็นเฉพาะหนังสือที่ตัวเองเป็นผู้รับ');
      const userC = await mkUser('__t_out_c', { school_code: '', workplace: '' });
      const docIn = await mkDoc({
        doc_type: 'incoming', title: 'ทดสอบทะเบียนรับของโรงเรียนอื่น', doc_no: 'ที่ ศธ 04110/98',
        from_org: 'โรงเรียนอื่น', to_org: SCHOOL + ' โรงเรียนทดสอบทะเบียนส่ง',
        created_by: adminRow.id, sender_type: 'office', school_code: '', is_registered: 1,
      });
      const cookieC = await loginAs(userC);
      if (!cookieC) {
        check(false, 'สร้างเซสชันให้บัญชีที่ไม่รู้รหัสโรงเรียนได้');
      } else {
        const rC = await jget('/api/my-incoming-registered', cookieC);
        check(!docIds(rC).includes(docIn),
          'ไม่เห็นทะเบียนหนังสือรับของโรงเรียนอื่น (เดิม to_org LIKE %%)',
          `ได้ id: ${docIds(rC).join(',')} · ต้องไม่มี ${docIn}`);
      }

      /* ── ⑨ migrate() ต้องเติมรหัสโรงเรียนให้ข้อมูลเก่า (ใช้ตอน deploy) ── */
      console.log('');
      console.log('⑨ migrate() เติมรหัสโรงเรียนให้บัญชี/หนังสือที่ยังว่าง');
      const userD = await mkUser('__t_out_d', { school_code: '', workplace: WORKPLACE });
      const docD = await mkDoc({
        title: 'ทดสอบทะเบียนส่ง (รอ migrate เติมรหัส)', doc_no: 'ที่ ศธ 04110.1/5',
        from_org: 'โรงเรียนทดสอบทะเบียนส่ง', to_org: 'สพป.แพร่ เขต 2',
        created_by: userD, sender_type: 'registered', school_code: '',
      });
      // เคสจริงที่ผู้ใช้แจ้ง: เจ้าหน้าที่คนก่อนถูกลบออกจากระบบไปแล้ว (created_by ไม่มีตัวตน)
      // → ต้องกู้รหัสโรงเรียนจากช่อง "จาก" (ระบบกรอก "รหัสโรงเรียน + ชื่อโรงเรียน" ให้เอง)
      const docOrphan = await mkDoc({
        title: 'ทดสอบทะเบียนส่ง (ผู้สร้างถูกลบแล้ว)', doc_no: 'ที่ ศธ 04110.1/6',
        from_org: WORKPLACE, to_org: 'สพป.แพร่ เขต 2',
        created_by: 999999, sender_type: 'registered', school_code: '',
      });
      await db.migrate();
      const afterD = await db.prepare('SELECT school_code FROM users WHERE id = ?').get(userD);
      const afterDocD = await db.prepare('SELECT school_code FROM documents WHERE id = ?').get(docD);
      const afterOrphan = await db.prepare('SELECT school_code FROM documents WHERE id = ?').get(docOrphan);
      check(afterD && afterD.school_code === SCHOOL,
        `migrate เติมรหัสโรงเรียนให้บัญชี (ได้ "${afterD ? afterD.school_code : ''}")`);
      check(afterDocD && afterDocD.school_code === SCHOOL,
        `migrate เติมรหัสโรงเรียนให้หนังสือ (ได้ "${afterDocD ? afterDocD.school_code : ''}")`);
      check(afterOrphan && afterOrphan.school_code === SCHOOL,
        `migrate กู้รหัสโรงเรียนให้หนังสือที่ผู้สร้างถูกลบแล้ว (ได้ "${afterOrphan ? afterOrphan.school_code : ''}")`);

      /* ── ⑩ แท็บ "หนังสือส่ง" ของโรงเรียน ก็ต้องเป็นของโรงเรียน ─────── */
      console.log('');
      console.log('⑩ แท็บหนังสือส่ง (ไม่ใช่ทะเบียน) เห็นของโรงเรียน ไม่ใช่ของบัญชี');
      // โรงเรียนส่งหนังสือถึง สพป. (sender_type = 'school') — ผู้สร้างถูกลบไปแล้ว
      const docSent = await mkDoc({
        title: 'ทดสอบหนังสือส่งของโรงเรียน (ผู้สร้างถูกลบแล้ว)', doc_no: 'ที่ ศธ 04110.1/7',
        from_org: WORKPLACE, to_org: 'สพป.แพร่ เขต 2',
        created_by: 999998, sender_type: 'school', school_code: SCHOOL,
      });
      // หนังสือของโรงเรียนอื่น — ต้องไม่โผล่ให้โรงเรียนนี้เห็น
      const docOther = await mkDoc({
        title: 'ทดสอบหนังสือส่งของโรงเรียนอื่น', doc_no: 'ที่ ศธ 04110.2/1',
        from_org: '88888888 โรงเรียนอื่น', to_org: 'สพป.แพร่ เขต 2',
        created_by: userB, sender_type: 'school', school_code: '88888888',
      });
      // หนังสือส่งของสำนักงานเขต — ต้องไม่โผล่ในทะเบียนของโรงเรียน
      const docOfficeOut = await mkDoc({
        title: 'ทดสอบหนังสือส่งของสำนักงานเขต', doc_no: 'ที่ ศธ 04110/97',
        from_org: 'สพป.แพร่ เขต 2', to_org: 'กลุ่มงานทดสอบ',
        created_by: adminRow.id, sender_type: 'office', school_code: '',
      });
      const rSent = await jget('/api/documents?doc_type=outgoing', cookieB);
      check(docIds(rSent).includes(docSent), 'เห็นหนังสือส่งที่เจ้าหน้าที่คนก่อนสร้างไว้',
        `ได้ id: ${docIds(rSent).join(',')} · ต้องมี ${docSent}`);
      check(!docIds(rSent).includes(docOther), 'ไม่เห็นหนังสือส่งของโรงเรียนอื่น',
        `ได้ id: ${docIds(rSent).join(',')} · ต้องไม่มี ${docOther}`);
      check(!docIds(rSent).includes(docOfficeOut), 'ไม่เห็นหนังสือส่งของสำนักงานเขต',
        `ได้ id: ${docIds(rSent).join(',')} · ต้องไม่มี ${docOfficeOut}`);
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
      await db.prepare("DELETE FROM school_doc_prefix WHERE school_code = ?").run(SCHOOL);
      await db.prepare("DELETE FROM document_staff WHERE staff_type = 'school' AND school_code = ?").run(SCHOOL);
      for (const id of madeUsers) {
        await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id).catch(() => {});
        await db.prepare('DELETE FROM document_staff WHERE user_id = ?').run(id).catch(() => {});
        await db.prepare('DELETE FROM users WHERE id = ?').run(id);
      }
    } catch (e) {
      console.log(`  – เก็บกวาดไม่สำเร็จ: ${e.message}`);
    }
    console.log('');
    console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    process.exit(fail ? 1 : 0);
  }
})();
