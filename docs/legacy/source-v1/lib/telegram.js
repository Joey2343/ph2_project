'use strict';
/**
 * แจ้งเตือนผ่าน Telegram Bot
 * ส่งข้อความไปยัง ChatID ของผู้ใช้ ตาม Telegram Token Key + ChatID
 * ที่สมาชิกกรอกไว้ในข้อมูลส่วนตัว (ตาราง users: telegram_token / telegram_chat_id)
 *
 * หมายเหตุ: Telegram API ไม่รองรับการระบุสีตัวอักษรโดยตรง
 * จึงใช้ 🟢/✅ (สีเขียว = อนุมัติ) และ 🔴/❌ (สีแดง = ไม่อนุมัติ) เป็นสัญลักษณ์สี
 *
 * TELEGRAM_API_BASE ใช้สำหรับทดสอบกับเซิร์ฟเวอร์จำลองในเครื่อง (ค่าเริ่มต้นคือ API จริง)
 */
const db = require('../db');
const approvals = require('./approvals');
const API_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';

/** แปลงวันที่ YYYY-MM-DD → DD/MM/PPPP (ปี พ.ศ. ไทย) */
function thaiDate(iso) {
  const parts = String(iso || '').split('-');
  if (parts.length !== 3) return iso || '-';
  const y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
  if (!y || !m || !d) return iso || '-';
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y + 543}`;
}

/** แปลงช่วงวันที่ (ถ้าเท่ากันแสดงวันเดียว) */
function thaiDateRange(from, to) {
  if (!from && !to) return '-';
  const f = thaiDate(from), t = thaiDate(to);
  return from && to && from !== to ? `${f} ถึง ${t}` : f;
}

/** จัดรูปแบบชื่อ: คำนำหน้าชื่อ+ชื่อ ติดกัน เว้น 2 วรรค นามสกุล */
function personName(p) {
  const title = p.title || '';
  let first = p.first_name || '';
  let last = p.last_name || '';
  if (!first && !last && p.full_name) {
    const parts = String(p.full_name).trim().split(/\s+/);
    if (parts.length > 1) { last = parts.pop(); first = parts.join(' '); }
    else first = parts[0] || '';
  }
  if (!first && !last) return p.full_name || '';
  return `${title}${first}  ${last}`.trim();
}

/** ชื่อเรื่องของแต่ละระบบ */
function systemLabel(system) {
  return {
    room: 'การขอใช้ห้องประชุม',
    vehicle: 'การขอยืมยานพาหนะ',
    travel: 'การขออนุญาตไปราชการ',
    leave: 'การขออนุญาตลา',
    memo: 'บันทึกข้อความ',
  }[system] || system;
}

/** รายละเอียดแต่ละบรรทัดของแต่ละระบบ (b = แถวจากตารางพร้อม join) */
function detailLines(system, b) {
  const pad = (v) => (v === null || v === undefined || v === '' ? '-' : v);
  const lines = {
    room: [
      `• ห้องประชุม: ${pad(b.room_name)}`,
      `• วันที่: ${thaiDate(b.date)}`,
      `• เวลา: ${pad(b.start_time)} - ${pad(b.end_time)} น.`,
      `• หัวข้อการประชุม: ${pad(b.topic)}`,
      `• ผู้จอง: ${pad(personName(b))}`,
    ],
    vehicle: [
      `• ยานพาหนะ: ${b.vehicle_name ? `${b.vehicle_name}${b.vehicle_plate ? ` (ทะเบียน ${b.vehicle_plate})` : ''}` : 'มอบเจ้าหน้าที่จัดให้'}`,
      `• สถานที่ไปราชการ: ${pad(b.destination)}`,
      `• วัตถุประสงค์: ${pad(b.purpose)}`,
      `• ตั้งแต่วันที่: ${thaiDate(b.date)} เวลา ${pad(b.start_time)} น.`,
      `• ถึงวันที่: ${b.date_to ? `${thaiDate(b.date_to)} เวลา ${pad(b.end_time)} น.` : '-'}`,
      `• รวม: ${Number(b.total_days) || 1} วัน`,
      `• ผู้โดยสาร: ${Number(b.passenger_count) || 0} คน`,
      `• ผู้ควบคุมรถ: ${pad(b.controller)}`,
      `• พนักงานขับรถ: ${b.driver_name || (b.self_drive ? 'ผู้ขอขับเอง' : 'เจ้าหน้าที่จัดให้')}`,
      `• เชื้อเพลิง: ${pad(b.fuel_choice)}${b.fuel_project ? ` (โครงการ: ${b.fuel_project}${b.fuel_activity ? ` / กิจกรรม: ${b.fuel_activity}` : ''}${Number(b.fuel_amount) ? ` / ${Number(b.fuel_amount).toFixed(2)} บาท` : ''})` : ''}`,
      ...(b.self_drive ? ['• 🚗 ขออนุญาตเป็นผู้ขับรถคันดังกล่าว (มีใบอนุญาตขับขี่รถจากทางราชการ)'] : []),
      `• ผู้จอง: ${pad(personName(b))}`,
    ],
    travel: [
      `• เรื่อง: ${pad(b.title)}`,
      `• สถานที่ไปราชการ: ${pad(b.destination)}`,
      `• วันที่เดินทาง: ${thaiDateRange(b.date_from, b.date_to)}`,
      `• จำนวนวัน: ${Number(b.days) || 1} วัน`,
      `• ผู้ขอ: ${pad(personName({ title: b.person_title, first_name: b.first_name, last_name: b.last_name, full_name: b.full_name }))}`,
    ],
    leave: [
      `• ประเภทการลา: ${pad(b.leave_type)}`,
      `• วันที่ลา: ${thaiDateRange(b.date_from, b.date_to)}`,
      `• จำนวนวัน: ${Number(b.days) || 1} วัน`,
      `• เหตุผล: ${pad(b.reason)}`,
      `• ผู้ขอ: ${pad(personName(b))}`,
      ...(b.delegate_to ? [`• มอบหมายงานให้ผู้ทำหน้าที่แทน: ${personName({ title: b.delegate_title, first_name: b.delegate_first_name, last_name: b.delegate_last_name })}`] : []),
    ],
    memo: [
      `• เลขที่: ${pad(b.doc_no)}`,
      `• เรื่อง: ${pad(b.title)}`,
      `• ส่วนราชการ: ${pad(b.office)}`,
      `• วันที่: ${thaiDate(b.date)}`,
      `• ความเร่งด่วน: ${pad(b.urgency)}`,
      `• ผู้จัดทำ: ${pad(personName({ title: b.maker_title, first_name: b.first_name, last_name: b.last_name }))}`,
    ],
  };
  return lines[system] || [];
}

/** ประกอบข้อความแจ้งเตือน (approved=true → สีเขียว 🟢✅, false → สีแดง 🔴❌) — extra = บรรทัดเพิ่มเติม เช่น รายการบันทึกสั่งการ */
function requestText({ system, approved, b, deciderName, note, extra }) {
  const label = systemLabel(system);
  const status = approved
    ? `🟢✅ เรื่อง: ${label} ได้รับการอนุมัติแล้ว`
    : `🔴❌ เรื่อง: ${label} ถูกไม่อนุมัติ`;
  const lines = [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    status,
    '',
    '📋 รายละเอียด:',
    ...detailLines(system, b),
  ];
  if (!approved && note) lines.push(`• เหตุผล: ${note}`);
  if (deciderName) lines.push(`• ผู้พิจารณา: ${deciderName}`);
  if (Array.isArray(extra) && extra.length) lines.push(...extra);
  return lines.join('\n');
}

/** ดึงข้อมูลการจองห้องประชุมพร้อมชื่อห้อง/ผู้จอง/ค่า Telegram */
function fetchRoomRow(id) {
  return db.prepare(`SELECT r.*, u.title, u.full_name, u.first_name, u.last_name, u.telegram_token, u.telegram_chat_id, rm.name AS room_name
    FROM room_bookings r JOIN users u ON u.id = r.user_id JOIN rooms rm ON rm.id = r.room_id WHERE r.id = ?`).get(Number(id));
}

/** ข้อความแจ้งผู้อนุมัติขั้นต้นว่ามีคำขอจองห้องประชุมใหม่ */
function roomSubmittedText(b) {
  return [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    '🆕 มีคำขอจองห้องประชุมใหม่ รอการอนุมัติขั้นต้น',
    '',
    '📋 รายละเอียด:',
    ...detailLines('room', b),
  ].join('\n');
}

/** ข้อความแจ้งผู้อนุมัติขั้นถัดไปว่า ขั้นต้นได้อนุมัติแล้ว */
function roomLevelApprovedText(b, deciderName) {
  return [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    '⏳ มีการจองห้องประชุม — ผู้อนุมัติขั้นต้นได้อนุมัติขั้นต้นมาแล้ว รอการอนุมัติขั้นสุดท้าย',
    '',
    '📋 รายละเอียด:',
    ...detailLines('room', b),
    `• ผู้อนุมัติขั้นต้น: ${deciderName || '-'}`,
  ].join('\n');
}

/**
 * ส่งข้อความไปยังผู้อนุมัติทุกรายที่ได้รับมอบหมายขั้น level ของระบบ
 * (ข้ามผู้ที่ยังไม่ได้ตั้งค่า Telegram)
 */
async function notifyApprovers({ system, level, text }) {
  try {
    const approvers = approvals.getSystemApprovers(system);
    const ids = (approvers[level] || []).map(Number);
    if (!ids.length) return;
    const users = db.prepare(`SELECT id, telegram_token, telegram_chat_id FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    for (const u of users) {
      if (u.telegram_token && u.telegram_chat_id) {
        await sendTelegram({ token: u.telegram_token, chatId: u.telegram_chat_id, text });
      }
    }
  } catch (e) {
    console.error('[telegram] notifyApprovers error:', e.message);
  }
}

