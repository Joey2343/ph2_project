'use strict';
/* เมนู 7: ขออนุญาตไปราชการ — แบบฟอร์มราชการ */

const TravelView = {
  vehicles: [],
  travelApprovers: {},
  travelApproversSchool: {},

  /** ตรวจสอบสิทธิ์อนุมัติโดยใช้ travel_approvers (สาย สพป.) / travel_approvers_school (สายสถานศึกษา 3 ขั้น) */
  canApproveTravel(r) {
    if (!Auth.isLoggedIn() || !r || r.status !== 'pending') return false;
    const u = Auth.user;
    if (u.role === 'admin') return true;
    if (!u.can_approve) return false;
    const next = UI.approvalDone(r) + 1;
    // เจ้าหน้าที่สถานศึกษาใช้สาย 3 ขั้น: ผู้ตรวจสอบ → ผู้บังคับบัญชาขั้นต้น → ผู้อนุมัติ (ทุกขั้นเป็นเจ้าหน้าที่ สพป.แพร่ เขต 2)
    const isSchoolReq = (r.user_group || (String(r.school_code || '') === '54020000' ? 'office' : 'school')) === 'school';
    const entry = isSchoolReq ? (TravelView.travelApproversSchool || {})[String(r.user_id)] : TravelView.travelApprovers[String(r.user_id)];
    if (!entry) return false;
    if (isSchoolReq) {
      if (next === 1) return Number(entry.reviewer) === u.id;
      if (next === 2) return Number(entry.supervisor) === u.id;
      if (next === 3) return Number(entry.approver) === u.id;
      return false;
    }
    if (next === 1) return Number(entry.supervisor) === u.id;
    if (next === 2) return Number(entry.approver) === u.id;
    return false;
  },

  /** ตรวจสอบสิทธิ์พิจารณา (อนุมัติ/ไม่อนุมัติ) สำหรับ travel */
  canDecideTravel(r) {
    if (!Auth.isLoggedIn() || !r || r.status !== 'pending') return false;
    if (Auth.isAdmin()) return true;
    return TravelView.canApproveTravel(r);
  },

  async render(app, scope) {
    // จำ scope ปัจจุบันไว้ — การเรียก render ซ้ำหลัง action (โดยไม่ส่ง scope) ต้องอยู่หน้าเดิม
    if (scope) TravelView._scope = scope;
    scope = scope || TravelView._scope || 'office';
    app.innerHTML = '';
    // แยกหน้าตามกลุ่มผู้ใช้: scope='office' → เจ้าหน้าที่ สพป.แพร่ เขต 2 | scope='school' → เจ้าหน้าที่สถานศึกษา (และผู้ตรวจสอบ สพป.)
    const isSchoolScope = scope === 'school';
    const groupParam = isSchoolScope ? 'school' : 'office';
    const pageTitle = isSchoolScope ? 'ขออนุมัติ/อนุญาตเดินทางไปราชการ (สถานศึกษา)' : 'ขออนุมัติ/อนุญาตเดินทางไปราชการ';
    const head = UI.h('div', { className: 'page-head' },
      UI.h('div', {},
        UI.h('div', { className: 'page-title' }, UI.h('span', { className: 'pi' }, '✈'), pageTitle),
        UI.h('div', { className: 'page-desc' }, 'ยื่นคำขอเดินทางไปราชการ รอผู้อนุมัติ')),
      // หน้าสถานศึกษา: ซ่อนปุ่มยื่นคำขอเมื่อผู้ใช้เป็นฝ่าย สพป. (ผู้ตรวจสอบ — มีหน้าที่ตรวจสอบเท่านั้น)
      (!isSchoolScope || (Auth.user && (Auth.user.user_group === 'school' || Auth.user.role === 'admin')))
        ? UI.h('button', { className: 'btn btn-primary', onclick: () => TravelView.openForm() }, '✈ ยื่นคำขอไปราชการ')
        : null,
    );
    app.append(head);

    const now = new Date(); const curYear = now.getFullYear() + 543;
    const yearSel = UI.h('select', { id: 'trv-year', onchange: () => load() },
      UI.h('option', { value: curYear }, curYear),
      UI.h('option', { value: curYear - 1 }, curYear - 1),
      UI.h('option', { value: '' }, 'ทุกปี'));
    const filterRow = UI.h('div', { className: 'filter-row', style: { display: 'flex', alignItems: 'center', gap: '10px' } },
      UI.h('select', { id: 'trv-status', onchange: () => load() },
        UI.h('option', { value: '' }, 'ทุกสถานะ'),
        UI.h('option', { value: 'pending' }, 'รออนุมัติ'),
        UI.h('option', { value: 'approved' }, 'อนุมัติแล้ว'),
        UI.h('option', { value: 'rejected' }, 'ไม่อนุมัติ'),
        UI.h('option', { value: 'cancelled' }, 'ยกเลิก')),
      yearSel,
    );
    const isAdmin = Auth.isAdmin();
    filterRow.append(UI.h('button', { className: 'btn btn-primary', style: { background: '#059669', marginLeft: 'auto' }, title: 'ดาวน์โหลดข้อมูลเป็นไฟล์ Excel ตามตัวกรอง', onclick: () => TravelView.openExportDialog(isSchoolScope, pageTitle) }, '⬇ ดาวน์โหลดข้อมูล'));
    if (isAdmin) {
      filterRow.append(UI.h('button', { className: 'btn btn-primary', style: { fontSize: '13px' }, onclick: () => TravelView.openApproverSettings() }, '⊛ กำหนดผู้อนุมัติ'));
    }
    app.append(filterRow);
    const card = UI.h('div', { className: 'card' }, UI.loading());
    app.append(card);

    async function load() {
      const status = document.getElementById('trv-status').value;
      const year = document.getElementById('trv-year').value;
      const params = [];
      if (status) params.push('status=' + UI.encodePath(status));
      if (year) params.push('year=' + year);
      const url = '/travel' + (params.length ? '?' + params.join('&') + '&' : '?') + 'group=' + groupParam;
      try {
        const data = await API.get(url);
        TravelView.travelApprovers = data.travelApprovers || {};
        TravelView.travelApproversSchool = data.travelApproversSchool || {};
        card.innerHTML = '';
        card.append(UI.h('div', { className: 'card-title' }, `▭ รายการขออนุมัติ/อนุญาตเดินทางไปราชการ (${data.requests.length} รายการ)`));
        if (!data.requests.length) {
          card.append(UI.empty('ยังไม่มีรายการ', '✈'));
          return;
        }
        const cols = [
          { key: 'travel_no', label: 'เลขที่คำขอ' },
          { key: 'title', label: 'เรื่อง' },
          { key: 'destination', label: 'สถานที่' },
          { key: 'date', label: 'วันเดินทาง', render: (r) => `${UI.date(r.date_from)} ถึง ${UI.date(r.date_to)}` },
          { key: 'days', label: 'จำนวนวัน', className: 'num' },
          { key: 'status', label: 'สถานะ', render: (r) => UI.h('div', {}, UI.badge(r.status)) },
          { key: 'attachment', label: 'เอกสารแนบ', render: (r) => { let fd = {}; try { fd = typeof r.form_data === 'string' ? JSON.parse(r.form_data) : (r.form_data || {}); } catch (_e) {} return fd.attachment ? UI.h('a', { href: '/uploads/' + UI.encodePath(fd.attachment), target: '_blank', style: { color: '#2563eb', textDecoration: 'underline' }, onclick: (e) => e.stopPropagation() }, '✈ ดูเอกสาร') : UI.h('span', { style: { color: '#9ca3af' } }, '-'); } },
          {
            key: 'actions', label: '',
            render: (r) => {
              const btns = [UI.actionBtn('👁️', () => TravelView.openView(r))];
              // ปุ่มอนุมัติ/ไม่อนุมัติ ตามสิทธิ์ (ใช้ travel_approvers mapping)
              if (TravelView.canApproveTravel(r)) {
                const next = UI.approvalDone(r) + 1;
                const isSchoolReq = (r.user_group || (String(r.school_code || '') === '54020000' ? 'office' : 'school')) === 'school';
                // สายสถานศึกษา ขั้นที่ 1 = ผู้ตรวจสอบ → ปุ่ม ตรวจสอบ (ผ่านเรื่องให้ผู้บังคับบัญชาขั้นต้น ขั้นที่ 2)
                const btnLabel = (isSchoolReq && next === 1) ? '⊙ ตรวจสอบ' : (next === 1 ? '● ควรอนุมัติ/อนุญาต' : '● อนุมัติ/อนุญาต');
                btns.push(UI.actionBtn(btnLabel, () => TravelView.decide(r, 'approve')));
              }

              if (Auth.isAdmin() || r.user_id === Auth.user.id) {
                btns.push(UI.actionBtn('✕', () => TravelView.remove(r), 'danger-btn'));
              }
              return UI.h('div', { className: 'status-btns' }, btns);
            },
          },
        ];
        card.append(UI.table(cols, data.requests));
      } catch (e) {
        card.innerHTML = '';
        card.append(UI.empty(e.message, '⚠️'));
      }
    }
    load();
  },

  /* ===== หน้าต่างตัวกรองดาวน์โหลด Excel (ปี พ.ศ. / เดือน / สัปดาห์) ===== */
  openExportDialog(isSchoolScope, pageTitle) {
    const STATUS_TH = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิก' };
    const nameOf = (r) => [(r.user_title || '') + (r.first_name || ''), r.last_name || ''].filter(Boolean).join(' ') || (r.full_name || '');
    ExportFilterDialog.open({
      years: [new Date().getFullYear() + 543, new Date().getFullYear() + 542],
      title: pageTitle,
      getRows: async (yBE, m, wkStart, wkEnd) => {
        const qs = [];
        if (yBE) qs.push('year=' + yBE);
        const url = '/travel' + (qs.length ? '?' + qs.join('&') + '&' : '?') + 'group=' + (isSchoolScope ? 'school' : 'office');
        const data = await API.get(url);
        let requests = ExportFilterDialog.filterRows(data.requests || [], 'date_from', yBE, m, wkStart, wkEnd);
        const headers = ['เลขที่คำขอ', 'เรื่อง', 'ผู้ขอ', 'สถานที่', 'วันเดินทาง', 'ถึงวันที่', 'จำนวนวัน', 'สถานะ'];
        const rows = requests.map((r) => [
          r.travel_no || '',
          r.title || '',
          nameOf(r),
          r.destination || '',
          r.date_from ? UI.date(r.date_from) : '',
          r.date_to ? UI.date(r.date_to) : '',
          r.days || 1,
          STATUS_TH[r.status] || r.status || '',
        ]);
        return { rows, headers, fileName: pageTitle };
      },
    });
  },

  /* ===== ฟอร์มยื่นคำขออนุญาตไปราชการ ===== */
  openForm() {
    const now = new Date();
    const buddhaYear = now.getFullYear() + 543;
    const todayThai = UI.formatThaiDate ? UI.formatThaiDate(now) : `${now.getDate()}/${now.getMonth()+1}/${buddhaYear}`;
    const userData = Auth.user || {};
    const fullName = [userData.first_name || '', userData.last_name || ''].filter(Boolean).join(' ');
    const titleName = userData.title || '';

    const wrap = UI.h('div', { style: { fontSize: '14px', lineHeight: '1.8' } });

    // === หัวข้อแบบฟอร์ม ===
    wrap.append(UI.h('div', { style: { textAlign: 'center', fontWeight: 'bold', fontSize: '16px', marginBottom: '15px', textDecoration: 'underline' } }, 'แบบขออนุมัติ/อนุญาตเดินทางไปราชการ'));

    // เขียนที่ + วันที่ (บรรทัดเดียวกัน จัดขวา)
    wrap.append(UI.h('div', { style: { textAlign: 'right', marginBottom: '5px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '5px' } },
      UI.h('span', { style: { whiteSpace: 'nowrap' } }, 'เขียนที่ '),
      UI.h('input', { id: 'tf-writing', style: { width: '350px', fontSize: '14px' }, value: 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2' }),
    ));
    wrap.append(UI.h('div', { style: { textAlign: 'right', marginBottom: '10px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '5px' } },
      UI.h('span', { style: { whiteSpace: 'nowrap' } }, 'วันที่ '),
      UI.thaiDatePicker('tf-date', { value: UI.today() }),
    ));

    // เรื่อง
    wrap.append(UI.h('div', { style: { marginBottom: '5px' } },
      UI.h('span', { style: { fontWeight: 'bold' } }, 'เรื่อง '),
      UI.h('span', {}, 'ขออนุมัติ/อนุญาตเดินทางไปราชการ'),
    ));

    // เรียน
    wrap.append(UI.h('div', { style: { marginBottom: '10px' } },
      UI.h('span', { style: { fontWeight: 'bold' } }, 'เรียน '),
      UI.h('span', {}, 'ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2'),
    ));

    // ข้าพเจ้า + ตำแหน่ง
    wrap.append(UI.h('div', { style: { marginBottom: '5px' } },
      UI.h('span', {}, 'ข้าพเจ้า '),
      UI.h('span', { style: { fontWeight: 'bold' } }, titleName + fullName),
      UI.h('span', {}, ' ตำแหน่ง '),
      UI.h('span', { style: { fontWeight: 'bold' } }, userData.position || '-'),
    ));

    // กลุ่ม/หน่วย
    wrap.append(UI.h('div', { style: { marginBottom: '5px' } },
      UI.h('span', {}, 'กลุ่ม/หน่วย '),
      UI.h('span', { style: { fontWeight: 'bold' } }, userData.department || userData.group || '-'),
    ));

    // พร้อมด้วยคณะ จำนวน ... คน
    wrap.append(UI.h('div', { style: { marginBottom: '10px' } },
      UI.h('span', {}, 'พร้อมด้วยคณะ จำนวน '),
      UI.h('input', { id: 'tf-companions', type: 'number', min: '0', value: '0', style: { width: '60px', fontSize: '14px', textAlign: 'center' } }),
      UI.h('span', {}, ' คน'),
    ));

    // === ส่วนรายละเอียด ===
    wrap.append(UI.h('div', { style: { fontWeight: 'bold', textDecoration: 'underline', marginTop: '15px', marginBottom: '5px' } }, 'มีความประสงค์ขออนุมัติ/อนุญาตเดินทางไปราชการ'));

    // เรื่อง
    wrap.append(UI.h('div', { style: { marginBottom: '5px', paddingLeft: '20px' } },
      UI.h('span', {}, 'เรื่อง '),
      UI.h('input', { id: 'tf-subject', style: { width: '500px', fontSize: '14px' }, placeholder: 'เช่น เข้าร่วมประชุมชี้แจงนโยบาย' }),
    ));

    // สถานที่
    wrap.append(UI.h('div', { style: { marginBottom: '5px', paddingLeft: '20px' } },
      UI.h('span', {}, 'สถานที่ '),
      UI.h('input', { id: 'tf-dest', style: { width: '500px', fontSize: '14px' }, placeholder: 'เช่น สำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน' }),
    ));

    // ตามหนังสือ/คำสั่งที่ + ลงวันที่
    wrap.append(UI.h('div', { style: { marginBottom: '5px', paddingLeft: '20px', display: 'flex', alignItems: 'center', flexWrap: 'nowrap', gap: '5px' } },
      UI.h('span', { style: { whiteSpace: 'nowrap' } }, 'ตามหนังสือ/คำสั่งที่ '),
      UI.h('input', { id: 'tf-order-doc', style: { width: '300px', fontSize: '14px', flexShrink: '0' }, placeholder: 'เช่น ด่วนที่สุด ที่ sb/0001' }),
      UI.h('span', { style: { whiteSpace: 'nowrap' } }, 'ลงวันที่ '),
      UI.thaiDatePicker('tf-order-date', {}),
    ));

    // ตั้งแต่วันที่ ถึงวันที่ รวม ... วัน
    wrap.append(UI.h('div', { style: { marginBottom: '10px', paddingLeft: '20px', display: 'flex', alignItems: 'center', flexWrap: 'nowrap', gap: '5px' } },
      UI.h('span', { style: { whiteSpace: 'nowrap' } }, 'ตั้งแต่วันที่ '),
      UI.thaiDatePicker('tf-from', { onChange: calcDays }),
      UI.h('span', { style: { whiteSpace: 'nowrap' } }, 'ถึงวันที่ '),
      UI.thaiDatePicker('tf-to', { onChange: calcDays }),
      UI.h('span', { style: { whiteSpace: 'nowrap' } }, 'รวมไปราชการครั้งนี้ '),
      UI.h('input', { id: 'tf-days', type: 'number', min: '1', value: '1', style: { width: '50px', fontSize: '14px', textAlign: 'center', flexShrink: '0' } }),
      UI.h('span', { style: { whiteSpace: 'nowrap' } }, 'วัน'),
    ));

    // === โดยข้าพเจ้า ===
    wrap.append(UI.h('div', { style: { fontWeight: 'bold', textDecoration: 'underline', marginTop: '10px', marginBottom: '5px' } }, 'โดยข้าพเจ้า'));

    const expenseGroup = 'tf-expense';
    const radioStyle = { width: '16px', height: '16px', flexShrink: '0' };
    wrap.append(UI.h('div', { style: { paddingLeft: '20px', marginBottom: '3px' } },
      UI.h('input', { type: 'radio', name: expenseGroup, value: 'none', id: 'exp-none', checked: true, onchange: toggleExpenseDetail, style: radioStyle }),
      UI.h('label', { for: 'exp-none', style: { marginLeft: '5px' } }, 'ไม่ขอเบิกค่าใช้จ่าย'),
    ));
    wrap.append(UI.h('div', { style: { paddingLeft: '20px', marginBottom: '3px' } },
      UI.h('input', { type: 'radio', name: expenseGroup, value: 'budget', id: 'exp-budget', onchange: toggleExpenseDetail, style: radioStyle }),
      UI.h('label', { for: 'exp-budget', style: { marginLeft: '5px' } }, 'ขอเบิกค่าใช้จ่ายตามสิทธิจากเงินงบประมาณ ค่าใช้จ่ายบริหารจัดการเขตพื้นที่การศึกษา ของ สพป.แพร่ เขต 2 ตามระเบียบกระทรวงการคลังว่าด้วยค่าใช้จ่ายในการเดินทางไปราชการ จำนวน '),
      UI.h('input', { id: 'tf-exp-budget-amount', type: 'number', step: '0.01', min: '0', value: '0', style: { width: '100px', fontSize: '14px', textAlign: 'right', verticalAlign: 'middle' } }),
      UI.h('span', {}, ' บาท'),
    ));
    wrap.append(UI.h('div', { style: { paddingLeft: '20px', marginBottom: '3px' } },
      UI.h('input', { type: 'radio', name: expenseGroup, value: 'project', id: 'exp-project', onchange: toggleExpenseDetail, style: radioStyle }),
      UI.h('label', { for: 'exp-project', style: { marginLeft: '5px' } }, 'ขอเบิกค่าใช้จ่ายตามสิทธิจากเงินที่ได้รับจัดสรรจาก '),
      UI.h('input', { id: 'tf-exp-fund-source', type: 'text', style: { width: '150px', fontSize: '14px', verticalAlign: 'middle' }, placeholder: 'แหล่งเงินทุน' }),
      UI.h('span', {}, ' โครงการ '),
      UI.h('input', { id: 'tf-exp-project', type: 'text', style: { width: '200px', fontSize: '14px', verticalAlign: 'middle' }, placeholder: 'ชื่อโครงการ' }),
      UI.h('span', {}, ' ตามระเบียบกระทรวงการคลังว่าด้วยค่าใช้จ่ายในการเดินทางไปราชการ จำนวน '),
      UI.h('input', { id: 'tf-exp-project-amount', type: 'number', step: '0.01', min: '0', value: '0', style: { width: '100px', fontSize: '14px', textAlign: 'right', verticalAlign: 'middle' } }),
      UI.h('span', {}, ' บาท'),
    ));

    function toggleExpenseDetail() {
      const val = document.querySelector('input[name="' + expenseGroup + '"]:checked').value;
      document.getElementById('exp-budget-detail').style.display = val === 'budget' ? 'block' : 'none';
      document.getElementById('exp-project-detail').style.display = val === 'project' ? 'block' : 'none';
    }

    // === ขอเบิกเฉพาะค่าใช้จ่าย ===
    wrap.append(UI.h('div', { style: { fontWeight: 'bold', textDecoration: 'underline', marginTop: '10px', marginBottom: '5px' } }, 'ขอเบิกค่าใช้จ่าย'));

    const expenseTypes = [
      { id: 'tf-exp-baht', label: 'ค่าเบี้ยเลี้ยง' },
      { id: 'tf-exp-hotel', label: 'ค่าเช่าที่พัก' },
      { id: 'tf-exp-transport', label: 'ค่าพาหนะ' },
      { id: 'tf-exp-other', label: 'ค่าใช้จ่ายอื่น' },
    ];
    const chkStyle = { width: '16px', height: '16px', flexShrink: '0', verticalAlign: 'middle' };
    for (const et of expenseTypes) {
      wrap.append(UI.h('div', { style: { paddingLeft: '20px', marginBottom: '3px' } },
        UI.h('input', { type: 'checkbox', id: et.id + '-chk', onchange: () => { document.getElementById(et.id).disabled = !document.getElementById(et.id + '-chk').checked; }, style: chkStyle }),
        UI.h('label', { for: et.id + '-chk', style: { marginLeft: '5px' } }, et.label + ' '),
        UI.h('input', { id: et.id, type: 'number', step: '0.01', min: '0', value: '0', disabled: true, style: { width: '100px', fontSize: '14px', textAlign: 'right', verticalAlign: 'middle' } }),
        UI.h('span', {}, ' บาท'),
      ));
    }

    // === ไปราชการด้วย ===
    wrap.append(UI.h('div', { style: { fontWeight: 'bold', textDecoration: 'underline', marginTop: '10px', marginBottom: '5px' } }, 'ไปราชการด้วย'));

    const vehicleGroup = 'tf-vehicle-type';
    wrap.append(UI.h('div', { style: { paddingLeft: '20px', marginBottom: '3px' } },
      UI.h('input', { type: 'radio', name: vehicleGroup, value: 'gov', id: 'vtype-gov', checked: true, onchange: toggleVehicleDetail, style: radioStyle }),
      UI.h('label', { for: 'vtype-gov', style: { marginLeft: '5px' } }, 'รถยนต์ราชการ'),
    ));
    wrap.append(UI.h('div', { style: { paddingLeft: '20px', marginBottom: '3px' } },
      UI.h('input', { type: 'radio', name: vehicleGroup, value: 'personal', id: 'vtype-personal', onchange: toggleVehicleDetail, style: radioStyle }),
      UI.h('label', { for: 'vtype-personal', style: { marginLeft: '5px' } }, 'รถยนต์ส่วนตัว หมายเลขทะเบียน '),
      UI.h('input', { id: 'tf-plate', type: 'text', disabled: true, style: { width: '120px', fontSize: '14px', verticalAlign: 'middle' } }),
    ));
    wrap.append(UI.h('div', { style: { paddingLeft: '20px', marginBottom: '3px' } },
      UI.h('input', { type: 'radio', name: vehicleGroup, value: 'other', id: 'vtype-other', onchange: toggleVehicleDetail, style: radioStyle }),
      UI.h('label', { for: 'vtype-other', style: { marginLeft: '5px' } }, 'อื่นๆ ระบุ '),
      UI.h('input', { id: 'tf-vehicle-other', type: 'text', disabled: true, style: { width: '300px', fontSize: '14px', verticalAlign: 'middle' } }),
    ));

    function toggleVehicleDetail() {
      const val = document.querySelector('input[name="' + vehicleGroup + '"]:checked').value;
      document.getElementById('tf-plate').disabled = val !== 'personal';
      document.getElementById('tf-vehicle-other').disabled = val !== 'other';
    }

    // === เอกสารต้นเรื่อง ===
    wrap.append(UI.h('div', { style: { fontWeight: 'bold', textDecoration: 'underline', marginTop: '10px', marginBottom: '5px' } }, 'เอกสารต้นเรื่อง'));
    wrap.append(UI.h('div', { style: { paddingLeft: '20px', marginBottom: '10px' } },
      UI.h('input', { id: 'tf-attachment', type: 'file', style: { fontSize: '13px' } }),
    ));

    // === Footer ===
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '📨 ส่งคำขอ'));

    const m = UI.modal({ title: '✈ ยื่นคำขอไปราชการ', body: wrap, footer: foot, size: 'lg' });

    function calcDays() {
      const from = UI.readThaiDateInput('tf-from');
      const to = UI.readThaiDateInput('tf-to');
      if (!from || !to) return;
      const a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00');
      const days = Math.max(1, Math.round((b - a) / 86400000) + 1);
      document.getElementById('tf-days').value = days;
    }

    async function save() {
      const dest = document.getElementById('tf-dest').value.trim();
      const date_from = UI.readThaiDateInput('tf-from');
      const date_to = UI.readThaiDateInput('tf-to');
      const days = parseInt(document.getElementById('tf-days').value, 10) || 1;
      const subject = document.getElementById('tf-subject').value.trim();

      if (!dest) return UI.toast('กรุณากรอกสถานที่ไปราชการ', 'error');
      if (!date_from || !date_to) return UI.toast('กรุณาระบุวันเดินทาง', 'error');

      // เก็บข้อมูล form_data
      const form_data = {
        writing_at: document.getElementById('tf-writing').value.trim(),
        form_date: UI.readThaiDateInput('tf-date') || '',
        companions: parseInt(document.getElementById('tf-companions').value, 10) || 0,
        travel_subject: subject,
        order_doc: document.getElementById('tf-order-doc').value.trim(),
        order_date: UI.readThaiDateInput('tf-order-date') || '',
        expense_type: document.querySelector('input[name="' + expenseGroup + '"]:checked').value,
        expense_budget_amount: parseFloat(document.getElementById('tf-exp-budget-amount').value) || 0,
        expense_fund_source: document.getElementById('tf-exp-fund-source').value.trim(),
        expense_project: document.getElementById('tf-exp-project').value.trim(),
        expense_project_amount: parseFloat(document.getElementById('tf-exp-project-amount').value) || 0,
        expense_items: {
          baht: document.getElementById('tf-exp-baht').disabled ? 0 : parseFloat(document.getElementById('tf-exp-baht').value) || 0,
          hotel: document.getElementById('tf-exp-hotel').disabled ? 0 : parseFloat(document.getElementById('tf-exp-hotel').value) || 0,
          transport: document.getElementById('tf-exp-transport').disabled ? 0 : parseFloat(document.getElementById('tf-exp-transport').value) || 0,
          other: document.getElementById('tf-exp-other').disabled ? 0 : parseFloat(document.getElementById('tf-exp-other').value) || 0,
        },
        vehicle_type: document.querySelector('input[name="' + vehicleGroup + '"]:checked').value,
        plate_number: document.getElementById('tf-plate').value.trim(),
        other_vehicle: document.getElementById('tf-vehicle-other').value.trim(),
      };

      const data = {
        travel_subject: subject,
        title: subject || 'ขออนุมัติ/อนุญาตเดินทางไปราชการ',
        destination: dest,
        date_from,
        date_to,
        days,
        budget: 0,
        detail: '',
        form_data,
      };

      // ส่งแบบ multipart/form-data ถ้ามีไฟล์แนบ
      const fileInput = document.getElementById('tf-attachment');
      if (fileInput && fileInput.files.length > 0) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(data)) {
          fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v);
        }
        fd.append('attachment', fileInput.files[0]);
        try {
          const res = await fetch('/api/travel', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.token }, body: fd }).then(r => r.json());
          if (res.error) throw new Error(res.error);
          UI.toast(res.message);
          m.close();
          await TravelView.render(document.getElementById('app'));
        } catch (e) { UI.toast(e.message, 'error'); }
      } else {
        try {
          const res = await API.post('/travel', data);
          UI.toast(res.message);
          m.close();
          await TravelView.render(document.getElementById('app'));
        } catch (e) { UI.toast(e.message, 'error'); }
      }
    }
  },

  /* ===== ดูรายละเอียด ===== */
  openView(r) {
    const fd = {};
    try { Object.assign(fd, typeof r.form_data === 'string' ? JSON.parse(r.form_data) : (r.form_data || {})); } catch (_e) {}

    const fullName = [(r.user_title || '') + (r.first_name || ''), r.last_name || ''].filter(Boolean).join(' ');
    const posText = r.position || '-';
    const deptText = r.workplace || r.department || r.group || '-';

    // Thai date formatter (same as leaves.js)
    const thaiFormDate = (d) => {
      if (!d) return '-';
      const p = String(d).slice(0, 10).split('-');
      if (p.length !== 3) return String(d);
      const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
      return `วันที่ ${parseInt(p[2], 10)} ${months[parseInt(p[1], 10) - 1]} พ.ศ.${parseInt(p[0], 10) + 543}`;
    };

    // สร้างฟอร์ม A4
    const a4 = UI.h('div', {
      id: 'travel-a4-form',
      style: {
        maxWidth: '900px', margin: '0 auto', padding: '21px 5px 0 35px',
        fontFamily: "'THSarabunIT๙', 'TH Sarabun', 'THSarabun', sans-serif",
        fontSize: '20px', lineHeight: '1.55', color: '#1f2937', background: '#fff',
        position: 'relative',
      }
    });

    // === ส่วนหัว ===
    a4.append(UI.h('div', { style: { textAlign: 'center', marginBottom: '15px' } },
      UI.h('div', { style: { fontSize: '26px', fontWeight: 'bold', textDecoration: 'underline', marginBottom: '15px' } }, 'แบบขออนุมัติ/อนุญาตเดินทางไปราชการ')),
    );

    // === เขียนที่ (จัดชิดขวา) ===
    a4.append(UI.h('div', { style: { textAlign: 'right', marginBottom: '10px', fontSize: '20px' } },
      UI.h('div', {}, `เขียนที่ ${fd.writing_at || '-'}`),
    ));

    // === วันที่ (อักษรตัวแรกกึ่งกลางหน้า) ===
    a4.append(UI.h('div', { style: { textIndent: '50%', marginBottom: '10px', fontSize: '20px' } },
      fd.form_date ? thaiFormDate(fd.form_date) : '-',
    ));

    // === เรื่อง ===
    a4.append(UI.h('div', { style: { marginBottom: '8px', fontSize: '20px' } },
      UI.h('span', { style: { fontWeight: 'bold' } }, 'เรื่อง  '), 'ขออนุมัติ/อนุญาตเดินทางไปราชการ'));

    // === เรียน ===
    a4.append(UI.h('div', { style: { marginBottom: '15px', fontSize: '20px' } },
      UI.h('span', { style: { fontWeight: 'bold' } }, 'เรียน  '), 'ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2'));

    // === เนื้อหา ===
    const content = UI.h('div', { style: { fontSize: '20px', lineHeight: '1.5', textAlign: 'justify', marginTop: '10px' } });

    // ข้าพเจ้า + ตำแหน่ง
    content.append(UI.h('p', { style: { textIndent: '80px', margin: '0 0 2px 0' } },
      UI.h('span', { style: { marginRight: '40px' } }, 'ข้าพเจ้า'), fullName,
      UI.h('span', { style: { marginRight: '40px', marginLeft: '40px' } }, 'ตำแหน่ง'), posText));

    // กลุ่ม/หน่วย + สังกัด
    content.append(UI.h('p', { style: { margin: '0 0 2px 0' } },
      UI.h('span', { style: { marginRight: '20px' } }, 'กลุ่ม/หน่วย'), deptText,
      UI.h('span', { style: { marginLeft: '10px' } }, 'สังกัดสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2')));

    // พร้อมด้วยคณะ
    content.append(UI.h('p', { style: { margin: '0 0 2px 0' } },
      'พร้อมด้วยคณะ จำนวน ', (fd.companions || 0), ' คน',
      UI.h('span', { style: { marginLeft: '10px' } }, 'ตามรายชื่อแนบท้ายเอกสารนี้ (โปรดระบุด้านหลัง)')));

    // === มีความประสงค์ ===
    const wantP = UI.h('p', { style: { textIndent: '80px', margin: '0 0 5px 0', paddingBottom: '0' } });
    wantP.textContent = 'มีความประสงค์ขออนุมัติ/อนุญาตเดินทางไปราชการ เรื่อง ' + (fd.travel_subject || r.destination || '-');
    wantP.append(UI.h('br'), 'สถานที่ ' + (r.destination || '-') + ' ตามหนังสือ/คำสั่งที่ ' + (fd.order_doc || '-') + ' ลงวันที่ ' + (fd.order_date ? thaiFormDate(fd.order_date) : '-'));
    wantP.append(UI.h('br'), 'ตั้งแต่วันที่ ' + UI.thaiDate(r.date_from) + ' ถึงวันที่ ' + UI.thaiDate(r.date_to) + ' รวมไปราชการครั้งนี้ ' + r.days + ' วัน');
    content.append(wantP);

    // === โดยข้าพเจ้า ===
    content.append(UI.h('p', { style: { textIndent: '80px', margin: '0', paddingTop: '0' } }, 'โดยข้าพเจ้า'));
    const expType = fd.expense_type || 'none';
    if (expType === 'none') {
      content.append(UI.h('p', { style: { textIndent: '80px', margin: '0 0 5px 0' } }, '☑ ไม่ขอเบิกค่าใช้จ่าย'));
    } else if (expType === 'budget') {
      content.append(UI.h('p', { style: { textIndent: '80px', margin: '0 0 5px 0' } }, '☑ ขอเบิกค่าใช้จ่ายตามสิทธิจากเงินงบประมาณ ค่าใช้จ่ายบริหารจัดการเขตพื้นที่การศึกษา ของ สพป.แพร่ เขต 2 ตามระเบียบกระทรวงการคลังว่าด้วยค่าใช้จ่ายในการเดินทางไปราชการ จำนวน ' + (fd.expense_budget_amount || 0) + ' บาท'));
    } else if (expType === 'project') {
      content.append(UI.h('p', { style: { textIndent: '80px', margin: '0 0 5px 0' } }, '☑ ขอเบิกค่าใช้จ่ายตามสิทธิจากเงินที่ได้รับจัดสรรจาก ' + (fd.expense_fund_source || '-') + ' โครงการ ' + (fd.expense_project || '-') + ' ตามระเบียบกระทรวงการคลังว่าด้วยค่าใช้จ่ายในการเดินทางไปราชการ จำนวน ' + (fd.expense_project_amount || 0) + ' บาท'));
    }

    // === ขอเบิกค่าใช้จ่าย ===
    content.append(UI.h('p', { style: { textIndent: '80px', margin: '0 0 5px 0' } }, 'ขอเบิกค่าใช้จ่าย'));
    const ei = fd.expense_items || {};
    const eItems = [];
    if (ei.baht > 0) eItems.push('ค่าเบี้ยเลี้ยง ' + ei.baht + ' บาท');
    if (ei.hotel > 0) eItems.push('ค่าเช่าที่พัก ' + ei.hotel + ' บาท');
    if (ei.transport > 0) eItems.push('ค่าพาหนะ ' + ei.transport + ' บาท');
    if (ei.other > 0) eItems.push('ค่าใช้จ่ายอื่น ' + ei.other + ' บาท');
    content.append(UI.h('p', { style: { textIndent: '80px', margin: '0 0 5px 0' } }, eItems.length ? eItems.join(', ') : '-'));

    // === ไปราชการด้วย ===
    content.append(UI.h('p', { style: { textIndent: '80px', margin: '0 0 5px 0' } }, 'ไปราชการด้วย'));
    const vt = fd.vehicle_type || 'gov';
    if (vt === 'gov') content.append(UI.h('p', { style: { textIndent: '80px', margin: '0 0 5px 0' } }, '☑ รถยนต์ราชการ'));
    else if (vt === 'personal') content.append(UI.h('p', { style: { textIndent: '80px', margin: '0 0 5px 0' } }, '☑ รถยนต์ส่วนตัว หมายเลขทะเบียน ' + (fd.plate_number || '-')));
    else content.append(UI.h('p', { style: { textIndent: '80px', margin: '0 0 5px 0' } }, '☑ อื่นๆ ระบุ ' + (fd.other_vehicle || '-')));

    // === จึงเรียนมา ===
    content.append(UI.h('p', { style: { textIndent: '80px', margin: '10px 0 5px 0' } }, 'จึงเรียนมาเพื่อโปรดพิจารณา'));

    a4.append(content);

    // === ลงชื่อผู้ขอ ===
    const sigPath = r.user_signature ? '/uploads/' + UI.encodePath(r.user_signature) : null;
    const signWrap = UI.h('div', { style: { textAlign: 'right', marginTop: '30px', marginBottom: '15px', paddingRight: '50px' } });
    // ลงชื่อ + ลายเซ็น + ผู้ขออนุญาต (แถวเดียวกัน)
    const sigCol = UI.h('div', { style: { display: 'inline-flex', flexDirection: 'column', alignItems: 'center', marginRight: '10px' } });
    const sigImg = sigPath ? UI.h('img', { src: sigPath, style: { maxHeight: '60px', display: 'block', marginBottom: '2px' } }) : UI.h('div', { style: { height: '60px' } });
    const nameDiv = UI.h('div', { style: { fontSize: '20px', whiteSpace: 'nowrap' } });
    nameDiv.textContent = fullName;
    const posDiv = UI.h('div', { style: { fontSize: '20px', whiteSpace: 'nowrap' } });
    posDiv.textContent = posText;
    sigCol.append(sigImg, nameDiv, posDiv);
    const signLine = UI.h('div', { style: { fontSize: '20px', display: 'inline-flex', alignItems: 'center', gap: '10px', marginBottom: '5px' } });
    signLine.append(UI.h('span', {}, '(ลงชื่อ)'), sigCol, UI.h('span', {}, 'ผู้ขออนุญาต'));
    signWrap.append(signLine);
    a4.append(signWrap);

    // === ความเห็นผู้บังคับบัญชาขั้นต้น + อนุมัติ/อนุญาต (2 คอลัมน์) ===
    const reqIsSchool = (r.user_group || (String(r.school_code || '') === '54020000' ? 'office' : 'school')) === 'school';
    const level1Approval = (r.approvals || []).find(a => a.level === 1);
    const level2Approval = (r.approvals || []).find(a => a.level === 2);
    const level3Approval = (r.approvals || []).find(a => a.level === 3);
    // คอลัมน์ความเห็นในแบบฟอร์ม: สาย สพป. = ผู้บังคับบัญชาขั้นต้น(ขั้น1) / ผู้อนุมัติ-อนุญาต(ขั้2)
    //                              สายสถานศึกษา = ผู้บังคับบัญชาขั้นต้น(ขั้น2) / ผู้อนุมัติ-อนุญาต(ขั้น3) — ไม่แสดงความเห็นของผู้ตรวจสอบ
    const col1Approval = reqIsSchool ? level2Approval : level1Approval;
    const col2Approval = reqIsSchool ? level3Approval : level2Approval;
    
      /** แยกตำแหน่งเป็น 2 บรรทัดเมื่อมีคำว่า รักษาราชการแทน หรือ ปฏิบัติหน้าที่/ปฏิบัติราชการแทน — แยกจากตำแหน่งจริง ไม่ใส่ตำแหน่งอื่นแทน */
      function splitPosition(pos) {
        if (!pos) return UI.h('div', { style: { fontSize: '20px', whiteSpace: 'nowrap' } }, '-');
        const kwIdx = pos.search(/รักษาราชการแทน|ปฏิบัติหน้าที่|ปฏิบัติราชการแทน/);
        if (kwIdx > 0) {
          // มีตำแหน่งหลักนำหน้าคำสำคัญ → แยก 2 บรรทัดตามตำแหน่งจริง
          const mainPos = pos.slice(0, kwIdx).trim();
          const subPos = pos.slice(kwIdx).trim();
          return UI.h('div', { style: { fontSize: '20px', textAlign: 'center', lineHeight: '1.4' } },
            UI.h('div', { style: { whiteSpace: 'nowrap' } }, mainPos),
            UI.h('div', { style: { whiteSpace: 'nowrap' } }, subPos)
          );
        }
        // ไม่มีตำแหน่งหลักนำหน้า (หรือไม่มีคำสำคัญ) → แสดงตำแหน่งตามจริงบรรทัดเดียว
        return UI.h('div', { style: { fontSize: '20px', whiteSpace: 'nowrap' } }, pos);
      }

    if (col1Approval || col2Approval) {
      const twoColWrap = UI.h('div', { style: { marginTop: '25px', display: 'flex', gap: '20px' } });

      // --- คอลัมน์ซ้าย: ความเห็นของผู้บังคับบัญชาขั้นต้น ---
      const leftCol = UI.h('div', { style: { flex: '1' } });
      leftCol.append(UI.h('div', { style: { fontSize: '20px', marginBottom: '5px', textAlign: 'left' } }, 'ความเห็นของผู้บังคับบัญชาขั้นต้น'));
      if (col1Approval) {
        // แสดงตัวเลือกทั้ง 4 ตัว (☑ เลือก, ☐ ไม่ได้เลือก) + เหตุผล — ตัวเลือกตามขั้นของสายที่ขอ
        const allL1 = reqIsSchool ? [
          { key: 'อนุมัติ', reason: false },
          { key: 'ไม่อนุมัติ', reason: true },
          { key: 'อนุญาต', reason: false },
          { key: 'ไม่อนุญาต', reason: true },
        ] : [
          { key: 'ควรอนุมัติ', reason: false },
          { key: 'ไม่ควรอนุมัติ', reason: true },
          { key: 'ควรอนุญาต', reason: false },
          { key: 'ไม่ควรอนุญาต', reason: true },
        ];
        let l1NoteObj = {};
        try { l1NoteObj = JSON.parse(col1Approval.note); } catch (_e) {}
        const l1Selected = l1NoteObj.choices || [];
        const l1ReasonMap = l1NoteObj.reasonMap || (l1NoteObj.reasons ? { 'ไม่ควรอนุมัติ': l1NoteObj.reasons } : {});
        allL1.forEach((item) => {
          const checked = l1Selected.includes(item.key);
          const line = [(checked ? '☑ ' : '☐ ') + item.key];
          if (item.reason && l1ReasonMap[item.key]) {
            line.push(UI.h('span', { style: { fontSize: '18px', color: '#64748b', marginLeft: '8px' } }, '(เนื่องจาก ' + l1ReasonMap[item.key] + ')'));
          }
          leftCol.append(UI.h('div', { style: { fontSize: '20px', marginBottom: '3px', textAlign: 'left', display: 'flex', alignItems: 'baseline', gap: '4px' } }, ...line));
        });
        if (!l1NoteObj.choices && col1Approval.note) {
          leftCol.append(UI.h('div', { style: { fontSize: '20px', marginBottom: '5px', textAlign: 'left' } }, '☑ เห็นควรอนุมัติ/อนุญาต'));
        }
        const opSigWrap = UI.h('div', { style: { textAlign: 'left' } });
        const opSigCol = UI.h('div', { style: { display: 'inline-flex', flexDirection: 'column', alignItems: 'center' } });
        const opSigPath = col1Approval.signature ? '/uploads/' + UI.encodePath(col1Approval.signature) : null;
        const opSigImg = opSigPath ? UI.h('img', { src: opSigPath, style: { maxHeight: '60px', display: 'block', marginBottom: '2px' } }) : UI.h('div', { style: { height: '60px' } });
        opSigCol.append(opSigImg);
        const opNameDiv = UI.h('div', { style: { fontSize: '20px', whiteSpace: 'nowrap' } });
        opNameDiv.textContent = col1Approval.name || '-';
        opSigCol.append(opNameDiv);
        const opPosDiv = splitPosition(col1Approval.position);
        opSigCol.append(opPosDiv);
        const opDateDiv = UI.h('div', { style: { fontSize: '20px', whiteSpace: 'nowrap' } });
        opDateDiv.textContent = col1Approval.at ? UI.thaiDate(col1Approval.at.slice(0, 10)) : '-';
        opSigCol.append(opDateDiv);
        const opSignLine = UI.h('div', { style: { fontSize: '20px', display: 'inline-flex', alignItems: 'center', gap: '10px', marginBottom: '5px' } });
        opSignLine.append(UI.h('span', {}, '(ลงชื่อ)'), opSigCol);
        opSigWrap.append(opSignLine);
        leftCol.append(opSigWrap);
      }
      twoColWrap.append(leftCol);

      // --- คอลัมน์ขวา: อนุมัติ/อนุญาต ---
      const rightCol = UI.h('div', { style: { flex: '1' } });
      rightCol.append(UI.h('div', { style: { fontSize: '20px', marginBottom: '5px', textAlign: 'left' } }, 'ความเห็นของผู้อนุมัติ/อนุญาต'));

      if (col2Approval) {
        // แสดงตัวเลือกทั้ง 4 ตัว (☑ เลือก, ☐ ไม่ได้เลือก) + เหตุผล
        const allL2 = [
          { key: 'อนุมัติ', reason: false },
          { key: 'ไม่อนุมัติ', reason: true },
          { key: 'อนุญาต', reason: false },
          { key: 'ไม่อนุญาต', reason: true },
        ];
        let l2NoteObj = {};
        try { l2NoteObj = JSON.parse(col2Approval.note); } catch (_e) {}
        const l2Selected = l2NoteObj.choices || [];
        const l2ReasonMap = l2NoteObj.reasonMap || (l2NoteObj.reasons ? { 'ไม่อนุมัติ': l2NoteObj.reasons } : {});
        allL2.forEach((item) => {
          const checked = l2Selected.includes(item.key);
          const line2 = [(checked ? '☑ ' : '☐ ') + item.key];
          if (item.reason && l2ReasonMap[item.key]) {
            line2.push(UI.h('span', { style: { fontSize: '18px', color: '#64748b', marginLeft: '8px' } }, '(เนื่องจาก ' + l2ReasonMap[item.key] + ')'));
          }
          rightCol.append(UI.h('div', { style: { fontSize: '20px', marginBottom: '3px', textAlign: 'left', display: 'flex', alignItems: 'baseline', gap: '4px' } }, ...line2));
        });
        if (!l2NoteObj.choices && col2Approval.note) {
          rightCol.append(UI.h('div', { style: { fontSize: '20px', marginBottom: '5px', textAlign: 'left' } }, '☑ อนุมัติ/อนุญาต'));
        }
        const apSigWrap = UI.h('div', { style: { textAlign: 'left' } });
        const apSigCol = UI.h('div', { style: { display: 'inline-flex', flexDirection: 'column', alignItems: 'center' } });
        const apSigPath = col2Approval.signature ? '/uploads/' + UI.encodePath(col2Approval.signature) : null;
        const apSigImg = apSigPath ? UI.h('img', { src: apSigPath, style: { maxHeight: '60px', display: 'block', marginBottom: '2px' } }) : UI.h('div', { style: { height: '60px' } });
        apSigCol.append(apSigImg);
        const apNameDiv = UI.h('div', { style: { fontSize: '20px', whiteSpace: 'nowrap' } });
        apNameDiv.textContent = col2Approval.name || '-';
        apSigCol.append(apNameDiv);
        const apPosDiv = splitPosition(col2Approval.position);
        apSigCol.append(apPosDiv);
        const apDateDiv = UI.h('div', { style: { fontSize: '20px', whiteSpace: 'nowrap' } });
        apDateDiv.textContent = col2Approval.at ? UI.thaiDate(col2Approval.at.slice(0, 10)) : '-';
        apSigCol.append(apDateDiv);
        const apSignLine = UI.h('div', { style: { fontSize: '20px', display: 'inline-flex', alignItems: 'center', gap: '10px', marginBottom: '5px' } });
        apSignLine.append(UI.h('span', {}, '(ลงชื่อ)'), apSigCol);
        apSigWrap.append(apSignLine);
        rightCol.append(apSigWrap);
      }
      twoColWrap.append(rightCol);

      a4.append(twoColWrap);
    }

    // === ปุ่มพิมพ์ + สถานะ (ไว้นอกแบบฟอร์ม ใน footer ของ modal) ===
    const printBtn = UI.h('button', {
      className: 'btn btn-primary',
      style: { fontSize: '16px', padding: '8px 24px' },
      onclick: () => {
        const html = a4.innerHTML;
        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.top = '0';
        iframe.style.left = '0';
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.style.zIndex = '9999';
        document.body.appendChild(iframe);
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        doc.open();
        doc.write(`<!DOCTYPE html><html><head><title>ใบขออนุมัติ/อนุญาตเดินทางไปราชการ ${r.travel_no}</title>` +
          `<style>` +
          `@font-face{font-family:'THSarabunIT๙';src:url('/fonts/THSarabunIT%C2%B9.ttf');}` +
          `@font-face{font-family:'THSarabun';src:url('/fonts/THSarabun.ttf');}` +
          `@font-face{font-family:'THSarabun';src:url('/fonts/THSarabun%20Bold.ttf');font-weight:bold;}` +
          `@page{size:A4;margin:1.5cm;}` +
          `*{font-family:'THSarabunIT๙','TH Sarabun','THSarabun',sans-serif !important;}` +
          `body{font-size:20px;line-height:1.5;color:#1f2937;padding:0;margin:0;}` +
          `div,p,span{font-family:'THSarabunIT๙','TH Sarabun','THSarabun',sans-serif !important;}` +
          `img{max-height:60px;display:block;}` +
          `.badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:14px;font-weight:700;}` +
          `.badge-approved{background:#dcfce7;color:#15803d;}` +
          `.badge-pending{background:#fef3c7;color:#b45309;}` +
          `.badge-rejected{background:#fee2e2;color:#b91c1c;}` +
          `</style></head><body>` + html + `</body></html>`);
        doc.close();
        setTimeout(() => {
          iframe.contentWindow.print();
          setTimeout(() => document.body.removeChild(iframe), 1000);
        }, 300);
      }
    }, '⬢ พิมพ์');
    // === สถานะ + ความคืบหน้า (ไว้นอกแบบฟอร์ม ก่อนปุ่มพิมพ์) ===
    const statusSection = UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '16px' } },
      UI.h('div', {}, 'สถานะ: '), UI.badge(r.status),
      UI.h('div', { style: { fontSize: '14px' } }, UI.approvalDetail(r)));
    const footerWrap = UI.h('div', { style: { display: 'flex', alignItems: 'center', width: '100%' } },
      UI.h('div', { style: { flex: '1', textAlign: 'left' } }, statusSection),
      UI.h('div', { style: { flex: '0', textAlign: 'right' } }, printBtn));

    UI.modal({ title: '👁️ รายละเอียดคำขอไปราชการ ' + r.travel_no, body: a4, footer: footerWrap, size: 'lg' });
  },

  async decide(r, action) {
    const nextLevel = UI.approvalDone(r) + 1;
    // สายสถานศึกษา ขั้นที่ 1 (ผู้ตรวจสอบ): หน้าต่างยืนยันแบบ "เสนอเรื่อง" — ไม่บันทึกข้อมูลใดๆ ลงในรายละเอียดคำขอ
    const reqIsSchool0 = (r.user_group || (String(r.school_code || '') === '54020000' ? 'office' : 'school')) === 'school';
    if (reqIsSchool0 && nextLevel === 1 && action === 'approve') {
      const requesterName0 = [(r.user_title || '') + (r.first_name || ''), r.last_name || ''].filter(Boolean).join(' ') || (r.full_name || '');
      const body0 = UI.h('div', { style: { fontSize: '15px' } },
        UI.h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '15px' } },
          UI.h('input', { type: 'checkbox', id: 'trv-forward-' + r.id, style: { width: '18px', height: '18px', cursor: 'pointer', flexShrink: '0' }, checked: true }),
          'เสนอเรื่อง'));
      const ok0 = await UI.confirm('ต้องการเสนอคำขออนุญาตเดินทางไปราชการ ของ' + requesterName0 + ' ใช่หรือไม่?', {
        body: body0,
        okText: 'ยืนยัน',
        danger: false,
        onConfirm: () => {
          const fw = document.getElementById('trv-forward-' + r.id);
          return { forward: !!(fw && fw.checked) };
        }
      });
      if (!ok0) return;
      try {
        const res0 = await API.put('/travel/' + r.id + '/approve', {});
        UI.toast(res0.message);
        await TravelView.render(document.getElementById('app'));
      } catch (e) { UI.toast(e.message, 'error'); }
      return;
    }
    const isLevel2 = nextLevel === 2;
    const isFinalSchool = reqIsSchool0 && nextLevel === 3; // สายสถานศึกษา ขั้นที่ 3 (ผู้อนุมัติขั้นสุดท้าย)
    const approveLabel = nextLevel === 1 ? 'ควรอนุมัติ/อนุญาต' : 'อนุมัติ/อนุญาต';
    const rejectLabel = nextLevel === 1 ? 'ไม่ควรอนุมัติ/ไม่อนุญาต' : 'ไม่อนุมัติ/ไม่อนุญาต';
    const label = action === 'approve' ? approveLabel : rejectLabel;

    // ผู้อนุมัติขั้นสุดท้าย (สาย สพป. level 2 | สายสถานศึกษา level 3) → แสดง modal มีตัวเลือก checkbox + เลือกตำแหน่ง
    if (action === 'approve' && (isLevel2 || isFinalSchool)) {
      let reasonReject = '';
      let reasonDisallow = '';

      // Position options
      const userPos = (Auth.user.position || '').trim();
      let posOptions = [];
      if (userPos.includes('ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2') && !userPos.includes('รอง')) {
        posOptions = [
          'ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2',
          'ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2 ปฏิบัติหน้าที่ราชการแทนเลขาธิการ กพฐ.'
        ];
      } else if (userPos.includes('รองผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2')) {
        posOptions = [
          'รองผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2',
          'รองผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2 รักษาราชการแทน ผอ.สพป.แพร่ เขต 2',
          'รองผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2 ปฏิบัติราชการแทน ผอ.สพป.แพร่ เขต 2'
        ];
      } else {
        posOptions = [userPos || 'ไม่ระบุตำแหน่ง'];
      }

      const chkStyle = { width: '16px', height: '16px', flexShrink: '0', cursor: 'pointer' };
      const labelStyle = { display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px', cursor: 'pointer', whiteSpace: 'nowrap' };
      const reasonWrapStyle = { display: 'none', marginLeft: '20px', marginTop: '4px', marginBottom: '8px' };
      const reasonInputStyle = { width: '100%', minHeight: '50px', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' };

      const rejectReasonWrap = UI.h('div', { id: 'trv2-reject-reason-' + r.id, style: Object.assign({}, reasonWrapStyle) },
        UI.h('div', { style: { fontSize: '12px', color: '#64748b', marginBottom: '4px' } }, 'เนื่องจาก'),
        UI.h('textarea', {
          id: 'trv2-reject-reason-input-' + r.id,
          style: reasonInputStyle,
          placeholder: 'กรุณาระบุเหตุผล...',
          oninput: (e) => { reasonReject = e.target.value; }
        }));

      const disallowReasonWrap = UI.h('div', { id: 'trv2-disallow-reason-' + r.id, style: Object.assign({}, reasonWrapStyle) },
        UI.h('div', { style: { fontSize: '12px', color: '#64748b', marginBottom: '4px' } }, 'เนื่องจาก'),
        UI.h('textarea', {
          id: 'trv2-disallow-reason-input-' + r.id,
          style: reasonInputStyle,
          placeholder: 'กรุณาระบุเหตุผล...',
          oninput: (e) => { reasonDisallow = e.target.value; }
        }));

      function updateReasonVisibility() {
        const rejectChk = document.getElementById('trv2-reject-' + r.id);
        const disallowChk = document.getElementById('trv2-disallow-' + r.id);
        rejectReasonWrap.style.display = (rejectChk && rejectChk.checked) ? 'block' : 'none';
        disallowReasonWrap.style.display = (disallowChk && disallowChk.checked) ? 'block' : 'none';
        if (!rejectChk || !rejectChk.checked) { reasonReject = ''; }
        if (!disallowChk || !disallowChk.checked) { reasonDisallow = ''; }
      }

      let selectedPos = posOptions[0];
      const posSelect = UI.h('select', {
        id: 'pos-select',
        style: { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '16px', marginTop: '8px' },
        onchange: (e) => { selectedPos = e.target.value; }
      }, ...posOptions.map((p) => UI.h('option', { value: p }, p)));

      const body = UI.h('div', { style: { fontSize: '15px' } },
        UI.h('div', { style: { marginBottom: '10px', fontWeight: 700 } }, 'กรุณาเลือกการพิจารณา'),
        UI.h('label', { style: labelStyle },
          UI.h('input', { type: 'checkbox', id: 'trv2-approve-' + r.id, style: chkStyle, onchange: updateReasonVisibility }),
          'อนุมัติ'),
        UI.h('label', { style: labelStyle },
          UI.h('input', { type: 'checkbox', id: 'trv2-reject-' + r.id, style: chkStyle, onchange: updateReasonVisibility }),
          'ไม่อนุมัติ'),
        rejectReasonWrap,
        UI.h('label', { style: labelStyle },
          UI.h('input', { type: 'checkbox', id: 'trv2-allow-' + r.id, style: chkStyle, onchange: updateReasonVisibility }),
          'อนุญาต'),
        UI.h('label', { style: labelStyle },
          UI.h('input', { type: 'checkbox', id: 'trv2-disallow-' + r.id, style: chkStyle, onchange: updateReasonVisibility }),
          'ไม่อนุญาต'),
        disallowReasonWrap,
        UI.h('div', { style: { marginTop: '10px', fontWeight: 700 } }, 'กรุณาเลือกตำแหน่งที่จะอนุมัติ/อนุญาต'),
        posSelect,
      );

      const captured2 = await UI.confirm(`ต้องการพิจารณาคำขอไปราชการ "${r.title}" ใช่หรือไม่?`, {
        body: body,
        okText: 'ยืนยัน',
        danger: false,
        size: 'lg',
        onConfirm: () => {
          const a2 = document.getElementById('trv2-approve-' + r.id);
          const r2 = document.getElementById('trv2-reject-' + r.id);
          const l2 = document.getElementById('trv2-allow-' + r.id);
          const d2 = document.getElementById('trv2-disallow-' + r.id);
          const rr2 = document.getElementById('trv2-reject-reason-input-' + r.id);
          const dr2 = document.getElementById('trv2-disallow-reason-input-' + r.id);
          const choices = [];
          if (a2 && a2.checked) choices.push('อนุมัติ');
          if (r2 && r2.checked) choices.push('ไม่อนุมัติ');
          if (l2 && l2.checked) choices.push('อนุญาต');
          if (d2 && d2.checked) choices.push('ไม่อนุญาต');
          const reasonMap = {};
          if (r2 && r2.checked && rr2 && rr2.value) reasonMap['ไม่อนุมัติ'] = rr2.value;
          if (d2 && d2.checked && dr2 && dr2.value) reasonMap['ไม่อนุญาต'] = dr2.value;
          return { choices, reasonMap, isReject: false, position: selectedPos };
        }
      });
      if (!captured2) return;
      const { choices: choices2, reasonMap: reasonMap2, isReject: isReject2, position: pos2 } = captured2;
      const combinedNote2 = JSON.stringify({ choices: choices2, reasonMap: reasonMap2 });

      let endpoint2 = isReject2 ? `/travel/${r.id}/reject` : `/travel/${r.id}/approve`;
      try {
        const res = await API.put(endpoint2, { position: pos2, note: combinedNote2 });
        UI.toast(res.message);
        await TravelView.render(document.getElementById('app'));
      } catch (e) { UI.toast(e.message, 'error'); }
      return;
    }

    // ผู้บังคับบัญชาขั้นต้น (level 1) → แสดง modal มีตัวเลือก checkbox (เฉพาะสาย สพป. — สายสถานศึกษาใช้หน้าต่าง เสนอเรื่อง ด้านบน)
    if (nextLevel === 1) {
      let reasonReject = '';
      let reasonDisallow = '';

      const chkStyle = { width: '16px', height: '16px', flexShrink: '0', cursor: 'pointer' };
      const labelStyle = { display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px', cursor: 'pointer', whiteSpace: 'nowrap' };
      const reasonWrapStyle = { display: 'none', marginLeft: '20px', marginTop: '4px', marginBottom: '8px' };
      const reasonInputStyle = { width: '100%', minHeight: '50px', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' };

      const rejectReasonWrap = UI.h('div', { id: 'trv-reject-reason-' + r.id, style: Object.assign({}, reasonWrapStyle) },
        UI.h('div', { style: { fontSize: '12px', color: '#64748b', marginBottom: '4px' } }, 'เนื่องจาก'),
        UI.h('textarea', {
          id: 'trv-reject-reason-input-' + r.id,
          style: reasonInputStyle,
          placeholder: 'กรุณาระบุเหตุผล...',
          oninput: (e) => { reasonReject = e.target.value; }
        }));

      const disallowReasonWrap = UI.h('div', { id: 'trv-disallow-reason-' + r.id, style: Object.assign({}, reasonWrapStyle) },
        UI.h('div', { style: { fontSize: '12px', color: '#64748b', marginBottom: '4px' } }, 'เนื่องจาก'),
        UI.h('textarea', {
          id: 'trv-disallow-reason-input-' + r.id,
          style: reasonInputStyle,
          placeholder: 'กรุณาระบุเหตุผล...',
          oninput: (e) => { reasonDisallow = e.target.value; }
        }));

      function updateReasonVisibility() {
        const rejectChk = document.getElementById('trv-reject-' + r.id);
        const disallowChk = document.getElementById('trv-disallow-' + r.id);
        rejectReasonWrap.style.display = (rejectChk && rejectChk.checked) ? 'block' : 'none';
        disallowReasonWrap.style.display = (disallowChk && disallowChk.checked) ? 'block' : 'none';
        if (!rejectChk || !rejectChk.checked) { reasonReject = ''; }
        if (!disallowChk || !disallowChk.checked) { reasonDisallow = ''; }
      }

      const body = UI.h('div', { style: { fontSize: '15px' } },
        UI.h('div', { style: { marginBottom: '10px', fontWeight: 700 } }, 'กรุณาเลือกการพิจารณา'),
        UI.h('label', { style: labelStyle },
          UI.h('input', { type: 'checkbox', id: 'trv-approve-' + r.id, style: chkStyle, onchange: updateReasonVisibility }),
          'ควรอนุมัติ'),
        UI.h('label', { style: labelStyle },
          UI.h('input', { type: 'checkbox', id: 'trv-reject-' + r.id, style: chkStyle, onchange: updateReasonVisibility }),
          'ไม่ควรอนุมัติ'),
        rejectReasonWrap,
        UI.h('label', { style: labelStyle },
          UI.h('input', { type: 'checkbox', id: 'trv-allow-' + r.id, style: chkStyle, onchange: updateReasonVisibility }),
          'ควรอนุญาต'),
        UI.h('label', { style: labelStyle },
          UI.h('input', { type: 'checkbox', id: 'trv-disallow-' + r.id, style: chkStyle, onchange: updateReasonVisibility }),
          'ไม่ควรอนุญาต'),
        disallowReasonWrap,
      );

      const captured1 = await UI.confirm(`ต้องการพิจารณาคำขอไปราชการ "${r.title}" ใช่หรือไม่?`, {
        body: body,
        okText: 'ยืนยัน',
        danger: false,
        size: 'lg',
        onConfirm: () => {
          const a1 = document.getElementById('trv-approve-' + r.id);
          const r1 = document.getElementById('trv-reject-' + r.id);
          const l1 = document.getElementById('trv-allow-' + r.id);
          const d1 = document.getElementById('trv-disallow-' + r.id);
          const rr1 = document.getElementById('trv-reject-reason-input-' + r.id);
          const dr1 = document.getElementById('trv-disallow-reason-input-' + r.id);
          const choices = [];
          if (a1 && a1.checked) choices.push('ควรอนุมัติ');
          if (r1 && r1.checked) choices.push('ไม่ควรอนุมัติ');
          if (l1 && l1.checked) choices.push('ควรอนุญาต');
          if (d1 && d1.checked) choices.push('ไม่ควรอนุญาต');
          const reasonMap = {};
          if (r1 && r1.checked && rr1 && rr1.value) reasonMap['ไม่ควรอนุมัติ'] = rr1.value;
          if (d1 && d1.checked && dr1 && dr1.value) reasonMap['ไม่ควรอนุญาต'] = dr1.value;
          return { choices, reasonMap, isReject: false };
        }
      });
      if (!captured1) return;
      const { choices: choices1, reasonMap: reasonMap1, isReject: isReject1 } = captured1;
      const combinedNote1 = JSON.stringify({ choices: choices1, reasonMap: reasonMap1 });
      const endpoint1 = isReject1 ? `/travel/${r.id}/reject` : `/travel/${r.id}/approve`;
      try {
        const res = await API.put(endpoint1, { note: combinedNote1 });
        UI.toast(res.message);
        await TravelView.render(document.getElementById('app'));
      } catch (e) { UI.toast(e.message, 'error'); }
      return;
    }

    // ระดับอื่น
    const ok = await UI.confirm(`ต้องการ${label}คำขอไปราชการ "${r.title}" ใช่หรือไม่?`, { okText: label, danger: action !== 'approve' });
    if (!ok) return;
    try {
      const endpoint = action === 'approve' ? `/travel/${r.id}/approve` : `/travel/${r.id}/reject`;
      const res = await API.put(endpoint, {});
      UI.toast(res.message);
      await TravelView.render(document.getElementById('app'));
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  /* ===== ตั้งค่าผู้อนุมัติไปราชการ (admin only) ===== */
  async openApproverSettings() {
    let travelApprovers = {};
    try {
      const d = await API.get('/settings/travel-approvers');
      travelApprovers = d.travelApprovers || {};
    } catch (_e) {}

    let travelApproversSchool = {};
    try {
      const d = await API.get('/settings/travel-approvers-school');
      travelApproversSchool = d.travelApprovers || {};
    } catch (_e) {}

    let allStaff = [];
    try {
      const d = await API.get('/staff');
      allStaff = d.users || d.staff || [];
    } catch (_e) {}
    allStaff.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.id - b.id));

    // แยกกลุ่มอย่างชัดเจน: office = เจ้าหน้าที่ สพป.แพร่ เขต 2 (user_group != 'school') | school = เจ้าหน้าที่สถานศึกษา
    const officeStaff = allStaff.filter((u) => (u.user_group || 'office') !== 'school');
    const schoolStaff = allStaff.filter((u) => (u.user_group || 'office') === 'school');

    const buildSelect = (uid, field, selectedId, pool) => {
      const sel = UI.h('select', { id: 'trv-' + uid + '-' + field, style: { width: '100%', padding: '4px', fontSize: '13px', borderRadius: '4px', border: '1px solid #d1d5db' } },
        UI.h('option', { value: '0' }, '-- เลือก --'));
      for (const u of pool) {
        const fullName = [(u.title || '') + (u.first_name || ''), u.last_name || ''].filter(Boolean).join(' ');
        sel.append(UI.h('option', { value: String(u.id), selected: u.id === selectedId }, fullName));
      }
      return sel;
    };

    // ตารางรายบุคคลของแต่ละกลุ่ม — office: 2 ขั้น (คงเดิม) | school: 3 ขั้น (ผู้ตรวจสอบ→ผู้บังคับบัญชาขั้นต้น→ผู้อนุมัติ ทุกขั้นเลือกจากเจ้าหน้าที่ สพป.แพร่ เขต 2)
    const buildSection = (staffList, savedMap, cols) => {
      const table = document.createElement('table'); table.style.cssText = 'width:100%;border-collapse:collapse;';
      const thBase = { padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #d1d5db', fontSize: '13px', fontWeight: 'bold' };
      const tdBase = { padding: '5px 8px', borderBottom: '1px solid #e5e7eb', fontSize: '13px' };
      table.append(UI.h('thead', {}, UI.h('tr', {},
        UI.h('th', { style: Object.assign({}, thBase, { width: '20%', whiteSpace: 'nowrap' }) }, 'ชื่อบุคลากร'),
        UI.h('th', { style: Object.assign({}, thBase, { width: '30%', whiteSpace: 'nowrap' }) }, 'สังกัด/กลุ่มงาน'),
        cols.map((col) => UI.h('th', { style: Object.assign({}, thBase, { width: col.width, whiteSpace: 'nowrap' }) }, col.label)),
      )));
      const tbody = UI.h('tbody');
      for (const u of staffList) {
        const fullName = [(u.title || '') + (u.first_name || ''), u.last_name || ''].filter(Boolean).join(' ');
        const dept = u.workplace || u.department || u.group || '-';
        const saved = savedMap[String(u.id)] || {};
        tbody.append(UI.h('tr', {},
          UI.h('td', { style: Object.assign({}, tdBase, { whiteSpace: 'nowrap' }) }, fullName),
          UI.h('td', { style: Object.assign({}, tdBase, { whiteSpace: 'nowrap' }) }, dept || '-'),
          cols.map((col) => UI.h('td', { style: tdBase }, buildSelect(u.id, col.field, saved[col.field] || 0, col.pool))),
        ));
      }
      table.append(tbody);
      return table;
    };

    const officeCols = [
      { field: 'supervisor', label: 'ผู้บังคับบัญชาขั้นต้น', width: '22%', pool: officeStaff },
      { field: 'approver', label: 'ผู้อนุมัติ', width: '22%', pool: officeStaff },
    ];
    const schoolCols = [
      { field: 'reviewer', label: 'ผู้ตรวจสอบ (ขั้นที่ 1)', width: '17%', pool: officeStaff },
      { field: 'supervisor', label: 'ผู้บังคับบัญชาขั้นต้น (ขั้นที่ 2)', width: '17%', pool: officeStaff },
      { field: 'approver', label: 'ผู้อนุมัติ (ขั้นที่ 3)', width: '17%', pool: officeStaff },
    ];


    // เนื้อหา 2 แท็บ: เจ้าหน้าที่ สพป.แพร่ เขต 2 / เจ้าหน้าที่สถานศึกษา — แยกข้อมูลและตัวเลือกออกจากกันอย่างชัดเจน
    const paneOffice = UI.h('div', {},
      buildSection(officeStaff, travelApprovers, officeCols),
    );
    const paneSchool = UI.h('div', { style: { display: 'none' } },
      buildSection(schoolStaff, travelApproversSchool, schoolCols),
    );

    const tabBtnOffice = UI.h('button', { className: 'tab active', onclick: () => switchTab('office') }, '📋 เจ้าหน้าที่ สพป.แพร่ เขต 2 (' + officeStaff.length + ')');
    const tabBtnSchool = UI.h('button', { className: 'tab', onclick: () => switchTab('school') }, '🏫 เจ้าหน้าที่สถานศึกษา (' + schoolStaff.length + ')');

    function switchTab(which) {
      const office = which === 'office';
      tabBtnOffice.classList.toggle('active', office);
      tabBtnSchool.classList.toggle('active', !office);
      paneOffice.style.display = office ? '' : 'none';
      paneSchool.style.display = office ? 'none' : '';
    }

    const body = UI.h('div', { style: { fontSize: '14px', maxHeight: '560px', overflowY: 'auto' } },
      UI.h('div', { style: { marginBottom: '10px', color: '#64748b' } }, 'กำหนดผู้บังคับบัญชาขั้นต้นและผู้อนุมัติสำหรับแต่ละบุคคล — แยกตามกลุ่ม ตัวเลือกในแต่ละแท็บเป็นเจ้าหน้าที่ของกลุ่มนั้นเท่านั้น'),
      UI.h('div', { className: 'tabs', style: { marginBottom: '12px' } }, tabBtnOffice, tabBtnSchool),
      paneOffice,
      paneSchool,
    );

    let m;
    const footer = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: async () => {
        const data = {};
        for (const u of officeStaff) {
          const sEl = document.getElementById('trv-' + u.id + '-supervisor');
          const aEl = document.getElementById('trv-' + u.id + '-approver');
          if (sEl || aEl) {
            data[String(u.id)] = {
              supervisor: Number(sEl ? sEl.value : 0),
              approver: Number(aEl ? aEl.value : 0),
            };
          }
        }
        const dataSchool = {};
        for (const u of schoolStaff) {
          const rEl = document.getElementById('trv-' + u.id + '-reviewer');
          const sEl = document.getElementById('trv-' + u.id + '-supervisor');
          const aEl = document.getElementById('trv-' + u.id + '-approver');
          if (rEl || sEl || aEl) {
            dataSchool[String(u.id)] = {
              reviewer: Number(rEl ? rEl.value : 0),
              supervisor: Number(sEl ? sEl.value : 0),
              approver: Number(aEl ? aEl.value : 0),
            };
          }
        }
        try {
          await API.put('/settings/travel-approvers', data);
          const res = await API.put('/settings/travel-approvers-school', dataSchool);
          UI.toast(res.message);
          m.close();
        } catch (e) { UI.toast(e.message, 'error'); }
      } }, '▽ บันทึก'),
    );

    m = UI.modal({ title: '⊛ กำหนดผู้อนุมัติไปราชการ', body, footer, size: 'xxl' });
  },

  async remove(r) {
    const ok = await UI.confirm('ต้องการลบรายการคำขอนี้ใช่หรือไม่?', { danger: true, okText: 'ลบ' });
    if (!ok) return;
    try {
      const res = await API.del('/travel/' + r.id);
      UI.toast(res.message);
      await TravelView.render(document.getElementById('app'));
    } catch (e) { UI.toast(e.message, 'error'); }
  },
};
