'use strict';
/* เมนู 3: ลงเวลาทำงาน */

const ClockView = {
  async render(app) {
    const head = UI.h('div', { className: 'page-head' },
      UI.h('div', {},
        UI.h('div', { className: 'page-title' }, UI.h('span', { className: 'pi' }, '⏰'), 'ลงเวลาทำงาน'),
        UI.h('div', { className: 'page-desc' }, 'ลงเวลาเข้างานและออกงานประจำวัน')),
    );
    app.append(head);

    // สิทธิ์ดูบันทึกเวลาทั้งหมด: admin หรือผู้ที่ได้รับสิทธิ์จาก admin (เห็นเหมือน admin)
    const canViewAll = Auth.isAdmin() || !!(Auth.user && Auth.user.is_time_editor);

    // ---- กล่องลงเวลา ----
    const clockCard = UI.h('div', { className: 'card' }, UI.loading());
    app.append(clockCard);

    if (canViewAll) {
      const adminCard = UI.h('div', { className: 'card' });
      const head2 = UI.h('div', { className: 'card-title' }, '📊 ภาพรวมการลงเวลาวันนี้');
      const statsEl = UI.h('div', { className: 'stat-grid', style: { marginBottom: '0' } });
      adminCard.append(head2, statsEl);
      app.append(adminCard);

      try {
        const stats = await API.get('/time/stats');
        statsEl.innerHTML = '';
        const items = [
          { icon: '🧑‍▭', label: 'เจ้าหน้าที่ทั้งหมด', value: stats.activeUsers },
          { icon: '●', label: 'ลงเวลาเข้างานแล้ว', value: stats.checkedIn },
          { icon: '🏁', label: 'ลงเวลาออกงานแล้ว', value: stats.checkedOut },
        ];
        for (const it of items) {
          statsEl.append(UI.h('div', { className: 'stat-card' },
            UI.h('div', { className: 'stat-icon', style: { background: 'var(--primary-light)' } }, it.icon),
            UI.h('div', {},
              UI.h('div', { className: 'stat-value' }, it.value),
              UI.h('div', { className: 'stat-label' }, it.label))));
        }
      } catch (e) { /* ignore */ }
    }

    // ---- ตารางบันทึกเวลา ----
    const tableCard = UI.h('div', { className: 'card' }, UI.loading());
    app.append(tableCard);

    if (canViewAll) {
      // ตัวกรองสำหรับผู้ดูทั้งหมด + ปุ่มรายงาน + ปุ่มเพิ่มเจ้าหน้าที่ (เฉพาะ admin)
      const filterRow = UI.h('div', { className: 'filter-row' },
        UI.thaiMonthInput('clock-month', { value: new Date().toISOString().slice(0, 7), onChange: loadAll }),
        UI.h('button', { className: 'btn btn-outline btn-sm', onclick: loadAll }, '⊕ แสดงข้อมูล'),
        UI.h('button', { className: 'btn btn-info btn-sm', onclick: () => ClockView.openReportModal() }, '📊 รายงาน'),
        Auth.isAdmin()
          ? UI.h('div', { style: { display: 'flex', gap: '8px' } },
              UI.h('button', { className: 'btn btn-primary btn-sm', onclick: () => ClockView.openEditorsModal() }, '+ เพิ่มเจ้าหน้าที่'),
              UI.h('button', { className: 'btn btn-outline btn-sm', onclick: () => ClockView.openLocationSettingsModal() }, '📍 ตั้งค่าตำแหน่งที่ทำงาน'))
          : UI.h('span', { className: 'hint', style: { marginLeft: 'auto' } }, 'คุณมีสิทธิ์แก้ไข/ดูบันทึกเวลาทั้งหมด'),
      );
      app.append(filterRow);
    } else {
      const monthRow = UI.h('div', { className: 'filter-row' },
        UI.thaiMonthInput('clock-month', { value: new Date().toISOString().slice(0, 7), onChange: loadMine }));
      app.append(monthRow);
    }

    async function loadAll() {
      const month = UI.readThaiMonthInput('clock-month') || new Date().toISOString().slice(0, 7);
      try {
        const data = await API.get('/time/all?month=' + encodeURIComponent(month || ''));
        tableCard.innerHTML = '';
        tableCard.append(UI.h('div', { className: 'card-title' }, '▭ บันทึกเวลาทำงานของเจ้าหน้าที่'));
        if (!data.records.length) {
          tableCard.append(UI.empty('ยังไม่มีข้อมูลการลงเวลาในเดือนนี้', '🗓️'));
          return;
        }
        tableCard.append(UI.table([
          { key: 'date', label: 'วันที่', render: (r) => UI.date(r.date) },
          { key: 'full_name', label: 'ชื่อ-นามสกุล', render: (r) => UI.personName(r) },
          { key: 'workplace', label: 'กลุ่มงาน' },
          { key: 'clock_in', label: 'เวลาเข้า', render: (r) => UI.time(r.clock_in) },
          { key: 'clock_out', label: 'เวลาออก', render: (r) => UI.time(r.clock_out) },
          { key: 'actions', label: '', render: (r) => ClockView.editBtn(r) },
        ], data.records));
      } catch (e) { UI.toast(e.message, 'error'); }
    }

    async function loadMine() {
      const month = UI.readThaiMonthInput('clock-month') || new Date().toISOString().slice(0, 7);
      try {
        const data = await API.get('/time/mine?month=' + encodeURIComponent(month));
        tableCard.innerHTML = '';
        tableCard.append(UI.h('div', { className: 'card-title' }, `▭ บันทึกเวลาของฉัน (${month})`));
        if (!data.records.length) {
          tableCard.append(UI.empty('ยังไม่มีข้อมูลการลงเวลาในเดือนนี้', '🗓️'));
          return;
        }
        const cols = [
          { key: 'date', label: 'วันที่', render: (r) => UI.date(r.date) },
          { key: 'clock_in', label: 'เวลาเข้า', render: (r) => UI.time(r.clock_in) },
          { key: 'clock_out', label: 'เวลาออก', render: (r) => UI.time(r.clock_out) },
        ];
        if (data.can_edit) cols.push({ key: 'actions', label: '', render: (r) => ClockView.editBtn(r) });
        tableCard.append(UI.table(cols, data.records));
      } catch (e) { UI.toast(e.message, 'error'); }
    }

    // ---- กล่องลงเวลาสำหรับสมาชิก ----
    async function loadToday() {
      try {
        const data = await API.get('/time/today');
        const rec = data.record;
        const now = new Date();
        const timeEl = UI.h('div', { className: 'clock-time', id: 'clock-now' }, now.toTimeString().slice(0, 8));
        const dateEl = UI.h('div', { className: 'clock-date' }, UI.thaiDate(data.today) + ' • ' + ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'][now.getDay()]);
        const statusEl = UI.h('div', { style: { marginBottom: '14px' } },
          rec
            ? UI.h('span', { className: 'status-pill', style: { background: rec.clock_out ? '#e2e8f0' : '#dcfce7', color: rec.clock_out ? '#64748b' : '#15803d', padding: '4px 14px', borderRadius: '999px', fontWeight: 700 } },
              rec.clock_out ? `● ลงเวลาครบแล้ววันนี้ (เข้า ${UI.time(rec.clock_in)} • ออก ${UI.time(rec.clock_out)})` : `◷ เข้างานแล้วเมื่อ ${UI.time(rec.clock_in)} — อย่าลืมลงเวลาออกงาน`)
            : UI.h('span', { className: 'status-pill', style: { background: '#fef3c7', color: '#b45309', padding: '4px 14px', borderRadius: '999px', fontWeight: 700 } }, 'ยังไม่ได้ลงเวลาเข้างานวันนี้'));

        // ลงเวลาพร้อมตรวจตำแหน่ง: มือถือ/แท็บเล็ต → GPS ของอุปกรณ์, คอมพิวเตอร์/แล็ปท็อป → IP ของที่ทำงาน
        async function doCheck(type, btn) {
          const device = ClockView.isMobileDevice() ? 'mobile' : 'desktop';
          const payload = { type, device };
          const oldLabel = btn.textContent;
          btn.disabled = true;
          btn.textContent = '📡 กำลังตรวจสอบตำแหน่ง...';
          if (device === 'mobile') {
            try {
              const pos = await new Promise((resolve, reject) => {
                if (!navigator.geolocation) return reject(new Error('NO_GEO'));
                navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
              });
              payload.lat = pos.coords.latitude;
              payload.lng = pos.coords.longitude;
            } catch (e) {
              btn.disabled = false;
              btn.textContent = oldLabel;
              const code = e && e.code;
              const msg = e && e.message === 'NO_GEO' ? 'เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง GPS' :
                code === 1 ? 'คุณไม่อนุญาตให้ระบบใช้ตำแหน่ง GPS — กรุณาอนุญาตตำแหน่งในเบราว์เซอร์' :
                code === 2 ? 'ไม่สามารถระบุตำแหน่ง GPS ได้ (สัญญาณดาวเทียมไม่ดี) — กรุณาลองใหม่' :
                code === 3 ? 'การระบุตำแหน่งใช้เวลานานเกินไป — กรุณาลองใหม่' :
                'ไม่สามารถระบุตำแหน่ง GPS ได้ — กรุณาลองใหม่';
              return UI.toast(msg, 'error');
            }
          }
          try {
            const res = await API.post('/time/check', payload);
            UI.toast(res.warning && res.warning.length ? res.message + ' — ' + res.warning.join('; ') : res.message, res.warning && res.warning.length ? 'warning' : 'success');
            loadToday();
          } catch (e) {
            UI.toast(e.message, 'error');
            btn.disabled = false;
            btn.textContent = oldLabel;
          }
        }

        const btnIn = UI.h('button', {
          className: 'btn btn-primary clock-btn',
          disabled: !!rec && !!rec.clock_in,
          onclick: () => doCheck('in', btnIn),
        }, '⬡ ลงเวลาเข้างาน');
        const btnOut = UI.h('button', {
          className: 'btn btn-accent clock-btn',
          disabled: !rec || !rec.clock_in || !!rec.clock_out,
          onclick: () => doCheck('out', btnOut),
        }, '🏁 ลงเวลาออกงาน');
        const btns = UI.h('div', { className: 'clock-btns' }, btnIn, btnOut);
        clockCard.innerHTML = '';
        clockCard.append(UI.h('div', { className: 'clock-box' }, timeEl, dateEl, statusEl, btns));
        setInterval(() => {
          const el = document.getElementById('clock-now');
          if (el) el.textContent = new Date().toTimeString().slice(0, 8);
        }, 1000);
      } catch (e) {
        clockCard.innerHTML = '';
        clockCard.append(UI.empty(e.message, '⚠️'));
      }
    }

    await loadToday();
    if (canViewAll) {
      await loadAll();
    } else {
      await loadMine();
    }
  },

  /** ปุ่มดินสอแก้ไขเวลา + ปุ่มลบ (ท้ายแถว) */
  editBtn(r) {
    return UI.h('div', { style: { display: 'inline-flex', gap: '6px' } },
      UI.h('button', {
        className: 'btn btn-xs btn-outline',
        title: 'แก้ไขเวลา',
        onclick: () => ClockView.editTime(r),
      }, '✎'),
      UI.h('button', {
        className: 'btn btn-xs btn-danger',
        title: 'ลบบันทึกเวลา',
        onclick: () => ClockView.deleteRecord(r),
      }, '✕'));
  },

  /** ลบบันทึกเวลา (ปุ่ม ✕ ในตาราง) */
  async deleteRecord(r) {
    const ok = await UI.confirm(`ต้องการลบบันทึกเวลา ${UI.date(r.date)}${r.full_name ? ' ของ ' + UI.personName(r) : ''} ใช่หรือไม่?`, { danger: true, okText: 'ลบ' });
    if (!ok) return;
    try {
      const res = await API.del(`/time/${r.id}`);
      UI.toast(res.message);
      location.reload();
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  /** แก้ไขเวลาเข้างาน/ออกงาน หรือลบบันทึกเวลา */
  editTime(r) {
    const toTimeVal = (v) => (v ? String(v).slice(0, 5) : '');
    const body = UI.h('div', {},
      UI.h('p', { className: 'hint', style: { marginBottom: '12px' } },
        `แก้ไขเวลาลงเวลา ${UI.date(r.date)}${r.full_name ? ' • ' + UI.personName(r) : ''}`),
      UI.h('div', { className: 'form-row' },
        UI.h('div', { className: 'form-group', style: { flex: '1' } },
          UI.h('label', {}, 'เวลาเข้างาน'),
          UI.h('input', { id: 'tt-in', type: 'time', value: toTimeVal(r.clock_in) })),
        UI.h('div', { className: 'form-group', style: { flex: '1' } },
          UI.h('label', {}, 'เวลาออกงาน'),
          UI.h('input', { id: 'tt-out', type: 'time', value: toTimeVal(r.clock_out) })),
      ),
    );
    const foot = UI.h('div', {},
      UI.h('button', {
        className: 'btn btn-danger',
        onclick: async () => {
          const ok = await UI.confirm(`ต้องการลบบันทึกเวลา ${UI.date(r.date)}${r.full_name ? ' ของ ' + UI.personName(r) : ''} ใช่หรือไม่?`, { danger: true, okText: 'ลบ' });
          if (!ok) return;
          try {
            const res = await API.del(`/time/${r.id}`);
            UI.toast(res.message);
            m.close();
            render();
          } catch (e) { UI.toast(e.message, 'error'); }
        },
      }, '✕ ลบ'),
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '▽ บันทึก'));
    const m = UI.modal({ title: '✎ แก้ไขเวลาลงเวลา', body, footer: foot });

    async function save() {
      const clock_in = document.getElementById('tt-in').value || null;
      const clock_out = document.getElementById('tt-out').value || null;
      try {
        const res = await API.put(`/time/${r.id}`, { clock_in, clock_out });
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  /** รายงานการลงเวลาเข้างาน/ออกงาน — เลือก ปี พ.ศ. → เดือน → วัน (cascade), ดาวน์โหลด .xlsx, พิมพ์ */
  openReportModal() {
    const monthsThai = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const now = new Date();
    const curYearCE = now.getFullYear();

    // ---- ส่วนที่ 1: ปี พ.ศ. (ปีปัจจุบัน + ย้อนหลัง 5 ปี + ปีถัดไป 1 ปี) ----
    const yearSel = UI.h('select', { id: 'rp-year' });
    for (let y = curYearCE + 1; y >= curYearCE - 5; y--) {
      const opt = UI.h('option', { value: String(y) }, String(y + 543));
      if (y === curYearCE) opt.selected = true;
      yearSel.append(opt);
    }

    // ---- ส่วนที่ 2: เดือน (ทุกเดือน + ม.ค.-ธ.ค.) — ซ่อนจนเลือกปี ----
    const monthSel = UI.h('select', { id: 'rp-month' }, UI.h('option', { value: '' }, 'ทุกเดือน'));
    monthsThai.forEach((m, i) => monthSel.append(UI.h('option', { value: String(i + 1) }, m)));
    const monthGroup = UI.h('div', { className: 'form-group', style: { flex: '1', display: 'none' } },
      UI.h('label', {}, 'เลือกเดือน'), monthSel);

    // ---- ส่วนที่ 3: สัปดาห์ (ทุกสัปดาห์ + สัปดาห์ในเดือนที่เลือก) — ซ่อนจนเลือกเดือน ----
    const weekSel = UI.h('select', { id: 'rp-week' }, UI.h('option', { value: '' }, 'ทุกสัปดาห์'));
    const weekGroup = UI.h('div', { className: 'form-group', style: { flex: '1', display: 'none' } },
      UI.h('label', {}, 'เลือกสัปดาห์'), weekSel);

    // ---- ส่วนที่ 4: วัน (ทุกวัน + วันในเดือน/สัปดาห์ที่เลือก) — ซ่อนจนเลือกเดือน ----
    const daySel = UI.h('select', { id: 'rp-day' }, UI.h('option', { value: '' }, 'ทุกวัน'));
    const dayGroup = UI.h('div', { className: 'form-group', style: { flex: '1', display: 'none' } },
      UI.h('label', {}, 'เลือกวัน'), daySel);

    const body = UI.h('div', {},
      UI.h('div', { className: 'form-row', style: { alignItems: 'flex-end' } },
        UI.h('div', { className: 'form-group', style: { flex: '1' } },
          UI.h('label', {}, 'เลือกปี พ.ศ.'), yearSel),
        monthGroup,
        weekGroup,
        dayGroup,
        UI.h('button', { className: 'btn btn-primary', onclick: load }, '⊕ แสดงรายงาน'),
      ),
      UI.h('div', { id: 'rp-result', style: { marginTop: '14px' } }, UI.empty('เลือกปี พ.ศ. แล้วกด “แสดงรายงาน”', '📊')),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ปิด'),
      UI.h('button', { className: 'btn btn-info', id: 'rp-xlsx', onclick: downloadXlsx }, '⬇️ ดาวน์โหลด .xlsx'),
      UI.h('button', { className: 'btn btn-accent', onclick: () => window.print() }, '⬢ พิมพ์'));
    const m = UI.modal({ title: '📊 รายงานการลงเวลาทำงาน', body, footer: foot, size: 'lg' });

    const pad2 = (n) => String(n).padStart(2, '0');
    const thShort = (yy, mm, dd) => `${dd} ${monthsThai[mm - 1].slice(0, 3)}.`;

    /** คำนวณสัปดาห์ (จันทร์-อาทิตย์) ของเดือน/ปีที่เลือก → เติมตัวเลือก */
    function fillWeeks() {
      const y = Number(yearSel.value), mo = Number(monthSel.value);
      const lastDay = new Date(y, mo, 0).getDate();
      const dow1 = (new Date(y, mo - 1, 1).getDay() + 6) % 7; // จันทร์ = 0
      weekSel.innerHTML = '';
      weekSel.append(UI.h('option', { value: '' }, 'ทุกสัปดาห์'));
      let start = 1 - dow1, n = 1;
      while (start <= lastDay) {
        const end = start + 6;
        const sD = new Date(y, mo - 1, start), eD = new Date(y, mo - 1, end);
        const sOk = start >= 1, eOk = end <= lastDay;
        let label;
        if (sOk && eOk) label = `สัปดาห์ที่ ${n} (${sD.getDate()} - ${eD.getDate()} ${monthsThai[mo - 1].slice(0, 3)}.)`;
        else if (!sOk && eOk) label = `สัปดาห์ที่ ${n} (ถึง ${eD.getDate()} ${monthsThai[mo - 1].slice(0, 3)}.)`;
        else if (sOk && !eOk) label = `สัปดาห์ที่ ${n} (${sD.getDate()} ${monthsThai[mo - 1].slice(0, 3)}. ถึงสิ้นเดือน)`;
        else label = `สัปดาห์ที่ ${n}`;
        const opt = UI.h('option', { value: `${y}-${pad2(mo)}-${pad2(Math.max(start, 1))}` }, label);
        weekSel.append(opt);
        start += 7; n++;
      }
    }

    /** เติมตัวเลือกวัน — เลือกสัปดาห์อยู่ = วันในสัปดาห์นั้น, ไม่เลือก = ทุกวันในเดือน */
    function fillDays() {
      const y = Number(yearSel.value), mo = Number(monthSel.value);
      daySel.innerHTML = '';
      daySel.append(UI.h('option', { value: '' }, 'ทุกวัน'));
      if (weekSel.value) {
        const s = new Date(Number(weekSel.value.slice(0, 4)), Number(weekSel.value.slice(5, 7)) - 1, Number(weekSel.value.slice(8, 10)));
        const names = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
        for (let i = 0; i < 7; i++) {
          const d = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i);
          daySel.append(UI.h('option', { value: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` },
            `${names[i]} ${thShort(d.getFullYear(), d.getMonth() + 1, d.getDate())}`));
        }
      } else {
        const daysIn = new Date(y, mo, 0).getDate();
        for (let d = 1; d <= daysIn; d++) daySel.append(UI.h('option', { value: String(d) }, String(d)));
      }
    }

    // cascade: เลือกปี → โชว์เดือน | เลือกเดือน (ไม่ใช่ทุกเดือน) → โชว์สัปดาห์+วัน
    yearSel.onchange = () => {
      monthGroup.style.display = '';
      monthSel.value = '';
      weekGroup.style.display = 'none';
      weekSel.value = '';
      dayGroup.style.display = 'none';
      daySel.value = '';
    };
    monthSel.onchange = () => {
      if (monthSel.value) {
        fillWeeks();
        weekGroup.style.display = '';
        weekSel.value = '';
        fillDays();
        dayGroup.style.display = '';
        daySel.value = '';
      } else {
        weekGroup.style.display = 'none';
        weekSel.value = '';
        dayGroup.style.display = 'none';
        daySel.value = '';
      }
    };
    weekSel.onchange = () => {
      fillDays();
      daySel.value = '';
    };
    monthGroup.style.display = '';

    async function load() {
      const y = yearSel.value;
      const mo = monthSel.value;
      const wk = weekSel.value;
      const d = daySel.value;
      let period, date;
      if (mo && wk && d) { period = 'day'; date = d; }
      else if (mo && wk) { period = 'week'; date = wk; }
      else if (mo && d) { period = 'day'; date = `${y}-${pad2(mo)}-${pad2(d)}`; }
      else if (mo) { period = 'month'; date = `${y}-${pad2(mo)}`; }
      else { period = 'year'; date = y; }
      const box = document.getElementById('rp-result');
      box.innerHTML = '';
      box.append(UI.loading());
      try {
        const data = await API.get('/time/report?period=' + encodeURIComponent(period) + '&date=' + encodeURIComponent(date));
        box.innerHTML = '';
        const kind = period === 'day' ? 'รายวัน' : period === 'week' ? 'รายสัปดาห์' : period === 'month' ? 'รายเดือน' : 'รายปี';
        const title = UI.h('div', { className: 'card-title', style: { marginBottom: '10px' } },
          `รายงาน ${kind} — ${data.range.label}`);
        box.append(title);
        if (!data.records.length) {
          box.append(UI.empty('ไม่มีข้อมูลการลงเวลาในช่วงเวลานี้', '🗓️'));
          return;
        }
        box.append(UI.table([
          { key: 'date', label: 'วันที่', render: (r) => UI.date(r.date) },
          { key: 'full_name', label: 'ชื่อ-นามสกุล', render: (r) => UI.personName(r) },
          { key: 'position', label: 'ตำแหน่ง' },
          { key: 'workplace', label: 'กลุ่มงาน' },
          { key: 'clock_in', label: 'เวลาเข้า', render: (r) => UI.time(r.clock_in) },
          { key: 'clock_out', label: 'เวลาออก', render: (r) => UI.time(r.clock_out) },
        ], data.records));
      } catch (e) {
        box.innerHTML = '';
        box.append(UI.empty(e.message, '⚠️'));
      }
    }

    function downloadXlsx() {
      const y = yearSel.value;
      const mo = monthSel.value;
      const wk = weekSel.value;
      const d = daySel.value;
      let period, date;
      if (mo && wk && d) { period = 'day'; date = d; }
      else if (mo && wk) { period = 'week'; date = wk; }
      else if (mo && d) { period = 'day'; date = `${y}-${pad2(mo)}-${pad2(d)}`; }
      else if (mo) { period = 'month'; date = `${y}-${pad2(mo)}`; }
      else { period = 'year'; date = y; }
      window.open('/api/time/report.xlsx?period=' + encodeURIComponent(period) + '&date=' + encodeURIComponent(date), '_blank');
    }
  },

  /** ตรวจว่าอุปกรณ์ปัจจุบันเป็นมือถือ/แท็บเล็ต (ใช้ GPS) หรือคอมพิวเตอร์/แล็ปท็อป (ใช้ IP) */
  isMobileDevice() {
    const ua = navigator.userAgent;
    if (/Android|iPhone|iPad|iPod|Mobile|Tablet|Opera Mini|IEMobile|Silk/i.test(ua)) return true;
    return typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0 && window.matchMedia('(max-width: 1024px)').matches;
  },

  /** admin ตั้งค่าตำแหน่งที่ทำงาน: พิกัด GPS (มือถือ/แท็บเล็ต) + IP อินเทอร์เน็ต (คอมพิวเตอร์/แล็ปท็อป) */
  async openLocationSettingsModal() {
    let cfg = { enabled: true, lat: null, lng: null, radius: 200, ips: '' };
    try { cfg = await API.get('/time/location-settings'); } catch (e) { return UI.toast(e.message, 'error'); }

    const en = UI.h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', cursor: 'pointer', width: 'fit-content' } },
      UI.h('input', { id: 'cg-enabled', type: 'checkbox', checked: cfg.enabled !== false }),
      UI.h('span', { style: { whiteSpace: 'nowrap' } }, 'เปิดใช้การตรวจสอบตำแหน่งการลงเวลา (ถ้าปิด จะไม่ตรวจตำแหน่งใด ๆ)'));
    const latIn = UI.h('input', { id: 'cg-lat', type: 'number', step: 'any', value: cfg.lat ?? '', placeholder: 'เช่น 18.1442' });
    const lngIn = UI.h('input', { id: 'cg-lng', type: 'number', step: 'any', value: cfg.lng ?? '', placeholder: 'เช่น 100.1526' });
    const radIn = UI.h('input', { id: 'cg-radius', type: 'number', min: '1', value: cfg.radius ?? 200 });
    const ipsIn = UI.h('input', { id: 'cg-ips', type: 'text', value: cfg.ips || '', placeholder: 'เช่น 192.168.1.0, 10.0.0.' });
    const useMyPos = UI.h('button', {
      className: 'btn btn-outline btn-sm',
      onclick: () => {
        if (!navigator.geolocation) return UI.toast('เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง GPS', 'error');
        useMyPos.textContent = '📡 กำลังระบุตำแหน่ง...';
        navigator.geolocation.getCurrentPosition((pos) => {
          latIn.value = pos.coords.latitude;
          lngIn.value = pos.coords.longitude;
          useMyPos.textContent = '📡 ใช้ตำแหน่งปัจจุบันของฉัน';
          UI.toast('ดึงตำแหน่งปัจจุบันมาใส่แล้ว — กดบันทึกเพื่อใช้งาน');
        }, (e) => {
          useMyPos.textContent = '📡 ใช้ตำแหน่งปัจจุบันของฉัน';
          UI.toast(e && e.code === 1 ? 'คุณไม่อนุญาตให้ใช้ตำแหน่ง GPS' : 'ไม่สามารถระบุตำแหน่ง GPS ได้ — กรุณาใส่พิกัดเอง', 'error');
        }, { enableHighAccuracy: true, timeout: 10000 });
      },
    }, '📡 ใช้ตำแหน่งปัจจุบันของฉัน');

    const body = UI.h('div', {},
      UI.h('p', { className: 'hint', style: { marginBottom: '12px' } },
        'มือถือ/แท็บเล็ต ตรวจด้วย GPS ของอุปกรณ์ว่าอยู่ในรัศมีที่กำหนด ส่วนคอมพิวเตอร์/แล็ปท็อป ตรวจด้วย IP อินเทอร์เน็ตของที่ทำงาน — หากไม่อยู่ในพื้นที่/IP ที่กำหนดจะลงเวลาไม่ได้'),
      en,
      UI.h('div', { className: 'form-row', style: { alignItems: 'flex-end' } },
        UI.h('div', { className: 'form-group', style: { flex: '1' } }, UI.h('label', {}, 'ละติจูด (Latitude)'), latIn),
        UI.h('div', { className: 'form-group', style: { flex: '1' } }, UI.h('label', {}, 'ลองติจูด (Longitude)'), lngIn),
        UI.h('div', { className: 'form-group', style: { width: '130px' } }, UI.h('label', {}, 'รัศมี (เมตร)'), radIn),
        UI.h('div', { style: { paddingBottom: '2px' } }, useMyPos)),
      UI.h('div', { className: 'form-group', style: { marginTop: '12px' } },
        UI.h('label', {}, 'IP อินเทอร์เน็ตของที่ทำงาน (คอมพิวเตอร์/แล็ปท็อป) — คั่นด้วยเครื่องหมายจุลภาค , รองรับ prefix เช่น 192.168.1.'),
        ipsIn),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '▽ บันทึก'));
    const m = UI.modal({ title: '📍 ตั้งค่าตำแหน่งที่ทำงาน (การลงเวลา)', body, footer: foot, size: 'lg' });

    async function save() {
      const payload = {
        enabled: document.getElementById('cg-enabled').checked,
        lat: document.getElementById('cg-lat').value,
        lng: document.getElementById('cg-lng').value,
        radius: document.getElementById('cg-radius').value,
        ips: document.getElementById('cg-ips').value,
      };
      try {
        const res = await API.put('/time/location-settings', payload);
        UI.toast(res.message);
        m.close();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  /** admin เลือกเจ้าหน้าที่ที่ให้สิทธิ์เห็นปุ่มแก้ไขหมายเหตุ */
  async openEditorsModal() {
    let editorsData, staffData;
    try {
      [editorsData, staffData] = await Promise.all([API.get('/time/editors'), API.get('/staff?status=active')]);
    } catch (e) {
      return UI.toast(e.message, 'error');
    }
    const checked = new Set((editorsData.ids || []).map(Number));
    const listBox = UI.h('div', { style: { maxHeight: '320px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '10px', padding: '8px' } },
      (staffData.staff || []).map((u) => UI.h('label', { className: 'editor-opt', style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 8px', cursor: 'pointer', borderRadius: '8px' } },
        UI.h('input', { type: 'checkbox', value: u.id, checked: checked.has(u.id) }),
        UI.h('div', {},
          UI.h('div', {}, UI.personName(u)),
          UI.h('div', { className: 'hint' }, `${u.position || ''}${u.workplace ? ' • ' + u.workplace : ''}`)))),
    );
    const body = UI.h('div', {},
      UI.h('p', { className: 'hint', style: { marginBottom: '12px' } },
        'เลือกเจ้าหน้าที่ที่ต้องการให้สิทธิ์เห็นปุ่มแก้ไขเวลา/ลบบันทึกในหน้าลงเวลาทำงาน (ผู้ดูแลระบบมีสิทธิ์อยู่แล้ว)'),
      listBox,
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '▽ บันทึกสิทธิ์'));
    const m = UI.modal({ title: '+ เพิ่มเจ้าหน้าที่ (สิทธิ์แก้ไขเวลาลงเวลา)', body, footer: foot, size: 'lg' });

    async function save() {
      const ids = [...document.querySelectorAll('#modal-root .editor-opt input:checked')].map((el) => Number(el.value));
      try {
        const res = await API.put('/time/editors', { user_ids: ids });
        UI.toast(res.message);
        m.close();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },
};
