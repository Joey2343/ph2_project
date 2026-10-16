/**
 * ทดสอบว่าลบหนังสือที่มีไฟล์แนบหลายไฟล์ แล้วไฟล์บนดิสก์ถูกลบตามจริง
 *
 * ทำไมต้องมี
 * ──────────
 * documents.file เก็บไฟล์แนบเป็น JSON array เมื่อมีมากกว่า 1 ไฟล์
 *   1 ไฟล์  → เก็บเป็น path ธรรมดา  "documents/xxx.png"
 *   2+ ไฟล์ → เก็บเป็น JSON      '["documents/a.png","documents/b.png"]'
 *
 * แต่ deleteUploadedFile() รับ "ชื่อไฟล์เดี่ยว"
 *   พอได้ JSON array ที่มี "/" อยู่ข้างใน → เข้าที่ includeสร้างพาธปลอม
 *   → path ไม่มีจริง → ไม่ลบอะไรเลย
 *
 * ผลคือ ทุกครั้งที่ลบหนังสือที่มี 2 ไฟล์ขึ้นไป ไฟล์แนบทั้งหมดค้างบนดิสก์
 * ไม่ใช่แค่ของเทสต์ — ผู้ใช้จริงที่ลบหนังสือก็เจอปัญหานี้
 *
 * เทสต์นี้ตรวจ 2 ชั้น
 *   ① เรียก deleteUploadedFile() ตรง ๆ ด้วยค่ารูปแบบ array (ไม่ต้องมีเซิร์ฟเวอร์)
 *   ② สร้างหนังสือจริง 3 ไฟล์ → ลบ → เช็กว่าไฟล์หายจากดิสก์จริง
 *
 * ใช้: node scripts/test-upload-cleanup.js
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
const UPLOAD_DIR = path.join(ROOT, 'public', 'uploads');
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const ADMIN_USER = process.env.TEST_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.TEST_ADMIN_PASS || 'Joey2343**';

/** แปลงค่าในคอลัมน์ไฟล์เป็นพาธเต็มบนดิสก์ (รองรับทั้ง string และ JSON array) */
function toDiskPaths(value) {
  let list = [];
  if (Array.isArray(value)) list = value;
  else if (typeof value === 'string' && value.trim().startsWith('[')) {
    try { const d = JSON.parse(value); if (Array.isArray(d)) list = d; } catch (e) { /* ignore */ }
  } else if (typeof value === 'string' && value.trim()) list = [value];
  return list.filter((f) => typeof f === 'string' && f)
    .map((f) => path.join(UPLOAD_DIR, f));
}

/** PNG 1x1 + marker เพื่อให้แต่ละไฟล์ไม่ซ้ำกัน */
function pngFile(name, seed) {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  return new File([Buffer.from(b64, 'base64'), Buffer.from('//' + seed)], name, { type: 'image/png' });
}

/* ══════════════════════════════════════════════════════════════════════════
   ① ตรวจ deleteUploadedFile() ตรง ๆ — ไม่ต้องมีเซิร์ฟเวอร์
   ═════════════════════════════════════════════════════════════════════════ */
console.log('');
console.log('① deleteUploadedFile() ต้องลบได้ทั้งแบบไฟล์เดี่ยว และแบบ JSON array');

const { deleteUploadedFile } = require(path.join(ROOT, 'lib', 'uploads.js'));
const TMP = path.join(UPLOAD_DIR, 'documents');

// สร้างไฟล์จริง 3 ไฟล์ในโฟลเดอร์ documents
const made = [];
for (const nm of ['tmp-cleanup-1.png', 'tmp-cleanup-2.png', 'tmp-cleanup-3.png']) {
  const p = path.join(TMP, nm);
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(p, 'tmp');
  made.push(p);
}
check(made.every((p) => fs.existsSync(p)), 'สร้างไฟล์ทดสอบ 3 ไฟล์ได้');

// ลบผ่านค่าแบบ JSON array (รูปแบบที่ documents.file ใช้จริงเมื่อมี 2+ ไฟล์)
const asArray = JSON.stringify(made.map((p) => 'documents/' + path.basename(p)));
deleteUploadedFile(asArray);
check(!fs.existsSync(made[0]) && !fs.existsSync(made[1]) && !fs.existsSync(made[2]),
  'ลบผ่าน JSON array → ไฟล์ทั้ง 3 หายจากดิสก์',
  'ยังเหลือ: ' + made.filter((p) => fs.existsSync(p)).map((p) => path.basename(p)).join(', '));

// ลบผ่านค่าแบบไฟล์เดี่ยว (ต้องยังทำงานเหมือนเดิม ไม่พัง)
const one = path.join(TMP, 'tmp-cleanup-single.png');
fs.writeFileSync(one, 'tmp');
deleteUploadedFile('documents/tmp-cleanup-single.png');
check(!fs.existsSync(one), 'ลบผ่านชื่อไฟล์เดี่ยว → ยังทำงานถูกต้อง');