/** ดึงข้อมูลบันทึกข้อความพร้อมผู้จัดทำ/ค่า Telegram */
function fetchMemoRow(id) {
  return db.prepare(`SELECT m.*, u.title AS maker_title, u.first_name, u.last_name, u.full_name, u.telegram_token, u.telegram_chat_id
    FROM memos m JOIN users u ON u.id = m.user_id WHERE m.id = ?`).get(Number(id));
}

/** ข้อความแจ้งผู้อนุมัติขั้นที่ 1 ว่ามีบันทึกข้อความใหม่ส่งเข้ามา */
function memoSubmittedText(b) {
  return [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    '🆕 มีบันทึกข้อความใหม่ส่งถึงคุณ รอการอนุมัติขั้นต้น',
    '',
    '📋 รายละเอียด:',
    ...detailLines('memo', b),
  ].join('\n');
}

/** ข้อความแจ้งผู้อนุมัติขั้นถัดไปว่า ขั้นก่อนหน้าได้อนุมัติแล้ว */
function memoNextLevelText(b, deciderName, decide) {
  const lines = [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    '⏳ มีบันทึกข้อความ — ขั้นก่อนหน้าได้อนุมัติมาแล้ว รอการพิจารณาขั้นถัดไป',
    '',
    '📋 รายละเอียด:',
    ...detailLines('memo', b),
    `• ผู้อนุมัติขั้นก่อนหน้า: ${deciderName || '-'}`,
  ];
  if (decide) lines.push(`• ความเห็นขั้นต้น: ${decide}`);
  return lines.join('\n');
}

/** ข้อความแจ้งผู้ที่ถูกเลือกเป็นผู้อนุมัติขั้นถัดไป (เรียนเสนอ / ผ่านเรื่อง/เสนอต่อ) ว่ามีบันทึกข้อความส่งถึงเขา */
function memoForwardedText(b, deciderName, decide, label) {
  const l = label || 'เรียนเสนอ';
  const lines = [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    `🆕 มีบันทึกข้อความส่งถึงคุณ (${l}) รอการพิจารณา`,
    '',
    '📋 รายละเอียด:',
    ...detailLines('memo', b),
  ];
  if (decide) lines.push(`• ความเห็น: ${decide}`);
  if (deciderName) lines.push(`• ผู้ส่งต่อ: ${deciderName}`);
  return lines.join('\n');
}

