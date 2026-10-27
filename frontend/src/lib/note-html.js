/**
 * ตัวช่วยจัดการข้อความ "สิ่งที่ให้แก้ไข" ที่มีไฮไลท์สี
 *
 * ทำไมต้องมี
 * ──────────
 * ผู้ใช้ขอให้ช่อง "สิ่งที่ให้แก้ไข" (หน้าคืนเรื่องเพื่อแก้ไข) มีเครื่องมือไฮไลท์
 * คลุมสีส้ม/เหลือง/เขียวได้ → ข้อความที่เก็บจึงเป็น HTML
 *
 * ⚠️ ต้องทำความสะอาดก่อนบันทึกและก่อนแสดง (v-html)
 *    รับเฉพาะแท็กที่จำเป็น + เก็บเฉพาะ style background-color
 *    ตัด script/style/iframe และ event handler ทั้งหมด
 */

/** แท็กที่ยอมให้แสดง */
const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'MARK', 'BR', 'DIV', 'P', 'SPAN']);

/** หนีอักขระ HTML (ใช้กับข้อความที่ผู้ใช้พิมพ์) */
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * ทำความสะอาด HTML ของข้อความ "สิ่งที่ให้แก้ไข"
 * คืน HTML ที่มีแต่แท็กที่อนุญาต + ไฮไลท์ (background-color)
 */
export function sanitizeNoteHtml(html) {
  const raw = String(html || '').trim();
  if (!raw) return '';
  if (typeof document === 'undefined') return esc(raw);

  const doc = new DOMParser().parseFromString(`<div id="__nr__">${raw}</div>`, 'text/html');
  const root = doc.getElementById('__nr__');
  if (!root) return '';

  const out = [];
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        out.push(esc(n.nodeValue));
        continue;
      }
      if (n.nodeType !== 1) continue;
      const tag = String(n.tagName || '').toUpperCase();
      if (!ALLOWED.has(tag)) {
        walk(n); // แท็กที่ไม่อนุญาต → ตัดแท็กแต่เก็บข้อความข้างใน
        continue;
      }
      if (tag === 'BR') {
        out.push('<br>');
        continue;
      }
      const t = tag.toLowerCase();
      const bg = n.style && n.style.backgroundColor ? n.style.backgroundColor : '';
      out.push(bg ? `<${t} style="background-color:${esc(bg)}">` : `<${t}>`);
      walk(n);
      out.push(`</${t}>`);
    }
  };
  walk(root);
  return out.join('').trim();
}

/** ข้อความล้วนจาก HTML (ใช้ตรวจว่ากรอกมาจริงไหม) */
export function notePlainText(html) {
  const raw = String(html || '');
  if (!raw) return '';
  if (typeof document === 'undefined') return raw.replace(/<[^>]*>/g, ' ').trim();
  const d = document.createElement('div');
  d.innerHTML = raw;
  return String(d.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
