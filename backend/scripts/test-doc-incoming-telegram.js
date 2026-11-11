'use strict';
/**
 * ทดสอบข้อความแจ้งเตือน Telegram เมื่อมีหนังสือเข้ามาในเมนู "หนังสือรับ"
 * (ผู้ใช้สั่ง 11 พ.ย. 2569)
 *
 *   "เมื่อมีหนังสือเข้ามาในรายการหนังสือรับ จะมีข้อความแจ้งเตือน Telegram ว่า
 *    มีหนังสือส่งมาจาก....เรื่อง....ให้ตรวจสอบในเมนูหนังสือรับ"
 *
 * ตรวจ 2 ชั้น
 *   ① เนื้อข้อความ (เรียกฟังก์ชันตรง ๆ — ไม่ยิง Telegram จริง)
 *   ② ซอร์สโค้ด: POST /documents ต้องเรียกแจ้งเตือน + ส่งถึงผู้รับ (ไม่ใช่ผู้ส่ง) ที่ตั้งค่าไว้
 *
 * ใช้: node scripts/test-doc-incoming-telegram.js
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
const telegram = require(path.join(ROOT, 'lib', 'telegram.js'));

console.log('');
console.log('① เนื้อความแจ้งเตือน');

const text = telegram.incomingDocumentText({
  from_org: '54020001 บ้านน้ำริน (คุรุราษฎร์รังสรรค์)',
  title: 'ขอความอนุเคราะห์ข้อมูลบุคลากร',
  doc_no: 'ที่ ศธ 04110.0001/2',
  date: '2026-11-11',
  is_secret: 0,
});
check(typeof text === 'string' && text.length > 0, 'สร้างข้อความได้');
check(text.includes('มีหนังสือส่งมาจาก 54020001 บ้านน้ำริน (คุรุราษฎร์รังสรรค์)'),
  'มีบรรทัด "มีหนังสือส่งมาจาก ..."', text);
check(text.includes('เรื่อง: ขอความอนุเคราะห์ข้อมูลบุคลากร'), 'มีบรรทัด "เรื่อง: ..."', text);
check(text.includes('หนังสือรับ'), 'บอกให้ตรวจสอบในเมนู "หนังสือรับ"', text);
check(text.includes('ที่ ศธ 04110.0001/2'), 'มีเลขที่หนังสือ', text);

console.log('');
console.log('② หนังสือลับ — ต้องไม่ส่งชื่อเรื่องออกไป');
const secret = telegram.incomingDocumentText({
  from_org: 'โรงเรียนทดสอบ',
  title: 'ความลับสุดยอด',
  date: '2026-11-11',
  is_secret: 1,
});
check(!secret.includes('ความลับสุดยอด'), 'ไม่เปิดเผยชื่อเรื่องของหนังสือลับ', secret);
check(secret.includes('หนังสือลับ'), 'บอกว่าเป็นหนังสือลับ', secret);
check(secret.includes('หนังสือรับ'), 'ยังบอกให้ตรวจสอบในเมนู "หนังสือรับ"', secret);

console.log('');
console.log('③ ซอร์สโค้ด: เชื่อมการแจ้งเตือนถูกจุด');
const adminSrc = fs.readFileSync(path.join(ROOT, 'routes', 'admin.js'), 'utf8');
check(/telegram\.notifyIncomingDocument\(docId\)/.test(adminSrc),
  'POST /documents เรียก telegram.notifyIncomingDocument()',
  'ถ้าไม่เรียก จะไม่มีข้อความแจ้งเตือนเมื่อมีหนังสือเข้า');
check(/if \(recipCount > 0\) telegram\.notifyIncomingDocument/.test(adminSrc),
  'แจ้งเตือนเฉพาะเมื่อมีผู้รับจริง (ไม่แจ้งหนังสือที่ไม่มีผู้รับ)');
check(/notifyIncomingDocument\(docId\)\.catch\(\(\) => \{\}\)/.test(adminSrc),
  'ไม่ await การส่ง Telegram (หน้าบันทึกต้องไม่ค้างเพราะต้องส่งหลายคน)');

const tg = fs.readFileSync(path.join(ROOT, 'lib', 'telegram.js'), 'utf8');
check(/async function notifyIncomingDocument\(id\)/.test(tg), 'มีฟังก์ชัน notifyIncomingDocument()');
check(/FROM document_recipients WHERE document_id = \?/.test(tg),
  'ดึงรายชื่อผู้รับจาก document_recipients',
  'ผู้รับคือคนที่เห็นหนังสือในเมนูหนังสือรับ');
check(/uid !== Number\(doc\.created_by\)/.test(tg), 'ไม่แจ้งเตือนผู้ส่งเอง');
check(/u\.telegram_token && u\.telegram_chat_id/.test(tg), 'ส่งเฉพาะผู้ที่ตั้งค่า Telegram ไว้');
check(/notifyIncomingDocument/.test(tg.split('module.exports')[1] || ''),
  'export notifyIncomingDocument ออกจาก lib/telegram.js');

console.log('');
console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);