/** ข้อความแจ้งผู้จัดทำว่าบันทึกข้อความถูกส่งกลับเพื่อแก้ไข */
function memoReturnedText(b, deciderName, note) {
  return [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    '↩️ บันทึกข้อความของคุณถูกส่งกลับเพื่อให้แก้ไข',
    '',
    '📋 รายละเอียด:',
    ...detailLines('memo', b),
    `• ผู้อนุมัติที่ส่งกลับ: ${deciderName || '-'}`,
    `• สิ่งที่ให้แก้ไข: ${note || '-'}`,
  ].join('\n');
}

/** รายชื่อผู้มีสิทธิ์ขั้นที่ level จาก chain snapshot ของบันทึกข้อความนี้ */
function chainLevelIds(b, level) {
  try {
    const chain = JSON.parse(b.approval_chain || '[]');
    if (Array.isArray(chain)) {
      const lv = chain.find((x) => Number(x.level) === level);
      if (lv && Array.isArray(lv.ids)) return lv.ids.map(Number);
    }
  } catch (e) { /* ignore */ }
  return [];
}

/** ข้อความแจ้งผู้อนุมัติขั้นเดิมว่าบันทึกข้อความถูกแก้ไขแล้วและส่งกลับมา */
function memoResubmittedText(b, deciderName) {
  const lines = [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    '↩️ บันทึกข้อความถูกแก้ไขแล้วและส่งกลับถึงคุณ รอการพิจารณา',
    '',
    '📋 รายละเอียด:',
    ...detailLines('memo', b),
  ];
  if (deciderName) lines.push(`• ผู้บันทึกข้อความ: ${deciderName}`);
  return lines.join('\n');
}

/**
 * แจ้งผู้อนุมัติขั้นเดิม (ขั้นที่ 2 หรือคนที่ถูกเรียนเสนอเลือกไว้) ว่าบันทึกข้อความที่ถูกคืน
 * ได้รับการแก้ไขแล้วและส่งกลับมา รอการพิจารณา
 */