// ต้องไม่ลบไฟล์นอกโฟลเดอร์ uploads (กัน path traversal)
const outside = path.join(ROOT, 'public', 'tmp-cleanup-outside.png');
fs.writeFileSync(outside, 'tmp');
deleteUploadedFile('../public/tmp-cleanup-outside.png');
check(fs.existsSync(outside), 'ค่าที่พยายามออกนอก uploads ต้องไม่ถูกลบ (กัน path traversal)');
fs.unlinkSync(outside);

// ล้างไฟล์ที่หลงเหลือ (กันเทสต์พังกลางคัน)
for (const p of made) { if (fs.existsSync(p)) fs.unlinkSync(p); }

/* ══════════════════════════════════════════════════════════════════════════
   ② ทดสอบกับเซิร์ฟเวอร์จริง — สร้างหนังสือ 3 ไฟล์ แล้วลบ
   ═════════════════════════════════════════════════════════════════════════ */

async function login() {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

(async () => {
  console.log('');
  console.log('② สร้างหนังสือจริง 3 ไฟล์ → ลบ → ต้องไม่มีไฟล์ค้าง');

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

  const TITLE = 'ทดสอบลบไฟล์แนบค้าง ' + Date.now();
  const created = [];      // ไฟล์ที่เทสต์นี้สร้าง — ลบทิ้งเสมอ ไม่ว่าจะผ่านหรือไม่
  let docId = null;

  try {
    const fd = new FormData();
    fd.append('doc_type', 'incoming');
    fd.append('from_org', 'โรงเรียนทดสอบลบไฟล์');
    fd.append('title', TITLE);
    fd.append('doc_no', 'ที่ ทด 999/999');
    fd.append('date', '2026-10-16');
    fd.append('reg_no', '1');
    fd.append('is_registered', '1');
    fd.append('files', pngFile('x1.png', 'X1'));
    fd.append('files', pngFile('x2.png', 'X2'));
    fd.append('files', pngFile('x3.png', 'X3'));

    const mk = await fetch(BASE + '/api/documents', { method: 'POST', body: fd, headers: { Cookie: cookie } });
    const mkText = await mk.text();
    let mkBody = null;
    try { mkBody = JSON.parse(mkText); } catch (e) { /* ignore */ }
    docId = mkBody && mkBody.id;
    if (!docId) {
      console.log(`  ✖ สร้างหนังสือทดสอบไม่สำเร็จ: ${mkText.slice(0, 160)}`);
      fail += 1;
    } else {
      // อ่านค่า file ที่บันทธิการเก็บไว้จริง
      const q = await fetch(`${BASE}/api/documents?q=${encodeURIComponent(TITLE)}`, { headers: { Cookie: cookie } });
      const j = await q.json();
      const list = j.documents || j.docs || j.items || j.data || [];
      const row = list.find((x) => String(x.id) === String(docId));
      const disk = toDiskPaths(row && row.file);
      disk.forEach((p) => created.push(p));

      check(disk.length === 3, `สร้างหนังสือได้และมีไฟล์ 3 ตัว (ได้ ${disk.length})`);
      check(disk.every((p) => fs.existsSync(p)),
        'ไฟล์แนบอยู่บนดิสก์จริงก่อนลบ',
        'ไม่พบ: ' + disk.filter((p) => !fs.existsSync(p)).map((p) => path.basename(p)).join(', '));

      // ── ลบหนังสือ ──
      const del = await fetch(`${BASE}/api/documents/${docId}`, { method: 'DELETE', headers: { Cookie: cookie } });
      check(del.status === 200, `ลบหนังสือสำเร็จ (HTTP ${del.status})`);
      docId = null;

      const left = disk.filter((p) => fs.existsSync(p));
      check(left.length === 0,
        'ไฟล์แนบหายจากดิสก์หมดหลังลบหนังสือ',
        `ค้าง ${left.length} ไฟล์: ${left.map((p) => path.basename(p)).join(', ')}\n`
        + '      → documents.file เก็บเป็น JSON array แต่ deleteUploadedFile() รับชื่อไฟล์เดียว');
    }
  } catch (e) {
    fail += 1;
    console.log(`  ✖ ทดสอบล้มเหลว: ${e.message}`);
  } finally {
    // ── ล้างให้สะอาดเสมอ ──
    // นี่คือหัวใจของงานนี้: เทสต์ต้องไม่ทิ้งไฟล์ก้าวค้างไว้ใน uploads/
    if (docId) {
      try {
        await fetch(`${BASE}/api/documents/${docId}`, { method: 'DELETE', headers: { Cookie: cookie } });
      } catch (e) { /* ignore */ }
    }
    let cleaned = 0;
    for (const p of created) {
      try { if (fs.existsSync(p)) { fs.unlinkSync(p); cleaned += 1; } } catch (e) { /* ignore */ }
    }
    if (cleaned) console.log(`  (ล้างไฟล์ทดสอบทิ้ง ${cleaned} ไฟล์ — ไม่ให้เป็นภาระของรอบถัดไป)`);
  }

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})();