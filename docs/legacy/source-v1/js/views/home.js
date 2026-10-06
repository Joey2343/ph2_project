'use strict';
/* หน้าแรก: เมนูไอคอน + สถิติสำหรับ admin */

const HomeView = {
  async render(app) {
    // ---- ป้ายต้อนรับ + กล่องลงเวลาทำงาน ----
    const banner = UI.h('div', { className: 'welcome-banner' },
      UI.h('img', { className: 'banner-logo', src: 'logo.png', alt: 'สพป.แพร่ เขต 2' }),
      UI.h('div', {},
        Auth.isLoggedIn()
          ? UI.h('h2', {}, `ยินดีต้อนรับ คุณ${Auth.user.full_name}`)
          : UI.h('h2', {}, 'ยินดีต้อนรับสู่ สพป.แพร่ เขต 2'),
        UI.h('p', {},
          Auth.isLoggedIn()
            ? (Auth.isAdmin()
                ? 'คุณเป็นผู้ดูแลระบบ สามารถบริหารจัดการได้ทุกเมนูในระบบ'
                : (Auth.user.user_group === 'school'
                    ? '🏫 เจ้าหน้าที่สถานศึกษา — สามารถเข้าดูได้เฉพาะเมนูข้อมูลพื้นฐาน พิกัดโรงเรียน และหนังสือราชการ'
                    : `ยินดีต้อนรับสู่ระบบบริหารจัดการภายในสำนักงาน — สิทธิ์ของคุณ: ${Auth.user.role_label || 'เจ้าหน้าที่'}`))
            : 'ระบบศูนย์กลางการบริหารจัดการภายในสำนักงาน — สมาชิกทั่วไปสามารถเข้าดูได้เฉพาะเมนูข้อมูลพื้นฐาน และพิกัดโรงเรียนในสังกัด')),
      // user สถานศึกษาไม่ใช้ระบบลงเวลาทำงาน — ซ่อนปุ่มเข้างาน/ออกงาน/ประวัติ
      Auth.isLoggedIn() && Auth.user.user_group !== 'school' ? HomeView.clockWidget() : null,
    );
    app.append(banner);

    // ---- สถิติสำหรับ admin และผู้มีสิทธิ์อนุมัติ (ซ่อนสำหรับเจ้าหน้าที่สถานศึกษา) ----
    let dashboard = null;
    if (Auth.isLoggedIn() && Auth.user.user_group !== 'school' && (Auth.isAdmin() || (Auth.user.can_approve && UI.isApprover()))) {
      try {
        dashboard = await API.get('/dashboard');
        const stats = [
          { icon: '◷', label: 'จองยานพาหนะรออนุมัติ', value: dashboard.pendingVehicle, color: 'var(--info-light)', cls: 'var(--info)' },
          { icon: '⬡', label: 'จองห้องประชุมรออนุมัติ', value: dashboard.pendingRoom, color: 'var(--success-light)', cls: 'var(--success)' },
          { icon: '✈', label: 'ไปราชการรออนุมัติ', value: dashboard.pendingTravel, color: 'var(--warning-light)', cls: 'var(--warning)' },
          { icon: '❋', label: 'ขอลารออนุมัติ', value: dashboard.pendingLeave, color: 'var(--danger-light)', cls: 'var(--danger)' },
          { icon: '⊕', label: 'รออนุมัติสมาชิกใหม่', value: dashboard.pendingUsers, color: 'var(--accent-light)', cls: 'var(--accent)' },
          { icon: '◷', label: 'รออนุมัติทั้งหมด', value: dashboard.pendingTotal, color: 'var(--warning-light)', cls: 'var(--warning)' },
          { icon: '▭', label: 'มาทำงานวันนี้', value: dashboard.todayClockedIn, color: 'var(--success-light)', cls: 'var(--success)' },
        ].filter((s) => s.value > 0); // การ์ดไหนเป็น 0 ไม่ต้องแสดง
        if (stats.length) app.append(UI.h('div', { className: 'stat-grid' }, stats.map((s) =>
          UI.h('div', { className: 'stat-card' },
            UI.h('div', { className: 'stat-icon', style: { background: s.color } }, s.icon),
            UI.h('div', {},
              UI.h('div', { className: 'stat-value' }, s.value),
              UI.h('div', { className: 'stat-label' }, s.label))))));
      } catch (e) { /* ignore */ }
    }

    // ---- การ์ดสถานะวันนี้ ----
    const isManager = Auth.isLoggedIn() && (Auth.isAdmin() || (Auth.user.can_approve && UI.isApprover()));
    if (Auth.isLoggedIn() && Auth.user.user_group !== 'school') {
      // ทุกคนสายสำนักงาน (admin/ผู้อนุมัติ/สมาชิกทั่วไป): การ์ด มาทำงานวันนี้ / เกิดวันนี้ / ลา / ไปราชการ
      try {
        const s = await API.get('/today-summary');
        const cards = [
          {
            icon: '▭', label: 'มาทำงานวันนี้', count: s.worked.length, color: 'var(--success-light)',
            open: () => HomeView.showList('▭ มาทำงานวันนี้', `ผู้ที่ลงเวลาเข้างานวันนี้ ${UI.thaiDate(s.today)} — ${s.worked.length} คน`, s.worked, [
              { key: 'full_name', label: 'ชื่อ-นามสกุล', render: (p) => UI.personName(p) },
              { key: 'position', label: 'ตำแหน่ง' },
              { key: 'workplace', label: 'กลุ่มงาน' },
              { key: 'clock_in', label: 'เวลาเข้า', render: (p) => UI.time(p.clock_in) },
              { key: 'clock_out', label: 'เวลาออก', render: (p) => UI.time(p.clock_out) },
            ]),
          },
          {
            icon: '★', label: 'เกิดวันนี้', count: s.birthdays.length, color: 'var(--warning-light)',
            open: () => HomeView.showList('★ วันเกิดวันนี้', `ผู้ที่เกิดวันนี้ ${UI.thaiDate(s.today)} — ${s.birthdays.length} คน`, s.birthdays, [
              { key: 'full_name', label: 'ชื่อ-นามสกุล', render: (p) => UI.personName(p) },
              { key: 'age', label: 'อายุ', render: (p) => (p.age != null ? `${p.age} ปี` : '-') },
              { key: 'position', label: 'ตำแหน่ง' },
              { key: 'workplace', label: 'กลุ่มงาน' },
            ]),
          },
          {
            icon: '❋', label: 'ลา', count: s.leave.length, color: 'var(--danger-light)',
            open: () => HomeView.showList('❋ ลาวันนี้', `ผู้ที่ลาวันนี้ ${UI.thaiDate(s.today)} — ${s.leave.length} คน`, s.leave, [
              { key: 'full_name', label: 'ชื่อ-นามสกุล', render: (p) => UI.personName(p) },
              { key: 'leave_type', label: 'ประเภทการลา' },
              { key: 'date_from', label: 'วันลา', render: (p) => `${UI.date(p.date_from)} ถึง ${UI.date(p.date_to)}` },
              { key: 'position', label: 'ตำแหน่ง' },
            ]),
          },
          {
            icon: '✈', label: 'ไปราชการ', count: s.travel.length, color: 'var(--info-light)',
            open: () => HomeView.showList('✈ ไปราชการวันนี้', `ผู้ที่ไปราชการวันนี้ ${UI.thaiDate(s.today)} — ${s.travel.length} คน`, s.travel, [
              { key: 'full_name', label: 'ชื่อ-นามสกุล', render: (p) => UI.personName(p) },
              { key: 'destination', label: 'สถานที่ไปราชการ' },
              { key: 'date_from', label: 'วันเดินทาง', render: (p) => `${UI.date(p.date_from)} ถึง ${UI.date(p.date_to)}` },
              { key: 'position', label: 'ตำแหน่ง' },
            ]),
          },
        ];
        const todayGrid = UI.h('div', { className: 'stat-grid' }, cards.filter((c) => c.count > 0).map((c) =>
          UI.h('div', { className: 'stat-card clickable', title: 'ดูรายละเอียด', onclick: c.open },
            UI.h('div', { className: 'stat-icon', style: { background: c.color } }, c.icon),
            UI.h('div', {},
              UI.h('div', { className: 'stat-value' }, c.count),
              UI.h('div', { className: 'stat-label' }, c.label)))));
        // admin/ผู้อนุมัติ: ต่อท้ายแถวสถิติ "รออนุมัติ" เดิม (ถ้ามี) — สมาชิกทั่วไป: แถวการ์ดใหม่
        const existingGrid = isManager ? document.querySelector('.stat-grid') : null;
        if (existingGrid) {
          while (todayGrid.firstChild) existingGrid.append(todayGrid.firstChild);
        } else {
          app.append(todayGrid);
        }
      } catch (e) { /* ignore */ }
    }

    // ---- ทุก user ที่ล็อกอิน (รวม admin): งานที่ค้าง / รออนุมัติของฉัน ----
    if (Auth.isLoggedIn()) {
      try {
        const mp = await API.get('/my-pending');
        const myCards = [
          { icon: '▣', label: 'จองยานพาหนะรออนุมัติ', count: mp.vehicle, color: 'var(--info-light)', href: '#/vehicles' },
          { icon: '⬡', label: 'จองห้องประชุมรออนุมัติ', count: mp.room, color: 'var(--success-light)', href: '#/rooms' },
          { icon: '✈', label: 'ไปราชการรออนุมัติ', count: mp.travel, color: 'var(--warning-light)', href: (Auth.user && Auth.user.user_group === 'school') ? '#/travel-school' : '#/travel' },
          ...(mp.leaveTypes && mp.leaveTypes.vacation > 0 ? [{ icon: '❋', label: 'ขอลาพักผ่อนรออนุมัติ', count: mp.leaveTypes.vacation, color: 'var(--danger-light)', href: (Auth.user && Auth.user.user_group === 'school') ? '#/leave?tab=vacation-school' : '#/leave?tab=vacation' }] : []),
          ...(mp.leaveTypes && mp.leaveTypes.general > 0 ? [{ icon: '❋', label: 'ขอลา (ป่วย/กิจ/คลอด)รออนุมัติ', count: mp.leaveTypes.general, color: 'var(--danger-light)', href: (Auth.user && Auth.user.user_group === 'school') ? '#/leave?tab=general-school' : '#/leave?tab=general' }] : []),
          ...(mp.leaveTypes && (mp.leaveTypes.general + mp.leaveTypes.vacation) === 0 && mp.leave > 0 ? [{ icon: '❋', label: 'ขอลารออนุมัติ', count: mp.leave, color: 'var(--danger-light)', href: '#/leave' }] : []),
          { icon: '✎', label: 'บันทึกข้อความรออนุมัติ', count: mp.memo, color: 'var(--accent-light)', href: '#/memos' },
          { icon: '↻', label: 'บันทึกข้อความส่งกลับเพื่อแก้ไข', count: mp.memoReturned || 0, color: 'var(--warning-light)', href: '#/memos' },
          { icon: '▣', label: 'แจ้งเตือนการจองยานพาหนะ', count: mp.vehicleNotices || 0, color: 'var(--warning-light)', href: '#/vehicles' },
        ];
        const totalPending = mp.vehicle + mp.room + mp.travel + mp.leave + mp.memo + (mp.memoReturned || 0) + (mp.vehicleNotices || 0);
        const activeCards = myCards.filter((c) => c.count > 0);
        if (activeCards.length > 0) {
          app.append(UI.h('div', { className: 'section-title' },
            `▭ งานที่ค้าง / รออนุมัติของฉัน (${totalPending} รายการ)`));
          app.append(UI.h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0', marginBottom: '22px' } }, activeCards.map((c, i) =>
            UI.h('a', { className: 'stat-card clickable', href: c.href, title: 'ดูรายการของฉัน', style: { flex: '0 0 auto', ...(i < activeCards.length - 1 ? { borderRight: '1px solid #e5e7eb' } : {}) } },
              UI.h('div', { className: 'stat-icon', style: { background: c.color } }, c.icon),
              UI.h('div', {},
                UI.h('div', { className: 'stat-value' }, c.count),
                UI.h('div', { className: 'stat-label' }, c.label))))));
        }

        // งานที่รอการอนุมัติจากฉัน (ขั้นต้น / ขั้นสุดท้าย) ของทั้ง 4 ระบบ
        const appr = mp.approve || {};
        // รวมการนับลาแบบแยกประเภท (leave_split) เข้ากับระบบ leave เดิม — deep-link ไปแทปที่ถูกต้อง
        const ls = appr.leave_split || {};
        if (appr.leave) {
          for (const lv of Object.keys(appr.leave)) {
            const n = appr.leave[lv] || 0;
            if (n > 0 && !ls.leave_general?.[lv] && !ls.leave_vacation?.[lv]) {
              (ls.leave_general = ls.leave_general || {})[lv] = n;
              if (!ls.leave_general.group) ls.leave_general.group = (Auth.user && Auth.user.user_group === 'school') ? 'school' : 'office';
            }
          }
        }
        delete appr.leave;
        const leaveHref = (sysKey) => {
          const g = ls[sysKey] || {};
          const tab = (g.group === 'school') ? (sysKey === 'leave_vacation' ? 'vacation-school' : 'general-school')
                                          : (sysKey === 'leave_vacation' ? 'vacation' : 'general');
          return '#/leave?tab=' + tab;
        };
        const LEVEL_LABELS = { 1: 'รออนุมัติขั้นต้น', 2: 'รออนุมัติ', 3: 'รออนุมัติ' };
        const approveCards = [];
        for (const [sys, label, icon, href, color] of [
          ['vehicle', 'ยานพาหนะ', '▣', '#/vehicles', 'var(--info-light)'],
          ['room', 'ห้องประชุม', '⬡', '#/rooms', 'var(--success-light)'],
          ['travel', 'ไปราชการ', '✈', '#/travel', 'var(--warning-light)'],
          ['travel_school', 'ไปราชการ (สถานศึกษา)', '✈', '#/travel-school', 'var(--warning-light)'],
          ['leave_general', 'ขอลา (ป่วย/กิจ/คลอด)', '❋', null, 'var(--danger-light)'],
          ['leave_vacation', 'ขอลาพักผ่อน', '❋', null, 'var(--danger-light)'],
          ['memo', 'บันทึกข้อความ', '✎', '#/memos', 'var(--accent-light)'],
        ]) {
          const lv = appr[sys] || ls[sys] || {};
          const useHref = href || leaveHref(sys);
          for (const level of [1, 2, 3]) {
            const n = lv[level] || 0;
            if (n > 0) {
              approveCards.push({ icon, label: `${label} ${LEVEL_LABELS[level]}`, count: n, color, href: useHref });
            }
          }
        }
        if (approveCards.length) {
          const total = approveCards.reduce((a, c) => a + c.count, 0);
          app.append(UI.h('div', { className: 'section-title' },
            `◷ งานรอการอนุมัติจากฉัน (${total} รายการ)`));
          app.append(UI.h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0', marginBottom: '22px' } }, approveCards.map((c, i) =>
            UI.h('a', { className: 'stat-card clickable', href: c.href, title: 'ดูรายการที่รอการอนุมัติจากฉัน', style: { flex: '0 0 auto', ...(i < approveCards.length - 1 ? { borderRight: '1px solid #e5e7eb' } : {}) } },
              UI.h('div', { className: 'stat-icon', style: { background: c.color } }, c.icon),
              UI.h('div', {},
                UI.h('div', { className: 'stat-value' }, c.count),
                UI.h('div', { className: 'stat-label' }, c.label))))));
        }
      } catch (e) { /* ignore */ }
    }

    // ---- เมนู grid (ไม่รวมเมนูที่ซ่อนไว้ เช่น ลงเวลาทำงาน) ----
    const gridMenus = MENUS.filter((m) => !m.hideFromGrid && canAccess(m.key));
    app.append(UI.h('div', { className: 'section-title' }, '▭ เมนูหลัก'));

    const grid = UI.h('div', { className: 'menu-grid' });

    function menuCard(m) {
      const card = UI.h('div', {
        className: 'menu-card',
        onclick: () => go(m.key),
      },
        UI.h('div', { className: 'menu-icon', style: { background: m.grad, boxShadow: '0 4px 10px rgba(0,0,0,.15)' } }, m.icon),
        UI.h('div', { className: 'menu-name' }, m.title),
        UI.h('div', { className: 'menu-desc' }, m.desc),
      );
      return card;
    }
    for (const m of gridMenus) grid.append(menuCard(m));
    app.append(grid);

  },

  /** Modal แสดงรายการทั่วไป (ชื่อ + คอลัมน์) */
  showList(title, subtitle, rows, cols) {
    const body = UI.h('div', {},
      UI.h('p', { className: 'hint', style: { marginBottom: '12px' } }, subtitle),
      !rows || rows.length === 0
        ? UI.empty('ไม่มีรายการในวันนี้', '▭')
        : UI.table(cols, rows),
    );
    UI.modal({ title, body, size: 'lg' });
  },

  /** Modal แสดงรายชื่อผู้ที่เกิดวันนี้ */
  showBirthdays(data) {
    const body = UI.h('div', {},
      UI.h('p', { className: 'hint', style: { marginBottom: '12px' } },
        `★ ผู้ที่เกิดวันนี้ ${UI.thaiDate(UI.today())} — มี ${data.count} คน`),
      data.count === 0
        ? UI.empty('ไม่มีผู้ที่เกิดวันนี้', '★')
        : UI.table([
          { key: 'full_name', label: 'ชื่อ-นามสกุล', render: (p) => UI.personName(p) },
          { key: 'age', label: 'อายุ', render: (p) => (p.age != null ? `${p.age} ปี` : '-') },
          { key: 'position', label: 'ตำแหน่ง' },
          { key: 'workplace', label: 'กลุ่มงาน' },
        ], data.people),
    );
    UI.modal({ title: '★ วันเกิดวันนี้', body, size: 'lg' });
  },

  /** กล่องลงเวลาทำงานบนแบนเนอร์ต้อนรับ (เฉพาะสมาชิก) */
  clockWidget() {
    const panel = UI.h('div', { className: 'home-clock' },
      UI.h('div', { className: 'home-clock-time', id: 'home-clock-now' }, '--:--:--'),
      UI.h('div', { className: 'home-clock-date', id: 'home-clock-date' }, ''),
      UI.h('div', { className: 'home-clock-status', id: 'home-clock-status' }),
      UI.h('div', { className: 'home-clock-btns' },
        UI.h('button', { className: 'btn btn-clock-in btn-sm', id: 'home-clock-in', onclick: () => check('in') }, '⬡ เข้างาน'),
        UI.h('button', { className: 'btn btn-clock-out btn-sm', id: 'home-clock-out', onclick: () => check('out') }, '🏁 ออกงาน'),
        UI.h('a', { className: 'home-clock-history', href: '#/clock', title: 'ดูประวัติการลงเวลา', 'aria-label': 'ดูประวัติการลงเวลา' }, '🕘')),
    );

    function fmtTime(t) { return t ? String(t).slice(0, 5) : '-'; }

    function statusPill(text, bg, color) {
      return UI.h('span', { className: 'status-pill', style: { background: bg, color, padding: '4px 12px', borderRadius: '999px', fontWeight: 700, fontSize: '12.5px' } }, text);
    }

    async function refresh() {
      try {
        const data = await API.get('/time/today');
        const rec = data.record;
        const statusEl = document.getElementById('home-clock-status');
        const inBtn = document.getElementById('home-clock-in');
        const outBtn = document.getElementById('home-clock-out');
        if (!statusEl) return;
        statusEl.innerHTML = '';
        if (rec && rec.clock_out) {
          statusEl.append(statusPill(`● ลงเวลาครบแล้ว (เข้า ${fmtTime(rec.clock_in)} • ออก ${fmtTime(rec.clock_out)})`, '#dcfce7', '#15803d'));
        } else if (rec && rec.clock_in) {
          statusEl.append(statusPill(`◷ เข้างานแล้ว ${fmtTime(rec.clock_in)} — อย่าลืมลงเวลาออกงาน`, '#fef3c7', '#b45309'));
        } else {
          statusEl.append(statusPill('ยังไม่ได้ลงเวลาเข้างานวันนี้', '#fef3c7', '#b45309'));
        }
        if (inBtn) inBtn.disabled = !!(rec && rec.clock_in);
        if (outBtn) outBtn.disabled = !rec || !rec.clock_in || !!rec.clock_out;
      } catch (e) { /* ignore */ }
    }

    async function check(type) {
      try {
        const res = await API.post('/time/check', { type });
        UI.toast(res.message);
        refresh();
      } catch (e) { UI.toast(e.message, 'error'); }
    }

    // วันที่ + นาฬิกาสด
    const d = new Date();
    const dateEl = document.getElementById('home-clock-date');
    if (dateEl) {
      dateEl.textContent = `${UI.thaiDate(UI.today())} • ${['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'][d.getDay()]}`;
    }
    const tick = () => {
      const el = document.getElementById('home-clock-now');
      if (el) el.textContent = new Date().toTimeString().slice(0, 8);
    };
    tick();
    setInterval(tick, 1000);
    refresh();
    return panel;
  },
};
