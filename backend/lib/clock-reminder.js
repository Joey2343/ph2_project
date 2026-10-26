'use strict';
/**
 * เตือนลงเวลาทำงานผ่าน Telegram (อัตโนมัติ)
 *
 * ความต้องการ (ผู้ใช้):
 *   - ส่งข้อความ Telegram เตือนให้ลงเวลาเข้างาน
 *     ข้อมูลจากคนที่ยังไม่ลงเวลาเข้างาน ในวันนั้น ๆ
 *     ส่ง วันจันทร์-ศุกร์ เวลา 8.20 น.
 *   - ส่งข้อความ Telegram เตือนให้ลงเวลาออกงาน
 *     ข้อมูลจากคนที่ยังไม่ลงเวลาออกงาน ในวันนั้น ๆ
 *     ส่ง วันจันทร์-ศุกร์ เวลา 16.30 น.
 *
 * วิธีทำงาน:
 *   - เรียก startClockReminders() ตอน server บูต (ใน server.js)
 *   - ตั้ง setInterval ทุก 30 วินาที ตรวจว่าเวลาปัจจุบัน ( simulated clock )
 *     ผ่านเวลาเป้าหมาย (08:20 / 16:30) แล้วหรือยัง และยังไม่ได้ส่งวันนี้
 *   - ถ้าผ่าน → ส่งข้อความให้แต่ละคนที่ยังไม่ลงเวลา (เฉพาะผู้ที่ตั้ง Telegram ไว้)
 *     พร้อมส่งสรุปให้ admin ด้วย
 *   - จำวันที่ส่งล่าสุดในตาราง settings (clock_reminder_in_last / clock_reminder_out_last)
 *     เพื่อกันส่งซ้ำเมื่อเซิร์ฟเวอร์รีสตาร์ท
 *
 * หมายเหตุ:
 *   - ใช้ simdate (global Date) ทั้งวันที่และเวลา → ทดสอบด้วย sim_today ได้
 *   - เคารพ TELEGRAM_DISABLED=1 (เซิร์ฟเวอร์ทดสอบ) → ไม่ยิง fetch เลย
 *   - วันเสาร์-อาทิตย์ ไม่ส่ง
 */
const db = require('../db');
const telegram = require('./telegram');
const simdate = require('./simdate');

const IN_HOUR = 8, IN_MIN = 20;
const OUT_HOUR = 16, OUT_MIN = 30;

function isWeekday(d) {
  const day = d.getDay();
  return day >= 1 && day <= 5; // 1=จันทร์ ... 5=ศุกร์
}

function timePassed(d, h, m) {
  const hh = d.getHours(), mm = d.getMinutes();
  if (hh > h) return true;
  if (hh === h && mm >= m) return true;
  return false;
}

async function lastRunDate(kind) {
  const key = kind === 'in' ? 'clock_reminder_in_last' : 'clock_reminder_out_last';
  const r = await db.prepare('SELECT value FROM settings WHERE `key` = ?').get(key);
  return r ? String(r.value || '').trim() : '';
}
async function setLastRunDate(kind, date) {
  const key = kind === 'in' ? 'clock_reminder_in_last' : 'clock_reminder_out_last';
  await db.prepare('INSERT INTO settings (`key`, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)').run(key, date);
}

/** รายชื่อเจ้าหน้าที่ สพป. (ไม่รวมสถานศึกษา) ที่ยังใช้งานอยู่ */
async function officeStaff() {
  return await db.prepare(`SELECT id, title, full_name, first_name, last_name, telegram_token, telegram_chat_id
    FROM users WHERE status = 'active' AND (user_group IS NULL OR user_group != 'school')`).all();
}

/** คนที่ยังไม่ลงเวลาเข้างานวันนี้ */
async function missingClockIn(today) {
  const ids = new Set((await db.prepare(`SELECT user_id FROM time_records WHERE date = ? AND clock_in IS NOT NULL`).all(today)).map((r) => r.user_id));
  const staff = await officeStaff();
  return staff.filter((u) => !ids.has(u.id));
}

/** คนที่ลงเวลาเข้าแล้วแต่ยังไม่ลงเวลาออกวันนี้ */
async function missingClockOut(today) {
  const rows = await db.prepare(`SELECT user_id, clock_out FROM time_records WHERE date = ? AND clock_in IS NOT NULL`).all(today);
  const notOut = new Set(rows.filter((r) => !r.clock_out).map((r) => r.user_id));
  const staff = await officeStaff();
  return staff.filter((u) => notOut.has(u.id));
}

function personName(u) {
  const title = u.title || '';
  let first = u.first_name || '', last = u.last_name || '';
  if (!first && !last && u.full_name) {
    const parts = String(u.full_name).trim().split(/\s+/);
    if (parts.length > 1) { last = parts.pop(); first = parts.join(' '); }
    else first = parts[0] || '';
  }
  return `${title}${first}  ${last}`.trim() || u.full_name || '';
}

