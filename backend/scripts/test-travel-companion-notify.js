'use strict';
/**
 * ทดสอบว่าเมื่อคำขอไปราชการ "ได้รับการอนุมัติ"
 * ข้อความ Telegram ต้องส่งถึงคณะผู้ร่วมเดินทาง (พร้อมด้วยคณะ) ด้วย
 *
 * ผู้ใช้แจ้ง: อนุมัติแล้ว แต่คนในรายชื่อคณะไม่ได้รับข้อความ Telegram
 *
 * วิธีทดสอบ (ไม่ส่งข้อความจริง)
 *   - แทน fetch ด้วยตัวจับการเรียก (เหมือน test-telegram-delegate)
 *   - สร้างคำขอที่มี companion_ids (และ companion_names สำหรับข้อมูลเก่า)
 *   - เรียก notifyTravelCompanions() แล้วตรวจว่าใครได้รับข้อความ
 *
 * ใช้: node scripts/test-travel-companion-notify.js
 */
const path = require('path');

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
}

const ROOT = path.join(__dirname, '..');
delete process.env.TELEGRAM_DISABLED; // เทสต์นี้จับ fetch เอง ไม่ส่งจริง

(async () => {
  const db = require(path.join(ROOT, 'db.js'));
  await db.init();

  const TAG = `__tcn_${Date.now().toString(36)}`;
  const madeUsers = [];
  const mkUser = async (name, first, last, token, chat) => {
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, first_name, last_name, full_name, status, role, user_group,
       can_approve, telegram_token, telegram_chat_id)
      VALUES (?,?,'นาย',?,?,?,'active','staff','office', 0, ?, ?)`)
      .run(`${TAG}_${name}`, 'TEST-ONLY-NOT-A-REAL-HASH', first, last, `${first} ${last}`, token || null, chat || null);
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  const admin = await db.prepare("SELECT id FROM users WHERE username='admin'").get();
  const c1 = await mkUser('C1', 'ทดสอบ', 'คณะหนึ่ง', 'TEST-TOKEN-C1', 'TEST-CHAT-C1');
  const c2 = await mkUser('C2', 'ทดสอบ', 'คณะสอง', null, null); // ไม่ได้ตั้ง Telegram
  const c3 = await mkUser('C3', 'ทดสอบ', 'คณะสาม', 'TEST-TOKEN-C3', 'TEST-CHAT-C3');

  const form_data = {
    companions: 3,
    companion_ids: [c1, c2],
    // c3 มีแต่ชื่อ (จำลองข้อมูลเก่า)
    companion_names: ['นายทดสอบ  คณะสาม'],
    travel_subject: 'ทดสอบแจ้งคณะ',
    destination: 'แพร่',
    date_from: '2026-11-01',
    date_to: '2026-11-01',
  };
  const ins = await db.prepare(`INSERT INTO travel_requests
    (travel_no, user_id, title, destination, date_from, date_to, days, status, approval_level, approval_data, form_data, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'TEST/TCN/2569', admin.id, 'ทดสอบแจ้งคณะ', 'แพร่', '2026-11-01', '2026-11-01', 1,
    'approved', 1, '[]', JSON.stringify(form_data), '2026-10-29 09:00:00'
  );
  const travelId = Number(ins.insertId);

  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    sent.push({ url: String(url), body: JSON.parse(opts.body) });
    return { ok: true, status: 200, text: async () => '{}' };
  };

  try {
    const telegram = require(path.join(ROOT, 'lib', 'telegram.js'));

    console.log('');
    console.log('① อนุมัติแล้ว → คณะได้รับข้อความ Telegram');
    sent.length = 0;
    await telegram.notifyTravelCompanions(travelId, { approved: true, deciderName: 'ผู้ทดสอบ' });

    const chats = sent.map((s) => s.body.chat_id);
    check(chats.includes('TEST-CHAT-C1'), 'ส่งถึงคณะคนที่ 1 (companion_ids)', JSON.stringify(chats));
    check(chats.includes('TEST-CHAT-C3'), 'ส่งถึงคณะคนที่ 3 (จากชื่อ — ข้อมูลเก่า)', JSON.stringify(chats));
    check(!chats.includes('TEST-CHAT-C2'), 'ข้ามคนที่ยังไม่ได้ตั้ง Telegram (ไม่มี chat id)');
    check(!sent.some((s) => s.body.chat_id === 'TEST-CHAT-ADMIN'), 'ไม่ส่งซ้ำถึงผู้ยื่นคำขอ');
    check(sent.length === 2, 'ส่งทั้งหมด 2 ครั้ง (C1 + C3)', `ส่งไป ${sent.length} ครั้ง`);

    const text = sent.length ? sent[0].body.text : '';
    check(text.includes('ได้รับการอนุมัติแล้ว'), 'ข้อความบอกว่าอนุมัติแล้ว', text.slice(0, 120));
    check(text.includes('การขออนุญาตไปราชการ'), 'ข้อความระบุประเภทเรื่อง');
  } finally {
    globalThis.fetch = realFetch;
    try { await db.prepare('DELETE FROM travel_requests WHERE id = ?').run(travelId); } catch (e) { /* ignore */ }
    for (const id of madeUsers) {
      try { await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); } catch (e) { /* ignore */ }
      try { await db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch (e) { /* ignore */ }
    }
    await db.close();
  }

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ทดสอบล้มเหลว:', e);
  process.exit(1);
});
