'use strict';
/**
 * นาฬิกาจำลองฝั่งเบราว์เซอร์ — ประสานกับ lib/simdate.js ฝั่ง server
 * อ่านวันที่จำลองจาก /api/sim-date แล้ว patch Date ของหน้าเว็บให้ "วันนี้" ตรงกับ server
 * เมื่อไม่มีการจำลอง ทุกอย่างทำงานปกติ (ไม่ patch อะไรเลย)
 */
(function () {
  const RealDate = Date;
  let simOffsetMs = 0;
  let simToday = '';

  function fmtISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function applyOffset() {
    if (!simToday) { simOffsetMs = 0; return; }
    const target = new RealDate(simToday + 'T12:00:00');
    simOffsetMs = target.getTime() - RealDate.now();
  }

  const SimDate = function Date(...args) {
    if (args.length === 0) return new RealDate(RealDate.now() + simOffsetMs);
    return new RealDate(...args);
  };
  SimDate.prototype = RealDate.prototype;
  Object.setPrototypeOf(SimDate, RealDate);
  SimDate.now = function () { return RealDate.now() + simOffsetMs; };

  window.__SIM_DATE = {
    get active() { return !!simToday; },
    get today() { return simToday; },
    async refresh() {
      try {
        const r = await fetch('/api/sim-date', { credentials: 'same-origin' });
        if (!r.ok) { // ยังไม่ล็อกอิน/เซสชันหมด — ถือว่าไม่จำลอง (กันวันจำลองค้างบนหน้าสาธารณะ)
          const was = simToday; simToday = ''; applyOffset();
          if (was) globalThis.Date = RealDate;
          return;
        }
        const j = await r.json();
        const changed = (j.sim_today || '') !== simToday;
        simToday = j.sim_today || '';
        applyOffset();
        if (changed && simToday) {
          globalThis.Date = SimDate;
          try { if (window.UI && UI.toast) UI.toast('⏱ โหมดจำลอง: ระบบถือว่าวันนี้คือ ' + fmtISO(new RealDate(RealDate.now() + simOffsetMs))); } catch (e) {}
        } else if (changed && !simToday) {
          globalThis.Date = RealDate;
        }
      } catch (e) { /* ไม่ได้ล็อกอิน/ยังไม่พร้อม — ข้าม */ }
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
      if (simToday) globalThis.Date = SimDate; else globalThis.Date = RealDate;
      return j;
    },
  };

  // ดึงสถานะครั้งแรก แล้วเช็คซ้ำเมื่อกลับมาที่แท็บ (admin อาจเพิ่งเปิด/ปิดจากอีกหน้า)
  window.__SIM_DATE.refresh();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) window.__SIM_DATE.refresh(); });
  window.addEventListener('focus', () => window.__SIM_DATE.refresh());
})();
