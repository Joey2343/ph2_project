/**
 * ทดสอบว่าชื่อไฟล์ (documents.file_names) ยังตรงกับไฟล์จริงหลังแก้ไขหนังสือ
 *
 * ทำไมต้องมี
 * ──────────
 * documents.file เก็บ path เป็น JSON array
 * documents.file_names เก็บชื่อที่ผู้ใช้ตั้งเอง เป็น JSON array ที่เรียงตรงกับ file
 *
 * ตอนลงทะเบียน/ปั้มรับ (is_registered=1) backend เก็บไฟล์เดิมไว้ก่อน แล้วต่อท้ายด้วยไฟล์ใหม่
 * ถ้าต่อท้ายด้วย unshift ต่อทีละไฟล์ ลำดับไฟล์เดิมจะกลับด้าน:
 *
 *   oldFiles = [a, b]  newFiles = [c]
 *   unshift(a) → [a, c]
 *   unshift(b) → [b, a, c]        ← กลับด้านจาก [a, b]
 *
 * เดิมไม่มีผลกระทบ เพราะทุกไฟล์แสดงชื่อจาก path ตัวเอง
 * แต่พอมี file_names ที่ผูกด้วยลำดับ index → ชื่อจะไปตกกับไฟล์ผิดตัว
 *
 * เทสต์นี้ต้องรันหลังเซิร์ฟเวอร์เริ่มแล้ว (ต้องการ HTTP + MariaDB)
 * ใช้: node scripts/test-file-names.js
 */
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
}

const ROOT = path.join(__dirname, '..');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const ADMIN_USER = process.env.TEST_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.TEST_ADMIN_PASS || 'Joey2343**';

/* ---------- ช่วยเรื่อง HTTP ---------- */
async function login() {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

async function sendForm(cookie, method, p, fd) {
  const res = await fetch(BASE + p, { method, body: fd, headers: { Cookie: cookie } });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) { /* ignore */ }
  return { status: res.status, body, raw: text };
}

/** PNG 1x1 พร้อม marker ต่อท้าย เพื่อให้แต่ละไฟล์ไม่ซ้ำกัน */
function pngFile(name, seed) {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  return new File([Buffer.from(b64, 'base64'), Buffer.from('//' + seed)], name, { type: 'image/png' });
}

