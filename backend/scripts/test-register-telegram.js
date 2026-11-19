'use strict';
/**
 * ทดสอบแจ้งเตือน Telegram เมื่อมีผู้ลงทะเบียนใหม่ (แจ้ง admin)
 * (ผู้ใช้สั่ง 19 พ.ย. 2569)
 *
 *   · เนื้อความต้องบอกชื่อ-สกุล/ประเภทบัญชี/ตำแหน่ง/สังกัด + ให้ไปอนุมัติที่เมนูเจ้าหน้าที่
 *   · ส่งถึง admin ทุกคนที่ตั้งค่า Telegram (ทดสอบด้วย fetch ปลอม — ไม่ยิง Telegram จริง)
 *
 * ใช้: node scripts/test-register-telegram.js
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
}

(async () => {
  console.log('');
  const db = require(path.join(__dirname, '..', 'db.js'));
  const telegram = require(path.join(__dirname, '..', 'lib', 'telegram.js'));
  await db.init();

  const madeUsers = [];
  const realFetch = global.fetch;
  const realDisabled = process.env.TELEGRAM_DISABLED;

  const mkAdmin = async (tag, withTg) => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, first_name, last_name, position, workplace,
       role, status, user_group, telegram_token, telegram_chat_id, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`).run(
      `zzreg_${tag}_${Date.now()}`, hash, 'นางสาว', `ทดสอบ แอดมิน ${tag}`, 'ทดสอบ', `แอดมิน ${tag}`,
      'ผู้ดูแลระบบ', 'กลุ่มงานทดสอบ', 'admin', 'active', 'office',
      withTg ? 'tok_' + tag : null, withTg ? 'chat_' + tag : null
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  try {
    const adminWithTg = await mkAdmin('a1', true);
    await mkAdmin('a2', false); // admin ที่ยังไม่ตั้งค่า Telegram

    console.log('① เนื้อความแจ้งเตือน');
    const text = telegram.newRegistrationText({
      title: 'นางสาว',
      first_name: 'กัญญาณี',
      last_name: 'มั่งมี',
      position: 'เจ้าหน้าที่ธุรการ',
      workplace: '54020001 บ้านน้ำริน',
      phone: '0812345678',
      username: 'kanyanee.m',
      user_group: 'school',
    });
    check(text.includes('มีผู้ลงทะเบียนใหม่'), 'มีบรรทัด "มีผู้ลงทะเบียนใหม่"', text);
    check(text.includes('กัญญาณี') && text.includes('มั่งมี'), 'มีชื่อ-นามสกุล', text);
    check(text.includes('เจ้าหน้าที่สถานศึกษา'), 'บอกประเภทบัญชี (สถานศึกษา)', text);
    check(text.includes('เจ้าหน้าที่ธุรการ'), 'บอกตำแหน่ง', text);
    check(text.includes('54020001 บ้านน้ำริน'), 'บอกสังกัด/หน่วยงาน', text);
    check(text.includes('0812345678'), 'บอกเบอร์โทร (ถ้ามี)', text);
    check(text.includes('รออนุมัติ'), 'บอกให้ไปอนุมัติที่แท็บ "รออนุมัติ"', text);

    console.log('');
    console.log('② ส่งถึง admin ที่ตั้งค่า Telegram เท่านั้น (fetch ปลอม ไม่ยิงจริง)');
    const calls = [];
    global.fetch = async (url, opts) => {
      calls.push({ url: String(url), body: opts && opts.body ? String(opts.body) : '' });
      return { ok: true, status: 200, text: async () => '' };
    };
    delete process.env.TELEGRAM_DISABLED;
    let sent = 0;
    try {
      sent = await telegram.notifyNewRegistration({
        title: 'นาย', first_name: 'ทดสอบ', last_name: 'ลงทะเบียน',
        position: 'ครู', workplace: '54020001 โรงเรียนทดสอบ',
        username: 'zz_test', user_group: 'school',
      });
    } finally {
      global.fetch = realFetch;
      if (realDisabled === undefined) delete process.env.TELEGRAM_DISABLED;
      else process.env.TELEGRAM_DISABLED = realDisabled;
    }
    check(calls.length >= 1, `มีการเรียกส่งข้อความ (${calls.length} ครั้ง)`, JSON.stringify(calls.map((c) => c.url)));
    check(calls.length === 1, 'ส่งครั้งเดียว — เฉพาะ admin ที่มี telegram_token/chat_id',
      'admin ที่ไม่ได้ตั้งค่า Telegram ต้องไม่ถูกส่ง');
    check(calls.some((c) => c.url.includes('/sendMessage')), 'เรียก Telegram sendMessage');
    check(calls.some((c) => c.body.includes('chat_a1')), 'ส่งไปที่ chat ของ admin ที่ตั้งค่าไว้',
      JSON.stringify(calls.map((c) => c.body.slice(0, 80))));
    check(calls.some((c) => c.body.includes('ลงทะเบียนใหม่')), 'เนื้อความใน request มีคำแจ้งเตือน');
    check(sent === 1, `คืนจำนวนที่ส่งสำเร็จ = 1 (ได้ ${sent})`);

    console.log('');
    console.log('③ ปิด Telegram (TELEGRAM_DISABLED=1) → ไม่ส่งจริง');
    process.env.TELEGRAM_DISABLED = '1';
    const calls2 = [];
    global.fetch = async (url) => { calls2.push(String(url)); return { ok: true, status: 200, text: async () => '' }; };
    let sent2 = 0;
    try {
      sent2 = await telegram.notifyNewRegistration({ first_name: 'ก', last_name: 'ข', user_group: 'office' });
    } finally {
      global.fetch = realFetch;
      if (realDisabled === undefined) delete process.env.TELEGRAM_DISABLED;
      else process.env.TELEGRAM_DISABLED = realDisabled;
    }
    check(calls2.length === 0, 'ไม่มีการยิง fetch เลยเมื่อปิด Telegram', JSON.stringify(calls2));
    check(sent2 === 0, 'คืน 0 เมื่อปิด Telegram');

    console.log('');
    console.log('④ จุดเชื่อมในเส้นทางลงทะเบียน');
    const fs = require('fs');
    const authSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
    check(/telegram\.notifyNewRegistration\(\{/.test(authSrc), 'POST /auth/register เรียก notifyNewRegistration');
    check(/notifyNewRegistration\(\{[\s\S]{0,500}?\}\)\.catch\(\(\) => \{\}\)/.test(authSrc),
      'ไม่ await การแจ้งเตือน (การลงทะเบียนไม่ค้าง)');
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    global.fetch = realFetch;
    if (realDisabled === undefined) delete process.env.TELEGRAM_DISABLED;
    else process.env.TELEGRAM_DISABLED = realDisabled;
    try {
      for (const id of madeUsers) {
        try { await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); } catch (e) { /* ignore */ }
        try { await db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch (e) { /* ignore */ }
      }
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
