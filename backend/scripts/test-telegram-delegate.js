/**
 * ตรวจว่า Telegram แจ้ง "ผู้ได้รับมอบหมายงานให้ทำหน้าที่แทน" ได้จริง
 *
 * ทำไมต้องมี
 * ──────────
 * ผู้ใช้รายงานว่า: ยื่นลาแล้วเลือก "มอบหมายงานให้ผู้ทำหน้าที่แทน"
 * แต่ผู้ที่ถูกเลือกไม่ได้รับข้อความ Telegram
 *
 * สาเหตุ — lib/telegram.js notifyLeaveSubmitted()
 *   const ids = await leaveApproverIds(...);
 *   if (!ids.length) return;        ← early return
 *   ...
 *   if (b.delegate_to && ...) {     ← บรรทัดแจ้ง delegate อยู่ถัดไป
 *
 *   ถ้ายังไม่ได้ตั้งผู้ตรวจสอบการลา (settings ไม่มีคีย์ leave_approvers)
 *   หรือตั้งแล้วแต่ยังไม่ได้เลือกผู้ตรวจสอบของคนนี้ → ids = []
 *   → return ออกไปก่อนถึงบรรทัดแจ้ง delegate
 *   → ผู้ที่ได้รับมอบหมายงานไม่เคยได้รับข้อความเลย
 *
 *   ตรวจกับฐานจริง: ไม่มีคีย์ leave_approvers เลย → ids = [] ทุกครั้ง
 *
 * ใช้: node scripts/test-telegram-delegate.js
 *   (ไม่ส่งข้อความจริง — แทน sendTelegram ด้วยตัวจับการเรียก)
 */
const path = require('path');

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
}

const ROOT = path.join(__dirname, '..');
const telegramPath = path.join(ROOT, 'lib', 'telegram.js');

