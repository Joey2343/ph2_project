'use strict';
/* เมนู 12: เจ้าหน้าที่ในระบบ (admin เท่านั้น) */

const StaffView = {
  tab: 'pending',

  /** เปลี่ยนแท็บ + จดจำลง URL hash เพื่อคงแท็บเดิมหลังรีเฟรช */
  go(t) {
    this.tab = t;
    try {
      var base = location.hash.split('?')[0];
      history.replaceState(null, '', base + '?tab=' + t);
    } catch (e) { /* ignore */ }
    ['s-tab-pending', 's-tab-office', 's-tab-school', 's-tab-settings', 's-tab-simdate'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var key = id.replace('s-tab-', '');
      el.classList.toggle('active', key === t);
    });
    var content = document.getElementById('s-content');
    if (content) {
      content.innerHTML = '';
      if (t === 'pending') StaffView.renderPending(content);
      else if (t === 'settings') StaffView.renderSettings(content);
      else if (t === 'simdate') StaffView.renderSimDate(content);
      else if (t === 'office') StaffView.renderAll(content, 'office');
      else StaffView.renderAll(content, 'school');
    }
  },

  async render(app) {
    // คงแท็บเดิมไว้เมื่อกดรีเฟรช — อ่านค่า ?tab= จาก URL hash (เช่น #/staff?tab=office)
    try {
      var mq = new URLSearchParams((location.hash.split('?')[1] || ''));
      var mt = mq.get('tab');
      if (['pending', 'office', 'school', 'settings', 'simdate'].includes(mt)) StaffView.tab = mt;
    } catch (e) { /* ignore */ }
    const head = UI.h('div', { className: 'page-head' },
      UI.h('div', {},
        UI.h('div', { className: 'page-title' }, UI.h('span', { className: 'pi' }, '👥'), 'เจ้าหน้าที่ในระบบ'),
        UI.h('div', { className: 'page-desc' }, 'จัดการสมาชิก อนุมัติการสมัคร แก้ไขข้อมูล กำหนดสิทธิ์ 5 ระดับ และสิทธิ์การอนุมัติ')),
    );
    app.append(head);

    const tabs = UI.h('div', { className: 'tabs' },
      UI.h('button', { className: 'tab', id: 's-tab-pending', onclick: () => { StaffView.go('pending'); } }, '◷ รออนุมัติ'),
      UI.h('button', { className: 'tab', id: 's-tab-office', onclick: () => { StaffView.go('office'); } }, '📋 เจ้าหน้าที่ สพป.แพร่ เขต 2'),
      UI.h('button', { className: 'tab', id: 's-tab-school', onclick: () => { StaffView.go('school'); } }, '🏫 เจ้าหน้าที่สถานศึกษา'),
      UI.h('button', { className: 'tab', id: 's-tab-settings', onclick: () => { StaffView.go('settings'); } }, '⊛ ตั้งค่าการอนุมัติ'),
      UI.h('button', { className: 'tab', id: 's-tab-simdate', onclick: () => { StaffView.go('simdate'); } }, '⏱ โหมดจำลองวันที่'),
    );
    app.append(tabs);
    const content = UI.h('div', { id: 's-content' });
    app.append(content);

    function renderTabs() {
      document.getElementById('s-tab-pending').classList.toggle('active', StaffView.tab === 'pending');
      document.getElementById('s-tab-office').classList.toggle('active', StaffView.tab === 'office');
      document.getElementById('s-tab-school').classList.toggle('active', StaffView.tab === 'school');
      document.getElementById('s-tab-settings').classList.toggle('active', StaffView.tab === 'settings');
      document.getElementById('s-tab-simdate').classList.toggle('active', StaffView.tab === 'simdate');
      content.innerHTML = '';
      if (StaffView.tab === 'pending') StaffView.renderPending(content);
      else if (StaffView.tab === 'settings') StaffView.renderSettings(content);
      else if (StaffView.tab === 'office') StaffView.renderAll(content, 'office');
      else StaffView.renderAll(content, 'school');
    }
    renderTabs();
  },

  async renderPending(content) {
    const card = UI.h('div', { className: 'card' }, UI.loading('กำลังโหลดผู้รออนุมัติ...'));
    content.append(card);
    let data;
    try {
      data = await API.get('/staff?status=pending');
    } catch (e) {
      card.innerHTML = '';
      card.append(UI.empty(e.message, '⚠️'));
      return;
    }
    card.innerHTML = '';
    card.append(UI.h('div', { className: 'card-title' }, `◷ ผู้รออนุมัติ (${data.staff.length} คน)`));
    if (!data.staff.length) {
      card.append(UI.empty('ไม่มีผู้รออนุมัติในขณะนี้', '●'));
      return;
    }
    const grid = UI.h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px' } });
    for (const u of data.staff) {
      const item = UI.h('div', { className: 'card', style: { marginBottom: '0' } },
        UI.h('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '10px' } },
          u.photo
            ? UI.h('img', { className: 'profile-photo', src: '/uploads/' + UI.encodePath(u.photo), style: { width: '64px', height: '64px' } })
            : UI.h('div', { className: 'profile-photo', style: { width: '64px', height: '64px', display: 'grid', placeItems: 'center', fontSize: '24px', background: 'var(--primary-light)', color: 'var(--primary-deep)' } }, (u.first_name || u.full_name || '?').charAt(0)),
          UI.h('div', {},
            UI.h('div', { style: { fontWeight: 700 } }, UI.personName(u)),
            UI.h('div', { className: 'hint' }, `@${u.username}${u.nickname ? ' • ชื่อเล่น ' + u.nickname : ''}`),
            UI.h('div', { className: 'hint' }, `${u.position || ''}${u.workplace ? ' • ' + u.workplace : ''}`)),
        ),
        UI.h('div', { style: { fontSize: '13px', marginBottom: '8px' } },
          UI.h('div', { className: 'hint' }, `เลขบัตรประชาชน: ${u.citizen_id || '-'}`),
          UI.h('div', { className: 'hint' }, `โทร: ${u.phone || '-'}${u.email ? ' • ' + u.email : ''}`),
          UI.h('div', { className: 'hint' }, `สมัครเมื่อ: ${UI.date(u.created_at)}`)),
        UI.h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '10px' } },
          u.signature ? UI.h('img', { className: 'signature-img', src: '/uploads/' + UI.encodePath(u.signature), title: 'ลายเซ็น' }) : UI.h('span', { className: 'hint' }, 'ไม่มีลายเซ็น')),
        UI.h('div', { className: 'status-btns', style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          UI.h('button', { className: 'btn btn-sm btn-primary', onclick: () => StaffView.setStatus(u, 'active') }, '● อนุมัติ'),
          UI.h('button', { className: 'btn btn-sm btn-outline', onclick: () => StaffView.editStaff(u) }, '✎ แก้ไข'),
          UI.h('button', { className: 'btn btn-sm btn-danger', onclick: () => StaffView.setStatus(u, 'rejected') }, '✕ ปฏิเสธ')),
      );
      grid.append(item);
    }
    card.append(grid);
  },

  async renderAll(content, userGroup) {
    const filterRow = UI.h('div', { className: 'filter-row', style: { display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' } },
      UI.h('input', { id: 'st-q', type: 'search', placeholder: '☺ ค้นหาชื่อ/username/ตำแหน่ง/เลขบัตร...', style: { minWidth: '240px' }, oninput: () => load() }),
      UI.h('select', { id: 'st-status', onchange: () => load() },
        UI.h('option', { value: '' }, 'ทุกสถานะ'),
        UI.h('option', { value: 'active' }, 'ใช้งาน'),
        UI.h('option', { value: 'pending' }, 'รออนุมัติ'),
        UI.h('option', { value: 'inactive' }, 'ระงับ'),
        UI.h('option', { value: 'rejected' }, 'ปฏิเสธ')),
// userGroup is pre-filtered by tab
    );
    content.append(filterRow);
    const card = UI.h('div', { className: 'card' }, UI.loading());
    content.append(card);

    async function load() {
      const q = document.getElementById('st-q').value.trim();
      const status = document.getElementById('st-status').value;
      const group = userGroup || '';
      let url = '/staff?';
      if (q) url += 'q=' + UI.encodePath(q) + '&';
      if (status) url += 'status=' + UI.encodePath(status) + '&';
      if (group) url += 'user_group=' + UI.encodePath(group);
      try {
        const data = await API.get(url);
        card.innerHTML = '';
        var groupLabel = userGroup === 'office' ? '📋 เจ้าหน้าที่ สพป.แพร่ เขต 2' : '🏫 เจ้าหน้าที่สถานศึกษา';
        card.append(UI.h('div', { className: 'card-title' }, groupLabel + ' (' + data.staff.length + ' คน)'));
        if (!data.staff.length) {
          card.append(UI.empty('ไม่พบเจ้าหน้าที่', '👥'));
          return;
        }
        // ---- เรียงลำดับ + เลขที่ ----
        const rows = data.staff.slice();
        if (userGroup === 'office') {
          // กลุ่มงาน: ผู้บริหารการศึกษาอันดับแรก, หน่วยตรวจสอบภายในท้ายสุด, กลุ่มอื่นตามลำดับใน WORKPLACES
          const mids = CONSTANTS.WORKPLACES.filter(w => w !== 'ผู้บริหารการศึกษา' && w !== 'หน่วยตรวจสอบภายใน');
          const wpRank = (w) => w === 'ผู้บริหารการศึกษา' ? 0 : (w === 'หน่วยตรวจสอบภายใน' ? 999 : 1 + mids.indexOf(w));
          const staffNo = (u) => { const n = parseInt(u.staff_no, 10); return isNaN(n) ? 9999 : n; };
          rows.sort((a, b) => {
            const wa = wpRank(a.workplace || ''), wb = wpRank(b.workplace || '');
            if (wa !== wb) return wa - wb;
            // ในกลุ่มงานผู้บริหารการศึกษา: ผู้อำนวยการอันดับแรกสุด แล้วเรียงตามลำดับเจ้าหน้าที่
            if ((a.workplace || '') === 'ผู้บริหารการศึกษา') {
              const pa = (a.position || '').startsWith('ผู้อำนวยการ') && !(a.position || '').startsWith('รองผู้อำนวยการ') ? 0 : 1;
              const pb = (b.position || '').startsWith('ผู้อำนวยการ') && !(b.position || '').startsWith('รองผู้อำนวยการ') ? 0 : 1;
              if (pa !== pb) return pa - pb;
            }
            return staffNo(a) - staffNo(b) || (a.id - b.id);
          });
        } else {
          // สถานศึกษา: เรียงตามรหัสสถานศึกษา (น้อยขึ้นก่อน) แล้วตามตำแหน่ง ผอ.→รอง ผอ.→ครู→เจ้าหน้าที่ธุรการ
          const schoolCode = (u) => { const m = (u.workplace || '').match(/^(\d{8})/); return m ? m[1] : '99999999'; };
          const posRank = (p) => {
            const s = p || '';
            if (s.startsWith('ผู้อำนวยการสถานศึกษา')) return 0;
            if (s.startsWith('รองผู้อำนวยการ')) return 1;
            if (s.startsWith('ครู')) return 2;
            if (s.startsWith('เจ้าหน้าที่ธุรการ')) return 3;
            return 4;
          };
          rows.sort((a, b) => schoolCode(a).localeCompare(schoolCode(b)) || posRank(a.position) - posRank(b.position) || (a.id - b.id));
        }
        rows.forEach((u, i) => { u._seq = i + 1; });
        const cols = [
          { key: '_seq', label: 'ที่', render: (u) => UI.h('div', { style: { fontWeight: 400, color: 'var(--muted)' } }, String(u._seq)) },
          {
            key: 'full_name', label: 'ชื่อ-นามสกุล',
            render: (u) => UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
              u.photo
                ? UI.h('img', { src: '/uploads/' + UI.encodePath(u.photo), style: { width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' } })
                : UI.h('div', { style: { width: '32px', height: '32px', borderRadius: '50%', background: 'var(--primary-light)', color: 'var(--primary-deep)', display: 'grid', placeItems: 'center', fontWeight: 700 } }, (u.first_name || u.full_name || '?').charAt(0)),
              UI.h('div', {},
                UI.h('div', {}, UI.personName(u)))),
          },
          { key: 'position', label: 'ตำแหน่ง', render: (u) => UI.h('div', {}, u.position || '-') },
          { key: 'workplace', label: 'กลุ่มงาน', render: (u) => UI.h('div', {}, u.workplace || '-') },
          { key: 'role', label: 'สิทธิ์', render: (u) => UI.h('span', { className: 'badge ' + (u.role === 'admin' ? 'badge-admin' : 'badge-member') }, CONSTANTS.roleLabel(u.role)) },
          { key: 'can_approve', label: 'สิทธิ์อนุมัติ', render: (u) => u.can_approve ? UI.h('span', { className: 'badge badge-active' }, '● อนุมัติได้') : UI.h('span', { className: 'hint' }, '—') },
          { key: 'status', label: 'สถานะ', render: (u) => UI.badge(u.status) },
          {
            key: 'actions', label: 'จัดการ',
            render: (u) => UI.h('div', { className: 'status-btns' },
              UI.actionBtn('👁️', () => StaffView.openDetail(u)),
              UI.actionBtn('✎', () => StaffView.editStaff(u)),
              UI.actionBtn('⊛ สิทธิ์', () => StaffView.setRole(u)),
              UI.actionBtn(u.can_approve ? '🚫 ถอนสิทธิ์อนุมัติ' : '● ให้สิทธิ์อนุมัติ', () => StaffView.toggleApprove(u)),
              UI.actionBtn('⊙', () => StaffView.resetPass(u), ''),
              u.status === 'active'
                ? UI.actionBtn('⏸ ระงับ', () => StaffView.setStatus(u, 'inactive'), 'danger-btn')
                : (u.status !== 'pending' ? UI.actionBtn('▶ เปิดใช้', () => StaffView.setStatus(u, 'active')) : null),
              UI.actionBtn('✕', () => StaffView.remove(u), 'danger-btn')),
          },
        ];
        const tw = UI.table(cols, rows);
        tw.querySelector('table').classList.add('staff-grid');
        card.append(tw);
      } catch (e) {
        card.innerHTML = '';
        card.append(UI.empty(e.message, '⚠️'));
      }
    }
    load();
  },

  async renderSimDate(content) {
    const card = UI.h('div', { className: 'card' }, UI.loading());
    content.append(card);
    let data;
    try {
      data = await API.get('/sim-date');
    } catch (e) {
      card.innerHTML = '';
      card.append(UI.empty(e.message, '⚠️'));
      return;
    }
    card.innerHTML = '';
    card.append(UI.h('div', { className: 'card-title' }, '⏱ โหมดจำลองวันที่ (ทดสอบการเปลี่ยนปี พ.ศ.)'));
    const active = !!data.sim_today;
    card.append(UI.h('div', { style: { padding: '10px 14px', background: active ? '#fff7e0' : '#eef6ee', border: '1px solid ' + (active ? '#f0d98c' : '#cfe6cf'), borderRadius: '10px', marginBottom: '14px' } },
      active
        ? UI.h('div', {},
            UI.h('b', {}, '🟠 เปิดโหมดจำลองอยู่ — ระบบถือว่า "วันนี้" คือ ' + UI.thaiDate(data.sim_today)),
            UI.h('div', { className: 'hint', style: { marginTop: '6px' } }, 'วันจริงของเครื่อง: ' + UI.thaiDate(data.real_today) + ' • ระบบทั้งหมด (เลขที่หนังสือ ปีงบประมาณ การลา ลงเวลา) ใช้วันที่จำลองนี้เป็น "วันนี้"'))
        : UI.h('div', {},
            UI.h('b', {}, '🟢 ปิดโหมดจำลอง — ใช้เวลาจริงของเครื่อง (' + UI.thaiDate(data.real_today) + ')'),
            UI.h('div', { className: 'hint', style: { simulation: 'none', marginTop: '6px' } }, 'เหมาะกับการใช้งานจริงทั่วไป'))));
    const yearBE = new Date().getFullYear() + 543;
    const quick = UI.h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '10px 0' } },
      [1, 2, 3].map((n) => {
        const d = new Date(); d.setDate(d.getDate() + n);
        return UI.h('button', { className: 'btn btn-outline btn-sm', onclick: () => StaffView.saveSimDate(fmtLocal(d)) }, '+' + n + ' วัน (' + UI.thaiDate(fmtLocal(d)) + ')');
      }));
    card.append(UI.h('div', { className: 'form-grid' },
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ตั้งวันที่จำลอง (วันที่ ค.ศ. เช่น 2027-01-01)'),
        UI.thaiDateInput('sim-date-input', { value: data.sim_today || '', placeholder: 'วว/ดด/ปปปป (พ.ศ.)' })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ตัวเลือกด่วน'),
        quick)));
    card.append(UI.h('div', { className: 'form-actions', style: { marginTop: '10px' } },
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '▽ บันทึกและเริ่มจำลอง'),
      !active ? null : UI.h('button', { className: 'btn btn-outline', style: { marginLeft: '8px' }, onclick: () => StaffView.saveSimDate(null) }, '⏹ ปิดโหมดจำลอง — กลับสู่เวลาจริง')));

    function fmtLocal(d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    async function save() {
      const el = document.getElementById('sim-date-input');
      const iso = UI.readThaiDateInput ? UI.readThaiDateInput('sim-date-input') : '';
      if (!iso) return UI.toast('กรุณาเลือกวันที่จำลอง', 'error');
      await StaffView.saveSimDate(iso);
    }
  },

  async saveSimDate(dateStr) {
    try {
      const res = await API.put('/sim-date', { date: dateStr });
      UI.toast(res.message);
      if (window.__SIM_DATE) await window.__SIM_DATE.refresh();
      const content = document.getElementById('s-content');
      if (content) StaffView.renderSimDate(content);
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  async renderSettings(content) {
    const card = UI.h('div', { className: 'card' }, UI.loading());
    content.append(card);
    let data;
    try {
      data = await API.get('/settings/approvals');
    } catch (e) {
      card.innerHTML = '';
      card.append(UI.empty(e.message, '⚠️'));
      return;
    }
    card.innerHTML = '';
    card.append(UI.h('div', { className: 'card-title' }, '⊛ จำนวนขั้นตอนการอนุมัติของแต่ละระบบ'));
    card.append(UI.h('p', { className: 'hint', style: { marginBottom: '14px' } },
      'กำหนดว่าคำขอแต่ละประเภทต้องผ่านการอนุมัติกี่ขั้น (1-3 ขั้น) ก่อนจะถือว่าอนุมัติอย่างเป็นทางการ — ' +
      'ขั้นที่ 1 (ขั้นต้น): ผู้อำนวยการกลุ่ม/หน่วย • ขั้นที่ 2 (ขั้นกลาง): รองผู้อำนวยการ • ขั้นที่ 3 (ขั้นสูง): ผู้อำนวยการ สพป.แพร่ เขต 2'));
    const sys = [
      ['approval_vehicle', '▣ การจองยานพาหนะ'],
      ['approval_room', '⬡ การจองห้องประชุม'],
      ['approval_travel', '✈ การขออนุญาตไปราชการ'],
      ['approval_leave', '❋ การขออนุญาตลา'],
    ];
    const grid = UI.h('div', { className: 'form-grid' });
    for (const [key, label] of sys) {
      grid.append(UI.h('div', { className: 'form-group' },
        UI.h('label', {}, label),
        UI.h('select', { id: 'as-' + key },
          [1, 2, 3].map((n) => UI.h('option', { value: n, selected: Number(data.settings[key]) === n }, `${n} ขั้น`)))));
    }
    card.append(grid);
    card.append(UI.h('div', { className: 'form-actions', style: { marginTop: '14px' } },
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '▽ บันทึกการตั้งค่า')));

    async function save() {
      const body = {};
      for (const [key] of sys) body[key] = parseInt(document.getElementById('as-' + key).value, 10) || 1;
      try {
        const res = await API.put('/settings/approvals', body);
        UI.toast(res.message);
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  async openDetail(u) {
    let full;
    try {
      full = (await API.get('/staff/' + u.id)).user;
    } catch (e) {
      return UI.toast(e.message, 'error');
    }
    const body = UI.h('div', {},
      UI.h('div', { style: { display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' } },
        full.photo
          ? UI.h('img', { className: 'profile-photo', src: '/uploads/' + UI.encodePath(full.photo) })
          : UI.h('div', { className: 'profile-photo', style: { display: 'grid', placeItems: 'center', fontSize: '32px', background: 'var(--primary-light)', color: 'var(--primary-deep)' } }, (full.first_name || full.full_name || '?').charAt(0)),
        UI.h('div', {},
          UI.h('div', { style: { fontSize: '18px', fontWeight: 800 } }, UI.personName(full)),
          UI.h('div', { className: 'hint' }, `@${full.username} • ${CONSTANTS.roleLabel(full.role)}`),
          UI.h('div', { style: { marginTop: '4px', display: 'flex', gap: '6px', flexWrap: 'wrap' } },
            UI.badge(full.status),
            full.can_approve ? UI.h('span', { className: 'badge badge-active' }, '● มีสิทธิ์อนุมัติ') : null)),
      ),
      UI.h('div', { className: 'form-grid' },
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'เลขบัตรประชาชน'), UI.h('div', {}, full.citizen_id || '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ลำดับเจ้าหน้าที่'), UI.h('div', {}, full.staff_no || '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ชื่อเล่น'), UI.h('div', {}, full.nickname || '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'กรุ๊ปเลือด'), UI.h('div', {}, full.blood_type || '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ตำแหน่ง'), UI.h('div', {}, full.position || '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'วิทยฐานะ/ระดับ'), UI.h('div', {}, full.academic_rank || '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'กลุ่มงาน'), UI.h('div', {}, full.workplace || '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'วุฒิการศึกษาสูงสุด'), UI.h('div', {}, full.highest_education || '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'วัน/เดือน/ปี เกิด'), UI.h('div', {}, full.birth_date ? `${UI.thaiDate(full.birth_date)}${UI.ageFromBirth(full.birth_date) ? ' (อายุ ' + UI.ageFromBirth(full.birth_date) + ' ปี)' : ''}` : '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'โทรศัพท์'), UI.h('div', {}, full.phone || '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'อีเมล'), UI.h('div', {}, full.email || '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'Telegram Chat ID'), UI.h('div', {}, full.telegram_chat_id ? `@${full.telegram_chat_id}` : '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'สมัครเมื่อ'), UI.h('div', {}, UI.date(full.created_at))),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'อนุมัติเมื่อ'), UI.h('div', {}, full.approved_at ? UI.date(full.approved_at) : '-')),
        UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'ลายเซ็น'),
          full.signature ? UI.h('img', { className: 'signature-img', src: '/uploads/' + UI.encodePath(full.signature) }) : UI.h('span', { className: 'hint' }, '-')),
      ),
    );
    UI.modal({ title: '👁️ ข้อมูลเจ้าหน้าที่', body, size: 'lg' });
  },

  /** แก้ไขข้อมูลสมาชิกโดย admin */
  editStaff(u) {
    const isSchool = u.user_group === 'school';
    const posList = isSchool ? CONSTANTS.SCHOOL_POSITIONS : CONSTANTS.POSITIONS;
    const rankList = isSchool ? CONSTANTS.SCHOOL_ACADEMIC_RANKS : CONSTANTS.ACADEMIC_RANKS;
    const workLabel = isSchool ? 'สถานศึกษา' : 'สังกัด/กลุ่มงาน';
    const body = UI.h('div', { className: 'form-grid' },
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'เลขบัตรประชาชน 13 หลัก', UI.h('span', { className: 'req' }, ' *')),
        UI.h('input', { id: 'ed-cid', type: 'text', inputmode: 'numeric', maxlength: '13', value: u.citizen_id || '' })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ลำดับเจ้าหน้าที่'),
        UI.h('input', { id: 'ed-staffno', type: 'text', placeholder: 'เช่น 001, 002 ... (ไม่บังคับ)', value: u.staff_no || '' }),
        UI.h('div', { className: 'hint' }, 'ใช้สำหรับจัดเรียงในบางเมนู — ใส่หรือไม่ใส่ก็ได้')),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'คำนำหน้า'), UI.h('select', { id: 'ed-title' }, CONSTANTS.selectOptions(CONSTANTS.TITLES, u.title || 'นาย'))),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ชื่อ', UI.h('span', { className: 'req' }, ' *')), UI.h('input', { id: 'ed-fname', value: u.first_name || '' })),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'นามสกุล', UI.h('span', { className: 'req' }, ' *')), UI.h('input', { id: 'ed-lname', value: u.last_name || '' })),
      UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'ตำแหน่ง'), UI.h('select', { id: 'ed-pos' }, CONSTANTS.selectOptions(posList, u.position || ''))),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'วิทยฐานะ/ระดับ'), UI.h('select', { id: 'ed-rank' }, CONSTANTS.selectOptions(rankList, u.academic_rank || 'ไม่มี'))),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, workLabel), UI.h('select', { id: 'ed-work' }, [])),
      isSchool ? UI.h('div', { className: 'form-group full', id: 'ed-multi-school-wrap' },
        UI.h('button', { type: 'button', className: 'btn btn-sm btn-outline', style: { fontSize: '13px' }, onclick: () => {
          const container = document.getElementById('ed-multi-schools');
          const idx = container.children.length;
          if (idx >= 5) return;
          const row = UI.h('div', { className: 'form-group', style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' } },
            UI.h('span', { style: { fontSize: '14px', minWidth: '20px' } }, String(idx + 1) + '.'),
            UI.h('select', { id: 'ed-work-' + idx, style: { flex: 1 } }, []),
            UI.h('button', { type: 'button', className: 'btn btn-sm', style: { color: '#e53e3e', background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }, onclick: (e) => { e.target.closest('div.form-group').remove(); } }, '✕'));
          container.append(row);
          (async () => {
            try {
              const data = await API.get('/schools');
              const schools = (data.schools || []).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
              const sel = document.getElementById('ed-work-' + idx);
              if (sel) {
                sel.innerHTML = '';
                sel.append(UI.h('option', { value: '' }, '-- เลือกสถานศึกษาเพิ่มเติม --'));
                schools.forEach(s => {
                  const label = s.code ? s.code + ' ' + s.name : s.name;
                  sel.append(UI.h('option', { value: label }, label));
                });
              }
            } catch (_e) {}
          })();
        } }, '📍 ปฏิบัติงานหลายแห่ง'),
        UI.h('div', { id: 'ed-multi-schools', style: { marginTop: '8px' } })) : null,
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ชื่อเล่น'), UI.h('input', { id: 'ed-nick', value: u.nickname || '' })),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'กรุ๊ปเลือด'), UI.h('select', { id: 'ed-blood' }, CONSTANTS.selectOptions(CONSTANTS.BLOOD_TYPES, u.blood_type || 'ไม่ทราบ'))),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'วุฒิการศึกษาสูงสุด'), UI.h('input', { id: 'ed-edu', value: u.highest_education || '' })),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'วัน/เดือน/ปี เกิด (พ.ศ.)'), UI.thaiBirthPicker('ed-birth', u.birth_date || '')),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'อายุ (ปี)'), UI.h('input', { id: 'ed-age', type: 'text', readonly: true, value: UI.ageFromBirth(u.birth_date) || '' })),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'เบอร์โทรศัพท์'), UI.h('input', { id: 'ed-phone', value: u.phone || '' })),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'อีเมล'), UI.h('input', { id: 'ed-email', value: u.email || '' })),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'Telegram Token Key'), UI.h('input', { id: 'ed-tgtok', value: u.telegram_token || '' })),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'Telegram Chat ID'), UI.h('input', { id: 'ed-tgcid', value: u.telegram_chat_id || '' })),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'สิทธิ์การใช้งาน'), UI.h('select', { id: 'ed-role' },
        (isSchool ? CONSTANTS.ROLES.filter(r => ['admin', 'school_staff'].includes(r.value)) : CONSTANTS.ROLES.filter(r => r.value !== 'school_staff')).
          map((r) => UI.h('option', { value: r.value, selected: u.role === r.value }, `${r.icon} ${r.label}`)))),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'สิทธิ์อนุมัติคำขอ'),
        UI.h('select', { id: 'ed-approve' },
          UI.h('option', { value: '0', selected: !u.can_approve }, 'ไม่มีสิทธิ์อนุมัติ'),
          UI.h('option', { value: '1', selected: !!u.can_approve }, '● อนุมัติได้ตามบทบาท'))),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'รูปถ่าย (เปลี่ยนใหม่)', u.photo ? null : UI.h('span', { className: 'req' }, ' *')),
        UI.h('div', { className: 'file-preview' },
          u.photo ? UI.h('img', { className: 'preview-thumb', src: '/uploads/' + UI.encodePath(u.photo), alt: 'รูปปัจจุบัน' }) : null),
        UI.h('input', { id: 'ed-photo', type: 'file', accept: 'image/*' }),
        UI.h('div', { className: 'hint' }, u.photo ? 'รูปปัจจุบันแสดงด้านบน — เลือกไฟล์เพื่อแทนที่' : 'ไฟล์ภาพ (jpg, png)')
      ),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ลายเซ็น (เปลี่ยนใหม่)', u.signature ? null : UI.h('span', { className: 'req' }, ' *')),
        UI.h('div', { className: 'file-preview' },
          u.signature ? UI.h('img', { className: 'preview-thumb', src: '/uploads/' + UI.encodePath(u.signature), alt: 'ลายเซ็นปัจจุบัน' }) : null),
        UI.h('input', { id: 'ed-sig', type: 'file', accept: 'image/*' }),
        UI.h('div', { className: 'hint' }, u.signature ? 'ลายเซ็นปัจจุบันแสดงด้านบน — เลือกไฟล์เพื่อแทนที่' : 'ไฟล์ภาพ (jpg, png)')
      ),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '▽ บันทึกข้อมูล'));
    const m = UI.modal({ title: '✎ แก้ไขข้อมูลเจ้าหน้าที่', body, footer: foot, size: 'lg' });

    // โหลดรายชื่อโรงเรียนสำหรับเจ้าหน้าที่สถานศึกษา
    if (isSchool) {
      (async () => {
        try {
          const data = await API.get('/schools');
          const schools = (data.schools || []).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
          const sel = document.getElementById('ed-work');
          if (sel) {
            sel.innerHTML = '';
            sel.append(UI.h('option', { value: '' }, '-- เลือกสถานศึกษา --'));
            schools.forEach(s => {
              const label = s.code ? s.code + ' ' + s.name : s.name;
              const isSelected = u.workplace && (u.workplace === label || u.workplace === s.name || label.endsWith(u.workplace));
              sel.append(UI.h('option', { value: label, selected: isSelected }, label));
            });
          }
          // โหลดสถานศึกษาเพิ่มเติมที่บันทึกไว้
          let extra = [];
          try { extra = JSON.parse(u.workplace_secondary || '[]'); } catch (_e) {}
          if (extra.length > 0) {
            const container = document.getElementById('ed-multi-schools');
            if (container) {
              extra.forEach((val, idx) => {
                const row = UI.h('div', { className: 'form-group', style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' } },
                  UI.h('span', { style: { fontSize: '14px', minWidth: '20px' } }, String(idx + 1) + '.'),
                  UI.h('select', { id: 'ed-work-' + idx, style: { flex: 1 } }, []),
                  UI.h('button', { type: 'button', className: 'btn btn-sm', style: { color: '#e53e3e', background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }, onclick: (e) => { e.target.closest('div.form-group').remove(); } }, '✕'));
                container.append(row);
                schools.forEach(s => {
                  const label = s.code ? s.code + ' ' + s.name : s.name;
                  const isSelected = val === label || val === s.name || label.endsWith(val);
                  document.getElementById('ed-work-' + idx).append(UI.h('option', { value: label, selected: isSelected }, label));
                });
              });
            }
          }
        } catch (e) { /* ignore */ }
      })();
    } else {
      const sel = document.getElementById('ed-work');
      if (sel) {
        CONSTANTS.WORKPLACES.forEach(name => sel.append(UI.h('option', { value: name, selected: name === u.workplace }, name)));
      }
    }

    // preview ไฟล์ใหม่ที่เลือก
    for (const inpId of ['ed-photo', 'ed-sig']) {
      document.getElementById(inpId).addEventListener('change', (e) => {
        const wrap = e.target.parentElement;
        const box = wrap.querySelector('.file-preview');
        box.innerHTML = '';
        if (e.target.files[0]) box.append(UI.h('img', { className: 'preview-thumb', src: URL.createObjectURL(e.target.files[0]), alt: 'preview' }));
        else if (inpId === 'ed-photo' && u.photo) box.append(UI.h('img', { className: 'preview-thumb', src: '/uploads/' + UI.encodePath(u.photo), alt: 'รูปปัจจุบัน' }));
        else if (inpId === 'ed-sig' && u.signature) box.append(UI.h('img', { className: 'preview-thumb', src: '/uploads/' + UI.encodePath(u.signature), alt: 'ลายเซ็นปัจจุบัน' }));
      });
    }

    // คำนวณอายุแบบ realtime ใน modal แก้ไข (เลือก วัน/เดือน/ปี พ.ศ.)
    const calcEditAge = () => {
      const v = UI.readThaiBirth('ed-birth');
      document.getElementById('ed-age').value = v ? UI.ageFromBirth(v) : '';
    };
    for (const id of ['ed-birth-day', 'ed-birth-month', 'ed-birth-year']) {
      document.getElementById(id).addEventListener('change', calcEditAge);
    }

    async function save() {
      const get = (id) => document.getElementById(id).value;
      const fd = new FormData();
      const fields = {
        citizen_id: get('ed-cid').trim(),
        staff_no: get('ed-staffno').trim(),
        title: get('ed-title'),
        first_name: get('ed-fname').trim(),
        last_name: get('ed-lname').trim(),
        position: get('ed-pos'),
        academic_rank: get('ed-rank'),
        workplace: get('ed-work'),
        nickname: get('ed-nick').trim(),
        blood_type: get('ed-blood'),
        highest_education: get('ed-edu').trim(),
        birth_date: UI.readThaiBirth('ed-birth') || '',
        phone: get('ed-phone').trim(),
        email: get('ed-email').trim(),
        telegram_token: get('ed-tgtok').trim(),
        telegram_chat_id: get('ed-tgcid').trim(),
        role: get('ed-role'),
        can_approve: get('ed-approve') === '1' ? '1' : '0',
      };
      // เก็บสถานศึกษาเพิ่มเติม (ถ้ามี)
      if (isSchool) {
        const extraSchools = [];
        for (let i = 0; i < 5; i++) {
          const el = document.getElementById('ed-work-' + i);
          if (el && el.value) extraSchools.push(el.value);
        }
        fields.workplace_secondary = JSON.stringify(extraSchools);
      }
      if (!fields.citizen_id || !fields.first_name || !fields.last_name) return UI.toast('กรุณากรอกเลขบัตร ชื่อ และนามสกุลให้ครบถ้วน', 'error');
      if (fields.citizen_id.length !== 13) return UI.toast('เลขบัตรประชาชนต้องเป็น 13 หลัก', 'error');
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      const photoFile = document.getElementById('ed-photo').files[0];
      if (photoFile) fd.append('photo', photoFile);
      const sigFile = document.getElementById('ed-sig').files[0];
      if (sigFile) fd.append('signature', sigFile);
      try {
        const res = await API.putForm(`/staff/${u.id}`, fd);
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  async setStatus(u, status) {
    const labels = { active: 'เปิดใช้งาน/อนุมัติ', inactive: 'ระงับการใช้งาน', rejected: 'ปฏิเสธ' };
    const ok = await UI.confirm(`ต้องการ${labels[status]}บัญชี "${UI.personName(u)}" ใช่หรือไม่?`, { okText: labels[status], danger: status !== 'active' });
    if (!ok) return;
    try {
      const res = await API.put(`/staff/${u.id}/status`, { status });
      UI.toast(res.message);
      render();
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  /** กำหนดสิทธิ์ 5 ระดับ */
  setRole(u) {
    const body = UI.h('div', {},
      UI.h('p', { style: { marginBottom: '12px', fontWeight: 600 } }, `กำหนดสิทธิ์การใช้งานให้ "${UI.personName(u)}"`),
      UI.h('select', { id: 'rl-role', style: { width: '100%', marginBottom: '12px' } },
        CONSTANTS.ROLES.map((r) => UI.h('option', { value: r.value, selected: u.role === r.value }, `${r.icon} ${r.label}`))),
      UI.h('div', { id: 'rl-desc', className: 'hint', style: { minHeight: '40px' } }, StaffView.roleDesc(u.role)),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '▽ บันทึกสิทธิ์'));
    const m = UI.modal({ title: '⊛ กำหนดสิทธิ์การใช้งาน', body, footer: foot });
    document.getElementById('rl-role').addEventListener('change', (e) => {
      document.getElementById('rl-desc').textContent = StaffView.roleDesc(e.target.value);
    });

    async function save() {
      const role = document.getElementById('rl-role').value;
      try {
        const res = await API.put(`/staff/${u.id}/role`, { role });
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  roleDesc(role) {
    const r = CONSTANTS.ROLES.find((x) => x.value === role);
    return r ? `${r.icon} ${r.label} — ${r.desc}` : '';
  },

  async toggleApprove(u) {
    const next = !u.can_approve;
    const ok = await UI.confirm(
      next
        ? `ให้สิทธิ์ "${UI.personName(u)}" อนุมัติคำขอตามบทบาท (${CONSTANTS.roleLabel(u.role)}) ใช่หรือไม่?`
        : `ถอนสิทธิ์การอนุมัติของ "${UI.personName(u)}" ใช่หรือไม่?`,
      { okText: next ? 'ให้สิทธิ์' : 'ถอนสิทธิ์', danger: !next });
    if (!ok) return;
    try {
      const res = await API.put(`/staff/${u.id}/approve`, { can_approve: next });
      UI.toast(res.message);
      render();
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  resetPass(u) {
    const body = UI.h('div', {},
      UI.h('p', { style: { marginBottom: '12px' } }, `ตั้งรหัสผ่านใหม่ให้ "${UI.personName(u)}"`),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ชื่อผู้ใช้ (Username)'),
        UI.h('input', { id: 'rp-username', value: u.username || '', placeholder: 'ตัวอักษร ตัวเลข _ . - (3-30 ตัว)' })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'รหัสผ่านใหม่'),
        UI.h('input', { id: 'rp-pass', type: 'text', placeholder: 'อย่างน้อย 8 ตัวอักษร มีตัวพิมพ์ใหญ่ ตัวเลข อักขระพิเศษ' })),
      UI.h('div', { className: 'hint' }, 'ผู้ใช้จะต้องเข้าสู่ระบบใหม่ด้วยชื่อผู้ใช้/รหัสผ่านนี้'),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '⊙ ตั้งรหัสใหม่'));
    const m = UI.modal({ title: '⊙ ตั้งรหัสผ่านใหม่', body, footer: foot });

    async function save() {
      const pass = document.getElementById('rp-pass').value;
      const uname = document.getElementById('rp-username').value.trim();
      if (!pass) return UI.toast('กรุณากรอกรหัสผ่านใหม่', 'error');
      if (!uname) return UI.toast('กรุณากรอกชื่อผู้ใช้', 'error');
      try {
        const res = await API.post(`/staff/${u.id}/reset-password`, { new_password: pass, username: uname });
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  async remove(u) {
    const ok = await UI.confirm(`ต้องการลบบัญชี "${UI.personName(u)}" ออกจากระบบ ใช่หรือไม่? (ข้อมูลส่วนตัวจะถูกลบถาวร)`, { danger: true, okText: 'ลบ' });
    if (!ok) return;
    try {
      const res = await API.del('/staff/' + u.id);
      UI.toast(res.message);
      render();
    } catch (e) { UI.toast(e.message, 'error'); }
  },
};
