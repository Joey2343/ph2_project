'use strict';
/**
 * ตรวจว่า "ชุดทดสอบ" ส่งข้อความ Telegram จริงไม่ได้
 *
 * ทำไมต้องมี
 * ──────────
 * ผู้ใช้รายงานว่า: ได้รับข้อความ Telegram "การขออนุญาตลา / การขออนุญาตไปราชการ
 * ได้รับการอนุมัติแล้ว · ผู้พิจารณา: admin" อยู่ตลอด ทั้งที่ในระบบไม่มีรายการนั้นแล้ว
 *
 * สาเหตุ — `npm run verify` ยิงคำขออนุมัติเข้าที่เซิร์ฟเวอร์ dev (ฐานจริงในเครื่อง)
 *   • test-leave-chain / test-travel-chain เลือก "เจ้าหน้าที่ สพป. คนที่ 2"
 *     ซึ่งในฐาน dev มี telegram_token/chat_id จริง → อนุมัติ = ส่งข้อความจริง
 *   • เทสต์ลบรายการที่สร้างทิ้งตอนจบ → ผู้ใช้เห็นข้อความของรายการที่ไม่มีอยู่แล้ว
 *
 * แก้ไว้ 2 ชั้น และไฟล์นี้กันไม่ให้หลุดอีก
 *   1. lib/telegram.js — TELEGRAM_DISABLED=1 → sendTelegram() ไม่ยิง fetch เลย
 *   2. scripts/verify.js — เปิดเซิร์ฟเวอร์ทดสอบของตัวเองด้วย TELEGRAM_DISABLED=1
 *
 * ใช้: node scripts/test-telegram-guard.js
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

(async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  let lastUrl = '';
  globalThis.fetch = async (url) => {
    calls += 1;
    lastUrl = String(url);
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };

  const telegram = require(path.join(ROOT, 'lib', 'telegram.js'));
  const db = require(path.join(ROOT, 'db.js'));
  await db.init();
  await db.bootstrap();

  /* ── ① TELEGRAM_DISABLED=1 → ต้องไม่มีการยิง fetch เลย ─────────────────── */
  console.log('');
  console.log('① TELEGRAM_DISABLED=1 ปิดการส่งทั้งหมด');

  process.env.TELEGRAM_DISABLED = '1';
  const r1 = await telegram.sendTelegram({ token: '123456:FAKE', chatId: '999', text: 'ทดสอบ' });
  check(r1 === false, 'sendTelegram คืน false', 'ได้ ' + JSON.stringify(r1));
  check(calls === 0, 'ไม่มีการเรียก fetch ออกนอกเครื่อง', 'calls=' + calls + ' url=' + lastUrl);
  check(telegram.telegramDisabled() === true, 'telegramDisabled() คืน true');

  /* ── ② ไม่ตั้ง flag → ยังส่งได้ (กันการปิดถาวรโดยไม่ตั้งใจ) ─────────────── */
  console.log('');
  console.log('② ไม่ตั้ง flag → ระบบยังส่งได้ตามปกติ');

  delete process.env.TELEGRAM_DISABLED;
  const r2 = await telegram.sendTelegram({ token: '123456:FAKE', chatId: '999', text: 'ทดสอบ' });
  check(r2 === true, 'sendTelegram คืน true', 'ได้ ' + JSON.stringify(r2));
  check(calls === 1, 'เรียก fetch 1 ครั้ง', 'calls=' + calls);
  check(telegram.telegramDisabled() === false, 'telegramDisabled() คืน false');

  /* ── ③ notifyRequest ต้องไม่ส่งด้วยเมื่อถูกปิด ──────────────────────────── */
  console.log('');
  console.log('③ notifyRequest ก็ต้องไม่ส่งเมื่อถูกปิด');

  process.env.TELEGRAM_DISABLED = '1';
  calls = 0;
  await telegram.notifyRequest({ system: 'leave', id: 999999, approved: true, deciderName: 'ทดสอบ' });
  check(calls === 0, 'notifyRequest ไม่ยิง fetch', 'calls=' + calls);

  globalThis.fetch = realFetch;

  /* ── ④ verify.js ต้องเปิดเซิร์ฟเวอร์ทดสอบด้วย TELEGRAM_DISABLED=1 ───────── */
  console.log('');
  console.log('④ verify.js ต้องเปิดเซิร์ฟเวอร์ทดสอบของตัวเองและปิด Telegram');

  const verifySrc = fs.readFileSync(path.join(__dirname, 'verify.js'), 'utf8');
  check(/TELEGRAM_DISABLED:\s*'1'/.test(verifySrc),
    'verify.js ตั้ง TELEGRAM_DISABLED=1 ตอนเปิดเซิร์ฟเวอร์ทดสอบ');
  check(/TEST_BASE_URL/.test(verifySrc) && /startTestServer/.test(verifySrc),
    'verify.js เปิดเซิร์ฟเวอร์ทดสอบเองและชี้ TEST_BASE_URL มาที่นั่น');
  check(!/127\.0\.0\.1:\$\{process\.env\.PORT \|\| 3000\}/.test(verifySrc),
    'verify.js ไม่ชี้ไปที่เซิร์ฟเวอร์ dev (พอร์ต 3000) อีก');

  /* ── ⑤ เทสต์ที่กดอนุมัติต้องไม่เลือกผู้ใช้ที่มีค่า Telegram ก่อน ────────── */
  console.log('');
  console.log('⑤ เทสต์สายอนุมัติต้องเลือกผู้ขอที่ไม่มีค่า Telegram ก่อน');

  for (const f of ['test-leave-chain.js', 'test-travel-chain.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    check(/telegram_token/.test(src),
      `${f} เรียงลำดับผู้ขอโดยกันคนที่มี telegram_token ก่อน`);
  }

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
