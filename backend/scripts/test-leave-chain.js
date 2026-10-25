/**
 * ทดสอบสายอนุมัติการลา — จำนวนขั้นต้องมาจากที่ admin เลือกรายคน
 *
 * ทำไมต้องมี
 * ──────────
 * ผู้ใช้รายงานจากระบบจริง 2 อาการติดกัน ทั้งคู่มาจากสาเหตุเดียวกัน
 *
 *   ① กด "● อนุมัติขั้นต้น" แล้วได้ 400 "รายการนี้ได้รับการอนุมัติครบทุกขั้นแล้ว"
 *   ② กด "● อนุมัติขั้นต้น" แล้วขึ้นว่า "อนุมัติครบทุกขั้นแล้ว" โดยไม่ส่งต่อผู้อนุมัติ
 *
 * สาเหตุ: จำนวนขั้นเคยนับจาก settings approval_leave (ค่ากลางของระบบ)
 *   แต่ระบบลาต่างจากระบบอื่น 2 จุด
 *     · มีปุ่ม "▭ ตรวจสอบ" เป็นขั้นแยกก่อน (กิน ❶ ไปแล้ว)
 *     · จำนวนขั้นต่างกัน "รายคน" ตามที่ admin เลือกในหน้า ⊛ เจ้าหน้าที่การลา
 *
 * ตอนนี้ใช้ leaveChainLevels(requesterId) ซึ่งอ่านจาก leave_approvers รายคน
 *   ตั้ง ❶+❷+❸ → ตรวจสอบ → อนุมัติขั้นต้น → อนุมัติ   (3 ขั้น) ← อาการ ② หายเมื่อแก้แล้ว
 *   ตั้ง ❶+❸     → ตรวจสอบ → อนุมัติ                 (2 ขั้น ข้าม ❷)
 *   ตั้ง ❶        → ตรวจสอบ                            (1 ขั้น จบที่ตรวจสอบ)
 *
 * ใช้: node scripts/test-leave-chain.js
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

function leaveForm(fields) {
  const B = '----ph2' + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, 'utf8'));
  }
  parts.push(Buffer.from(`--${B}--\r\n`, 'utf8'));
  return { boundary: 'multipart/form-data; boundary=' + B, buffer: Buffer.concat(parts) };
}

/** เขียน leave_approvers ชั่วคราว (แบกอัปแล้วคืนค่าเดิมตอนจบ) */
async function saveApprovers(db, saved, obj) {
  const json = JSON.stringify(obj);
  await db.prepare('INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
    .run('leave_approvers', json);
  return saved;
}
function restore(saved) {
  if (saved === null) return null;
  return JSON.stringify(saved);
}

(async () => {
  const db = require(path.join(__dirname, '..', 'db.js'));
  await db.init();
  await db.bootstrap();
  const approvalsLib = require(path.join(__dirname, '..', 'lib', 'approvals.js'));

  const savedRow = await db.prepare("SELECT value FROM settings WHERE `key` = 'leave_approvers'").get();
  const savedRaw = savedRow ? savedRow.value : null;

  /* ── ① leaveChainLevels() อ่านจากการตั้งค่ารายคน (ไม่ต้องมีเซิร์ฟเวอร์) ──── */
  console.log('');
  console.log('① leaveChainLevels() อ่านจากหน้าเจ้าหน้าที่การลา');

  const adminId = 1;
  // ⚠️ "ผู้ขอ" ต้องเป็นคนที่เราจะตั้งสายให้ และต้องยื่นคำขอในชื่อเขา
  //   ถ้ายื่นด้วย admin แต่ไปตั้ง leave_approvers ของคนอื่น ระบบจะอ่านสายของ admin → เทสต์หลอกตัวเอง
  const requester = await db.prepare(
    // ⚠️ เรียงคนที่ "ไม่มีค่า Telegram" ขึ้นก่อน — กันเทสต์ส่งข้อความจริงถึงผู้ใช้
    //   (ฐาน dev มี telegram_token/chat_id จริง · ถ้าเลือกคนนั้น การอนุมัติจะส่งจริง
    //    แล้วเทสต์ลบรายการทิ้ง → ผู้ใช้ได้ข้อความของรายการที่ไม่มีอยู่ · เจอจริง 25 ต.ค. 2569)
    `SELECT id, username, COALESCE(telegram_token,'') AS telegram_token
       FROM users WHERE status='active' AND id <> ? AND (user_group IS NULL OR user_group <> 'school')
      ORDER BY (COALESCE(telegram_token,'') = '' AND COALESCE(telegram_chat_id,'') = '') DESC, id LIMIT 1`,
  ).get(adminId);
  const requesterId = requester ? requester.id : adminId;
  const requesterCookie = requester ? await login(requester.username, 'Test1234**') : '';
  const submitAs = requesterCookie ? requesterCookie : (await login('admin', 'Joey2343**'));
  if (requester && requester.telegram_token) {
    console.log(`  ⚠ ผู้ขอ (${requester.username}) มีค่า Telegram — ถ้าเซิร์ฟเวอร์ไม่ได้ตั้ง TELEGRAM_DISABLED=1 จะส่งข้อความจริง`);
  }

  const cases = [
    [{ 1: { [requesterId]: 3 }, 2: { [requesterId]: 20 }, 3: { [requesterId]: 5 } }, [1, 2, 3], 'ตั้ง ❶+❷+❸ → 3 ขั้น'],
    [{ 1: { [requesterId]: 3 }, 3: { [requesterId]: 5 } }, [1, 3], 'ตั้ง ❶+❸ → 2 ขั้น (ข้าม ❷)'],
    [{ 1: { [requesterId]: 3 } }, [1], 'ตั้ง ❶ อย่างเดียว → 1 ขั้น'],
    [{ 2: { [requesterId]: 20 }, 3: { [requesterId]: 5 } }, [2, 3], 'ไม่ได้ตั้ง ❶ → เริ่มที่ ❷'],
    [{}, [1, 2, 3], 'ไม่ได้ตั้งอะไรเลย → ค่าเริ่มต้น 3 ขั้น (ไม่ทำให้คำขาค้าง)'],
  ];
  for (const [obj, want, label] of cases) {
    await db.prepare('INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
      .run('leave_approvers', JSON.stringify(obj));
    const got = await approvalsLib.leaveChainLevels(requesterId);
    check(JSON.stringify(got) === JSON.stringify(want), label,
      `ได้ [${got}] · คาดว่า [${want}]`);
  }

  const admin = await login('admin', 'Joey2343**');
  if (!admin) {
    console.log('  – ข้ามข้อ ②-④: ล็อกอิน admin ไม่ได้ (backend ไม่ได้รันอยู่?)');
    if (savedRaw === null) await db.prepare("DELETE FROM settings WHERE `key` = 'leave_approvers'").run();
    else await db.prepare("UPDATE settings SET value = ? WHERE `key` = 'leave_approvers'").run(savedRaw);
    await db.close();
    console.log('');
    console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    process.exit(fail ? 1 : 0);
  }

  const created = [];
  const f = leaveForm({
    leave_type: 'ลาป่วย', date_from: '2026-11-20', date_to: '2026-11-20',
    days: 1, writing_at: '', address: '', phone: '',
  });

  const rowOf = async (id) => await db.prepare('SELECT status, approval_level, approval_data FROM leave_requests WHERE id = ?').get(id);
  const lvOf = async (id) => JSON.parse((await rowOf(id)).approval_data || '[]').map((a) => a.level);

  /* ── ② สาย 3 ขั้น: อนุมัติขั้นต้นต้องส่งต่อผู้อนุมัติ (อาการ ②) ────────────── */
  console.log('');
  console.log('② สาย 3 ขั้น (❶+❷+❸) — อาการที่ผู้ใช้เจอ: ต้องส่งต่อ ไม่ใช่จบทันที');
  await db.prepare('INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
    .run('leave_approvers', JSON.stringify({ 1: { [requesterId]: 3 }, 2: { [requesterId]: 20 }, 3: { [requesterId]: 5 } }));

  const c1 = await req('POST', '/api/leaves', f, submitAs, true);
  check(c1.status === 200, 'ยื่นคำขอลาได้', `ได้ HTTP ${c1.status} · ยื่นในชื่อ user ${requesterId}`);
  if (c1.j && c1.j.id) created.push(c1.j.id);
  if (c1.j && c1.j.id) {
    const id = c1.j.id;
    const rev = await req('PUT', `/api/leaves/${id}/review`, {}, admin);
    check(rev.status === 200, '❶ ตรวจสอบสำเร็จ', `ได้ HTTP ${rev.status} · ${rev.raw.slice(0, 130)}`);

    const a2 = await req('PUT', `/api/leaves/${id}/approve`, { note: 'ขั้นต้น' }, admin);
    check(a2.status === 200, '❷ อนุมัติขั้นต้นได้', `ได้ HTTP ${a2.status} · ${a2.raw.slice(0, 150)}`);
    check(a2.j && a2.j.approved === false,
      '❷ ยังไม่ถือว่าอนุมัติครบ (ต้องส่งต่อ ❸) — นี่คืออาการที่ผู้ใช้เจอ',
      'ได้ approved=' + (a2.j && a2.j.approved));
    check((await rowOf(id)).status === 'pending', 'สถานะยังเป็น pending รอ ❸');

    const a3 = await req('PUT', `/api/leaves/${id}/approve`, { note: 'ขั้นสุดท้าย' }, admin);
    check(a3.status === 200, '❸ อนุมัติได้', `ได้ HTTP ${a3.status} · ${a3.raw.slice(0, 150)}`);
    check(a3.j && a3.j.approved === true, '❸ ครบสายแล้ว approved');
    check(JSON.stringify(await lvOf(id)) === JSON.stringify([1, 2, 3]), 'approval_data = [1,2,3]',
      'ได้ [' + (await lvOf(id)).join(',') + ']');
  }

  /* ── ③ สาย 2 ขั้น (❶+❸): ข้าม ❷ ไปอนุมัติที่ ❸ เลย ────────────────────── */
  console.log('');
  console.log('③ สาย 2 ขั้น (❶+❸) — ข้ามขั้น ❷');
  await db.prepare('INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
    .run('leave_approvers', JSON.stringify({ 1: { [requesterId]: 3 }, 3: { [requesterId]: 5 } }));

  const c2 = await req('POST', '/api/leaves', f, submitAs, true);
  if (c2.j && c2.j.id) created.push(c2.j.id);
  if (c2.j && c2.j.id) {
    const id = c2.j.id;
    const list = await req('GET', `/api/leaves?year=2570&round=year`, null, admin);
    const mine = (list.j && list.j.requests || []).find((x) => x.id === id);
    check(mine && JSON.stringify(mine.chain) === JSON.stringify([1, 3]),
      'API ส่ง chain = [1,3] ให้หน้าเว็บใช้วาดปุ่ม',
      'ได้ ' + JSON.stringify(mine && mine.chain));

    const rev = await req('PUT', `/api/leaves/${id}/review`, {}, admin);
    check(rev.status === 200, '❶ ตรวจสอบสำเร็จ', `ได้ HTTP ${rev.status}`);

    const a3 = await req('PUT', `/api/leaves/${id}/approve`, { note: 'อนุมัติ' }, admin);
    check(a3.status === 200, 'กดอนุมัติได้เลย (ขั้นถัดไปคือ ❸ ไม่ใช่ ❷)',
      `ได้ HTTP ${a3.status} · ${a3.raw.slice(0, 150)}`);
    check(a3.j && a3.j.level === 3, 'บันทึกเป็นขั้นที่ 3', 'ได้ level=' + (a3.j && a3.j.level));
    check(a3.j && a3.j.approved === true, 'จบที่ขั้น ❸ (2 ขั้นจริง)');
    check(JSON.stringify(await lvOf(id)) === JSON.stringify([1, 3]), 'approval_data = [1,3]',
      'ได้ [' + (await lvOf(id)).join(',') + ']');
  }

  /* ── ④ สาย 1 ขั้น (❶ อย่างเดียว): ตรวจสอบแล้วจบเลย ต้องไม่ค้าง ─────────── */
  console.log('');
  console.log('④ สาย 1 ขั้น (❶ อย่างเดียว) — ตรวจสอบแล้วต้องจบ ไม่ค้างเป็น pending');
  await db.prepare('INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
    .run('leave_approvers', JSON.stringify({ 1: { [requesterId]: 3 } }));

  const c3 = await req('POST', '/api/leaves', f, submitAs, true);
  if (c3.j && c3.j.id) created.push(c3.j.id);
  if (c3.j && c3.j.id) {
    const id = c3.j.id;
    const rev = await req('PUT', `/api/leaves/${id}/review`, {}, admin);
    check(rev.status === 200, '❶ ตรวจสอบสำเร็จ', `ได้ HTTP ${rev.status}`);
    const row = await rowOf(id);
    check(row && row.status === 'approved', 'จบทันทีเป็น approved (ไม่ค้างรอขั้นที่ไม่มี)',
      'ได้ ' + (row && row.status) + ' · เคยค้าง pending เพราะไม่มีใครกดขั้นที่ 2 ได้');
  }

  /* ── เก็บกวาด ──────────────────────────────────────────────────────────── */
  for (const id of created) await db.prepare('DELETE FROM leave_requests WHERE id = ?').run(id);
  if (savedRaw === null) await db.prepare("DELETE FROM settings WHERE `key` = 'leave_approvers'").run();
  else await db.prepare("UPDATE settings SET value = ? WHERE `key` = 'leave_approvers'").run(savedRaw);
  await db.close();

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ทดสอบล้มเหลว:', e);
  process.exit(1);
});