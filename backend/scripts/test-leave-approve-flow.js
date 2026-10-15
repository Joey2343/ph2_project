/**
 * ทดสอบสายอนุมัติการลา: ตรวจสอบ → อนุมัติขั้นต้น → อนุมัติ
 *
 * ทำไมต้องมี
 * ──────────
 * ผู้ใช้รายงานจากระบบจริงว่ากด "● อนุมัติขั้นต้น" แล้วได้
 *   "รายการนี้ได้รับการอนุมัติครบทุกขั้นแล้ว [PUT /api/leaves/1/approve · HTTP 400]"
 *   → กดไม่ได้เลย แม้แต่ครั้งเดียว ทุกคำขอลา
 *
 * สาเหตุจริง: นับขั้นไม่ตรงกันสองฝั่ง
 *   · ฝั่งระบบลามีขั้นพิเศษก่อน — ปุ่ม "▭ ตรวจสอบ" (PUT /leaves/:id/review)
 *     ซึ่ง push { level: 1 } ลง approval_data เสร็จ (ดู requests.js:917)
 *     และตั้ง reviewed = 1, approval_level = 1 แต่ status ยังเป็น 'pending'
 *   · แต่ approveRequest() เอา required มาจาก getRequiredLevels('leave')
 *     ซึ่งอ่าน settings approval_leave โดยตรง (ค่าเริ่มต้น = 1, บนระบบจริงก็ = 1)
 *     → หลังตรวจสอบแล้ว nextLevel = approvals.length + 1 = 2
 *     → 2 > 1 → ตอบ 400 "อนุมัติครบทุกขั้นแล้ว" ทันที
 *   → ผู้อนุมัติขั้นต้นไม่มีทางกดได้ ทุกคน ทุกคำขอ
 *
 *   test-leave-flow.js เดิมจับไม่ได้ เพราะหยุดที่ "ผู้ได้รับแต่งตั้งตรวจสอบได้"
 *   แล้วไม่เคยกด approve ต่อ — พอดีกับจุดที่พัง
 *
 * การแก้: required ของระบบลาต้องบวก 1 เพราะขั้นที่ 1 ถูก "ตรวจสอบ" ใช้ไปแล้ว
 *   approval_leave = 1 → ต้องตรวจสอบ + อนุมัติขั้นต้น  (2 ขั้นจริง)
 *   approval_leave = 2 → ตรวจสอบ + ขั้นต้น + อนุมัติ (3 ขั้นจริง)
 *
 * ใช้: node scripts/test-leave-approve-flow.js
 *   (ต้องเปิด backend ไว้ที่ TEST_BASE_URL หรือ http://127.0.0.1:3000)
 */
const http = require('http');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const url = new URL(BASE);

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
}

function req(method, p, body, cookie, isForm) {
  return new Promise((resolve) => {
    const headers = {};
    let payload = null;
    if (body) {
      if (isForm) { headers['Content-Type'] = body.boundary; payload = body.buffer; }
      else { headers['Content-Type'] = 'application/json'; payload = Buffer.from(JSON.stringify(body), 'utf8'); }
      headers['Content-Length'] = payload.length;
    }
    if (cookie) headers.Cookie = cookie;
    const r = http.request({ host: url.hostname, port: url.port || 80, path: p, method, headers, timeout: 30000 }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(b); } catch (e) { /* ไม่ใช่ JSON */ }
        resolve({ status: res.statusCode, j, raw: b, cookie: (res.headers['set-cookie'] || [])[0] || '' });
      });
    });
    r.on('error', (e) => resolve({ status: 0, j: null, raw: e.message }));
    if (payload) r.write(payload);
    r.end();
  });
}

const login = async (u, p) => {
  const r = await req('POST', '/api/auth/login', { username: u, password: p });
  return ((r.cookie || '').match(/sid=[^;]+/) || [])[0] || '';
};

function leaveForm(fields) {
  const B = '----ph2' + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, 'utf8'));
  }
  parts.push(Buffer.from(`--${B}--\r\n`, 'utf8'));
  return { boundary: 'multipart/form-data; boundary=' + B, buffer: Buffer.concat(parts) };
}

async function setApprovalLeave(db, n) {
  await db.prepare("INSERT INTO settings (`key`, value) VALUES ('approval_leave', ?) ON DUPLICATE KEY UPDATE value = ?")
    .run(String(n), String(n));
}
async function readApprovalLeave(db) {
  const r = await db.prepare("SELECT value FROM settings WHERE `key` = 'approval_leave'").get();
  return r ? r.value : null;
}

