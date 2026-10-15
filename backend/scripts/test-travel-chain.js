/**
 * ทดสอบสายอนุมัติไปราชการ — จำนวนขั้นต้องมาจากคอลัมน์ที่ admin เลือกรายคน
 *
 * ทำไมต้องมี
 * ──────────
 * ผู้ใช้รายงานว่า "ผู้อนุมัติไม่เป็นไปตามที่กำหนดในหน้า กำหนดผู้อนุมัติไปราชการ"
 *
 * สาเหตุ: จำนวนขั้นเคยนับจาก settings approval_travel (ค่ากลางของระบบ)
 *   บนระบบจริง approval_travel = 1 → ทุกคำขอจบที่ขั้น 1 ทันที
 *   คอลัมน์ "ผู้อนุมัติ" (ขั้น 2) ที่ตั้งไว้จึงไม่เคยถูกใช้
 *   ของจริงบนระบบจริง: ตั้ง นิตยา(ผู้บังคับบัญชาขั้นต้น) → มนัส(ผู้อนุมัติ)
 *   แต่คำขอ #1 จบที่ นิตยา พอดี ไม่เคยส่งต่อมนัส
 *
 *   เป็นบั๊กชนิดเดียวกับที่เจอที่ระบบลา (ดู test-leave-chain.js)
 *
 * แก้: travelChainLevels(requesterId) อ่าน travel_approvers รายคน
 *   สาย สพป.          : supervisor = ขั้น 1, approver = ขั้น 2
 *   สายสถานศึกษา    : reviewer = ขั้น 1, supervisor = ขั้น 2, approver = ขั้น 3
 *   คอลัมน์ที่ไม่ได้เลือก = ข้ามไป (เลขขั้นยังเป็นของเดิม)
 *
 * ใช้: node scripts/test-travel-chain.js
 *   (ข้อแรกไม่ต้องมีเซิร์ฟเวอร์ · ข้อที่เหลือข้าม + exit 0 ถ้าต่อเซิร์ฟเวอร์ไม่ได้)
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

function travelForm(fields) {
  const B = '----ph2' + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, 'utf8'));
  }
  parts.push(Buffer.from(`--${B}--\r\n`, 'utf8'));
  return { boundary: 'multipart/form-data; boundary=' + B, buffer: Buffer.concat(parts) };
}

const KEY = 'travel_approvers';
async function writeMap(db, obj) {
  await db.prepare('INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
    .run(KEY, JSON.stringify(obj));
}

(async () => {
  const db = require(path.join(__dirname, '..', 'db.js'));
  await db.init();
  await db.bootstrap();
  const approvalsLib = require(path.join(__dirname, '..', 'lib', 'approvals.js'));

  const savedRow = await db.prepare('SELECT value FROM settings WHERE `key` = ?').get(KEY);
  const savedRaw = savedRow ? savedRow.value : null;
  const restore = async () => {
    if (savedRaw === null) await db.prepare('DELETE FROM settings WHERE `key` = ?').run(KEY);
    else await db.prepare('UPDATE settings SET value = ? WHERE `key` = ?').run(savedRaw, KEY);
  };

  /* ── ① travelChainLevels() อ่านจากคอลัมน์ที่ตั้ง (ไม่ต้องมีเซิร์ฟเวอร์) ──── */
  console.log('');
  console.log('① travelChainLevels() อ่านจากหน้า ⊛ กำหนดผู้อนุมัติไปราชการ');

  const adminId = 1;
  // ผู้ขอที่ใช้ทดสอบ = เจ้าหน้าที่ สพป. คนที่ 2 (เหมือน test-leave-chain.js)
  const r2 = await db.prepare("SELECT id, username FROM users WHERE status='active' AND id <> ? AND (user_group IS NULL OR user_group <> 'school') ORDER BY id LIMIT 1").get(adminId);
  const requesterId = r2 ? r2.id : adminId;
  const requesterCookie = r2 ? await login(r2.username, 'Test1234**') : '';
  const submitAs = requesterCookie || (await login('admin', 'Joey2343**'));

  const cases = [
    [{ [requesterId]: { supervisor: 3, approver: 5 } }, [1, 2], 'ตั้ง supervisor+approver → 2 ขั้น'],
    [{ [requesterId]: { supervisor: 3 } }, [1], 'ตั้งแค่ supervisor → 1 ขั้น'],
    [{ [requesterId]: { approver: 5 } }, [2], 'ตั้งแค่ approver → 1 ขั้น (ข้ามขั้น 1)'],
    [{}, [1, 2], 'ไม่ได้ตั้งอะไร → ค่าเริ่มต้น 2 ขั้น (ไม่ทำให้คำขอค้าง)'],
  ];
  for (const [obj, want, label] of cases) {
    await writeMap(db, obj);
    const got = await approvalsLib.travelChainLevels(requesterId);
    check(JSON.stringify(got) === JSON.stringify(want), label,
      `ได้ [${got}] · คาดว่า [${want}]`);
  }

  // ตั้งค่า approval_travel ไว้เท่าไรก็ตาม ต้องไม่กระทบสาย
  await db.prepare("INSERT INTO settings (`key`, value) VALUES ('approval_travel', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)").run('1');
  await writeMap(db, { [requesterId]: { supervisor: 3, approver: 5 } });
  check(await approvalsLib.travelRequiredLevels(requesterId) === 2,
    'approval_travel = 1 ก็ยังได้ 2 ขั้น (ค่ากลางไม่มีผลกับระบบไปราชการอีกแล้ว)',
    'ได้ ' + (await approvalsLib.travelRequiredLevels(requesterId)) + ' · เคยได้ 1 ทำให้คอลัมน์ผู้อนุมัติไม่เคยถูกใช้');

  const admin = await login('admin', 'Joey2343**');
  if (!admin) {
    console.log('  – ข้ามข้อ ②-③: ล็อกอิน admin ไม่ได้ (backend ไม่ได้รันอยู่?)');
    await restore();
    await db.close();
    console.log('');
    console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    process.exit(fail ? 1 : 0);
  }

  const created = [];
  const f = travelForm({
    travel_subject: 'ทดสอบสายอนุมัติ', destination: 'กรุงเทพฯ',
    date_from: '2026-11-10', date_to: '2026-11-11', days: 2, budget: '0', form_data: '{}',
  });
  const rowOf = async (id) => await db.prepare('SELECT status, approval_level, approval_data FROM travel_requests WHERE id = ?').get(id);
  const lvOf = async (id) => JSON.parse((await rowOf(id)).approval_data || '[]').map((a) => a.level);

  /* ── ② สาย 2 ขั้น: ขั้น 1 ต้องส่งต่อผู้อนุมัติ (อาการที่ผู้ใช้เจอ) ────────── */
  console.log('');
  console.log('② สาย 2 ขั้น (supervisor → approver) — ขั้น 1 ต้องส่งต่อ ไม่ใช่จบทันที');
  await writeMap(db, { [requesterId]: { supervisor: 3, approver: 5 } });

  const c1 = await req('POST', '/api/travel', f, submitAs, true);
  check(c1.status === 200, 'ยื่นคำขอได้', `ได้ HTTP ${c1.status} · ยื่นในชื่อ user ${requesterId}`);
  if (c1.j && c1.j.id) created.push(c1.j.id);
  if (c1.j && c1.j.id) {
    const id = c1.j.id;
    const list = await req('GET', '/api/travel?group=office', null, admin);
    const mine = ((list.j && list.j.requests) || []).find((x) => x.id === id);
    check(mine && JSON.stringify(mine.chain) === JSON.stringify([1, 2]),
      'API ส่ง chain = [1,2] ให้หน้าเว็บใช้วาดปุ่ม',
      'ได้ ' + JSON.stringify(mine && mine.chain));
    check(mine && mine.required_levels === 2,
      'required_levels = 2 (เคยเป็น 1 เพราะ approval_travel)',
      'ได้ ' + (mine && mine.required_levels));

    const a1 = await req('PUT', `/api/travel/${id}/approve`, { note: 'ขั้นต้น' }, admin);
    check(a1.status === 200, 'ขั้น 1 ผู้บังคับบัญชาขั้นต้นอนุมัติได้', `ได้ HTTP ${a1.status} · ${a1.raw.slice(0, 150)}`);
    check(a1.j && a1.j.approved === false,
      'ยังไม่ถือว่าอนุมัติครบ (ต้องส่งต่อผู้อนุมัติ) — นี่คืออาการที่ผู้ใช้เจอ',
      'ได้ approved=' + (a1.j && a1.j.approved));
    check((await rowOf(id)).status === 'pending', 'สถานะยัง pending รอผู้อนุมัติ');

    const a2 = await req('PUT', `/api/travel/${id}/approve`, { note: 'ขั้นสุดท้าย' }, admin);
    check(a2.status === 200, 'ขั้น 2 ผู้อนุมัติได้', `ได้ HTTP ${a2.status} · ${a2.raw.slice(0, 150)}`);
    check(a2.j && a2.j.approved === true, 'ครบสายแล้ว approved');
    check(JSON.stringify(await lvOf(id)) === JSON.stringify([1, 2]), 'approval_data = [1,2]',
      'ได้ [' + (await lvOf(id)).join(',') + ']');
  }

  /* ── ③ ตั้งแค่ supervisor → 1 ขั้น จบเลย ────────────────────────────────── */
  console.log('');
  console.log('③ ตั้งแค่ supervisor → 1 ขั้น');
  await writeMap(db, { [requesterId]: { supervisor: 3 } });

  const c2 = await req('POST', '/api/travel', f, submitAs, true);
  if (c2.j && c2.j.id) created.push(c2.j.id);
  if (c2.j && c2.j.id) {
    const id = c2.j.id;
    const a1 = await req('PUT', `/api/travel/${id}/approve`, { note: 'ตรวจสอบ' }, admin);
    check(a1.status === 200, 'ขั้นเดียวอนุมัติได้', `ได้ HTTP ${a1.status} · ${a1.raw.slice(0, 150)}`);
    check(a1.j && a1.j.approved === true, 'จบที่ขั้นเดียว ไม่รอขั้นที่ไม่มี');
    check(JSON.stringify(await lvOf(id)) === JSON.stringify([1]), 'approval_data = [1]');
  }

  /* ── ④ ตั้งแค่ approver → ขั้นแรกที่รอคือ "ผู้อนุมัติ" (ขั้น 2) ไม่ใช่ขั้น 1 ──
   *
   * ⚠️ ข้อนี้คือกรณีเดียวที่ "นับตำแหน่ง" ใช้ไม่ได้
   *   ถ้า route ย้อนกลับไปใช้ requiredFn (nextLevel = approvals.length + 1)
   *     → required = 1, nextLevel = 1 → ไปตรวจ entry.supervisor ซึ่งไม่ได้ตั้ง
   *     → 403 "คุณไม่มีสิทธิ์อนุมัติขั้นนี้" แม้ผู้อนุมัติจะเป็นคนที่ตั้งไว้จริง
   *   ส่วนสาย [1] / [1,2] จะผ่านมาแม้ย้อนโค้ด (เลขขั้นเรียงติดกัน ตำแหน่งเท่ากับเลขขั้น)
   *   จึงต้องมีข้อนี้ไว้ ไม่งั้นเทสต์จะผ่านทั้งที่บั๊กกลับมา
   */
  console.log('');
  console.log('④ ตั้งแค่ approver (ไม่ตั้ง supervisor) → ขั้นแรกที่รอคือผู้อนุมัติ');
  await writeMap(db, { [requesterId]: { approver: 5 } });

  const c3 = await req('POST', '/api/travel', f, submitAs, true);
  check(c3.status === 200, 'ยื่นคำขอได้', `ได้ HTTP ${c3.status}`);
  if (c3.j && c3.j.id) created.push(c3.j.id);
  if (c3.j && c3.j.id) {
    const id = c3.j.id;
    const list = await req('GET', '/api/travel?group=office', null, admin);
    const mine = ((list.j && list.j.requests) || []).find((x) => x.id === id);
    check(mine && JSON.stringify(mine.chain) === JSON.stringify([2]),
      'chain = [2] (ข้ามขั้น 1 ที่ไม่ได้ตั้ง)', 'ได้ ' + JSON.stringify(mine && mine.chain));

    const a1 = await req('PUT', `/api/travel/${id}/approve`, { note: 'อนุมัติ' }, admin);
    // ⚠️ ข้อนี้ทดสอบด้วย admin เพราะ admin ผ่าน canTravelApprover เสมอ
    //   ผู้ใช้ทั่วไปจะโดน 403 ถ้าไปตรวจ entry.supervisor ที่ไม่ได้ตั้ง
    //   จึงตรวจจาก "เลขขั้นที่บันทึก" แทน ซึ่งจับบั๊กได้ชัดกว่า
    check(a1.status === 200, 'กดอนุมัติได้', `ได้ HTTP ${a1.status} · ${a1.raw.slice(0, 150)}`);
    check(a1.j && a1.j.level === 2,
      'บันทึกเป็นขั้นที่ 2 (ผู้อนุมัติ) ไม่ใช่ขั้น 1',
      'ได้ level=' + (a1.j && a1.j.level)
      + ' · ได้ 1 = route กลับไปใช้ requiredFn แล้วนับตำแหน่งแทนอ่านสาย');
    check(a1.j && a1.j.approved === true, 'จบเลย เพราะสายมีขั้นเดียว');
  }

  /* ── เก็บกวาด ──────────────────────────────────────────────────────────── */
  for (const id of created) await db.prepare('DELETE FROM travel_requests WHERE id = ?').run(id);
  await restore();
  await db.close();

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ทดสอบล้มเหลว:', e);
  process.exit(1);
});