async function sendInReminder() {
  const today = simdate.todayISO();
  const list = await missingClockIn(today);
  console.log(`[clock-reminder] ${today} 08:20 — ยังไม่ลงเวลาเข้างาน ${list.length} คน`);
  if (!list.length) return;
  const dateLabel = telegram.thaiDate(today);
  const text = [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    '⏰ เตือนลงเวลาเข้างาน',
    '',
    `วันที่ ${dateLabel} — คุณยังไม่ได้ลงเวลาเข้างาน`,
    '',
    'กรุณาลงเวลาเข้างานผ่านระบบ',
    'https://p2-smart.phrae2.go.th',
  ].join('\n');
  let sent = 0;
  for (const u of list) {
    if (u.telegram_token && u.telegram_chat_id) {
      const ok = await telegram.sendTelegram({ token: u.telegram_token, chatId: u.telegram_chat_id, text });
      if (ok) sent++;
    }
  }
  const admins = await db.prepare(`SELECT telegram_token, telegram_chat_id FROM users WHERE role = 'admin' AND status = 'active'`).all();
  const names = list.map((u) => `• ${personName(u)}`).join('\n');
  const summary = [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    `⏰ สรุป: ยังไม่ลงเวลาเข้างาน ${list.length} คน (วันที่ ${dateLabel})`,
    '',
    names,
  ].join('\n');
  for (const a of admins) {
    if (a.telegram_token && a.telegram_chat_id) {
      await telegram.sendTelegram({ token: a.telegram_token, chatId: a.telegram_chat_id, text: summary });
    }
  }
  console.log(`[clock-reminder] ส่งเตือนเข้างานแล้ว (ส่วนตัว ${sent}/${list.length} · สรุปให้ admin ${admins.length} คน)`);
}

async function sendOutReminder() {
  const today = simdate.todayISO();
  const list = await missingClockOut(today);
  console.log(`[clock-reminder] ${today} 16:30 — ลงเวลาเข้าแล้วแต่ยังไม่ออกงาน ${list.length} คน`);
  if (!list.length) return;
  const dateLabel = telegram.thaiDate(today);
  const text = [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    '🏁 เตือนลงเวลาออกงาน',
    '',
    `วันที่ ${dateLabel} — คุณลงเวลาเข้างานแล้วแต่ยังไม่ได้ลงเวลาออกงาน`,
    '',
    'กรุณาลงเวลาออกงานผ่านระบบก่อนเลิกงาน',
    'https://p2-smart.phrae2.go.th',
  ].join('\n');
  let sent = 0;
  for (const u of list) {
    if (u.telegram_token && u.telegram_chat_id) {
      const ok = await telegram.sendTelegram({ token: u.telegram_token, chatId: u.telegram_chat_id, text });
      if (ok) sent++;
    }
  }
  const admins = await db.prepare(`SELECT telegram_token, telegram_chat_id FROM users WHERE role = 'admin' AND status = 'active'`).all();
  const names = list.map((u) => `• ${personName(u)}`).join('\n');
  const summary = [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    `🏁 สรุป: ลงเวลาเข้าแล้วแต่ยังไม่ออกงาน ${list.length} คน (วันที่ ${dateLabel})`,
    '',
    names,
  ].join('\n');
  for (const a of admins) {
    if (a.telegram_token && a.telegram_chat_id) {
      await telegram.sendTelegram({ token: a.telegram_token, chatId: a.telegram_chat_id, text: summary });
    }
  }
  console.log(`[clock-reminder] ส่งเตือนออกงานแล้ว (ส่วนตัว ${sent}/${list.length} · สรุปให้ admin ${admins.length} คน)`);
}

async function tick() {
  try {
    const now = new Date(); // simulated (simdate patches Date)
    if (!isWeekday(now)) return;
    const today = simdate.todayISO();
    // 8:20 น. เตือนเข้างาน
    if (timePassed(now, IN_HOUR, IN_MIN) && (await lastRunDate('in')) !== today) {
      await setLastRunDate('in', today);
      await sendInReminder();
    }
    // 16:30 น. เตือนออกงาน
    if (timePassed(now, OUT_HOUR, OUT_MIN) && (await lastRunDate('out')) !== today) {
      await setLastRunDate('out', today);
      await sendOutReminder();
    }
  } catch (e) {
    console.error('[clock-reminder] tick error:', e.message);
  }
}

function startClockReminders() {
  // ตรวจทันทีตอนบูต (กรณีเซิร์ฟเวอร์เปิดหลังเวลาเป้าหมาย) + ทุก 30 วินาที
  setTimeout(() => { tick().catch((e) => console.error('[clock-reminder]', e.message)); }, 10000);
  setInterval(() => { tick().catch((e) => console.error('[clock-reminder]', e.message)); }, 30 * 1000);
  console.log('[clock-reminder] ตั้งเตือนลงเวลาเข้างาน (จ-ศ 08:20) และออกงาน (จ-ศ 16:30) แล้ว');
}

module.exports = { startClockReminders, sendInReminder, sendOutReminder, missingClockIn, missingClockOut };
