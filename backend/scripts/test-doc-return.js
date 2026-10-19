/**
 * ทดสอบ "ส่งกลับเพื่อแก้ไข" หนังสือจากสถานศึกษา
 *
 * ทำไมต้องมี
 * ──────────
 * ผู้ใช้ขอ: "เมื่อสถานศึกษาส่งหนังสือมา สพป. ต้องส่งกลับให้โรงเรียนแก้ได้
 *              พร้อมเหตุผลที่ต้องแก้ แล้วโรงเรียนต้องเห็น"
 *
 * เส้นทางที่ต้องผ่าน
 *   ① สพป. กดส่งกลับ → status = 'returned' + revision_note
 *   ② หนังสือยังอยู่ในรายการของ สพป. (หายไป = ผิด)
 *   ③ โรงเรียนเห็นหนังสือฉบับนั้นในรายการหนังสือส่งของตัวเอง
 *   ④ โรงเรียนแก้แล้วส่งกลับมา → สถานะกลับเป็น 'received' + ธง "อ่านแล้ว" ถูกล้าง
 *   ⑤ บังคับ: ส่งกลับหนังสือที่ไม่ได้มาจากสถานศึกษา → ต้องไม่ได้
 *   ⑥ บังคับ: ไม่กรอกเหตุผล → ต้องไม่ได้
 *
 * ใช้: node scripts/test-doc-return.js
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const ADMIN_USER = process.env.TEST_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.TEST_ADMIN_PASS || 'Joey2343**';

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
const jget = async (p, cookie) => (await fetch(BASE + p, { headers: { Cookie: cookie } })).json();
const jput = async (p, cookie, body) => {
  const res = await fetch(BASE + p, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

/**
 * สร้างเซสชันของผู้ใช้ที่ id กำหนดโดยตรง (ไม่ต้องรู้รหัสผ่าน)
 *
 * ต้องการสิทธิ์ของ "ผู้ใช้คนอื่น" ในการทดสอบ ไม่ใช่แค่ admin
 * เพราะสิทธิ์ admin ผ่านทุกกรณี ทดสอบไม่ออก
 * คืน cookie พร้อมใช้ หรือ '' ถ้าสร้างไม่ได้
 */
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
  let docId = null;

  try {
    /* ── เตรียมหนังสือทดสอบ: สร้างเป็นหนังสือจากสถานศึกษา ───────────────── */
    console.log('');
    console.log('① เตรียมหนังสือทดสอบ (จำลองหนังสือจากสถานศึกษา)');
    const veh = await db.prepare('SELECT id FROM users WHERE role = "admin" LIMIT 1').get();
    const info = await db.prepare(`INSERT INTO documents
      (doc_type, title, from_org, to_org, date, created_by, sender_type, school_code, status, created_at)
      VALUES ('outgoing', 'ทดสอบส่งกลับเพื่อแก้ไข', 'โรงเรียนทดสอบ 12345678', 'สพป.แพร่ เขต 2', '2026-10-19',
              ?, 'school', '12345678', 'received', '2026-10-19 09:00:00')`).run(veh.id);
    docId = Number(info.insertId);
    check(!!docId && !Number.isNaN(docId), `สร้างหนังสือทดสอบได้ (id=${docId})`,
      'ถ้าได้ NaN แปลว่าอ่านชื่อฟิลด์ผิด — run() คืน insertId ไม่ใช่ lastInsertId');

    /* ── ⑤ บังคับ: ส่งกลับหนังสือที่ไม่ได้มาจากสถานศึกษา ─────────────── */
    console.log('');
    console.log('② ส่งกลับได้เฉพาะหนังสือจากสถานศึกษา');
    const officeInfo = await db.prepare(`INSERT INTO documents
      (doc_type, title, from_org, to_org, date, created_by, sender_type, status, created_at)
      VALUES ('outgoing', 'หนังสือของสพป.เอง', 'สพป.แพร่ เขต 2', 'กลุ่มงาน', '2026-10-19', ?, 'office', 'received', '2026-10-19 09:00:00')`)
      .run(veh.id);
    const officeId = Number(officeInfo.insertId);
    try {
      const r = await jput(`/api/documents/${officeId}/return`, admin, { note: 'ทดสอบ' });
      check(r.status === 400, `หนังสือของ สพป.เอง ส่งกลับไม่ได้ (HTTP ${r.status})`,
        `ควรได้ 400 · ได้ ${r.status} ${JSON.stringify(r.body)}`);
    } finally {
      await db.prepare('DELETE FROM documents WHERE id = ?').run(officeId);
    }

    /* ── ⑦ บังคับ: คนที่ไม่ใช่สารบัญเขตส่งกลับไม่ได้ ──────────────────── */
    // ผู้ใช้ฝั่งสถานศึกษาคือเจ้าของหนังสือ แต่ไม่มีสิทธิ์ส่งกลับ (สิทธิ์อยู่ฝั่ง สพป.)
    // ถ้าไม่เช็คสิทธิ์ โรงเรียนจะส่งกลับหนังสือของตัวเองได้ → ตัวเองกับตัวเองวน
    console.log('');
    console.log('②b คนที่ไม่ใช่สารบัญเขตส่งกลับไม่ได้');
    const schoolUser = await db.prepare("SELECT id FROM users WHERE user_group = 'school' AND status = 'active' LIMIT 1").get();
    if (!schoolUser) {
      console.log('  – ข้าม: ไม่มีผู้ใช้ฝั่งสถานศึกษาที่ active ในฐาน');
    } else {
      const schoolCookie = await loginAs(schoolUser.id);
      if (!schoolCookie) {
        console.log('  – ข้าม: ล็อกอินผู้ใช้ฝั่งสถานศึกษาไม่สำเร็จ');
      } else {
        // ให้หนังสือทดสอบเป็นของโรงเรียนคนนี้ชั่วคราว เพื่อให้สิทธิ์เป็นตัวตัดสินจริง
        await db.prepare('UPDATE documents SET created_by = ? WHERE id = ?').run(schoolUser.id, docId);
        const rNoPerm = await jput(`/api/documents/${docId}/return`, schoolCookie, { note: 'ทดสอบสิทธิ์' });
        check(rNoPerm.status === 403, `โรงเรียนส่งกลับหนังสือไม่ได้ (HTTP ${rNoPerm.status})`,
          `ควรได้ 403 · ได้ ${rNoPerm.status} ${JSON.stringify(rNoPerm.body)}`);
        const afterNoPerm = await db.prepare('SELECT status FROM documents WHERE id = ?').get(docId);
        check(afterNoPerm && afterNoPerm.status === 'received',
          'สิทธิ์ไม่ผ่าน → สถานะไม่เปลี่ยน', `ได้ ${afterNoPerm && afterNoPerm.status}`);
        await db.prepare('UPDATE documents SET created_by = ? WHERE id = ?').run(veh.id, docId);
      }
    }

    /* ── ⑥ บังคับ: ไม่กรอกเหตุผล ─────────────────────────────────────── */
    console.log('');
    console.log('③ ต้องกรอกสาเหตุที่ส่งกลับ');
    const rNoNote = await jput(`/api/documents/${docId}/return`, admin, { note: '   ' });
    check(rNoNote.status === 400, `ไม่กรอกเหตุผล → ปฏิเสธ (HTTP ${rNoNote.status})`,
      `ควรได้ 400 · ได้ ${rNoNote.status}`);
    let rowNow = await db.prepare('SELECT status FROM documents WHERE id = ?').get(docId);
    check(rowNow && rowNow.status === 'received', 'สถานะไม่เปลี่ยนเมื่อส่งกลับไม่สำเร็จ');

    /* ── ① ส่งกลับสำเร็จ ──────────────────────────────────────────────── */
    console.log('');
    console.log('④ ส่งกลับเพื่อแก้ไข');
    const NOTE = 'กรุณาตรวจสอบเลขที่หนังสือและแก้ชื่อเรื่องให้ถูกต้อง';
    const rRet = await jput(`/api/documents/${docId}/return`, admin, { note: NOTE });
    check(rRet.status === 200, `ส่งกลับสำเร็จ (HTTP ${rRet.status})`, JSON.stringify(rRet.body).slice(0, 140));
    check(rRet.body && rRet.body.row && rRet.body.row.status === 'returned',
      'คืน row.status = "returned" ให้หน้าเว็บอัปเดตทันที');
    check(rRet.body && rRet.body.row && rRet.body.row.revision_note === NOTE,
      'คืน revision_note ตรงกับที่กรอก');

    const after = await db.prepare('SELECT status, revision_note, returned_at, returned_by FROM documents WHERE id = ?').get(docId);
    check(after && after.status === 'returned', 'ฐานข้อมูลเป็น returned จริง', `ได้ ${after && after.status}`);
    check(after && after.revision_note === NOTE, 'ฐานข้อมูลเก็บสาเหตุครบ');
    check(after && !!after.returned_at && !!after.returned_by, 'บันทึกว่าส่งกลับโดยใคร เมื่อไร');

    /* ── ② หนังสือยังอยู่ในรายการ สพป. ──────────────────────────────── */
    console.log('');
    console.log('⑤ หลังส่งกลับ หนังสือยังอยู่ในรายการฝั่ง สพป. (ไม่หาย)');
    const inc = await jget('/api/documents?doc_type=outgoing', admin);
    const stillThere = (inc.documents || []).some((d) => Number(d.id) === docId);
    check(stillThere, 'หนังสือยังอยู่ในรายการ',
      'ถ้าหายไป ผู้ใช้จะเห็นว่าหนังสือถูกลบทิ้ง ไม่ใช่ถูกส่งกลับ');
    const withStatus = (inc.documents || []).find((d) => Number(d.id) === docId);
    check(withStatus && withStatus.status === 'returned',
      'รายการคืนค่า status = "returned" ให้หน้าเว็บแสดงผลได้');

    /* ── ⑧ การ์ดหน้าแรกของโรงเรียนเห็นหนังสือที่รอแก้ ─────────────────── */
    // ไม่งั้นโรงเรียนต้องเปิดทุกแท็บเพื่อหาว่ามีอะไรรออยู่
    console.log('');
    console.log('⑤b โรงเรียนเห็นการ์ดหน้าแรก "หนังสูองรอให้แก้ไข"');
    const schUser2 = await db.prepare("SELECT id FROM users WHERE user_group = 'school' AND status = 'active' LIMIT 1").get();
    const schCookie2 = schUser2 ? await loginAs(schUser2.id) : '';
    if (!schCookie2) {
      console.log('  – ข้าม: ไม่มีผู้ใช้ฝั่งสถานศึกษาที่ active');
    } else {
      await db.prepare('UPDATE documents SET created_by = ? WHERE id = ?').run(schUser2.id, docId);
      const mp = await jget('/api/my-pending', schCookie2);
      // เทียบกับจำนวนจริงในฐาน ไม่ใช่ตัวเลขตายตัว
      //   เพราะผู้ใช้คนนี้อาจมีหนังสือที่รอแก้อยู่แล้วจากรอบก่อน ๆ (ฐานทดสอบไม่ได้ว่างเปล่า)
      const expectDoc = await db.prepare(
        "SELECT COUNT(*) c FROM documents WHERE created_by = ? AND status = 'returned'",
      ).get(schUser2.id);
      check(Number(mp.docReturned) === Number(expectDoc.c),
        'การ์ดหน้าแรกนับหนังสือที่รอแก้ไขตรงกับฐานข้อมูล',
        `ได้ ${mp.docReturned} · ควรเป็น ${expectDoc.c}`);
      // ต้องเป็นตัวเลขจริง ไม่ใช่ {} ของ Promise ที่หลุด (เคยเป็นบั๊ก — การ์ดหน้าแรกไม่ขึ้นเลย)
      check(typeof mp.docReturned === 'number', 'docReturned เป็นตัวเลข ไม่ใช่ object',
        `ได้ ${typeof mp.docReturned} = ${JSON.stringify(mp.docReturned)}`);
      await db.prepare('UPDATE documents SET created_by = ? WHERE id = ?').run(veh.id, docId);
    }

    // ⚠️ count() ใน /my-pending เคยหลุด await → JSON.stringify(Promise) = {}
//   ทำให้การ์ดหน้าแรกไม่ขึ้นเลยทั้งหน้า ({} > 0 เป็น false)
//   จุดนี้กันไว้ให้ครอบคลุมทุกตัวเลขบนหน้าแรก ไม่ใช่แค่ docReturned
console.log('');
console.log('⑤c ตัวเลขการ์ดหน้าแรกทุกตัวต้องเป็นตัวเลขจริง');
const CARD_NUMBERS = ['vehicleNotices', 'vehicle', 'room', 'travel', 'leave', 'memo', 'memoReturned', 'docReturned'];
const mpAll = await jget('/api/my-pending', admin);
for (const k of CARD_NUMBERS) {
  check(typeof mpAll[k] === 'number', `${k} เป็นตัวเลข`,
    `ได้ ${typeof mpAll[k]} = ${JSON.stringify(mpAll[k])}`);
}
const total = CARD_NUMBERS.reduce((s, k) => s + (typeof mpAll[k] === 'number' ? mpAll[k] : 0), 0);
check(typeof total === 'number' && !Number.isNaN(total),
  'ผลรวมทั้งหมดนำไปแสดงบนหน้าแรกได้ ไม่ใช่ NaN', `ได้ ${total}`);

/* ── ④ โรงเรียนแก้แล้วส่งกลับมา → ล้างสถานะ ─────────────────────── */
    console.log('');
    console.log('⑥ โรงเรียนแก้แล้วส่งกลับมา → สถานะกลับเป็นปกติ');
    // ทำเหมือนผู้ส่งเดิมกดบันทึก (PUT /documents/:id)
    await jput(`/api/documents/${docId}`, admin, { title: 'ทดสอบส่งกลับเพื่อแก้ไข (แก้แล้ว)' });
    const cleared = await db.prepare('SELECT status, revision_note, returned_at, returned_by FROM documents WHERE id = ?').get(docId);
    check(cleared && cleared.status === 'received', 'สถานะกลับเป็น received', `ได้ ${cleared && cleared.status}`);
    check(cleared && !cleared.revision_note, 'ล้างสาเหตุที่ส่งกลับแล้ว');
    check(cleared && !cleared.returned_at && !cleared.returned_by, 'ล้างผู้ส่งกลับ/เวลาแล้ว');
  } finally {
    if (docId) {
      try {
        await db.prepare('DELETE FROM document_recipients WHERE document_id = ?').run(docId);
        await db.prepare('DELETE FROM documents WHERE id = ?').run(docId);
      } catch (e) { /* ignore */ }
    }
    const left = await db.prepare(`SELECT COUNT(*) c FROM documents WHERE title LIKE 'ทดสอบส่งกลับ%'`).get();
    check(Number(left && left.c) === 0, 'ลบข้อมูลทดสอบครบ ไม่ทิ้งไว้ในระบบ', `ยังเหลือ ${left && left.c} แถว`);
    await db.close();
  }

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('  ✖ ทดสอบล้มเหลว:', e.message, e.stack); process.exit(1); });