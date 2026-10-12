/**
 * ปิดการเดาข้อความเก่าของเบราว์เซอร์ (autofill / "ข้อความที่เคยพิมพ์")
 *
 * ปัญหา
 * ──────
 * พิมพ์อะไรลงช่องพิมพ์ข้อความหนึ่งครั้ง แล้วกลับมาพิมพ์ช่องเดิมอีก
 * เบราว์เซอร์จะเดาข้อความเก่ามาให้เลือก (dropdown) ซึ่งไม่เกี่ยวกับช่องนั้นจริง ๆ
 * เช่นพิมพ์ชื่อโรงเรียน "บ้านน้ำริน" ไป แล้วไปพิมพ์ช่องชื่อหนังสือภายหลัง
 * ก็จะเห็นรายการชื่อโรงเรียนโผล่มาให้เลือก — กินเวลาและเสี่ยงกดผิด
 *
 * วิธีแก้
 * ──────
 * ใส่ autocomplete="off" ให้ช่องพิมพ์ข้อความทุกช่อง
 *
 * ทำแบบรวมศูนย์ที่จุดเดียว ไม่ไล่ไปแก้ทุกไฟล์ เพราะ:
 *   - ระบบมีช่องพิมพ์อยู่หลายร้อยช่อง แก้ทีเดียวจะพลาดแน่นอน
 *   - modal ถูกสร้างตอนคลิก ช่องข้างในจึงไม่มีตอนที่หน้าโหลดครั้งแรก
 *   - ถ้าไม่มี MutationObserver ช่องใน modal จะไม่มี autocomplete="off"
 *
 * ไม่แตะ
 * ──────
 *   - ช่องที่ตั้ง autocomplete ไว้เองแล้ว (ตั้งใจเป็นค่านั้น เช่น "หนังสือจาก")
 *   - ช่องรหัสผ่าน (อยากให้เบราว์เซอร์ช่วยจัดการรหัสผ่านได้)
 *   - ช่องไฟล์ / วันที่ / ตัวเลข / อีเมล (เบราว์เซอร์ไม่เดาข้อความให้อยู่แล้ว)
 */

/** ชนิด input ที่เบราว์เซอร์เอาไป "เดา" ข้อความเก่าให้ */
const TEXT_TYPES = new Set(['text', 'search', 'url', 'tel']);

/** ใส่ autocomplete="off" ให้ช่องนี้ถ้ายังไม่มีการตั้งค่าไว้ */
function markOff(el) {
  if (!el || el.nodeType !== 1) return;
  if (el.tagName === 'TEXTAREA') {
    if (!el.getAttribute('autocomplete')) el.setAttribute('autocomplete', 'off');
    return;
  }
  if (el.tagName !== 'INPUT') return;
  // ไม่ใส่ type = text
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  if (!TEXT_TYPES.has(type)) return;
  if (el.getAttribute('autocomplete')) return; // ตั้งไว้เองแล้ว = ตั้งใจ
  el.setAttribute('autocomplete', 'off');
}

export function disableBrowserAutofill() {
  const scan = (root) => {
    if (!root || !root.querySelectorAll) return;
    for (const el of root.querySelectorAll('input, textarea')) markOff(el);
  };

  scan(document);

  // modal/ฟอร์มเปิดทีหลัง → ต้องจับให้ทัน
  let queued = false;
  const flush = () => {
    queued = false;
    scan(document);
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
    else setTimeout(flush, 0);
  };

  const start = document.body || document.documentElement;
  if (!start) return;
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') markOff(node);
        else scan(node);
      }
    }
    schedule();
  }).observe(start, { childList: true, subtree: true });
}

export default disableBrowserAutofill;