(async () => {
  const db = require(path.join(ROOT, 'db.js'));
  await db.init();
  await db.bootstrap();

  /* ── เตรียมผู้ขอ (ไม่มี Telegram) + ผู้รับมอบหมาย (มี Telegram) ──────────── */
  const requester = await db.prepare("SELECT id FROM users WHERE username='admin'").get();
  const delegate = await db.prepare(
    "SELECT id, full_name FROM users WHERE status='active' AND id != ? ORDER BY id LIMIT 1",
  ).get(requester.id);

  const dTok0 = await db.prepare('SELECT telegram_token, telegram_chat_id FROM users WHERE id = ?').get(delegate.id);
  await db.prepare('UPDATE users SET telegram_token = ?, telegram_chat_id = ? WHERE id = ?')
    .run('TEST-TOKEN-DELEGATE', 'TEST-CHAT-DELEGATE', delegate.id);

  const lkSaved = await db.prepare("SELECT value FROM settings WHERE `key`='leave_approvers'").get();

  /* ── สร้างคำขอลาที่มี delegate ──────────────────────────────────────── */
  const ins = await db.prepare(`INSERT INTO leave_requests
    (leave_no, user_id, leave_type, date_from, date_to, days, reason, status, delegate_to)
    VALUES (?,?,?,?,?,?,?, 'pending', ?)`)
    .run('TEST/9999', requester.id, 'ลาป่วย', '2026-12-01', '2026-12-01', 1, 'ทดสอบมอบหมายงาน', delegate.id);
  const leaveId = ins.lastInsertRowid;

  /*
   * จับการเรียก sendTelegram โดยไม่ส่งข้อความจริง
   * แก้ module ในหน่วยความจำก่อนเรียก notifyLeaveSubmitted
   */
  const sent = [];
  const telegram = require(telegramPath);
  // eslint-disable-next-line no-underscore-dangle
  const mod = require.cache[telegramPath];
  const origSend = mod.exports.__sendTelegramForTest;
  void origSend;

  /*
   * วิธีที่ปลอดภัย: monkey-patch fetch ที่ telegram.js ใช้
   * ทำให้ไม่มีการติดต่อเครือข่ายจริง
   */
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    sent.push({ url: String(url), body: JSON.parse(opts.body) });
    return { ok: true, status: 200, text: async () => '{}' };
  };

  /* ── ① ยังไม่ได้ตั้งผู้ตรวจสอบการลา → ต้องยังแจ้ง delegate ──────────── */
  console.log('');
  console.log('① ไม่ได้ตั้งผู้ตรวจสอบการลา (settings ไม่มีคีย์) → ต้องแจ้ง delegate');

  await db.prepare("DELETE FROM settings WHERE `key`='leave_approvers'").run();
  sent.length = 0;
  await telegram.notifyLeaveSubmitted(leaveId);

  check(sent.length >= 1,
    'ส่งข้อความอย่างน้อย 1 ครั้ง',
    `ส่งไป ${sent.length} ครั้ง`);
  const toDelegate = sent.filter((s) => /TEST-CHAT-DELEGATE/.test(s.body.chat_id || ''));
  check(toDelegate.length === 1,
    'ส่งถึงผู้รับมอบหมายงาน 1 ครั้ง',
    `ส่งไป ${toDelegate.length} ครั้ง (ก่อนแก้ = 0)`);
  if (toDelegate.length) {
    const t = toDelegate[0].body.text;
    check(t.indexOf('มอบหมายงานให้ทำหน้าที่แทน') !== -1,
      'ข้อความมีคำว่า "ได้รับมอบหมายงานให้ทำหน้าที่แทน"',
      t.slice(0, 160));
    check(t.indexOf('ผู้ขอ') !== -1,
      'ข้อความบอกว่าเป็นคำขอลาของใคร',
      t.slice(0, 200));
    check(t.indexOf('ลาป่วย') !== -1, 'ข้อความระบุประเภทการลา');
  }

  /* ── ② ตั้งผู้ตรวจสอบแล้ว → ต้องแจ้งทั้งผู้ตรวจสอบ และ delegate ───────── */
  console.log('');
  console.log('② ตั้งผู้ตรวจสอบแล้ว → ต้องแจ้งทั้งสองคน');

  const approverTok0 = await db.prepare('SELECT telegram_token, telegram_chat_id FROM users WHERE id = ?').get(delegate.id);
  await db.prepare('UPDATE users SET telegram_token=?, telegram_chat_id=? WHERE id = ?')
    .run('TEST-TOKEN-APPROVER', 'TEST-CHAT-APPROVER', delegate.id);
  await db.prepare("INSERT INTO settings (`key`,value) VALUES ('leave_approvers',?) ON DUPLICATE KEY UPDATE value=?")
    .run(JSON.stringify({ 1: { [requester.id]: delegate.id } }), JSON.stringify({ 1: { [requester.id]: delegate.id } }));

  sent.length = 0;
  await telegram.notifyLeaveSubmitted(leaveId);
  const chats = sent.map((s) => s.body.chat_id);
  check(chats.indexOf('TEST-CHAT-APPROVER') !== -1, 'ส่งถึงผู้ตรวจสอบ', JSON.stringify(chats));
  check(sent.length === 1,
    'ถ้าคนเดียวกันเป็นทั้งผู้ตรวจสอบและผู้รับมอบหมาย → ส่งครั้งเดียว ไม่ต้องส่งซ้ำ',
    `ส่งไป ${sent.length} ครั้ง: ${JSON.stringify(chats)}`);

  /* ── ③ คนละคน → ต้องส่ง 2 ครั้ง ─────────────────────────────────────── */
  console.log('');
  console.log('③ ผู้ตรวจสอบกับผู้รับมอบหมายเป็นคนละคน → ต้องส่ง 2 ครั้ง');

  const other = await db.prepare(
    "SELECT id FROM users WHERE status='active' AND id NOT IN (?,?) ORDER BY id LIMIT 1",
  ).get(requester.id, delegate.id);
  if (!other) {
    console.log('  – ข้าม: ไม่มีผู้ใช้อีกคนให้ทดสอบ');
  } else {
    // คืนค่า delegate กลับเป็นของตัวเองก่อน
    // (ขั้น ② เปลี่ยน delegate ให้เป็นผู้ตรวจสอบ ถ้าไม่คืน ขั้นนี้จะได้ chat ผิด)
    await db.prepare('UPDATE users SET telegram_token=?, telegram_chat_id=? WHERE id = ?')
      .run('TEST-TOKEN-DELEGATE', 'TEST-CHAT-DELEGATE', delegate.id);
    await db.prepare('UPDATE users SET telegram_token=?, telegram_chat_id=? WHERE id = ?')
      .run('TEST-TOKEN-OTHER', 'TEST-CHAT-OTHER', other.id);
    await db.prepare("UPDATE settings SET value=? WHERE `key`='leave_approvers'")
      .run(JSON.stringify({ 1: { [requester.id]: other.id } }));

    sent.length = 0;
    await telegram.notifyLeaveSubmitted(leaveId);
    const c2 = sent.map((s) => s.body.chat_id);
    check(c2.indexOf('TEST-CHAT-OTHER') !== -1, 'ส่งถึงผู้ตรวจสอบ', JSON.stringify(c2));
    check(c2.indexOf('TEST-CHAT-DELEGATE') !== -1, 'ส่งถึงผู้รับมอบหมายงาน', JSON.stringify(c2));
    check(sent.length === 2, 'ส่ง 2 ครั้ง', `ส่งไป ${sent.length} ครั้ง`);
  }

  /* ── ④ ไม่ได้เลือก delegate → ต้องไม่ส่งหาคนไหนเป็นพิเศษ ────────────── */
  console.log('');
  console.log('④ ไม่ได้เลือกมอบหมายงาน → ต้องไม่มีข้อความ "มอบหมายงาน"');

  await db.prepare('UPDATE leave_requests SET delegate_to = NULL WHERE id = ?').run(leaveId);
  sent.length = 0;
  await telegram.notifyLeaveSubmitted(leaveId);
  const hasDelegateWord = sent.some((s) => /ทำหน้าที่แทน/.test(s.body.text || ''));
  check(!hasDelegateWord, 'ไม่มีข้อความแจ้งผู้รับมอบหมายงาน', 'พบข้อความผิดประเภท');

  /* ── เก็บกวาด ────────────────────────────────────────────────────────── */
  globalThis.fetch = realFetch;
  await db.prepare('DELETE FROM leave_requests WHERE id = ?').run(leaveId);
  if (lkSaved) await db.prepare("UPDATE settings SET value=? WHERE `key`='leave_approvers'").run(lkSaved.value);
  else await db.prepare("DELETE FROM settings WHERE `key`='leave_approvers'").run();

  await db.prepare('UPDATE users SET telegram_token=?, telegram_chat_id=? WHERE id = ?')
    .run(dTok0.telegram_token, dTok0.telegram_chat_id, delegate.id);
  if (other) {
    const oTok0 = await db.prepare('SELECT telegram_token, telegram_chat_id FROM users WHERE id = ?').get(other.id);
    await db.prepare('UPDATE users SET telegram_token=?, telegram_chat_id=? WHERE id = ?')
      .run(oTok0.telegram_token, oTok0.telegram_chat_id, other.id);
  }
  void approverTok0;
  await db.close();

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ทดสอบล้มเหลว:', e);
  process.exit(1);
});