async function notifyMemoResubmitted(id, deciderName) {
  try {
    const b = fetchMemoRow(id);
    if (!b) return;
    const next = Number(b.approval_level) + 1;
    const text = memoResubmittedText(b, deciderName);
    // ส่งไปเฉพาะคนที่ถูกเรียนเสนอเลือกไว้ (ถ้ามี) — เรื่องต้องกลับมาที่คนนั้นทันที
    if (b.next_approver_id) {
      const u = db.prepare('SELECT telegram_token, telegram_chat_id FROM users WHERE id = ?').get(Number(b.next_approver_id));
      if (u && u.telegram_token && u.telegram_chat_id) {
        await sendTelegram({ token: u.telegram_token, chatId: u.telegram_chat_id, text });
      }
      return;
    }
    // fallback: ผู้อนุมัติขั้นถัดไปตาม chain snapshot
    const ids = chainLevelIds(b, next);
    if (!ids.length) return;
    const users = db.prepare(`SELECT telegram_token, telegram_chat_id FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    for (const u of users) {
      if (u.telegram_token && u.telegram_chat_id) {
        await sendTelegram({ token: u.telegram_token, chatId: u.telegram_chat_id, text });
      }
    }
  } catch (e) {
    console.error('[telegram] notifyMemoResubmitted error:', e.message);
  }
}

/** แจ้งผู้อนุมัติของ "ผู้จัดทำ" ณ ขั้นที่ 1 ว่ามีบันทึกข้อความใหม่ส่งเข้ามา (รายบุคคล) */
async function notifyMemoSubmitted(id) {
  try {
    const b = fetchMemoRow(id);
    if (!b) return;
    await notifyMemoApproversOf(b.user_id, 1, memoSubmittedText(b));
  } catch (e) {
    console.error('[telegram] notifyMemoSubmitted error:', e.message);
  }
}

/** แจ้งผู้อนุมัติของ "ผู้จัดทำ" ณ ขั้นถัดไป (รายบุคคล) ว่าขั้นก่อนหน้าได้อนุมัติแล้ว */
async function notifyMemoNextLevel(id, deciderName, decide) {
  try {
    const b = fetchMemoRow(id);
    if (!b) return;
    const next = Number(b.approval_level) + 1;
    if (next > 3) return;
    await notifyMemoApproversOf(b.user_id, next, memoNextLevelText(b, deciderName, decide));
  } catch (e) {
    console.error('[telegram] notifyMemoNextLevel error:', e.message);
  }
}

/** ส่ง Telegram ไปยังผู้อนุมัติบันทึกข้อความของบุคคลหนึ่ง ณ ขั้นที่ level (fallback: ลำดับรวม) */
async function notifyMemoApproversOf(staffId, level, text) {
  try {
    const per = approvals.getMemoApproversPerPerson();
    const v = Number((per[level] || {})[String(staffId)]) || 0;
    const ids = v ? [v] : ((approvals.getSystemApprovers('memo')[level] || []).map(Number));
    if (!ids.length) return;
    const users = db.prepare(`SELECT telegram_token, telegram_chat_id FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    for (const u of users) {
      if (u.telegram_token && u.telegram_chat_id) {
        await sendTelegram({ token: u.telegram_token, chatId: u.telegram_chat_id, text });
      }
    }
  } catch (e) {
    console.error('[telegram] notifyMemoApproversOf error:', e.message);
  }
}

/** แจ้งผู้ที่ถูกเลือกเป็นผู้อนุมัติขั้นถัดไป (เรียนเสนอ / ผ่านเรื่อง/เสนอต่อ) ว่ามีบันทึกข้อความส่งถึงเขา */
async function notifyMemoForwarded(id, targetUserId, deciderName, decide, label) {
  try {
    const b = fetchMemoRow(id);
    if (!b) return;
    const u = db.prepare('SELECT telegram_token, telegram_chat_id FROM users WHERE id = ?').get(Number(targetUserId));
    if (!u || !u.telegram_token || !u.telegram_chat_id) return;
    await sendTelegram({ token: u.telegram_token, chatId: u.telegram_chat_id, text: memoForwardedText(b, deciderName, decide, label) });
  } catch (e) {
    console.error('[telegram] notifyMemoForwarded error:', e.message);
  }
}

/** แจ้งเตือนผู้จัดทำว่าบันทึกข้อความถูกส่งกลับเพื่อแก้ไข (การ์ดหน้าแรก + Telegram) */
async function notifyMemoReturned(id, deciderName, note) {
  try {
    const b = fetchMemoRow(id);
    if (!b) return;
    const u = { token: b.telegram_token, chatId: b.telegram_chat_id };
    if (u.token && u.chatId) {
      await sendTelegram({ token: u.token, chatId: u.chatId, text: memoReturnedText(b, deciderName, note) });
    }
  } catch (e) {
    console.error('[telegram] notifyMemoReturned error:', e.message);
  }
}

/** แจ้งผู้อนุมัติขั้นต้นว่ามีคำขอจองห้องประชุมใหม่ */
async function notifyRoomSubmitted(id) {
  try {
    const b = fetchRoomRow(id);
    if (!b) return;
    await notifyApprovers({ system: 'room', level: 1, text: roomSubmittedText(b) });
  } catch (e) {
    console.error('[telegram] notifyRoomSubmitted error:', e.message);
  }
}

/** แจ้งผู้อนุมัติขั้นถัดไป (ขั้นสุดท้าย) ว่า ผู้อนุมัติขั้นต้นได้อนุมัติแล้ว */
async function notifyRoomNextLevel(id, deciderName) {
  try {
    const b = fetchRoomRow(id);
    if (!b) return;
    await notifyApprovers({ system: 'room', level: 2, text: roomLevelApprovedText(b, deciderName) });
  } catch (e) {
    console.error('[telegram] notifyRoomNextLevel error:', e.message);
  }
}

/** ดึงข้อมูลคำขอยานพาหนะพร้อมชื่อรถ/ผู้จอง/ค่า Telegram */
function fetchVehicleRow(id) {
  return db.prepare(`SELECT v.*, u.title, u.full_name, u.first_name, u.last_name, u.telegram_token, u.telegram_chat_id, ve.name AS vehicle_name, ve.plate AS vehicle_plate
    FROM vehicle_bookings v JOIN users u ON u.id = v.user_id LEFT JOIN vehicles ve ON ve.id = v.vehicle_id WHERE v.id = ?`).get(Number(id));
}

/** ข้อความแจ้งผู้อนุมัติขั้นต้นว่ามีคำขอใช้ยานพาหนะใหม่ */
function vehicleSubmittedText(b) {
  return [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    '🆕 มีคำขอใช้ยานพาหนะใหม่ รอการอนุมัติขั้นต้น',
    '',
    '📋 รายละเอียด:',
    ...detailLines('vehicle', b),
  ].join('\n');
}

/** ข้อความแจ้งผู้อนุมัติขั้นถัดไปว่า ผู้อนุมัติขั้นต้นได้อนุมัติแล้ว */
function vehicleLevelApprovedText(b, deciderName) {
  return [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    '⏳ มีคำขอใช้ยานพาหนะ — ผู้อนุมัติขั้นต้นได้อนุมัติขั้นต้นมาแล้ว รอการอนุมัติขั้นสุดท้าย',
    '',
    '📋 รายละเอียด:',
    ...detailLines('vehicle', b),
    `• ผู้อนุมัติขั้นต้น: ${deciderName || '-'}`,
  ].join('\n');
}

/** ข้อความแจ้งพนักงานขับรถที่ถูกเลือก */
function vehicleDriverNotifiedText(b, deciderName) {
  return [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    `🚗 ${deciderName || 'ผู้อนุมัติขั้นต้น'} ได้เลือกให้คุณเป็นพนักงานขับรถ`,
    '',
    '📋 รายละเอียด:',
    ...detailLines('vehicle', b),
  ].join('\n');
}

/** แจ้งผู้อนุมัติขั้นต้นว่ามีคำขอใช้ยานพาหนะใหม่ */
async function notifyVehicleSubmitted(id) {
  try {
    const b = fetchVehicleRow(id);
    if (!b) return;
    await notifyApprovers({ system: 'vehicle', level: 1, text: vehicleSubmittedText(b) });
  } catch (e) {
    console.error('[telegram] notifyVehicleSubmitted error:', e.message);
  }
}

/** แจ้งผู้อนุมัติขั้นถัดไป (ขั้นสุดท้าย) ว่า ผู้อนุมัติขั้นต้นได้อนุมัติแล้ว */
async function notifyVehicleNextLevel(id, deciderName) {
  try {
    const b = fetchVehicleRow(id);
    if (!b) return;
    await notifyApprovers({ system: 'vehicle', level: 2, text: vehicleLevelApprovedText(b, deciderName) });
  } catch (e) {
    console.error('[telegram] notifyVehicleNextLevel error:', e.message);
  }
}

/** แจ้งพนักงานขับรถที่ผู้อนุมัติขั้นต้นเลือก (ค้นหาจากชื่อ driver_name) */
async function notifyVehicleDriver(id, deciderName) {
  try {
    const b = fetchVehicleRow(id);
    if (!b || !b.driver_name) return;
    const driver = findVehicleUserByName(b.driver_name);
    if (!driver || !driver.telegram_token || !driver.telegram_chat_id) return;
    await sendTelegram({ token: driver.telegram_token, chatId: driver.telegram_chat_id, text: vehicleDriverNotifiedText(b, deciderName) });
  } catch (e) {
    console.error('[telegram] notifyVehicleDriver error:', e.message);
  }
}

/** ค้นหาผู้ใช้ที่เป็นพนักงานขับรถจากชื่อ (ตัดคำนำหน้า + ย่อช่องว่าง) — คืนแถว users พร้อมค่า Telegram */
function findVehicleUserByName(name) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const dn = norm(name);
  if (!dn) return null;
  const all = db.prepare("SELECT id, full_name, telegram_token, telegram_chat_id FROM users WHERE status = 'active'").all();
  const byName = all.find((u) => norm(u.full_name) === dn);
  const bare = dn.replace(/^(ว่าที่ร้อยตรีหญิง|ว่าที่ร้อยตรี|นาย|นางสาว|นาง)\s*/, '');
  return byName || all.find((u) => norm(u.full_name) === bare || norm(u.full_name).includes(bare)) || null;
}

