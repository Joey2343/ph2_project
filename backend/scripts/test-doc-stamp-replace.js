'use strict';
/**
 * ทดสอบ "ปั้มรับทับไฟล์เดิม" + คืนรายการไฟล์แนบทั้งหมดหลังบันทึก
 * (ผู้ใช้สั่ง 11 พ.ย. 2569)
 *
 *  1) ปั้มรับ → ต้องแทนที่ไฟล์เดิม (ไฟล์แนบไม่เพิ่มเป็น 2 ฉบับ) + ลบไฟล์ต้นฉบับออกจากดิสก์
 *  2) PUT /documents/:id คืน `files` / `file_names` ให้หน้าเว็บเอาไปแนบในหน้าส่งไปรษณีย์
 *  3) ถ้าไม่ได้ปั้ม (ไม่มี stamp_replace) ยังต่อท้ายไฟล์ใหม่เหมือนเดิม
 *
 * ใช้: node scripts/test-doc-stamp-replace.js
 */
const fs = require('fs');
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'documents');

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

  const madeDocs = [];
  const madeFiles = [];
  const stamp = (tag) => `zz-stamp-${tag}-${Date.now()}.pdf`;

  const writeFile = (name) => {
    const full = path.join(UPLOAD_DIR, name);
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(full, Buffer.from('%PDF-1.4 test'));
    madeFiles.push(full);
    return full;
  };

  const mkDoc = async (filePath, fileNames) => {
    const info = await db.prepare(`INSERT INTO documents
      (doc_type, doc_no, title, from_org, to_org, date, created_by, sender_type, school_code,
       file, file_names, is_registered, body_text, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`).run(
      'incoming', '', 'ทดสอบปั้มรับทับไฟล์', 'โรงเรียนทดสอบ', 'สพป.แพร่ เขต 2', '2026-11-11',
      1, 'school', '54020001', filePath, fileNames, 1, 'เนื้อหา'
    );
    const id = Number(info.insertId);
    madeDocs.push(id);
    return id;
  };

  const putWithFile = async (cookie, id, fields, fileName) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    fd.append('files', new Blob([Buffer.from('%PDF-1.4 stamped')], { type: 'application/pdf' }), fileName);
    const res = await fetch(BASE + '/api/documents/' + id, {
      method: 'PUT',
      headers: { Cookie: cookie },
      body: fd,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  try {
    const adminCookie = 'sid=' + (await auth.newSession(1));

    const oldName = stamp('old');
    const oldPath = 'documents/' + oldName;
    writeFile(oldName);
    const docId = await mkDoc(oldPath, JSON.stringify(['หนังสือรับเดิม']));

    console.log('① ปั้มรับทับไฟล์เดิม → ไฟล์แนบยังมีฉบับเดียว');
    const r1 = await putWithFile(adminCookie, docId, {
      title: 'ทดสอบปั้มรับทับไฟล์',
      is_registered: '1',
      file_names: JSON.stringify(['หนังสือรับ (ปั้มแล้ว)']),
      stamp_replace: oldPath,
    }, stamp('new'));
    check(r1.status === 200, `PUT /documents/:id → 200 (ได้ ${r1.status})`, JSON.stringify(r1.body));
    const files1 = Array.isArray(r1.body.files) ? r1.body.files : [];
    check(files1.length === 1, `คืน files 1 ไฟล์ (ได้ ${files1.length})`, JSON.stringify(files1));
    check(files1[0] && files1[0] !== oldPath, 'ไฟล์ที่คืนเป็นไฟล์ใหม่ (ไม่ใช่ path เดิม)', JSON.stringify(files1));
    const dbRow1 = await db.prepare('SELECT file FROM documents WHERE id = ?').get(docId);
    check(String(dbRow1.file) === String(files1[0]), 'ฐานข้อมูลชี้ไฟล์ใหม่', JSON.stringify(dbRow1));
    check(!fs.existsSync(path.join(UPLOAD_DIR, oldName)), 'ไฟล์ต้นฉบับถูกลบออกจากดิสก์แล้ว');
    const newName = String(files1[0]).split('/').pop();
    check(fs.existsSync(path.join(UPLOAD_DIR, newName)), 'ไฟล์ที่ปั้มถูกเก็บไว้บนดิสก์');
    check((r1.body.file_names || '').includes('ปั้มแล้ว'), 'คืน file_names ให้หน้าเว็บใช้ต่อ',
      JSON.stringify(r1.body.file_names));

    console.log('');
    console.log('② ไม่ได้ปั้ม (ไม่มี stamp_replace) → ต่อท้ายไฟล์ใหม่เหมือนเดิม');
    const r2 = await putWithFile(adminCookie, docId, {
      title: 'ทดสอบปั้มรับทับไฟล์',
      is_registered: '1',
      file_names: JSON.stringify(['หนังสือรับ (ปั้มแล้ว)', 'เอกสารเพิ่มเติม']),
    }, stamp('extra'));
    check(r2.status === 200, `PUT → 200 (ได้ ${r2.status})`);
    const files2 = Array.isArray(r2.body.files) ? r2.body.files : [];
    check(files2.length === 2, `มี 2 ไฟล์ (ได้ ${files2.length})`, JSON.stringify(files2));
    check(files2[0] === files1[0], 'ไฟล์เดิมยังอยู่ตำแหน่งแรก (ลำดับไม่กลับด้าน)', JSON.stringify(files2));
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    try {
      for (const id of madeDocs) {
        try { await db.prepare('DELETE FROM document_recipients WHERE document_id = ?').run(id); } catch (e) { /* ignore */ }
        try { await db.prepare('DELETE FROM document_school_targets WHERE document_id = ?').run(id); } catch (e) { /* ignore */ }
        try { await db.prepare('DELETE FROM documents WHERE id = ?').run(id); } catch (e) { /* ignore */ }
      }
      for (const f of madeFiles) {
        try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { /* ignore */ }
      }
      // ลบไฟล์ที่ระบบสร้างขึ้นระหว่างเทสต์ (ชื่อ zz-stamp-*)
      try {
        for (const f of fs.readdirSync(UPLOAD_DIR)) {
          if (/^zz-stamp-/.test(f)) fs.unlinkSync(path.join(UPLOAD_DIR, f));
        }
      } catch (e) { /* ignore */ }
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
