/**
 * นาฬิกาจำลองฝั่งเบราว์เซอร์ — ประสานกับ lib/simdate.js ฝั่ง server
 * อ่านวันที่จำลองจาก /api/sim-date แล้ว patch Date ของหน้าเว็บให้ "วันนี้" ตรงกับ server
 * เมื่อไม่มีการจำลอง ทุกอย่างทำงานปกติ (ไม่ patch อะไรเลย)
 *
 * port จาก public/js/sim-date.js — logic เดิมทุกส่วน เปลี่ยนเพียงรูปแบบจาก IIFE
 * เป็นโมดูลที่ export ไว้ (และยังติดตั้งไว้ที่ window.__SIM_DATE ให้โค้ดเดิมเรียกใช้ได้)
 */
const RealDate = Date;
let simOffsetMs = 0;
let simToday = '';

function fmtISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function applyOffset() {
  if (!simToday) {
    simOffsetMs = 0;
    return;
  }
  const target = new RealDate(simToday + 'T12:00:00');
  simOffsetMs = target.getTime() - RealDate.now();
}

const SimDate = function Date(...args) {
  if (args.length === 0) return new RealDate(RealDate.now() + simOffsetMs);
  return new RealDate(...args);
};
SimDate.prototype = RealDate.prototype;
Object.setPrototypeOf(SimDate, RealDate);
SimDate.now = function () {
  return RealDate.now() + simOffsetMs;
};

/** callback แจ้งว่าวันจำลองเปลี่ยน — ให้ Vue component ที่ต้องอัปเดตตามต่อไป */
let onChange = null;
export function onSimDateChange(fn) {
  onChange = fn;
}

export const simDate = {
  get active() {
    return !!simToday;
  },
  get today() {
    return simToday;
  },
  async refresh() {
    try {
      const r = await fetch('/api/sim-date', { credentials: 'same-origin' });
      if (!r.ok) {
        // ยังไม่ล็อกอิน/เซสชันหมด — ถือว่าไม่จำลอง (กันวันจำลองค้างบนหน้าสาธารณะ)
        const was = simToday;
        simToday = '';
        applyOffset();
        if (was) globalThis.Date = RealDate;
        if (onChange) onChange();
        return;
      }
      const j = await r.json();
      const changed = (j.sim_today || '') !== simToday;
      simToday = j.sim_today || '';
      applyOffset();
      if (changed && simToday) {
        globalThis.Date = SimDate;
        try {
          if (window.UI && window.UI.toast)
            window.UI.toast('⏱ โหมดจำลอง: ระบบถือว่าวันนี้คือ ' + fmtISO(new RealDate(RealDate.now() + simOffsetMs)));
        } catch (e) {
          /* ignore */
        }
      } else if (changed && !simToday) {
        globalThis.Date = RealDate;
      }
      if (changed && onChange) onChange();
    } catch (e) {
      /* ไม่ได้ล็อกอิน/ยังไม่พร้อม — ข้าม */
    }
  },
  async set(dateStr) {
    const r = await fetch('/api/sim-date', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dateStr }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'บันทึกไม่สำเร็จ');
    simToday = j.sim_today || '';
    applyOffset();
    if (simToday) globalThis.Date = SimDate;
    else globalThis.Date = RealDate;
    if (onChange) onChange();
    return j;
  },
};

// ดึงสถานะครั้งแรก แล้วเช็คซ้ำเมื่อกลับมาที่แท็บ (admin อาจเพิ่งเปิด/ปิดจากอีกหน้า)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) simDate.refresh();
});
window.addEventListener('focus', () => simDate.refresh());

export default simDate;