/** ข้อความแจ้งว่ามีการแก้ไขการจองยานพาหนะ (ส่งถึงผู้จอง / พนักงานขับรถเดิม) */
function vehicleEditedText(b, editorName) {
  return [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    '✏️ มีการแก้ไขการจองยานพาหนะ',
    '',
    '📋 รายละเอียดการจอง (หลังแก้ไข):',
    ...detailLines('vehicle', b),
    `• ผู้แก้ไข: ${editorName || '-'}`,
  ].join('\n');
}

/** ข้อความแจ้งพนักงานขับรถคนใหม่ที่ถูกเลือกหลังการแก้ไข */
function vehicleNewDriverText(b, editorName) {
  return [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    '🚗 มีการแก้ไขการจองยานพาหนะ — คุณถูกเปลี่ยนให้เป็นพนักงานขับรถ',
    '',
    '📋 รายละเอียดการจอง:',
    ...detailLines('vehicle', b),
    `• ผู้แก้ไข: ${editorName || '-'}`,
  ].join('\n');
}

/** ข้อความแจ้งว่ารายการจองยานพาหนะถูกยกเลิก */
function vehicleCancelledText(b, cancellerName) {
  return [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    '❌ ยกเลิกรายการจองยานพาหนะ',
    '',
    '📋 รายละเอียดการจองที่ถูกยกเลิก:',
    ...detailLines('vehicle', b),
    `• ผู้ยกเลิก: ${cancellerName || '-'}`,
  ].join('\n');
}

/** บันทึกข้อความแจ้งเตือนในระบบ (ตาราง vehicle_notices) ให้ผู้ใช้ */
function addVehicleNotice({ userId, bookingId, type, text }) {
  try {
    db.prepare('INSERT INTO vehicle_notices (booking_id, user_id, type, text) VALUES (?,?,?,?)')
      .run(bookingId || null, Number(userId), type === 'cancel' ? 'cancel' : 'edit', text);
  } catch (e) {
    console.error('[telegram] addVehicleNotice error:', e.message);
  }
}

/** ส่งข้อความในระบบ + Telegram ให้ผู้ใช้คนเดียว */
async function sendVehicleNotice({ userId, bookingId, type, text }) {
  const u = db.prepare('SELECT telegram_token, telegram_chat_id FROM users WHERE id = ?').get(Number(userId));
  addVehicleNotice({ userId, bookingId, type, text });
  if (u && u.telegram_token && u.telegram_chat_id) {
    await sendTelegram({ token: u.telegram_token, chatId: u.telegram_chat_id, text });
  }
}

/**
 * แจ้งเตือนว่ามีการแก้ไขการจองยานพาหนะ (ในระบบ + Telegram)
 * ส่งถึง: ผู้จอง, พนักงานขับรถเดิม, พนักงานขับรถคนใหม่ (ถ้าเปลี่ยนพนักงานขับรถ)
 */
async function notifyVehicleEdited(id, editorName, { oldDriver, newDriver } = {}) {
  try {
    const b = fetchVehicleRow(id);
    if (!b) return;
    const driverChanged = oldDriver && newDriver && oldDriver !== newDriver;
    const recipients = [];
    // ผู้จอง
    recipients.push({ userId: b.user_id, type: 'edit', text: vehicleEditedText(b, editorName) });
    if (driverChanged) {
      // พนักงานขับรถเดิม
      const oldD = findVehicleUserByName(oldDriver);
      if (oldD) recipients.push({ userId: oldD.id, type: 'edit', text: vehicleEditedText(b, editorName) });
      // พนักงานขับรถคนใหม่
      const newD = findVehicleUserByName(newDriver);
      if (newD) recipients.push({ userId: newD.id, type: 'edit', text: vehicleNewDriverText(b, editorName) });
    }
    for (const r of recipients) {
      await sendVehicleNotice({ userId: r.userId, bookingId: b.id, type: r.type, text: r.text });
    }
  } catch (e) {
    console.error('[telegram] notifyVehicleEdited error:', e.message);
  }
}

/**
 * แจ้งเตือนว่ารายการจองยานพาหนะถูกยกเลิก (ในระบบ + Telegram)
 * ส่งถึง: ผู้จอง (ยกเว้นผู้จองยกเลิกเอง) และพนักงานขับรถ
 * @param row แถว vehicle_bookings ที่จะลบ (ต้องส่งข้อมูลครบพร้อม vehicle_name/vehicle_plate)
 */
async function notifyVehicleCancelled(row, cancellerName, { skipBooker } = {}) {
  try {
    if (!row) return;
    const b = { ...row, vehicle_name: row.vehicle_name || null, vehicle_plate: row.vehicle_plate || null };
    const text = vehicleCancelledText(b, cancellerName);
    const recipients = [];
    if (!skipBooker && row.user_id) recipients.push({ userId: row.user_id, type: 'cancel', text });
    if (row.driver_name) {
      const driver = findVehicleUserByName(row.driver_name);
      if (driver) recipients.push({ userId: driver.id, type: 'cancel', text });
    }
    for (const r of recipients) {
      await sendVehicleNotice({ userId: r.userId, bookingId: row.id, type: r.type, text: r.text });
    }
  } catch (e) {
    console.error('[telegram] notifyVehicleCancelled error:', e.message);
  }
}

/**
 * ดึงข้อมูลคำขอ + ค่า Telegram ของผู้ขอ แล้วส่งข้อความแจ้งเตือน
 * (fire-and-forget — ไม่ throw ต่อให้ส่งไม่สำเร็จ)
 */
