'use strict';
/* เมนู 4: จองยานพาหนะ */

const VehiclesView = {
  tab: 'bookings',
  vehicles: [],
  myLevels: [], // ขั้นที่ผู้ใช้ปัจจุบันได้รับมอบหมายให้อนุมัติยานพาหนะ
  myFilter: 'all', // ฟิลเตอร์รายการจอง: 'all' (ทั้งหมด) / 'mine' (ของฉัน)
  yearFilter: '',

  async render(app) {
    // ขั้นอนุมัติยานพาหนะของผู้ใช้ปัจจุบัน (admin ได้ทุกขั้น)
    VehiclesView.myLevels = Auth.isAdmin() ? [1, 2, 3] : [];
    try {
      const me = await API.get('/vehicle/approvers/me');
      VehiclesView.myLevels = (me.levels || []).map(Number);
    } catch (e) { /* ignore */ }

    const head = UI.h('div', { className: 'page-head' },
      UI.h('div', {},
        UI.h('div', { className: 'page-title' }, UI.h('span', { className: 'pi' }, '🚐'), 'จองยานพาหนะ'),
        UI.h('div', { className: 'page-desc' }, 'ขอใช้ยานพาหนะของทางราชการ รอผู้ดูแลระบบอนุมัติ')),
      Auth.isAdmin()
        ? UI.h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
          UI.h('button', { className: 'btn btn-primary', onclick: () => VehiclesView.openVehicleForm() }, '+ เพิ่มยานพาหนะ'),
          UI.h('button', { className: 'btn btn-outline', onclick: () => VehiclesView.openVehicleApproversModal() }, '+ เพิ่มเจ้าหน้าที่'))
        : null,
    );
    app.append(head);

    const tabs = UI.h('div', { className: 'tabs' },
      UI.h('button', { className: 'tab', id: 'v-tab-bookings', onclick: () => { VehiclesView.tab = 'bookings'; renderTabs(); } }, '◷ การจองยานพาหนะ'),
      UI.h('button', { className: 'tab', id: 'v-tab-list', onclick: () => { VehiclesView.tab = 'list'; renderTabs(); } }, '🚐 รายการยานพาหนะ'),
    );
    app.append(tabs);
    const content = UI.h('div', { id: 'v-content' });
    app.append(content);

    try {
      const data = await API.get('/vehicles');
      VehiclesView.vehicles = data.vehicles || [];
    } catch (e) { /* ignore */ }

    function renderTabs() {
      document.getElementById('v-tab-bookings').classList.toggle('active', VehiclesView.tab === 'bookings');
      document.getElementById('v-tab-list').classList.toggle('active', VehiclesView.tab === 'list');
      content.innerHTML = '';
      if (VehiclesView.tab === 'bookings') VehiclesView.renderBookings(content);
      else VehiclesView.renderVehicleList(content);
    }
    renderTabs();
  },

  async renderVehicleList(content) {
    content.append(UI.h('div', { className: 'card' },
      UI.h('div', { className: 'card-title' }, `🚐 รายการยานพาหนะ (${VehiclesView.vehicles.length} คัน)`),
      VehiclesView.vehicles.length === 0
        ? UI.empty('ยังไม่มีข้อมูลยานพาหนะ', '🚐')
        : UI.table([
          { key: 'photo', label: 'รูป', className: 'vehicle-thumb-cell', render: (v) => v.photo
            ? UI.h('img', { className: 'vehicle-thumb', src: '/uploads/' + UI.encodePath(v.photo), alt: v.name })
            : UI.h('span', { className: 'vehicle-thumb ph' }, '🚐') },
          { key: 'name', label: 'ชื่อยานพาหนะ' },
          { key: 'plate', label: 'ทะเบียน' },
          { key: 'type', label: 'ประเภท' },
          { key: 'capacity', label: 'ที่นั่ง', className: 'num' },
          { key: 'status', label: 'สถานะ', render: (v) => UI.badge(v.status) },
          Auth.isAdmin() ? {
            key: 'actions', label: 'จัดการ',
            render: (v) => UI.h('div', { className: 'status-btns' },
              UI.actionBtn('✎', () => VehiclesView.openVehicleForm(v)),
              UI.actionBtn('✕', () => VehiclesView.removeVehicle(v), 'danger-btn')),
          } : null,
        ].filter(Boolean), VehiclesView.vehicles)));
  },

  /** หน้าต่างตัวกรองดาวน์โหลด Excel (ปี พ.ศ. / เดือน / สัปดาห์) */
  openExportDialog() {
    const STATUS_TH = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิก' };
    ExportFilterDialog.open({
      years: [new Date().getFullYear() + 543, new Date().getFullYear() + 542],
      title: 'จองยานพาหนะ',
      getRows: async (yBE, m, wkStart, wkEnd) => {
        const url = '/vehicle-bookings' + (yBE ? '?year=' + yBE : '');
        const data = await API.get(url);
        let bookings = data.bookings || [];
        bookings = ExportFilterDialog.filterRows(bookings, 'date', yBE, m, wkStart, wkEnd);
        const headers = ['วันที่', 'ถึงวันที่', 'ผู้จอง', 'ยานพาหนะ', 'ทะเบียน', 'เวลา', 'รวม (วัน)', 'พนักงานขับรถ', 'ผู้โดยสาร', 'วัตถุประสงค์', 'สถานที่ไปราชการ', 'สถานะ'];
        const rows = bookings.map((r) => [
          r.date ? UI.date(r.date) : '',
          r.date_to ? UI.date(r.date_to) : '',
          r.full_name || '',
          r.vehicle_name || 'มอบเจ้าหน้าที่จัดให้',
          r.plate || '',
          `${UI.time(r.start_time)} - ${UI.time(r.end_time)}`,
          r.total_days || 1,
          r.driver_name || (r.self_drive ? 'ผู้ขอขับเอง' : ''),
          r.passenger_count || '',
          r.purpose || '',
          r.destination || '',
          STATUS_TH[r.status] || r.status || '',
        ]);
        return { rows, headers, fileName: 'จองยานพาหนะ' };
      },
    });
  },

  async openVehicleForm(v) {
    const vehicle = v || {};
    const body = UI.h('div', { className: 'form-grid' },
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ชื่อยานพาหนะ', UI.h('span', { className: 'req' }, ' *')),
        UI.h('input', { id: 'vf-name', value: vehicle.name || '', placeholder: 'เช่น รถตู้โดยสาร 12 ที่นั่ง' })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ทะเบียน'),
        UI.h('input', { id: 'vf-plate', value: vehicle.plate || '', placeholder: 'เช่น กฉ 1234 แพร่' })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ประเภท'),
        UI.h('input', { id: 'vf-type', value: vehicle.type || '', placeholder: 'เช่น รถตู้ / รถยนต์ / รถกระบะ' })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'จำนวนที่นั่ง'),
        UI.h('input', { id: 'vf-cap', type: 'number', min: '1', value: vehicle.capacity || 1 })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'สถานะ'),
        UI.h('select', { id: 'vf-status' },
          UI.h('option', { value: 'available', selected: vehicle.status !== 'maintenance' }, 'พร้อมใช้'),
          UI.h('option', { value: 'maintenance', selected: vehicle.status === 'maintenance' }, 'ซ่อมบำรุง'))),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'รูปภาพยานพาหนะ'),
        UI.h('div', { className: 'file-preview' },
          vehicle.photo ? UI.h('img', { className: 'preview-thumb', src: '/uploads/' + UI.encodePath(vehicle.photo), alt: 'รูปปัจจุบัน' }) : null),
        UI.h('input', { id: 'vf-photo', type: 'file', accept: 'image/*' }),
        UI.h('div', { className: 'hint' }, vehicle.photo ? 'รูปปัจจุบันแสดงด้านบน — เลือกไฟล์เพื่อแทนที่ หรือกดปุ่มลบรูปด้านล่าง' : 'ไฟล์ภาพ (jpg, png, gif, webp)'),
        vehicle.photo ? UI.h('button', { className: 'btn btn-outline btn-sm', id: 'vf-photo-clear', onclick: () => { removePhoto = true; const box = document.querySelector('#vf-photo-wrap .file-preview'); box.innerHTML = ''; document.getElementById('vf-photo').value = ''; document.getElementById('vf-photo-clear').remove(); } }, '✕ ลบรูปภาพ') : null,
      ),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'หมายเหตุ'),
        UI.h('input', { id: 'vf-notes', value: vehicle.notes || '' })),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '▽ บันทึก'));
    const m = UI.modal({ title: vehicle.id ? '✎ แก้ไขยานพาหนะ' : '+ เพิ่มยานพาหนะ', body, footer: foot });
    let removePhoto = false;

    // preview รูปใหม่ที่เลือก
    const photoWrap = document.getElementById('vf-photo').parentElement;
    photoWrap.id = 'vf-photo-wrap';
    document.getElementById('vf-photo').addEventListener('change', (e) => {
      const box = photoWrap.querySelector('.file-preview');
      box.innerHTML = '';
      if (e.target.files[0]) {
        removePhoto = false;
        box.append(UI.h('img', { className: 'preview-thumb', src: URL.createObjectURL(e.target.files[0]), alt: 'preview' }));
        const clearBtn = document.getElementById('vf-photo-clear');
        if (clearBtn) clearBtn.remove();
      } else if (vehicle.photo && !removePhoto) {
        box.append(UI.h('img', { className: 'preview-thumb', src: '/uploads/' + UI.encodePath(vehicle.photo), alt: 'รูปปัจจุบัน' }));
      }
    });

    async function save() {
      const fd = new FormData();
      const name = document.getElementById('vf-name').value.trim();
      if (!name) return UI.toast('กรุณากรอกชื่อยานพาหนะ', 'error');
      fd.append('name', name);
      fd.append('plate', document.getElementById('vf-plate').value.trim());
      fd.append('type', document.getElementById('vf-type').value.trim());
      fd.append('capacity', parseInt(document.getElementById('vf-cap').value, 10) || 0);
      fd.append('status', document.getElementById('vf-status').value);
      fd.append('notes', document.getElementById('vf-notes').value.trim());
      const photoFile = document.getElementById('vf-photo').files[0];
      if (photoFile) fd.append('photo', photoFile);
      else if (removePhoto) fd.append('photo', '');
      try {
        const res = vehicle.id
          ? await API.putForm('/vehicles/' + vehicle.id, fd)
          : await API.postForm('/vehicles', fd);
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  async removeVehicle(v) {
    const ok = await UI.confirm(`ต้องการลบยานพาหนะ "${v.name}" ใช่หรือไม่?`, { danger: true, okText: 'ลบ' });
    if (!ok) return;
    try {
      const res = await API.del('/vehicles/' + v.id);
      UI.toast(res.message);
      render();
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  /** ชื่อขั้นการอนุมัติยานพาหนะ */
  LEVEL_NAMES: { 1: 'อนุมัติขั้นต้น', 2: 'อนุมัติขั้นสุดท้าย' },

  /** ผู้ใช้ปัจจุบันสามารถอนุมัติขั้นที่ level ของยานพาหนะได้หรือไม่ */
  canApproveLevel(level) {
    return VehiclesView.myLevels.includes(level);
  },

  /** ผู้ใช้ปัจจุบันเป็นผู้อนุมัติยานพาหนะ (admin หรือได้รับมอบหมาย) หรือไม่ */
  canDecideVehicle() {
    return Auth.isAdmin() || VehiclesView.myLevels.length > 0;
  },

  /** ปุ่มอนุมัติตามสิทธิ์ผู้อนุมัติยานพาหนะ (ขั้นต้น อนุมัติตรง / ขั้นสุดท้าย ต้องยืนยันอีกครั้ง) */
  vehicleButtons(r) {
    const btns = [];
    const isPending = r.status === 'pending';
    const next = UI.approvalDone(r) + 1;
    const required = r.required_levels || 1;
    if (isPending && next <= required && VehiclesView.canApproveLevel(next)) {
      if (next >= required) {
        btns.push(UI.actionBtn('● อนุมัติ', () => VehiclesView.confirmFinalApprove(r)));
      } else {
        btns.push(UI.actionBtn('● อนุมัติขั้นต้น', () => VehiclesView.approveLevel1(r)));
      }
    }
    if (isPending && VehiclesView.canDecideVehicle()) {
      btns.push(UI.actionBtn('✕ ไม่อนุมัติ', () => VehiclesView.decide(r, 'reject'), 'danger-btn'));
    }
    return btns;
  },

  /** อนุมัติขั้นต้น: เปิดหน้าต่างรายละเอียดทั้งหมด + เลือกพนักงานขับรถ แล้วกดยืนยันเพื่อส่งต่อ */
  async approveLevel1(r) {
    let users = [];
    try {
      const res = await API.get('/users/active');
      users = res.users || [];
    } catch (e) { /* ignore */ }
    const full = (u) => UI.personName(u);
    // กรณีผู้ขอเลือก "มอบเจ้าหน้าที่จัดให้" → ผู้อนุมัติขั้นต้นสามารถเลือกยานพาหนะให้ผู้ขอได้
    const needAssignVehicle = !r.vehicle_id;
    const assignableVehicles = VehiclesView.vehicles.filter((v) => v.status === 'available');
    const vehicleField = needAssignVehicle
      ? UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ยานพาหนะ (จัดให้ผู้ขอ)'),
        UI.h('select', { id: 'vb-vehicle-assign', className: 'vb-assign-select' },
          UI.h('option', { value: '' }, '🤝 มอบเจ้าหน้าที่จัดให้'),
          assignableVehicles.map((v) => UI.h('option', { value: v.id }, `${v.name}${v.plate ? ` (${v.plate})` : ''}`))),
        UI.h('div', { id: 'vb-assign-conflict', style: { display: 'none' } }),
        UI.h('div', { className: 'hint' }, 'ผู้ขอเลือกมอบเจ้าหน้าที่จัดให้ — กรุณาเลือกยานพาหนะที่จัดให้ผู้ขอ (เลือกแล้วระบบจะเช็ควัน/เวลาที่ขอว่าซ้อนกับรายการอื่นหรือไม่)'))
      : UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ยานพาหนะ'), UI.h('div', {}, r.vehicle_name ? `${r.vehicle_name} (${r.plate || '-'})` : '🤝 มอบเจ้าหน้าที่จัดให้'));
    const body = UI.h('div', {},
      UI.h('div', { className: 'form-grid' },
        vehicleField,
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ตั้งแต่วันที่'), UI.h('div', {}, UI.date(r.date))),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ตั้งแต่เวลา'), UI.h('div', {}, UI.time(r.start_time) || '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ถึงวันที่'), UI.h('div', {}, r.date_to ? UI.date(r.date_to) : '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ถึงเวลา'), UI.h('div', {}, UI.time(r.end_time) || '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'รวม (วัน)'), UI.h('div', {}, `${r.total_days || 1} วัน`)),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ผู้ควบคุมรถ'), UI.h('div', {}, r.controller || '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ผู้โดยสาร'), UI.h('div', {}, `${r.passenger_count || 0} คน`)),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'สถานที่ไปราชการ'), UI.h('div', {}, r.destination || '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ผู้จอง'), UI.h('div', {}, UI.personName(r))),
        UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'วัตถุประสงค์'), UI.h('div', {}, r.purpose)),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'เชื้อเพลิง'), UI.h('div', {}, r.fuel_choice || '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ขับรถเอง'), UI.h('div', {}, r.self_drive ? '● ขออนุญาตเป็นผู้ขับรถ' : '-')),
        UI.h('div', { className: 'form-group full' },
          UI.h('label', {}, 'เลือกพนักงานขับรถ'),
          UI.h('select', { id: 'vb-driver', className: 'vb-driver-select' },
            UI.h('option', { value: '' }, '— เลือกพนักงานขับรถ —'),
            users.map((u) => UI.h('option', { value: full(u), selected: r.driver_name === full(u) }, full(u)))),
          UI.h('div', { className: 'hint' }, 'เลือกรายชื่อบุคลากรที่จะเป็นพนักงานขับรถสำหรับคำขอนี้ (ปล่อยว่าง = เจ้าหน้าที่จัดให้)')),
        UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'ความคืบหน้าการอนุมัติ'), UI.approvalDetail(r, VehiclesView.LEVEL_NAMES)),
      ),
      UI.h('p', { className: 'hint', style: { marginTop: '12px' } },
        'ตรวจสอบรายละเอียดให้ครบถ้วน แล้วกดอนุมัติขั้นต้นเพื่อส่งเรื่องต่อไปยังผู้อนุมัติขั้นถัดไป'),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: async () => {
        // กันจองซ้ำ: ถ้าเลือกยานพาหนะจัดให้แล้วซ้อนกับรายการอื่น → บล็อกไม่ให้อนุมัติ
        if (assignSel && assignSel.value) {
          const q = new URLSearchParams({
            date: r.date, date_to: r.date_to || '',
            start_time: r.start_time || '', end_time: r.end_time || '',
          });
          try {
            const res = await API.get('/vehicle-bookings/conflicts?vehicle_id=' + assignSel.value + '&' + q.toString());
            const hit = (res.conflicts || [])[0];
            if (hit) {
              return UI.toast(`ไม่สามารถจัดยานพาหนะคันนี้ได้ — ถูกจองไว้แล้วในช่วงเวลาที่ขอ (${hit.full_name} • ${hit.purpose})`, 'error');
            }
          } catch (e) { /* ข้ามถ้าเช็คไม่สำเร็จ — backend กันซ้ำอีกชั้น */ }
        }
        const driver = (document.getElementById('vb-driver').value || '').trim();
        const payload = { driver_name: driver };
        if (assignSel && assignSel.value) payload.vehicle_id = Number(assignSel.value);
        m.close();
        try {
          const res = await API.put(`/vehicle-bookings/${r.id}/approve`, payload);
          UI.toast(res.message);
          render();
        } catch (e) { UI.toast(e.message, 'error'); }
      } }, '● อนุมัติขั้นต้น'));
    const m = UI.modal({ title: '● อนุมัติขั้นต้น — การใช้ยานพาหนะ', body, footer: foot, size: 'lg' });

    // ---- กันการจองซ้ำ: เมื่อเลือกยานพาหนะจัดให้ผู้ขอ ให้เช็ควัน/เวลาที่ขอซ้อนกับรายการอื่นหรือไม่ ----
    const assignSel = needAssignVehicle ? document.getElementById('vb-vehicle-assign') : null;
    const conflictBox = needAssignVehicle ? document.getElementById('vb-assign-conflict') : null;
    async function checkAssign() {
      if (!assignSel) return;
      conflictBox.style.display = 'none';
      conflictBox.innerHTML = '';
      const vid = assignSel.value;
      if (!vid) return;
      const q = new URLSearchParams({
        date: r.date, date_to: r.date_to || '',
        start_time: r.start_time || '', end_time: r.end_time || '',
      });
      try {
        const res = await API.get('/vehicle-bookings/conflicts?vehicle_id=' + vid + '&' + q.toString());
        const hit = (res.conflicts || [])[0];
        if (hit) {
          conflictBox.innerHTML = '';
          conflictBox.append(UI.h('div', { style: { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: '10px', padding: '10px 12px', marginTop: '8px' } },
            UI.h('div', { style: { fontWeight: 700, marginBottom: '4px' } }, '⚠️ ยานพาหนะคันนี้ถูกจองไว้ก่อนแล้วในช่วงเวลาที่ขอ — ไม่สามารถจัดให้ได้'),
            UI.h('div', {}, `ผู้จอง: ${hit.full_name} • ${hit.purpose}`)));
          conflictBox.style.display = 'block';
        }
      } catch (e) { /* ข้ามถ้าเช็คไม่สำเร็จ */ }
    }    if (assignSel) assignSel.addEventListener('change', checkAssign);
  },

  /** ขั้นสุดท้าย: เปิดหน้าต่างรายละเอียด แล้วกดอนุมัติอีกครั้งเพื่อสิ้นสุด */
  confirmFinalApprove(r) {
    const body = UI.h('div', {},
      UI.h('div', { className: 'form-grid' },
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ยานพาหนะ'), UI.h('div', {}, r.vehicle_name ? `${r.vehicle_name} (${r.plate || '-'})` : '🤝 มอบเจ้าหน้าที่จัดให้')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ตั้งแต่วันที่'), UI.h('div', {}, UI.date(r.date))),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ตั้งแต่เวลา'), UI.h('div', {}, UI.time(r.start_time) || '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ถึงวันที่'), UI.h('div', {}, r.date_to ? UI.date(r.date_to) : '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ถึงเวลา'), UI.h('div', {}, UI.time(r.end_time) || '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'รวม (วัน)'), UI.h('div', {}, `${r.total_days || 1} วัน`)),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ผู้ควบคุมรถ'), UI.h('div', {}, r.controller || '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'พนักงานขับรถ'), UI.h('div', {}, r.driver_name || (r.self_drive ? 'ผู้ขอขับเอง' : 'เจ้าหน้าที่จัดให้'))),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ผู้โดยสาร'), UI.h('div', {}, `${r.passenger_count || 0} คน`)),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'สถานที่ไปราชการ'), UI.h('div', {}, r.destination || '-')),        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ผู้จอง'), UI.h('div', {}, UI.personName(r))),
        UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'วัตถุประสงค์'), UI.h('div', {}, r.purpose)),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'เชื้อเพลิง'), UI.h('div', {}, r.fuel_choice || '-')),
        ...(r.fuel_project ? [UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'โครงการ'), UI.h('div', {}, r.fuel_project))] : []),
        ...(r.fuel_activity ? [UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'กิจกรรม'), UI.h('div', {}, r.fuel_activity))] : []),
        ...(Number(r.fuel_amount) ? [UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'จำนวนเงิน'), UI.h('div', {}, `${Number(r.fuel_amount).toFixed(2)} บาท`))] : []),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ขับรถเอง'), UI.h('div', {}, r.self_drive ? '● ขออนุญาตเป็นผู้ขับรถ' : '-')),
        UI.h('div', { className: 'form-group full' },
          UI.h('label', {}, 'ความคืบหน้าการอนุมัติ'), UI.approvalDetail(r, VehiclesView.LEVEL_NAMES)),
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
          await VehiclesView.decideDirect(r, 'approve');
        },
      }, '● ยืนยันอนุมัติ'));
    const m = UI.modal({ title: '● อนุมัติการใช้ยานพาหนะ', body, footer: foot, size: 'lg' });
  },

  /** แบบฟอร์มทางการ: บันทึกการขอใช้ยานพาหนะ (กดจากคอลัมน์รายละเอียด) */
  async showVehicleDocument(r) {
    let d;
    try {
      d = await API.get(`/vehicle-bookings/${r.id}/document`);
    } catch (e) { return UI.toast(e.message, 'error'); }
    const row = d.row;
    const fuelText = row.fuel_choice || '-';
    const L = (label, content) => UI.h('div', { className: 'doc-row' }, UI.h('span', { className: 'doc-label' }, label), UI.h('span', {}, content));
    const sigImg = (f) => f && f.signature
      ? UI.h('img', { className: 'doc-sig', src: '/uploads/' + UI.encodePath(f.signature), alt: 'ลายเซ็น' })
      : UI.h('div', { className: 'doc-sig-empty' }, '(ยังไม่มีลายเซ็น)');
    const sigBlock = (label, f, pre) => UI.h('div', { className: 'doc-sig-block' },
      UI.h('div', { className: 'doc-sig-label' }, label),
      pre ? UI.h('div', { className: 'doc-rec' },
        UI.h('span', { className: 'doc-rec-check', html: '<svg width="14" height="14" viewBox="0 0 14 14" style="display:block"><rect x="1" y="1" width="12" height="12" fill="white" stroke="#111" stroke-width="1.4"/><path d="M3.5 7 L6 9.5 L10.5 4.5" stroke="#111" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
        UI.h('span', {}, pre)) : null,
      sigImg(f),
      UI.h('div', { className: 'doc-sig-name' }, f && (f.full_name || f.first_name) ? UI.personName(f) : '-'),
      UI.h('div', { className: 'doc-sig-pos' }, (f && f.position) || '-'));

    const body = UI.h('div', { className: 'doc' },
      UI.h('div', { className: 'doc-title' }, 'บันทึกการขอใช้ยานพาหนะ'),
      UI.h('div', { className: 'doc-row' }, UI.h('span', { className: 'doc-label' }, 'วันที่'), UI.h('span', {}, UI.thaiFullDate(row.created_at))),
      UI.h('div', { className: 'doc-row' }, UI.h('span', { className: 'doc-label' }, 'เรื่อง'), UI.h('span', {}, 'ขออนุญาตใช้รถราชการ')),
      UI.h('div', { className: 'doc-row' }, UI.h('span', { className: 'doc-label' }, 'เรียน'), UI.h('span', {}, 'ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2')),
      L('ข้าพเจ้า', `${UI.personName({ title: row.req_title, full_name: row.req_name, first_name: row.req_first_name, last_name: row.req_last_name })}  ตำแหน่ง ${row.req_position || '-'}`),
      UI.h('div', { className: 'doc-line' }, `ขออนุญาตใช้รถราชการ ${r.vehicle_name ? `${r.vehicle_name}${r.plate ? ` (ทะเบียน ${r.plate})` : ''}` : 'โดยมอบเจ้าหน้าที่จัดให้'}`),
      L('สถานที่ไปราชการ', row.destination || '-'),
      L('วัตถุประสงค์', row.purpose || '-'),
      L('ตั้งแต่วันที่', UI.thaiFullDate(row.date)),
      L('ถึงวันที่', row.date_to ? UI.thaiFullDate(row.date_to) : UI.thaiFullDate(row.date)),
      UI.h('div', { className: 'doc-line' }, `รวม ${row.total_days || 1} วัน`),
      UI.h('div', { className: 'doc-line' }, `มีผู้โดยสารทั้งหมด ${row.passenger_count || 0} คน`),
      UI.h('div', { className: 'doc-line' }, `ผู้ควบคุมรถคือ ${row.controller || '-'}`),
      UI.h('div', { className: 'doc-line' }, `เชื้อเพลิง ${fuelText}`),
      ...(row.fuel_project ? [UI.h('div', { className: 'doc-line doc-sub' }, `โครงการ ${row.fuel_project}`)] : []),
      ...(row.fuel_activity ? [UI.h('div', { className: 'doc-line doc-sub' }, `กิจกรรม ${row.fuel_activity}`)] : []),
      ...(Number(row.fuel_amount) ? [UI.h('div', { className: 'doc-line doc-sub' }, `จำนวนเงิน ${Number(row.fuel_amount).toFixed(2)} บาท`)] : []),
      UI.h('p', { className: 'doc-close' }, 'จึงเรียนมาเพื่อโปรดพิจารณาอนุญาต'),
      UI.h('div', { className: 'doc-sigs' },
        sigBlock('ส่วนของผู้ขออนุญาตใช้ยานพาหนะ', { title: row.req_title, full_name: row.req_name, first_name: row.req_first_name, last_name: row.req_last_name, position: row.req_position, signature: row.req_signature }),
        sigBlock('ส่วนของเจ้าหน้าที่', d.staff || null, d.driver ? `เห็นควรให้ ${UI.personName(d.driver)} เป็นพนักงานขับรถในราชการนี้` : null),
        sigBlock('ส่วนของผู้อนุมัติ', d.finalApprover || null, d.finalApprover ? 'อนุมัติ' : null)),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ปิด'),
      UI.h('button', { className: 'btn btn-primary', onclick: () => VehiclesView.printDocument(body) }, '⬢ พิมพ์'));
    const m = UI.modal({ title: '▭ บันทึกการขอใช้ยานพาหนะ', body, footer: foot, size: 'lg' });
  },

  /** พิมพ์เอกสารบันทึกการขอใช้ยานพาหนะ (เปิดหน้าต่างใหม่) */
  printDocument(body) {
    const css = document.querySelector('link[href*="style.css"]');
    const styleTag = css ? `<link rel="stylesheet" href="${css.href}">` : '';
    const w = window.open('', '_blank', 'width=900,height=1200');
    if (!w) return UI.toast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต pop-up', 'error');
    w.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>บันทึกการขอใช้ยานพาหนะ</title>${styleTag}<style>body{background:#f0f2f5;padding:32px;margin:0}@media print{body{background:#fff;padding:0}}</style></head><body>${body.outerHTML}</body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 400);
  },

  /** admin เลือกเจ้าหน้าที่ + กำหนดสิทธิ์การอนุมัติยานพาหนะ (ขั้นต้น / ผู้อนุมัติ) */
  async openVehicleApproversModal() {
    let data;
    try {
      data = await API.get('/vehicle/approvers');
    } catch (e) { return UI.toast(e.message, 'error'); }
    const cur = data.approvers || { 1: [], 2: [] };
    const set1 = new Set((cur[1] || []).map(Number));
    const set2 = new Set((cur[2] || []).map(Number));
    const tbody = UI.h('tbody', {},
      (data.staff || []).map((u) => UI.h('tr', {},
        UI.h('td', {}, UI.personName(u)),
        UI.h('td', {}, u.position || '-'),
        UI.h('td', { style: { textAlign: 'center' } }, UI.h('input', { type: 'checkbox', className: 'va-l1', value: u.id, checked: set1.has(u.id) })),
        UI.h('td', { style: { textAlign: 'center' } }, UI.h('input', { type: 'checkbox', className: 'va-l2', value: u.id, checked: set2.has(u.id) })),
      )));
    const body = UI.h('div', {},
      UI.h('p', { className: 'hint', style: { marginBottom: '12px' } },
        'เลือกเจ้าหน้าที่และกำหนดสิทธิ์การอนุมัติ — ผู้อนุมัติขั้นต้น (ขั้นที่ 1) และ ผู้อนุมัติ (ขั้นสุดท้าย) ใช้ร่วมกันทั้งการจองยานพาหนะและจองห้องประชุม ผู้ดูแลระบบมีสิทธิ์ครบทุกขั้นอยู่แล้ว'),
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
      const level1 = [...document.querySelectorAll('.va-l1:checked')].map((el) => Number(el.value));
      const level2 = [...document.querySelectorAll('.va-l2:checked')].map((el) => Number(el.value));
      try {
        const res = await API.put('/vehicle/approvers', { level1, level2 });
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  calView: false, // มุมมองปฏิทิน (true) หรือตาราง (false)
  calMonth: null, // เดือนที่แสดงในปฏิทิน (Date วันที่ 1 ของเดือน)

  async renderBookings(content) {
    const isMine = (r) => Auth.user && Number(r.user_id) === Number(Auth.user.id);
    const now = new Date(); const curYear = now.getFullYear() + 543;
    if (!VehiclesView.yearFilter) VehiclesView.yearFilter = String(curYear);
    const yearSel = UI.h('select', { id: 'vb-year', style: { width: 'fit-content' }, onchange: () => { VehiclesView.yearFilter = document.getElementById('vb-year').value; content.innerHTML = ''; VehiclesView.renderBookings(content); } },
      UI.h('option', { value: curYear, selected: VehiclesView.yearFilter === String(curYear) }, curYear),
      UI.h('option', { value: curYear - 1, selected: VehiclesView.yearFilter === String(curYear - 1) }, curYear - 1),
      UI.h('option', { value: '', selected: VehiclesView.yearFilter === '' }, 'ทุกปี'));
    // ปุ่มจอง + ฟิลเตอร์ ทั้งหมด / ของฉัน + มุมมองปฏิทิน + ดาวน์โหลด (ชิดขวา)
    const toolbar = UI.h('div', { className: 'toolbar' },
      UI.h('button', { className: 'btn btn-primary', onclick: () => VehiclesView.openBookingForm() }, '🚐 จองยานพาหนะ'),
      UI.h('div', { className: 'seg' },
        UI.h('button', { className: 'seg-btn' + (VehiclesView.myFilter === 'all' ? ' active' : ''), id: 'v-filter-all', onclick: () => { VehiclesView.myFilter = localStorage.getItem('vehicle_tab') || 'all'; content.innerHTML = ''; VehiclesView.renderBookings(content); } }, 'ทั้งหมด'),
        UI.h('button', { className: 'seg-btn' + (VehiclesView.myFilter === 'mine' ? ' active' : ''), id: 'v-filter-mine', onclick: () => { VehiclesView.myFilter = 'mine'; localStorage.setItem('vehicle_tab', 'mine'); content.innerHTML = ''; VehiclesView.renderBookings(content); } }, 'ของฉัน')),
      yearSel,
      UI.h('button', { className: 'btn btn-outline', id: 'vb-view-toggle', onclick: toggleView }, VehiclesView.calView ? '▭ มุมมองตาราง' : '🗓️ มุมมองปฏิทิน'),
      ExportFilterDialog.toolbarBtn(() => VehiclesView.openExportDialog()),
    );
    content.append(toolbar);

    const card = UI.h('div', { className: 'card' }, UI.loading());
    content.append(card);

    // ---- ข้อความแจ้งเตือนในระบบ (มีการแก้ไข/ยกเลิกการจอง) ----
    try {
      const nres = await API.get('/vehicle-bookings/notices');
      const notices = nres.notices || [];
      if (notices.length) {
        const noticeCard = UI.h('div', { className: 'card', style: { border: '1px solid #fcd34d', background: '#fffbeb', marginBottom: '14px' } },
          UI.h('div', { className: 'card-title' }, `📢 แจ้งเตือนการจองยานพาหนะ (${notices.length} ข้อความ)`),
          ...notices.map((n) => UI.h('div', { style: { padding: '10px 12px', borderBottom: '1px solid #fde68a', whiteSpace: 'pre-wrap', fontSize: '13px', lineHeight: '1.6' } },
            UI.h('span', { style: { color: '#92400e', fontWeight: 600 } }, n.type === 'cancel' ? '✕ ยกเลิกการจอง' : '✎ แก้ไขการจอง'),
            ` — ${new Date(n.created_at.replace(' ', 'T')).toLocaleString('th-TH')}\n`,
            n.text)),
          UI.h('div', { style: { padding: '10px 12px', textAlign: 'right' } },
            UI.h('button', { className: 'btn btn-outline btn-sm', onclick: async () => {
              try {
                await API.put('/vehicle-bookings/notices/read', {});
                content.innerHTML = '';
                VehiclesView.renderBookings(content);
              } catch (e) { UI.toast(e.message, 'error'); }
            } }, '✔️ อ่านแล้วทั้งหมด')));
        content.append(noticeCard);
      }
    } catch (e) { /* ไม่ต้องแสดง error */ }

    let data;
    try {
      const vbUrl = VehiclesView.yearFilter ? '/vehicle-bookings?year=' + VehiclesView.yearFilter : '/vehicle-bookings';
      data = await API.get(vbUrl);
    } catch (e) {
      card.innerHTML = '';
      card.append(UI.empty(e.message, '⚠️'));
      return;
    }
    let bookings = data.bookings || [];
    if (VehiclesView.myFilter === 'mine') bookings = bookings.filter(isMine);
    if (!VehiclesView.calMonth) VehiclesView.calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    function renderView() {
      const btn = document.getElementById('vb-view-toggle');
      if (btn) btn.textContent = VehiclesView.calView ? '▭ มุมมองตาราง' : '🗓️ มุมมองปฏิทิน';
      if (VehiclesView.calView) VehiclesView.renderCalendar(card, bookings);
      else VehiclesView.renderBookingsTable(card, bookings);
    }
    function toggleView() {
      VehiclesView.calView = !VehiclesView.calView;
      renderView();
    }
    renderView();
  },

  /** มุมมองตาราง: แสดงรายการจองทั้งหมด (ทุก user เห็นหมด แต่ลบได้เฉพาะของตัวเอง) */
  renderBookingsTable(card, bookings) {
    const isMine = (r) => Auth.user && Number(r.user_id) === Number(Auth.user.id);
    card.innerHTML = '';
    card.append(UI.h('div', { className: 'card-title' },
      VehiclesView.myFilter === 'mine' ? `▭ รายการจองของฉัน (${bookings.length})` : `▭ รายการจองทั้งหมด (${bookings.length})`));

    if (!bookings.length) {
      card.append(UI.empty('ยังไม่มีรายการจอง', '🚐'));
      return;
    }
    const cols = [
      { key: 'date', label: 'วันที่', render: (r) => (r.date_to && r.date_to !== r.date ? `${UI.date(r.date)} → ${UI.date(r.date_to)}` : UI.date(r.date)) },
      { key: 'full_name', label: 'ผู้จอง', render: (r) => UI.h('div', { className: 'nowrap' }, UI.personName(r)) },
      { key: 'vehicle_name', label: 'ยานพาหนะ', render: (r) => r.vehicle_name
        ? UI.h('div', {}, r.vehicle_name, UI.h('div', { className: 'hint' }, r.plate))
        : UI.h('div', {}, '🤝 มอบเจ้าหน้าที่จัดให้', UI.h('div', { className: 'hint' }, 'รอเจ้าหน้าที่จัดรถ')) },
      { key: 'time', label: 'เวลา', render: (r) => `${UI.time(r.start_time)} - ${UI.time(r.end_time)}` },
      { key: 'total_days', label: 'รวม (วัน)', render: (r) => `${r.total_days || 1} วัน`, className: 'num' },
      { key: 'driver_name', label: 'พนักงานขับรถ', render: (r) => r.driver_name || (r.self_drive ? 'ผู้ขอขับเอง' : '-') },
      { key: 'passenger_count', label: 'ผู้โดยสาร', render: (r) => (r.passenger_count ? `${r.passenger_count} คน` : '-'), className: 'num' },
      { key: 'purpose', label: 'วัตถุประสงค์', render: (r) => UI.h('div', { className: 'clamp-2', title: r.purpose }, r.purpose) },
      { key: 'destination', label: 'สถานที่ไปราชการ' },
      { key: 'detail', label: 'รายละเอียด', render: (r) => UI.actionBtn('▭ รายละเอียด', () => VehiclesView.showVehicleDocument(r)) },
    ];
    cols.push({
      key: 'status', label: 'สถานะ',
      render: (r) => UI.h('div', {},
        UI.badge(r.status),
        UI.h('div', { style: { cursor: 'pointer' }, title: 'ดูความคืบหน้าการอนุมัติ', onclick: () => UI.modal({ title: '▭ ความคืบหน้าการอนุมัติ', body: UI.approvalDetail(r, VehiclesView.LEVEL_NAMES) }) }, UI.approvalPill(r))),
    });
    cols.push({
      key: 'actions', label: 'จัดการ',
      render: (r) => {
        const btns = [];
        btns.push(...VehiclesView.vehicleButtons(r));
        // แก้ไข: ผู้อนุมัติขั้นต้น / admin — แก้ได้แม้อนุมัติแล้ว (ยานพาหนะ/วันเวลา/พนักงานขับรถ)
        const canEdit = (Auth.isAdmin() || VehiclesView.canApproveLevel(1)) && (r.status === 'pending' || r.status === 'approved');
        if (canEdit) btns.push(UI.actionBtn('✎ แก้ไข', () => VehiclesView.openEditBookingForm(r)));
        // ยกเลิก: ผู้อนุมัติขั้นต้น / admin (ทุกรายการ) หรือเจ้าของรายการที่ยังรออนุมัติ
        const canCancel = Auth.isAdmin() || VehiclesView.canApproveLevel(1) || (isMine(r) && r.status === 'pending');
        if (canCancel) btns.push(UI.actionBtn('✕ ยกเลิก', () => VehiclesView.removeBooking(r), 'danger-btn'));
        return UI.h('div', { className: 'status-btns' }, btns);
      },
    });
    card.append(UI.table(cols, bookings));

    // แสดงหมายเหตุที่ admin ใส่
    for (const r of bookings) {
      if (r.note) {
        card.append(UI.h('div', { className: 'hint', style: { marginTop: '10px' } }, `หมายเหตุรายการ ${r.id}: ${r.note}`));
      }
    }
  },

  /** มุมมองปฏิทิน: ปฏิทินรายเดือนแสดงการจองยานพาหนะของทุกคน */
  renderCalendar(card, bookings) {
    card.innerHTML = '';
    card.append(UI.h('div', { className: 'card-title' },
      VehiclesView.myFilter === 'mine' ? '🗓️ มุมมองปฏิทิน (ของฉัน)' : '🗓️ มุมมองปฏิทิน'));
    const m = VehiclesView.calMonth;
    const year = m.getFullYear(), month = m.getMonth();
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7; // จันทร์ = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const byDay = {};
    for (const b of bookings) {
      // วางการจองที่วันเริ่ม (หรือวันเดียว) ตามเดือนที่แสดง
      if (b.date && String(b.date).slice(0, 7) === prefix) {
        const d = parseInt(String(b.date).slice(8, 10), 10);
        (byDay[d] = byDay[d] || []).push(b);
      }
    }
    const thaiMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const today = new Date();
    const header = UI.h('div', { className: 'cal-head' },
      UI.h('button', { className: 'btn btn-outline btn-sm', title: 'เดือนก่อนหน้า', onclick: () => { VehiclesView.calMonth = new Date(year, month - 1, 1); VehiclesView.renderCalendar(card, bookings); } }, '◀'),
      UI.h('div', { className: 'cal-title' }, `${thaiMonths[month]} ${year + 543}`),
      UI.h('button', { className: 'btn btn-outline btn-sm', title: 'เดือนถัดไป', onclick: () => { VehiclesView.calMonth = new Date(year, month + 1, 1); VehiclesView.renderCalendar(card, bookings); } }, '▶'),
      UI.h('button', { className: 'btn btn-outline btn-sm', onclick: () => { VehiclesView.calMonth = new Date(today.getFullYear(), today.getMonth(), 1); VehiclesView.renderCalendar(card, bookings); } }, 'เดือนนี้'));
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
        title: `${b.vehicle_name || 'มอบเจ้าหน้าที่จัดให้'} • ${b.start_time || '-'}-${b.end_time || '-'} • ${UI.personName(b)}`,
        onclick: () => VehiclesView.bookingDetail(b),
      }, `${b.vehicle_name ? b.vehicle_name.split(' ')[0] : '🤝'} ${b.start_time || ''}`)));
      grid.append(cell);
    }
    card.append(header);
    card.append(grid);
    card.append(UI.h('p', { className: 'hint', style: { marginTop: '10px' } }, '💡 กดการ์ดจองในปฏิทินเพื่อดูรายละเอียด'));
  },

  /** หน้าต่างรายละเอียดการจอง (ใช้ในมุมมองปฏิทิน) */
  bookingDetail(r) {
    const body = UI.h('div', { className: 'form-grid' },
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ยานพาหนะ'), UI.h('div', {}, r.vehicle_name ? `${r.vehicle_name}${r.plate ? ` (${r.plate})` : ''}` : '🤝 มอบเจ้าหน้าที่จัดให้')),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'วันที่'), UI.h('div', {}, r.date_to && r.date_to !== r.date ? `${UI.date(r.date)} → ${UI.date(r.date_to)}` : UI.date(r.date))),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'เวลา'), UI.h('div', {}, `${UI.time(r.start_time)} - ${UI.time(r.end_time)}`)),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ผู้จอง'), UI.h('div', {}, UI.personName(r))),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'พนักงานขับรถ'), UI.h('div', {}, r.driver_name || (r.self_drive ? 'ผู้ขอขับเอง' : '-'))),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ผู้โดยสาร'), UI.h('div', {}, `${r.passenger_count || 0} คน`)),
      UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'สถานที่ไปราชการ'), UI.h('div', {}, r.destination || '-')),
      UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'วัตถุประสงค์'), UI.h('div', {}, r.purpose)),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'สถานะ'), UI.h('div', {}, UI.badge(r.status))),
      UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'ความคืบหน้าการอนุมัติ'), UI.approvalDetail(r, VehiclesView.LEVEL_NAMES)),
    );
    UI.modal({ title: '▭ รายละเอียดการจอง', body, size: 'lg' });
  },

  openBookingForm() {
    const available = VehiclesView.vehicles.filter((v) => v.status === 'available');
    const body = UI.h('div', { className: 'form-grid' },
      UI.h('div', { className: 'form-group full' },
        UI.h('div', { id: 'vb-photo-box', className: 'vehicle-booking-photo' })),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'ยานพาหนะ', UI.h('span', { className: 'req' }, ' *')),
        UI.h('select', { id: 'vb-vehicle' },
          UI.h('option', { value: '' }, '🤝 มอบเจ้าหน้าที่จัดให้'),
          available.map((v) => UI.h('option', { value: v.id }, `${v.name} (${v.plate || '-'})`))),
        UI.h('div', { className: 'hint' }, 'เลือก "มอบเจ้าหน้าที่จัดให้" หากยังไม่ระบุรถเฉพาะ เจ้าหน้าที่จะจัดรถให้')),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'สถานที่ไปราชการ'),
        UI.h('input', { id: 'vb-dest', placeholder: 'เช่น กรุงเทพมหานคร' })),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'เพื่อวัตถุประสงค์', UI.h('span', { className: 'req' }, ' *')),
        UI.h('input', { id: 'vb-purpose', placeholder: 'เช่น ไปราชการส่งเอกสารที่ สพฐ.' })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ตั้งแต่วันที่', UI.h('span', { className: 'req' }, ' *')),
        UI.thaiDatePicker('vb-date-from', { min: UI.today(), onChange: calcDays })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ตั้งแต่เวลา'),
        UI.h('input', { id: 'vb-time-from', type: 'time' })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ถึงวันที่'),
        UI.thaiDatePicker('vb-date-to', { min: UI.today(), onChange: calcDays })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ถึงเวลา'),
        UI.h('input', { id: 'vb-time-to', type: 'time' })),
      UI.h('div', { id: 'vb-conflict', className: 'form-group full', style: { display: 'none' } }),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'รวม (วัน)'),
        UI.h('input', { id: 'vb-total', type: 'number', min: '1', value: '1', readonly: true })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'มีผู้โดยสารทั้งหมด (คน)'),
        UI.h('input', { id: 'vb-passengers', type: 'number', min: '0', value: '0' })),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'ผู้ควบคุมรถคือ'),
        UI.h('input', { id: 'vb-controller', value: Auth.user ? UI.personName(Auth.user) : '' })),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'เชื้อเพลิง'),
        UI.h('div', { className: 'fuel-opts' },
          UI.h('label', { className: 'fuel-opt' }, UI.h('input', { id: 'vb-fuel-none', type: 'checkbox' }), ' ไม่ขอใช้งบประมาณ'),
          UI.h('label', { className: 'fuel-opt' }, UI.h('input', { id: 'vb-fuel-central', type: 'checkbox' }), ' ขอใช้จากงบเชื้อเพลิงกลางของ สพท.'),
          UI.h('label', { className: 'fuel-opt' }, UI.h('input', { id: 'vb-fuel-project', type: 'checkbox' }), ' ขอใช้จากงบเชื้อเพลิงจากโครงการ'))),
      UI.h('div', { className: 'form-group full', id: 'vb-fuel-project-box', style: { display: 'none' } },
        UI.h('div', { className: 'form-grid', style: { marginTop: '8px' } },
          UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ชื่อโครงการ'), UI.h('input', { id: 'vb-fuel-pname', placeholder: 'เช่น โครงการนิเทศติดตาม' })),
          UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ชื่อกิจกรรม'), UI.h('input', { id: 'vb-fuel-act', placeholder: 'เช่น กิจกรรมนิเทศภายใน' })),
          UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'จำนวนเงิน (บาท)'), UI.h('input', { id: 'vb-fuel-amt', type: 'number', min: '0', step: '0.01', placeholder: '0.00' })))),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', { style: { color: 'var(--danger)', fontWeight: 700 } }, '⚠️ กรณีไม่มีพนักงานขับรถ'),
        UI.h('label', { className: 'fuel-opt', style: { marginTop: '6px' } },
          UI.h('input', { id: 'vb-selfdrive', type: 'checkbox' }),
          ' ขออนุญาตเป็นผู้ขับรถคันดังกล่าว ซึ่งได้รับใบอนุญาตในการขับขี่รถจากทางราชการประเภทนี้')),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '📨 ส่งคำขอยืม'));
    const m = UI.modal({ title: '🚐 จองยานพาหนะ', body, footer: foot, size: 'lg' });
    document.getElementById('vb-date-from').value = UI.isoToBE(UI.today());
    document.getElementById('vb-date-to').value = UI.isoToBE(UI.today());

    // แสดงรูปยานพาหนะที่เลือกไว้ด้านบน (อัปเดตเมื่อเปลี่ยนรถ)
    const photoBox = document.getElementById('vb-photo-box');
    const updatePhoto = () => {
      const sel = document.getElementById('vb-vehicle');
      const vid = sel ? Number(sel.value) : null;
      const v = VehiclesView.vehicles.find((x) => x.id === vid);
      photoBox.innerHTML = '';
      if (v && v.photo) {
        photoBox.append(UI.h('img', { src: '/uploads/' + UI.encodePath(v.photo), alt: v.name || 'ยานพาหนะ' }));
      } else {
        photoBox.append(UI.h('div', { className: 'vehicle-booking-photo-empty' }, '🚐'));
      }
    };
    updatePhoto();
    const selEl = document.getElementById('vb-vehicle');
    if (selEl) selEl.addEventListener('change', updatePhoto);

    // คำนวณจำนวนวันรวม (จาก ตั้งแต่วันที่ → ถึงวันที่)
    function calcDays() {
      const from = UI.readThaiDateInput('vb-date-from');
      const to = UI.readThaiDateInput('vb-date-to');
      const out = document.getElementById('vb-total');
      if (!from || !to) { out.value = 1; return; }
      const a = new Date(from + 'T00:00:00');
      const b = new Date(to + 'T00:00:00');
      out.value = b >= a ? Math.max(1, Math.round((b - a) / 86400000) + 1) : 1;
    }
    calcDays();

    // แสดงช่องรายละเอียดโครงการ เมื่อติ๊ก "ขอใช้จากงบเชื้อเพลิงจากโครงการ"
    const projChk = document.getElementById('vb-fuel-project');
    projChk.addEventListener('change', () => {
      document.getElementById('vb-fuel-project-box').style.display = projChk.checked ? 'block' : 'none';
    });

    // ---- กันการจองซ้ำ: เช็คยานพาหนะ + วันที่/เวลา ที่เลือกมีคนจองไว้ก่อนหรือไม่ ----
    let clashTimer = null;
    const conflictBox = document.getElementById('vb-conflict');
    async function checkConflict() {
      clearTimeout(clashTimer);
      clashTimer = setTimeout(async () => {
        const vehicleId = document.getElementById('vb-vehicle').value;
        const from = UI.readThaiDateInput('vb-date-from');
        const to = UI.readThaiDateInput('vb-date-to');
        conflictBox.style.display = 'none';
        conflictBox.innerHTML = '';
        if (!vehicleId || !from) return;
        try {
          const q = new URLSearchParams({
            vehicle_id: vehicleId,
            date: from,
            date_to: to || '',
            start_time: document.getElementById('vb-time-from').value,
            end_time: document.getElementById('vb-time-to').value,
          });
          const res = await API.get('/vehicle-bookings/conflicts?' + q.toString());
          const hit = (res.conflicts || [])[0];
          if (hit) {
            conflictBox.innerHTML = '';
            conflictBox.append(UI.h('div', { style: { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: '10px', padding: '12px 14px' } },
              UI.h('div', { style: { fontWeight: 700, marginBottom: '6px' } }, '⚠️ ยานพาหนะคันนี้ถูกจองไว้ก่อนแล้ว — ไม่สามารถจองซ้ำได้'),
              UI.h('div', {}, `ผู้จอง: ${hit.full_name} • ${hit.purpose}`)));
            conflictBox.style.display = 'block';
          }
        } catch (e) { /* ไม่ต้องแสดง error */ }
      }, 350);
    }
    ['vb-vehicle', 'vb-time-from', 'vb-time-to'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', checkConflict);
    });
    const dateFromEl = document.getElementById('vb-date-from');
    const dateToEl = document.getElementById('vb-date-to');
    if (dateFromEl) dateFromEl.addEventListener('change', () => { calcDays(); checkConflict(); });
    if (dateToEl) dateToEl.addEventListener('change', () => { calcDays(); checkConflict(); });
    checkConflict();

    async function save() {
      // กันจองซ้ำซ้ำอีกชั้นตอนกดส่ง
      const vehicleId = document.getElementById('vb-vehicle').value;
      const from = UI.readThaiDateInput('vb-date-from');
      const to = UI.readThaiDateInput('vb-date-to');
      if (vehicleId && from) {
        try {
          const q = new URLSearchParams({
            vehicle_id: vehicleId, date: from, date_to: to || '',
            start_time: document.getElementById('vb-time-from').value,
            end_time: document.getElementById('vb-time-to').value,
          });
          const res = await API.get('/vehicle-bookings/conflicts?' + q.toString());
          const hit = (res.conflicts || [])[0];
          if (hit) return UI.toast(`ไม่สามารถจองได้ — ยานพาหนะคันนี้ถูกจองไว้แล้วในช่วงเวลานี้ (${hit.full_name} • ${hit.purpose})`, 'error');
        } catch (e) { /* ข้ามถ้าเช็คไม่สำเร็จ — backend กันไว้อยู่แล้ว */ }
      }
      
      const fuelLabels = [];
      if (document.getElementById('vb-fuel-none').checked) fuelLabels.push('ไม่ขอใช้งบประมาณ');
      if (document.getElementById('vb-fuel-central').checked) fuelLabels.push('ขอใช้จากงบเชื้อเพลิงกลางของ สพท.');
      if (document.getElementById('vb-fuel-project').checked) fuelLabels.push('ขอใช้จากงบเชื้อเพลิงจากโครงการ');
      const amount = document.getElementById('vb-fuel-amt').value === '' ? 0 : Number(document.getElementById('vb-fuel-amt').value);
      if (fuelLabels.includes('ขอใช้จากงบเชื้อเพลิงจากโครงการ')) {
        if (!document.getElementById('vb-fuel-pname').value.trim()) return UI.toast('กรุณากรอกชื่อโครงการ', 'error');
        if (!document.getElementById('vb-fuel-act').value.trim()) return UI.toast('กรุณากรอกชื่อกิจกรรม', 'error');
        if (!(amount > 0)) return UI.toast('กรุณากรอกจำนวนเงิน (บาท) ให้ถูกต้อง', 'error');
      }
      const data = {
        vehicle_id: document.getElementById('vb-vehicle').value,
        date: UI.readThaiDateInput('vb-date-from'),
        start_time: document.getElementById('vb-time-from').value,
        date_to: UI.readThaiDateInput('vb-date-to'),
        end_time: document.getElementById('vb-time-to').value,
        total_days: parseInt(document.getElementById('vb-total').value, 10) || 1,
        purpose: document.getElementById('vb-purpose').value.trim(),
        destination: document.getElementById('vb-dest').value.trim(),
        passenger_count: parseInt(document.getElementById('vb-passengers').value, 10) || 0,
        controller: document.getElementById('vb-controller').value.trim(),
        fuel_choice: fuelLabels.join(', '),
        fuel_project: document.getElementById('vb-fuel-pname').value.trim(),
        fuel_activity: document.getElementById('vb-fuel-act').value.trim(),
        fuel_amount: amount,
        self_drive: document.getElementById('vb-selfdrive').checked ? 1 : 0,
      };
      if (!data.date) return UI.toast('กรุณาเลือกวันที่ (ตั้งแต่วันที่)', 'error');
      if (!data.purpose) return UI.toast('กรุณากรอกวัตถุประสงค์', 'error');
      try {
        const res = await API.post('/vehicle-bookings', data);
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  /** แก้ไขการจองยานพาหนะ (ผู้อนุมัติขั้นต้น / admin — แก้ได้แม้อนุมัติแล้ว) */
  async openEditBookingForm(r) {
    let users = [];
    try {
      const res = await API.get('/users/active');
      users = res.users || [];
    } catch (e) { /* ignore */ }
    const full = (u) => UI.personName(u);
    const body = UI.h('div', { className: 'form-grid' },
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'ยานพาหนะ'),
        UI.h('select', { id: 'vb-edit-vehicle' },
          UI.h('option', { value: '' }, '🤝 มอบเจ้าหน้าที่จัดให้'),
          VehiclesView.vehicles.map((v) => UI.h('option', { value: v.id, selected: Number(r.vehicle_id) === v.id },
            `${v.name} (${v.plate || '-'})${v.status === 'maintenance' ? ' [ซ่อมบำรุง]' : ''}`))),
        UI.h('div', { className: 'hint' }, 'เปลี่ยนยานพาหนะได้ — ระบบจะเช็ควัน/เวลาที่แก้ไขว่าซ้อนกับรายการอื่นหรือไม่')),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ตั้งแต่วันที่'),
        UI.thaiDatePicker('vb-edit-date-from', { onChange: calcDays })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ตั้งแต่เวลา'),
        UI.h('input', { id: 'vb-edit-time-from', type: 'time', value: r.start_time || '' })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ถึงวันที่'),
        UI.thaiDatePicker('vb-edit-date-to', { onChange: calcDays })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ถึงเวลา'),
        UI.h('input', { id: 'vb-edit-time-to', type: 'time', value: r.end_time || '' })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'รวม (วัน)'),
        UI.h('input', { id: 'vb-edit-total', type: 'number', min: '1', value: String(r.total_days || 1), readonly: true })),
      UI.h('div', { id: 'vb-edit-conflict', className: 'form-group full', style: { display: 'none' } }),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'พนักงานขับรถ'),
        UI.h('select', { id: 'vb-edit-driver' },
          UI.h('option', { value: '' }, '— เลือกพนักงานขับรถ —'),
          users.map((u) => UI.h('option', { value: full(u), selected: r.driver_name === full(u) }, full(u)))),
        UI.h('div', { className: 'hint' }, 'เปลี่ยนพนักงานขับรถได้ — ระบบจะแจ้งเตือนพนักงานขับรถเดิมและคนใหม่')),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'ผู้จอง'), UI.h('div', {}, UI.personName(r))),
      UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'ความคืบหน้าการอนุมัติ'), UI.approvalDetail(r, VehiclesView.LEVEL_NAMES)),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '▽ บันทึกการแก้ไข'));
    const m = UI.modal({ title: '✎ แก้ไขการจองยานพาหนะ', body, footer: foot, size: 'lg' });
    document.getElementById('vb-edit-date-from').value = UI.isoToBE(r.date);
    document.getElementById('vb-edit-date-to').value = UI.isoToBE(r.date_to || r.date);

    function calcDays() {
      const from = UI.readThaiDateInput('vb-edit-date-from');
      const to = UI.readThaiDateInput('vb-edit-date-to');
      const out = document.getElementById('vb-edit-total');
      if (!from || !to) { out.value = 1; return; }
      const a = new Date(from + 'T00:00:00');
      const b = new Date(to + 'T00:00:00');
      out.value = b >= a ? Math.max(1, Math.round((b - a) / 86400000) + 1) : 1;
    }
    calcDays();

    // ---- กันการจองซ้ำ: เช็คยานพาหนะ + วันที่/เวลา ที่แก้ไขว่าซ้อนกับรายการอื่นหรือไม่ ----
    let clashTimer = null;
    const conflictBox = document.getElementById('vb-edit-conflict');
    async function checkConflict() {
      clearTimeout(clashTimer);
      clashTimer = setTimeout(async () => {
        const vehicleId = document.getElementById('vb-edit-vehicle').value;
        const from = UI.readThaiDateInput('vb-edit-date-from');
        conflictBox.style.display = 'none';
        conflictBox.innerHTML = '';
        if (!vehicleId || !from) return;
        try {
          const q = new URLSearchParams({
            vehicle_id: vehicleId, date: from,
            date_to: UI.readThaiDateInput('vb-edit-date-to') || '',
            start_time: document.getElementById('vb-edit-time-from').value,
            end_time: document.getElementById('vb-edit-time-to').value,
            exclude: r.id,
          });
          const res = await API.get('/vehicle-bookings/conflicts?' + q.toString());
          const hit = (res.conflicts || [])[0];
          if (hit) {
            conflictBox.innerHTML = '';
            conflictBox.append(UI.h('div', { style: { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: '10px', padding: '12px 14px' } },
              UI.h('div', { style: { fontWeight: 700, marginBottom: '6px' } }, '⚠️ ยานพาหนะคันนี้ถูกจองไว้ก่อนแล้วในช่วงเวลาที่แก้ไข'),
              UI.h('div', {}, `ผู้จอง: ${hit.full_name} • ${hit.purpose}`)));
            conflictBox.style.display = 'block';
          }
        } catch (e) { /* ไม่ต้องแสดง error */ }
      }, 350);
    }
    ['vb-edit-vehicle', 'vb-edit-time-from', 'vb-edit-time-to'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', checkConflict);
    });
    ['vb-edit-date-from', 'vb-edit-date-to'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => { calcDays(); checkConflict(); });
    });

    async function save() {
      const vehicleId = document.getElementById('vb-edit-vehicle').value;
      const from = UI.readThaiDateInput('vb-edit-date-from');
      const to = UI.readThaiDateInput('vb-edit-date-to');
      if (!from) return UI.toast('กรุณาระบุวันที่', 'error');
      // กันการจองซ้ำอีกรอบตอนกดบันทึก
      if (vehicleId) {
        try {
          const q = new URLSearchParams({
            vehicle_id: vehicleId, date: from, date_to: to || '',
            start_time: document.getElementById('vb-edit-time-from').value,
            end_time: document.getElementById('vb-edit-time-to').value,
            exclude: r.id,
          });
          const res = await API.get('/vehicle-bookings/conflicts?' + q.toString());
          const hit = (res.conflicts || [])[0];
          if (hit) return UI.toast(`ไม่สามารถแก้ไขได้ — ยานพาหนะคันนี้ถูกจองไว้แล้วในช่วงเวลาที่แก้ไข (${hit.full_name} • ${hit.purpose})`, 'error');
        } catch (e) { /* ข้ามถ้าเช็คไม่สำเร็จ — backend กันไว้อยู่แล้ว */ }
      }
      const data = {
        vehicle_id: vehicleId,
        date: from,
        date_to: to || '',
        start_time: document.getElementById('vb-edit-time-from').value,
        end_time: document.getElementById('vb-edit-time-to').value,
        driver_name: document.getElementById('vb-edit-driver').value,
      };
      try {
        const res = await API.put(`/vehicle-bookings/${r.id}/edit`, data);
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  async decide(r, action) {
    const label = action === 'approve' ? 'อนุมัติ' : 'ไม่อนุมัติ';
    const ok = await UI.confirm(`ต้องการ${label}การจองยานพาหนะ "${r.vehicle_name || 'มอบเจ้าหน้าที่จัดให้'}" วันที่ ${UI.date(r.date)} ใช่หรือไม่?`, { okText: label, danger: action !== 'approve' });
    if (!ok) return;
    await VehiclesView.decideDirect(r, action);
  },

  /** อนุมัติ/ไม่อนุมัติโดยไม่ถามยืนยันซ้ำ (ใช้หลังหน้าต่างรายละเอียดแล้ว) */
  async decideDirect(r, action) {
    try {
      const res = await API.put(`/vehicle-bookings/${r.id}/${action}`, {});
      UI.toast(res.message);
      render();
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  async removeBooking(r) {
    const ok = await UI.confirm('ต้องการยกเลิกรายการจองยานพาหนะนี้ใช่หรือไม่?\n\nระบบจะลบรายการออกและแจ้งเตือนผู้จองและพนักงานขับรถ', { danger: true, okText: 'ยกเลิกรายการ' });
    if (!ok) return;
    try {
      const res = await API.del('/vehicle-bookings/' + r.id);
      UI.toast(res.message);
      render();
    } catch (e) { UI.toast(e.message, 'error'); }
  },
};
