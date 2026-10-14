/**
 * ตรวจว่าวงจรชีวิต session ถูกต้อง: ไม่บล็อก event loop · ไม่รั่ว · หมดอายุเมื่อไม่ใช้งาน 1 ชั่วโมง
 *
 * ทำไมต้องมี
 * ──────────
 * ① bcrypt เคยใช้ compareSync/hashSync
 *   = บล็อก event loop ทั้งตัว ~65 ms ต่อครั้ง (bcryptjs เป็น pure JS)
 *   วัดจริง: ล็อกอินพร้อมกัน 20 คน → คนหลังสุดรอ 3.1 วินาที
 *   และระหว่างนั้นไม่มี request ไหนได้รับการตอบเลย
 *   compareSync ยัง "โยน error" ถ้า hash ไม่ถูกต้อง (เช่น NULL จากข้อมูลเก่า)
 *   → error หลุดไปถึง error handler → ตอบ 500 แทนที่จะตอบ 401
 *
 * ② ตาราง sessions เคยไม่มีโค้ดลบเลยสักที่
 *   ทุกครั้งที่ล็อกอิน INSERT 1 แถว → ตารางโตไม่จำกัด
 *
 * ③ อายุ session เคย 7 วัน ไม่ว่าผู้ใช้ทำอะไร
 *   ทิ้งเครื่องไว้ข้ามคืนก็ยังใช้ระบบได้
 *   ต้องเป็น 1 ชั่วโมงนับจากการใช้งานล่าสุด + ต่ออายุผ่าน keepalive
 *
 * ใช้: node scripts/test-session-lifecycle.js
 *
 * ⚠️ ใช้ฐานจาก DATABASE_URL (ฐาน dev) และ "ลบเฉพาะแถวที่ตัวเองสร้าง"
 *    ยกเว้น purgeExpiredSessions() ซึ่งลบเซสชันหมดอายุทั้งหมดตามหน้าที่ของมัน
 *    ปลอดภัยเพราะลบเฉพาะแถวที่หมดอายุแล้ว (ไม่มีใครใช้ได้อยู่แล้ว)
 *    แต่ห้ามชี้ไปที่ฐาน production
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

/* ── ① ไม่มี bcrypt แบบ sync เหลือที่ไหน ──────────────────────────────── */
console.log('');
console.log('① ห้ามมี bcrypt แบบ sync (บล็อก event loop)');

const authSrc = fs.readFileSync(path.join(ROOT, 'lib', 'auth.js'), 'utf8');
const noComment = authSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');