(async () => {
  const db = require(path.join(__dirname, '..', 'db.js'));
  await db.init();
  await db.bootstrap();

  const savedLeave = await readApprovalLeave(db);

  /* ── ① ตรรกะ leaveRequiredLevels() — ไม่ต้องมีเซิร์ฟเวอร์ ─────────────────
   *
   * วางไว้ก่อนข้อ ② เพราะข้อนี้ตรวจได้แม้ไม่ได้เปิด backend
   * (ตอนนี้ทุกข้อหลังจากนี้จะข้าม + exit 0 ถ้าล็อกอินไม่ได้
   *  ถ้าเอาไว้ท้ายสุด ใน CI ที่ไม่มีเซิร์ฟเวอร์ จะไม่มีอะไรตรวจเลย
   *  และบั๊กนี้จะกลับมาได้เงียบ ๆ เหมือนเดิม)
   */
  console.log('');
  console.log('① leaveRequiredLevels() ต้องนับขั้น "ตรวจสอบ" รวมด้วย');
  const approvalsLib = require(path.join(__dirname, '..', 'lib', 'approvals.js'));

  await setApprovalLeave(db, 1);
  check(await approvalsLib.leaveRequiredLevels() === 2,
    'approval_leave = 1 → required = 2 (ตรวจสอบ + อนุมัติขั้นต้น)',
    'ได้ ' + (await approvalsLib.leaveRequiredLevels())
    + ' · ถ้าได้ 1 ปุ่มอนุมัติขั้นต้นจะตอบ 400 เสมอ');

  await setApprovalLeave(db, 2);
  check(await approvalsLib.leaveRequiredLevels() === 3,
    'approval_leave = 2 → required = 3 (ตรวจสอบ + ขั้นต้น + อนุมัติ)',
    'ได้ ' + (await approvalsLib.leaveRequiredLevels()));

  await setApprovalLeave(db, 3);
  check(await approvalsLib.leaveRequiredLevels() === 3,
    'approval_leave = 3 → ล็อกที่ 3 (UI มีแค่ 3 ระดับ)',
    'ได้ ' + (await approvalsLib.leaveRequiredLevels()));

  check(await approvalsLib.getRequiredLevels('leave') === 3,
    'getRequiredLevels() ยังอ่านค่าดิบตามเดิม (ระบบอื่นไม่ถูกกระทบ)');
  check(await approvalsLib.getRequiredLevels('vehicle') >= 1,
    'ระบบอื่นยังใช้ getRequiredLevels() ตามเดิม');

  const admin = await login('admin', 'Joey2343**');
  if (!admin) {
    console.log('  – ข้ามข้อ ②-④: ล็อกอิน admin ไม่ได้ (backend ไม่ได้รันอยู่?)');
    if (savedLeave === null) await db.prepare("DELETE FROM settings WHERE `key` = 'approval_leave'").run();
    else await db.prepare("UPDATE settings SET value = ? WHERE `key` = 'approval_leave'").run(savedLeave);
    await db.close();
    console.log('');
    console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    process.exit(fail ? 1 : 0);
  }

  const created = [];

  /* ── ② approval_leave = 1 → ตรวจสอบแล้วต้องอนุมัติขั้นต้นได้ ─────────────── */
  console.log('');
  console.log('② approval_leave = 1 (ค่าที่ใช้อยู่บนระบบจริง)');

  await setApprovalLeave(db, 1);

  const f = leaveForm({
    leave_type: 'ลาป่วย', date_from: '2026-11-02', date_to: '2026-11-02',
    days: 1, writing_at: '', address: '', phone: '',
  });
  const created1 = await req('POST', '/api/leaves', f, admin, true);
  check(created1.status === 200, 'ยื่นคำขอลาได้', `ได้ HTTP ${created1.status}`);
  if (created1.j && created1.j.id) created.push(created1.j.id);

  if (created1.j && created1.j.id) {
    const id = created1.j.id;

    const rev = await req('PUT', `/api/leaves/${id}/review`, {}, admin);
    check(rev.status === 200, 'ขั้นที่ 1: ตรวจสอบสำเร็จ', `ได้ HTTP ${rev.status} · ${rev.raw.slice(0, 140)}`);

    const afterReview = await db.prepare('SELECT reviewed, status, approval_data FROM leave_requests WHERE id = ?').get(id);
    check(afterReview && afterReview.reviewed === 1, 'ตรวจสอบแล้ว reviewed = 1');
    check(afterReview && afterReview.status === 'pending', 'ยังรอผู้อนุมัติ (status = pending)',
      'ได้ ' + (afterReview && afterReview.status));
    check(afterReview && JSON.parse(afterReview.approval_data || '[]').length === 1,
      'approval_data มี 1 ขั้น (ผู้ตรวจสอบกิน level 1 ไปแล้ว)',
      'เคยเป็น [] → nextLevel = 1 ซึ่งไม่ใช่ 2');

    // ★ จุดที่พังจริง
    const app = await req('PUT', `/api/leaves/${id}/approve`, { note: 'ทดสอบ' }, admin);
    check(app.status === 200,
      'ขั้นที่ 2: อนุมัติขั้นต้นได้ (นี่คือจุดที่ผู้ใช้เจอ 400)',
      `ได้ HTTP ${app.status} · ${app.raw.slice(0, 160)}`
      + '\n        ข้อความ "รายการนี้ได้รับการอนุมัติครบทุกขั้นแล้ว" = required นับจาก approval_leave'
      + '\n        โดยลืมว่าขั้นที่ 1 ถูกปุ่ม "ตรวจสอบ" ใช้ไปแล้ว');

    if (app.status === 200) {
      const row2 = await db.prepare('SELECT status, approval_level, approval_data FROM leave_requests WHERE id = ?').get(id);
      check(row2 && row2.status === 'approved', 'approval_leave = 1 → อนุมัติครบ สถานะ approved', 'ได้ ' + (row2 && row2.status));
      check(row2 && row2.approval_level === 2, 'approval_level = 2', 'ได้ ' + (row2 && row2.approval_level));
    }
  }

  /* ── ③ approval_leave = 2 → ต้องมี 3 ขั้นจริง ───────────────────────────── */
  console.log('');
  console.log('③ approval_leave = 2 → ตรวจสอบ + ขั้นต้น + อนุมัติ');

  await setApprovalLeave(db, 2);

  const created2 = await req('POST', '/api/leaves', f, admin, true);
  check(created2.status === 200, 'ยื่นคำขอลาได้', `ได้ HTTP ${created2.status}`);
  if (created2.j && created2.j.id) created.push(created2.j.id);

  if (created2.j && created2.j.id) {
    const id = created2.j.id;
    const rev = await req('PUT', `/api/leaves/${id}/review`, {}, admin);
    check(rev.status === 200, 'ตรวจสอบสำเร็จ', `ได้ HTTP ${rev.status}`);

    const a2 = await req('PUT', `/api/leaves/${id}/approve`, { note: 'ขั้นต้น' }, admin);
    check(a2.status === 200, 'อนุมัติขั้นต้นได้', `ได้ HTTP ${a2.status} · ${a2.raw.slice(0, 160)}`);

    const mid = await db.prepare('SELECT status FROM leave_requests WHERE id = ?').get(id);
    check(mid && mid.status === 'pending', 'ยังไม่ครบ → ยังรอขั้นที่ 3', 'ได้ ' + (mid && mid.status));

    const a3 = await req('PUT', `/api/leaves/${id}/approve`, { note: 'ขั้นสุดท้าย' }, admin);
    check(a3.status === 200, 'อนุมัติขั้นสุดท้ายได้', `ได้ HTTP ${a3.status} · ${a3.raw.slice(0, 160)}`);

    const end = await db.prepare('SELECT status, approval_level FROM leave_requests WHERE id = ?').get(id);
    check(end && end.status === 'approved', 'ครบแล้ว → approved', 'ได้ ' + (end && end.status));
    check(end && end.approval_level === 3, 'approval_level = 3', 'ได้ ' + (end && end.approval_level));
  }

  /* ── ④ ตั้งค่า 3 ขั้นต้องไม่ทำให้หลุดไปหา level 4 ที่ UI ไม่มี ────────────── */
  console.log('');
  console.log('④ approval_leave = 3 → ล็อกที่ 3 ระดับ (UI มีแค่ 3 ระดับ)');
  await setApprovalLeave(db, 3);
  const created3 = await req('POST', '/api/leaves', f, admin, true);
  if (created3.j && created3.j.id) created.push(created3.j.id);
  if (created3.j && created3.j.id) {
    const id = created3.j.id;
    await req('PUT', `/api/leaves/${id}/review`, {}, admin);
    await req('PUT', `/api/leaves/${id}/approve`, {}, admin);
    const a4 = await req('PUT', `/api/leaves/${id}/approve`, {}, admin);
    check(a4.status === 200, 'ขั้นที่ 3 กดได้', `ได้ HTTP ${a4.status} · ${a4.raw.slice(0, 140)}`);
    const end = await db.prepare('SELECT status, approval_level FROM leave_requests WHERE id = ?').get(id);
    check(end && end.status === 'approved',
      'ครบใน 3 ระดับ ไม่หลุดไปหา level 4',
      'status=' + (end && end.status) + ' level=' + (end && end.approval_level));
    check(end && end.approval_level === 3, 'approval_level = 3', 'ได้ ' + (end && end.approval_level));
  }

  /* ── เก็บกวาด: เฉพาะแถวที่ตัวเองสร้าง ────────────────────────────────────── */
  for (const id of created) await db.prepare('DELETE FROM leave_requests WHERE id = ?').run(id);

  if (savedLeave === null) await db.prepare("DELETE FROM settings WHERE `key` = 'approval_leave'").run();
  else await db.prepare("UPDATE settings SET value = ? WHERE `key` = 'approval_leave'").run(savedLeave);

  await db.close();

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ทดสอบล้มเหลว:', e);
  process.exit(1);
});