/* ---------- ตรวจโค้ด (ไม่ต้องมีเซิร์ฟเวอร์) ---------- */
console.log('');
console.log('โค้ดต่อท้ายไฟล์เดิม (ต้องไม่ใช้ unshift):');
const adminSrc = fs.readFileSync(path.join(ROOT, 'routes', 'admin.js'), 'utf8');
const iReg = adminSrc.indexOf('oldFiles');
check(iReg !== -1, 'พบจุดต่อท้ายไฟล์เดิมใน routes/admin.js');
const region = iReg === -1 ? '' : adminSrc.slice(iReg - 400, iReg + 700);
check(!/unshift\s*\(/.test(region),
  'ไม่มี unshift ต่อทีละไฟล์ (ลำดับไฟล์เดิมจะกลับด้าน)',
  'ต้องใช้ oldFiles.concat(…) เพื่อคงลำดับเดิม');
check(/oldFiles\.concat\s*\(/.test(region),
  'ใช้ oldFiles.concat(…) ต่อท้ายไฟล์ใหม่');

/* ---------- ทดสอบกับเซิร์ฟเวอร์จริง ---------- */
console.log('');
console.log('ทดสอบกับเซิร์ฟเวอร์จริง:');

(async () => {
  let cookie = '';
  try {
    cookie = await login();
  } catch (e) {
    console.log(`  – ข้าม: ติดต่อ ${BASE} ไม่ได้ (${e.message}) — ให้เปิดเซิร์ฟเวอร์ก่อน`);
    console.log('');
    console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    process.exit(fail ? 1 : 0);
  }
  if (!cookie) {
    console.log(`  – ข้าม: ล็อกอินไม่สำเร็จ (${ADMIN_USER})`);
    console.log('');
    console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    process.exit(fail ? 1 : 0);
  }

  // ── สร้างหนังสือที่มี 3 ไฟล์ ชื่อ A,B,C
  const fd = new FormData();
  fd.append('doc_type', 'incoming');
  fd.append('from_org', 'โรงเรียนทดสอบ');
  fd.append('title', 'ทดสอบลำดับไฟล์แนบ');
  fd.append('doc_no', 'ที่ สถ 999/001');
  fd.append('date', '2026-10-12');
  fd.append('reg_no', '1');
  fd.append('is_registered', '1');
  fd.append('file_names', JSON.stringify(['ชื่อA', 'ชื่อB', 'ชื่อC']));
  fd.append('files', pngFile('a.png', 'A'));
  fd.append('files', pngFile('b.png', 'B'));
  fd.append('files', pngFile('c.png', 'C'));

  const mk = await sendForm(cookie, 'POST', '/api/documents', fd);
  const id = mk.body && mk.body.id;
  if (!id) {
    console.log(`  ✖ สร้างหนังสือทดสอบไม่สำเร็จ: ${(mk.raw || '').slice(0, 160)}`);
    console.log('');
    console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail + 1}`);
    process.exit(1);
  }

  // ── อ่านค่าจาก API (ไม่พึ่ง SQL — ใช้ได้กับทุกสภาพแวดล้อม)
  const readRow = async () => {
    const res = await fetch(`${BASE}/api/documents?q=${encodeURIComponent('ทดสอบลำดับไฟล์แนบ')}`, {
      headers: { Cookie: cookie },
    });
    const j = await res.json();
    const list = j.documents || j.docs || j.items || j.data || [];
    const row = list.find((x) => String(x.id) === String(id)) || list[0];
    if (!row) return null;
    const files = (() => {
      if (!row.file) return [];
      try { const a = JSON.parse(row.file); return Array.isArray(a) ? a : [row.file]; }
      catch (e) { return [row.file]; }
    })();
    const names = (() => {
      if (!row.file_names) return [];
      try { const a = JSON.parse(row.file_names); return Array.isArray(a) ? a : []; }
      catch (e) { return []; }
    })();
    return { files, names };
  };

  const before = await readRow();
  check(!!before, 'อ่านรายการที่สร้างได้');
  if (before) {
    check(before.files.length === 3, `สร้างได้ 3 ไฟล์ (ได้ ${before.files.length})`);
    check(before.names.length === 3, `ชื่อไฟล์ 3 รายการ (ได้ ${before.names.length})`);
    check(before.names.join(',') === 'ชื่อA,ชื่อB,ชื่อC', 'ชื่อเรียงถูกต้องตอนสร้าง');
  }

  // ── แก้ไข: เพิ่มไฟล์ที่ 4 ชื่อ D
  const fd2 = new FormData();
  fd2.append('title', 'ทดสอบลำดับไฟล์แนบ');
  fd2.append('doc_type', 'incoming');
  fd2.append('is_registered', '1');
  fd2.append('file_names', JSON.stringify(['ชื่อA', 'ชื่อB', 'ชื่อC', 'ชื่อD']));
  fd2.append('files', pngFile('d.png', 'D'));
  const up = await sendForm(cookie, 'PUT', '/api/documents/' + id, fd2);
  check(up.status === 200, `แก้ไขสำเร็จ (HTTP ${up.status})`);

  const after = await readRow();
  check(!!after, 'อ่านรายการหลังแก้ไขได้');
  if (before && after) {
    const samePrefix = after.files.slice(0, before.files.length).join('|') === before.files.join('|');
    check(samePrefix,
      'ไฟล์เดิมยังอยู่ครบและเรียงลำดับเดิม (ไม่กลับด้าน)',
      'ก่อน: ' + before.files.map((f) => f.split('/').pop()).join(', ') +
      '\n        หลัง: ' + after.files.slice(0, before.files.length).map((f) => f.split('/').pop()).join(', '));
    check(after.files.length === 4, `รวมไฟล์ใหม่แล้วเป็น 4 ไฟล์ (ได้ ${after.files.length})`);
    check(after.names.length === after.files.length,
      `จำนวนชื่อเท่าจำนวนไฟล์ (${after.names.length} / ${after.files.length})`);
    check(after.names.join(',') === 'ชื่อA,ชื่อB,ชื่อC,ชื่อD', 'ชื่อเรียงถูกต้องหลังแก้ไข');
  }

  // ── ลบรายการทดสอบทิ้ง
  try {
    await fetch(`${BASE}/api/documents/${id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
  } catch (e) { /* ลบไม่ได้ก็ข้าม ไม่ทำให้เทสต์พัง */ }

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})();