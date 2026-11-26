'use strict';
/**
 * ทดสอบ "เลขที่เอกสารพิมพ์เองได้" (ผู้ใช้สั่ง 26 พ.ย. 2569)
 *
 *   · ลงทะเบียนคำสั่ง        → เลขที่คำสั่งพิมพ์เองได้ รูปแบบ `<เลข>/<ปี พ.ศ.>`
 *   · ลงทะเบียนเกียรติบัตร   → ที่เกียรติบัตรพิมพ์เองได้ รูปแบบ `เลขที่ <เลข>/<ปี พ.ศ.>`
 *   · ลงทะเบียนรับหนังสือ    → เลขหนังสือรับพิมพ์เองได้
 *   และครั้งถัดไประบบต้องรันเลขต่อจากเลขที่บันทึกไว้ (มากที่สุด + 1)
 *
 * กติกาที่ต้องผ่าน
 *   ① คำสั่ง: ส่ง "15" → เก็บ 15/<ปี> · เลขถัดไป = 16/<ปี>
 *   ② เกียรติบัตร: ส่ง "7" → เก็บ "เลขที่ 7/<ปี>" · ไม่ซ้ำคำว่า "เลขที่" · เลขถัดไป = 8
 *   ③ หนังสือรับ: ใส่ reg_no เองได้ และเลขถัดไป = ค่านั้น + 1
 *   ④ หนังสือรับรอง: ยังรันอัตโนมัติ (ไม่ใช้ค่าที่ client ส่งมา)
 *
 * ใช้: node scripts/test-doc-no-editable.js
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));
const simdate = require(path.join(__dirname, '..', 'lib', 'simdate.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const TAG = 'ทดสอบเลขที่-editable';

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
const postDoc = async (cookie, fields) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v == null ? '' : String(v));
  const res = await fetch(BASE + '/api/documents', { method: 'POST', headers: { Cookie: cookie }, body: fd });
  return { status: res.status, body: await res.json().catch(() => null) };
};

(async () => {
  console.log('');
  const db = require(path.join(__dirname, '..', 'db.js'));
  await db.init();

  const yearBE = String(Number(simdate.todayISO().slice(0, 4)) + 543);
  const madeDocs = [];

  const cleanup = async () => {
    for (const id of madeDocs) {
      try { await db.prepare('DELETE FROM document_recipients WHERE document_id = ?').run(id); } catch (e) { /* ignore */ }
      try { await db.prepare('DELETE FROM document_school_targets WHERE document_id = ?').run(id); } catch (e) { /* ignore */ }
      try { await db.prepare('DELETE FROM documents WHERE id = ?').run(id); } catch (e) { /* ignore */ }
    }
    try { await db.prepare("DELETE FROM documents WHERE title LIKE ?").run(TAG + '%'); } catch (e) { /* ignore */ }
  };

  try {
    const adminCookie = 'sid=' + (await auth.newSession(1));
    // เริ่มจากล้างของค้างจากรอบก่อน (ถ้ามี)
    await cleanup();
    madeDocs.length = 0;

    console.log('');
    console.log(`① คำสั่ง: พิมพ์เลขเองได้ (ปี พ.ศ. ${yearBE})`);
    const o1 = await postDoc(adminCookie, {
      doc_type: 'order', title: TAG + ' คำสั่ง 1', date: simdate.todayISO(), doc_no: '15',
    });
    check(o1.status === 200, `POST /documents (คำสั่ง) → 200 (ได้ ${o1.status})`, JSON.stringify(o1.body));
    const oRow = await db.prepare("SELECT id, doc_no FROM documents WHERE title = ? ORDER BY id DESC LIMIT 1").get(TAG + ' คำสั่ง 1');
    if (oRow) madeDocs.push(oRow.id);
    check(oRow && oRow.doc_no === `15/${yearBE}`, `เก็บเลขที่คำสั่งเป็น 15/${yearBE}`,
      JSON.stringify(oRow && oRow.doc_no));
    const nextOrder = await jget('/api/next-doc-no?type=order', adminCookie);
    check(nextOrder.body && nextOrder.body.next === `16/${yearBE}`,
      `เลขที่คำสั่งถัดไป = 16/${yearBE}`, JSON.stringify(nextOrder.body));

    console.log('');
    console.log('② เกียรติบัตร: พิมพ์เลขเองได้ + ไม่ซ้ำคำว่า "เลขที่"');
    const h1 = await postDoc(adminCookie, {
      doc_type: 'honor', title: TAG + ' เกียรติบัตร 1', date: simdate.todayISO(),
      doc_no: `เลขที่ 7/${yearBE}`, person_name: 'ทดสอบ', honor_signer: 1, honor_template: '1',
    });
    check(h1.status === 200, `POST /documents (เกียรติบัตร) → 200 (ได้ ${h1.status})`, JSON.stringify(h1.body));
    const hRow = await db.prepare("SELECT id, doc_no FROM documents WHERE title = ? ORDER BY id DESC LIMIT 1").get(TAG + ' เกียรติบัตร 1');
    if (hRow) madeDocs.push(hRow.id);
    check(hRow && hRow.doc_no === `เลขที่ 7/${yearBE}`, `เก็บเป็น "เลขที่ 7/${yearBE}" (คำว่าเลขที่ครั้งเดียว)`,
      JSON.stringify(hRow && hRow.doc_no));
    const nextHonor = await jget('/api/next-doc-no?type=honor', adminCookie);
    check(nextHonor.body && nextHonor.body.next === `เลขที่ 8/${yearBE}`,
      `ที่เกียรติบัตรถัดไป = เลขที่ 8/${yearBE}`, JSON.stringify(nextHonor.body));

    console.log('');
    console.log('③ หนังสือรับ: ใส่เลขเองได้ และเลขถัดไปต่อจากเดิม');
    const adminRow = await db.prepare('SELECT title, full_name FROM users WHERE id = 1').get();
    const toOrg = [adminRow && adminRow.title, adminRow && adminRow.full_name].filter(Boolean).join(' ');
    const beforeReg = await jget('/api/next-doc-no?type=incoming', adminCookie);
    const typed = String(Number(beforeReg.body && beforeReg.body.next ? beforeReg.body.next : 1) + 4321);
    const reg = await postDoc(adminCookie, {
      doc_type: 'incoming', sender_type: 'office', title: TAG + ' หนังสือรับ 1',
      date: simdate.todayISO(), doc_no: `ที่ ทดสอบ/${typed}`, reg_no: typed, is_registered: '1',
      from_org: 'หน่วยงานทดสอบ', to_org: toOrg || 'ผู้ดูแล ระบบ',
    });
    check(reg.status === 200, `POST /documents (หนังสือรับ) → 200 (ได้ ${reg.status})`, JSON.stringify(reg.body));
    const rRow = await db.prepare("SELECT id, reg_no FROM documents WHERE title = ? ORDER BY id DESC LIMIT 1").get(TAG + ' หนังสือรับ 1');
    if (rRow) madeDocs.push(rRow.id);
    check(rRow && String(rRow.reg_no) === typed, `บันทึกเลขหนังสือรับตามที่พิมพ์ (${typed})`,
      JSON.stringify(rRow && rRow.reg_no));
    const nextReg = await jget('/api/next-doc-no?type=incoming', adminCookie);
    check(nextReg.body && nextReg.body.next === String(Number(typed) + 1),
      `เลขหนังสือรับถัดไป = ${Number(typed) + 1}`, JSON.stringify(nextReg.body));

    console.log('');
    console.log('④ หนังสือรับรอง: ยังรันอัตโนมัติ (ไม่ใช้เลขที่ client ส่งมา)');
    const cert = await postDoc(adminCookie, {
      doc_type: 'certificate', title: TAG + ' หนังสือรับรอง 1', date: simdate.todayISO(),
      doc_no: '9999/' + yearBE, requester: 'ทดสอบ', cert_position: 'ครู', officer: 1,
      body_text: 'ทดสอบ',
    });
    check(cert.status === 200, `POST /documents (หนังสือรับรอง) → 200 (ได้ ${cert.status})`, JSON.stringify(cert.body));
    const cRow = await db.prepare("SELECT id, doc_no FROM documents WHERE title = ? ORDER BY id DESC LIMIT 1").get(TAG + ' หนังสือรับรอง 1');
    if (cRow) madeDocs.push(cRow.id);
    check(cRow && cRow.doc_no !== `9999/${yearBE}` && new RegExp(`^ที่ [0-9]+/${yearBE}$`).test(String(cRow.doc_no || '')),
      'หนังสือรับรองยังใช้เลขที่ระบบรันให้', JSON.stringify(cRow && cRow.doc_no));
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    try {
      await cleanup();
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