async function notifyRequest({ system, id, approved, deciderName, note, extra }) {
  try {
    const sql = {
      room: `SELECT r.*, u.title, u.full_name, u.first_name, u.last_name, u.telegram_token, u.telegram_chat_id, rm.name AS room_name
        FROM room_bookings r JOIN users u ON u.id = r.user_id JOIN rooms rm ON rm.id = r.room_id WHERE r.id = ?`,
      vehicle: `SELECT v.*, u.title, u.full_name, u.first_name, u.last_name, u.telegram_token, u.telegram_chat_id, ve.name AS vehicle_name, ve.plate AS vehicle_plate
        FROM vehicle_bookings v JOIN users u ON u.id = v.user_id LEFT JOIN vehicles ve ON ve.id = v.vehicle_id WHERE v.id = ?`,
      travel: `SELECT t.*, u.title AS person_title, u.full_name, u.first_name, u.last_name, u.telegram_token, u.telegram_chat_id
        FROM travel_requests t JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
      leave: `SELECT l.*, u.title, u.full_name, u.first_name, u.last_name, u.telegram_token, u.telegram_chat_id
        FROM leave_requests l JOIN users u ON u.id = l.user_id WHERE l.id = ?`,
      memo: `SELECT m.*, u.title AS maker_title, u.first_name, u.last_name, u.full_name, u.telegram_token, u.telegram_chat_id
        FROM memos m JOIN users u ON u.id = m.user_id WHERE m.id = ?`,
    }[system];
    if (!sql) return;
    const b = db.prepare(sql).get(Number(id));
    if (!b || !b.telegram_token || !b.telegram_chat_id) return;
    const text = requestText({ system, approved, b, deciderName, note, extra });
    await sendTelegram({ token: b.telegram_token, chatId: b.telegram_chat_id, text });
  } catch (e) {
    console.error('[telegram] notifyRequest error:', e.message);
  }
}

/**
 * ส่งข้อความ Telegram (token/chatId จากข้อมูลสมาชิก)
 * ไม่ throw ต่อให้ส่งไม่สำเร็จ (แจ้งเตือนล้มเหลวต้องไม่ขัดขวางการอนุมัติ)
 * @returns {Promise<boolean>} ส่งสำเร็จหรือไม่
 */
async function sendTelegram({ token, chatId, text }) {
  if (!token || !chatId || !text) return false;
  try {
    const resp = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!resp.ok) {
      console.error('[telegram] ส่งข้อความไม่สำเร็จ:', resp.status, await resp.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[telegram] เกิดข้อผิดพลาดในการส่ง:', e.message);
    return false;
  }
}

// ========== ระบบลา ==========

/** ดึงข้อมูลคำขอลาพร้อมชื่อผู้ขอ/ค่า Telegram */
function fetchLeaveRow(id) {
  return db.prepare(`SELECT l.*, u.title, u.full_name, u.first_name, u.last_name, u.telegram_token, u.telegram_chat_id,
    d.title AS delegate_title, d.first_name AS delegate_first_name, d.last_name AS delegate_last_name,
    d.telegram_token AS delegate_telegram_token, d.telegram_chat_id AS delegate_chat_id
    FROM leave_requests l JOIN users u ON u.id = l.user_id LEFT JOIN users d ON d.id = l.delegate_to WHERE l.id = ?`).get(Number(id));
}

/** ข้อความแจ้งผู้ตรวจสอบว่ามีคำขอลาใหม่ */
function leaveSubmittedText(b) {
  return [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    '🆕 มีคำขออนุญาตลาใหม่ รอการตรวจสอบ',
    '',
    '📋 รายละเอียด:',
    ...detailLines('leave', b),
  ].join('\n');
}

/** ข้อความแจ้งผู้ได้รับมอบหมายงาน (ผู้ทำหน้าที่แทน) ว่ามีคำขอลาใหม่ */
function leaveDelegateText(b) {
  return [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    '🆕 มีคำขออนุญาตลาใหม่ — คุณได้รับมอบหมายงานให้ทำหน้าที่แทน',
    '',
    '📋 รายละเอียด:',
    ...detailLines('leave', b),
  ].join('\n');
}

/** ข้อความแจ้งผู้อนุมัติขั้นต้นว่าผู้ตรวจสอบได้ตรวจสอบแล้ว */
function leaveReviewedText(b, reviewerName) {
  return [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    '⏳ มีคำขออนุญาตลา — ผู้ตรวจสอบได้ตรวจสอบแล้ว รอการอนุมัติขั้นต้น',
    '',
    '📋 รายละเอียด:',
    ...detailLines('leave', b),
    `• ผู้ตรวจสอบ: ${reviewerName || '-'}`,
  ].join('\n');
}

/** ข้อความแจ้งผู้อนุมัติขั้นถัดไปว่าผู้อนุมัติขั้นต้นได้อนุมัติแล้ว */
function leaveNextLevelText(b, deciderName) {
  return [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    '⏳ มีคำขออนุญาตลา — ผู้อนุมัติขั้นต้นได้อนุมัติแล้ว รอการอนุมัติขั้นสุดท้าย',
    '',
    '📋 รายละเอียด:',
    ...detailLines('leave', b),
    `• ผู้อนุมัติขั้นต้น: ${deciderName || '-'}`,
  ].join('\n');
}

/** key ตั้งค่าผู้อนุมัติการลา ตามกลุ่มผู้ขอ (สพป. = leave_approvers | สถานศึกษา = leave_approvers_school) */
function leaveApproverKeyOf(userId) {
  try {
    const u = db.prepare('SELECT user_group, school_code FROM users WHERE id = ?').get(Number(userId));
    const group = u ? (u.user_group || (u.school_code === '54020000' ? 'office' : 'school')) : 'office';
    return group === 'school' ? 'leave_approvers_school' : 'leave_approvers';
  } catch (e) { return 'leave_approvers'; }
}

/** หา id ผู้อนุมัติระดับที่กำหนดของผู้ขอ (รองรับทั้งฟอร์แมต per-requester map และ array เดิม) */
function leaveApproverIds(key, level, requesterId) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  let obj = null;
  try { obj = JSON.parse(row ? row.value : '{}'); } catch (e) { obj = null; }
  const lv = obj ? obj[String(level)] : null;
  if (Array.isArray(lv)) return lv.map(Number);
  if (lv && typeof lv === 'object') {
    const r = Number(lv[String(requesterId)] || 0);
    return r ? [r] : [];
  }
  return [];
}
/** แจ้งผู้ตรวจสอบ (leave level 1) ว่ามีคำขอลาใหม่ */
async function notifyLeaveSubmitted(id) {
  try {
    const b = fetchLeaveRow(id);
    if (!b) return;
    // ใช้ผู้ตรวจสอบ (level 1) ของผู้ขอ ตามตั้งค่าเจ้าหน้าที่การลา
    const ids = leaveApproverIds(leaveApproverKeyOf(b.user_id), 1, b.user_id);
    if (!ids.length) return;
    const users = db.prepare(`SELECT id, telegram_token, telegram_chat_id FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const text = leaveSubmittedText(b);
    const sentIds = new Set();
    for (const u of users) {
      if (u.telegram_token && u.telegram_chat_id) {
        await sendTelegram({ token: u.telegram_token, chatId: u.telegram_chat_id, text });
        sentIds.add(String(u.id));
      }
    }
    // แจ้งผู้ได้รับมอบหมายงานให้ทำหน้าที่แทน (ถ้ามีการเลือกไว้)
    if (b.delegate_to && b.delegate_telegram_token && b.delegate_chat_id && !sentIds.has(String(b.delegate_to))) {
      await sendTelegram({ token: b.delegate_telegram_token, chatId: b.delegate_chat_id, text: leaveDelegateText(b) });
    }
  } catch (e) {
    console.error('[telegram] notifyLeaveSubmitted error:', e.message);
  }
}

/** แจ้งผู้อนุมัติขั้นต้น (leave level 2) ว่าผู้ตรวจสอบตรวจสอบแล้ว */
async function notifyLeaveReviewed(id, reviewerName) {
  try {
    const b = fetchLeaveRow(id);
    if (!b) return;
    const ids = leaveApproverIds(leaveApproverKeyOf(b.user_id), 2, b.user_id);
    if (!ids.length) return;
    const users = db.prepare(`SELECT id, telegram_token, telegram_chat_id FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const text = leaveReviewedText(b, reviewerName);
    for (const u of users) {
      if (u.telegram_token && u.telegram_chat_id) {
        await sendTelegram({ token: u.telegram_token, chatId: u.telegram_chat_id, text });
      }
    }
  } catch (e) {
    console.error('[telegram] notifyLeaveReviewed error:', e.message);
  }
}

/** แจ้งผู้อนุมัติขั้นถัดไป (level 3) ว่าผู้อนุมัติขั้นต้นอนุมัติแล้ว */
async function notifyLeaveNextLevel(id, deciderName) {
  try {
    const b = fetchLeaveRow(id);
    if (!b) return;
    const ids = leaveApproverIds(leaveApproverKeyOf(b.user_id), 3, b.user_id);
    if (!ids.length) return;
    const users = db.prepare(`SELECT id, telegram_token, telegram_chat_id FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const text = leaveNextLevelText(b, deciderName);
    for (const u of users) {
      if (u.telegram_token && u.telegram_chat_id) {
        await sendTelegram({ token: u.telegram_token, chatId: u.telegram_chat_id, text });
      }
    }
  } catch (e) {
    console.error('[telegram] notifyLeaveNextLevel error:', e.message);
  }
}

/** ข้อความแจ้งผู้ตรวจสอบว่ามีคำขอ 'ยกเลิกวันลา' รอพิจารณา */
function leaveCancelText(b) {
  return [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    '⚠️ มีคำขอยกเลิกวันลา — รอผู้ตรวจสอบพิจารณายกเลิก',
    '',
    '📋 รายละเอียด:',
    ...detailLines('leave', b),
    `• ผู้ขอยกเลิก: ${b.full_name || '-'}`,
  ].join('\n');
}

/** แจ้งผู้ตรวจสอบ (leave level 1) ว่ามีการขอยกเลิกวันลา */
async function notifyLeaveCancelRequested(id) {
  try {
    const b = fetchLeaveRow(id);
    if (!b) return;
    const ids = leaveApproverIds(leaveApproverKeyOf(b.user_id), 1, b.user_id);
    if (!ids.length) return;
    const users = db.prepare(`SELECT id, telegram_token, telegram_chat_id FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const text = leaveCancelText(b);
    for (const u of users) {
      if (u.telegram_token && u.telegram_chat_id) {
        await sendTelegram({ token: u.telegram_token, chatId: u.telegram_chat_id, text });
      }
    }
  } catch (e) {
    console.error('[telegram] notifyLeaveCancelRequested error:', e.message);
  }
}

/** ข้อความแจ้งผู้ขอว่าวันลาถูกยกเลิกแล้ว */
function leaveCancelledText(b, deciderName) {
  return [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    '✅ คำขอยกเลิกวันลาของคุณได้รับการยกเลิกเรียบร้อยแล้ว',
    '',
    '📋 รายละเอียด:',
    ...detailLines('leave', b),
    `• ผู้ดำเนินการยกเลิก: ${deciderName || '-'}`,
  ].join('\n');
}

/** แจ้งผู้ขอยกเลิกว่าวันลาถูกยกเลิกแล้ว (ส่งก่อนลบรายการ — ใช้ข้อมูลแถวเดิม) */
async function notifyLeaveCancelled(id, deciderName) {
  try {
    const b = fetchLeaveRow(id);
    if (!b) return;
    if (b.telegram_token && b.telegram_chat_id) {
      await sendTelegram({ token: b.telegram_token, chatId: b.telegram_chat_id, text: leaveCancelledText(b, deciderName) });
    }
  } catch (e) {
    console.error('[telegram] notifyLeaveCancelled error:', e.message);
  }
}

// ===== Travel notifications =====

/** ดึงข้อมูล travel request พร้อม user info */
function fetchTravelRow(id) {
  return db.prepare(`SELECT r.*, u.title AS person_title, u.first_name, u.last_name, u.full_name, u.telegram_token, u.telegram_chat_id
    FROM travel_requests r JOIN users u ON u.id = r.user_id WHERE r.id = ?`).get(Number(id));
}

/** ข้อความแจ้งเมื่อมีคำขอไปราชการใหม่ → ส่งให้ผู้บังคับบัญชาขั้นต้น */
function travelSubmittedText(b) {
  return [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    '🆕 มีคำขออนุมัติ/อนุญาตเดินทางไปราชการใหม่ รอการตรวจสอบ',
    '',
    '📋 รายละเอียด:',
    ...detailLines('travel', b),
  ].join('\n');
}

/** ข้อความแจ้งเมื่อผู้บังคับบัญชาขั้นต้นตรวจสอบแล้ว → ส่งให้ผู้อนุมัติ */
function travelNextLevelText(b, deciderName) {
  return [
    '📣 P2-SMART สพป.แพร่ 2',
    '',
    '⏳ มีคำขออนุมัติ/อนุญาตเดินทางไปราชการ — ตรวจสอบแล้ว',
    '',
    '📋 รายละเอียด:',
    ...detailLines('travel', b),
    `• ผู้ตรวจสอบ: ${deciderName || '-'}`,
  ].join('\n');
}

/** ส่งแจ้งเตือนไปหาผู้บังคับบัญชาขั้นต้นเมื่อมีคำขอไปราชการใหม่ */
async function notifyTravelSubmitted(id) {
  try {
    const b = fetchTravelRow(id);
    if (!b) return;
    const text = travelSubmittedText(b);
    // สายอนุมัติตามกลุ่มผู้ขอ: school → ผู้ตรวจสอบ (ขั้น 1) | office → ผู้บังคับบัญชาขั้นต้น (ขั้น 1)
    const gu = db.prepare('SELECT user_group, school_code FROM users WHERE id = ?').get(b.user_id);
    const isSchool = gu && ((gu.user_group || (gu.school_code === '54020000' ? 'office' : 'school')) === 'school');
    const settingRow = db.prepare("SELECT value FROM settings WHERE key = ?").get(isSchool ? 'travel_approvers_school' : 'travel_approvers');
    let mapping = {};
    try { mapping = JSON.parse(settingRow ? settingRow.value : '{}'); } catch (e) { /* ignore */ }
    const entry = mapping[String(b.user_id)];
    if (!entry) return;
    const supervisorId = isSchool ? Number(entry.reviewer) : Number(entry.supervisor);
    if (!supervisorId) return;
    const u = db.prepare('SELECT telegram_token, telegram_chat_id FROM users WHERE id = ?').get(supervisorId);
    if (u && u.telegram_token && u.telegram_chat_id) {
      await sendTelegram({ token: u.telegram_token, chatId: u.telegram_chat_id, text });
    }
  } catch (e) {
    console.error('[telegram] notifyTravelSubmitted error:', e.message);
  }
}

/** ส่งแจ้งเตือนไปหาผู้อนุมัติเมื่อผู้บังคับบัญชาขั้นต้นตรวจสอบแล้ว */
async function notifyTravelNextLevel(id, deciderName) {
  try {
    const b = fetchTravelRow(id);
    if (!b) return;
    const text = travelNextLevelText(b, deciderName);
    // ขั้นถัดไปตามสายของผู้ขอ: school 3 ขั้น (reviewer→supervisor→approver) | office 2 ขั้น (supervisor→approver)
    const gu = db.prepare('SELECT user_group, school_code FROM users WHERE id = ?').get(b.user_id);
    const isSchool = gu && ((gu.user_group || (gu.school_code === '54020000' ? 'office' : 'school')) === 'school');
    const doneLevels = Math.max(1, Number(b.approval_level) || 1);
    const settingRow = db.prepare("SELECT value FROM settings WHERE key = ?").get(isSchool ? 'travel_approvers_school' : 'travel_approvers');
    let mapping = {};
    try { mapping = JSON.parse(settingRow ? settingRow.value : '{}'); } catch (e) { /* ignore */ }
    const entry = mapping[String(b.user_id)];
    if (!entry) return;
    let approverId = 0;
    if (isSchool) approverId = doneLevels === 1 ? Number(entry.supervisor) : Number(entry.approver);
    else approverId = Number(entry.approver);
    if (!approverId) return;
    const u = db.prepare('SELECT telegram_token, telegram_chat_id FROM users WHERE id = ?').get(approverId);
    if (u && u.telegram_token && u.telegram_chat_id) {
      await sendTelegram({ token: u.telegram_token, chatId: u.telegram_chat_id, text });
    }
  } catch (e) {
    console.error('[telegram] notifyTravelNextLevel error:', e.message);
  }
}

module.exports = {
  thaiDate, thaiDateRange, systemLabel, requestText,
  roomSubmittedText, roomLevelApprovedText, notifyApprovers,
  notifyRoomSubmitted, notifyRoomNextLevel,
  vehicleSubmittedText, vehicleLevelApprovedText, vehicleDriverNotifiedText,
  vehicleEditedText, vehicleNewDriverText, vehicleCancelledText,
  notifyVehicleSubmitted, notifyVehicleNextLevel, notifyVehicleDriver,
  notifyVehicleEdited, notifyVehicleCancelled,
  memoSubmittedText, memoNextLevelText, memoForwardedText, memoResubmittedText,
  notifyMemoSubmitted, notifyMemoNextLevel, notifyMemoForwarded, notifyMemoResubmitted, notifyMemoReturned,
  fetchLeaveRow, leaveSubmittedText, leaveDelegateText, leaveReviewedText, leaveNextLevelText,
  notifyLeaveSubmitted, notifyLeaveReviewed, notifyLeaveNextLevel,
  notifyLeaveCancelRequested, notifyLeaveCancelled,
  travelSubmittedText, travelNextLevelText, notifyTravelSubmitted, notifyTravelNextLevel,
  notifyRequest, sendTelegram,
};
