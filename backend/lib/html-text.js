'use strict';
/**
 * ตัวช่วยจัดการข้อความแบบ HTML (ใช้กับช่อง "สิ่งที่ให้แก้ไข" ที่มีไฮไลท์สี)
 *
 * ทำไมต้องมี
 * ──────────
 * ผู้ใช้ขอให้ช่อง "สิ่งที่ให้แก้ไข" ในหน้าคืนเรื่องเพื่อแก้ไข มีเครื่องมือไฮไลท์
 * (คลุมสีส้ม เหลือง เขียว) → ข้อความที่บันทึกจึงเป็น HTML (มี <span style="background-color:...">)
 *
 * แต่ปลายทางบางที่ต้องการ "ข้อความล้วน" เช่น
 *   - ข้อความ Telegram (ถ้าส่ง HTML ไปจะเห็นแท็กเต็มไปหมด)
 *   - การตรวจว่า "กรอกข้อความมาจริงไหม" (ผู้ใช้อาจเลือกไฮไลท์เฉย ๆ โดยไม่พิมพ์อะไร)
 *
 * ไฟล์นี้จึงมี 2 ฟังก์ชัน:
 *   htmlToText(html)        → ข้อความล้วน (ใช้ตรวจค่าว่าง + ส่ง Telegram)
 *   sanitizeNoteHtml(html)  → HTML ที่ปลอดภัย (ตัด script/style/event handler)
 */

/** แท็กที่อนุญาตในข้อความ "สิ่งที่ให้แก้ไข" */
const ALLOWED_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 'mark', 'br', 'div', 'p', 'span',
]);

/** ตัดแท็กอันตรายทั้งบล็อก (พร้อมเนื้อหา) */
function dropBlocks(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe\s*>/gi, '')
    .replace(/<object\b[\s\S]*?<\/object\s*>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*>/gi, '');
}

/**
 * แปลง HTML → ข้อความล้วน
 * (ขึ้นบรรทัดใหม่ที่ <br>, </div>, </p> · ถอดแท็กอื่นออก · ถอด entity พื้นฐาน)
 */
function htmlToText(html) {
  let s = dropBlocks(html);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(div|p|li|tr)\s*>/gi, '\n');
  s = s.replace(/<[^>]*>/g, '');
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&');
  return s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * ทำความสะอาด HTML ก่อนบันทึก
 * - ตัดแท็กอันตราย + event handler + javascript:
 * - เหลือเฉพาะแท็กที่อนุญาต (แท็กอื่นถอดออกแต่เก็บข้อความข้างใน)
 * - เก็บเฉพาะ style background-color (ไฮไลท์)
 *
 * ทำงานด้วย regex เพราะฝั่งเซิร์ฟเวอร์ไม่มี DOM
 * (ฝั่งหน้าเว็บยังทำซ้ำอีกชั้นด้วย DOMParser ใน src/lib/note-html.js)
 */
function sanitizeNoteHtml(html) {
  let s = dropBlocks(html);
  // ตัด event handler เช่น onclick="..." / onmouseover='...'
  s = s.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
  // javascript:/data: ใน href/src
  s = s.replace(/\s(?:href|src)\s*=\s*"\s*(?:javascript|data):[^"]*"/gi, '');
  s = s.replace(/\s(?:href|src)\s*=\s*'\s*(?:javascript|data):[^']*'/gi, '');

  // เก็บเฉพาะแท็กที่อนุญาต — แท็กอื่นเปลี่ยนเป็นข้อความข้างใน
  s = s.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (m, slash, tag, attrs) => {
    const t = String(tag).toLowerCase();
    if (!ALLOWED_TAGS.has(t)) return '';
    if (slash) {
      if (t === 'br') return ''; // </br> ไม่มีจริง — ไม่ต้องคืนอะไร
      return `</${t}>`;
    }
    if (t === 'br') return '<br>';
    const bg = /background-color\s*:\s*([^;"'<>]+)/i.exec(attrs || '');
    if (bg && (t === 'span' || t === 'div' || t === 'p' || t === 'mark')) {
      const color = String(bg[1]).trim();
      return `<${t} style="background-color:${color}">`;
    }
    return `<${t}>`;
  });

  return s.trim();
}

module.exports = { htmlToText, sanitizeNoteHtml };
