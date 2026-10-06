'use strict';
/* เมนู 5: จองห้องประชุม */

const RoomsView = {
  tab: 'bookings',
  rooms: [],
  myLevels: [], // ขั้นที่ผู้ใช้ปัจจุบันได้รับมอบหมายให้อนุมัติห้องประชุม
  yearFilter: '',

  async render(app) {
    // ขั้นอนุมัติห้องประชุมของผู้ใช้ปัจจุบัน (admin ได้ทุกขั้น)
    RoomsView.myLevels = Auth.isAdmin() ? [1, 2, 3] : [];
    try {
      const me = await API.get('/room/approvers/me');
      RoomsView.myLevels = (me.levels || []).map(Number);
    } catch (e) { /* ignore */ }

    const head = UI.h('div', { className: 'page-head' },
      UI.h('div', {},
        UI.h('div', { className: 'page-title' }, UI.h('span', { className: 'pi' }, '⌂'), 'จองห้องประชุม'),
        UI.h('div', { className: 'page-desc' }, 'จองห้องประชุมสำหรับการประชุมหรืออบรม รอผู้ดูแลระบบอนุมัติ')),
      Auth.isAdmin()
        ? UI.h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
          UI.h('button', { className: 'btn btn-primary', onclick: () => RoomsView.openRoomForm() }, '+ เพิ่มห้องประชุม'),
          UI.h('button', { className: 'btn btn-outline', onclick: () => RoomsView.openRoomApproversModal() }, '+ เพิ่มเจ้าหน้าที่'))
        : null,
    );
    app.append(head);

    const tabs = UI.h('div', { className: 'tabs' },
      UI.h('button', { className: 'tab', id: 'r-tab-bookings', onclick: () => { RoomsView.tab = 'bookings'; renderTabs(); } }, '◷ การจองห้องประชุม'),
      UI.h('button', { className: 'tab', id: 'r-tab-list', onclick: () => { RoomsView.tab = 'list'; renderTabs(); } }, '⌂ รายการห้องประชุม'),
    );
    app.append(tabs);
    const content = UI.h('div', { id: 'r-content' });
    app.append(content);

    try {
      const data = await API.get('/rooms');
      RoomsView.rooms = data.rooms || [];
    } catch (e) { /* ignore */ }

    function renderTabs() {
      document.getElementById('r-tab-bookings').classList.toggle('active', RoomsView.tab === 'bookings');
      document.getElementById('r-tab-list').classList.toggle('active', RoomsView.tab === 'list');
      content.innerHTML = '';
      if (RoomsView.tab === 'bookings') RoomsView.renderBookings(content);
      else RoomsView.renderRoomList(content);
    }
    renderTabs();
  },

  async renderRoomList(content) {
    content.append(UI.h('div', { className: 'card' },
      UI.h('div', { className: 'card-title' }, `⌂ รายการห้องประชุม (${RoomsView.rooms.length} ห้อง)`),
      RoomsView.rooms.length === 0
        ? UI.empty('ยังไม่มีข้อมูลห้องประชุม', '⌂')
        : UI.table([
          { key: 'name', label: 'ชื่อห้อง' },
          { key: 'capacity', label: 'รองรับ (คน)', className: 'num' },
          { key: 'location', label: 'สถานที่ตั้ง' },
          { key: 'equipment', label: 'อุปกรณ์' },
          { key: 'status', label: 'สถานะ', render: (v) => UI.badge(v.status) },
          Auth.isAdmin() ? {
            key: 'actions', label: 'จัดการ',
            render: (v) => UI.h('div', { className: 'status-btns' },
              UI.actionBtn('✎', () => RoomsView.openRoomForm(v)),
              UI.actionBtn('✕', () => RoomsView.removeRoom(v), 'danger-btn')),
          } : null,
        ].filter(Boolean), RoomsView.rooms)));
  },

  async openRoomForm(r) {
    const room = r || {};
    const body = UI.h('div', { className: 'form-grid' },
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ชื่อห้องประชุม', UI.h('span', { className: 'req' }, ' *')),
        UI.h('input', { id: 'rf-name', value: room.name || '', placeholder: 'เช่น ห้องประชุมใหญ่ ชั้น 2' })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'รองรับจำนวน (คน)'),
        UI.h('input', { id: 'rf-cap', type: 'number', min: '1', value: room.capacity || 10 })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'สถานที่ตั้ง'),
        UI.h('input', { id: 'rf-loc', value: room.location || '', placeholder: 'เช่น อาคารอำนวยการ ชั้น 2' })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'สถานะ'),
        UI.h('select', { id: 'rf-status' },
          UI.h('option', { value: 'available', selected: room.status !== 'maintenance' }, 'พร้อมใช้'),
          UI.h('option', { value: 'maintenance', selected: room.status === 'maintenance' }, 'ซ่อมบำรุง/ปิดใช้'))),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'อุปกรณ์ภายในห้อง'),
        UI.h('input', { id: 'rf-eq', value: room.equipment || '', placeholder: 'เช่น โปรเจกเตอร์, จอ, เครื่องเสียง' })),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'หมายเหตุ'),
        UI.h('input', { id: 'rf-notes', value: room.notes || '' })),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '▽ บันทึก'));
    const m = UI.modal({ title: room.id ? '✎ แก้ไขห้องประชุม' : '+ เพิ่มห้องประชุม', body, footer: foot });

    async function save() {
      const data = {
        name: document.getElementById('rf-name').value.trim(),
        capacity: parseInt(document.getElementById('rf-cap').value, 10) || 0,
        location: document.getElementById('rf-loc').value.trim(),
        equipment: document.getElementById('rf-eq').value.trim(),
        status: document.getElementById('rf-status').value,
        notes: document.getElementById('rf-notes').value.trim(),
      };
      if (!data.name) return UI.toast('กรุณากรอกชื่อห้องประชุม', 'error');
      try {
        const res = room.id
          ? await API.put('/rooms/' + room.id, data)
          : await API.post('/rooms', data);
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  async removeRoom(r) {
    const ok = await UI.confirm(`ต้องการลบห้องประชุม "${r.name}" ใช่หรือไม่?`, { danger: true, okText: 'ลบ' });
    if (!ok) return;
    try {
      const res = await API.del('/rooms/' + r.id);
      UI.toast(res.message);
      render();
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  /** ชื่อขั้นการอนุมัติห้องประชุม */
  LEVEL_NAMES: { 1: 'อนุมัติขั้นต้น', 2: 'อนุมัติขั้นสุดท้าย' },

  /** หน้าต่างตัวกรองดาวน์โหลด Excel (ปี พ.ศ. / เดือน / สัปดาห์) */
  openExportDialog() {
    const STATUS_TH = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิก' };
    ExportFilterDialog.open({
      years: [new Date().getFullYear() + 543, new Date().getFullYear() + 542],
      title: 'จองห้องประชุม',
      getRows: async (yBE, m, wkStart, wkEnd) => {
        const url = '/room-bookings' + (yBE ? '?year=' + yBE : '');
        const data = await API.get(url);
        const bookings = ExportFilterDialog.filterRows(data.bookings || [], 'date', yBE, m, wkStart, wkEnd);
        const headers = ['วันที่', 'ห้องประชุม', 'รองรับ (คน)', 'ผู้จอง', 'เวลา', 'หัวข้อการประชุม', 'ผู้เข้าร่วม', 'สถานะ'];
        const rows = bookings.map((r) => [
          r.date ? UI.date(r.date) : '',
          r.room_name || '',
          r.room_capacity || '',
          r.full_name || '',
          `${UI.time(r.start_time)} - ${UI.time(r.end_time)}`,
          r.topic || '',
          r.attendees || '',
          STATUS_TH[r.status] || r.status || '',
        ]);
        return { rows, headers, fileName: 'จองห้องประชุม' };
      },
    });
  },

  /** ผู้ใช้ปัจจุบันสามารถอนุมัติขั้นที่ level ของห้องประชุมได้หรือไม่ */
  canApproveLevel(level) {
    return RoomsView.myLevels.includes(level);
  },

  /** ผู้ใช้ปัจจุบันเป็นผู้อนุมัติห้องประชุม (admin หรือได้รับมอบหมาย) หรือไม่ */
  canDecideRoom() {
    return Auth.isAdmin() || RoomsView.myLevels.length > 0;
  },

  /** ปุ่มอนุมัติตามสิทธิ์ผู้อนุมัติห้องประชุม (ขั้นต้น อนุมัติตรง / ขั้นสุดท้าย ต้องยืนยันอีกครั้ง) */
  roomButtons(r) {
    const btns = [];
    const isPending = r.status === 'pending';
    const next = UI.approvalDone(r) + 1;
    const required = r.required_levels || 1;
    if (isPending && next <= required && RoomsView.canApproveLevel(next)) {
      if (next >= required) {
        btns.push(UI.actionBtn('● อนุมัติ', () => RoomsView.confirmFinalApprove(r)));
      } else {
        btns.push(UI.actionBtn('● อนุมัติขั้นต้น', () => RoomsView.decide(r, 'approve')));
      }
    }
    if (isPending && RoomsView.canDecideRoom()) {
      btns.push(UI.actionBtn('✕ ไม่อนุมัติ', () => RoomsView.decide(r, 'reject'), 'danger-btn'));
    }
    return btns;
  },

  /** ขั้นสุดท้าย: เปิดหน้าต่างรายละเอียด แล้วกดอนุมัติอีกครั้งเพื่อสิ้นสุด */
  confirmFinalApprove(r) {
    const body = UI.h('div', {},
      UI.h('div', { className: 'form-grid' },
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ห้องประชุม'), UI.h('div', {}, r.room_name)),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'วันที่'), UI.h('div', {}, UI.date(r.date))),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'เวลา'), UI.h('div', {}, `${UI.time(r.start_time)} - ${UI.time(r.end_time)}`)),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ผู้จอง'), UI.h('div', {}, UI.personName(r))),
        UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'หัวข้อการประชุม'), UI.h('div', {}, r.topic)),
        UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'ความคืบหน้าการอนุมัติ'), UI.approvalDetail(r, RoomsView.LEVEL_NAMES)),
      ),
      UI.h('p', { className: 'hint', style: { marginTop: '12px' } },
        'กรุณาตรวจสอบรายละเอียดให้ครบถ้วนก่อนกดยืนยัน — เมื่ออนุมัติแล้วจะถือเป็นการสิ้นสุดการอนุมัติ'),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', {
        className: 'btn btn-primary',
        onclick: async () => {
          m.close();
          await RoomsView.decideDirect(r, 'approve');
        },
      }, '● ยืนยันอนุมัติ'));
    const m = UI.modal({ title: '● อนุมัติการใช้ห้องประชุม', body, footer: foot, size: 'lg' });
  },

  /** admin เลือกเจ้าหน้าที่ + กำหนดสิทธิ์การอนุมัติห้องประชุม (ขั้นต้น / ผู้อนุมัติ) */
  async openRoomApproversModal() {
    let data;
    try {
      data = await API.get('/room/approvers');
    } catch (e) { return UI.toast(e.message, 'error'); }
    const cur = data.approvers || { 1: [], 2: [] };
    const set1 = new Set((cur[1] || []).map(Number));
    const set2 = new Set((cur[2] || []).map(Number));
    const tbody = UI.h('tbody', {},
      (data.staff || []).map((u) => UI.h('tr', {},
        UI.h('td', {}, UI.personName(u)),
        UI.h('td', {}, u.position || '-'),
        UI.h('td', { style: { textAlign: 'center' } }, UI.h('input', { type: 'checkbox', className: 'ra-l1', value: u.id, checked: set1.has(u.id) })),
        UI.h('td', { style: { textAlign: 'center' } }, UI.h('input', { type: 'checkbox', className: 'ra-l2', value: u.id, checked: set2.has(u.id) })),
      )));
    const body = UI.h('div', {},
      UI.h('p', { className: 'hint', style: { marginBottom: '12px' } },
        'เลือกเจ้าหน้าที่และกำหนดสิทธิ์การอนุมัติ — ผู้อนุมัติขั้นต้น (ขั้นที่ 1) และ ผู้อนุมัติ (ขั้นสุดท้าย) ใช้ร่วมกันทั้งการจองห้องประชุมและจองยานพาหนะ ผู้ดูแลระบบมีสิทธิ์ครบทุกขั้นอยู่แล้ว'),
      UI.h('div', { className: 'table-wrap', style: { maxHeight: '380px', overflowY: 'auto' } },
        UI.h('table', { className: 'tbl' },
          UI.h('thead', {}, UI.h('tr', {},
            UI.h('th', {}, 'ชื่อ-นามสกุล'),
            UI.h('th', {}, 'ตำแหน่ง'),
            UI.h('th', { style: { textAlign: 'center' } }, 'ผู้อนุมัติขั้นต้น'),
            UI.h('th', { style: { textAlign: 'center' } }, 'ผู้อนุมัติ'))),
          tbody)),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '▽ บันทึกสิทธิ์'));
    const m = UI.modal({ title: '+ เพิ่มเจ้าหน้าที่ (สิทธิ์อนุมัติการจองห้องประชุม/ยานพาหนะ)', body, footer: foot, size: 'lg' });

    async function save() {
      const level1 = [...document.querySelectorAll('.ra-l1:checked')].map((el) => Number(el.value));
      const level2 = [...document.querySelectorAll('.ra-l2:checked')].map((el) => Number(el.value));
      try {
        const res = await API.put('/room/approvers', { level1, level2 });
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  calView: false, // มุมมองปฏิทิน (true) หรือตาราง (false)
  calMonth: null, // เดือนที่แสดงในปฏิทิน (Date วันที่ 1 ของเดือน)

  async renderBookings(content) {
    const now = new Date(); const curYear = now.getFullYear() + 543;
    if (!RoomsView.yearFilter) RoomsView.yearFilter = String(curYear);
    const yearSel = UI.h('select', { id: 'rb-year', style: { width: 'fit-content' }, onchange: () => { RoomsView.yearFilter = document.getElementById('rb-year').value; content.innerHTML = ''; RoomsView.renderBookings(content); } },
      UI.h('option', { value: curYear, selected: RoomsView.yearFilter === String(curYear) }, curYear),
      UI.h('option', { value: curYear - 1, selected: RoomsView.yearFilter === String(curYear - 1) }, curYear - 1),
      UI.h('option', { value: '', selected: RoomsView.yearFilter === '' }, 'ทุกปี'));
    const toolbar = UI.h('div', { className: 'toolbar' },
      UI.h('button', { className: 'btn btn-primary', onclick: () => RoomsView.openBookingForm() }, '⌂ จองห้องประชุม'),
      yearSel,
      UI.h('button', { className: 'btn btn-outline', id: 'rb-view-toggle', onclick: toggleView }, RoomsView.calView ? '▭ มุมมองตาราง' : '🗓️ มุมมองปฏิทิน'),
      ExportFilterDialog.toolbarBtn(() => RoomsView.openExportDialog()));
    content.append(toolbar);

    const card = UI.h('div', { className: 'card' }, UI.loading());
    content.append(card);

    let data;
    try {
      const rbUrl = RoomsView.yearFilter ? '/room-bookings?year=' + RoomsView.yearFilter : '/room-bookings';
      data = await API.get(rbUrl);
    } catch (e) {
      card.innerHTML = '';
      card.append(UI.empty(e.message, '⚠️'));
      return;
    }
    if (!RoomsView.calMonth) RoomsView.calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    function renderView() {
      const btn = document.getElementById('rb-view-toggle');
      if (btn) btn.textContent = RoomsView.calView ? '▭ มุมมองตาราง' : '🗓️ มุมมองปฏิทิน';
      if (RoomsView.calView) RoomsView.renderCalendar(card, data.bookings);
      else RoomsView.renderBookingsTable(card, data.bookings);
    }
    function toggleView() {
      RoomsView.calView = !RoomsView.calView;
      renderView();
    }
    renderView();
  },

  /** มุมมองตาราง: แสดงการจองทุกรายการ (ทุก user เห็นหมด แต่ยกเลิกได้เฉพาะของตัวเอง) */
  renderBookingsTable(card, bookings) {
    card.innerHTML = '';
    card.append(UI.h('div', { className: 'card-title' }, '▭ รายการจองทั้งหมด'));
    if (!bookings.length) {
      card.append(UI.empty('ยังไม่มีรายการจอง', '⌂'));
      return;
    }
    const cols = [
      { key: 'date', label: 'วันที่', render: (r) => UI.date(r.date) },
      { key: 'room_name', label: 'ห้องประชุม', render: (r) => UI.h('div', {}, r.room_name, UI.h('div', { className: 'hint' }, `รองรับ ${r.room_capacity} คน`)) },
      { key: 'full_name', label: 'ผู้จอง', render: (r) => UI.h('div', {}, UI.personName(r), UI.h('div', { className: 'hint' }, r.username)) },
      { key: 'time', label: 'เวลา', render: (r) => `${UI.time(r.start_time)} - ${UI.time(r.end_time)}` },
      { key: 'topic', label: 'หัวข้อการประชุม' },
      { key: 'attendees', label: 'ผู้เข้าร่วม', className: 'num' },
    ];
    cols.push({
      key: 'status', label: 'สถานะ',
      render: (r) => UI.h('div', {},
        UI.badge(r.status),
        UI.h('div', { style: { cursor: 'pointer' }, title: 'ดูความคืบหน้าการอนุมัติ', onclick: () => UI.modal({ title: '▭ ความคืบหน้าการอนุมัติ', body: UI.approvalDetail(r, RoomsView.LEVEL_NAMES) }) }, UI.approvalPill(r))),
    });
    cols.push({
      key: 'actions', label: 'จัดการ',
      render: (r) => {
        const btns = [];
        btns.push(...RoomsView.roomButtons(r));
        // ยกเลิก/ลบได้เฉพาะรายการของตัวเอง (admin ยกเว้น)
        const isOwner = r.user_id === Auth.user.id;
        if (Auth.isAdmin()) btns.push(UI.actionBtn('✕', () => RoomsView.removeBooking(r), 'danger-btn'));
        else if (isOwner && r.status === 'pending') btns.push(UI.actionBtn('✕ ยกเลิก', () => RoomsView.removeBooking(r), 'danger-btn'));
        return UI.h('div', { className: 'status-btns' }, btns);
      },
    });
    card.append(UI.table(cols, bookings));
    for (const r of bookings) {
      if (r.note) card.append(UI.h('div', { className: 'hint', style: { marginTop: '10px' } }, `หมายเหตุรายการ ${r.id}: ${r.note}`));
    }
  },

  /** มุมมองปฏิทิน: ปฏิทินรายเดือนแสดงการจองของทุกคน */
  renderCalendar(card, bookings) {
    card.innerHTML = '';
    card.append(UI.h('div', { className: 'card-title' }, '🗓️ มุมมองปฏิทิน'));
    const m = RoomsView.calMonth;
    const year = m.getFullYear(), month = m.getMonth();
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7; // จันทร์ = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const byDay = {};
    for (const b of bookings) {
      if (b.date && String(b.date).slice(0, 7) === prefix) {
        const d = parseInt(String(b.date).slice(8, 10), 10);
        (byDay[d] = byDay[d] || []).push(b);
      }
    }
    const thaiMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const today = new Date();
    const header = UI.h('div', { className: 'cal-head' },
      UI.h('button', { className: 'btn btn-outline btn-sm', title: 'เดือนก่อนหน้า', onclick: () => { RoomsView.calMonth = new Date(year, month - 1, 1); RoomsView.renderCalendar(card, bookings); } }, '◀'),
      UI.h('div', { className: 'cal-title' }, `${thaiMonths[month]} ${year + 543}`),
      UI.h('button', { className: 'btn btn-outline btn-sm', title: 'เดือนถัดไป', onclick: () => { RoomsView.calMonth = new Date(year, month + 1, 1); RoomsView.renderCalendar(card, bookings); } }, '▶'),
      UI.h('button', { className: 'btn btn-outline btn-sm', onclick: () => { RoomsView.calMonth = new Date(today.getFullYear(), today.getMonth(), 1); RoomsView.renderCalendar(card, bookings); } }, 'เดือนนี้'));
    const grid = UI.h('div', { className: 'cal-grid' });
    ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'].forEach((w) => grid.append(UI.h('div', { className: 'cal-weekday' }, w)));
    const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - startOffset + 1;
      if (dayNum < 1 || dayNum > daysInMonth) {
        grid.append(UI.h('div', { className: 'cal-day cal-outside' }));
        continue;
      }
      const isToday = dayNum === today.getDate() && month === today.getMonth() && year === today.getFullYear();
      const cell = UI.h('div', { className: 'cal-day' + (isToday ? ' cal-today' : '') },
        UI.h('div', { className: 'cal-day-num' }, String(dayNum).padStart(2, '0')));
      (byDay[dayNum] || []).forEach((b) => cell.append(UI.h('div', {
        className: 'cal-chip ' + (b.status === 'approved' ? 'c-approved' : b.status === 'rejected' ? 'c-rejected' : 'c-pending'),
        title: `${b.topic} • ${b.start_time}-${b.end_time} • ${UI.personName(b)}`,
        onclick: () => RoomsView.bookingDetail(b),
      }, `${b.room_name} ${b.start_time}`)));
      grid.append(cell);
    }
    card.append(header);
    card.append(grid);
    card.append(UI.h('p', { className: 'hint', style: { marginTop: '10px' } }, '💡 กดการ์ดจองในปฏิทินเพื่อดูรายละเอียด'));
  },

  /** หน้าต่างรายละเอียดการจอง (ใช้ในมุมมองปฏิทิน) */
  bookingDetail(r) {
    const body = UI.h('div', { className: 'form-grid' },
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ห้องประชุม'), UI.h('div', {}, `${r.room_name} (รองรับ ${r.room_capacity} คน)`)),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'วันที่'), UI.h('div', {}, UI.date(r.date))),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'เวลา'), UI.h('div', {}, `${UI.time(r.start_time)} - ${UI.time(r.end_time)}`)),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ผู้จอง'), UI.h('div', {}, UI.personName(r))),
      UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'หัวข้อการประชุม'), UI.h('div', {}, r.topic)),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ผู้เข้าร่วม'), UI.h('div', {}, `${r.attendees || 0} คน`)),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'สถานะ'), UI.h('div', {}, UI.badge(r.status))),
      UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'ความคืบหน้าการอนุมัติ'), UI.approvalDetail(r, RoomsView.LEVEL_NAMES)),
    );
    UI.modal({ title: '▭ รายละเอียดการจอง', body, size: 'lg' });
  },

  openBookingForm() {
    const available = RoomsView.rooms.filter((r) => r.status === 'available');
    const body = UI.h('div', { className: 'form-grid' },
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'ห้องประชุม', UI.h('span', { className: 'req' }, ' *')),
        available.length === 0
          ? UI.h('div', { className: 'hint' }, '⚠️ ไม่มีห้องประชุมที่ว่างในขณะนี้')
          : UI.h('select', { id: 'rb-room', onchange: checkConflict },
            available.map((r) => UI.h('option', { value: r.id }, `${r.name} (รองรับ ${r.capacity} คน)`)))),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'วันที่ใช้', UI.h('span', { className: 'req' }, ' *')),
        UI.h('input', { id: 'rb-date', type: 'date', min: UI.today(), onchange: checkConflict })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'เวลาเริ่ม'),
        UI.h('input', { id: 'rb-start', type: 'time', onchange: checkConflict })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'เวลาสิ้นสุด'),
        UI.h('input', { id: 'rb-end', type: 'time', onchange: checkConflict })),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'หัวข้อการประชุม/กิจกรรม', UI.h('span', { className: 'req' }, ' *')),
        UI.h('input', { id: 'rb-topic', placeholder: 'เช่น ประชุมคณะกรรมการประเมินผล' })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'จำนวนผู้เข้าร่วม'),
        UI.h('input', { id: 'rb-att', type: 'number', min: '1', value: '10' })),
      UI.h('div', { id: 'rb-conflict', className: 'form-group full', style: { display: 'none' } }),
    );
    const saveBtn = UI.h('button', { className: 'btn btn-primary', onclick: save }, '📨 ส่งคำขอจอง');
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      saveBtn);
    const m = UI.modal({ title: '⌂ จองห้องประชุม', body, footer: foot });
    document.getElementById('rb-date').value = UI.today();

    // ตรวจสอบว่าช่วงเวลาที่เลือกมีคนจองไว้ก่อนแล้วหรือไม่
    async function checkConflict() {
      const room_id = document.getElementById('rb-room').value;
      const date = document.getElementById('rb-date').value;
      const start_time = document.getElementById('rb-start').value;
      const end_time = document.getElementById('rb-end').value;
      const box = document.getElementById('rb-conflict');
      if (!room_id || !date || !start_time || !end_time) {
        box.style.display = 'none';
        box.innerHTML = '';
        saveBtn.disabled = false;
        return;
      }
      try {
        const data = await API.get('/room-bookings/conflicts?room_id=' + encodeURIComponent(room_id) +
          '&date=' + encodeURIComponent(date) +
          '&start_time=' + encodeURIComponent(start_time) +
          '&end_time=' + encodeURIComponent(end_time));
        const conflicts = data.conflicts || [];
        if (conflicts.length) {
          box.style.display = '';
          box.innerHTML = '';
          box.append(UI.h('div', { style: { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: '10px', padding: '12px 14px' } },
            UI.h('div', { style: { fontWeight: 700, marginBottom: '6px' } }, '⚠️ ช่วงเวลานี้มีผู้จองไว้ก่อนแล้ว — ไม่สามารถจองได้'),
            conflicts.map((c) => UI.h('div', { style: { marginTop: '4px' } },
              `• ${UI.personName(c)} — ${c.topic} (${UI.time(c.start_time)} - ${UI.time(c.end_time)})`))));
          saveBtn.disabled = true;
        } else {
          box.style.display = 'none';
          box.innerHTML = '';
          saveBtn.disabled = false;
        }
      } catch (e) { /* ignore */ }
    }

    async function save() {
      if (saveBtn.disabled) return UI.toast('ช่วงเวลานี้ถูกจองไว้แล้ว ไม่สามารถจองซ้ำได้', 'error');
      const data = {
        room_id: document.getElementById('rb-room').value,
        date: document.getElementById('rb-date').value,
        start_time: document.getElementById('rb-start').value,
        end_time: document.getElementById('rb-end').value,
        topic: document.getElementById('rb-topic').value.trim(),
        attendees: parseInt(document.getElementById('rb-att').value, 10) || 0,
      };
      if (!data.room_id || !data.date) return UI.toast('กรุณาเลือกห้องประชุมและวันที่', 'error');
      if (!data.topic) return UI.toast('กรุณากรอกหัวข้อการประชุม', 'error');
      try {
        const res = await API.post('/room-bookings', data);
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  async decide(r, action) {
    const label = action === 'approve' ? 'อนุมัติ' : 'ไม่อนุมัติ';
    const ok = await UI.confirm(`ต้องการ${label}การจองห้อง "${r.room_name}" วันที่ ${UI.date(r.date)} ใช่หรือไม่?`, { okText: label, danger: action !== 'approve' });
    if (!ok) return;
    await RoomsView.decideDirect(r, action);
  },

  /** อนุมัติ/ไม่อนุมัติโดยไม่ถามยืนยันซ้ำ (ใช้หลังหน้าต่างรายละเอียดแล้ว) */
  async decideDirect(r, action) {
    try {
      const res = await API.put(`/room-bookings/${r.id}/${action}`, {});
      UI.toast(res.message);
      render();
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  async removeBooking(r) {
    const ok = await UI.confirm('ต้องการลบรายการจองนี้ใช่หรือไม่?', { danger: true, okText: 'ลบ' });
    if (!ok) return;
    try {
      const res = await API.del('/room-bookings/' + r.id);
      UI.toast(res.message);
      render();
    } catch (e) { UI.toast(e.message, 'error'); }
  },
};
