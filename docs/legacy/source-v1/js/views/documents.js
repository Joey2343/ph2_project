'use strict';
const DocumentsView = {
  /** Autocomplete แบบพิมพ์ค้นหา: แสดงรายการคำแนะนำใต้ input เมื่อพิมพ์ (จับคู่แบบไม่สนตัวพิมพ์) */
  attachAutocomplete(input, listEl, items, onPick) {
    if (!input || !listEl) return;
    function renderList(filter) {
      listEl.innerHTML = '';
      const f = (filter || '').toLowerCase().trim();
      const filtered = items.filter(function(it) {
        if (!f) return true;
        return it.text.toLowerCase().includes(f) || (it.sub || '').toLowerCase().includes(f);
      }).slice(0, 50);
      filtered.forEach(function(it) {
        const item = UI.h('div', { style: { padding: '8px', cursor: 'pointer', borderBottom: '1px solid #eee' } },
          UI.h('div', {}, it.text),
          it.sub ? UI.h('div', { style: { fontSize: '12px', color: '#64748b' } }, it.sub) : null);
        item.onmousedown = function(e) { e.preventDefault(); input.value = it.text; listEl.style.display = 'none'; if (onPick) onPick(it); };
        item.onmouseover = function() { item.style.background = '#f0f0f0'; };
        item.onmouseout = function() { item.style.background = ''; };
        listEl.append(item);
      });
      listEl.style.display = filtered.length ? 'block' : 'none';
    }
    input.addEventListener('focus', function() { renderList(input.value); });
    input.addEventListener('input', function() { renderList(input.value); });
    input.addEventListener('blur', function() { setTimeout(function() { listEl.style.display = 'none'; }, 200); });
  },

  docTypeMeta(type) {
    const types = {
      incoming: { label: "▼ หนังสือรับ", short: "▼ หนังสือรับ" },
      outgoing: { label: "▲ หนังสือส่ง", short: "▲ หนังสือส่ง" },
      incoming_reg: { label: "▭ ทะเบียนหนังสือรับ", short: "▭ ทะเบียนรับ" },
      outgoing_reg: { label: "▭ ทะเบียนหนังสือส่ง", short: "▭ ทะเบียนส่ง" },
      order: { label: "▭ ทะเบียนคำสั่ง", short: "▭ คำสั่ง" },
      certificate: { label: "▭ ทะเบียนหนังสือรับรอง", short: "▭ รับรอง" },
      honor: { label: "▭ ทะเบียนเกียรติบัตร", short: "▭ เกียรติบัตร" },
    };
    return types[type] || { label: type, short: type };
  },

  /** เติมตัวเลือกปี พ.ศ. ให้ select ปีของหนังสือราชการ — ปีที่มีหนังสือจริง + ปีปัจจุบัน (ปีปัจจุบันขึ้นแรก เรียงใหม่ → เก่า)
   *  เมื่อขึ้นปีใหม่ 1 ม.ค. ปีใหม่จะเพิ่มขึ้นเองเป็นตัวเลือกแรก และเลขที่ทุกเมนูเริ่มรัน 1 ใหม่ (ปี พ.ศ.) */
  async _fillYearSel(sel) {
    let years = [];
    try { const d = await API.get('/document-years'); years = d.years || []; }
    catch (e) { years = [new Date().getFullYear() + 543]; }
    sel.innerHTML = '';
    sel.append(UI.h('option', { value: '' }, 'ทุกปี (พ.ศ.)'));
    years.forEach((y) => sel.append(UI.h('option', { value: String(y) }, 'ปี พ.ศ. ' + y)));
    if (years.length) sel.value = String(years[0]); // ค่าเริ่มต้น = ปีปัจจุบัน (ตัวเลือกแรก)
  },

  _currentType: 'incoming',
  async render(app) {
    let currentType = localStorage.getItem('doc_tab') || this._currentType;
    this._currentType = currentType;
    app.append(UI.h("div", { className: "page-head" },
      UI.h("div", {}, UI.h("div", { className: "page-title" }, "หนังสือราชการ"))
    ));

    // Prefetch สิทธิ์เจ้าหน้าที่ก่อนสร้างปุ่ม (กันปุ่มลงทะเบียนหนังสือรับรองหายเมื่อรีเฟรชหน้า)
    if (Auth.user && Auth.user.user_group !== 'school') {
      try { const _cs = await API.get('/cert-staff/me'); DocumentsView._isCertStaff = !!_cs.isCertStaff; } catch(_cse) { DocumentsView._isCertStaff = false; }
    }
    // === Action buttons (เจ้าหน้าที่ สพป. เห็นทุกปุ่ม, เจ้าหน้าที่สถานศึกษา เห็นเฉพาะส่งไปรษณีย์) ===
    if (!Auth.user || Auth.user.user_group !== 'school') {
      // ปุ่มทั้งหมดย้ายไปแสดงรายแท็บ (renderTabActions) เหนือช่องค้นหา
    } else {
      // Early check for school doc staff
      if (!DocumentsView._isSchoolDocStaff && DocumentsView._isSchoolDocStaff !== false) {
        try {
          const _ds = await API.get('/document-staff/me');
          DocumentsView._isSchoolDocStaff = !!_ds.schoolCode;
          if (DocumentsView._isSchoolDocStaff) { try { const _px = await API.get('/document-staff/school-prefix'); DocumentsView._schoolDocPrefix = _px.doc_prefix || ''; } catch(_e2) {} }
        } catch(_e) { DocumentsView._isSchoolDocStaff = false; }
      }
      var isSchoolDocStaff = DocumentsView._isSchoolDocStaff === true;
      if (isSchoolDocStaff) {
      }
    }

    // Check document staff status before building tabs
    try {
      const dsData = await API.get('/document-staff/me');
      try { const cs = await API.get('/cert-staff/me'); DocumentsView._isCertStaff = !!cs.isCertStaff; } catch(_cs) { DocumentsView._isCertStaff = false; }
      DocumentsView._isOfficeDocStaff = dsData.isOfficeDocStaff;
      DocumentsView._isSchoolDocStaff = !!dsData.schoolCode;
      DocumentsView._schoolDocPrefix = '';
      if (DocumentsView._isSchoolDocStaff) {
        try { const px = await API.get('/document-staff/school-prefix'); DocumentsView._schoolDocPrefix = px.doc_prefix || ''; } catch(_e) {}
      }
    } catch(_e) { DocumentsView._isOfficeDocStaff = false; DocumentsView._isSchoolDocStaff = false; DocumentsView._schoolDocPrefix = ''; }
    const isOfficeDocStaff = DocumentsView._isOfficeDocStaff === true;
    isSchoolDocStaff = DocumentsView._isSchoolDocStaff === true;
    const types = [
      { value: 'incoming', label: '▼ หนังสือรับ' },
      { value: 'outgoing', label: '▲ หนังสือส่ง' },
    ];
    if (isOfficeDocStaff || Auth.isAdmin()) {
      types.push({ value: 'incoming_reg', label: '▭ ทะเบียนหนังสือรับ' });
    }
    types.push({ value: 'outgoing_reg', label: '▭ ทะเบียนหนังสือส่ง' });
    if (Auth.user && Auth.user.user_group !== 'school') {
      types.push({ value: 'order', label: '▭ ทะเบียนคำสั่ง' });
      types.push({ value: 'certificate', label: '▭ ทะเบียนหนังสือรับรอง' });
      types.push({ value: 'honor', label: '▭ ทะเบียนเกียรติบัตร' });
    }
    // ปุ่มส่วนบน (เหนือแท็บ) — ใช้ได้ทุกแท็บ (เฉพาะฝั่ง สพป.)
    if (Auth.user && Auth.user.user_group !== 'school') {
      const topBar = UI.h('div', { id: 'doc-top-actions', style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' } });
      topBar.append(UI.h('button', { className: 'btn btn-primary', style: { background: '#7c3aed' }, onclick: () => DocumentsView.openSendForm('office') }, '▲ ส่งหนังสือไปสถานศึกษา'));
      topBar.append(UI.h('button', { className: 'btn btn-primary', style: { background: '#7c3aed' }, onclick: () => DocumentsView.openPostalForm() }, '✉ ส่งไปรษณีย์ภายในเขต'));
      if (Auth.isAdmin()) topBar.append(UI.h('button', { className: 'btn btn-primary', style: { background: '#059669' }, onclick: () => DocumentsView.openDocStaffSettings('office') }, '⊗ กำหนดเจ้าหน้าที่สารบัญเขต'));
      if (Auth.isAdmin()) topBar.append(UI.h('button', { className: 'btn btn-primary', style: { background: '#0891b2' }, onclick: () => DocumentsView.openDocStaffSettings('school') }, '⊗ กำหนดเจ้าหน้าที่สารบัญสถานศึกษา'));
      app.append(topBar);
    }
    const seg = UI.h('div', { className: 'segment-row' });
    const segBtns = [];
    types.forEach(t => {
      const btn = UI.h("button", {
        className: 'seg-btn' + (currentType === t.value ? ' active' : ''),
        onclick: () => {
          segBtns.forEach(x => x.classList.remove('active'));
          btn.classList.add('active');
          currentType = t.value; DocumentsView._currentType = t.value; localStorage.setItem('doc_tab', t.value);
          // เปิดแท็บใหม่ = เริ่มที่หน้าล่าสุดที่ดูค้างไว้ของแท็บนั้น (ไม่มี = หน้า 1)
          currentPage = parseInt(localStorage.getItem('doc_page_' + currentType), 10) || 1;
          load();
        }
      }, t.label);
      segBtns.push(btn);
    });
    
    seg.append(...segBtns);
    app.append(seg);

    // ตัวกรองปี พ.ศ. (1 ม.ค. - 31 ธ.ค.) — แสดงทุกแท็บ ไว้หลังช่องค้นหา ปีปัจจุบันเป็นตัวเลือกแรก
    // เมื่อขึ้นปีใหม่ (1 ม.ค.) ปีปัจจุบันเปลี่ยนอัตโนมัติ และเลขที่ทุกเมนูเริ่มรัน 1 ใหม่ตามปี พ.ศ.
    // ===== ปุ่มรายแท็บ (แสดงเฉพาะปุ่มของแท็บที่กำลังใช้ — เหนือช่องค้นหา) =====
    const TAB_ACTIONS = {
      incoming: [
      ],
      outgoing: [
      ],
      incoming_reg: [
        { label: '▭ ลงทะเบียนหนังสือรับ', bg: '#0f766e', show: Auth.isAdmin() || isOfficeDocStaff, click: () => { document.getElementById('modal-root').innerHTML = ''; DocumentsView.openForm(null, 'incoming'); } },
      ],
      outgoing_reg: [
        { label: '▲ ลงทะเบียนหนังสือส่ง (สพป.แพร่ เขต 2)', bg: '#2563eb', show: true, click: () => { document.getElementById('modal-root').innerHTML = ''; DocumentsView.openForm(null, 'outgoing'); } },
      ],
      order: [
        { label: '▭ ลงทะเบียนคำสั่ง', bg: '#b45309', show: true, click: () => DocumentsView.openForm(null, 'order') }
      ],
      certificate: [
        { label: '▭ ลงทะเบียนหนังสือรับรอง', bg: '#be185d', show: Auth.isAdmin() || DocumentsView._isCertStaff, click: () => DocumentsView.openForm(null, 'certificate') },
        { label: '⊗ กำหนดเจ้าหน้าที่หนังสือรับรอง', bg: '#0f766e', show: Auth.isAdmin(), click: () => DocumentsView.openCertStaffSettings() }
      ],
      honor: [
        { label: '▭ ลงทะเบียนเกียรติบัตร', bg: '#a16207', show: true, click: () => DocumentsView.openForm(null, 'honor') }
      ]
    };
    // ปุ่มฝั่งเจ้าหน้าที่สถานศึกษา — ปุ่มส่งขึ้นแถวบนเหนือแท็บ / ที่เหลือเป็นปุ่มรายแท็บ
    if (Auth.user && Auth.user.user_group === 'school') {
      const topBar = UI.h('div', { id: 'doc-top-actions', style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' } });
      topBar.append(UI.h('button', { className: 'btn btn-primary', style: { background: '#2563eb' }, onclick: () => DocumentsView.openSendForm('school') }, '▲ ส่งหนังสือไป สพป.แพร่ เขต 2'));
      topBar.append(UI.h('button', { className: 'btn btn-primary', style: { background: '#0891b2' }, onclick: () => DocumentsView.openSendForm('school_to_school') }, '▲ ส่งหนังสือไปสถานศึกษาในสังกัด'));
      app.insertBefore(topBar, seg);
      TAB_ACTIONS.outgoing = [];
      TAB_ACTIONS.outgoing_reg = [
        { label: '▭ ลงทะเบียนหนังสือส่ง', bg: '#1d4ed8', show: true, click: () => { document.getElementById('modal-root').innerHTML = ''; DocumentsView.openForm(null, 'outgoing'); } },
        { label: '🔢 กำหนดเลขหนังสือสถานศึกษา', bg: '#7c3aed', show: isSchoolDocStaff, click: () => DocumentsView.openSetSchoolDocPrefix() }
      ];
    }
    function renderTabActions() {
      const old = document.getElementById('tab-actions');
      if (old) old.remove();
      const defs = TAB_ACTIONS[currentType] || [];
      if (!defs.length) return;
      const row = UI.h('div', { id: 'tab-actions', style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' } });
      defs.forEach(d => { if (d.show) row.append(UI.h('button', { className: 'btn btn-primary', style: { background: d.bg }, onclick: d.click }, d.label)); });
      if (row.childElementCount > 0) app.insertBefore(row, document.getElementById('doc-year').closest('.filter-row'));
    }
    const yearSel = UI.h('select', { id: 'doc-year', style: { minWidth: '150px' }, onchange: () => load() });
    DocumentsView._fillYearSel(yearSel);
    // ตัวกรองกลุ่มงาน (จาก สังกัด/กลุ่มงาน) — ทุกแท็บ (ต่อจากตัวกรองปี พ.ศ.)
    const wgSel = UI.h('select', { id: 'doc-workgroup', style: { minWidth: '210px' }, onchange: () => load() },
      UI.h('option', { value: '' }, 'ทุกกลุ่มงาน'));
    // เติมรายชื่อกลุ่มงานของบุคลากร (สังกัด/กลุ่มงาน จากตาราง users — ฝั่ง สพป. เท่านั้น) ครั้งเดียวตอนเรนเดอร์
    (async function() {
      try {
        const wg = await API.get('/workplace-groups');
        (wg.groups || []).forEach(function(g) {
          g = String(g || '').trim();
          if (g && !wgSel.querySelector('option[value="' + CSS.escape(g) + '"]')) wgSel.append(UI.h('option', { value: g }, g));
        });
      } catch (e) { /* ถ้าโหลดไม่ได้ จะเติมจากข้อมูลเอกสารแทน */ }
    })();
    const filterRow = UI.h("div", { className: "filter-row", style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
      UI.h("input", { id: "doc-q", type: "search", placeholder: 'ค้นหาเรื่อง/เลขที่/หน่วยงาน...', style: { minWidth: "240px" }, oninput: () => load() }),
      yearSel,
      wgSel,
      UI.h('div', { style: { marginLeft: 'auto' } },
        UI.h('button', { className: 'btn btn-primary', style: { background: '#059669' }, title: 'ดาวน์โหลดข้อมูลเป็นไฟล์ Excel ตามตัวกรอง', onclick: () => DocumentsView.openExportDialog() }, '⬇ ดาวน์โหลดข้อมูล'))
    );
    app.append(filterRow);
    renderTabActions();

    // === Pagination: 25 รายการ/หน้า — ตัวเลือกหน้าอยู่ต่อจาก ปี พ.ศ. (เกิน 10 หน้าแสดงลูกศร) ===
    var PAGE_SIZE = 25;
    var currentPage = 1;
    var lastFiltered = [];    var meta = null;
    var cols = [];
    const pageSel = UI.h('select', { id: 'doc-page', style: { minWidth: '110px', display: 'none' }, onchange: function() { currentPage = parseInt(this.value, 10) || 1; renderTable(); } });
    filterRow.append(pageSel);

    function totalPages() { return Math.max(1, Math.ceil(lastFiltered.length / PAGE_SIZE)); }

    function renderPageSel() {
      var tp = totalPages();
      pageSel.style.display = tp > 1 ? '' : 'none';
      pageSel.innerHTML = '';
      if (tp <= 1) return;
      if (currentPage > tp) currentPage = tp;
      var maxShow = 10;
      var start = 1, end = tp;
      if (tp > maxShow) {
        // หน้าปัจจุบันอยู่กลาง ๆ — เลื่อนหน้าต่างตัวเลขให้หน้าปัจจุบันอยู่ในช่วงที่แสดง
        start = Math.max(1, currentPage - 5);
        end = Math.min(tp, start + maxShow - 1);
        if (end - start < maxShow - 1) start = Math.max(1, end - maxShow + 1);
      }
      if (currentPage > 1) pageSel.append(UI.h('option', { value: String(currentPage - 1) }, '◀'));
      for (var p = start; p <= end; p++) pageSel.append(UI.h('option', { value: String(p), selected: p === currentPage }, String(p)));
      if (currentPage < tp) pageSel.append(UI.h('option', { value: String(currentPage + 1) }, '▶'));
      pageSel.value = String(currentPage);
    }

    function renderTable() {
      var all = lastFiltered;
      card.innerHTML = '';
      var unreadCount = all.filter(function(d) { return d.is_read !== undefined && !d.is_read; }).length;
      var titleSuffix = (currentType === 'incoming' || currentType === 'incoming_reg') && unreadCount > 0 ? ` (${unreadCount} รายการใหม่)` : '';
      card.append(UI.h('div', { className: 'card-title' }, `▭ ${meta.label} (${all.length} รายการ)${titleSuffix}`));
      if (!all.length) {
        // คำใบ้เมื่อว่าง: ถ้ากำลังกรองปีอยู่ บอกผู้ใช้ว่าอาจมีรายการในปีอื่น (ตัวกรองปีเริ่มที่ปีปัจจุบันเสมอ เช่น ขึ้นปีใหม่ 1 ม.ค.)
        const yearEl0 = document.getElementById('doc-year');
        const ySel0 = yearEl0 ? yearEl0.value : '';
        if (ySel0) {
          card.append(UI.h('div', { style: { textAlign: 'center', padding: '26px 10px' } },
            UI.h('div', { style: { fontSize: '34px' } }, '▭'),
            UI.h('div', { style: { marginTop: '6px' } }, 'ไม่มีรายการในปี พ.ศ. ' + ySel0 + ' ของทะเบียนนี้'),
            UI.h('div', { className: 'hint', style: { marginTop: '4px' } }, 'อาจมีรายการอยู่ในปีก่อนหน้า — ตัวกรองปีเริ่มที่ปีปัจจุบันเสมอ'),
            UI.h('button', { className: 'btn btn-outline btn-sm', style: { marginTop: '10px' }, onclick: function () { yearEl0.value = ''; load(); } }, '📋 ดูทุกปี')));
        } else {
          card.append(UI.empty('ยังไม่มีข้อมูลในทะเบียนนี้', '▭'));
        }
        renderPageSel(); return;
      }
      if (currentPage > totalPages()) currentPage = totalPages();
      if (currentPage < 1) currentPage = 1;
      // จำหน้าล่าสุดของแท็บนี้ไว้ (เปิดแท็บใหม่กลับมาที่หน้าเดิม)
      try { localStorage.setItem('doc_page_' + currentType, String(currentPage)); } catch(e) {}
      var slice = all.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
      card.append(UI.table(cols, slice));
      renderPageSel();
    }

    const card = UI.h("div", { className: "card" }, UI.loading());
    app.append(card);

    async function load() {
      renderTabActions();
      // _isOfficeDocStaff already set in render()
      const q = document.getElementById('doc-q').value.trim();
      const yearEl = document.getElementById('doc-year');
      const year = yearEl ? yearEl.value : '';
      // ตัวกรองกลุ่มงาน — แสดง/ใช้ได้ทุกแท็บ
      const wgEl = document.getElementById('doc-workgroup');
      if (wgEl) wgEl.style.display = '';
      const qs = [];
      if (q) qs.push('q=' + encodeURIComponent(q));
      if (year) qs.push('year=' + encodeURIComponent(year));
      if (wgEl && wgEl.value) qs.push('workgroup=' + encodeURIComponent(wgEl.value));
      let url;
      // Use /my-incoming for incoming documents to show only docs sent to current user
      if (currentType === 'incoming') {
        url = '/my-incoming' + (qs.length ? '?' + qs.join('&') : '');
      } else if (currentType === 'incoming_reg') {
        url = '/my-incoming-registered' + (qs.length ? '?' + qs.join('&') : '');
      } else if (currentType === 'outgoing_reg') {
        url = '/my-outgoing-registered' + (qs.length ? '?' + qs.join('&') : '');
      } else if (currentType === 'order') {
        url = '/my-orders' + (qs.length ? '?' + qs.join('&') : '');
      } else if (currentType === 'certificate') {
        url = '/my-certificates' + (qs.length ? '?' + qs.join('&') : '');
      } else if (currentType === 'honor') {
        url = '/my-honors' + (qs.length ? '?' + qs.join('&') : '');
      } else {
        url = '/documents?';
        if (qs.length) url += qs.join('&') + '&';
        if (currentType) url += 'doc_type=' + encodeURIComponent(currentType);
      }
      try {
        const data = await API.get(url);
        meta = DocumentsView.docTypeMeta(currentType);
        lastFiltered = data.documents || [];
        // เติมตัวเลือกกลุ่มงานจากข้อมูลจริงของแท็บปัจจุบัน + รายชื่อกลุ่มงานของบุคลากร (สะสม — คงตัวเลือกเดิมไว้ ไม่รีเซ็ตการเลือก)
        if (wgEl) {
          var have = {};
          [].slice.call(wgEl.options).forEach(function(o) { if (o.value) have[o.value] = true; });
          var seen = {};
          lastFiltered.forEach(function(d) {
            var w = (d.workgroup || '').trim();
            if (w && !have[w] && !seen[w]) { seen[w] = true; wgEl.append(UI.h('option', { value: w }, w)); }
          });
        }
        currentPage = parseInt(localStorage.getItem('doc_page_' + currentType), 10) || 1;
        cols = [
          {
            key: 'doc_type', label: 'ประเภท', render: (r) => {
              const m = DocumentsView.docTypeMeta(r.doc_type);
              const colors = {
                incoming: { background: '#dbeafe', color: '#1d4ed8' },
                outgoing: { background: '#dcfce7', color: '#15803d' },
                order: { background: '#fef3c7', color: '#b45309' },
                certificate: { background: '#fce7f3', color: '#be185d' },
                honor: { background: '#fef9c3', color: '#a16207' },
              };
              const c = colors[r.doc_type] || { background: '#f1f5f9', color: '#334155' };
              return UI.h('span', { className: 'status-pill', style: { ...c, padding: '3px 10px', borderRadius: '999px', fontWeight: 700, fontSize: '12.5px', whiteSpace: 'nowrap', minWidth: '120px', display: 'inline-block', textAlign: 'center' } }, m.short);
            } },
          { key: 'doc_no', label: 'เลขที่หนังสือ' },
          { key: 'title', label: 'เรื่อง' },
          { key: 'from_org', label: 'จาก' },
          { key: 'to_org', label: 'ถึง' },
          { key: 'date', label: 'วันที่', render: (r) => UI.date(r.date) },
          { key: 'category', label: 'หมวดหมู่' },
          { key: 'file', label: 'ไฟล์', render: (r) => {
              // แทปหนังสือรับ = ไฟล์แนบเก่า (ต้นฉบับจากผู้ส่ง) | แทปทะเบียนหนังสือรับ = ไฟล์แนบใหม่ (ไฟล์ปั้มรับ) | แทปอื่น = ทุกไฟล์
              var files = [];
              if (r.file) { try { var arr = JSON.parse(r.file); files = Array.isArray(arr) ? arr : [r.file]; } catch (e) { files = [r.file]; } }
              if (!files.length) return UI.fileLink(null);
              if (currentType === 'incoming_reg') return UI.fileLink(files[files.length - 1]);
              if (currentType === 'incoming') return UI.fileLink(files[0]);
              // หนังสือส่ง (มุมมองสถานศึกษา): รายการที่สารบัญเขตปั้ม/ลงทะเบียนแล้ว แสดงเฉพาะไฟล์ต้นฉบับ ไม่แสดงไฟล์ปั้ม
              if (currentType === 'outgoing' && r.is_registered) return UI.fileLink(files[0]);
              return UI.fileLink(r.file);
            } },
        ];
        // หนังสือรับ/หนังสือส่ง (ทุกแทป): เอาคอลัมน์ ประเภท ออก
        if (['incoming', 'incoming_reg', 'outgoing', 'outgoing_reg'].includes(currentType)) {
          var dtIdx = cols.findIndex(c => c.key === 'doc_type');
          if (dtIdx >= 0) cols.splice(dtIdx, 1);
        }
        // เกียรติบัตร: แสดงคอลัมน์รวม ชื่อ-นามสกุล, โรงเรียน ฯลฯ + ปรับชุดคอลัมน์
        if (currentType === 'honor') {
          cols.splice(2, 0, { key: 'person_name', label: 'ชื่อ-นามสกุล, โรงเรียน ฯลฯ', render: (r) => UI.h('span', {}, ((r.person_name || '-') + (r.person_school ? ' | ' + r.person_school : ''))) });
          // เอาคอลัมน์ ประเภท / จาก / ถึง / หมวดหมู่ ออก และเปลี่ยนชื่อเลขที่หนังสือ → เลขเกียรติบัตร
          cols.shift();
          var noCol = cols.find(c => c.key === 'doc_no');
          if (noCol) noCol.label = 'เลขเกียรติบัตร';
          ['from_org', 'to_org', 'category'].forEach(function(k) {
            var i = cols.findIndex(c => c.key === k);
            if (i >= 0) cols.splice(i, 1);
          });
          // เพิ่มคอลัมน์ผู้ลงนามก่อนไฟล์
          var fileIdx = cols.findIndex(c => c.key === 'file');
          cols.splice(fileIdx >= 0 ? fileIdx : cols.length, 0, {
            key: 'honor_signer', label: 'ผู้ลงนาม', render: (r) => UI.h('span', {}, r.signer_name || '-')
          });
          // คอลัมน์ พิมพ์ — ไฟล์เกียรติบัตรที่บันทึกไว้ เพื่อสั่งพิมพ์ (ไม่ต้องเปิดฟอร์ม)
          var signerIdx = cols.findIndex(c => c.key === 'honor_signer');
          cols.splice(signerIdx >= 0 ? signerIdx + 1 : cols.length, 0, {
            key: 'honor_saved_file', label: 'พิมพ์', render: (r) => {
              if (!r.honor_saved_file) return UI.h('span', { style: { color: '#94a3b8', fontSize: '12.5px' } }, '—');
              return UI.h('button', {
                className: 'btn btn-outline',
                style: { fontSize: '12.5px', padding: '4px 10px', borderColor: '#7c3aed', color: '#7c3aed' },
                title: 'พิมพ์จากไฟล์เกียรติบัตรที่บันทึกไว้',
                onclick: () => DocumentsView.printHonorFile(r.honor_saved_file)
              }, '🖨 พิมพ์');
            }
          });
        }
        // คำสั่ง: ย้ายวันที่ไปต่อจากเลขที่คำสั่ง + เพิ่มคอลัมน์เจ้าของคำสั่ง ต่อจากเรื่อง (เอาคอลัมน์ ประเภท/จาก/ถึง/หมวดหมู่ ออก)
        if (currentType === 'order') {
          ['doc_type', 'from_org', 'to_org', 'category'].forEach(function(k) {
            var i = cols.findIndex(c => c.key === k);
            if (i >= 0) cols.splice(i, 1);
          });
          var noColOrder = cols.find(c => c.key === 'doc_no');
          if (noColOrder) noColOrder.label = 'เลขที่คำสั่ง';
          var dateColOrder = null;
          var dateIdxOrder = cols.findIndex(c => c.key === 'date');
          if (dateIdxOrder >= 0) dateColOrder = cols.splice(dateIdxOrder, 1)[0];
          if (dateColOrder) { dateColOrder.label = 'สั่ง ณ วันที่'; }
          var noIdxOrder = cols.findIndex(c => c.key === 'doc_no');
          if (dateColOrder) cols.splice(noIdxOrder >= 0 ? noIdxOrder + 1 : 0, 0, dateColOrder);
          var titleIdxOrder = cols.findIndex(c => c.key === 'title');
          cols.splice(titleIdxOrder >= 0 ? titleIdxOrder + 1 : cols.length, 0, { key: 'owner_group', label: 'เจ้าของคำสั่ง', render: (r) => UI.h('span', {}, r.owner_group || '-') });
          var ogIdxOrder = cols.findIndex(c => c.key === 'owner_group');
          cols.splice(ogIdxOrder >= 0 ? ogIdxOrder + 1 : cols.length, 0, { key: 'order_registrar', label: 'ผู้ลงทะเบียน', render: (r) => UI.h('span', {}, r.order_registrar || '-') });
        }
        // หนังสือรับรอง: เอาคอลัมน์ ประเภท/จาก/ถึง/หมวดหมู่ ออก และย้าย วันที่ ไปต่อจากเลขที่หนังสือ
        if (currentType === 'certificate') {
          cols.splice(0, 0, { key: 'cert_status', label: 'สถานะ', render: (r) => UI.h('span', { className: 'cert-status ' + (r.cert_status === 'เสร็จแล้ว' ? 'done' : 'processing') }, r.cert_status || 'กำลังดำเนินการ') });
          ['doc_type', 'from_org', 'to_org', 'category'].forEach(function(k) {
            var i = cols.findIndex(c => c.key === k);
            if (i >= 0) cols.splice(i, 1);
          });
          var dateColCert = null;
          var dateIdxCert = cols.findIndex(c => c.key === 'date');
          if (dateIdxCert >= 0) dateColCert = cols.splice(dateIdxCert, 1)[0];
          var noIdxCert = cols.findIndex(c => c.key === 'doc_no');
          if (dateColCert) cols.splice(noIdxCert >= 0 ? noIdxCert + 1 : 0, 0, dateColCert);
          // เพิ่มคอลัมน์ ผู้ขอ ต่อจากเรื่อง และ เจ้าหน้าที่(ผู้ปฏิบัติ) ต่อจากผู้ขอ
          var titleIdxCert = cols.findIndex(c => c.key === 'title');
          cols.splice(titleIdxCert >= 0 ? titleIdxCert + 1 : cols.length, 0, { key: 'requester', label: 'ผู้ขอ', render: (r) => UI.h('span', {}, r.requester || '-') });
          // คอลัมน์ ตำแหน่ง — ต่อจากผู้ขอ
          var reqIdxCert = cols.findIndex(c => c.key === 'requester');
          cols.splice(reqIdxCert >= 0 ? reqIdxCert + 1 : cols.length, 0, { key: 'cert_position', label: 'ตำแหน่ง', render: (r) => UI.h('span', {}, r.cert_position || '-') });
          cols.splice(cols.length, 0, { key: 'officer', label: 'เจ้าหน้าที่(ผู้ปฏิบัติ)', render: (r) => UI.h('span', {}, r.officer || '-') });
          // คอลัมน์ พิมพ์ — เปิดแบบฟอร์ม A4 ของรายการนั้น (พิมพ์ซ้ำได้ ไม่ต้องเปิดฟอร์มแก้ไข)
          cols.splice(cols.length, 0, {
            key: 'cert_print', label: 'พิมพ์', render: (r) => UI.h('button', {
              className: 'btn btn-outline',
              style: { fontSize: '12.5px', padding: '4px 10px', borderColor: '#0f766e', color: '#0f766e', whiteSpace: 'nowrap' },
              title: 'แสดงแบบฟอร์ม A4 เพื่อพิมพ์',
              onclick: () => DocumentsView.showCertificateFormA4(r)
            }, '🖨 พิมพ์')
          });
        }
        // Add read status for incoming documents
        // Add reg_no column for incoming_reg
        if (currentType === 'incoming_reg') {
          cols.splice(0, 0, { key: 'reg_no', label: 'เลขหนังสือรับ' });          // Replace to_org with workgroup for incoming_reg
          var toIdx = cols.findIndex(c => c.key === 'to_org');
          if (toIdx >= 0) cols.splice(toIdx, 1, { key: 'workgroup', label: 'กลุ่มปฏิบัติ' });
          // เอาคอลัมน์ หมวดหมู่ ออก
          var catIdxReg = cols.findIndex(c => c.key === 'category');
          if (catIdxReg >= 0) cols.splice(catIdxReg, 1);
        }
        if (currentType === 'incoming') {
          cols.splice(0, 0, {
            key: 'is_read', label: 'สถานะ', render: (r) => {
              if (r.is_read === undefined) return UI.h('span', { style: { color: '#94a3b8' } }, '-');
              return r.is_read 
                ? UI.h('span', { style: { color: '#10b981', fontWeight: '600' } }, '● อ่านแล้ว')
                : UI.h('span', { style: { color: '#f59e0b', fontWeight: '600' } }, '🆕 ใหม่');
            }
          });
          var catIdxIn = cols.findIndex(x => x.key === 'category');
          if (catIdxIn >= 0) cols.splice(catIdxIn, 1);
        }
        // Preload recipient counts for outgoing documents
        var recipientCounts = {};
        if (currentType === 'outgoing' && data.documents.length) {
          try {
            const counts = await Promise.all(data.documents.map(d => 
              API.get('/document-recipients/' + d.id).then(r => ({ id: d.id, count: r.recipients ? r.recipients.length : 0 })).catch(() => ({ id: d.id, count: 0 }))
            ));
            counts.forEach(c => recipientCounts[c.id] = c.count);
          } catch(e) {}
          cols.splice(0, 0, {
            key: 'recipients', label: 'ผู้รับ', render: (r) => {
              const count = recipientCounts[r.id] || 0;
              const span = UI.h('span', {
                style: { color: count > 0 ? '#10b981' : '#94a3b8', fontWeight: '600', cursor: count > 0 ? 'pointer' : 'default', textDecoration: count > 0 ? 'underline dotted' : 'none' },
                onclick: count > 0 ? async function(e) {
                  e.stopPropagation();
                  try {
                    const data = await API.get('/document-recipients/' + r.id);
                    const recips = data.recipients || [];
                    const readCount = recips.filter(function(x){return x.is_read}).length;
                    var rows = '';
                    recips.forEach(function(rp, idx2) {
                      var bg = idx2 % 2 === 0 ? '#fff' : '#f8fafc';
                      var statusHtml = rp.is_read ? '<span style="color:#16a34a;font-weight:600">● อ่านแล้ว</span>' : '<span style="color:#ea580c;font-weight:600">● ยังไม่อ่าน</span>';
                      var readAtHtml = rp.read_at ? '<br><span style="color:#94a3b8;font-size:11px">' + rp.read_at + '</span>' : '';
                      rows += '<tr style="background:' + bg + ';border-bottom:1px solid #f1f5f9">';
                      rows += '<td style="padding:8px 6px;text-align:center">' + (idx2 + 1) + '</td>';
                      rows += '<td style="padding:8px 6px">' + (rp.title || '') + ' ' + (rp.full_name || '-') + '</td>';
                      rows += '<td style="padding:8px 6px">' + (rp.position || '-') + '</td>';
                      // รับในฐานะสารบัญสถานศึกษา → แสดงโรงเรียนที่รับ (as_school) ไม่ใช่ workplace ของ user
                      rows += '<td style="padding:8px 6px">' + (rp.as_school_label || rp.workplace || '-') + '</td>';
                      rows += '<td style="padding:8px 6px;text-align:center">' + statusHtml + readAtHtml + '</td>';
                      rows += '</tr>';
                    });
                    var html = '<div style="padding:4px;max-height:60vh;overflow-y:auto">' +
                      '<div style="margin-bottom:10px;font-size:13px;color:#64748b">อ่านแล้ว <b style="color:#16a34a">' + readCount + '</b> / ' + recips.length + ' คน</div>' +
                      '<table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">' +
                      '<thead><tr style="background:#f1f5f9;border-bottom:2px solid #e2e8f0">' +
                      '<th style="padding:10px 6px;text-align:center;width:40px">ลำดับ</th>' +
                      '<th style="padding:10px 6px;text-align:left">ชื่อ-สกุล</th>' +
                      '<th style="padding:10px 6px;text-align:left">ตำแหน่ง</th>' +
                      '<th style="padding:10px 6px;text-align:left">สังกัด/กลุ่มงาน</th>' +
                      '<th style="padding:10px 6px;text-align:center">สถานะ</th>' +
                      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
                    UI.modal({ title: '▭ รายชื่อผู้รับหนังสือส่ง — ' + r.title, body: UI.h('div', { html: html }), size: 'lg' });
                  } catch (err) { UI.toast(err.message, 'error'); }
                } : undefined
              }, count + ' คน');
              return span;
            }
          });
        }
        // Remove category column for outgoing and outgoing_reg
        if (currentType === 'outgoing') {
          var catIdxOut = cols.findIndex(x => x.key === 'category');
          if (catIdxOut >= 0) cols.splice(catIdxOut, 1);
        }
        if (currentType === 'outgoing_reg') {
          // เอาคอลัมน์ จาก / ถึง(เดิม) / หมวดหมู่ ออก
          ['from_org', 'to_org', 'category'].forEach(function(k) {
            var i = cols.findIndex(c => c.key === k);
            if (i >= 0) cols.splice(i, 1);
          });
          // เพิ่มคอลัมน์ ถึง + กลุ่มปฏิบัติ ต่อจากเรื่อง
          var titleIdxReg = cols.findIndex(c => c.key === 'title');
          cols.splice(titleIdxReg >= 0 ? titleIdxReg + 1 : cols.length, 0, { key: 'to_org', label: 'ถึง', render: (r) => UI.h('span', {}, r.to_org || '-') });
          var toIdxReg = cols.findIndex(c => c.key === 'to_org');
          cols.splice(toIdxReg >= 0 ? toIdxReg + 1 : cols.length, 0, { key: 'workgroup', label: 'กลุ่มปฏิบัติ', render: (r) => UI.h('span', {}, r.workgroup || '-') });
        }
        cols.push({
          key: 'actions', label: '',
          render: (r) => UI.h('div', { className: 'status-btns' },
            UI.actionBtn('👁️', () => DocumentsView.openView(r)),
            currentType === 'certificate' && r.cert_status !== 'เสร็จแล้ว' && (Auth.isAdmin() || DocumentsView._isCertStaff) ? UI.h('button', { className: 'btn btn-outline cert-done-btn', style: { fontSize: '12.5px', padding: '4px 10px', borderColor: '#16a34a', color: '#16a34a' }, title: 'ดำเนินการเสร็จแล้ว', onclick: () => DocumentsView.markCertDone(r) }, '✓') : null,
            currentType === 'incoming' && (Auth.isAdmin() || DocumentsView._isOfficeDocStaff) ? UI.actionBtn('▼ ลงทะเบียน', () => DocumentsView.openIncomingRegister(r)) : null,
            (currentType === 'certificate' && !(Auth.isAdmin() || DocumentsView._isCertStaff)) ? null : (Auth.isAdmin() || DocumentsView._isOfficeDocStaff || r.created_by === Auth.user.id) ? UI.actionBtn('✎', () => DocumentsView.openForm(r)) : null,
            // แทปทะเบียนหนังสือรับ: ปุ่ม ✕ = นำออกจากทะเบียน (หนังสือไม่ถูกลบ — ยังอยู่ในหนังสือรับ/หนังสือส่ง)
            currentType === 'incoming_reg' ? UI.actionBtn('✕', () => DocumentsView.unregister(r), 'danger-btn') :
            (currentType === 'certificate' && !(Auth.isAdmin() || DocumentsView._isCertStaff)) ? null : (Auth.isAdmin() || DocumentsView._isOfficeDocStaff || r.created_by === Auth.user.id) ? UI.actionBtn('✕', () => DocumentsView.remove(r), 'danger-btn') : null,
            // ปุ่มซองจดหมาย (เฉพาะแท็บทะเบียนหนังสือรับ) — เปิดส่งไปรษณีย์ภายในเขต โดยดึงข้อมูลของรายการนั้น
            currentType === 'incoming_reg' ? UI.actionBtn('✉️', () => DocumentsView.openPostalFromRegistry(r)) : null),
        });
        renderTable();
      } catch (e) {
        card.innerHTML = '';
        card.append(UI.empty(e.message, '⚠️'));
      }
    }
    load();
  },

  /** ปุ่ม ⬇ ดาวน์โหลดข้อมูล (ทุกแท็บ): เปิดหน้าต่างตัวกรอง ปี พ.ศ. / เดือน / สัปดาห์ แล้วดาวน์โหลดเป็นไฟล์ Excel
   *  คอลัมน์ตรงกับตารางของแต่ละแท็บ (ไม่รวมคอลัมน์ปุ่มจัดการ) */
  async openExportDialog() {
    const self = this;
    const currentType = this._currentType || 'incoming';
    const meta = this.docTypeMeta(currentType);
    const TH_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
    const TH_M_ABBR = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const pad = (n) => (n < 10 ? '0' : '') + n;
    // ชุดคอลัมน์ export ต่อแท็บ — ตามลำดับตารางจริง (ไม่รวมคอลัมน์ปุ่ม)
    const EXPORT_COLS = {
      incoming: [['is_read','สถานะ'],['doc_no','เลขที่หนังสือ'],['title','เรื่อง'],['from_org','จาก'],['to_org','ถึง'],['date','วันที่'],['file','ไฟล์แนบ']],
      incoming_reg: [['reg_no','เลขหนังสือรับ'],['doc_no','เลขที่หนังสือ'],['title','เรื่อง'],['from_org','จาก'],['workgroup','กลุ่มปฏิบัติ'],['date','วันที่'],['file','ไฟล์แนบ']],
      outgoing: [['recipients','ผู้รับ'],['doc_no','เลขที่หนังสือ'],['title','เรื่อง'],['from_org','จาก'],['to_org','ถึง'],['date','วันที่'],['file','ไฟล์แนบ']],
      outgoing_reg: [['doc_no','เลขที่หนังสือ'],['title','เรื่อง'],['to_org','ถึง'],['workgroup','กลุ่มปฏิบัติ'],['date','วันที่'],['file','ไฟล์แนบ']],
      order: [['doc_no','เลขที่คำสั่ง'],['date','สั่ง ณ วันที่'],['title','เรื่อง'],['owner_group','เจ้าของคำสั่ง'],['order_registrar','ผู้ลงทะเบียน'],['file','ไฟล์แนบ']],
      certificate: [['cert_status','สถานะ'],['doc_no','เลขที่หนังสือ'],['date','วันที่'],['title','เรื่อง'],['requester','ผู้ขอ'],['cert_position','ตำแหน่ง'],['officer','เจ้าหน้าที่(ผู้ปฏิบัติ)'],['file','ไฟล์แนบ']],
      honor: [['doc_no','เลขเกียรติบัตร'],['person','ชื่อ-นามสกุล, โรงเรียน ฯลฯ'],['title','เรื่อง'],['date','วันที่'],['signer_name','ผู้ลงนาม'],['file','ไฟล์แนบ']],
    };
    const colDefs = EXPORT_COLS[currentType] || [['doc_no','เลขที่หนังสือ'],['title','เรื่อง'],['from_org','จาก'],['to_org','ถึง'],['date','วันที่']];
    // รายการปีเดียวกับตัวกรองปีของหน้า
    let years = [];
    try { const d = await API.get('/document-years'); years = d.years || []; }
    catch (e) { years = [new Date().getFullYear() + 543]; }
    const yearSel = UI.h('select', { style: { minWidth: '170px' }, onchange: () => fillWeeks() });
    yearSel.append(UI.h('option', { value: '' }, 'ทุกปี (พ.ศ.)'));
    years.forEach((y) => yearSel.append(UI.h('option', { value: String(y) }, 'ปี พ.ศ. ' + y)));
    const curYearEl = document.getElementById('doc-year');
    yearSel.value = curYearEl && curYearEl.value ? curYearEl.value : (years[0] ? String(years[0]) : '');
    const monthSel = UI.h('select', { style: { minWidth: '160px' }, onchange: () => fillWeeks() });
    monthSel.append(UI.h('option', { value: '' }, 'ทุกเดือน'));
    for (let m = 0; m < 12; m++) monthSel.append(UI.h('option', { value: String(m + 1) }, TH_MONTHS[m]));
    const weekSel = UI.h('select', { style: { minWidth: '230px' }, disabled: true });
    weekSel.append(UI.h('option', { value: '' }, 'ทุกสัปดาห์'));
    // สัปดาห์ของเดือนที่เลือก (ยึดวันจันทร์ - อาทิตย์) — เลือกเดือนก่อนจึงเปิดให้เลือก
    function fillWeeks() {
      weekSel.innerHTML = '';
      weekSel.append(UI.h('option', { value: '' }, 'ทุกสัปดาห์'));
      const yBE = parseInt(yearSel.value, 10) || 0, m = parseInt(monthSel.value, 10) || 0;
      if (!yBE || !m) { weekSel.disabled = true; weekSel.value = ''; return; }
      weekSel.disabled = false;
      const yCE = yBE - 543;
      const monthStart = new Date(yCE, m - 1, 1), monthEnd = new Date(yCE, m - 1, new Date(yCE, m, 0).getDate());
      let start = new Date(monthStart);
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // ถอยไปวันจันทร์ของสัปดาห์แรก
      let n = 1;
      for (let i = 0; i < 6; i++) {
        const end = new Date(start); end.setDate(end.getDate() + 6);
        if (end < monthStart) { start.setDate(start.getDate() + 7); continue; }
        if (start > monthEnd) break;
        const s = new Date(Math.max(start.getTime(), monthStart.getTime()));
        const e = new Date(Math.min(end.getTime(), monthEnd.getTime()));
        const fmt = (x) => x.getDate() + ' ' + TH_M_ABBR[x.getMonth()];
        weekSel.append(UI.h('option', { value: s.getFullYear() + '-' + pad(s.getMonth() + 1) + '-' + pad(s.getDate()) + '|' + e.getFullYear() + '-' + pad(e.getMonth() + 1) + '-' + pad(e.getDate()) }, `สัปดาห์ที่ ${n} (${fmt(s)} - ${fmt(e)} ${s.getFullYear() + 543})`));
        start.setDate(start.getDate() + 7); n++;
      }
    }
    const rowOf = (label, sel) => UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
      UI.h('div', { style: { width: '90px', fontWeight: 600, fontSize: '13.5px', color: '#334155' } }, label), sel);
    const body = UI.h('div', { style: { padding: '4px 2px' } },
      UI.h('div', { style: { marginBottom: '12px', fontWeight: 700, fontSize: '13.5px', color: '#0f766e' } }, `แท็บ: ${meta.label.replace('▭ ', '')}`),
      UI.h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        rowOf('ปี พ.ศ.', yearSel),
        rowOf('เดือน', monthSel),
        rowOf('สัปดาห์', weekSel),
        UI.h('div', { className: 'hint', style: { marginTop: '4px' } }, 'เลือกได้ทั้ง 3 ช่องหรือเฉพาะบางช่อง — เว้นไว้หมด = ดาวน์โหลดทุกรายการของแท็บนี้')));
    async function doExport() {
      const yBE = yearSel.value, m = parseInt(monthSel.value, 10) || 0;
      const wk = (weekSel.value || '').split('|');
      const qs = [];
      if (yBE) qs.push('year=' + encodeURIComponent(yBE));
      // URL เดียวกับ load() ของแท็บปัจจุบัน (ไม่ใช้ช่องค้นหา — ใช้ตัวกรองของหน้าต่างนี้)
      let url;
      if (currentType === 'incoming') url = '/my-incoming' + (qs.length ? '?' + qs.join('&') : '');
      else if (currentType === 'incoming_reg') url = '/my-incoming-registered' + (qs.length ? '?' + qs.join('&') : '');
      else if (currentType === 'outgoing_reg') url = '/my-outgoing-registered' + (qs.length ? '?' + qs.join('&') : '');
      else if (currentType === 'order') url = '/my-orders' + (qs.length ? '?' + qs.join('&') : '');
      else if (currentType === 'certificate') url = '/my-certificates' + (qs.length ? '?' + qs.join('&') : '');
      else if (currentType === 'honor') url = '/my-honors' + (qs.length ? '?' + qs.join('&') : '');
      else { url = '/documents?' + (qs.length ? qs.join('&') + '&' : '') + 'doc_type=' + encodeURIComponent(currentType); }
      try {
        UI.toast('กำลังเตรียมข้อมูล...', 'success', 1500);
        const data = await API.get(url);
        let docs = data.documents || [];
        // กรองตามเดือน/สัปดาห์ จากวันที่เอกสาร (r.date = YYYY-MM-DD)
        if (m) docs = docs.filter((r) => r.date && parseInt(String(r.date).slice(5, 7), 10) === m);
        if (wk.length === 2 && wk[0]) docs = docs.filter((r) => r.date && String(r.date) >= wk[0] && String(r.date) <= wk[1]);
        // ผู้รับ (แท็บหนังสือส่ง): ดึงจำนวนผู้รับแต่ละรายการ
        const recCounts = {};
        if (currentType === 'outgoing' && docs.length) {
          try {
            const counts = await Promise.all(docs.map((d) => API.get('/document-recipients/' + d.id).then((r) => ({ id: d.id, count: r.recipients ? r.recipients.length : 0 })).catch(() => ({ id: d.id, count: 0 }))));
            counts.forEach((c) => { recCounts[c.id] = c.count; });
          } catch (e) { /* ignore */ }
        }
        const cell = (key, r) => {
          if (key === 'is_read') return r.is_read === undefined ? '' : (r.is_read ? 'อ่านแล้ว' : 'ใหม่');
          if (key === 'date') return r.date ? UI.date(r.date) : '';
          if (key === 'recipients') return recCounts[r.id] != null ? recCounts[r.id] : '';
          if (key === 'person') return (r.person_name || '-') + (r.person_school ? ' | ' + r.person_school : '');
          if (key === 'file') {
            if (!r.file) return '';
            var arr = []; try { var a = JSON.parse(r.file); arr = Array.isArray(a) ? a : [r.file]; } catch (e) { arr = [r.file]; }
            return arr.map((p) => String(p).split('/').pop()).join(', ');
          }
          var v = r[key];
          return v === null || v === undefined ? '' : String(v);
        };
        const headers = colDefs.map((c) => c[1]);
        const rows = docs.map((r) => colDefs.map((c) => cell(c[0], r)));
        const filt = [];
        if (yBE) filt.push('ปี ' + yBE);
        if (m) filt.push(TH_MONTHS[m - 1]);
        if (wk.length === 2 && wk[0]) filt.push(weekSel.options[weekSel.selectedIndex] ? weekSel.options[weekSel.selectedIndex].textContent : '');
        const fname = ('หนังสือราชการ_' + meta.label.replace('▭ ', '').replace(/\s+/g, '') + (filt.length ? '_' + filt.join('_') : '')).replace(/[\\/:*?"<>|]/g, '');
        UI.exportExcel(fname, meta.label.replace('▭ ', '') + (filt.length ? ' (' + filt.join(' | ') + ')' : ''), headers, rows);
        if (m2) m2.close();
        UI.toast(`ดาวน์โหลดแล้ว ${docs.length} รายการ`, 'success');
      } catch (e) { UI.toast(e.message, 'error'); }
    }
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => document.getElementById('modal-root').innerHTML = '' }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', style: { background: '#059669' }, onclick: doExport }, '⬇ ดาวน์โหลด Excel'));
    const m2 = UI.modal({ title: '⬇ ดาวน์โหลดข้อมูล', body, footer: foot, size: 'md' });
    fillWeeks();
  },
  /** เปิดฟอร์มลงทะเบียนรับหนังสือ โดยดึงข้อมูลจากรายการหนังสือรับที่เลือกมากรอกให้อัตโนมัติ */
  openIncomingRegister(d) {
    const prefill = {
      id: d.id,
      doc_type: 'incoming',
      from_org: d.from_org || '',
      doc_no: d.doc_no || '',
      title: d.title || '',
      date: d.date || '',
      note: d.note || '',
      reg_no: d.reg_no || '',
      workgroup: d.workgroup || '',
      file: d.file || ''
    };
    DocumentsView.openForm(prefill, 'incoming');
  },

  /** ปุ่มซองจดหมาย (แท็บทะเบียนหนังสือรับ): เปิดหน้าต่าง ส่งไปรษณีย์ภายในเขต
   *  ดึงข้อมูลจากรายการทะเบียนนั้น — วันที่ส่ง, เรื่อง, ข้อความ, ไฟล์แนบ (ไฟล์ใหม่ที่ปั้มรับแล้ว) */
  async openPostalFromRegistry(r) {
    // ไฟล์แนบใหม่ (ไฟล์ปั้มรับ) = ไฟล์ล่าสุดในรายการ — เหมือนคอลัมน์ ไฟล์ ของแท็บนี้
    var filePaths = [];
    if (r.file) { try { var arr = JSON.parse(r.file); filePaths = Array.isArray(arr) ? arr : [r.file]; } catch (e) { filePaths = [r.file]; } }
    var fileObjs = [];
    if (filePaths.length) {
      var path = filePaths[filePaths.length - 1];
      try {
        var resp = await fetch('/uploads/' + path);
        if (resp.ok) {
          var blob = await resp.blob();
          var name = String(path).split('/').pop();
          fileObjs.push(new File([blob], name, { type: blob.type || 'application/octet-stream' }));
        }
      } catch (e) { /* ไม่มีไฟล์ก็เปิดฟอร์มได้ปกติ */ }
    }
    const msg = (r.body_text && String(r.body_text).trim()) ? r.body_text : (r.note || '');
    DocumentsView.openPostalForm(fileObjs, { title: r.title || '', message: msg, date: r.date || '' });
  },

  /** แบบฟอร์มหนังสือรับรอง ขนาด A4 — โลโก้ big_krut.png จัดกลางบนหัวกระดาษ ฟอนต์ THSarabunIT๙ 18px ทั้งหมด
   *  บรรทัดถัดจากโลโก้: ซ้าย = ชื่อหน่วยงาน, ขวา = เลขที่หนังสือ / บรรทัดถัดไป: ที่อยู่ */
  certOfficeName: 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2',
  certOfficeAddr: '234 หมู่ 14 ตำบลห้วยอ้อ อำเภอลอง',
  certOfficeAddr2: 'จังหวัดแพร่ 54150',

  /** HTML ของแบบฟอร์ม A4 (ใช้ทั้งใน modal และหน้าต่างพิมพ์) */
  certFormA4Html(data) {
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<div class="cert-doc">' +
      '<div class="cert-doc-logo"><img src="/form/big_krut.png" alt="โลโก้"></div>' +
      '<div class="cert-doc-headrow">' +
        '<div class="cert-doc-no">' + esc(data.doc_no) + '</div>' +
        '<div class="cert-doc-officeblock">' +
          '<div>' + esc(this.certOfficeName) + '</div>' +
          '<div>' + esc(this.certOfficeAddr) + '</div>' +
          '<div>' + esc(this.certOfficeAddr2) + '</div>' +
        '</div>' +
      '</div>' +
      (String(data.body_text || '').trim()
        ? '<div class="cert-doc-body">' + String(data.body_text).trim().split('\n').map(function (p, idx) {
            return '<p' + (idx === 0 ? ' class="indent"' : '') + '>' + esc(p) + '</p>';
          }).join('') + '</div>'
        : '') +
      (data.date ? '<div class="cert-doc-date">ให้ไว้ ณ วันที่ ' + (function (d) { var p = String(d).slice(0, 10).split('-'); if (p.length !== 3) return String(d); var m = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']; return parseInt(p[2], 10) + ' ' + m[parseInt(p[1], 10) - 1] + ' พ.ศ.' + (parseInt(p[0], 10) + 543); })(data.date) + '</div>' : '') +
      (String(data.note || '').trim() ? '<div class="cert-doc-note-line">' + esc(String(data.note).trim()) + '</div>' : '') +
      '<div class="cert-doc-check">' +
        '<div>ร่าง........................</div>' +
        '<div>พิมพ์.....................</div>' +
        '<div>ทาน......................</div>' +
      '</div>' +
    '</div>';
  },

  /** ทำเครื่องหมายหนังสือรับรองว่าดำเนินการเสร็จแล้ว */
  async markCertDone(r) {
    try {
      await API.post('/cert-status/' + r.id, {});
      UI.toast('ดำเนินการเสร็จแล้ว', 'success');
      DocumentsView.render();
    } catch (e) { UI.toast(e.message || 'ไม่สำเร็จ', 'error'); }
  },

  /** แสดงแบบฟอร์ม A4 ใน modal พร้อมปุ่มพิมพ์ */
  showCertificateFormA4(data) {
    const body = UI.h('div', { style: { background: '#f0f2f5', padding: '14px', overflow: 'auto' } });
    body.innerHTML = this.certFormA4Html(data);
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => { document.getElementById('modal-root').innerHTML = ''; location.reload(); } }, 'ปิด'),
      UI.h('button', { className: 'btn btn-primary', onclick: () => DocumentsView.printCertificateA4(data) }, '⬢ พิมพ์'));
    UI.modal({ title: '▭ แบบฟอร์มหนังสือรับรอง (A4)', body, footer: foot, size: 'lg' });
    // ย่อแบบฟอร์มให้พอดี modal (แสดงจริงขนาด A4 ตอนพิมพ์)
    setTimeout(function() {
      var doc = body.querySelector('.cert-doc');
      if (doc) { doc.style.transform = 'scale(0.78)'; doc.style.transformOrigin = 'top center'; }
    }, 50);
  },

  /** พิมพ์แบบฟอร์ม A4 (เปิดหน้าต่างใหม่ — เรียกจากปุ่มกดโดยตรง popup ไม่ถูกบล็อก) */
  printCertificateA4(data) {
    const w = window.open('', '_blank', 'width=940,height=1200');
    if (!w) { UI.toast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต pop-up', 'error'); return; }
    w.document.write('<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>หนังสือรับรอง</title>\n<style>\n  @page { size: A4; margin: 0; }\n  @font-face { font-family: \'THSarabunIT๙\'; src: url(\'/fonts/THSarabunIT๙.ttf\') format(\'truetype\'); font-weight: 400; }\n  @font-face { font-family: \'THSarabunIT๙\'; src: url(\'/fonts/THSarabunIT๙ Bold.ttf\') format(\'truetype\'); font-weight: 700; }\n  * { margin: 0; padding: 0; box-sizing: border-box; font-family: \'THSarabunIT๙\', \'TH Sarabun\', \'THSarabun\', sans-serif; font-size: 22px; }\n  body { background: #f0f2f5; padding: 24px; }\n  .cert-doc { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 15mm 14mm; padding-left: calc(14mm - 15px); padding-right: 60px; background: #fff; box-shadow: 0 2px 16px rgba(0,0,0,.12); color: #000; line-height: 1.55; position: relative; }\n  .cert-doc-logo { display: flex; justify-content: center; margin-bottom: 8px; }\n  .cert-doc-logo img { height: 110px; object-fit: contain; }\n  .cert-doc-headrow { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-top: -44px; position: relative; line-height: 1.35; }\n  .cert-doc-no { white-space: nowrap; text-indent: 2em; }\n  .cert-doc-addr { text-align: right; margin-top: -6px; }\n  .cert-doc-officeblock { width: max-content; text-align: left; }.cert-doc-body { margin-top: 28px; }\n.cert-doc-body p { font-size: 22px; line-height: 1.4; margin: 0 0 2px; text-align: justify; padding-left: 44px; text-indent: 0; }\n.cert-doc-body p.indent { text-indent: calc(6em - 44px); }\n.cert-doc-date { margin-top: 16px; text-align: center; font-size: 22px; }\n.cert-doc-note-line { position: absolute; left: 0; right: 0; bottom: calc(15mm + 126px); text-align: center; font-size: 22px; }\n.cert-doc-check { position: absolute; right: calc(9mm + 12px); bottom: 15mm; border: 0.5px solid #000; padding: 8px 20px; font-size: 22px; line-height: 1.5; white-space: nowrap; }\n\n  .toolbar { max-width: 210mm; margin: 0 auto 14px; display: flex; gap: 10px; justify-content: flex-end; }\n  .toolbar button { padding: 8px 22px; border: none; border-radius: 8px; font-size: 15px; cursor: pointer; }\n  .btn-print { background: #0f766e; color: #fff; }\n  .btn-close { background: #64748b; color: #fff; }\n  @media print { body { background: #fff; padding: 0; } .toolbar { display: none; } .cert-doc { box-shadow: none; margin: 0; } }\n</style></head><body>\n<div class="toolbar"><button class="btn-close" onclick="window.close()">ปิด</button><button class="btn-print" onclick="window.print()">⬢ พิมพ์</button></div>\n' + this.certFormA4Html(data) + '\n</body></html>');
    w.document.close();
    setTimeout(function() { try { w.focus(); w.print(); } catch (e) {} }, 600);
  },

  async openView(d) {
    const m = DocumentsView.docTypeMeta(d.doc_type);
    // Mark as read if user is recipient
    if (d.is_read !== undefined && !d.is_read) {
      API.put('/document-recipients/' + d.id + '/read').catch(() => {});
    }
    const body = UI.h('div', { className: 'form-grid' },
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ประเภท'), UI.h('div', {}, m.label)),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, d.doc_type === 'order' ? 'เลขที่คำสั่ง' : 'เลขที่หนังสือ'), UI.h('div', {}, d.doc_no || '-')),
      d.doc_type === 'order' ? UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'เจ้าของคำสั่ง'), UI.h('div', {}, d.owner_group || '-')) : null,
      d.doc_type === 'order' ? UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ผู้ลงทะเบียน'), UI.h('div', {}, d.order_registrar || '-')) : null,
      d.doc_type === 'honor' ? UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'ชื่อ-นามสกุล, โรงเรียน ฯลฯ'), UI.h('div', {}, ((d.person_name || '-') + (d.person_school ? ' | ' + d.person_school : '')))) : null,
      d.doc_type === 'honor' && d.body_text ? UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'ข้อความ'), UI.h('div', { style: { whiteSpace: 'pre-wrap', padding: '8px', background: '#f8fafc', borderRadius: '6px', fontSize: '14px', lineHeight: '1.6', border: '1px solid #e2e8f0' } }, d.body_text)) : null,
      d.doc_type === 'honor' ? UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ผู้ลงนาม'), UI.h('div', { id: 'honor-signer-view' }, '...')) : null,
      UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'เรื่อง'), UI.h('div', {}, d.title)),
      d.doc_type === 'certificate' && d.requester ? UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ผู้ขอ'), UI.h('div', {}, d.requester)) : null,
      d.doc_type === 'certificate' && d.cert_position ? UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ตำแหน่ง'), UI.h('div', {}, d.cert_position)) : null,
      d.doc_type === 'certificate' && d.officer ? UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'เจ้าหน้าที่(ผู้ปฏิบัติ)'), UI.h('div', {}, d.officer)) : null,
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'จาก'), UI.h('div', {}, d.from_org || '-')),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ถึง'), UI.h('div', {}, d.to_org || '-')),        UI.h('div', { className: 'form-group' }, UI.h('label', {}, d.doc_type === 'order' ? 'สั่ง ณ วันที่' : 'วันที่'), UI.h('div', {}, UI.thaiDate(d.date))),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'หมวดหมู่'), UI.h('div', {}, d.category || '-')),
      UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'ข้อความ'), UI.h('div', { style: { whiteSpace: 'pre-wrap', padding: '8px', background: '#f8fafc', borderRadius: '6px', fontSize: '14px', lineHeight: '1.6', border: '1px solid #e2e8f0' } }, d.body_text || '-')),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ไฟล์แนบ'), UI.h('div', {}, (function() {
        if (!d.file) return UI.fileLink(null);
        try { var files = JSON.parse(d.file); if (Array.isArray(files)) return files.map(function(f) { return UI.h('div', { style: { marginBottom: '4px' } }, UI.fileLink(f)); }); } catch(_e) {}
        return UI.fileLink(d.file);
      })())),
      UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'หมายเหตุ'), UI.h('div', {}, d.note || '-')),
      UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'ลงทะเบียนโดย'), UI.h('div', {}, d.creator_name || '-')),
    );
    UI.modal({ title: '👁️ รายละเอียดหนังสือราชการ', body, size: 'lg' });
    // เกียรติบัตร: แสดงชื่อผู้ลงนามจาก staff id (ต้องเรนเดอร์ modal ก่อน ถึงจะหา element เจอ)
    if (d.doc_type === 'honor') {
      var _el3 = document.getElementById('honor-signer-view');
      if (_el3) _el3.textContent = d.honor_signer ? 'กำลังโหลด...' : '-';
      if (d.honor_signer) {
        try {
          var _os = await API.get('/office-staff');
          var _s = (_os.staff || []).find(function(x) { return String(x.id) === String(d.honor_signer); });
          var el = document.getElementById('honor-signer-view');
          if (el) el.textContent = _s ? (((_s.title ? _s.title + ' ' : '') + _s.full_name).trim() + (_s.position ? ' (' + _s.position + ')' : '')) : '-';
        } catch (_e) { var _el2 = document.getElementById('honor-signer-view'); if (_el2) _el2.textContent = '-'; }
      }
    }
  },

  async openForm(doc, presetType) {
    const d = doc || {};
    
    // === ฟอร์มลงทะเบียนคำสั่ง / หนังสือรับรอง / เกียรติบัตร (ฟอร์มง่าย: เลขที่หนังสือ, วันที่, เรื่อง, หมายเหตุ, แนบไฟล์) ===
    if (presetType === 'order' || presetType === 'certificate' || presetType === 'honor' ||
        (d.doc_type === 'order' || d.doc_type === 'certificate' || d.doc_type === 'honor')) {
      const formType = presetType || d.doc_type;
      const meta = DocumentsView.docTypeMeta(formType);
      const isHonorForm = formType === 'honor';
      const body = UI.h('div', { className: 'form-grid' },
        UI.h('div', { className: 'form-group full' },
          UI.h('label', {}, isHonorForm ? 'ที่เกียรติบัตร' : (formType === 'certificate' ? 'เลขที่หนังสือ (ระบบรันอัตโนมัติ)' : (formType === 'order' ? 'เลขที่คำสั่ง (ระบบรันอัตโนมัติ)' : 'เลขที่หนังสือ')), UI.h('span', { className: 'req' }, ' *')),
          isHonorForm
            ? UI.h('input', { id: 'df-no', value: d.doc_no || '', placeholder: 'ระบบรันเลขอัตโนมัติ เช่น เลขที่ 1/2569', readonly: true, disabled: true, style: { background: '#f0f0f0', color: '#334155' } })
            : UI.h('input', { id: 'df-no', value: d.doc_no || '', placeholder: formType === 'certificate' ? 'กำลังโหลดเลขอัตโนมัติ...' : (formType === 'order' ? 'กำลังโหลดเลขอัตโนมัติ...' : 'เช่น ที่ 12/2569'), readonly: formType === 'certificate' || formType === 'order', disabled: formType === 'certificate' || formType === 'order', style: (formType === 'certificate' || formType === 'order') ? { background: '#f0f0f0', color: '#334155' } : {} })),
        ...(isHonorForm ? [
          UI.h('div', { className: 'form-group full' },
            UI.h('label', {}, 'ชื่อ-นามสกุล, โรงเรียน ฯลฯ', UI.h('span', { className: 'req' }, ' *')),
            UI.h('div', { style: { position: 'relative' } },
              UI.h('input', { id: 'df-person-name', value: d.person_name || '', placeholder: 'พิมพ์ข้อความได้อิสระ หรือค้นหาคีย์เวิด บุคลากร / สถานศึกษา...', autocomplete: 'off', style: { width: '100%', padding: '8px', boxSizing: 'border-box' } }),
              UI.h('div', { id: 'df-person-list', style: { position: 'absolute', top: '100%', left: '0', right: '0', maxHeight: '200px', overflowY: 'auto', background: '#fff', border: '1px solid #ccc', borderRadius: '4px', display: 'none', zIndex: '1000' } }))),
          UI.h('div', { className: 'form-group full' },
            UI.h('label', {}, 'เรื่อง', UI.h('span', { className: 'req' }, ' *')),
            UI.h('input', { id: 'df-title', value: d.title || '', placeholder: 'เช่น แต่งตั้งคณะกรรมการประจำสถานศึกษา' })),
          UI.h('div', { className: 'form-group full' },
            UI.h('label', {}, 'ข้อความ'),
            UI.h('textarea', { id: 'df-body', rows: 4, placeholder: 'พิมพ์ข้อความในเกียรติบัตร...', style: { width: '100%', padding: '8px', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: '14px' } }, d.body_text || '')),
          UI.h('div', { className: 'form-group' },
            UI.h('label', {}, 'วันที่ออกเกียรติบัตร', UI.h('span', { className: 'req' }, ' *')),
            UI.thaiDatePicker('df-date', { value: UI.today() })),
          UI.h('div', { className: 'form-group' },
            UI.h('label', {}, 'ผู้ลงนาม', UI.h('span', { className: 'req' }, ' *')),
            UI.h('select', { id: 'df-signer', style: { width: '100%', padding: '8px', boxSizing: 'border-box' } },
              UI.h('option', { value: '' }, '— เลือกผู้ลงนาม —'))),
          UI.h('div', { className: 'form-group full' },
            UI.h('label', {}, 'พิมพ์เกียรติบัตร'),
            UI.h('div', { id: 'df-honor-templates', style: { display: 'flex', gap: '14px', flexWrap: 'wrap' } },
              (function() {
                // ตัวเลือก "ไม่พิมพ์เกียรติบัตร" — เมื่อเลือก ซ่อนส่วนตัวอย่าง/ปุ่มพิมพ์ทั้งหมด
                var noneChecked = d.id ? String(d.honor_template) === 'none' : false;
                var tpl1 = UI.h('label', { style: { cursor: 'pointer', textAlign: 'center' } },
                  UI.h('input', { type: 'radio', name: 'honor-template', value: '1', checked: !noneChecked && (String(d.honor_template) === '1' || (!d.id && !d.honor_template)), style: { display: 'block', margin: '0 auto 4px' } }),
                  UI.h('img', { src: '/form/certificate/1.png', style: { width: '150px', height: 'auto', border: '2px solid #e2e8f0', borderRadius: '6px', display: 'block' } }));
                var tpl2 = UI.h('label', { style: { cursor: 'pointer', textAlign: 'center' } },
                  UI.h('input', { type: 'radio', name: 'honor-template', value: '2', checked: !noneChecked && String(d.honor_template) === '2', style: { display: 'block', margin: '0 auto 4px' } }),
                  UI.h('img', { src: '/form/certificate/2.png', style: { width: '150px', height: 'auto', border: '2px solid #e2e8f0', borderRadius: '6px', display: 'block' } }));
                var tplNone = UI.h('label', { style: { cursor: 'pointer', textAlign: 'center' } },
                  UI.h('input', { type: 'radio', name: 'honor-template', value: 'none', checked: noneChecked, style: { display: 'block', margin: '0 auto 4px' } }),
                  UI.h('div', { style: { width: '150px', height: '106px', border: '2px dashed #cbd5e1', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', color: '#64748b', background: '#f8fafc' } }, '✕ ไม่พิมพ์เกียรติบัตร'));
                var wrap = UI.h('div', { style: { display: 'contents' } }, tpl1, tpl2, tplNone);
                wrap.querySelectorAll('input[name="honor-template"]').forEach(function(r) {
                  r.addEventListener('change', function() {
                    var act = document.getElementById('df-honor-actions');
                    if (act) act.style.display = (r.value === 'none' && r.checked) ? 'none' : 'flex';
                  });
                });
                return wrap;
              })()),
            UI.h('div', { id: 'df-honor-actions', style: { marginTop: '10px', display: (String(d.honor_template) === 'none' && d.id) ? 'none' : 'flex', gap: '8px', alignItems: 'center' } },
              UI.h('button', { type: 'button', className: 'btn btn-outline', onclick: previewHonor, style: { fontSize: '13px' } }, '👁 ตัวอย่างก่อนพิมพ์'),
              UI.h('button', { type: 'button', className: 'btn btn-outline', onclick: saveHonorCertificate, style: { fontSize: '13px', borderColor: '#7c3aed', color: '#7c3aed' } }, '💾 บันทึกเกียรติบัตร'),
              UI.h('button', { type: 'button', className: 'btn btn-primary', onclick: printHonor, style: { fontSize: '13px', background: '#7c3aed' } }, '🖨 พิมพ์เกียรติบัตร'))),
        ] : [
          UI.h('div', { className: 'form-group' },
            UI.h('label', {}, formType === 'order' ? 'สั่ง ณ วันที่' : 'วันที่', UI.h('span', { className: 'req' }, ' *')),
            UI.thaiDatePicker('df-date', { value: UI.today() })),
          UI.h('div', { className: 'form-group full' },
            UI.h('label', {}, 'เรื่อง', UI.h('span', { className: 'req' }, ' *')),
            UI.h('input', { id: 'df-title', value: d.title || '', placeholder: 'เช่น แต่งตั้งคณะกรรมการประจำสถานศึกษา' })),
          ...(formType === 'order' ? [
            UI.h('div', { className: 'form-group full' },
              UI.h('label', {}, 'เจ้าของคำสั่ง'),
              UI.h('select', { id: 'df-owner-group', style: { width: '100%', padding: '8px', boxSizing: 'border-box' } },
                UI.h('option', { value: '' }, '— เลือกสังกัด/กลุ่มงาน —'))),
            UI.h('div', { className: 'form-group full' },
              UI.h('label', {}, 'ผู้ลงทะเบียน'),
              UI.h('select', { id: 'df-order-registrar', style: { width: '100%', padding: '8px', boxSizing: 'border-box' } },
                UI.h('option', { value: '' }, '— เลือกบุคลากร สพป.แพร่ เขต 2 —'))),
          ] : []),
          ...(formType === 'certificate' ? [
            UI.h('div', { className: 'form-group full' },
              UI.h('label', {}, 'ข้อความในหนังสือรับรอง'),
              UI.h('textarea', { id: 'df-body', rows: 4, placeholder: 'ข้อความที่ต้องการระบุในหนังสือรับรอง...', style: { width: '100%', padding: '8px', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: '14px' } }, d.body_text || '')),
          ] : []),
          ...(formType === 'certificate' ? [
            UI.h('div', { className: 'form-group full' },
              UI.h('label', {}, 'ผู้ขอ'),
              UI.h('div', { style: { position: 'relative' } },
                UI.h('input', { id: 'df-requester', value: d.requester || '', placeholder: 'พิมพ์ข้อความได้อิสระ หรือค้นหาคีย์เวิด ชื่อบุคลากร / สังกัด-กลุ่มงาน...', autocomplete: 'off', style: { width: '100%', padding: '8px', boxSizing: 'border-box' } }),
                UI.h('div', { id: 'df-requester-list', style: { position: 'absolute', top: '100%', left: '0', right: '0', maxHeight: '200px', overflowY: 'auto', background: '#fff', border: '1px solid #ccc', borderRadius: '4px', display: 'none', zIndex: '1000' } }))),
            UI.h('div', { className: 'form-group full' },
              UI.h('label', {}, 'ตำแหน่ง'),
              UI.h('input', { id: 'df-cert-position', value: d.cert_position || '', placeholder: 'เช่น ครู / ผู้อำนวยการ / นักวิชาการศึกษา', style: { width: '100%', padding: '8px', boxSizing: 'border-box' } })),
            UI.h('div', { className: 'form-group full' },
              UI.h('label', {}, 'เจ้าหน้าที่(ผู้ปฏิบัติ)'),
              UI.h('select', { id: 'df-officer', style: { width: '100%', padding: '8px', boxSizing: 'border-box' } },
                UI.h('option', { value: '' }, '— เลือกเจ้าหน้าที่ สพป.แพร่ เขต 2 —'))),
          ] : []),
        ]),
        UI.h('div', { className: 'form-group full' },
          UI.h('label', {}, 'หมายเหตุ'),
          UI.h('input', { id: 'df-note', value: d.note || '' })),
        UI.h('div', { className: 'form-group full' })
      );
      // แนบไฟล์
      const fs = body.lastElementChild;
      fs.append(UI.h('label', {}, 'แนบไฟล์'));
      const flw = UI.h('div', { id: 'df-files-wrap' });
      function addFR(val) {
        if (flw.querySelectorAll('input[type=file]').length >= 7) { UI.toast('แนบไฟล์ได้สูงสุด 7 ไฟล์', 'error'); return; }
        var row = UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' } });
        var inp = UI.h('input', { type: 'file', accept: 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip', style: { fontSize: '13px', flex: '1' } });
        if (val) { var dt = new DataTransfer(); dt.items.add(val); inp.files = dt.files; }
        var rb = UI.h('button', { style: { background: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', padding: '2px 6px', fontSize: '12px', lineHeight: '1' } }, '✕');
        rb.onclick = function() { row.remove(); };
        row.append(inp, rb); flw.append(row);
      }
      addFR();
      // แสดงไฟล์เดิมตอนแก้ไข (เป็นลิงก์ + ปุ่มแทนไฟล์)
      if (d.file) {
        try {
          var oldFiles = JSON.parse(d.file); if (!Array.isArray(oldFiles)) oldFiles = [d.file];
          oldFiles.forEach(function(fp) {
            var name = String(fp).split('/').pop();
            flw.append(UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', background: '#f0f9ff', borderRadius: '4px' } },
              UI.h('a', { href: '/uploads/' + fp, target: '_blank', style: { color: '#2563eb', textDecoration: 'underline', fontSize: '13px' } }, '📎 ' + name)));
          });
        } catch (e) { /* ignore */ }
      }
      var afb = UI.h('button', { style: { background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', padding: '4px 14px', fontSize: '13px', marginTop: '4px', display: 'inline-block' } }, 'เพิ่มไฟล์');
      afb.onclick = function() { addFR(); };
      flw.append(afb); fs.append(flw);

      const foot = UI.h('div', {},
        UI.h('button', { className: 'btn btn-outline', onclick: () => document.getElementById('modal-root').innerHTML = '' }, 'ยกเลิก'),
        UI.h('button', { className: 'btn btn-primary', onclick: saveReg }, '▽ บันทึก'));
      const m = UI.modal({ title: (d.id ? '✎ แก้ไข' : '▭ ลงทะเบียน') + meta.label.replace('▭ ', '').replace(/^ทะเบียน/, ''), body, footer: foot, size: 'lg' });
      var dateEl = document.getElementById('df-date');
      if (dateEl) dateEl.value = UI.isoToBE(d.date || UI.today());
      // เกียรติบัตร: ดึงเลขที่จะรันถัดไปจากระบบมาแสดง (readonly — บันทึกแล้วระบบรันให้จริง)
      if (isHonorForm && !d.id) {
        try {
          var _hn = await API.get('/next-doc-no?type=honor');
          var _el = document.getElementById('df-no');
          if (_el && _hn && _hn.next) _el.value = _hn.next;
        } catch (_e) { /* แสดง placeholder ไว้ก่อน */ }
      }
      // เกียรติบัตร: dropdown ผู้ลงนาม — เจ้าหน้าที่ สพป. ตำแหน่ง ผอ./รอง ผอ. เท่านั้น
      var honorSigners = []; // cache รายชื่อผู้ลงนาม (มี title/full_name/position/signature)
      if (isHonorForm) {
        try {
          var _os = await API.get('/office-staff');
          honorSigners = (_os.staff || []).slice();
          var _signers = (_os.staff || []).filter(function(s) {
            var p = (s.position || '').trim();
            // ผู้อำนวยการ หรือ รองผู้อำนวยการ (รวมชื่อตำแหน่งเต็ม เช่น ผู้อำนวยการสำนักงานเขต... / รองผู้อำนวยการสำนักงานเขต...)
            return p.indexOf('รองผู้อำนวยการ') === 0 || (p.indexOf('ผู้อำนวยการ') === 0 && p.indexOf('รองผู้อำนวยการ') !== 0);
          });
          var _sel = document.getElementById('df-signer');
          if (_sel) {
            _signers.forEach(function(s) {
              var label = ((s.title ? s.title + ' ' : '') + s.full_name).trim() + (s.position ? ' (' + s.position + ')' : '');
              var opt = document.createElement('option');
              opt.value = String(s.id);
              opt.textContent = label;
              if (d.honor_signer && String(d.honor_signer) === String(s.id)) opt.selected = true;
              _sel.appendChild(opt);
            });
          }
        } catch (_e3) { console.error('โหลดรายชื่อผู้ลงนามไม่สำเร็จ', _e3); }
      }
      // เกียรติบัตร: autocomplete ช่องรวม ชื่อ-นามสกุล, โรงเรียน ฯลฯ — คีย์เวิด บุคลากร และ สถานศึกษา
      if (isHonorForm) {
        var nameInput = document.getElementById('df-person-name');
        var nameList = document.getElementById('df-person-list');
        try {
          var hs = await API.get('/next-doc-no?type=honorees');
          var persons = (hs.persons || []).map(function(p) { return { text: p.name, sub: 'บุคลากร' + (p.workplace ? ' · ' + p.workplace : '') } });
          var schoolNames = (hs.schools || []).map(function(s) { return { text: s, sub: 'สถานศึกษา' }; });
          DocumentsView.attachAutocomplete(nameInput, nameList, persons.concat(schoolNames), function(picked) {
            // เลือกสถานศึกษา → นำหน้าด้วยคำว่า โรงเรียน (ถ้ายังไม่มีคำว่า โรงเรียน อยู่แล้ว)
            if (picked && picked.sub === 'สถานศึกษา' && nameInput.value.indexOf('โรงเรียน') !== 0) {
              nameInput.value = 'โรงเรียน' + picked.text;
            }
          });
        } catch (_e2) { console.error('โหลดรายชื่อ autocomplete ไม่สำเร็จ', _e2); }
      }
      // หนังสือรับรอง/คำสั่ง (สร้างใหม่): โหลดเลขที่หนังสือรันอัตโนมัติ ที่ 1/{ปีปัจจุบัน}
      if ((formType === 'certificate' || formType === 'order') && !d.id) {
        var noEl = document.getElementById('df-no');
        try {
          var cn = await API.get('/next-doc-no?type=' + formType);
          if (noEl && cn.next) noEl.value = cn.next;
        } catch (_e5) { console.error('โหลดเลขอัตโนมัติไม่สำเร็จ', _e5); }
      }
      // คำสั่ง: โหลดรายชื่อ สังกัด/กลุ่มงาน ลง select เจ้าของคำสั่ง + รายชื่อบุคลากร ลง ผู้ลงทะเบียน
      if (formType === 'order') {
        var ogSel = document.getElementById('df-owner-group');
        if (ogSel) {
          (CONSTANTS.WORKPLACES || []).forEach(function (w) {
            var opt = document.createElement('option');
            opt.value = w; opt.textContent = w;
            if ((d.owner_group || '') === w) opt.selected = true;
            ogSel.appendChild(opt);
          });
        }
        var regSel = document.getElementById('df-order-registrar');
        if (regSel) {
          try {
            var ors = await API.get('/office-staff');
            (ors.staff || []).forEach(function (s) {
              var opt = document.createElement('option');
              opt.value = ((s.title ? s.title + ' ' : '') + s.full_name).trim();
              opt.textContent = ((s.title ? s.title + ' ' : '') + s.full_name).trim() + (s.position ? ' (' + s.position + ')' : '');
              if ((d.order_registrar || '') === opt.value) opt.selected = true;
              regSel.appendChild(opt);
            });
          } catch (_e7) { console.error('โหลดรายชื่อบุคลากรไม่สำเร็จ', _e7); }
        }
      }
      // หนังสือรับรอง: โหลดรายชื่อเจ้าหน้าที่ สพป.แพร่ เขต 2 ลง select เจ้าหน้าที่(ผู้ปฏิบัติ)
      if (formType === 'certificate') {
        var ofSel = document.getElementById('df-officer');
        if (ofSel) {
          try {
            var ost = await API.get('/office-staff');
            (ost.staff || []).forEach(function(s) {
              var label = ((s.title ? s.title + ' ' : '') + s.full_name).trim() + (s.position ? ' (' + s.position + ')' : '');
              var opt = document.createElement('option');
              opt.value = ((s.title ? s.title + ' ' : '') + s.full_name).trim();
              opt.textContent = label;
              if (d.officer && opt.value === d.officer) opt.selected = true;
              ofSel.appendChild(opt);
            });
          } catch (_e6) { console.error('โหลดรายชื่อเจ้าหน้าที่ไม่สำเร็จ', _e6); }
        }
      }
      // หนังสือรับรอง: autocomplete ช่อง ผู้ขอ — คีย์เวิดชื่อบุคลากร พร้อมแสดง สังกัด/กลุ่มงาน
      if (formType === 'certificate') {
        var reqInput = document.getElementById('df-requester');
        var reqList = document.getElementById('df-requester-list');
        try {
          var rs = await API.get('/next-doc-no?type=honorees');
          var rPersons = (rs.persons || []).map(function(p) { return { text: p.name, sub: p.workplace || '' }; });
          DocumentsView.attachAutocomplete(reqInput, reqList, rPersons);
        } catch (_e4) { console.error('โหลดรายชื่อผู้ขอไม่สำเร็จ', _e4); }
      }

      // === เกียรติบัตร: รวบรวมข้อมูลจากฟอร์ม + วาดลงบนแบบเกียรติบัตร ===
      // คำนำหน้าชื่อให้ติดกับชื่อ (นาย|นาง|นางสาว|น.ส.|ด.ช.|ด.ญ.) เช่น "นางสาว อ้อนจันทร์" → "นางสาวอ้อนจันทร์"
      function attachHonorTitle(name) {
        return String(name || '').replace(/^((?:นาย|นาง|นางสาว|น\.ส\.|ด\.ช\.|ด\.ญ\.)\s+)/, function(m, p) { return p.replace(/\s+/g, ''); });
      }
      // ฟอนต์ THSarabunIT๙ สำหรับ canvas — ต้องโหลดผ่าน FontFace ด้วยชื่อ alias แบบ ASCII
      // เพราะเครื่อง canvas ของเบราว์เซอร์ parse ชื่อฟอนต์ที่มีอักขระไทย (๙) ใน font string ไม่ได้
      var HONOR_FONT_ALIAS = 'THSarabunIT9Canvas';
      var honorFontLoaded = false;
      async function ensureHonorFont() {
        if (honorFontLoaded) return;
        try {
          var u = '/fonts/' + encodeURIComponent('THSarabunIT๙.ttf');
          var ub = '/fonts/' + encodeURIComponent('THSarabunIT๙ Bold.ttf');
          var ff = new FontFace(HONOR_FONT_ALIAS, 'url("' + u + '") format("truetype")', { weight: '400' });
          await ff.load();
          document.fonts.add(ff);
          var fb = new FontFace(HONOR_FONT_ALIAS, 'url("' + ub + '") format("truetype")', { weight: '700' });
          await fb.load();
          document.fonts.add(fb);
          honorFontLoaded = true;
        } catch (e) { /* ใช้ฟอนต์ fallback ต่อไป */ }
      }
      function collectHonorData() {
        var tpl = document.querySelector('input[name="honor-template"]:checked');
        var signerSel = document.getElementById('df-signer');
        var signerRec = null;
        if (signerSel && signerSel.value) {
          signerRec = honorSigners.find(function(s) { return String(s.id) === String(signerSel.value); }) || null;
        }
        return {
          template: tpl ? tpl.value : '',
          docNo: (document.getElementById('df-no') || {}).value || '',
          personName: attachHonorTitle((document.getElementById('df-person-name') || {}).value || ''),
          title: (document.getElementById('df-title') || {}).value || '',
          body: (document.getElementById('df-body') || {}).value || '',
          dateTH: UI.readThaiDateInput('df-date') ? UI.thaiDate(UI.readThaiDateInput('df-date')) : '',
          signer: signerRec ? (attachHonorTitle(((signerRec.title ? signerRec.title : '') + signerRec.full_name).trim()) + (signerRec.position ? ' (' + signerRec.position + ')' : '')) : '',
          signerSignature: signerRec && signerRec.signature ? '/uploads/' + signerRec.signature : ''
        };
      }

      // วาดข้อมูลลงบนรูปแบบเกียรติบัตร (canvas) — ฟอนต์ THSarabunIT๙ ตามแบบพิมพ์จริง
      // เลขที่ ขวาบน | ชื่อ จัดกลาง | ลายเซ็นผู้ลงนามใต้ชื่อ (คำนำหน้าติดกับชื่อ)
      function drawHonorOnTemplate(data, img, sigImg) {
        var cv = document.createElement('canvas');
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        var ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0);
        var W = cv.width, H = cv.height;
        var isTpl2 = String(data.template) === '2';
        var dateY = isTpl2 ? 0.705 : 0.685;   // แนวเดียวกับ "ณ วันที่" ของแบบพิมพ์
        var FONT = '"' + HONOR_FONT_ALIAS + '", "THSarabun", "TH Sarabun New", Sarabun, sans-serif'; // THSarabunIT๙ ผ่าน alias ASCII
        ctx.fillStyle = '#1e293b';
        // เลขเกียรติบัตร — ขวาบน (ขอบขวา 100px)
        ctx.textAlign = 'right';
        ctx.font = Math.round(W * 0.026) + 'px ' + FONT;
        ctx.fillText(data.docNo || '', W - 350, H * 0.10);
        // ชื่อผู้ได้รับเกียรติบัตร — จัดกลาง ใหญ่
        ctx.textAlign = 'center';
        ctx.font = '700 ' + Math.round(W * 0.042) + 'px ' + FONT;
        ctx.fillText(data.personName || '', W / 2, H * 0.46);
        // เรื่อง — ตัวหนา ขนาดใหญ่ขึ้นเล็กน้อย แสดงบรรทัดเดียว (ย่อขนาดอัตโนมัติให้พอดีความกว้าง)
        if (data.title && data.title.trim()) {
          var maxW = W * 0.8;
          var tSize = Math.round(W * 0.032);
          ctx.font = '700 ' + tSize + 'px ' + FONT;
          var tText = data.title.trim();
          while (ctx.measureText(tText).width > maxW && tSize > W * 0.018) {
            tSize -= Math.max(1, Math.round(W * 0.001));
            ctx.font = '700 ' + tSize + 'px ' + FONT;
          }
          ctx.fillText(tText, W / 2, H * 0.535);
        }
        // เนื้อหา — บรรทัดต่อจากเรื่อง แสดงพอดีบรรทัดเดียว (ย่อขนาดอัตโนมัติให้พอดีความกว้าง)
        if (data.body && data.body.trim()) {
          var maxW2 = W * 0.8;
          var bSize = Math.round(W * 0.026);
          ctx.font = bSize + 'px ' + FONT;
          var bText = data.body.trim();
          while (ctx.measureText(bText).width > maxW2 && bSize > W * 0.016) {
            bSize -= Math.max(1, Math.round(W * 0.001));
            ctx.font = bSize + 'px ' + FONT;
          }
          ctx.fillText(bText, W / 2, H * 0.585);
        }
        // วันที่ — ต่อท้าย "ณ วันที่" ที่พิมพ์ไว้
        ctx.textAlign = 'left';
        ctx.font = Math.round(W * 0.026) + 'px ' + FONT;
        ctx.fillText(data.dateTH || '', W * 0.45, H * dateY);
        // ผู้ลงนาม — กลางล่าง: ลายเซ็น + ชื่อ (คำนำหน้าติดกัน) + ตำแหน่ง
        ctx.textAlign = 'center';
        var signerParts = (data.signer || '').match(/^([^()]+)(?:\((.*)\))?$/);
        var signerName = signerParts ? signerParts[1].trim() : (data.signer || '');
        var signerPos = signerParts && signerParts[2] ? signerParts[2].trim() : '';
        var sigCX = W / 2, nameY = H * 0.82;
        // ลายเซ็น (ถ้ามี) — เหนือชื่อ ขนาดใหญ่; ถ้าลายเซ็นสูงจะทับบรรทัดวันที่ เลื่อนบล็อกผู้ลงนามลง + ย่อลายเซ็นให้พอดี
        if (sigImg && sigImg.naturalWidth) {
          var safeTop = H * (isTpl2 ? 0.735 : 0.715);  // ขอบบนที่ลายเซ็นสูงได้ (ต่ำกว่าบรรทัดวันที่เล็กน้อย)
          var maxShift = H * 0.03;                      // ขยับบล็อกผู้ลงนามลงได้ไม่เกินนี้ (กันล้นขอบล่าง)
          var sigW = W * 0.27, sigH = sigW * (sigImg.naturalHeight / sigImg.naturalWidth);
          if (sigH > H * 0.16) { sigH = H * 0.16; sigW = sigH * (sigImg.naturalWidth / sigImg.naturalHeight); }
          var sigBottom = nameY - H * 0.02;
          var sigTop = sigBottom - sigH;
          if (sigTop < safeTop) {
            nameY += Math.min(safeTop - sigTop, maxShift);  // เลื่อนลายเซ็น+ชื่อ+ตำแหน่ง ลง
            sigBottom = nameY - H * 0.02;
            var room = sigBottom - safeTop;                 // พื้นที่เหลือให้ลายเซ็น (ไม่บังวันที่)
            if (sigH > room && room > 0) { sigH = room; sigW = sigH * (sigImg.naturalWidth / sigImg.naturalHeight); }
          }
          ctx.drawImage(sigImg, sigCX - sigW / 2, sigBottom - sigH, sigW, sigH);
        }
        ctx.font = Math.round(W * 0.026) + 'px ' + FONT;
        ctx.fillText(signerName, sigCX, nameY);
        if (signerPos) {
          // จัดบรรทัดตำแหน่ง: ลองบรรทัดเดียว → ถ้ายาวเกิน แยก "เขต N" ลงบรรทัดต่อไป แล้วย่อฟอนต์ให้พอดี (ไม่ตัดกลางคำ)
          var posLines = [signerPos];
          var pm = signerPos.match(/^(.+)[\s]+(เขต[\s]*\S*)$/);
          if (ctx.measureText(signerPos).width > W * 0.55 && pm && pm[1].trim() && pm[2].trim()) {
            posLines = [pm[1].trim(), pm[2].trim()];
          }
          var posFont = Math.round(W * 0.026);
          var longest = 0;
          posLines.forEach(function(l) { longest = Math.max(longest, ctx.measureText(l).width); });
          if (longest > W * 0.55) posFont = Math.max(Math.round(W * 0.018), Math.floor(posFont * (W * 0.55) / longest));
          ctx.font = posFont + 'px ' + FONT;
          posLines.slice(0, 3).forEach(function(ln, i) { ctx.fillText(ln, sigCX, nameY + H * (0.048 + i * 0.042)); });
        }
        return cv;
      }

      // โหลดลายเซ็นผู้ลงนาม (ถ้ามี)
      async function loadHonorSignature(data) {
        if (!data.signerSignature) return null;
        try {
          return await new Promise(function(res, rej) {
            var im = new Image();
            im.onload = function() { res(im); };
            im.onerror = function() { res(null); }; // ไม่มีลายเซ็นก็พิมพ์ได้
            im.src = data.signerSignature;
          });
        } catch (e) { return null; }
      }

      var honorImgCache = {};
      async function loadHonorImg(n) {
        if (honorImgCache[n]) return honorImgCache[n];
        var img = await new Promise(function(res, rej) {
          var im = new Image();
          im.onload = function() { res(im); };
          im.onerror = rej;
          im.src = '/form/certificate/' + n + '.png';
        });
        honorImgCache[n] = img;
        return img;
      }

      function validateHonorForPrint(data) {
        if (!data.template) { UI.toast('กรุณาเลือกแบบเกียรติบัตร', 'error'); return false; }
        if (!data.personName.trim()) { UI.toast('กรุณาระบุชื่อ-นามสกุล, โรงเรียน ฯลฯ', 'error'); return false; }
        if (!data.title.trim()) { UI.toast('กรุณากรอกเรื่อง', 'error'); return false; }
        if (!data.signer) { UI.toast('กรุณาเลือกผู้ลงนาม', 'error'); return false; }
        return true;
      }

      // ตัวอย่างก่อนพิมพ์: แสดงเกียรติบัตรที่ใส่ข้อมูลแล้วใน modal
      async function previewHonor() {
        var data = collectHonorData();
        if (!validateHonorForPrint(data)) return;
        try {
          await ensureAppFonts();
          await ensureHonorFont();
          try { await document.fonts.load('700 60px ' + HONOR_FONT_ALIAS); await document.fonts.load('60px ' + HONOR_FONT_ALIAS); } catch (_fe) {}
          var img = await loadHonorImg(data.template);
          var sigImg = await loadHonorSignature(data);
          var cv = drawHonorOnTemplate(data, img, sigImg);
          var preview = cv.toDataURL('image/jpeg', 0.85);
          var bodyEl = UI.h('div', { style: { textAlign: 'center' } },
            UI.h('img', { src: preview, style: { maxWidth: '100%', maxHeight: '70vh', border: '1px solid #e2e8f0', borderRadius: '6px' } }));
          UI.modal({ title: '👁 ตัวอย่างเกียรติบัตร', body: bodyEl, size: 'xl', stack: true });
        } catch (e) { UI.toast('โหลดแบบเกียรติบัตรไม่สำเร็จ', 'error'); }
      }

      // บันทึกเกียรติบัตร: ประกอบภาพจากฟอร์ม → อัปโหลดเป็นไฟล์ใน public/uploads/honors/ → เก็บ path ไว้ในฟอร์ม (ส่งพร้อมบันทึกเรื่อง)
      async function saveHonorCertificate() {
        var data = collectHonorData();
        if (!validateHonorForPrint(data)) return;
        try {
          await ensureAppFonts();
          await ensureHonorFont();
          try { await document.fonts.load('700 60px ' + HONOR_FONT_ALIAS); await document.fonts.load('60px ' + HONOR_FONT_ALIAS); } catch (_fe) {}
          var img = await loadHonorImg(data.template);
          var sigImg = await loadHonorSignature(data);
          var cv = drawHonorOnTemplate(data, img, sigImg);
          var dataUrl = cv.toDataURL('image/jpeg', 0.9);
          var r = await API.post('/honor-certificate', { image: dataUrl });
          if (!r || !r.path) throw new Error('no path');
          var hidden = document.getElementById('df-honor-saved');
          if (!hidden) {
            hidden = UI.h('input', { type: 'hidden', id: 'df-honor-saved', value: '' });
            document.querySelector('.modal').append(hidden);
          }
          hidden.value = r.path;
          UI.toast('บันทึกไฟล์เกียรติบัตรแล้ว — กด "บันทึก" เพื่อผูกไฟล์กับรายการ', 'success');
        } catch (e) { UI.toast(e.message || 'บันทึกไฟล์เกียรติบัตรไม่สำเร็จ', 'error'); }
      }

      // พิมพ์จากไฟล์เกียรติบัตรที่บันทึกไว้ (คอลัมน์ พิมพ์ ในรายการ)
      function printHonorFile(filePath) {
        var w = window.open('/uploads/' + filePath, '_blank', 'width=1100,height=800');
        if (!w) { UI.toast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต pop-up แล้วลองใหม่', 'error'); return; }
        w.document.write('<html><head><title>พิมพ์เกียรติบัตร</title><style>' +
          '@page { size: A4 landscape; margin: 0; }' +
          'html,body { margin:0; padding:0; height:100%; }' +
          'img { width:100%; height:100%; object-fit:contain; }' +
          '</style></head><body>' +
          '<img src="/uploads/' + filePath + '" onload="setTimeout(function(){window.print();},300)" />' +
          '</body></html>');
        w.document.close();
      }

      // พิมพ์เกียรติบัตร: เปิดหน้าต่างพิมพ์เฉพาะรูปเกียรติบัตรที่ใส่ข้อมูลแล้ว (แนวนอน A4)
      async function printHonor() {
        var data = collectHonorData();
        if (!validateHonorForPrint(data)) return;
        try {
          await ensureAppFonts();
          await ensureHonorFont();
          try { await document.fonts.load('700 60px ' + HONOR_FONT_ALIAS); await document.fonts.load('60px ' + HONOR_FONT_ALIAS); } catch (_fe) {}
          var img = await loadHonorImg(data.template);
          var sigImg = await loadHonorSignature(data);
          var cv = drawHonorOnTemplate(data, img, sigImg);
          var dataUrl = cv.toDataURL('image/jpeg', 0.92);
          var w = window.open('', '_blank', 'width=1100,height=800');
          if (!w) { UI.toast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต pop-up แล้วลองใหม่', 'error'); return; }
          w.document.write('<html><head><title>พิมพ์เกียรติบัตร</title><style>' +
            '@page { size: A4 landscape; margin: 0; }' +
            'html,body { margin:0; padding:0; height:100%; }' +
            'img { width:100%; height:100%; object-fit:contain; }' +
            '</style></head><body>' +
            '<img src="' + dataUrl + '" onload="setTimeout(function(){window.print();},300)" />' +
            '</body></html>');
          w.document.close();
        } catch (e) { UI.toast('พิมพ์ไม่สำเร็จ: ' + (e.message || e), 'error'); }
      }

      async function saveReg() {
        const title = document.getElementById('df-title').value.trim();
        const date = UI.readThaiDateInput('df-date');
        const docNoEl = document.getElementById('df-no');
        const docNo = docNoEl.value.trim();
        if (!isHonorForm && formType !== 'certificate' && formType !== 'order' && !docNo) { UI.toast('กรุณากรอกเลขที่หนังสือ', 'error'); return; }
        if (!title) { UI.toast('กรุณากรอกเรื่อง', 'error'); return; }
        if (!date) { UI.toast('กรุณาระบุวันที่', 'error'); return; }
        const fd = new FormData();
        fd.append('doc_type', formType);
        fd.append('doc_no', docNo);
        fd.append('date', date);
        fd.append('title', title);
        fd.append('from_org', 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2');
        fd.append('note', document.getElementById('df-note').value.trim());
        if (formType === 'certificate') {
          var _rq = document.getElementById('df-requester');
          fd.append('requester', _rq ? _rq.value.trim() : '');
          var _cp = document.getElementById('df-cert-position');
          fd.append('cert_position', _cp ? _cp.value.trim() : '');
          fd.append('body_text', document.getElementById('df-body') ? document.getElementById('df-body').value.trim() : '');
          var _of = document.getElementById('df-officer');
          fd.append('officer', _of ? _of.value : '');
        }
        if (formType === 'order') {
          var _og = document.getElementById('df-owner-group');
          fd.append('owner_group', _og ? _og.value : '');
          var _or = document.getElementById('df-order-registrar');
          fd.append('order_registrar', _or ? _or.value : '');
        }
        if (isHonorForm) {
          var _pn = document.getElementById('df-person-name');
          var _sg = document.getElementById('df-signer');
          if (!(_pn && _pn.value.trim())) { UI.toast('กรุณาระบุชื่อ-นามสกุล, โรงเรียน ฯลฯ', 'error'); return; }
          if (!(_sg && _sg.value)) { UI.toast('กรุณาเลือกผู้ลงนาม', 'error'); return; }
          fd.append('person_name', _pn ? _pn.value.trim() : '');
          fd.append('person_school', d.person_school || ''); // รักษาค่าเดิม (ข้อมูลเก่า) — ช่องรวมอยู่ที่ person_name
          fd.append('body_text', document.getElementById('df-body') ? document.getElementById('df-body').value.trim() : '');
          fd.append('honor_signer', _sg ? _sg.value : '');
          var _tpl = document.querySelector('input[name="honor-template"]:checked');
          if (!(_tpl && _tpl.value)) { UI.toast('กรุณาเลือกแบบเกียรติบัตร', 'error'); return; }
          fd.append('honor_template', _tpl ? _tpl.value : '');
          fd.append('honor_saved_file', document.getElementById('df-honor-saved') ? document.getElementById('df-honor-saved').value : '');
        }
        const files = flw.querySelectorAll('input[type=file]');
        let hasFile = false;
        files.forEach(function(inp) { if (inp.files.length) { fd.append('files', inp.files[0]); hasFile = true; } });
        try {
          if (d.id) {
            await API.putForm('/documents/' + d.id, fd);
            UI.toast('แก้ไขเรียบร้อย');
          } else {
            await API.postForm('/documents', fd);
            UI.toast('บันทึกเรียบร้อย');
          }
          // หนังสือรับรอง: สร้างแบบฟอร์ม A4 ให้ดู/พิมพ์หลังบันทึก (แทนการรีโหลดหน้า) — อ่านค่าจากฟอร์มก่อนล้าง modal
          if (formType === 'certificate') {
            var formData = {
              doc_no: (document.getElementById('df-no') || {}).value || '',
              date: date,
              title: title,
              requester: (document.getElementById('df-requester') || {}).value || '',
              officer: (document.getElementById('df-officer') || {}).value || '',
              body_text: (document.getElementById('df-body') || {}).value || ''
            };
            document.getElementById('modal-root').innerHTML = '';
            location.hash = '#/documents';
            DocumentsView.showCertificateFormA4(formData);
            return;
          }
          document.getElementById('modal-root').innerHTML = '';
          location.reload();
        } catch (e) { UI.toast(e.message || 'เกิดข้อผิดพลาด', 'error'); }
      }
      return;
    }
    
    // ถ้าเป็น incoming แสดงฟอร์มลงทะเบียนรับหนังสือ (ทั้งแบบ presetType='incoming' และตอนแก้ไข incoming_reg)
    if (presetType === 'incoming' || (d.doc_type === 'incoming' && !presetType)) {
      DocumentsView._editingIncomingId = d.id || null;
      const body = UI.h('div', { className: 'form-grid' },
        UI.h('div', { className: 'form-group full' }, 
          UI.h('label', {}, 'เลขหนังสือรับ'),
          UI.h('input', { id: 'df-reg-no', value: d.reg_no || '', placeholder: d.reg_no ? '' : 'กำลังโหลด...', disabled: true, style: { background: '#f0f0f0' } })),
                UI.h('div', { className: 'form-group full' }, 
          UI.h('label', {}, 'หนังสือจาก', UI.h('span', { className: 'req' }, ' *')),
          UI.h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', width: '100%' } },
            UI.h('div', { style: { flex: '1', position: 'relative' } },
              UI.h('input', { id: 'df-from', type: 'text', placeholder: 'พิมพ์ค้นหาชื่อสถานศึกษา...', style: { width: '100%', padding: '8px', boxSizing: 'border-box' }, autocomplete: 'off' }),
              UI.h('div', { id: 'df-from-list', style: { position: 'absolute', top: '100%', left: '0', right: '0', maxHeight: '200px', overflowY: 'auto', background: '#fff', border: '1px solid #ccc', borderRadius: '4px', display: 'none', zIndex: '1000' } })),
            UI.h('button', { id: 'df-from-select', className: 'btn btn-primary', style: { padding: '8px 16px', whiteSpace: 'nowrap' } }, '✓ เลือก'),
            UI.h('button', { id: 'df-from-cancel', className: 'btn btn-outline', style: { padding: '8px 16px', whiteSpace: 'nowrap', display: 'none' } }, '✕ ยกเลิก')),
        ),
        UI.h('div', { className: 'form-group full' },
          UI.h('label', {}, 'เลขที่หนังสือ'),
          UI.h('input', { id: 'df-no', value: d.doc_no || '', placeholder: 'เช่น ที่ ศธ 04114/001' })),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'วันที่รับ', UI.h('span', { className: 'req' }, ' *')),
          UI.thaiDatePicker('df-date', { value: UI.today() })),
        UI.h('div', { className: 'form-group full' },
          UI.h('label', {}, 'เรื่อง', UI.h('span', { className: 'req' }, ' *')),
          UI.h('input', { id: 'df-title', value: d.title || '', placeholder: 'เช่น ขอความอนุเคราะห์ข้อมูลบุคลากร' })),
        UI.h('div', { className: 'form-group full' },
          UI.h('label', {}, 'กลุ่มปฏิบัติ'),
          UI.h('select', { id: 'df-workgroup', style: { width: '100%', padding: '8px', fontSize: '14px' } },
            UI.h('option', { value: '' }, '-- เลือกกลุ่มปฏิบัติ --')
          )
        ),
                UI.h('div', { className: 'form-group full' },
          UI.h('label', {}, 'แนบไฟล์'),
          UI.h('div', { id: 'df-files-wrap', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
              UI.h('input', { id: 'df-file1', type: 'file', accept: 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip', style: { flex: '1' } }),
              UI.h('button', { type: 'button', className: 'btn btn-primary', style: { padding: '4px 12px', fontSize: '13px', whiteSpace: 'nowrap' }, onclick: function() { DocumentsView.openStampEditor(d.file ? (function(){try{var arr=JSON.parse(d.file);return Array.isArray(arr)?arr[0]:d.file;}catch(e){return d.file;}})() : null); } }, '✎ ลงเลขหนังสือรับ'),
              UI.h('button', { type: 'button', id: 'df-add-file', className: 'btn btn-outline', style: { padding: '4px 10px', fontSize: '16px', fontWeight: 'bold', lineHeight: '1', cursor: 'pointer' }, title: 'เพิ่มไฟล์' }, '+')
            ),
            // แสดงไฟล์เดิมที่แนบไว้แล้ว (ตอนแก้ไข)
            d.file ? (function() {
              var files = [];
              try { files = JSON.parse(d.file); if (!Array.isArray(files)) files = [d.file]; } catch(e) { files = [d.file]; }
              return files.map(function(fp, idx) {
                var name = fp.split('/').pop();
                var isImg = /.(jpg|jpeg|png|gif|bmp|webp)$/i.test(name);
                var link = isImg
                  ? UI.h('a', { href: '/uploads/' + fp, target: '_blank', style: { color: '#2563eb', textDecoration: 'underline', fontSize: '13px' } }, '🖼️ ' + name)
                  : UI.h('a', { href: '/uploads/' + fp, target: '_blank', style: { color: '#2563eb', textDecoration: 'underline', fontSize: '13px' } }, '📎 ' + name);
                return UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0', background: '#f0f9ff', borderRadius: '4px', paddingLeft: '8px' } }, link);
              });
            })() : null
          )
        ),
        UI.h('div', { className: 'form-group full' },
          UI.h('label', {}, 'หมายเหตุ'),
          UI.h('input', { id: 'df-note', value: d.note || '' })),
      );
      
            // + button to add more file inputs
      setTimeout(function() {
      var addBtn = document.getElementById('df-add-file');
      var fileCount = 1;
      if (addBtn) {
        addBtn.onclick = function() {
          if (fileCount >= 7) { UI.toast('แนบไฟล์ได้สูงสุด 7 ไฟล์', 'error'); return; }
          fileCount++;
          var wrap = document.getElementById('df-files-wrap');
          var row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:6px;';
          var inp = document.createElement('input');
          inp.id = 'df-file' + fileCount;
          inp.type = 'file';
          inp.accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip';
          inp.style.cssText = 'flex:1';
          var delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'btn btn-outline';
          delBtn.style.cssText = 'padding:4px 8px;font-size:14px;cursor:pointer;color:#ef4444;border-color:#ef4444';
          delBtn.textContent = '✕';
          delBtn.onclick = function() { row.remove(); };
          row.appendChild(inp);
          row.appendChild(delBtn);
          wrap.appendChild(row);
        };
      };
      }, 100);
      // โหลดรายชื่อสถานศึกษา
      // โหลดเลขหนังสือรับถัดไป (เฉพาะเมื่อยังไม่มีเลขเดิม — กันรันทับเลขเดิมตอนแก้ไข/ลงทะเบียนซ้ำ)
      if (!d.reg_no) API.get('/next-doc-no').then(d => { var el = document.getElementById('df-reg-no'); if (el) { el.value = d.next || ''; el.disabled = true; } }).catch(() => {});
      var preWg = d.workgroup || '';
      API.get('/workplace-groups').then(function(d) {
        var sel = document.getElementById('df-workgroup');
        if (sel && d.groups) {
          d.groups.forEach(function(g) {
            var opt = document.createElement('option');
            opt.value = g; opt.textContent = g;
            sel.appendChild(opt);
          });
          if (preWg) sel.value = preWg;
        }
      }).catch(function() {});
      (async () => {
        try {
          const schoolsData = await API.get('/schools');
          const schools = schoolsData.schools || [];
          const input = document.getElementById('df-from');
          const list = document.getElementById('df-from-list');
          
          // เพิ่มหน่วยงานอื่นๆ
          schools.push({ code: 'อื่นๆ', name: 'อื่นๆ (กรอกเอง)' });
          
          function renderList(filter) {
            list.innerHTML = '';
            const filtered = schools.filter(s => {
              const text = (s.code + ' - ' + s.name).toLowerCase();
              return !filter || text.includes(filter.toLowerCase());
            });
            filtered.forEach(s => {
              const item = UI.h('div', { 
                style: { padding: '8px', cursor: 'pointer', borderBottom: '1px solid #eee' },
                onclick: () => {
                  input.value = s.code + ' - ' + s.name;
                  list.style.display = 'none';
                }
              }, s.code + ' - ' + s.name);
              item.onmouseover = () => item.style.background = '#f0f0f0';
              item.onmouseout = () => item.style.background = '';
              list.append(item);
            });
          }
          
          input.onfocus = () => { renderList(input.value); list.style.display = 'block'; };
          input.oninput = () => { renderList(input.value); list.style.display = 'block'; };
          input.onblur = () => { setTimeout(() => list.style.display = 'none', 200); };
          
          if (d.from_org) input.value = d.from_org;
          
          // เพิ่ม event listeners สำหรับปุ่มเลือกและยกเลิก
          document.getElementById('df-from-select').addEventListener('click', function() {
            const val = input.value.trim();
            if (val) {
              input.disabled = true;
              list.style.display = 'none';
              document.getElementById('df-from-cancel').style.display = 'inline-block';
              this.style.display = 'none';
            }
          });
          document.getElementById('df-from-cancel').addEventListener('click', function() {
            input.disabled = false;
            input.value = '';
            input.focus();
            this.style.display = 'none';
            document.getElementById('df-from-select').style.display = 'inline-block';
          });
        } catch (e) { console.error('Error loading schools:', e); }
      })();
      
      const foot = UI.h('div', {},
        UI.h('button', { className: 'btn btn-outline', onclick: () => document.getElementById('modal-root').innerHTML = '' }, 'ยกเลิก'),
        UI.h('button', { className: 'btn btn-primary', onclick: () => this.saveForm('incoming') }, '▽ บันทึก'));
      const m = UI.modal({ title: '▼ ลงทะเบียนรับหนังสือ', body, footer: foot, size: 'lg' });
      return;
    }
    
    // === ฟอร์มลงทะเบียนเลขหนังสือส่ง / ลงทะเบียนรับหนังสือ ===
    let formBody;
    const u = Auth.user || {};
    const isSchoolUser = u.user_group === 'school';
    if (presetType === 'outgoing' || (d.doc_type === 'outgoing' && !presetType)) {
      let workgroups = []; let staffList = [];
      try { const wg = await API.get('/workplace-groups'); workgroups = wg.groups || []; } catch(_e) {}
      try { const st = await API.get('/office-staff'); staffList = st.staff || []; } catch(_e) {}
      let nextNo = '';
      try { const nd = await API.get('/next-doc-no?type=outgoing'); nextNo = nd.next || '1'; } catch(_e) { nextNo = '1'; }
      const docNoWrap = UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', width: '100%' } });
      if (isSchoolUser) {
        let schoolNextNo = '1';
        try { const sn = await API.get('/next-doc-no?type=outgoing'); schoolNextNo = sn.next || '1'; } catch(_e) {}
        const savedPrefix = DocumentsView._schoolDocPrefix || '';
        const prefixReadonly = savedPrefix ? true : false;
        const prefixBg = savedPrefix ? '#f0f0f0' : '#fff';
        docNoWrap.append(
          UI.h('span', { style: { fontSize: '14px', color: '#334155', whiteSpace: 'nowrap' } }, 'ที่ ศธ 04110.'),
          UI.h('input', { id: 'df-no', value: savedPrefix || nextNo, readonly: prefixReadonly, style: { width: '80px', textAlign: 'center', background: prefixBg } }),
          UI.h('span', { style: { fontSize: '14px', color: '#334155', whiteSpace: 'nowrap' } }, '/'),
          UI.h('input', { id: 'df-no-school', value: schoolNextNo, readonly: true, style: { width: '60px', textAlign: 'center', background: '#f0f0f0' } }));
      } else {
        docNoWrap.append(
          UI.h('span', { style: { fontSize: '14px', color: '#334155', whiteSpace: 'nowrap' } }, 'ที่ ศธ 04110/'),
          UI.h('input', { id: 'df-no-wor', type: 'checkbox', checked: false, style: { width: '16px', height: '16px', cursor: 'pointer' } }),
          UI.h('span', { style: { fontSize: '14px', color: '#334155', cursor: 'pointer' } }, 'ว'),
          UI.h('input', { id: 'df-no', value: nextNo, style: { width: '60px', textAlign: 'center' } }));
      }
      formBody = UI.h('div', { className: 'form-grid' },
        UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'เลขที่หนังสือ', UI.h('span', { className: 'req' }, ' *')), docNoWrap),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'วันที่', UI.h('span', { className: 'req' }, ' *')), UI.thaiDatePicker('df-date', { value: UI.today(), onChange: async () => {
          // เปลี่ยนวันที่ → ดึงเลขรันใหม่ตามปีของวันที่ที่เลือก (เฉพาะสร้างใหม่ + ผู้ใช้สำนักงาน)
          if (d.id || isSchoolUser) return;
          try {
            const iso = UI.readThaiDateInput('df-date');
            if (!iso) return;
            const nd = await API.get('/next-doc-no?type=outgoing&date=' + encodeURIComponent(iso));
            const el = document.getElementById('df-no');
            if (el && nd && nd.next) el.value = nd.next;
          } catch (_e) { /* คงเลขเดิมไว้ */ }
        } })),
        UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'จาก', UI.h('span', { className: 'req' }, ' *')),
          UI.h('input', { id: 'df-from', value: isSchoolUser ? ((u.current_school || u.workplace) || '') : 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2', readonly: true, style: { background: '#f0f0f0' } })),
        UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'ถึง'),
          UI.h('input', { id: 'df-to', value: d.to_org || '', placeholder: 'เช่น โรงเรียนในสังกัด' })),
        UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'เรื่อง', UI.h('span', { className: 'req' }, ' *')),
          UI.h('input', { id: 'df-title', value: d.title || '', placeholder: 'เช่น ขอความอนุเคราะห์ข้อมูลบุคลากร' })),
        ...(isSchoolUser ? [] : [
          UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'กลุ่มปฏิบัติ'),
            (() => { const sel = UI.h('select', { id: 'df-workgroup', style: { width: '100%', padding: '8px', fontSize: '14px' } },
              UI.h('option', { value: '' }, '-- เลือกกลุ่มปฏิบัติ --'));
              workgroups.forEach(g => sel.append(UI.h('option', { value: g }, g))); return sel; })()),
          UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'บุคคลปฏิบัติ'),
            (() => { const sel = UI.h('select', { id: 'df-assignee', style: { width: '100%', padding: '8px', fontSize: '14px' } },
              UI.h('option', { value: '' }, '-- เลือกบุคคลปฏิบัติ --'));
              staffList.forEach(s => sel.append(UI.h('option', { value: s.id }, (s.title||'') + ' ' + (s.full_name||''))));
              return sel; })()),
        ]),
        UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'หมายเหตุ'),
          UI.h('input', { id: 'df-note', value: d.note || '' })),
        UI.h('div', { className: 'form-group full' })
      );
      // แนบไฟล์
      const fs2 = formBody.lastElementChild;
      fs2.append(UI.h('label', {}, 'แนบไฟล์'));
      const flw = UI.h('div', { id: 'outgoing-file-list' });
      function addFR(val) {
        if (flw.querySelectorAll('input[type=file]').length >= 7) { UI.toast('แนบไฟล์ได้สูงสุด 7 ไฟล์','error'); return; }
        var row = UI.h('div', { style: { display:'flex', alignItems:'center', gap:'6px', marginBottom:'4px' } });
        var inp = UI.h('input', { type:'file', accept:'image/*,.pdf,.doc,.docx,.xls,.xlsx', style:{fontSize:'13px',flex:'1'} });
        if(val){var dt=new DataTransfer();dt.items.add(val);inp.files=dt.files;}
        var rb = UI.h('button', { style:{background:'#ef4444',color:'#fff',border:'none',borderRadius:'4px',cursor:'pointer',padding:'2px 6px',fontSize:'12px',lineHeight:'1'} }, '✕');
        rb.onclick=function(){row.remove();};
        row.append(inp,rb); flw.append(row);
      }
      addFR();
      var afb = UI.h('button', { style:{background:'#2563eb',color:'#fff',border:'none',borderRadius:'4px',cursor:'pointer',padding:'4px 14px',fontSize:'13px',marginTop:'4px',display:'inline-block'} }, 'เพิ่มไฟล์');
      afb.onclick=function(){addFR();};
      flw.append(afb); fs2.append(flw);
    } else {
      // === ลงทะเบียนรับหนังสือ (ใช้ outgoingBody เดิมที่ import ไว้แล้ว) ===
      formBody = outgoingBody;
    }
    const body = formBody;
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '▽ บันทึก'));
    const m = UI.modal({ title: d.id ? '✎ แก้ไขหนังสือราชการ' : (presetType === 'outgoing' ? (isSchoolUser ? '▭ ลงทะเบียนเลขหนังสือส่งของสถานศึกษา' : '▭ ลงทะเบียนเลขหนังสือส่ง') : '▭ ลงทะเบียนรับหนังสือ'), body, footer: foot, size: 'lg' });
    var dateEl = document.getElementById('df-date');
    if (dateEl) dateEl.value = UI.isoToBE(d.date || UI.today());

    async function save() {
      const fd = new FormData();
      const isOutgoing = presetType === 'outgoing';
      fd.append('doc_type', isOutgoing ? 'outgoing' : (document.getElementById('df-type') ? document.getElementById('df-type').value : 'incoming'));
      if (isOutgoing) {
        fd.append('sender_type', 'registered');
        
        var noEl = document.getElementById('df-no');
        var worEl = document.getElementById('df-no-wor');
        var worVal = (worEl && worEl.checked) ? 'ว' : '';
        var schoolNoEl = document.getElementById('df-no-school');
        fd.append('doc_no', isSchoolUser ? ('ที่ ศธ 04110.' + (noEl ? noEl.value.trim() : '1') + '/' + (schoolNoEl ? schoolNoEl.value.trim() : '1')) : ('ที่ ศธ 04110/' + worVal + (noEl ? noEl.value.trim() : '1')));
      } else {
        fd.append('doc_no', document.getElementById('df-no') ? document.getElementById('df-no').value.trim() : '');
      }
      fd.append('date', UI.readThaiDateInput('df-date'));
      fd.append('title', document.getElementById('df-title').value.trim());
      fd.append('from_org', document.getElementById('df-from').value.trim());
      fd.append('to_org', (document.getElementById('df-to') ? document.getElementById('df-to').value.trim() : '') || '');
      fd.append('note', (document.getElementById('df-note') ? document.getElementById('df-note').value.trim() : '') || '');
      fd.append('workgroup', (document.getElementById('df-workgroup') ? document.getElementById('df-workgroup').value : '') || '');
      if (isOutgoing && document.getElementById('df-assignee')) fd.append('assignee', document.getElementById('df-assignee').value);
      // Collect files from dynamic file inputs
      var fileInps = document.getElementById('outgoing-file-list');
      if (fileInps) {
        fileInps.querySelectorAll('input[type=file]').forEach(function(fEl) {
          if (fEl.files[0]) fd.append('files', fEl.files[0]);
        });
      }
      // Legacy: also collect df-file1-7 for incoming
      if (!isOutgoing) { for (let fi = 1; fi <= 7; fi++) { const f = document.getElementById('df-file' + fi); if (f && f.files[0]) fd.append('files', f.files[0]); } }
      try {
        const res = d.id
          ? await API.putForm('/documents/' + d.id, fd)
          : await API.postForm('/documents', fd);
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message || 'เกิดข้อผิดพลาด', 'error'); }
    }
  },

  async remove(d) {
    const ok = await UI.confirm(`ต้องการลบหนังสือ "${d.title}" ใช่หรือไม่?`, { danger: true, okText: 'ลบ' });
    if (!ok) return;
    try {
      const res = await API.del('/documents/' + d.id);
      UI.toast(res.message);
      render();
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  /** นำออกจากทะเบียนหนังสือรับ (แค่ตั้ง is_registered=0 — หนังสือยังอยู่ในหนังสือรับและหนังสือส่งของสถานศึกษา) */
  async unregister(d) {
    const ok = await UI.confirm(`นำหนังสือ "${d.title}" ออกจากทะเบียนหนังสือรับใช่หรือไม่?\n\n(หนังสือจะยังอยู่ในรายการหนังสือรับและหนังสือส่งของสถานศึกษาตามเดิม)`, { okText: 'นำออกจากทะเบียน' });
    if (!ok) return;
    try {
      const fd = new FormData();
      fd.append('is_registered', '0');
      await API.putForm('/documents/' + d.id, fd);
      UI.toast('นำออกจากทะเบียนเรียบร้อย');
      render();
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  async saveForm(type) {
    const from = document.getElementById('df-from').value;
    const title = document.getElementById('df-title').value;
    const date = UI.readThaiDateInput('df-date');
    const doc_no = document.getElementById('df-no') ? document.getElementById('df-no').value : '';
    const note = document.getElementById('df-note') ? document.getElementById('df-note').value : '';
    // collect files from df-file1 through df-file7
    
    if (!from) { UI.toast('กรุณาเลือกหน่วยงานต้นเรื่อง', 'error'); return; }
    if (!title) { UI.toast('กรุณากรอกเรื่อง', 'error'); return; }
    if (!date) { UI.toast('กรุณาระบุวันที่', 'error'); return; }
    
    const fd = new FormData();
    const editId = this._editingIncomingId || null;
    // ตอนลงทะเบียนจากรายการเดิม (edit) ไม่ส่ง doc_type ทับ — คงประเภทเดิมของหนังสือ (เช่น หนังสือส่งของสถานศึกษา ต้องยังเป็น outgoing ให้โรงเรียนเห็น)
    if (!editId) fd.append('doc_type', type === 'incoming' ? 'incoming' : 'outgoing');
    if (type === 'outgoing' && !editId) fd.append('sender_type', 'registered');
    fd.append('from_org', from);
    // ตอนลงทะเบียนจากรายการเดิม (edit) ไม่เขียน to_org ทับ — คงค่าปลายทางเดิมของหนังสือ
    if (!editId) fd.append('to_org', Auth.user.full_name + ' ' + Auth.user.workplace);
    fd.append('title', title);
    fd.append('date', date);
    fd.append('doc_no', doc_no);
    const reg_no = document.getElementById('df-reg-no') ? document.getElementById('df-reg-no').value : '';
    fd.append('reg_no', reg_no);
    fd.append('workgroup', document.getElementById('df-workgroup') ? document.getElementById('df-workgroup').value : '');
    // ลงทะเบียนรับหนังสือ = ตั้งสถานะลงทะเบียนแล้ว (แสดงในแทปทะเบียนหนังสือรับ)
    if (type === 'incoming') fd.append('is_registered', '1');
    fd.append('note', note);
    const allFiles = [];
    for (let fi = 1; fi <= 7; fi++) {
      const inp = document.getElementById("df-file" + fi);
      if (inp && inp.files.length > 0) { for (const f of inp.files) allFiles.push(f); }
    }
    if (allFiles.length > 0) {
      for (const f of allFiles) fd.append("files", f);
    }
    
    try {
      if (editId) { await API.putForm('/documents/' + editId, fd); }
      else { await API.postForm('/documents', fd); }
      UI.toast('บันทึกเรียบร้อย');
      // Collect files BEFORE clearing modal
      var savedFiles = [];
      for (var fi2 = 1; fi2 <= 7; fi2++) {
        var inp2 = document.getElementById('df-file' + fi2);
        if (inp2 && inp2.files.length > 0) {
          for (var fi3 = 0; fi3 < inp2.files.length; fi3++) savedFiles.push(inp2.files[fi3]);
        }
      }
      document.getElementById('modal-root').innerHTML = '';
      if (type === 'incoming') {
        // เปิดหน้าส่งไปรษณีย์ภายในเขตทันที — ดึงข้อมูลจากการลงทะเบียน (วันที่ส่ง/เรื่อง/ข้อความ/ไฟล์แนบใหม่)
        DocumentsView.openPostalForm(savedFiles, { title: title, message: note, date: date });
      } else {
        location.reload();
      }
    } catch (e) {
      UI.toast(e.message || 'เกิดข้อผิดพลาด', 'error');
    }
  },

  /** ฟอร์มส่งหนังสือราชการ senderType: 'office'=สพป.ส่งไปสถานศึกษา, 'school'=สถานศึกษาส่งไปสพป. */
  async openSendForm(senderType) {
    const isSchool = senderType === 'school' || senderType === 'school_to_school';
    const isSchoolToSchool = senderType === 'school_to_school';
    const title = isSchoolToSchool ? '▲ ส่งหนังสือไปสถานศึกษาในสังกัด' : (isSchool ? '▲ ส่งหนังสือไป สพป.แพร่ เขต 2' : '▲ ส่งหนังสือไปสถานศึกษา');
    const u = Auth.user || {};
    // สถานศึกษาที่ใช้ = สถานศึกษาที่เลือกตอนลงชื่อเข้า (current_school) ไม่ใช่สถานศึกษาหลักในโปรไฟล์
    const activeSchool = (u.user_group === 'school') ? (u.current_school || u.workplace || '') : (u.workplace || '');
    const fromText = isSchool ? activeSchool : ((u.title || '') + ' ' + (u.full_name || '') + ' ' + (u.workplace || ''));
    let allSchools = [], allStaff = [], officeStaff = [];
    try { const d = await API.get('/schools'); allSchools = (d.schools || []).sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'th', { numeric: true })); } catch (_e) {}
    try { const d = await API.get('/staff'); allStaff = d.users || d.staff || []; } catch (_e) {}
    try { const d = await API.get('/document-staff'); officeStaff = (d.officeStaff || []); } catch (_e) {}
    // เจ้าหน้าที่สพป. = office users ที่ active
    const officeUsers = allStaff.filter(s => s.user_group !== 'school' && s.status === 'active');
    // กลุ่ม/หน่วย = สังกัด/กลุ่มงาน ที่ไม่ซ้ำ
    const groups = [...new Set(officeUsers.map(s => s.workplace || '').filter(Boolean))];

    // === ส่วนหัว ===
    const headEl = UI.h('div', { className: 'card-title' }, title);
    // === จาก ===
    const fromRow = UI.h('div', { className: 'form-group full', marginBottom: '10px' },
      UI.h('label', { style: { fontWeight: '600' } }, 'จาก'),
      UI.h('div', { style: { padding: '8px 12px', background: '#f8fafc', borderRadius: '6px', fontSize: '15px', border: '1px solid #e2e8f0' } }, fromText));

    // === ระดับความสำคัญ ===
    const priorityColors = { normal: '#10b981', urgent: '#f59e0b', very_urgent: '#f97316', most_urgent: '#ef4444' };
    const priorityRow = UI.h('div', { style: { marginBottom: '10px' } },
      UI.h('label', { style: { fontSize: '13.5px', fontWeight: '600', color: '#334155', display: 'block', marginBottom: '4px' } }, 'ระดับความสำคัญ'),
      UI.h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        [{ value: 'normal', label: 'ปกติ' }, { value: 'urgent', label: 'ด่วน' }, { value: 'very_urgent', label: 'ด่วนมาก' }, { value: 'most_urgent', label: 'ด่วนที่สุด' }].map(function(p) {
          var isSelected = p.value === 'normal';
          var bg = isSelected ? priorityColors[p.value] : '#f1f5f9';
          var fg = isSelected ? '#fff' : '#334155';
          var bdr = priorityColors[p.value];
          var btn = UI.h('button', {
            type: 'button',
            className: 'send-priority-btn',
            'data-value': p.value,
            style: { padding: '6px 16px', borderRadius: '6px', border: '2px solid ' + bdr, background: bg, color: fg, cursor: 'pointer', fontSize: '13px', fontWeight: '600', transition: 'all 0.2s' },
            onclick: function() {
              document.querySelectorAll('.send-priority-btn').forEach(function(b) {
                var bv = b.getAttribute('data-value');
                b.style.background = '#f1f5f9';
                b.style.color = '#334155';
              });
              btn.style.background = priorityColors[p.value];
              btn.style.color = '#fff';
            }
          }, p.label);
          return btn;
        }))
    );

    // === เลขที่ / วันที่ ===
    const topRow = UI.h('div', { style: { display: 'flex', gap: '12px', marginBottom: '10px' } },
      UI.h('div', { style: { flex: 1 } }, UI.h('label', {}, 'เลขที่หนังสือ'),
        UI.h('input', { id: 'send-doc-no', value: 'ที่ ศธ 04110/', placeholder: 'เช่น ที่ ศธ 04110/001' })),
      UI.h('div', { style: { flex: 1 } }, UI.h('label', {}, 'วันที่', UI.h('span', { className: 'req' }, ' *')),
        UI.thaiDatePicker('send-date')),
    );

    // === เรื่อง ===
    const titleRow = UI.h('div', { className: 'form-group full', marginBottom: '10px' },
      UI.h('label', {}, 'เรื่อง', UI.h('span', { className: 'req' }, ' *')),
      UI.h('input', { id: 'send-title', placeholder: 'เช่น ขอความอนุเคราะห์ข้อมูลบุคลากร' }));

    // === เนื้อหา ===
    const contentRow = UI.h('div', { className: 'form-group full', marginBottom: '10px' },
      UI.h('label', {}, 'ข้อความ', UI.h('span', { className: 'req' }, ' *')),
      UI.h('textarea', { id: 'send-content', rows: 4, style: { width: '100%', padding: '8px 10px', fontSize: '14px', borderRadius: '6px', border: '1px solid #e2e8f0', resize: 'vertical', boxSizing: 'border-box' }, placeholder: 'พิมพ์ข้อความหนังสือ...' }));

    // === ส่งถึง ===
    const toPanel = UI.h('div', { id: 'send-to-panel', style: { marginBottom: '10px' } });
    const toContainer = UI.h('div', { style: { marginBottom: '10px' } },
      UI.h('label', { style: { fontSize: '13.5px', fontWeight: '600', color: '#334155', display: 'block', marginBottom: '4px' } }, 'ส่งถึง', UI.h('span', { className: 'req' }, ' *')),
      toPanel);

    // === ส่วนย่อยตามตัวเลือก ===
    const subPanel = UI.h('div', { id: 'send-sub-panel', style: { display: 'none', marginTop: '8px', padding: '10px', background: '#f0f9ff', borderRadius: '6px', border: '1px solid #bfdbfe' } });

    // currentSomeSelected must be accessible from save()
    var currentSomeSelected = new Set();

    if (!isSchool || isSchoolToSchool) {
      // === ส่งถึงสำหรับ สพป. ส่งไปสถานศึกษา และ สถานศึกษาส่งไปสถานศึกษาในสังกัด (โครงเดียวกัน — 3 ตัวเลือก)
      // สำหรับ school_to_school: รายการโรงเรียนตัดโรงเรียนของผู้ส่งออก (ไม่ส่งถึงตัวเอง)
      var targetSchools = allSchools;
      if (isSchoolToSchool) {
        var myCode = ((Auth.user.current_school || Auth.user.workplace || '').split(' ')[0]);
        targetSchools = allSchools.filter(function(s) { return (s.code || '') !== myCode; });
      }
      const toRadio = document.createElement('div');
      toRadio.style.cssText = 'margin-top:6px;font-size:14px;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;';
      const toOptions = [
        { value: 'all_schools', label: 'ส่งทุกโรงเรียน' },
        { value: 'school_groups', label: 'ส่งเป็นกลุ่ม' },
        { value: 'select_schools', label: 'เลือกสถานศึกษา' },
      ];
      const subPanelRef = subPanel;
      toOptions.forEach(function(opt) {
        const lbl = document.createElement('label');
        lbl.style.cssText = 'cursor:pointer;display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:6px;border:1px solid #e2e8f0;background:#fff;font-size:14px;white-space:nowrap;transition:all 0.2s;';
      lbl.onmouseover = function() { lbl.style.background = '#f0f9ff'; lbl.style.borderColor = '#93c5fd'; };
      lbl.onmouseout = function() { lbl.style.background = '#fff'; lbl.style.borderColor = '#e2e8f0'; };
        var inp = document.createElement('input');
        inp.type = 'radio';
        inp.name = 'send-to-type';
        inp.value = opt.value;
        inp.style.cssText = 'margin:0;width:16px;height:16px;accent-color:var(--primary);flex-shrink:0;';
        inp.onchange = function() { renderSubPanel(opt.value); };
        lbl.appendChild(inp);
        lbl.appendChild(document.createTextNode(opt.label));
        toRadio.appendChild(lbl);
      });
      toPanel.append(toRadio);
      toPanel.append(subPanelRef);

      // กลุ่มโรงเรียน = distinct group_name จาก schools table (school_to_school: เฉพาะกลุ่มที่มีโรงเรียนปลายทาง)
      const schoolGroups = [...new Set(targetSchools.map(function(s) { return s.group_name || ''; }).filter(Boolean))];

      // เก็บสถานศึกษาที่เลือกไว้ใน array
      var selectedSchools = targetSchools.map(function(s) { return (s.code || '') + ' ' + (s.name || ''); });
      var selectedSomeSchools = [];

      function renderSubPanel(type) {
        subPanelRef.innerHTML = '';
        subPanelRef.style.display = 'block';
        if (type === 'all_schools') {
          subPanelRef.append(UI.h('div', { style: { fontSize: '14px', padding: '10px 12px', background: '#f0fdf4', borderRadius: '6px', border: '1px solid #bbf7d0', color: '#166534' } }, '● ส่งไปทุกสถานศึกษา (' + targetSchools.length + ' โรงเรียน)'));
        } else if (type === 'select_schools') {
          // school select panel (same as postal some_schools)
          // currentSomeSelected is declared in outer scope
          // panel หลัก (ซ่อน/แสดง)
          var somePanel = UI.h('div', { id: 'send-school-panel', style: { marginBottom: '4px' } });
          subPanelRef.append(somePanel);
          // แสดงผลย่อ (เมื่อกดตกลงแล้ว)
          var someResultDiv = UI.h('div', { style: { display: 'none', fontSize: '12px', color: '#334155', padding: '6px 8px', background: '#f0fdf4', borderRadius: '6px', border: '1px solid #bbf7d0', cursor: 'pointer', marginBottom: '4px' } });
          subPanelRef.append(someResultDiv);
          someResultDiv.onclick = function() { somePanel.style.display = 'block'; someBtnRow.style.display = 'flex'; someResultDiv.style.display = 'none'; };
          function showResult() {
            someResultDiv.innerHTML = '';
            if (!currentSomeSelected.size) { someResultDiv.style.display = 'none'; return; }
            someResultDiv.style.display = 'block';
            var arr = Array.from(currentSomeSelected);
            someResultDiv.append(UI.h('span', { style: { fontWeight: '600' } }, '● เลือก ' + arr.length + ' โรงเรียน: '));
            someResultDiv.append(UI.h('span', {}, arr.join(', ')));
            someResultDiv.append(UI.h('span', { style: { color: '#6366f1', marginLeft: '8px', fontSize: '11px' } }, ' (คลิกเพื่อแก้ไข)'));
          }
          // panel เลือก
          var someSearch = UI.h('input', { id: 'ss-search', type: 'text', placeholder: '⊕ ค้นหาชื่อโรงเรียน...', style: { padding: '8px 10px', fontSize: '14px', borderRadius: '6px', border: '1px solid #e2e8f0', marginBottom: '8px', width: '100%', boxSizing: 'border-box' } });
          somePanel.append(someSearch);
          // เลือกทั้งหมด (inside somePanel)
          var ssAllCb = UI.h('input', { type: 'checkbox', style: { width: '16px', height: '16px', accentColor: 'var(--primary)', verticalAlign: 'middle' } });
          var ssAllLabel = UI.h('span', { style: { fontSize: '12px', fontWeight: '600', cursor: 'pointer', color: '#334155', verticalAlign: 'middle' } });
          somePanel.append(UI.h('div', { style: { marginBottom: '4px', paddingBottom: '6px', borderBottom: '2px solid #e2e8f0' } }, ssAllCb, UI.h('span', { style: { margin: '0 4px' } }), ssAllLabel));
          // ปุ่มล้าง/ตกลง + จำนวนที่เลือก (OUTSIDE somePanel ไม่หายไปตอนกดตกลง)
          var someSelectedDiv = null; // removed - was showing below buttons
          var someBtnRow = UI.h('div', { style: { display: 'flex', gap: '6px', marginBottom: '6px' } });
          var btnCancel = UI.h('button', { type: 'button', className: 'btn btn-outline', style: { fontSize: '13px', padding: '4px 14px' }, onclick: function() { currentSomeSelected.clear(); renderSomeList(''); } }, 'ล้างทั้งหมด');
          var btnOk = UI.h('button', { type: 'button', className: 'btn btn-primary', style: { fontSize: '13px', padding: '4px 14px' }, onclick: function() { var p = document.getElementById('send-school-panel'); if (p) p.style.display = 'none'; someBtnRow.style.display = 'none'; showResult(); } }, 'ตกลง');
          someBtnRow.append(btnCancel, btnOk);
          subPanelRef.append(someBtnRow);
          ssAllCb.onchange = function() {
            var q = (someSearch.value || '').toLowerCase();
            var items = targetSchools.filter(function(s) { return !q || ((s.code || '') + ' ' + (s.name || '')).toLowerCase().includes(q); });
            items.forEach(function(s) { var v = (s.code || '') + ' ' + (s.name || ''); if (ssAllCb.checked) currentSomeSelected.add(v); else currentSomeSelected.delete(v); });
            renderSomeList(someSearch.value);
          };
          var col1 = UI.h('div', { style: { flex: 1, minWidth: '0' } });
          var col2 = UI.h('div', { style: { flex: 1, minWidth: '0', borderLeft: '1px solid #e2e8f0', paddingLeft: '8px' } });
          var someListWrap = UI.h('div', { style: { display: 'flex', gap: '8px', maxHeight: '300px', overflowY: 'auto', background: '#fff', padding: '4px', borderRadius: '6px', border: '1px solid #e2e8f0' } });
          someListWrap.append(col1, col2);
          somePanel.append(someListWrap);
          function renderSomeList(filter) {
            col1.innerHTML = ''; col2.innerHTML = '';
            var q = (filter || '').toLowerCase();
            var filtered = targetSchools.filter(function(s) { return !q || ((s.code || '') + ' ' + (s.name || '')).toLowerCase().includes(q); });
            ssAllLabel.textContent = 'เลือกทั้งหมด (' + filtered.length + ' โรงเรียน)';
            
            ssAllCb.checked = filtered.length > 0 && filtered.every(function(s) { return currentSomeSelected.has((s.code || '') + ' ' + (s.name || '')); });
            filtered.forEach(function(s, idx) {
              var v = (s.code || '') + ' ' + (s.name || '');
              var cb = UI.h('input', { type: 'checkbox', className: 'some-school-cb', value: v, checked: currentSomeSelected.has(v), style: { width: '14px', height: '14px', accentColor: 'var(--primary)', verticalAlign: 'middle', marginRight: '4px' } });
              cb.onchange = function() {
                if (cb.checked) currentSomeSelected.add(v); else currentSomeSelected.delete(v);
                someSearch.value = '';
                renderSomeList('');
              };
              var item = UI.h('div', { style: { padding: '3px 2px', cursor: 'pointer', fontSize: '12.5px', borderBottom: '1px solid #f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', background: currentSomeSelected.has(v) ? '#eff6ff' : 'transparent' } });
              item.append(cb, UI.h('span', { style: { color: '#1e40af', fontWeight: '600' } }, s.code || ''), UI.h('span', { style: { marginLeft: '3px' } }, s.name || ''));
              item.onclick = function(e) { if (e.target === cb) return; cb.checked = !cb.checked; cb.onchange(); };
              if (idx % 2 === 0) col1.append(item); else col2.append(item);
            });
            if (!filtered.length) somePanel.append(UI.h('div', { style: { color: '#94a3b8', padding: '12px', textAlign: 'center', fontSize: '13px' } }, 'ไม่พบรายการที่ค้นหา'));
          }
          renderSomeList('');
          someSearch.addEventListener('input', function() { renderSomeList(someSearch.value); });
        } else if (type === 'school_groups') {
          var grpSelected = new Set();
          // panel หลัก
          var grpPanel = UI.h('div', { id: 'send-group-panel', style: { marginBottom: '4px' } });
          subPanelRef.append(grpPanel);
          // ผลลัพธ์ (ซ่อนไว้)
          var grpResultDiv = UI.h('div', { style: { display: 'none', fontSize: '12px', color: '#334155', padding: '6px 8px', background: '#f0fdf4', borderRadius: '6px', border: '1px solid #bbf7d0', cursor: 'pointer', marginBottom: '4px' } });
          subPanelRef.append(grpResultDiv);
          grpResultDiv.onclick = function() { grpPanel.style.display = 'block'; grpBtnRow.style.display = 'flex'; grpResultDiv.style.display = 'none'; };
          function showGrpResult() {
            grpResultDiv.innerHTML = '';
            if (!grpSelected.size) { grpResultDiv.style.display = 'none'; return; }
            grpResultDiv.style.display = 'block';
            // นับจำนวนโรงเรียนทั้งหมดในกลุ่มที่เลือก
            var totalSchools = targetSchools.filter(function(s) { return grpSelected.has(s.group_name || ''); }).length;
            var arr = Array.from(grpSelected);
            grpResultDiv.append(UI.h('span', { style: { fontWeight: '600' } }, '● เลือก ' + arr.length + ' กลุ่ม (' + totalSchools + ' โรงเรียน): '));
            grpResultDiv.append(UI.h('span', {}, arr.join(', ')));
            grpResultDiv.append(UI.h('span', { style: { color: '#6366f1', marginLeft: '8px', fontSize: '11px' } }, ' (คลิกเพื่อแก้ไข)'));
          }
          // header checkbox
          var grpAllCb = UI.h('input', { type: 'checkbox', style: { width: '16px', height: '16px', accentColor: 'var(--primary)', verticalAlign: 'middle' } });
          var grpAllLabel = UI.h('span', { style: { fontSize: '12px', fontWeight: '600', cursor: 'pointer', color: '#334155', verticalAlign: 'middle' } });
          grpPanel.append(UI.h('div', { style: { marginBottom: '4px', paddingBottom: '6px', borderBottom: '2px solid #e2e8f0' } }, grpAllCb, UI.h('span', { style: { margin: '0 4px' } }), grpAllLabel));
          // ปุ่มล้าง/ตกลง
          var grpBtnRow = UI.h('div', { style: { display: 'flex', gap: '6px', marginBottom: '6px' } });
          grpBtnRow.append(
            UI.h('button', { type: 'button', className: 'btn btn-outline', style: { fontSize: '13px', padding: '4px 14px' }, onclick: function() { grpSelected.clear(); renderGrpList(); } }, 'ล้างทั้งหมด'),
            UI.h('button', { type: 'button', className: 'btn btn-primary', style: { fontSize: '13px', padding: '4px 14px' }, onclick: function() { grpPanel.style.display = 'none'; grpBtnRow.style.display = 'none'; showGrpResult(); } }, 'ตกลง')
          );
          subPanelRef.append(grpBtnRow);
          // รายชื่อกลุ่ม
          var grpListWrap = UI.h('div', { style: { maxHeight: '200px', overflowY: 'auto', background: '#fff', padding: '4px', borderRadius: '6px', border: '1px solid #e2e8f0' } });
          grpPanel.append(grpListWrap);
          grpAllCb.onchange = function() {
            schoolGroups.forEach(function(g) { if (grpAllCb.checked) grpSelected.add(g); else grpSelected.delete(g); });
            renderGrpList();
          };
          function renderGrpList() {
            grpListWrap.innerHTML = '';
            grpAllLabel.textContent = 'เลือกทั้งหมด (' + schoolGroups.length + ' กลุ่ม)';
            grpAllCb.checked = schoolGroups.length > 0 && schoolGroups.every(function(g) { return grpSelected.has(g); });
            schoolGroups.forEach(function(g) {
              var count = targetSchools.filter(function(s) { return (s.group_name || '') === g; }).length;
              var cb = UI.h('input', { type: 'checkbox', value: g, checked: grpSelected.has(g), style: { width: '14px', height: '14px', accentColor: 'var(--primary)', verticalAlign: 'middle', marginRight: '4px' } });
              cb.onchange = function() { if (cb.checked) grpSelected.add(g); else grpSelected.delete(g); };
              var item = UI.h('div', { style: { padding: '5px 4px', cursor: 'pointer', fontSize: '13px', borderBottom: '1px solid #f8fafc', display: 'flex', alignItems: 'center', gap: '6px', background: grpSelected.has(g) ? '#eff6ff' : 'transparent' } });
              item.append(cb, UI.h('span', { style: { flex: 1 } }, g), UI.h('span', { style: { fontSize: '11px', color: '#94a3b8' }, }, count + ' โรงเรียน'));
              item.onclick = function(e) { if (e.target === cb) return; cb.checked = !cb.checked; cb.onchange(); };
              grpListWrap.append(item);
            });
          }
          renderGrpList();
        }
      }
    } else {
      // === ส่งถึงสำหรับ สถานศึกษา (ส่งไปสพป.) ===
      toPanel.append(UI.h('input', { id: 'send-to', value: 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2', readonly: true, style: { width: '100%', padding: '8px', background: '#f1f5f9', borderRadius: '6px', fontSize: '14px', border: '1px solid #e2e8f0' } }));
    }

    // === หมายเหตุ / ไฟล์ ===
    const noteRow = UI.h('div', { className: 'form-group full', marginBottom: '10px' },
      UI.h('label', {}, 'หมายเหตุ'),
      UI.h('input', { id: 'send-note', placeholder: 'เช่น ส่งด่วน' }));

    // === ไฟล์แนบ (ช่องเดียว + ปุ่ม +) ===
    const fileRow = UI.h('div', { style: { marginBottom: '10px' } });
    fileRow.append(UI.h('label', { style: { fontSize: '13.5px', fontWeight: '600', color: '#334155', display: 'block', marginBottom: '4px' } }, 'ไฟล์แนบ'));
    const fileListWrap = UI.h('div', { id: 'send-file-list' });
    function addSendFileRow(val) {
      var cnt = fileListWrap.querySelectorAll('input[type=file]').length;
      if (cnt >= 5) { UI.toast('แนบไฟล์ได้สูงสุด 5 ไฟล์', 'error'); return; }
      var row = UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' } });
      var inp = UI.h('input', { type: 'file', accept: 'image/*,.pdf,.doc,.docx', style: { fontSize: '13px', flex: '1' } });
      if (val) { var dt = new DataTransfer(); dt.items.add(val); inp.files = dt.files; }
      var rmBtn = UI.h('button', { style: { background: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', padding: '2px 6px', fontSize: '12px', lineHeight: '1' } }, '✕');
      rmBtn.onclick = function() { row.remove(); };
      row.append(inp, rmBtn);
      fileListWrap.append(row);
    }
    addSendFileRow();
    var addFileBtn = UI.h('button', { style: { background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', padding: '4px 14px', fontSize: '13px', marginTop: '4px', display: 'inline-block' } }, 'เพิ่มไฟล์');
    addFileBtn.onclick = function() { addSendFileRow(); };
    fileRow.append(fileListWrap, addFileBtn);

    // === ประกอบร่าง ===
    const body = UI.h('div', {});
    body.append(headEl, fromRow, priorityRow, topRow, toContainer, titleRow, contentRow, noteRow, fileRow);
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '▲ ส่งหนังสือ'));
    const m = UI.modal({ title, body, footer: foot, size: 'lg' });
    document.getElementById('send-date').value = UI.isoToBE(UI.today());
    document.getElementById('send-doc-no').value = 'ที่ ศธ 04110/';
    // Scroll modal to top
    var modalEl = document.querySelector('.modal');
    if (modalEl) modalEl.scrollTop = 0;

    async function save() {
      const titleVal = document.getElementById('send-title').value.trim();
      if (!titleVal) return UI.toast('กรุณากรอกเรื่องหนังสือ', 'error');
      const fd = new FormData();
      fd.append('doc_no', document.getElementById('send-doc-no').value.trim());
      fd.append('date', UI.readThaiDateInput('send-date'));
      fd.append('title', titleVal);
      fd.append('from_org', fromText);
      // หาค่า to_org
      if (isSchool && !isSchoolToSchool) {
        // สถานศึกษาส่งไป สพป. — คงที่
        fd.append('to_org', 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2');
      } else {
        const chosen = document.querySelector('input[name="send-to-type"]:checked');
        if (!chosen) return UI.toast('กรุณาเลือกส่งถึง', 'error');
        if (chosen.value === 'all_schools') {
          fd.append('to_org', 'ส่งทุกโรงเรียน (' + targetSchools.length + ' โรงเรียน)');
          fd.append('recipient_schools', JSON.stringify(targetSchools.map(s => s.code)));
        } else if (chosen.value === 'select_schools') {
          fd.append('to_org', [...currentSomeSelected].join(', '));
          // Extract school codes from selected values (format: 'CODE NAME')
          var selectedCodes = [...currentSomeSelected].map(function(v) { return v.split(' ')[0]; });
          fd.append('recipient_schools', JSON.stringify(selectedCodes));
        } else if (chosen.value === 'school_groups') {
          // Read selected groups from result div text
          var grpResult = document.querySelector('#send-sub-panel div[style*="f0fdf4"]');
          var grpText = '';
          if (grpResult) {
            var fullText = grpResult.textContent || '';
            var parts = fullText.split(':');
            if (parts.length > 1) grpText = parts[1].split('(')[0].trim();
          }
          fd.append('to_org', grpText ? 'กลุ่ม: ' + grpText : 'กลุ่มโรงเรียนทั้งหมด');
          // Send all schools in selected groups as recipient_schools (school_to_school: ตัดโรงเรียนตัวเองออก)
          var grpSchoolCodes = targetSchools.filter(function(s) { return !grpText || (s.group_name || '') === grpText; }).map(function(s) { return s.code; });
          fd.append('recipient_schools', JSON.stringify(grpSchoolCodes));
        }
        // หมายเหตุ: append recipient_schools เพียงครั้งเดียวในแต่ละสาขา — ส่งซ้ำทำให้ backend อ่านค่าไม่ได้และไม่สร้างผู้รับ
      }
      fd.append('body_text', document.getElementById('send-content') ? document.getElementById('send-content').value.trim() : '');
      fd.append('note', document.getElementById('send-note').value.trim());
      fd.append('doc_type', 'outgoing');
      fd.append('sender_type', isSchoolToSchool ? 'school_to_school' : (isSchool ? 'school' : 'office'));
      var fileInputs = document.querySelectorAll('#send-file-list input[type=file]');
      fileInputs.forEach(function(fi) { if (fi.files[0]) fd.append('files', fi.files[0]); });
      var priorityBtn = document.querySelector('.send-priority-btn[style*="rgb"]');
      if (!priorityBtn) priorityBtn = document.querySelector('.send-priority-btn');
      fd.append('priority', priorityBtn ? priorityBtn.getAttribute('data-value') : 'normal');
      try {
        const res = await API.postForm('/documents', fd);
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  /** ✉ ส่งไปรษณีย์ภายในเขต */
  async openPostalForm(prefilledFiles, prefill) {
    const u = Auth.user || {};
    const fromText = (u.title || '') + ' ' + (u.full_name || '') + ' ' + (u.workplace || '');

    // โหลดข้อมูล
    let allSchools = [];
    let officeStaffList = [];
    try { const d = await API.get('/office-staff'); officeStaffList = d.staff || []; } catch (_e) {}
    try { const d = await API.get('/schools'); allSchools = (d.schools || []).sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'th', { numeric: true })); } catch (_e) {}

    // === ส่วนหัว ===
    const headEl = UI.h('div', { className: 'card-title' }, '✉ ส่งไปรษณีย์ภายในเขต');

    // === จาก ===
    const fromRow = UI.h('div', { style: { marginBottom: '10px' } },
      UI.h('label', { style: { fontSize: '13.5px', fontWeight: '600', color: '#334155', display: 'block', marginBottom: '4px' } }, 'จาก'),
      UI.h('div', { style: { padding: '8px 12px', background: '#f8fafc', borderRadius: '6px', fontSize: '15px', border: '1px solid #e2e8f0' } }, fromText));


    // === วันที่ ===
    const topRow = UI.h('div', { style: { marginBottom: '10px' } },
      UI.h('div', {}, UI.h('label', {}, 'วันที่ส่ง', UI.h('span', { className: 'req' }, ' *')),
        UI.thaiDatePicker('postal-date', { value: (prefill && prefill.date) || UI.today() }))
    );

    // === เรื่อง ===
    const titleRow = UI.h('div', { style: { marginBottom: '10px' } },
      UI.h('label', {}, 'เรื่อง', UI.h('span', { className: 'req' }, ' *')),
      UI.h('input', { id: 'postal-title', style: { width: '100%' }, placeholder: 'เช่น ขอความอนุเคราะห์ข้อมูลบุคลากร' }));

    // === ส่งถึง (สถานศึกษาทุกแห่ง / บางแห่ง / กลุ่มโรงเรียน) ===
    const subPanel = UI.h('div', { id: 'postal-sub-panel', style: { display: 'none', marginTop: '8px', padding: '10px', background: '#f0f9ff', borderRadius: '6px', border: '1px solid #bfdbfe' } });
    const toRadio = document.createElement('div');
    toRadio.style.cssText = 'margin-top:6px;font-size:14px;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;';
    const toOptions = [
      { value: 'all_staff', label: 'ส่งทุกคน' },
      { value: 'staff_group', label: 'ส่งเป็นกลุ่ม' },
      { value: 'select_some', label: 'เลือกบางคน' },
    ];
    var postalSomeSelected = [];
    var curStaffSet = new Set();
    var postalGroupSet = new Set();
    toOptions.forEach(function(opt) {
      const lbl = document.createElement('label');
      lbl.style.cssText = 'cursor:pointer;display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:6px;border:1px solid #e2e8f0;background:#fff;font-size:14px;white-space:nowrap;transition:all 0.2s;';
      lbl.onmouseover = function() { lbl.style.background = '#f0f9ff'; lbl.style.borderColor = '#93c5fd'; };
      lbl.onmouseout = function() { lbl.style.background = '#fff'; lbl.style.borderColor = '#e2e8f0'; };
      var inp = document.createElement('input');
      inp.type = 'radio'; inp.name = 'postal-to-type'; inp.value = opt.value;
      inp.style.cssText = 'margin:0;width:16px;height:16px;accent-color:var(--primary);flex-shrink:0;';
      inp.onchange = function() { renderPostalSub(opt.value); };
      lbl.appendChild(inp); lbl.appendChild(document.createTextNode(opt.label));
      toRadio.appendChild(lbl);
    });
    const schoolGroups = [...new Set(allSchools.map(function(s) { return s.group_name || ''; }).filter(Boolean))];
    function renderPostalSub(type) {
      subPanel.innerHTML = ''; subPanel.style.display = 'block';
      if (type === 'some_schools') {
        var curSet = new Set();
        // panel + result
        var postalPanel = UI.h('div', { id: 'postal-school-panel', style: { marginBottom: '4px' } });
        subPanel.append(postalPanel);
        var postalResultDiv = UI.h('div', { style: { display: 'none', fontSize: '12px', color: '#334155', padding: '6px 8px', background: '#f0fdf4', borderRadius: '6px', border: '1px solid #bbf7d0', cursor: 'pointer', marginBottom: '4px' } });
        subPanel.append(postalResultDiv);
        postalResultDiv.onclick = function() { var p = document.getElementById('postal-school-panel'); if (p) { p.style.display = 'block'; } psBtnRow.style.display = 'flex'; postalSomeDiv.style.display = 'block'; postalResultDiv.style.display = 'none'; };
        function showPostalResult() {
          postalResultDiv.innerHTML = '';
          if (!curSet.size) { postalResultDiv.style.display = 'none'; return; }
          postalResultDiv.style.display = 'block';
          var arr = Array.from(curSet);
          postalResultDiv.append(UI.h('span', { style: { fontWeight: '600' } }, '● เลือก ' + arr.length + ' โรงเรียน: '));
          postalResultDiv.append(UI.h('span', {}, arr.join(', ')));
          postalResultDiv.append(UI.h('span', { style: { color: '#6366f1', marginLeft: '8px', fontSize: '11px' } }, ' (คลิกเพื่อแก้ไข)'));
        }
        var postalSearch = UI.h('input', { type: 'text', placeholder: '⊕ ค้นหาชื่อโรงเรียน...', style: { padding: '8px 10px', fontSize: '14px', borderRadius: '6px', border: '1px solid #e2e8f0', marginBottom: '8px', width: '100%', boxSizing: 'border-box' } });
        postalPanel.append(postalSearch);
        var psAllCb = UI.h('input', { type: 'checkbox', style: { width: '16px', height: '16px', accentColor: 'var(--primary)', verticalAlign: 'middle' } });
        var psAllLabel = UI.h('span', { style: { fontSize: '12px', fontWeight: '600', cursor: 'pointer', color: '#334155', verticalAlign: 'middle' } });
        postalPanel.append(UI.h('div', { style: { marginBottom: '4px', paddingBottom: '6px', borderBottom: '2px solid #e2e8f0' } }, psAllCb, UI.h('span', { style: { margin: '0 4px' } }), psAllLabel));
        // ปุ่มล้าง/ตกลง + จำนวนที่เลือก (OUTSIDE postalPanel)
        var postalSomeDiv = UI.h('div', { style: { fontSize: '12px', color: '#334155', marginTop: '2px', marginBottom: '4px', padding: '4px 0' } });
        var psBtnRow = UI.h('div', { style: { display: 'flex', gap: '6px', marginBottom: '6px' } });
        psBtnRow.append(
          UI.h('button', { type: 'button', className: 'btn btn-outline', style: { fontSize: '13px', padding: '4px 14px' }, onclick: function() { curSet.clear(); renderPostalList(''); } }, 'ล้างทั้งหมด'),
          UI.h('button', { type: 'button', className: 'btn btn-primary', style: { fontSize: '13px', padding: '4px 14px' }, onclick: function() { var p = document.getElementById('postal-school-panel'); if (p) { p.style.display = 'none'; } psBtnRow.style.display = 'none'; showPostalResult(); } }, 'ตกลง')
        );
        subPanel.append(psBtnRow);
        subPanel.append(postalSomeDiv);
        psAllCb.onchange = function() {
          var f = (postalSearch.value || '').toLowerCase();
          var items = allSchools.filter(function(s) { return !f || ((s.code || '') + ' ' + (s.name || '')).toLowerCase().includes(f); });
          items.forEach(function(s) { var v = (s.code || '') + ' ' + (s.name || ''); if (psAllCb.checked) curSet.add(v); else curSet.delete(v); });
          renderPostalList(postalSearch.value);
        };
        var psCol1 = UI.h('div', { style: { flex: 1, minWidth: '0' } });
        var psCol2 = UI.h('div', { style: { flex: 1, minWidth: '0', borderLeft: '1px solid #e2e8f0', paddingLeft: '8px' } });
        var postalListWrap = UI.h('div', { style: { display: 'flex', gap: '8px', maxHeight: '300px', overflowY: 'auto', background: '#fff', padding: '4px', borderRadius: '6px', border: '1px solid #e2e8f0' } });
        postalListWrap.append(psCol1, psCol2);
        postalPanel.append(postalListWrap);
        function renderPostalList(q) {
          psCol1.innerHTML = ''; psCol2.innerHTML = '';
          var filter = (q || '').toLowerCase();
          var items = allSchools.filter(function(s) { return !filter || ((s.code || '') + ' ' + (s.name || '')).toLowerCase().includes(filter); });
          psAllLabel.textContent = 'เลือกทั้งหมด (' + items.length + ' โรงเรียน)';
          postalSomeDiv.textContent = curSet.size ? '● เลือก ' + curSet.size + ' โรงเรียน' : '';
          psAllCb.checked = items.length > 0 && items.every(function(s) { return curSet.has((s.code || '') + ' ' + (s.name || '')); });
          items.forEach(function(s, idx) {
            var v = (s.code || '') + ' ' + (s.name || '');
            var cb = UI.h('input', { type: 'checkbox', className: 'postal-some-cb', value: v, checked: curSet.has(v), style: { width: '14px', height: '14px', accentColor: 'var(--primary)', verticalAlign: 'middle', marginRight: '4px' } });
            cb.onchange = function() { if (cb.checked) curSet.add(v); else curSet.delete(v); postalSearch.value = ''; renderPostalList(''); };
            var item = UI.h('div', { style: { padding: '3px 2px', cursor: 'pointer', fontSize: '12.5px', borderBottom: '1px solid #f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', background: curSet.has(v) ? '#eff6ff' : 'transparent' } });
            item.append(cb, UI.h('span', { style: { color: '#1e40af', fontWeight: '600' } }, s.code || ''), UI.h('span', { style: { marginLeft: '3px' } }, s.name || ''));
            item.onclick = function(e) { if (e.target === cb) return; cb.checked = !cb.checked; cb.onchange(); };
            if (idx % 2 === 0) psCol1.append(item); else psCol2.append(item);
          });
          if (!items.length) postalPanel.append(UI.h('div', { style: { color: '#94a3b8', padding: '12px', textAlign: 'center', fontSize: '13px' } }, 'ไม่พบรายการที่ค้นหา'));
        }
        renderPostalList('');
        postalSearch.addEventListener('input', function() { renderPostalList(postalSearch.value); });
      } else if (type === 'all_staff') {
        subPanel.append(UI.h('div', { style: { fontSize: '14px', padding: '10px 12px', background: '#f0fdf4', borderRadius: '6px', border: '1px solid #bbf7d0', color: '#166534' } }, '● เจ้าหน้าที่ทั้งหมด (' + officeStaffList.length + ' คน)'));
      } else if (type === 'staff_group') {
        postalGroupSet = new Set();
        var curGroupSet = postalGroupSet;
        const workGroups = [...new Set(officeStaffList.map(function(s) { return s.workplace || ''; }).filter(Boolean))];
        subPanel.append(UI.h('div', { style: { fontSize: '14px', marginBottom: '8px', color: '#334155', fontWeight: '600' } }, 'เลือกกลุ่มงาน:'));
        // Group list with checkboxes
        var grpListWrap = UI.h('div', { style: { maxHeight: '150px', overflowY: 'auto', background: '#fff', padding: '4px', borderRadius: '6px', border: '1px solid #e2e8f0', marginBottom: '8px' } });
        workGroups.forEach(function(g) {
          var count = officeStaffList.filter(function(s) { return s.workplace === g; }).length;
          var row = UI.h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 8px', cursor: 'pointer', borderBottom: '1px solid #f8fafc', fontSize: '13px' } });
          var cb = UI.h('input', { type: 'checkbox', value: g, style: { width: '16px', height: '16px', accentColor: 'var(--primary)' } });
          cb.onchange = function() { if (cb.checked) curGroupSet.add(g); else curGroupSet.delete(g); };
          row.append(cb, UI.h('span', {}, g + ' (' + count + ' คน)'));
          row.onclick = function(e) { if (e.target !== cb) { cb.checked = !cb.checked; cb.onchange(); } };
          grpListWrap.append(row);
        });
        subPanel.append(grpListWrap);
        // Group staff result
        var groupResultDiv = UI.h('div', { style: { display: 'none', fontSize: '12px', color: '#334155', padding: '6px 8px', background: '#f0fdf4', borderRadius: '6px', border: '1px solid #bbf7d0', cursor: 'pointer', marginBottom: '4px' } });
        subPanel.append(groupResultDiv);
        groupResultDiv.onclick = function() { grpListWrap.style.display = 'block'; groupResultDiv.style.display = 'none'; };
        // ตกลง button
        var grpBtnRow = UI.h('div', { style: { display: 'flex', gap: '6px', marginBottom: '4px' } });
        grpBtnRow.append(
          UI.h('button', { type: 'button', className: 'btn btn-outline', style: { fontSize: '13px', padding: '4px 14px' }, onclick: function() { curGroupSet.clear(); grpListWrap.querySelectorAll('input[type=checkbox]').forEach(function(cb) { cb.checked = false; }); groupResultDiv.style.display = 'none'; grpListWrap.style.display = 'block'; } }, 'ล้างทั้งหมด'),
          UI.h('button', { type: 'button', className: 'btn btn-primary', style: { fontSize: '13px', padding: '4px 14px' }, onclick: function() {
            grpListWrap.style.display = 'none';
            var selected = Array.from(curGroupSet);
            var filtered = officeStaffList.filter(function(s) { return selected.includes(s.workplace); });
            groupResultDiv.innerHTML = '';
            if (selected.length) {
              groupResultDiv.style.display = 'block';
              groupResultDiv.append(UI.h('span', { style: { fontWeight: '600' } }, '● เลือก ' + selected.length + ' กลุ่ม (' + filtered.length + ' คน): '));
              groupResultDiv.append(UI.h('span', {}, selected.join(', ')));
              groupResultDiv.append(UI.h('span', { style: { color: '#6366f1', marginLeft: '8px', fontSize: '11px' } }, ' (คลิกเพื่อแก้ไข)'));
            }
          } }, 'ตกลง')
        );
        subPanel.append(grpBtnRow);
      } else if (type === 'select_some') {

        var staffPanel = UI.h('div', { id: 'postal-staff-panel' });
        subPanel.append(staffPanel);
        var staffResultDiv = UI.h('div', { style: { display: 'none', fontSize: '12px', color: '#334155', padding: '6px 8px', background: '#f0fdf4', borderRadius: '6px', border: '1px solid #bbf7d0', cursor: 'pointer', marginBottom: '4px' } });
        subPanel.append(staffResultDiv);
        staffResultDiv.onclick = function() { staffPanel.style.display = 'block'; stBtnRow.style.display = 'flex'; staffResultDiv.style.display = 'none'; };
        function showStaffResult() {
          staffResultDiv.innerHTML = '';
          if (!curStaffSet.size) { staffResultDiv.style.display = 'none'; return; }
          staffResultDiv.style.display = 'block';
          var arr = Array.from(curStaffSet);
          staffResultDiv.append(UI.h('span', { style: { fontWeight: '600' } }, '● เลือก ' + arr.length + ' คน: '));
          staffResultDiv.append(UI.h('span', {}, arr.join(', ')));
          staffResultDiv.append(UI.h('span', { style: { color: '#6366f1', marginLeft: '8px', fontSize: '11px' } }, ' (คลิกเพื่อแก้ไข)'));
        }
        var staffSearch = UI.h('input', { type: 'text', placeholder: '⊕ ค้นหาชื่อเจ้าหน้าที่...', style: { padding: '8px 10px', fontSize: '14px', borderRadius: '6px', border: '1px solid #e2e8f0', marginBottom: '8px', width: '100%', boxSizing: 'border-box' } });
        staffPanel.append(staffSearch);
        var stBtnRow = UI.h('div', { style: { display: 'flex', gap: '6px', marginBottom: '6px' } });
        stBtnRow.append(
          UI.h('button', { type: 'button', className: 'btn btn-outline', style: { fontSize: '13px', padding: '4px 14px' }, onclick: function() { curStaffSet.clear(); renderStaffList(''); } }, 'ล้างทั้งหมด'),
          UI.h('button', { type: 'button', className: 'btn btn-primary', style: { fontSize: '13px', padding: '4px 14px' }, onclick: function() { staffPanel.style.display = 'none'; stBtnRow.style.display = 'none'; showStaffResult(); } }, 'ตกลง')
        );
        subPanel.append(stBtnRow);
        var stListWrap = UI.h('div', { style: { maxHeight: '200px', overflowY: 'auto', background: '#fff', padding: '4px', borderRadius: '6px', border: '1px solid #e2e8f0' } });
        staffPanel.append(stListWrap);
        function renderStaffList(q) {
          stListWrap.innerHTML = '';
          var filter = (q || '').toLowerCase();
          var items = officeStaffList.filter(function(s) { return !filter || ((s.title || '') + ' ' + (s.full_name || '') + ' ' + (s.position || '')).toLowerCase().includes(filter); });
          
          items.forEach(function(s) {
            var v = (s.title || '') + ' ' + (s.full_name || '');
            var cb = UI.h('input', { type: 'checkbox', value: v, checked: curStaffSet.has(v), style: { width: '14px', height: '14px', accentColor: 'var(--primary)', verticalAlign: 'middle', marginRight: '4px' } });
            cb.onchange = function() { if (cb.checked) curStaffSet.add(v); else curStaffSet.delete(v); };
            var item = UI.h('div', { style: { padding: '3px 4px', cursor: 'pointer', fontSize: '13px', borderBottom: '1px solid #f8fafc', display: 'flex', alignItems: 'center', gap: '6px', background: curStaffSet.has(v) ? '#eff6ff' : 'transparent' } });
            item.append(cb, UI.h('span', {}, v + (s.position ? ' - ' + s.position : '')));
            item.onclick = function(e) { if (e.target === cb) return; cb.checked = !cb.checked; cb.onchange(); };
            stListWrap.append(item);
          });
          if (!items.length) stListWrap.append(UI.h('div', { style: { color: '#94a3b8', padding: '12px', textAlign: 'center', fontSize: '13px' } }, 'ไม่พบรายการที่ค้นหา'));
        }
        renderStaffList('');
        staffSearch.addEventListener('input', function() { renderStaffList(staffSearch.value); });
      } else if (type === 'school_group') {
        subPanel.append(UI.h('div', { style: { fontSize: '13px', marginBottom: '6px', color: '#64748b' } }, 'เลือกกลุ่มโรงเรียน:'));
        const grpSel = UI.h('select', { id: 'postal-to-group', multiple: true, style: { width: '100%', height: '100px', fontSize: '13px', padding: '4px' } });
        schoolGroups.forEach(function(g) { grpSel.append(UI.h('option', { value: g }, g)); });
        subPanel.append(grpSel);
      }
    }
    const toContainer = UI.h('div', { style: { marginBottom: '10px' } },
      UI.h('label', { style: { fontSize: '13.5px', fontWeight: '600', color: '#334155', display: 'block', marginBottom: '4px' } }, 'ส่งถึง', UI.h('span', { className: 'req' }, ' *')),
      toRadio, subPanel);

    // === หมายเหตุ / ไฟล์ ===
    // === ข้อความ ===
    const msgRow = UI.h('div', { style: { marginBottom: '10px' } },
      UI.h('label', { style: { fontSize: '13.5px', fontWeight: '600', color: '#334155', display: 'block', marginBottom: '4px' } }, 'ข้อความ'),
      UI.h('textarea', { id: 'postal-message', rows: 5, style: { width: '100%', padding: '8px 10px', fontSize: '14px', borderRadius: '6px', border: '1px solid #e2e8f0', resize: 'vertical', boxSizing: 'border-box' }, placeholder: 'พิมพ์ข้อความหนังสือ...' }));

    // === หมายเหตุ ===
    const noteRow = UI.h('div', { style: { marginBottom: '10px' } },
      UI.h('label', { style: { fontSize: '13.5px', fontWeight: '600', color: '#334155', display: 'block', marginBottom: '4px' } }, 'หมายเหตุ'),
      UI.h('input', { id: 'postal-note', style: { width: '100%' }, placeholder: 'เช่น ส่งด่วน' }));

    // === ไฟล์แนบ (ช่องเดียว + ปุ่ม +) ===
    const fileRow = UI.h('div', { style: { marginBottom: '10px' } });
    fileRow.append(UI.h('label', { style: { fontSize: '13.5px', fontWeight: '600', color: '#334155', display: 'block', marginBottom: '4px' } }, 'ไฟล์แนบ'));
    const fileListWrap = UI.h('div', { id: 'postal-file-list' });
    function addPostalFileRow(val) {
      var cnt = fileListWrap.querySelectorAll('input[type=file]').length;
      if (cnt >= 7) { UI.toast('แนบไฟล์ได้สูงสุด 7 ไฟล์', 'error'); return; }
      var idx = cnt + 1;
      var row = UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' } });
      var inp = UI.h('input', { type: 'file', accept: 'image/*,.pdf,.doc,.docx', style: { fontSize: '13px', flex: '1' } });
      if (val) { var dt = new DataTransfer(); dt.items.add(val); inp.files = dt.files; }
      var rmBtn = UI.h('button', { style: { background: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', padding: '2px 6px', fontSize: '12px', lineHeight: '1' } }, '✕');
      rmBtn.onclick = function() { row.remove(); };
      row.append(inp, rmBtn);
      fileListWrap.append(row);
    }
    addPostalFileRow();
    var addFileBtn = UI.h('button', { style: { background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', padding: '4px 14px', fontSize: '13px', marginTop: '4px', display: 'inline-block' } }, 'เพิ่มไฟล์');
    addFileBtn.onclick = function() { addPostalFileRow(); };
    fileRow.append(fileListWrap, addFileBtn);

    const body = UI.h('div', {});
    // ลำดับ: จาก > วันที่ > ส่งถึง > เรื่อง > ข้อความ > หมายเหตุ > ไฟล์แนบ
    body.append(headEl, fromRow, topRow, toContainer, titleRow, msgRow, noteRow, fileRow);
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '✉ ส่งไปรษณีย์'));
    const m = UI.modal({ title: '✉ ส่งไปรษณีย์ภายในเขต', body, footer: foot, size: 'lg' });
    // วันที่ส่ง = จากการลงทะเบียนรับหนังสือ (ถ้ามี) ไม่ใช่วันนี้เสมอ
    document.getElementById('postal-date').value = (prefill && prefill.date) ? UI.isoToBE(prefill.date) : UI.isoToBE(UI.today());
    // Pre-fill files from registration form
    if (prefilledFiles && prefilledFiles.length > 0) {
      fileListWrap.innerHTML = '';
      prefilledFiles.slice(0, 7).forEach(function(f) { addPostalFileRow(f); });
    }
    // ดึง เรื่อง/ข้อความ จากการลงทะเบียนรับหนังสือ (รายการก่อนหน้า) มาแสดง
    if (prefill) {
      if (prefill.title) { var pt = document.getElementById('postal-title'); if (pt) pt.value = prefill.title; }
      if (prefill.message) { var pm = document.getElementById('postal-message'); if (pm) pm.value = prefill.message; }
    }
    
    async function save() {
      const titleVal = document.getElementById('postal-title').value.trim();
      if (!titleVal) return UI.toast('กรุณากรอกเรื่องหนังสือ', 'error');
      var chosen = document.querySelector('input[name="postal-to-type"]:checked');
      if (!chosen) return UI.toast('กรุณาเลือกส่งถึง', 'error');
      // to_org ตามตัวเลือกจริง (ส่งถึงเจ้าหน้าที่ สพป. ภายในเขต)
      var toOrg = '';
      if (chosen.value === 'all_staff') {
        toOrg = 'ทุกคน (' + officeStaffList.length + ' คน)';
      } else if (chosen.value === 'staff_group') {
        var groups = Array.from(postalGroupSet);
        if (!groups.length) return UI.toast('กรุณาเลือกกลุ่มงานแล้วกดตกลง', 'error');
        toOrg = 'กลุ่ม:' + groups.join(',');
      } else if (chosen.value === 'select_some') {
        var names = Array.from(curStaffSet);
        if (!names.length) return UI.toast('กรุณาเลือกเจ้าหน้าที่แล้วกดตกลง', 'error');
        toOrg = names.join(',');
      }
      if (!toOrg) return UI.toast('กรุณาเลือกส่งถึง', 'error');
      // รวบรวมไฟล์จากช่องแนบไฟล์จริง
      var fileArr = [...fileListWrap.querySelectorAll('input[type=file]')].map(function(i) { return i.files[0]; }).filter(Boolean);
      const fd = new FormData();
      fd.append('doc_type', 'outgoing');
      fd.append('sender_type', 'office');
      fd.append('doc_no', '');
      fd.append('date', UI.readThaiDateInput('postal-date'));
      fd.append('title', titleVal);
      fd.append('from_org', fromText);
      fd.append('to_org', toOrg);
      var msgEl = document.getElementById('postal-message');
      fd.append('body_text', msgEl ? msgEl.value.trim() : '');
      var noteEl = document.getElementById('postal-note');
      fd.append('note', noteEl ? noteEl.value.trim() : '');
      if (fileArr.length) fileArr.forEach(function(f) { fd.append('files', f); });
      try {
        const res = await API.postForm('/documents', fd);
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  /** ⊛ ตั้งค่าเจ้าหน้าที่หนังสือราชการ (admin only) */
  async openStaffSettings() {
    // ดึงข้อมูลปัจจุบัน
    let data = { officeStaff: [], schoolStaff: [] };
    try { data = await API.get('/document-staff'); } catch (_e) {}
    let allStaff = [];
    try { const d = await API.get('/staff'); allStaff = d.users || d.staff || []; } catch (_e) {}
    let allSchools = [];
    let officeStaffList = [];
    try { const d = await API.get('/office-staff'); officeStaffList = d.staff || []; } catch (_e) {}
    try { const d = await API.get('/schools'); allSchools = (d.schools || []).sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'th', { numeric: true })); } catch (_e) {}

    const officeSet = new Set((data.officeStaff || []).map(s => s.user_id));
    const officeUsers = allStaff.filter(u => u.user_group !== 'school' && u.status === 'active');

    const body = UI.h('div', { style: { maxHeight: '70vh', overflowY: 'auto' } });

    // ===== ส่วนที่ 1: กำหนดเจ้าหน้าที่ สพป. =====
    const sec1 = UI.h('div', { style: { marginBottom: '24px', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px' } });
    sec1.append(UI.h('div', { style: { fontSize: '16px', fontWeight: 'bold', marginBottom: '12px', color: '#1e40af' } }, '⬡ กำหนดเจ้าหน้าที่หนังสือราชการ สพป.แพร่ เขต 2'));
    sec1.append(UI.h('div', { style: { fontSize: '13px', color: '#64748b', marginBottom: '10px' } }, 'เจ้าหน้าที่ที่เลือกจะเห็นหนังสือที่สถานศึกษาส่งมาให้ สพป.แพร่ เขต 2'));

    const officeList = UI.h('div', { id: 'ds-office-list' });
    function renderOfficeList() {
      officeList.innerHTML = '';
      const rows = (data.officeStaff || []);
      if (!rows.length) { officeList.append(UI.h('div', { style: { color: '#94a3b8', fontSize: '13px' } }, 'ยังไม่มีเจ้าหน้าที่')); return; }
      rows.forEach(s => {
        const row = UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid #f1f5f9' } },
          UI.h('span', { style: { flex: 1, fontSize: '14px' } }, (s.title || '') + ' ' + (s.full_name || '')),
          UI.h('button', { className: 'btn btn-danger', style: { fontSize: '11px', padding: '2px 8px' }, onclick: async () => {
            try { await API.del('/document-staff/office/' + s.id); UI.toast('ลบเรียบร้อย'); DocumentsView.openStaffSettings(); } catch (e) { UI.toast(e.message, 'error'); }
          } }, '✕ ลบ'));
        officeList.append(row);
      });
    }
    renderOfficeList();
    sec1.append(officeList);

    // dropdown เลือกเจ้าหน้าที่ + ปุ่มเพิ่ม
    const unassignedOffice = officeUsers.filter(u => !officeSet.has(u.id));
    const officeSel = UI.h('select', { id: 'ds-office-select', style: { padding: '6px', borderRadius: '6px', fontSize: '14px', minWidth: '300px', marginRight: '8px', verticalAlign: 'middle' } });
    officeSel.append(UI.h('option', { value: '' }, '-- เลือกเจ้าหน้าที่ --'));
    unassignedOffice.forEach(u => {
      officeSel.append(UI.h('option', { value: u.id }, (u.title || '') + ' ' + (u.full_name || '') + (u.position ? ' — ' + u.position : '')));
    });
    sec1.append(UI.h('div', { style: { display: 'flex', alignItems: 'center', marginTop: '10px', gap: '8px' } },
      officeSel,
      UI.h('button', { className: 'btn btn-primary', style: { fontSize: '13px', padding: '6px 16px', verticalAlign: 'middle' }, onclick: async () => {
        const sel = document.getElementById('ds-office-select');
        const uid = Number(sel.value);
        if (!uid) return UI.toast('กรุณาเลือกเจ้าหน้าที่', 'error');
        try {
          await API.post('/document-staff/office', { userIds: [uid] });
          UI.toast('เพิ่มเจ้าหน้าที่เรียบร้อย');
          DocumentsView.openStaffSettings();
        } catch (e) { UI.toast(e.message, 'error'); }
      } }, '+ เพิ่ม')));
    body.append(sec1);

    // ===== ส่วนที่ 2: กำหนดเจ้าหน้าที่สถานศึกษา =====
    const sec2 = UI.h('div', { style: { border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px' } });
    sec2.append(UI.h('div', { style: { fontSize: '16px', fontWeight: 'bold', marginBottom: '12px', color: '#1e40af' } }, '🏫 กำหนดเจ้าหน้าที่หนังสือราชการ สถานศึกษา'));
    sec2.append(UI.h('div', { style: { fontSize: '13px', color: '#64748b', marginBottom: '10px' } }, 'เลือกสถานศึกษา แล้วเลือกเจ้าหน้าที่สารบัญ (เลือกได้หลายคน ต้องเป็นเจ้าหน้าที่ที่ดูแลสถานศึกษานั้นๆ)'));

    // dropdown เลือกสถานศึกษา
    const schoolSel = UI.h('select', { id: 'ds-school-sel', style: { padding: '6px', borderRadius: '6px', minWidth: '300px', marginBottom: '10px' } });
    schoolSel.addEventListener('change', () => renderSchoolStaff());
    schoolSel.append(UI.h('option', { value: '' }, '-- เลือกสถานศึกษา --'));
    allSchools.forEach(s => {
      const label = (s.code || '') + ' ' + (s.name || '');
      schoolSel.append(UI.h('option', { value: s.code || '' }, label));
    });
    sec2.append(schoolSel);

    const schoolStaffList = UI.h('div', { id: 'ds-school-staff-list' });
    sec2.append(schoolStaffList);
    body.append(sec2);

    async function renderSchoolStaff() {
      const code = document.getElementById('ds-school-sel').value;
      schoolStaffList.innerHTML = '';
      if (!code) return;
      const schoolUsers = allStaff.filter(u => {
          if (u.user_group !== 'school' || u.status !== 'active') return false;
          if (u.workplace && u.workplace.startsWith(code)) return true;
          try {
            var extras = JSON.parse(u.workplace_secondary || '[]');
            return extras.some(function(e) { return e && e.startsWith(code); });
          } catch (_e) { return false; }
        });
      const assigned = (data.schoolStaff || []).filter(s => s.school_code === code);
      const assignedIds = new Set(assigned.map(s => s.user_id));

      if (!schoolUsers.length) {
        schoolStaffList.append(UI.h('div', { style: { color: '#94a3b8', fontSize: '13px', padding: '8px' } }, 'ไม่มีเจ้าหน้าที่สถานศึกษาในโรงเรียนนี้')); return;
      }
      // สร้างรายการ checkbox
      schoolUsers.forEach(u => {
        const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid #f1f5f9;cursor:pointer;font-size:14px;white-space:nowrap;justify-content:flex-start;';
          row.innerHTML = '<input type="checkbox" class="ds-school-staff-sel" value="' + u.id + '"' + (assignedIds.has(u.id) ? ' checked' : '') + ' /><span class="ds-name">' + (u.title || '') + ' ' + (u.full_name || '') + '</span>' + (u.position ? ' <span class="ds-position">' + u.position + '</span>' : '');
        schoolStaffList.appendChild(row);
      });
      // ปุ่มบันทึก
      schoolStaffList.append(UI.h('button', { className: 'btn btn-primary', style: { marginTop: '10px', fontSize: '13px' }, onclick: async () => {
        const ids = [...document.querySelectorAll('.ds-school-staff-sel:checked')].map(c => Number(c.value));
        try {
          await API.post('/document-staff/school', { school_code: code, userIds: ids });
          UI.toast('บันทึกเจ้าหน้าที่สถานศึกษาเรียบร้อย');
          DocumentsView.openStaffSettings();
        } catch (e) { UI.toast(e.message, 'error'); }
      } }, '▽ บันทึก'));
    }

    UI.modal({ title: '⊛ ตั้งค่าเจ้าหน้าที่หนังสือราชการ', body, size: 'lg' });
  },

  /** กำหนดเจ้าหน้าที่สารบัญ (admin only) */
  /** กำหนดเจ้าหน้าที่หนังสือรับรอง (admin only) */
  async openCertStaffSettings() {
    let data = { certStaff: [] };
    try { data = await API.get('/cert-staff'); } catch (_e) {}
    let allStaff = [];
    try { const d = await API.get('/staff'); allStaff = d.users || d.staff || []; } catch (_e) {}
    const assigned = new Set((data.certStaff || []).map(s => s.user_id));
    const candidates = allStaff.filter(u => u.user_group !== 'school' && u.status === 'active' && !assigned.has(u.id));
    const body = UI.h('div', { style: { maxHeight: '70vh', overflowY: 'auto' } });
    body.append(UI.h('div', { style: { fontSize: '13px', color: '#64748b', marginBottom: '12px' } }, 'เจ้าหน้าที่ที่กำหนดจะเห็นปุ่ม ลงทะเบียนหนังสือรับรอง และแก้ไข/ลบ/เปลี่ยนสถานะได้'));
    const listDiv = UI.h('div', { id: 'cert-staff-list' });
    function renderList() {
      listDiv.innerHTML = '';
      const rows = (data.certStaff || []);
      if (!rows.length) { listDiv.append(UI.h('div', { style: { color: '#94a3b8', fontSize: '13px' } }, 'ยังไม่มีเจ้าหน้าที่')); return; }
      rows.forEach(s => {
        listDiv.append(UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid #f1f5f9' } },
          UI.h('span', { style: { flex: 1, fontSize: '14px' } }, (s.title || '') + ' ' + (s.full_name || '') + (s.position ? ' — ' + s.position : '')),
          UI.h('button', { className: 'btn btn-danger', style: { fontSize: '11px', padding: '2px 8px' }, onclick: async () => {
            try { await API.del('/cert-staff/' + s.id); UI.toast('ลบเรียบร้อย'); DocumentsView.openCertStaffSettings(); } catch (e) { UI.toast(e.message, 'error'); }
          } }, '✕ ลบ')));
      });
    }
    renderList();
    body.append(listDiv);
    const sel = UI.h('select', { id: 'cert-staff-sel', style: { padding: '6px', borderRadius: '6px', fontSize: '14px', minWidth: '300px', verticalAlign: 'middle' } });
    sel.append(UI.h('option', { value: '' }, '-- เลือกเจ้าหน้าที่ สพป.แพร่ เขต 2 --'));
    candidates.forEach(u => sel.append(UI.h('option', { value: u.id }, (u.title || '') + ' ' + (u.full_name || '') + (u.position ? ' — ' + u.position : ''))));
    body.append(UI.h('div', { style: { display: 'flex', alignItems: 'center', marginTop: '10px', gap: '8px' } }, sel,
      UI.h('button', { className: 'btn btn-primary', style: { fontSize: '13px', padding: '6px 16px' }, onclick: async () => {
        const uid = Number(document.getElementById('cert-staff-sel').value);
        if (!uid) return UI.toast('กรุณาเลือกเจ้าหน้าที่', 'error');
        try { await API.post('/cert-staff', { userIds: [uid] }); UI.toast('เพิ่มเจ้าหน้าที่เรียบร้อย'); DocumentsView.openCertStaffSettings(); } catch (e) { UI.toast(e.message, 'error'); }
      } }, '+ เพิ่ม')));
    UI.modal({ title: '⊗ กำหนดเจ้าหน้าที่หนังสือรับรอง', body, size: 'lg' });
  },
  async openDocStaffSettings(type) {
    let data = { officeStaff: [], schoolStaff: [] };
    try { data = await API.get('/document-staff'); } catch (_e) {}
    let allStaff = [];
    try { const d = await API.get('/staff'); allStaff = d.users || d.staff || []; } catch (_e) {}
    let allSchools = [];
    try { const d = await API.get('/schools'); allSchools = (d.schools || []).sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'th', { numeric: true })); } catch (_e) {}

    if (type === 'office') {
      // === กำหนดเจ้าหน้าที่สารบัญเขต ===
      const officeSet = new Set((data.officeStaff || []).map(s => s.user_id));
      const officeUsers = allStaff.filter(u => u.user_group !== 'school' && u.status === 'active');
      const body = UI.h('div', { style: { maxHeight: '70vh', overflowY: 'auto' } });

      body.append(UI.h('div', { style: { fontSize: '16px', fontWeight: 'bold', marginBottom: '8px', color: '#1e40af' } }, '📋 กำหนดเจ้าหน้าที่สารบัญเขต'));
      body.append(UI.h('div', { style: { fontSize: '13px', color: '#64748b', marginBottom: '12px' } }, 'เจ้าหน้าที่ที่เลือกจะเห็นหนังสือที่สถานศึกษาส่งมาให้ สพป. และรับมอบหมายเป็นสารบัญ'));

      const listDiv = UI.h('div', { id: 'dcs-office-list' });
      function renderList() {
        listDiv.innerHTML = '';
        const rows = (data.officeStaff || []);
        if (!rows.length) { listDiv.append(UI.h('div', { style: { color: '#94a3b8', fontSize: '13px' } }, 'ยังไม่มีเจ้าหน้าที่')); return; }
        rows.forEach(s => {
          const row = UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid #f1f5f9' } },
            UI.h('span', { style: { flex: 1, fontSize: '14px' } }, (s.title || '') + ' ' + (s.full_name || '')),
            UI.h('button', { className: 'btn btn-danger', style: { fontSize: '11px', padding: '2px 8px' }, onclick: async () => {
              try { await API.del('/document-staff/office/' + s.id); UI.toast('ลบเรียบร้อย'); DocumentsView.openDocStaffSettings('office'); } catch (e) { UI.toast(e.message, 'error'); }
            } }, '✕ ลบ'));
          listDiv.append(row);
        });
      }
      renderList();
      body.append(listDiv);

      const unassigned = officeUsers.filter(u => !officeSet.has(u.id));
      const sel = UI.h('select', { id: 'dcs-office-sel', style: { padding: '6px', borderRadius: '6px', fontSize: '14px', minWidth: '300px', marginRight: '8px', verticalAlign: 'middle' } });
      sel.append(UI.h('option', { value: '' }, '-- เลือกเจ้าหน้าที่ --'));
      unassigned.forEach(u => sel.append(UI.h('option', { value: u.id }, (u.title || '') + ' ' + (u.full_name || '') + (u.position ? ' — ' + u.position : ''))));
      body.append(UI.h('div', { style: { display: 'flex', alignItems: 'center', marginTop: '10px', gap: '8px' } }, sel,
        UI.h('button', { className: 'btn btn-primary', style: { fontSize: '13px', padding: '6px 16px', verticalAlign: 'middle' }, onclick: async () => {
          const uid = Number(document.getElementById('dcs-office-sel').value);
          if (!uid) return UI.toast('กรุณาเลือกเจ้าหน้าที่', 'error');
          try { await API.post('/document-staff/office', { userIds: [uid] }); UI.toast('เพิ่มเจ้าหน้าที่เรียบร้อย'); DocumentsView.openDocStaffSettings('office'); } catch (e) { UI.toast(e.message, 'error'); }
        } }, '+ เพิ่ม')));
      UI.modal({ title: '📋 กำหนดเจ้าหน้าที่สารบัญเขต', body, size: 'lg' });

    } else {
      // === กำหนดเจ้าหน้าที่สารบัญสถานศึกษา ===
      const body = UI.h('div', { style: { maxHeight: '70vh', overflowY: 'auto' } });
      body.append(UI.h('div', { style: { fontSize: '16px', fontWeight: 'bold', marginBottom: '8px', color: '#1e40af' } }, '🏫 กำหนดเจ้าหน้าที่สารบัญสถานศึกษา'));
      body.append(UI.h('div', { style: { fontSize: '13px', color: '#64748b', marginBottom: '12px' } }, 'เลือกสถานศึกษา แล้วเลือกเจ้าหน้าที่สถานศึกษาที่จะรับหนังสือจาก สพป.'));

      const schoolSel = UI.h('select', { id: 'dcs-school-sel', style: { padding: '6px', borderRadius: '6px', minWidth: '300px', marginBottom: '10px' } });
      schoolSel.append(UI.h('option', { value: '' }, '-- เลือกสถานศึกษา --'));
      allSchools.forEach(s => schoolSel.append(UI.h('option', { value: s.code || '' }, (s.code || '') + ' ' + (s.name || ''))));
      body.append(schoolSel);

      const staffListDiv = UI.h('div', { id: 'dcs-school-staff' });
      body.append(staffListDiv);

      schoolSel.addEventListener('change', () => {
        const code = schoolSel.value;
        staffListDiv.innerHTML = '';
        if (!code) return;
        const schoolUsers = allStaff.filter(u => {
          if (u.user_group !== 'school' || u.status !== 'active') return false;
          if (u.workplace && u.workplace.startsWith(code)) return true;
          try {
            var extras = JSON.parse(u.workplace_secondary || '[]');
            return extras.some(function(e) { return e && e.startsWith(code); });
          } catch (_e) { return false; }
        });
        const assigned = (data.schoolStaff || []).filter(s => s.school_code === code);
        const assignedIds = new Set(assigned.map(s => s.user_id));

        if (!schoolUsers.length) { staffListDiv.append(UI.h('div', { style: { color: '#94a3b8', fontSize: '13px', padding: '8px' } }, 'ไม่มีเจ้าหน้าที่สถานศึกษาในโรงเรียนนี้')); return; }
        schoolUsers.forEach(u => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;padding:6px 4px;border-bottom:1px solid #f1f5f9;cursor:pointer;font-size:14px;';
          row.onclick = function() { var cb = row.querySelector('input'); if (cb) cb.click(); };
          const cbWrap = document.createElement('label');
          cbWrap.style.cssText = 'display:inline-flex;align-items:center;flex-shrink:0;margin-right:6px;cursor:pointer;';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.name = 'dcs-staff-cb';
          cb.className = 'dcs-staff-cb';
          cb.value = u.id;
          cb.style.cssText = 'margin:0;width:16px;height:16px;cursor:pointer;flex-shrink:0;';
          if (assignedIds.has(u.id)) cb.checked = true;
          cb.onclick = function(e) { e.stopPropagation(); };
          cbWrap.appendChild(cb);
          row.appendChild(cbWrap);
          const nameSpan = document.createElement('span');
          nameSpan.textContent = (u.title || '') + ' ' + (u.full_name || '');
          row.appendChild(nameSpan);
          if (u.position) {
            const posSpan = document.createElement('span');
            var schoolLabel = '';
          try {
            var extras = JSON.parse(u.workplace_secondary || '[]');
            var matched = extras.filter(function(e) { return e && e.startsWith(code); });
            if (matched.length && u.workplace && !u.workplace.startsWith(code)) schoolLabel = ' (ดูแล ' + matched[0].substring(0, 15) + '...)';
          } catch(_e) {}
          posSpan.textContent = ' — ' + u.position + schoolLabel;
            posSpan.style.cssText = 'color:#64748b;font-size:13px;margin-left:4px;';
            row.appendChild(posSpan);
          }
          staffListDiv.appendChild(row);
        });
        staffListDiv.append(UI.h('button', { className: 'btn btn-primary', style: { marginTop: '10px', fontSize: '13px' }, onclick: async () => {
          var checkedCbs = document.querySelectorAll('.dcs-staff-cb:checked');
          var ids = Array.from(checkedCbs).map(function(cb) { return Number(cb.value); });
          try { await API.post('/document-staff/school', { school_code: code, userIds: ids }); UI.toast('บันทึกเรียบร้อย'); DocumentsView.openDocStaffSettings('school'); } catch (e) { UI.toast(e.message, 'error'); }
        } }, '▽ บันทึก'));
      });
      UI.modal({ title: '🏫 กำหนดเจ้าหน้าที่สารบัญสถานศึกษา', body, size: 'lg' });
    }
  },

  /** 🏫 จัดการข้อมูลสถานศึกษา (admin only) */

  openSetSchoolDocPrefix() {
    const currentPrefix = DocumentsView._schoolDocPrefix || '';
    const body = UI.h('div', { style: { padding: '8px' } },
      UI.h('p', { style: { marginBottom: '12px', fontSize: '14px', color: '#334155' } }, 'กำหนดเลขหนังสือสถานศึกษา'),
      UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '12px' } },
        UI.h('span', { style: { fontSize: '14px', color: '#334155', whiteSpace: 'nowrap' } }, 'ที่ ศธ 04110.'),
        UI.h('input', { id: 'sdp-prefix', value: currentPrefix, placeholder: 'ให้กรอกเลข', style: { width: '120px', textAlign: 'center', fontSize: '14px', padding: '6px' } }))
    );
    const foot = UI.h('div', { style: { display: 'flex', gap: '8px' } },
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, 'บันทึก'));
    const m = UI.modal({ title: '🔢 กำหนดเลขหนังสือสถานศึกษา', body, footer: foot });

    async function save() {
      const val = document.getElementById('sdp-prefix').value.trim();
      try {
        const res = await API.put('/document-staff/school-prefix', { doc_prefix: val });
        UI.toast(res.message);
        DocumentsView._schoolDocPrefix = val;
        m.close();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

async openSchoolManage() {
    let allSchools = [];
    let officeStaffList = [];
    try { const d = await API.get('/office-staff'); officeStaffList = d.staff || []; } catch (_e) {}
    try { const d = await API.get('/schools'); allSchools = (d.schools || []).sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'th', { numeric: true })); } catch (_e) {}

    const body = UI.h('div', { style: { maxHeight: '70vh', overflowY: 'auto' } });
    const listDiv = UI.h('div', { id: 'sm-list' });
    body.append(listDiv);

    // ลบ edit panel เก่าถ้ามี
    function removeEditPanel() {
      const old = document.getElementById('sm-inline-edit');
      if (old) old.remove();
    }

    function renderList() {
      listDiv.innerHTML = '';
      if (!allSchools.length) { listDiv.append(UI.empty('ยังไม่มีข้อมูลสถานศึกษา', '🏫')); return; }
      allSchools.forEach(s => {
        const row = UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 4px', borderBottom: '1px solid #f1f5f9' } },
          UI.h('span', { style: { fontWeight: '600', fontSize: '13px', minWidth: '90px' } }, s.code || ''),
          UI.h('span', { style: { flex: 1, fontSize: '14px' } }, s.name || ''),
          UI.h('span', { style: { fontSize: '12px', color: '#64748b', minWidth: '120px' } }, s.group_name || ''),
          UI.h('span', { style: { fontSize: '12px', color: '#64748b', minWidth: '60px' } }, s.district || ''),
          UI.h('button', { className: 'btn btn-outline', style: { fontSize: '12px', padding: '3px 10px' }, onclick: () => showEdit(s, row) }, '✎ แก้ไข'),
          UI.h('button', { className: 'btn btn-danger', style: { fontSize: '12px', padding: '3px 10px' }, onclick: () => removeSchool(s) }, '✕ ลบ')
        );
        listDiv.append(row);
      });
    }
    renderList();

    // ปุ่มเพิ่มสถานศึกษาใหม่
    body.append(UI.h('button', { className: 'btn btn-primary', style: { marginTop: '12px' }, onclick: () => showEdit(null, null) }, '+ เพิ่มสถานศึกษาใหม่'));

    // แสดงฟอร์มแก้ไข inline ใต้รายการที่เลือก
    let currentEdit = null;
    function showEdit(s, anchorRow) {
      removeEditPanel();
      currentEdit = s;
      const d = s || {};
      const editDiv = UI.h('div', { id: 'sm-inline-edit', style: { padding: '12px 16px', background: '#f0f9ff', borderRadius: '8px', border: '1px solid #bfdbfe', margin: '4px 0' } });
      const form = UI.h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        UI.h('div', { style: { fontWeight: '600', fontSize: '15px', marginBottom: '4px' } }, s ? '✎ แก้ไขสถานศึกษา' : '+ เพิ่มสถานศึกษาใหม่'),
        UI.h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
          UI.h('label', { style: { fontSize: '13px', minWidth: '50px' } }, 'รหัส *'),
          UI.h('input', { id: 'sm-code', value: d.code || '', style: { flex: 1, padding: '6px 8px', fontSize: '13px' } })),
        UI.h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
          UI.h('label', { style: { fontSize: '13px', minWidth: '50px' } }, 'ชื่อ *'),
          UI.h('input', { id: 'sm-name', value: d.name || '', style: { flex: 1, padding: '6px 8px', fontSize: '13px' } })),
        UI.h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
          UI.h('label', { style: { fontSize: '13px', minWidth: '50px' } }, 'กลุ่ม'),
          UI.h('input', { id: 'sm-group', value: d.group_name || '', style: { flex: 1, padding: '6px 8px', fontSize: '13px' } })),
        UI.h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
          UI.h('label', { style: { fontSize: '13px', minWidth: '50px' } }, 'อำเภอ'),
          UI.h('input', { id: 'sm-district', value: d.district || '', style: { flex: 1, padding: '6px 8px', fontSize: '13px' } })),
        UI.h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' } },
          UI.h('button', { className: 'btn btn-outline', style: { fontSize: '13px' }, onclick: () => removeEditPanel() }, 'ยกเลิก'),
          UI.h('button', { className: 'btn btn-primary', style: { fontSize: '13px' }, onclick: saveEdit }, '▽ บันทึก'))
      );
      editDiv.append(form);
      // ถ้ามี anchorRow ให้ใส่ใต้รายการนั้น ไม่งั้นใส่ท้าย listDiv
      if (anchorRow && anchorRow.parentNode) {
        anchorRow.parentNode.insertBefore(editDiv, anchorRow.nextSibling);
      } else {
        listDiv.append(editDiv);
      }
    }

    async function saveEdit() {
      const code = document.getElementById('sm-code').value.trim();
      const name = document.getElementById('sm-name').value.trim();
      if (!code || !name) return UI.toast('กรุณากรอกรหัสและชื่อสถานศึกษา', 'error');
      const payload = { code, name, group_name: document.getElementById('sm-group').value.trim(), district: document.getElementById('sm-district').value.trim() };
      try {
        if (currentEdit && currentEdit.id) {
          await API.put('/schools/' + currentEdit.id, payload);
        } else {
          await API.post('/schools', payload);
        }
        UI.toast('บันทึกเรียบร้อย');
        removeEditPanel();
        const dd = await API.get('/schools');
        allSchools = (dd.schools || []).sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'th', { numeric: true }));
        renderList();
      } catch (e) { UI.toast(e.message, 'error'); }
    }

    async function removeSchool(s) {
      if (!confirm('ต้องการลบสถานศึกษา "' + s.name + '" ใช่หรือไม่?')) return;
      try {
        await API.del('/schools/' + s.id);
        UI.toast('ลบเรียบร้อย');
        allSchools = allSchools.filter(x => x.id !== s.id);
        renderList();
      } catch (e) { UI.toast(e.message, 'error'); }
    }

    UI.modal({ title: '🏫 จัดการข้อมูลสถานศึกษา', body, size: 'lg' });
  },
  openStampEditor(existingFileUrl) {
    var self=this;
    function launchStamp(file) { self._stampOverlay(file); }
    var fi=document.getElementById("df-file1");
    if(fi&&fi.files&&fi.files.length){launchStamp(fi.files[0]);return;}
    if(existingFileUrl){var xhr=new XMLHttpRequest();xhr.open("GET","/uploads/"+existingFileUrl,true);xhr.responseType="blob";xhr.onload=function(){if(xhr.status===200){var ct=xhr.getResponseHeader("Content-Type")||"application/pdf";var fakeFile=new File([xhr.response],existingFileUrl.split("/").pop(),{type:ct});launchStamp(fakeFile);}else{UI.toast("Cannot load file","error");}};xhr.send();return;}
    UI.toast("Attach file first","error");
  },
  _stampOverlay(origFile) {
    var origName=origFile.name;
    var ov=document.createElement("div");ov.id="stamp-overlay";
    ov.style.cssText="position:fixed;top:0;left:0;width:100vw;height:100vh;background:#fff;z-index:9999;display:flex;flex-direction:column;overflow:hidden";
    var hd=document.createElement("div");hd.style.cssText="display:flex;align-items:center;justify-content:space-between;padding:10px 20px;background:#1e293b;color:#fff;flex-shrink:0";
    var tt=document.createElement("span");tt.style.cssText="font-size:18px;font-weight:bold";tt.textContent="🔼️ Stamp Document";hd.appendChild(tt);
    var xcb=document.createElement("button");xcb.textContent="✕ ปิด";xcb.style.cssText="background:#ef4444;color:#fff;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:14px";
    xcb.onclick=function(){document.getElementById("stamp-overlay").remove();};hd.appendChild(xcb);ov.appendChild(hd);
    var tb=document.createElement("div");
    tb.style.cssText="display:flex;gap:6px;flex-wrap:wrap;padding:8px 20px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;flex-shrink:0;align-items:center";
    var ss=document.createElement("div");ss.id="stamp-source";
    ss.style.cssText="cursor:grab;padding:4px;border:2px solid #3b82f6;border-radius:6px;background:#fff;display:flex;align-items:center;gap:6px;font-size:13px";
    var sti=document.createElement("img");sti.src="/form/pumprub.png";sti.style.cssText="height:36px;pointer-events:none";
    ss.appendChild(sti);ss.appendChild(document.createTextNode("ปั้มรับ"));
    tb.appendChild(ss);
    function mkB(l){var b=document.createElement("button");b.textContent=l;b.className="btn btn-outline";b.style.cssText="padding:4px 12px;font-size:13px";return b;}
    var symBtn=document.createElement("button");symBtn.innerHTML="✔";symBtn.title="เครื่องหมายถูก";symBtn.className="btn btn-outline";symBtn.style.cssText="padding:4px 10px;font-size:18px;color:#3b82f6;border:1px solid #3b82f6;background:#fff";var txtBtn=mkB("✍️ Text");txtBtn.style.cssText="padding:4px 12px;font-size:13px;color:#3b82f6;border:1px solid #3b82f6";var dtBtn=mkB("◷ Date");dtBtn.style.cssText="padding:4px 12px;font-size:13px;color:#ef4444;border:1px solid #ef4444";var clb=mkB("✖ ล้างทั้งหมด");clb.style.marginLeft="auto";
    tb.appendChild(symBtn);tb.appendChild(txtBtn);tb.appendChild(dtBtn);tb.appendChild(clb);ov.appendChild(tb);
    var tip=document.createElement("div");tip.id="stamp-text-panel";
    tip.style.cssText="display:none;padding:8px 20px;background:#f8fafc;border-bottom:1px solid #e2e8f0;flex-shrink:0;gap:8px;font-size:13px;align-items:center";
    var tiv=document.createElement("input");tiv.id="st-text-val";tiv.style.cssText="width:200px;padding:4px";
    var tic=document.createElement("input");tic.id="st-text-color";tic.type="color";tic.value="#3b82f6";tic.style.cssText="width:40px;height:28px";
    var tis=document.createElement("input");tis.id="st-text-size";tis.type="number";tis.value="16";tis.min="8";tis.max="72";tis.style.cssText="width:60px;padding:4px";
    tip.appendChild(document.createTextNode("Text: "));tip.appendChild(tiv);tip.appendChild(document.createTextNode(" Color: "));tip.appendChild(tic);tip.appendChild(document.createTextNode(" Size: "));tip.appendChild(tis);
    ov.appendChild(tip);
    var pgb=document.createElement("div");pgb.style.cssText="flex:1;overflow:auto;background:#e2e8f0;padding:16px;display:flex;flex-direction:column;align-items:center;gap:16px";ov.appendChild(pgb);
    var stxt=document.createElement("div");stxt.style.cssText="font-size:12px;color:#64748b;padding:4px 20px;background:#f8fafc;border-top:1px solid #e2e8f0;flex-shrink:0";stxt.textContent="กำลังโรย PDF...";ov.appendChild(stxt);
    var sbr=document.createElement("div");sbr.style.cssText="text-align:right;padding:8px 20px;border-top:1px solid #e2e8f0;background:#f8fafc;flex-shrink:0";
    var svb=document.createElement("button");svb.className="btn btn-primary";svb.textContent="ปั้มรับ";sbr.appendChild(svb);ov.appendChild(sbr);
    document.body.appendChild(ov);
    var pws=[],ast=[],SW=140,toolMode="stamp";
    if(origFile.type==="application/pdf"){var rd=new FileReader();rd.onload=function(ev){pdfjsLib.GlobalWorkerOptions.workerSrc="/vendor/pdfjs/pdf.worker.min.js";pdfjsLib.getDocument({data:new Uint8Array(ev.target.result)}).promise.then(rPdf).catch(function(e){stxt.textContent="Error: "+e.message;});};rd.readAsArrayBuffer(origFile);}
    else if(origFile.type.startsWith("image/")){var rd2=new FileReader();rd2.onload=function(ev){var im=new Image();im.onload=function(){rImg(im);};im.src=ev.target.result;};rd2.readAsDataURL(origFile);}
    else{stxt.textContent="Unsupported file";}
    function rPdf(pdf){(async function(){for(var pg2=1;pg2<=pdf.numPages;pg2++){var pg=await pdf.getPage(pg2);var vp=pg.getViewport({scale:1.2});var wr=document.createElement("div");wr.style.cssText="position:relative;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.15);margin-bottom:16px";wr.dataset.page=pg2;var lb=document.createElement("div");lb.style.cssText="position:absolute;top:4px;right:8px;font-size:12px;color:#64748b;background:rgba(255,255,255,0.8);padding:2px 8px;border-radius:4px;pointer-events:none";lb.textContent=pg2+"/"+pdf.numPages;wr.appendChild(lb);var cv=document.createElement("canvas");cv.width=vp.width;cv.height=vp.height;wr.appendChild(cv);pgb.appendChild(wr);pws.push(wr);await pg.render({canvasContext:cv.getContext("2d"),viewport:vp}).promise;sDZ(wr,pg2);}stxt.textContent="PDF "+pdf.numPages+" pages";})();}
    function rImg(im){var wr=document.createElement("div");wr.style.cssText="position:relative;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.15);margin-bottom:16px;display:inline-block";wr.dataset.page="1";var cv=document.createElement("canvas");var mw=Math.min(window.innerWidth-100,900);var sc=Math.min(mw/im.width,1.5);cv.width=im.width*sc;cv.height=im.height*sc;cv.getContext("2d").drawImage(im,0,0,cv.width,cv.height);wr.appendChild(cv);pgb.appendChild(wr);pws.push(wr);sDZ(wr,1);stxt.textContent="Image loaded";}
    function sDZ(wr,pn){wr.addEventListener("pointerdown",function(e){if(e.target.closest(".stamp-elem"))return;var r=wr.getBoundingClientRect();var sx=e.clientX-r.left,sy=e.clientY-r.top;
      if(toolMode==="text"){var tv=document.getElementById("st-text-val").value;if(!tv){UI.toast("Enter text","error");return;}aTxt(wr,sx,sy,tv,document.getElementById("st-text-color").value,parseInt(document.getElementById("st-text-size").value)||24,pn);return;}
      if(toolMode==="date"){return;}
      if(toolMode==="symbol"){aSym(wr,sx,sy,pn);return;}
      aS(wr,sx,sy,SW,pn);});}
    function mkDel(el){var d=document.createElement("button");d.textContent="✕";d.style.cssText="position:absolute;top:-8px;right:-8px;background:#ef4444;color:#fff;border:none;width:20px;height:20px;border-radius:50%;cursor:pointer;font-size:12px;line-height:20px;text-align:center;padding:0;z-index:2";d.onclick=function(e){e.stopPropagation();el.remove();ast=ast.filter(function(s){return s.el!==el;});};return d;}
    function mkRz(el,wr,fn){var rz=document.createElement("div");rz.style.cssText="position:absolute;bottom:0;right:0;width:16px;height:16px;background:#3b82f6;cursor:nwse-resize;border-radius:0 0 4px 0;font-size:10px;color:#fff;display:flex;align-items:center;justify-content:center;z-index:2";rz.textContent="⤡";var rzz=false;rz.addEventListener("pointerdown",function(e){e.stopPropagation();e.preventDefault();rzz=true;rz.setPointerCapture(e.pointerId);});rz.addEventListener("pointermove",function(e){if(!rzz)return;fn(e,el,wr);});rz.addEventListener("pointerup",function(){rzz=false;});return rz;}
    function mkDrag(el,wr){var drag=false,dx=0,dy=0;el.addEventListener("pointerdown",function(e){if(e.target.tagName==="BUTTON"||e.target.style.cursor==="nwse-resize")return;e.preventDefault();drag=true;var sr=el.getBoundingClientRect();dx=e.clientX-sr.left;dy=e.clientY-sr.top;el.setPointerCapture(e.pointerId);});el.addEventListener("pointermove",function(e){if(!drag)return;var r=wr.getBoundingClientRect();el.style.left=(e.clientX-r.left-dx)+"px";el.style.top=(e.clientY-r.top-dy)+"px";});el.addEventListener("pointerup",function(){drag=false;});}
    function aS(wr,x,y,w,pn){var el=document.createElement("div");el.className="stamp-elem";el.style.cssText="position:absolute;cursor:move;user-select:none";el.dataset.page=pn;var im=document.createElement("img");im.src="/form/pumprub.png";im.style.cssText="width:"+w+"px;pointer-events:none;display:block";el.appendChild(im);el.appendChild(mkDel(el));el.appendChild(mkRz(el,wr,function(e,el2,wr2){var nw=e.clientX-el2.getBoundingClientRect().left;nw=Math.max(40,Math.min(wr2.getBoundingClientRect().width-20,nw));el2.style.width=nw+"px";im.style.width=nw+"px";}));wr.appendChild(el);el.style.left=Math.max(0,x-w/2)+"px";el.style.top=Math.max(0,y-20)+"px";el.style.width=w+"px";mkDrag(el,wr);ast.push({el:el,page:pn,type:"image"});}
    function aTxt(wr,x,y,text,color,size,pn){var el=document.createElement("div");el.className="stamp-elem";el.style.cssText="position:absolute;cursor:move;user-select:none;font-family:TH SarabunNew,sans-serif;white-space:nowrap;color:"+color+";font-size:"+size+"px;font-weight:normal;text-shadow:1px 1px 2px rgba(255,255,255,0.8)";el.textContent=text;el.dataset.page=pn;el.appendChild(mkDel(el));el.appendChild(mkRz(el,wr,function(e,el2){var nw=e.clientX-el2.getBoundingClientRect().left;el2.style.fontSize=Math.max(8,Math.round(size*nw/100))+"px";}));wr.appendChild(el);el.style.left=Math.max(0,x)+"px";el.style.top=Math.max(0,y-size)+"px";mkDrag(el,wr);ast.push({el:el,page:pn,type:"text"});}
    function aSym(wr,x,y,pn){var el=document.createElement("div");el.className="stamp-elem";el.style.cssText="position:absolute;cursor:move;user-select:none;font-size:24px;color:#3b82f6;font-weight:bold;text-shadow:1px 1px 2px rgba(255,255,255,0.8)";el.textContent="✔";el.dataset.page=pn;el.appendChild(mkDel(el));el.appendChild(mkRz(el,wr,function(e,el2){var nw=e.clientX-el2.getBoundingClientRect().left;el2.style.fontSize=Math.max(16,Math.round(32*nw/50))+"px";}));wr.appendChild(el);el.style.left=Math.max(0,x-15)+"px";el.style.top=Math.max(0,y-20)+"px";mkDrag(el,wr);ast.push({el:el,page:pn,type:"symbol"});}
    function setTool(mode,btn){toolMode=mode;[symBtn,txtBtn,dtBtn,ss].forEach(function(b){b.style.borderColor="#3b82f6";b.style.background="#fff";});btn.style.borderColor="#16a34a";btn.style.background="#dbeafe";tip.style.display=mode==="text"?"flex":"none";}
    symBtn.onclick=function(){setTool("symbol",symBtn);};
    txtBtn.onclick=function(){setTool("text",txtBtn);};
dtBtn.onclick=function(){
      setTool("date",dtBtn);
      // Create popup date picker
      var existing = document.getElementById('ds-date-popup');
      if(existing){existing.remove();return;}
      var popup = document.createElement('div');
      popup.id = 'ds-date-popup';
      popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;border:2px solid #3b82f6;border-radius:12px;padding:20px;z-index:999999;box-shadow:0 4px 20px rgba(0,0,0,0.3);min-width:280px;';
      var title = document.createElement('div');
      title.style.cssText = 'font-size:16px;font-weight:bold;margin-bottom:12px;color:#334155;';
      title.textContent = 'เลือกวันที่';
      popup.appendChild(title);
      var dateInput = document.createElement('input');
      dateInput.type = 'date';
      dateInput.style.cssText = 'width:100%;padding:10px;font-size:16px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;';
      var now = new Date();
      var yy = now.getFullYear();
      var mm = String(now.getMonth()+1).padStart(2,'0');
      var dd = String(now.getDate()).padStart(2,'0');
      dateInput.value = yy+'-'+mm+'-'+dd;
      popup.appendChild(dateInput);
      var btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:8px;margin-top:12px;';
      var okBtn = document.createElement('button');
      okBtn.textContent = 'ตกลง';
      okBtn.style.cssText = 'flex:1;padding:10px;background:#3b82f6;color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;';
      var cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'ยกเลิก';
      cancelBtn.style.cssText = 'flex:1;padding:10px;background:#e5e7eb;color:#374151;border:none;border-radius:8px;cursor:pointer;font-size:14px;';
      btnRow.appendChild(okBtn);
      btnRow.appendChild(cancelBtn);
      popup.appendChild(btnRow);
      document.body.appendChild(popup);
      okBtn.onclick = function() {
        var val = dateInput.value;
        if(!val){popup.remove();return;}
        var d = new Date(val);
        var months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
        var buddhistYear = d.getFullYear()+543;
        var thaiDate = d.getDate()+' '+months[d.getMonth()]+' '+buddhistYear;
        // Add text element to stamp area
        var wr = pws[0];
        if(wr){
          aTxt(wr, 20, 40, thaiDate, '#ef4444', 16, 1);
        }
        toolMode = null;
        [symBtn,txtBtn,dtBtn,ss].forEach(function(b){b.style.borderColor='#3b82f6';b.style.background='#fff';});
        popup.remove();
      };
      cancelBtn.onclick = function() {
        toolMode = null;
        [symBtn,txtBtn,dtBtn,ss].forEach(function(b){b.style.borderColor='#3b82f6';b.style.background='#fff';});
        popup.remove();
      };
    };
    
    ss.onclick=function(){setTool("stamp",ss);};
    clb.onclick=function(){ast.forEach(function(s){if(s.el.isConnected)s.el.remove();});ast=[];};
    ss.addEventListener("pointerdown",function(e){e.preventDefault();var g=document.createElement("div");g.style.cssText="position:fixed;pointer-events:none;z-index:10000;opacity:0.8";var gi=document.createElement("img");gi.src="/form/pumprub.png";gi.style.cssText="height:60px";g.appendChild(gi);g.style.left=(e.clientX-40)+"px";g.style.top=(e.clientY-30)+"px";document.body.appendChild(g);ss.setPointerCapture(e.pointerId);ss._g=g;});
    ss.addEventListener("pointermove",function(e){if(!ss._g)return;ss._g.style.left=(e.clientX-40)+"px";ss._g.style.top=(e.clientY-30)+"px";});
    ss.addEventListener("pointerup",function(e){if(ss._g){ss._g.remove();ss._g=null;}for(var i=0;i<pws.length;i++){var r=pws[i].getBoundingClientRect();if(e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom){aS(pws[i],e.clientX-r.left,e.clientY-r.top,SW,i+1);break;}}});
    ss.addEventListener("pointercancel",function(){if(ss._g){ss._g.remove();ss._g=null;}});
    svb.onclick=function(){var active=ast.filter(function(x){return x.el.isConnected;});if(!active.length){UI.toast("กรุณาวางสิ่งที่ต้องการปั้มก่อน","error");return;}
      var canvases=pgb.querySelectorAll("canvas");
      (async function(){
        try{
          var stampImg = new Image(); stampImg.src = "/form/pumprub.png";
          await new Promise(function(r){ stampImg.onload=r; stampImg.onerror=r; setTimeout(r,1000); });
          var isPdf=origFile.type==="application/pdf";
          var pageImages=[];
          for(var ci=0;ci<canvases.length;ci++){var cv=canvases[ci];var wr=cv.parentElement;var pn=parseInt(wr.dataset.page)||ci+1;
            var tmp=document.createElement("canvas");tmp.width=cv.width;tmp.height=cv.height;var ctx=tmp.getContext("2d");ctx.drawImage(cv,0,0);
            var elems=active.filter(function(x){return parseInt(x.el.dataset.page)===pn;});
elems.forEach(function(x){var r=wr.getBoundingClientRect();
              var ox=(x.el.getBoundingClientRect().left-r.left)/r.width*cv.width;
              var oy=(x.el.getBoundingClientRect().top-r.top)/r.height*cv.height;
              var ow=x.el.offsetWidth/r.width*cv.width;
              if(x.type==="image"){ctx.drawImage(stampImg,ox,oy,ow,ow*(stampImg.naturalHeight/stampImg.naturalWidth||1));}
              else if(x.type==="symbol"){ctx.font="24px sans-serif";ctx.fillStyle=x.el.style.color||"#3b82f6";var symTxt="";for(var si2=0;si2<x.el.childNodes.length;si2++){if(x.el.childNodes[si2].nodeType===3)symTxt+=x.el.childNodes[si2].textContent;}ctx.fillText(symTxt.trim(),ox,oy+20);}
              else{var fsz=parseFloat(x.el.style.fontSize)||16;ctx.font=fsz+"px TH SarabunNew,sans-serif";ctx.fillStyle=x.el.style.color||"#000";var txt="";for(var ni=0;ni<x.el.childNodes.length;ni++){if(x.el.childNodes[ni].nodeType===3)txt+=x.el.childNodes[ni].textContent;}ctx.fillText(txt.trim(),ox,oy+fsz);}});
            var imgData=await new Promise(function(r2){tmp.toBlob(r2,"image/png");});
            pageImages.push({data:imgData,width:cv.width,height:cv.height});
          }
          var resultBlob=null;
          if(isPdf && typeof PDFLib!=="undefined"){
            var origBytes=await origFile.arrayBuffer();
            var pdfDoc=await PDFLib.PDFDocument.load(origBytes);
            for(var pi=0;pi<pageImages.length;pi++){
              var pg=pdfDoc.getPage(pi);
              var dims=pg.getSize();
              var imgBytes=await pageImages[pi].data.arrayBuffer();
              var imgEmbed=await pdfDoc.embedPng(imgBytes);
              pg.drawImage(imgEmbed,{x:0,y:0,width:dims.width,height:dims.height});
            }
            var pdfBytes=await pdfDoc.save();
            resultBlob=new Blob([pdfBytes],{type:"application/pdf"});
          }else{
            if(pageImages.length>0){var b=await pageImages[0].data.arrayBuffer();resultBlob=new Blob([b],{type:"image/png"});}
          }
          if(resultBlob){
            var ext=isPdf?".pdf":".png";
            var fname=origName.split(".").slice(0,-1).join(".")+ext;
            var mime=isPdf?"application/pdf":"image/png";
            // ใส่ไฟล์ที่ปั้มแล้วกลับลงช่องแนบไฟล์ (df-file1) เพื่อให้บันทึกทับไฟล์เดิมตอนกดบันทึก
            var fi=document.getElementById("df-file1");
            var assigned=false;
            if(fi){try{var dt=new DataTransfer();dt.items.add(new File([resultBlob],fname,{type:mime}));fi.files=dt.files;assigned=true;}catch(ex){}}
            if(!assigned){DocumentsView._stampedPendingFile=new File([resultBlob],fname,{type:mime});}
            UI.toast(assigned?("ปั้มรับเรียบร้อย: "+fname+" — กดบันทึกเพื่อบันทึกทับไฟล์เดิม"):"ปั้มรับเรียบร้อย: "+fname);
          }
        }catch(e){UI.toast("ข้อผิดพลาด: "+e.message,"error");}
        document.getElementById("stamp-overlay").remove();
      })();};
  }

  ,printHonorFile: function(filePath) {
    var w = window.open('/uploads/' + filePath, '_blank', 'width=1100,height=800');
    if (!w) { UI.toast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต pop-up แล้วลองใหม่', 'error'); return; }
    w.document.write('<html><head><title>พิมพ์เกียรติบัตร</title><style>' +
      '@page { size: A4 landscape; margin: 0; }' +
      'html,body { margin:0; padding:0; height:100%; }' +
      'img { width:100%; height:100%; object-fit:contain; }' +
      '</style></head><body>' +
      '<img src="/uploads/' + filePath + '" onload="setTimeout(function(){window.print();},300)" />' +
      '</body></html>');
    w.document.close();
  }

};