check(!/bcrypt\.(compareSync|hashSync)\s*\(/.test(noComment),
  'lib/auth.js ไม่เรียก bcrypt.compareSync / hashSync',
  'ยังมีการเรียกแบบ sync อยู่ → บล็อกทั้งเซิร์ฟเวอร์');
check(/bcrypt\.compare\s*\(/.test(noComment), 'lib/auth.js ใช้ bcrypt.compare แบบ async');
check(/bcrypt\.hash\s*\(/.test(noComment), 'lib/auth.js ใช้ bcrypt.hash แบบ async');

/* ทุกจุดที่เรียกต้อง await — ไม่งั้นได้ Promise ไป INSERT เป็น "[object Promise]" */
console.log('');
console.log('② ทุกจุดที่เรียก hashPassword / verifyPassword ต้อง await');

const routeFiles = ['routes/auth.js', 'routes/admin.js'];
let callSites = 0;
let awaited = 0;
const badCalls = [];
for (const f of routeFiles) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
  const re = /(?<aw>await\s+)?auth\.(hashPassword|verifyPassword)\s*\(/g;
  let m = re.exec(src);
  while (m) {
    callSites += 1;
    if (m.groups && m.groups.aw) awaited += 1;
    else badCalls.push(`${f}: ${m[2]}()`);
    m = re.exec(src);
  }
}
check(callSites > 0, 'พบจุดเรียก hashPassword/verifyPassword ให้ตรวจ', `เจอ ${callSites} จุด`);
check(badCalls.length === 0,
  `ทุกจุดเรียก await ครบ (${awaited}/${callSites})`,
  badCalls.length
    ? 'ไม่ได้ await: ' + badCalls.join(', ')
    : '');

/* ── ③ verifyPassword ต้องไม่โยน error เมื่อ hash เสีย ───────────────── */
console.log('');
console.log('③ verifyPassword ต้องคืน false เมื่อ hash เสีย ไม่ใช่ throw (กัน 500)');

const auth = require(path.join(ROOT, 'lib', 'auth.js'));

(async () => {
  const hash = await auth.hashPassword('Joey2343**');
  check(typeof hash === 'string' && hash.length === 60,
    'hashPassword คืน hash ที่ใช้ได้จริง',
    'ได้ ' + typeof hash);
  check(await auth.verifyPassword('Joey2343**', hash) === true, 'รหัสผ่านถูกต้อง → true');
  check(await auth.verifyPassword('ผิด', hash) === false, 'รหัสผ่านผิด → false');

  // กรณีที่เคยทำให้หน้าเว็บขึ้น 500
  const bad = [null, undefined, '', 'ไม่ใช่ bcrypt', 'x'.repeat(70)];
  let threw = 0;
  for (const b of bad) {
    try {
      const r = await auth.verifyPassword('Joey2343**', b);
      if (r !== false) { threw += 1; console.log(`      hash=${JSON.stringify(b)} → ได้ ${r} ไม่ใช่ false`); }
    } catch (e) {
      threw += 1;
      console.log(`      hash=${JSON.stringify(b)} → throw ${e.message}`);
    }
  }
  check(threw === 0,
    'hash เสียทุกแบบ → คืน false (ตอบ 401) ไม่ใช่ throw (ตอบ 500)',
    'เคยเป็น 500 เพราะ bcrypt.compareSync โยน error ตรง ๆ');

  /* ── ④ อายุเซสชัน = 1 ชั่วโมง ไม่ใช่ 7 วัน ──────────────────────────── */
  console.log('');
  console.log('④ อายุเซสชันต้องเป็น 1 ชั่วโมง นับจากการใช้งานล่าสุด');

  check(auth.SESSION_IDLE_MINUTES === 60,
    'SESSION_IDLE_MINUTES = 60 นาที',
    'ได้ ' + auth.SESSION_IDLE_MINUTES);
  check(typeof auth.purgeExpiredSessions === 'function', 'มีฟังก์ชัน purgeExpiredSessions');
  check(typeof auth.touchSession === 'function', 'มีฟังก์ชัน touchSession (keepalive)');

  // newSession ต้องใส่ expires_at = เวลาจริง + 60 นาที (ไม่ใช่ +7 วัน)
  const db = require(path.join(ROOT, 'db.js'));
  await db.init();
  await db.bootstrap();

  const user = await db.prepare("SELECT id FROM users WHERE status = 'active' ORDER BY id LIMIT 1").get();
  const before = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const token = await auth.newSession(user.id);
  const row = await db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);

  const deltaMin = (new Date(row.expires_at.replace(' ', 'T') + 'Z') - new Date(before.replace(' ', 'T') + 'Z')) / 60000;
  check(deltaMin > 55 && deltaMin < 65,
    'newSession ใส่ expires_at = ตอนนี้ + 60 นาที',
    'ได้ ' + deltaMin.toFixed(1) + ' นาที (ถ้าเป็น 7 วันจะได้ 10080)');

  /* ── ⑤ keepalive เลื่อนเวลาได้จริง ──────────────────────────────────── */
  console.log('');
  console.log('⑤ touchSession ต้องเลื่อน expires_at ไปข้างหน้า');

  const oldExpiry = row.expires_at;
  // บังคับให้หมดอายุเกือบแล้ว แล้วดูว่า touch ช่วยได้ไหม
  //
  // ⚠️ ต้องเทียบกับ "ค่าที่บังคับให้หมดอายุ" ไม่ใช่กับ oldExpiry
  //    เพราะ touchSession ตั้งเป็น "เวลาจริงตอนนี้ + 60 นาที" เสมอ
  //    ถ้า oldExpiry ก็คือ now+60 นาทีเหมือนกัน ค่าจะเท่ากันเป๊ะ
  //    (expires_at ละเอียดถึงวินาที การทดสอบกินเวลาไม่ถึงวินาที)
  const nearExpiry = new Date(Date.now() + 30 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  await db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(nearExpiry, token);
  const ok = await auth.touchSession(token);
  const after = await db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token);
  check(ok === true, 'touchSession คืน true เมื่อ session ยังไม่หมดอายุ');
  check(after.expires_at > nearExpiry,
    'touchSession เลื่อน expires_at จากใกล้หมดอายุ (อีก 30 วิ) ไปเป็นอีก 60 นาที',
    `ก่อน touch = ${nearExpiry} → หลัง touch = ${after.expires_at}`);

  /* ── ⑥ purge ลบเฉพาะที่หมดอายุ ─────────────────────────────────────── */
  console.log('');
  console.log('⑥ purgeExpiredSessions ลบเฉพาะเซสชันที่หมดอายุ');

  const live = await auth.newSession(user.id);
  const past = '2000-01-01 00:00:00';
  const dead1 = await auth.newSession(user.id);
  const dead2 = await auth.newSession(user.id);
  await db.prepare("UPDATE sessions SET expires_at = ? WHERE token IN (?,?)").run(past, dead1, dead2);

  const removed = await auth.purgeExpiredSessions();
  const stillLive = await db.prepare('SELECT * FROM sessions WHERE token = ?').get(live);
  const deadGone1 = await db.prepare('SELECT * FROM sessions WHERE token = ?').get(dead1);
  const deadGone2 = await db.prepare('SELECT * FROM sessions WHERE token = ?').get(dead2);

  // ⚠️ db.get() คืน undefined เมื่อไม่พบแถว (ไม่ใช่ null)
  //    ถ้าเขียน `=== null` จะได้ false เสมอ → เทสต์ผิดแม้โค้ดถูก
  check(!!stillLive, 'เซสชันที่ยังไม่หมดอายุยังอยู่');
  check(!deadGone1 && !deadGone2,
    'เซสชันที่หมดอายุถูกลบออกหมด',
    `ลบได้ ${removed} แถว · dead1 ${deadGone1 ? 'ยังอยู่' : 'ถูกลบ'} · dead2 ${deadGone2 ? 'ยังอยู่' : 'ถูกลบ'}`);
  check(removed >= 2, 'purge คืนจำนวนแถวที่ลบ', 'ได้ ' + removed);

  /* ── ⑦ getSessionUser ปฏิเสธเซสชันที่หมดอายุ ──────────────────────── */
  console.log('');
  console.log('⑦ getSessionUser ต้องไม่รับเซสชันหมดอายุ');

  const stale = await auth.newSession(user.id);
  await db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(past, stale);
  check(await auth.getSessionUser(stale) === null, 'เซสชันหมดอายุ → คืน null (401)');
  check(await auth.getSessionUser(live) !== null, 'เซสชันยังไม่หมดอายุ → คืนผู้ใช้');
  check(await auth.getSessionUser('ไม่มี-token-แบบนี้') === null, 'token ที่ไม่มีอยู่ → คืน null');

  /* ── ⑧ server.js มีตัวล้าง session ─────────────────────────────────── */
  console.log('');
  console.log('⑧ server.js ต้องตั้งตัวล้างเซสชันอัตโนมัติ');

  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  check(/purgeExpiredSessions/.test(srv), 'server.js เรียก purgeExpiredSessions');
  check(/setInterval/.test(srv), 'server.js ตั้ง interval ล้างเป็นระยะ');
  check(/\.unref\(\)/.test(srv),
    'timer ใช้ unref()',
    'ไม่งั้น timer จะเป็นเหตุผลที่ process ไม่ยอบจบ (ค้างสคริปต์ที่ require server.js)');

  // ── เก็บกวาด ──
  await db.prepare('DELETE FROM sessions WHERE token IN (?,?,?)').run(token, live, stale);
  await db.close();

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ทดสอบล้มเหลว:', e);
  process.exit(1);
});