'use strict';
/* เมนู 8: ขออนุญาตลา */

const LEAVE_GROUPS = [
  { key: 'general', label: '🤒 ขออนุญาตลาป่วย ลากิจ ลาคลอด', short: 'ลาป่วย / ลากิจ / ลาคลอด', btn: '🤒 ยื่นคำลาป่วย ลากิจ ลาคลอด', ugroup: 'office' },
  { key: 'vacation', label: '🏖️ ขออนุญาตลาพักผ่อน', short: 'ลาพักผ่อน', btn: '🏖️ ยื่นคำลาพักผ่อน', ugroup: 'office' },
  { key: 'general-school', label: '🏫 ลาป่วย ลากิจ ลาคลอด (สถานศึกษา)', short: 'ลาป่วย/ลากิจ/ลาคลอด (สถานศึกษา)', btn: '🤒 ยื่นคำลาป่วย ลากิจ ลาคลอด', ugroup: 'school' },
];
// เมนูสำหรับ admin + ผู้อนุมัติเท่านั้น
const LEAVE_ADMIN_GROUPS = [
  { key: 'balance', label: '◷ วันลาพักผ่อนสะสม', short: 'วันลาพักผ่อนสะสม' },
  { key: 'settings-approver', label: '⊛ เจ้าหน้าที่การลา สพป. (3 ลำดับ)', short: 'เจ้าหน้าที่การลา สพป.', scope: 'office' },
  { key: 'settings-approver-school', label: '⊛ เจ้าหน้าที่การลาสถานศึกษา (3 ลำดับ)', short: 'เจ้าหน้าที่การลาสถานศึกษา', scope: 'school' },
  { key: 'leave-stats', label: '📊 สถิติลาป่วย ลากิจ ลาคลอด', short: 'สถิติลา' },
  { key: 'vac-stats', label: '📊 สถิติลาพักผ่อน', short: 'สถิติลาพักผ่อน' },
  { key: 'my-stats', label: '📊 สถิติการลาของฉัน', short: 'สถิติการลาของฉัน' },
];

const LeaveView = {
  async render(app) {
    const isAdmin = Auth.isAdmin();
    // deep-link: รับแทปจาก URL เช่น #/leave?tab=vacation (จากการ์ดแจ้งเตือนหน้าแรก)
    const urlTab = new URLSearchParams(location.hash.split('?')[1] || '').get('tab');
    let currentGroup = (urlTab && (LEAVE_GROUPS.some((g) => g.key === urlTab) || (isAdmin && LEAVE_ADMIN_GROUPS.some((g) => g.key === urlTab))))
      ? urlTab
      : (localStorage.getItem('leave_tab') || 'general');
    if (urlTab) localStorage.setItem('leave_tab', currentGroup);
    // Reset to general if saved tab is not accessible by current user (หรือแทปที่ถูกเอาออกแล้ว เช่น vacation-school)
    if (!isAdmin && (currentGroup === 'balance' || currentGroup === 'settings-approver' || currentGroup === 'settings-approver-school')) {
      currentGroup = 'general';
      localStorage.setItem('leave_tab', 'general');
    }
    const knownTabKeys = LEAVE_GROUPS.map((g) => g.key).concat(LEAVE_ADMIN_GROUPS.map((g) => g.key));
    if (!knownTabKeys.includes(currentGroup)) {
      currentGroup = 'general';
      localStorage.setItem('leave_tab', 'general');
    }
    // ตรวจสอบว่าเป็นผู้ตรวจสอบ (ขั้นที่ 1) หรือไม่ (ใช้ endpoint ที่ไม่ต้องใช้ admin)
    let isLeaveStaff = false;
    let leaveApproversData = null;
    let leavePerPerson = null;
    try {
      const la = await API.get('/leave-approvers-public');
      leaveApproversData = la.approvers;
      leavePerPerson = la.perPerson || null;
      const uid = Auth.user.id;
      // Check if user is approver at any level (inspector/initial/final)
      isLeaveStaff = (la.approvers['1'] || []).includes(uid) || (la.approvers['2'] || []).includes(uid) || (la.approvers['3'] || []).includes(uid);
    } catch (_e) {}
    const isSchool = Auth.user && Auth.user.user_group === 'school';
    // แทปแยกตามกลุ่มผู้ใช้: เจ้าหน้าที่สถานศึกษาเห็นเฉพาะแทปสถานศึกษา | สพป. เห็นเฉพาะแทป สพป. | admin เห็นทั้ง 2 กลุ่ม
    const myUgroup = isSchool ? 'school' : 'office';
    const allGroups = isAdmin ? LEAVE_GROUPS.slice() : LEAVE_GROUPS.filter(g => g.ugroup === myUgroup);
    // วันลาพักผ่อนสะสม: admin + ผู้ตรวจสอบ (ขั้นที่ 1) เท่านั้น
    if (isAdmin || isLeaveStaff) allGroups.push(LEAVE_ADMIN_GROUPS[0]);
    // สถิติลาป่วย ลากิจ ลาคลอด + สถิติลาพักผ่อน: เจ้าหน้าที่ สพป.แพร่ เขต 2 เห็นทุกคน (admin เห็นแล้วอยู่แล้ว)
    if (isAdmin || !isSchool) allGroups.push(LEAVE_ADMIN_GROUPS[3], LEAVE_ADMIN_GROUPS[4]);
    // สถิติการลาของฉัน: ทุกคนเห็น (ใช้ข้อมูลของ user นั้นๆ)
    allGroups.push(LEAVE_ADMIN_GROUPS[5]);
    // ตั้งค่าเจ้าหน้าที่การลา (2 หน้า: สพป. + สถานศึกษา): admin เท่านั้น
    if (isAdmin) allGroups.push(LEAVE_ADMIN_GROUPS[1], LEAVE_ADMIN_GROUPS[2]);
    // กันแท็บที่ผู้ใช้นี้เข้าไม่ได้ (เช่น แท็บสถิติของสถานศึกษา) — รีเซ็ตกลับแท็บทั่วไป
    if (!allGroups.some((g) => g.key === currentGroup)) {
      currentGroup = 'general';
      localStorage.setItem('leave_tab', 'general');
    }

    const head = UI.h('div', { className: 'page-head' },
      UI.h('div', {},
        UI.h('div', { className: 'page-title' }, UI.h('span', { className: 'pi' }, '☀'), 'ขออนุญาตลา'),
        UI.h('div', { className: 'page-desc' }, 'ยื่นคำขอลา รอผู้ดูแลระบบอนุมัติ')),
    );
    app.append(head);

    // เมนูย่อยทั้งหมด
    const seg = UI.h('div', { className: 'seg', style: { flexWrap: 'wrap' } });
    const segBtns = allGroups.map((g) => {
      const b = UI.h('button', { className: 'seg-btn' + (currentGroup === g.key ? ' active' : ''), onclick: () => {
        currentGroup = g.key; localStorage.setItem('leave_tab', g.key);
        segBtns.forEach((x, i) => x.className = 'seg-btn' + (allGroups[i].key === currentGroup ? ' active' : ''));
        showSubElements();
      } }, g.label);
      return b;
    });
    seg.append(...segBtns);
    app.append(UI.h('div', { className: 'toolbar', style: { justifyContent: 'flex-start' } }, seg));

    // แถวปุ่มยื่นคำขอ + ตัวกรอง (ซ่อนเมื่อเลือก balance)
    const submitBtn = UI.h('button', {
      className: 'btn btn-primary',
      onclick: () => LeaveView.openForm(currentGroup),
    }, LEAVE_GROUPS.find((g) => g.key === currentGroup)?.btn || '');
    const submitRow = UI.h('div', { className: 'toolbar', style: { justifyContent: 'flex-start', marginTop: '-4px' } }, submitBtn);

    const now = new Date(); const curMonth = now.getMonth();
    const curFY = (curMonth >= 9 ? now.getFullYear() + 544 : now.getFullYear() + 543);
    const fySel = UI.h('select', { id: 'lv-year', onchange: () => { rebuildRoundSel(); if (currentGroup === 'leave-stats') loadLeaveStats(); else if (currentGroup === 'vac-stats') loadVacStats(); else if (currentGroup === 'my-stats') loadMyStats(); else loadLeaves(); } },
      UI.h('option', { value: curFY + 1 }, 'ปีงบประมาณ ' + (curFY + 1)),
      UI.h('option', { value: curFY }, 'ปีงบประมาณ ' + curFY),
      UI.h('option', { value: curFY - 1 }, 'ปีงบประมาณ ' + (curFY - 1)),
      UI.h('option', { value: '' }, 'ทุกปีงบประมาณ'));
    fySel.value = String(curFY); // ค่าเริ่มต้น = ปีงบประมาณปัจจุบัน (ตัวเลือกปีถัดไป 2570 ไว้ให้เลือกเอง)
    const canSeeAll = isAdmin || isLeaveStaff;
    window._lvMyOnly = !canSeeAll;
    // รอบพิจารณาความชอบ — เฉพาะแทปรายการคำขอลา (ไม่รวมแทปสถิติ/ตั้งค่า/วันลาสะสม)
    // ปีของรอบยึดตามปีงบประมาณที่เลือก (lv-year) — เลือกปี 2570 แล้วรอบทั้งหมดขยายเป็น 2570 ให้หมด
    const yearSel0 = document.getElementById('lv-year');
    const curYearBE = Number(yearSel0 && yearSel0.value) || (now.getFullYear() + 543);
    const roundSel = UI.h('select', { id: 'lv-round', onchange: () => { if (currentGroup === 'leave-stats') loadLeaveStats(); else if (currentGroup === 'vac-stats') loadVacStats(); else if (currentGroup === 'my-stats') loadMyStats(); else loadLeaves(); } },
      UI.h('option', { value: 'year' }, 'ในรอบปีงบประมาณ ' + curYearBE),
      UI.h('option', { value: 'round1' }, 'รอบที่ 1 (1 ต.ค. ' + (curYearBE - 1) + ' - 31 มี.ค. ' + curYearBE + ')'),
      UI.h('option', { value: 'round2' }, 'รอบที่ 2 (1 เม.ย. - 30 ก.ย. ' + curYearBE + ')'));
    // เมื่อเปลี่ยนปีงบประมาณ ให้สร้างตัวเลือกรอบใหม่ตามปีที่เลือก แล้วโหลดรายการใหม่
    // เมื่อเลือก “ทุกปีงบประมาณ” → ซ่อนตัวกรองรอบ (รอบมีความหมายเฉพาะในปีที่ระบุ) เพื่อไม่ตัดรายการปีอื่นออก
    function rebuildRoundSel() {
      const yEl = document.getElementById('lv-year');
      const y = Number(yEl && yEl.value) || (new Date().getFullYear() + 543);
      roundSel.innerHTML = '';
      roundSel.append(
        UI.h('option', { value: 'year' }, 'ในรอบปีงบประมาณ ' + y),
        UI.h('option', { value: 'round1' }, 'รอบที่ 1 (1 ต.ค. ' + (y - 1) + ' - 31 มี.ค. ' + y + ')'),
        UI.h('option', { value: 'round2' }, 'รอบที่ 2 (1 เม.ย. - 30 ก.ย. ' + y + ')'));
      roundSel.style.display = (yEl && yEl.value) ? '' : 'none';
    }
    // ตัวเลือกรอบแสดงตลอด (แท็บรายการลา + แท็บสถิติทุกแบบใช้ร่วมกัน — ซ่อน/แสดงด้วย showSubElements)
    const filterRow = UI.h('div', { className: 'filter-row', style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
      ...(canSeeAll ? [UI.h('button', { className: 'btn' + (canSeeAll ? ' active' : ''), id: 'lv-all-btn', onclick: () => { window._lvMyOnly = false; document.getElementById('lv-my-btn')?.classList.remove('active'); document.getElementById('lv-all-btn')?.classList.add('active'); loadLeaves(); } }, 'ขออนุญาตลาทั้งหมด')] : []),
      UI.h('button', { className: 'btn' + (!canSeeAll ? ' active' : ''), id: 'lv-my-btn', onclick: () => { window._lvMyOnly = true; document.getElementById('lv-all-btn')?.classList.remove('active'); document.getElementById('lv-my-btn')?.classList.add('active'); loadLeaves(); } }, 'ขออนุญาตลาของฉัน'),
      roundSel,
      UI.h('select', { id: 'lv-status', onchange: () => loadLeaves() },
        UI.h('option', { value: '' }, 'ทุกสถานะ'),
        UI.h('option', { value: 'pending' }, 'รออนุมัติ'),
        UI.h('option', { value: 'approved' }, 'อนุมัติแล้ว'),
        UI.h('option', { value: 'rejected' }, 'ไม่อนุมัติ'),
        UI.h('option', { value: 'cancelled' }, 'ยกเลิก')),
      fySel,
    );
    app.append(submitRow);
    app.append(filterRow);

    const card = UI.h('div', { className: 'card' }, UI.loading());
    app.append(card);

    function showSubElements() {
      const isHide = (currentGroup === 'balance' || currentGroup === 'settings-approver' || currentGroup === 'settings-approver-school');
      // แทปสถิติ: ไม่แสดงปุ่มยื่นคำขอ แต่แสดงแถวตัวเลือกรอบพิจารณาความชอบ
      const isStats = (currentGroup === 'leave-stats' || currentGroup === 'vac-stats' || currentGroup === 'my-stats');
      submitRow.style.display = isHide || isStats ? 'none' : '';
      filterRow.style.display = isHide ? 'none' : '';
      if (isStats) {
        // แท็บสถิติการลาของฉัน: แสดงทั้งตัวเลือกปีงบประมาณและรอบ | แท็บสถิติอื่น: แสดงเฉพาะรอบ
        [...filterRow.children].forEach((el) => {
          const keep = el.id === 'lv-round' || (currentGroup === 'my-stats' && el.id === 'lv-year');
          if (!keep) el.style.display = 'none';
        });
      } else {
        [...filterRow.children].forEach((el) => { el.style.display = ''; });
      }
      // อัปเดตข้อความปุ่มยื่นคำขอตามเมนูย่อยที่เลือก
      if (!isHide) {
        const meta = LEAVE_GROUPS.find((g) => g.key === currentGroup);
        submitBtn.textContent = meta ? meta.btn : '';
      }
      if (currentGroup === 'balance') loadBalance();
      else if (currentGroup === 'settings-approver') loadSettingsApprover('office');
      else if (currentGroup === 'settings-approver-school') loadSettingsApprover('school');
      else if (currentGroup === 'leave-stats') loadLeaveStats();
      else if (currentGroup === 'vac-stats') loadVacStats();
      else if (currentGroup === 'my-stats') loadMyStats();
      else loadLeaves();
    }

    async function loadLeaves() {
      const status = document.getElementById('lv-status').value;
      const year = document.getElementById('lv-year').value;
      const roundEl = document.getElementById('lv-round');
      const round = roundEl ? roundEl.value : '';
      const meta0 = LEAVE_GROUPS.find((g) => g.key === currentGroup);
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (round && year) params.set('round', round); // รอบใช้ได้เมื่อระบุปีงบประมาณ (ทุกปี = ไม่กรองช่วงวันที่)
      if (currentGroup === 'vacation' || currentGroup === 'vacation-school') params.set('group', 'vacation');
      else if (currentGroup === 'general' || currentGroup === 'general-school') params.set('group', 'general');
      // แยกตามกลุ่มผู้ใช้: แทปของสถานศึกษา → ugroup=school, แทปของ สพป. → ugroup=office
      if (meta0 && meta0.ugroup) params.set('ugroup', meta0.ugroup);
      if (year) params.set('year', year);
      const url = '/leaves' + (params.toString() ? '?' + params.toString() : '');
      try {
        let data = await API.get(url);
        // ขออนุญาตลาของฉัน
        if (window._lvMyOnly && Auth.user) {
          data = { ...data, requests: data.requests.filter(r => r.user_id === Auth.user.id) };
        // admin เห็นทุกรายการในระบบ (ไม่กรองตาม per-person)
        } else if (!window._lvMyOnly && !isAdmin && isLeaveStaff && leavePerPerson && Auth.user) {
          // แสดงเฉพาะรายการที่ตัวเองเป็นผู้ตรวจสอบ/ผู้อนุมัติ หรือเป็นของตัวเอง
          data = { ...data, requests: data.requests.filter(r => {
            if (r.user_id === Auth.user.id) return true;
            for (var lv = 1; lv <= 3; lv++) {
              var approverId = Number((leavePerPerson[String(lv)] || {})[String(r.user_id)]);
              if (approverId === Auth.user.id) return true;
            }
            return false;
          }) };
        }
        const meta = LEAVE_GROUPS.find((g) => g.key === currentGroup);
        card.innerHTML = '';
        card.append(UI.h('div', { className: 'card-title' }, `▭ ${meta ? meta.label : 'รายการขอลา'} (${data.requests.length} รายการ)`));
        if (!data.requests.length) {
          card.append(UI.empty('ยังไม่มีรายการ', '☀'));
          return;
        }
        const cols = [
          { key: 'leave_no', label: 'เลขที่คำขอ' },
          { key: 'leave_type', label: 'ประเภทการลา', render: (r) => UI.h('span', { className: 'status-pill', style: { background: '#eff6ff', color: '#1d4ed8', padding: '3px 10px', borderRadius: '999px', fontWeight: 700, fontSize: '12.5px' } }, r.leave_type) },
          { key: 'date', label: 'วันลา', render: (r) => `${UI.date(r.date_from)} ถึง ${UI.date(r.date_to)}` },
          { key: 'days', label: 'จำนวนวัน', className: 'num' },
          { key: 'reason', label: 'เหตุผล', render: (r) => UI.h('div', { style: { maxWidth: '260px' } }, r.reason || '-') },
        ];
        if (isAdmin || isLeaveStaff) {
          cols.splice(1, 0, { key: 'full_name', label: 'ผู้ยื่นคำขอ', render: (r) => UI.h('div', {}, UI.personName(r), UI.h('div', { className: 'hint' }, r.position || '')) });
        }
        cols.push({
          key: 'status', label: 'สถานะ',
          render: (r) => {
            let statusBadge = UI.badge(r.status);
            if (r.status === 'pending' && !r.reviewed) {
              statusBadge = UI.h('span', { style: { background: '#fef3c7', color: '#92400e', padding: '3px 10px', borderRadius: '999px', fontWeight: 700, fontSize: '12px' } }, '◷ รอตรวจสอบ');
            }
            // สถานะขอยกเลิกวันลา — แสดงเพิ่มใต้สถานะเดิม (ส้มกระพริบ รอผู้ตรวจสอบ)
            const cancelBadge = r.cancel_status === 'cancel_requested'
              ? UI.h('div', { className: 'cancel-request-blink', style: { marginTop: '4px', background: '#ffedd5', color: '#c2410c', padding: '2px 10px', borderRadius: '999px', fontWeight: 700, fontSize: '11.5px', animation: 'cancelBlink 1s step-end infinite' } }, '↺ รอยกเลิกวันลา')
              : null;
            return UI.h('div', {},
              statusBadge,
              cancelBadge,
              UI.h('div', { style: { cursor: 'pointer' }, title: 'ดูความคืบหน้าการอนุมัติ', onclick: () => UI.modal({ title: '▭ ความคืบหน้าการอนุมัติ', body: UI.approvalDetail(r) }) }, UI.approvalPill(r)));
          },
        });
        cols.push({
          key: 'actions', label: '',
          render: (r) => {
            const btns = [UI.actionBtn('👁️', () => LeaveView.openView(r))];
            const isOwner = r.user_id === Auth.user.id;
            const isFullyApproved = r.status === 'approved';
            const isPending = r.status === 'pending';
            // คำนวณว่า user ปัจจุบันอยู่ขั้นไหนของ leave_approvers
            const myLevels = [];
            if (leaveApproversData || leavePerPerson) {
              for (const lvl of [1, 2, 3]) {
                if (Auth.isAdmin()) { myLevels.push(lvl); continue; }
                if (leavePerPerson && leavePerPerson[String(lvl)]) {
                  // Per-person: check if current user is approver for this requester
                  const approverId = Number((leavePerPerson[String(lvl)] || {})[String(r.user_id)]);
                  if (approverId === Auth.user.id) myLevels.push(lvl);
                } else if (leaveApproversData) {
                  // Fallback: flat array
                  if ((leaveApproversData[lvl] || []).includes(Auth.user.id)) myLevels.push(lvl);
                }
              }
            }
            if (isPending) {
              // ผู้ตรวจสอบ (level 1) ที่ยังไม่ได้ตรวจสอบ → ปุ่ม '▭ ตรวจสอบ'
              if (myLevels.includes(1) && !r.reviewed) {
                btns.push(UI.h('button', { className: 'btn btn-primary', style: { fontSize: '12px', padding: '4px 10px', whiteSpace: 'nowrap' }, onclick: () => LeaveView.openReview(r) }, '▭ ตรวจสอบ'));
              }
              // ผู้อนุมัติขั้นต้น (level 2) หลังตรวจสอบแล้ว แต่ยังไม่อนุมัติขั้นนี้ → ปุ่มอนุมัติขั้นต้น/ไม่อนุมัติ
              const alreadyLevel2 = (r.approvals || []).some(a => a.level === 2);
              if (myLevels.includes(2) && r.reviewed && !alreadyLevel2) {
                btns.push(UI.actionBtn('● อนุมัติขั้นต้น', () => LeaveView.decide(r, 'approve', 'อนุมัติขั้นต้น')));
                btns.push(UI.actionBtn('✕ ไม่อนุมัติ', () => LeaveView.decide(r, 'reject'), 'danger-btn'));
              }
              // ผู้อนุมัติขั้นสุดท้าย (level 3) → หลังขั้นต้นอนุมัติแล้ว → ปุ่มอนุมัติ/ไม่อนุมัติ
              if (myLevels.includes(3) && (r.approvals || []).length >= 2) {
                btns.push(UI.actionBtn('● อนุมัติ', () => LeaveView.decide(r, 'approve', 'อนุมัติ')));
                btns.push(UI.actionBtn('✕ ไม่อนุมัติ', () => LeaveView.decide(r, 'reject'), 'danger-btn'));
              }
            }
            // ปุ่มลบ — เฉพาะเจ้าของรายการ และยังไม่อนุมัติขั้นต้น (level 2 ยังไม่อนุมัติ)
            if (isOwner && !isFullyApproved) {
              const level2Approved = (r.approvals || []).some(a => a.level === 2);
              if (!level2Approved) {
                btns.push(UI.actionBtn('✕', () => LeaveView.remove(r), 'danger-btn'));
              }
            }
            // ปุ่มขอยกเลิกวันลา — เจ้าของรายการหรือ admin เท่านั้น และเฉพาะรายการที่อนุมัติแล้ว (ยังไม่ได้ขอยกเลิก)
            if ((isOwner || Auth.isAdmin()) && isFullyApproved && r.cancel_status !== 'cancel_requested') {
              btns.push(UI.h('button', { className: 'btn btn-warning', style: { fontSize: '12px', padding: '4px 10px', whiteSpace: 'nowrap' }, title: 'ขอยกเลิกวันลา', onclick: () => LeaveView.requestCancel(r) }, '↺ ขอยกเลิกวันลา'));
            }
            // ปุ่มยกเลิกวันลา — เฉพาะผู้ตรวจสอบ (level 1 ของผู้ขอ) หรือ admin เมื่อรายการรอการยกเลิก
            if (r.cancel_status === 'cancel_requested' && (Auth.isAdmin() || myLevels.includes(1))) {
              btns.push(UI.h('button', { className: 'btn btn-primary', style: { fontSize: '12px', padding: '4px 10px', whiteSpace: 'nowrap' }, title: 'ยืนยันยกเลิกวันลา (ลบรายการ)', onclick: () => LeaveView.confirmCancel(r) }, '↺ ยกเลิกวันลา'));
            }
            // ปุ่มแก้ไข — admin แก้ไขได้ทุกรายการ
            if (Auth.isAdmin()) {
              btns.push(UI.actionBtn('✎', () => LeaveView.openEdit(r)));
            }
            // ปุ่มลบ — admin ลบได้ทุกรายการ
            if (Auth.isAdmin()) {
              btns.push(UI.actionBtn('✕', () => LeaveView.remove(r), 'danger-btn'));
            }
            return UI.h('div', { className: 'status-btns' }, btns);
          },
        });
        card.append(UI.table(cols, data.requests));
        for (const r of data.requests) {
          if (r.note) card.append(UI.h('div', { className: 'hint', style: { marginTop: '8px' } }, `หมายเหตุรายการ ${r.leave_no}: ${r.note}`));
        }
      } catch (e) {
        card.innerHTML = '';
        card.append(UI.empty(e.message, '⚠️'));
      }
    }

    // ช่วงวันที่ของรอบพิจารณาความชอบที่เลือก — ยึดนิยามปีงบประมาณ (1 ต.ค. ปีก่อน - 30 ก.ย. ปีที่เลือก)
    // ในรอบปี X = 1 ต.ค. (X-1) - 30 ก.ย. X (= รอบที่ 1 + รอบที่ 2 พอดี) | round1 = 1 ต.ค. (X-1) - 31 มี.ค. X | round2 = 1 เม.ย. X - 30 ก.ย. X
    // ปียึดตามตัวเลือกปีงบประมาณ (lv-year) — เลือกปี 2570 แล้วทุกช่วงขยายเป็นปีงบประมาณ 2570
    function roundDateRange() {
      const sel = document.getElementById('lv-round');
      const v = sel ? sel.value : 'year';
      const _nowD = new Date();
      const yBE = Number(document.getElementById('lv-year')?.value) || (_nowD.getMonth() >= 9 ? _nowD.getFullYear() + 544 : _nowD.getFullYear() + 543); // ปีงบประมาณปัจจุบัน (ต.ค. = ปีงบใหม่)
      const y = yBE - 543;
      if (v === 'round1') return { from: (y - 1) + '-10-01', to: y + '-03-31', label: 'รอบที่ 1 (1 ต.ค. ' + (yBE - 1) + ' - 31 มี.ค. ' + yBE + ')' };
      if (v === 'round2') return { from: y + '-04-01', to: y + '-09-30', label: 'รอบที่ 2 (1 เม.ย. - 30 ก.ย. ' + yBE + ')' };
      return { from: (y - 1) + '-10-01', to: y + '-09-30', label: 'ในรอบปีงบประมาณ ' + yBE + ' (1 ต.ค. ' + (yBE - 1) + ' - 30 ก.ย. ' + yBE + ')' };
    }
    function inRound(iso, range) {
      const d = String(iso || '').slice(0, 10);
      return d >= range.from && d <= range.to;
    }

    async function loadLeaveStats() {
      card.innerHTML = '';
      card.append(UI.loading());
      try {
        const data = await API.get('/leaves?group=general&status=approved');
        const range = roundDateRange();
        const rows = (data.requests || []).filter(r => inRound(r.date_from, range));
        // Group by user_id
        const userMap = {};
        rows.forEach(r => {
          if (!userMap[r.user_id]) userMap[r.user_id] = { name: UI.personName(r), position: r.position || '-', workplace: r.workplace || '-', sick: 0, personal: 0, maternity: 0, total: 0 };
          const u = userMap[r.user_id];
          const d = Number(r.days) || 0;
          u.total += d;
          if (r.leave_type === 'ลาป่วย') u.sick += d;
          else if (r.leave_type === 'ลากิจ') u.personal += d;
          else if (r.leave_type === 'ลาคลอดบุตร') u.maternity += d;
        });
        const users = Object.values(userMap).sort((a, b) => b.total - a.total);
        card.innerHTML = '';
        // ปุ่มส่งออกข้อมูลเป็นไฟล์ Excel (เปิดหน้าต่างตัวกรอง ปีงบประมาณ + รอบพิจารณาความชอบ)
        const exportBtn = UI.h('button', { className: 'btn btn-outline', onclick: () => openSickExportDialog() }, '📥 ส่งออกข้อมูล (Excel)');
        card.append(UI.h('div', { className: 'card-title', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' } },
          `📊 สถิติลาป่วย ลากิจ ลาคลอด อนุมัติแล้ว — ${range.label} (${users.length} คน)`, exportBtn));
        if (!users.length) {
          card.append(UI.empty('ยังไม่มีรายการที่อนุมัติแล้ว', '📊'));
          return;
        }
        const thStyle = 'padding:8px 12px;border:1px solid #d1d5db;text-align:center;font-weight:700;font-size:13px;white-space:nowrap;';
        const tdStyle = 'padding:6px 12px;border:1px solid #d1d5db;font-size:13px;';
        var html = '<div class="table-wrap"><table class="tbl"><thead><tr>';
        html += '<th style="' + thStyle + 'text-align:left;">ลำดับ</th>';
        html += '<th style="' + thStyle + 'text-align:left;">ชื่อบุคลากร</th>';
        html += '<th style="' + thStyle + 'text-align:left;">ตำแหน่ง</th>';
        html += '<th style="' + thStyle + 'text-align:center;">ลาป่วย (วัน)</th>';
        html += '<th style="' + thStyle + 'text-align:center;">ลากิจ (วัน)</th>';
        html += '<th style="' + thStyle + 'text-align:center;">ลาคลอด (วัน)</th>';
        html += '<th style="' + thStyle + 'text-align:center;font-weight:800;">รวม (วัน)</th>';
        html += '</tr></thead><tbody>';
        users.forEach((u, i) => {
          html += '<tr>';
          html += '<td style="' + tdStyle + 'text-align:center;">' + (i + 1) + '</td>';
          html += '<td style="' + tdStyle + 'font-weight:600;">' + u.name + '</td>';
          html += '<td style="' + tdStyle + ';color:#6b7280;font-size:12px;">' + u.position + '</td>';
          html += '<td style="' + tdStyle + 'text-align:center;' + (u.sick ? 'color:#dc2626;font-weight:600;' : 'color:#d1d5db;') + '">' + u.sick + '</td>';
          html += '<td style="' + tdStyle + 'text-align:center;' + (u.personal ? 'color:#d97706;font-weight:600;' : 'color:#d1d5db;') + '">' + u.personal + '</td>';
          html += '<td style="' + tdStyle + 'text-align:center;' + (u.maternity ? 'color:#2563eb;font-weight:600;' : 'color:#d1d5db;') + '">' + u.maternity + '</td>';
          html += '<td style="' + tdStyle + 'text-align:center;font-weight:700;">' + u.total + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div>';
        const wrap = UI.h('div', { style: { overflowX: 'auto' } });
        wrap.innerHTML = html;
        card.append(wrap);
      } catch (e) {
        card.innerHTML = '';
        card.append(UI.empty(e.message, '⚠️'));
      }
    }

    /** หน้าต่างตัวกรองส่งออก Excel สถิติการลา — ตัวกรอง: ปีงบประมาณ พ.ศ. + รอบพิจารณาความชอบ (รอบที่ 1 / รอบที่ 2 / ทั้งปี) */
    function openStatsExportDialog(sheetLabel, buildRows) {
      const now = new Date();
      const curFY = (now.getMonth() >= 9 ? now.getFullYear() + 544 : now.getFullYear() + 543);
      const yearSel = UI.h('select', { style: { minWidth: '170px' }, onchange: rebuildRounds });
      [curFY, curFY - 1, curFY + 1].forEach((y) => yearSel.append(UI.h('option', { value: String(y) }, 'ปีงบประมาณ ' + y)));
      yearSel.value = String(curFY);
      const roundSel = UI.h('select', { style: { minWidth: '300px' } });
      function rebuildRounds() {
        const yBE = Number(yearSel.value) || curFY;
        roundSel.innerHTML = '';
        roundSel.append(UI.h('option', { value: 'year' }, 'ทั้งปีงบประมาณ (1 ต.ค. ' + (yBE - 1) + ' - 30 ก.ย. ' + yBE + ')'));
        roundSel.append(UI.h('option', { value: 'round1' }, 'รอบที่ 1 (1 ต.ค. ' + (yBE - 1) + ' - 31 มี.ค. ' + yBE + ')'));
        roundSel.append(UI.h('option', { value: 'round2' }, 'รอบที่ 2 (1 เม.ย. - 30 ก.ย. ' + yBE + ')'));
      }
      rebuildRounds();
      const rowOf = (label, sel) => UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
        UI.h('div', { style: { width: '170px', fontWeight: 600, fontSize: '13.5px', color: '#334155' } }, label), sel);
      const body = UI.h('div', { style: { padding: '4px 2px' } },
        UI.h('div', { style: { marginBottom: '12px', fontWeight: 700, fontSize: '13.5px', color: '#0f766e' } }, 'ส่งออก: ' + sheetLabel),
        UI.h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
          rowOf('ปีงบประมาณ พ.ศ.', yearSel),
          rowOf('รอบพิจารณาความชอบ', roundSel),
          UI.h('div', { className: 'hint', style: { marginTop: '4px' } }, 'เลือกปีงบประมาณและรอบที่ต้องการ แล้วกดส่งออก')));
      async function doExport() {
        const yBE = Number(yearSel.value) || curFY;
        const v = roundSel.value;
        const y = yBE - 543;
        let range;
        if (v === 'round1') range = { from: (y - 1) + '-10-01', to: y + '-03-31', label: 'รอบที่ 1 (1 ต.ค. ' + (yBE - 1) + ' - 31 มี.ค. ' + yBE + ')' };
        else if (v === 'round2') range = { from: y + '-04-01', to: y + '-09-30', label: 'รอบที่ 2 (1 เม.ย. - 30 ก.ย. ' + yBE + ')' };
        else range = { from: (y - 1) + '-10-01', to: y + '-09-30', label: 'ปีงบประมาณ ' + yBE };
        try {
          UI.toast('กำลังเตรียมข้อมูล...', 'success', 1500);
          const out = await buildRows(yBE, range);
          const fname = (sheetLabel.replace(/\s+/g, '') + '_' + range.label).replace(/[\\/:*?"<>|]/g, '');
          UI.exportExcel(fname, sheetLabel + ' (' + range.label + ')', out.headers, out.dataRows);
          modal.close();
          UI.toast('ส่งออกแล้ว ' + out.count + ' รายการ', 'success');
        } catch (e) { UI.toast(e.message, 'error'); }
      }
      const foot = UI.h('div', {},
        UI.h('button', { className: 'btn btn-outline', onclick: () => document.getElementById('modal-root').innerHTML = '' }, 'ยกเลิก'),
        UI.h('button', { className: 'btn btn-primary', style: { background: '#059669' }, onclick: doExport }, '⬇ ส่งออก Excel'));
      const modal = UI.modal({ title: '📥 ส่งออกข้อมูล (Excel)', body, footer: foot, size: 'md' });
    }

    /** ส่งออกสถิติลาป่วย ลากิจ ลาคลอด — เปิดหน้าต่างตัวกรองก่อน */
    function openSickExportDialog() {
      openStatsExportDialog('สถิติลาป่วย ลากิจ ลาคลอด อนุมัติแล้ว', async (yBE, range) => {
        const data = await API.get('/leaves?group=general&status=approved');
        const rows = (data.requests || []).filter((r) => inRound(r.date_from, range));
        const userMap = {};
        rows.forEach((r) => {
          if (!userMap[r.user_id]) userMap[r.user_id] = { name: UI.personName(r), position: r.position || '-', workplace: r.workplace || '-', sick: 0, personal: 0, maternity: 0, total: 0 };
          const u = userMap[r.user_id];
          const d = Number(r.days) || 0;
          u.total += d;
          if (r.leave_type === 'ลาป่วย') u.sick += d;
          else if (r.leave_type === 'ลากิจ') u.personal += d;
          else if (r.leave_type === 'ลาคลอดบุตร') u.maternity += d;
        });
        const users = Object.values(userMap).sort((a, b) => b.total - a.total);
        const headers = ['ลำดับ', 'ชื่อบุคลากร', 'ตำแหน่ง', 'ลาป่วย (วัน)', 'ลากิจ (วัน)', 'ลาคลอด (วัน)', 'รวม (วัน)'];
        const dataRows = users.map((u, i) => [i + 1, u.name, u.position, u.sick, u.personal, u.maternity, u.total]);
        return { headers, dataRows, count: users.length };
      });
    }

    /** ส่งออกสถิติลาพักผ่อน — เปิดหน้าต่างตัวกรองก่อน */
    function openVacExportDialog() {
      openStatsExportDialog('สถิติลาพักผ่อน', async (yBE, range) => {
        const balData = await API.get('/leave-balances?year=' + yBE);
        const lvData = await API.get('/leaves?group=vacation&status=approved');
        const usedByUser = {};
        (lvData.requests || []).filter((r) => inRound(r.date_from, range)).forEach((r) => {
          if (!usedByUser[r.user_id]) usedByUser[r.user_id] = { times: 0, days: 0 };
          usedByUser[r.user_id].times += 1;
          usedByUser[r.user_id].days += (Number(r.days) || 0);
        });
        const rows = (balData.balances || []).filter((b) => b.user_group !== 'school').map((b) => {
          const u = usedByUser[b.id] || { times: 0, days: 0 };
          return { ...b, used: u.days, usedTimes: u.times, remaining: Math.max(0, (Number(b.total) || 0) - u.days) };
        }).sort((a, b) => (a.seq || 9999) - (b.seq || 9999));
        const headers = ['ที่', 'ชื่อบุคลากร', 'ตำแหน่ง', 'สังกัด/กลุ่มงาน', 'สะสม (วัน)', 'ประจำปี (วัน)', 'สิทธิ์รวม (วัน)', 'ใช้ไป — ครั้ง', 'ใช้ไป — วัน', 'คงเหลือ (วัน)'];
        const dataRows = rows.map((r, i) => [
          r.seq || i + 1,
          UI.personName(r),
          r.position || '-',
          r.workplace || '-',
          Number(r.accumulated) || 0,
          Number(r.annual) || 0,
          Number(r.total) || 0,
          r.usedTimes || 0,
          r.used || 0,
          r.remaining || 0,
        ]);
        return { headers, dataRows, count: rows.length };
      });
    }

    /** แทปสถิติลาพักผ่อน — admin เท่านั้น */
    async function loadVacStats() {
      card.innerHTML = '';
      card.append(UI.loading());
      try {
        const _nowV = new Date();
        const year = document.getElementById('lv-year')?.value || String(_nowV.getMonth() >= 9 ? _nowV.getFullYear() + 544 : _nowV.getFullYear() + 543); // ปีงบประมาณปัจจุบัน
        // ดึงสิทธิ์พักผ่อนทุกคน + รายการลาพักผ่อนที่อนุมัติแล้ว กรองตามรอบพิจารณาความชอบที่เลือก
        const range = roundDateRange();
        // เปลี่ยนปีงบประมาณใหม่อัตโนมัติเมื่อถึง 1 ต.ค. (backend ใช้ปีงบประมาณปัจจุบันเป็นค่าเริ่มต้น) — ข้อมูลปีเก่ายังเก็บครบเรียกดูย้อนหลังได้
        const balData = await API.get('/leave-balances?year=' + year);
        const lvData = await API.get('/leaves?group=vacation&status=approved');
        const usedByUser = {};
        (lvData.requests || []).filter(r => inRound(r.date_from, range)).forEach((r) => {
          if (!usedByUser[r.user_id]) usedByUser[r.user_id] = { times: 0, days: 0 };
          usedByUser[r.user_id].times += 1;
          usedByUser[r.user_id].days += (Number(r.days) || 0);
        });
        const rows = (balData.balances || []).filter(b => b.user_group !== 'school').map((b) => {
          const u = usedByUser[b.id] || { times: 0, days: 0 };
          const used = u.days;
          return { ...b, used, usedTimes: u.times, remaining: Math.max(0, (Number(b.total) || 0) - used) };
        }).sort((a, b) => (a.seq || 9999) - (b.seq || 9999)); // เรียงตามลำดับเจ้าหน้าที่ (staff_no)
        card.innerHTML = '';
        // ปุ่มส่งออกข้อมูลเป็นไฟล์ Excel
        const exportBtn = UI.h('button', { className: 'btn btn-outline', style: { marginBottom: '10px' }, onclick: () => openVacExportDialog() }, '📥 ส่งออกข้อมูล (Excel)');
        card.append(UI.h('div', { className: 'card-title', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' } },
          `📊 สถิติลาพักผ่อน — ${range.label} (${rows.length} คน)`, exportBtn));
        if (!rows.length) {
          card.append(UI.empty('ยังไม่มีข้อมูลบุคลากร', '📊'));
          return;
        }
        const cols = [
          // ลำดับ — เรียงตามหน้าเจ้าหน้าที่ สพป.แพร่ เขต 2 (ตามเลขที่ตำแหน่ง staff_no)
          { key: 'seq', label: 'ที่', className: 'num', render: (r) => UI.h('span', { style: { fontWeight: 400, color: '#475569' } }, r.seq || '-') },
          { key: 'name', label: 'ชื่อบุคลากร', render: (r) => UI.h('div', { style: { fontWeight: 400 } }, UI.personName(r), UI.h('div', { className: 'hint', style: { fontWeight: 400 } }, r.position || '')) },
          { key: 'workplace', label: 'สังกัด/กลุ่มงาน', render: (r) => UI.h('span', { style: { fontWeight: 400 } }, r.workplace || '-') },
          { key: 'accumulated', label: 'สะสม', className: 'num', render: (r) => UI.h('span', { style: { fontWeight: 400, color: '#2563eb' } }, (Number(r.accumulated) || 0) + ' วัน') },
          { key: 'annual', label: 'ประจำปี', className: 'num', render: (r) => UI.h('span', { style: { fontWeight: 400, color: '#7c3aed' } }, (Number(r.annual) || 0) + ' วัน') },
          { key: 'ent', label: 'สิทธิ์รวม', className: 'num', render: (r) => UI.h('span', { style: { fontWeight: 400 } }, (Number(r.total) || 0) + ' วัน') },
          // ใช้ไป แบ่งเป็น 2 คอลั่มย่อย: ครั้ง (จำนวนครั้งที่ลา) และ วัน (จำนวนวันลา)
          { key: 'usedTimes', label: 'ใช้ไป — ครั้ง', className: 'num', render: (r) => UI.h('span', { style: { fontWeight: 400, color: r.usedTimes ? '#b45309' : '#9ca3af' } }, (r.usedTimes || 0) + ' ครั้ง') },
          { key: 'used', label: 'ใช้ไป — วัน', className: 'num', render: (r) => UI.h('span', { style: { fontWeight: 400, color: r.used ? '#dc2626' : '#9ca3af' } }, r.used + ' วัน') },
          { key: 'remaining', label: 'คงเหลือ', className: 'num', render: (r) => UI.h('span', { style: { fontWeight: 400, color: r.remaining <= 3 ? '#dc2626' : '#059669' } }, r.remaining + ' วัน') },
        ];
        const tblWrap = UI.table(cols, rows);
        tblWrap.querySelector('table').classList.add('vac-stats-grid');
        card.append(tblWrap);
      } catch (e) {
        card.innerHTML = '';
        card.append(UI.empty(e.message, '⚠️'));
      }
    }

    /** แท็บสถิติการลาของฉัน — ทุกผู้ใช้ ใช้ข้อมูลของตัวเอง (ลาป่วย/กิจ/คลอด + พักผ่อน พร้อมสิทธิ์วันลาพักผ่อน) */
    async function loadMyStats() {
      card.innerHTML = '';
      card.append(UI.loading());
      try {
        const u = Auth.user || {};
        const yearEl = document.getElementById('lv-year');
        const _nowM = new Date();
        const year = Number(yearEl && yearEl.value) || (_nowM.getMonth() >= 9 ? _nowM.getFullYear() + 544 : _nowM.getFullYear() + 543); // ปีงบประมาณปัจจุบัน
        const range = roundDateRange();
        // รายการลาที่อนุมัติแล้วของตัวเองทุกประเภท — กรองช่วงวันตามรอบที่เลือก (year = ทั้งปีงบประมาณ)
        const data = await API.get('/leaves?status=approved&year=' + year);
        const mine = (data.requests || []).filter((r) => r.user_id === u.id && inRound(r.date_from, range));
        let sick = 0, personal = 0, maternity = 0, vacDays = 0, vacTimes = 0;
        mine.forEach((r) => {
          const d = Number(r.days) || 0;
          if (r.leave_type === 'ลาพักผ่อน') { vacDays += d; vacTimes += 1; }
          else {
            if (r.leave_type === 'ลาป่วย') sick += d;
            else if (r.leave_type === 'ลากิจ') personal += d;
            else if (r.leave_type === 'ลาคลอดบุตร') maternity += d;
          }
        });
        // สิทธิ์วันลาพักผ่อน (สะสม + ประจำปี) ตามปีงบประมาณที่เลือก
        let accumulated = 0, annual = 0;
        try { const bal = await API.get('/my-leave-balance?year=' + year); accumulated = Number(bal.accumulated) || 0; annual = Number(bal.annual) || 0; } catch (_e) {}
        const vacTotal = accumulated + annual;
        const vacUsed = vacDays;
        const vacRemain = Math.max(0, vacTotal - vacUsed);
        const gTotal = sick + personal + maternity;
        const grand = gTotal + vacDays;
        card.innerHTML = '';
        card.append(UI.h('div', { className: 'card-title', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' } },
          `📊 สถิติการลาของฉัน — ${range.label}`));
        // หัวตาราง: ชื่อ-นามสกุล + ตำแหน่งของผู้ใช้ และตัวเลือกปี/รอบอยู่ในแถวตัวกรองด้านบนแล้ว
        const headBox = UI.h('div', { style: { marginBottom: '10px', display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' } },
          UI.h('span', { style: { fontWeight: 700, fontSize: '15px' } }, UI.personName(u)),
          UI.h('span', { className: 'hint' }, u.position || ''));
        card.append(headBox);
        const thStyle = 'padding:8px 12px;border:1px solid #93c5fd;text-align:center;font-weight:700;font-size:13px;white-space:nowrap;';
        const tdStyle = 'padding:7px 12px;border:1px solid #d1d5db;font-size:13px;';
        const numTd = (v, color) => '<td style="' + tdStyle + 'text-align:center;' + (v ? (color || 'font-weight:600;') : 'color:#cbd5e1;') + '">' + v + '</td>';
        var html = '<div class="table-wrap"><table class="tbl my-stats-table"><thead>';
        // แถวหัวตารางแบบ 2 ชั้นตามรูป: ประเภท | วันลาพักผ่อนประจำปี (สะสม/ปีนี้/รวม) | สถิติการลา (ครั้ง/วัน) | เหลือ
        html += '<tr>';
        html += '<th rowspan="2" style="' + thStyle + 'text-align:left;background:#2563eb;color:#fff;">ประเภท</th>';
        html += '<th colspan="3" style="' + thStyle + 'background:#2563eb;color:#fff;">วันลาพักผ่อนประจำปี</th>';
        html += '<th colspan="2" style="' + thStyle + 'background:#2563eb;color:#fff;">สถิติการลา</th>';
        html += '<th rowspan="2" style="' + thStyle + 'background:#2563eb;color:#fff;">เหลือ</th>';
        html += '</tr><tr>';
        ['สะสม', 'ปีนี้', 'รวม', 'ครั้ง', 'วัน'].forEach((h) => { html += '<th style="' + thStyle + 'background:#3b82f6;color:#fff;">' + h + '</th>'; });
        html += '</tr></thead><tbody>';
        // แถวลาพักผ่อน: สะสม/ปีนี้ = สิทธิ์จากฐานข้อมูล, ครั้ง/วัน = จากคำขอที่อนุมัติ, เหลือ = สิทธิ์ - ใช้ไป
        html += '<tr style="background:#fffbeb;">';
        html += '<td style="' + tdStyle + 'font-weight:700;">ลาพักผ่อน</td>';
        html += '<td style="' + tdStyle + 'text-align:center;font-weight:600;color:#2563eb;">' + accumulated + '</td>';
        html += '<td style="' + tdStyle + 'text-align:center;font-weight:600;color:#7c3aed;">' + annual + '</td>';
        html += '<td style="' + tdStyle + 'text-align:center;font-weight:700;background:#fef3c7;">' + vacTotal + '</td>';
        html += numTd(vacTimes);
        html += numTd(vacDays);
        html += '<td style="' + tdStyle + 'text-align:center;font-weight:700;background:#fef3c7;">' + vacRemain + '</td>';
        html += '</tr>';
        // แถวลาอื่นๆ: ไม่มีสิทธิ์จำกัด (สะสม/ปีนี้/รวม ว่างตามรูป), ครั้ง/วัน = จากคำขอที่อนุมัติ, เหลือ = วันที่ใช้ไป (คงค้าง = 0)
        const generalRows = [
          { label: 'ลาป่วย', v: sick },
          { label: 'ลากิจ', v: personal },
          { label: 'ลาคลอดบุตร', v: maternity },
        ];
        generalRows.forEach((row) => {
          html += '<tr>';
          html += '<td style="' + tdStyle + 'font-weight:700;">' + row.label + '</td>';
          html += '<td colspan="3" style="' + tdStyle + '"></td>';
          html += numTd(row.v);
          html += numTd(row.v);
          html += '<td style="' + tdStyle + 'text-align:center;">' + row.v + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div>';
        const wrap = UI.h('div', { style: { overflowX: 'auto' } });
        wrap.innerHTML = html;
        card.append(wrap);
        // สรุปรวมท้ายตาราง
        card.append(UI.h('div', { className: 'hint', style: { marginTop: '8px' } },
          'รวมทั้งหมด ' + grand + ' วัน (ลาป่วย/กิจ/คลอด ' + gTotal + ' วัน + ลาพักผ่อน ' + vacDays + ' วัน) — นับเฉพาะคำขอที่อนุมัติแล้ว'));
      } catch (e) {
        card.innerHTML = '';
        card.append(UI.empty(e.message, '⚠️'));
      }
    }

    async function loadBalance() {
      card.innerHTML = '';
      card.append(UI.loading());
      try {
        // เปลี่ยนปีงบประมาณใหม่อัตโนมัติเมื่อถึง 1 ต.ค. — ถ้า admin ยังไม่ได้ตั้งค่าปีใหม่ แก้ไข (✎) ได้เลย ระบบจะบันทึกเป็นของปีงบประมาณปัจจุบัน
        const data = await API.get('/leave-balances');
        card.innerHTML = '';
        card.append(UI.h('div', { className: 'card-title' }, `◷ วันลาพักผ่อนสะสม ปี ${data.year} (${data.balances.length  } คน)`));
        if (!data.balances.length) {
          card.append(UI.empty('ยังไม่มีข้อมูลบุคลากร', '👤'));
          return;
        }
        const cols = [
          { key: 'name', label: 'ชื่อบุคลากร', render: (r) => UI.h('div', {}, UI.personName(r), UI.h('div', { className: 'hint' }, r.position || '')) },
          { key: 'workplace', label: 'สังกัด/กลุ่มงาน', render: (r) => r.workplace || '-' },
          { key: 'accumulated', label: 'วันลาพักผ่อนสะสม', className: 'num', render: (r) => UI.h('span', { style: { fontWeight: 700, color: '#2563eb' } }, r.accumulated + ' วัน') },
          { key: 'annual', label: 'วันลาพักผ่อนประจำปี', className: 'num', render: (r) => UI.h('span', { style: { fontWeight: 700, color: '#7c3aed' } }, r.annual + ' วัน') },
          { key: 'total', label: 'รวมวันลาปีนี้', className: 'num', render: (r) => UI.h('span', { style: { fontWeight: 800, color: '#059669' } }, r.total + ' วัน') },
          { key: 'used', label: 'ลาปีนี้', className: 'num', render: (r) => UI.h('span', { style: { fontWeight: 700, color: '#dc2626' } }, r.used + ' วัน') },
          { key: 'remaining', label: 'เหลือวันลา', className: 'num', render: (r) => {
            const color = r.remaining <= 0 ? '#dc2626' : r.remaining <= 3 ? '#f59e0b' : '#059669';
            return UI.h('span', { style: { fontWeight: 800, color, fontSize: '14px' } }, r.remaining + ' วัน');
          }},
        ];
        if (isAdmin || isLeaveStaff) {
          cols.push({
            key: 'actions', label: '',
            render: (r) => UI.actionBtn('✎', () => LeaveView.editBalance(r, data.year)),
          });
        }
        card.append(UI.table(cols, data.balances));
      } catch (e) {
        card.innerHTML = '';
        card.append(UI.empty(e.message, '⚠️'));
      }
    }



    // === ตั้งค่าเจ้าหน้าที่การลา 3 ลำดับ (admin เท่านั้น) ===
    async function loadSettingsApprover(scope) {
      scope = scope || 'office';
      const isSchoolScope = scope === 'school';
      card.innerHTML = '';
      card.append(UI.loading());
      try {
        const laData = await API.get('/settings/leave-approvers?scope=' + scope);
        let allStaff = [];
        try { const s = await API.get('/staff'); allStaff = s.staff || []; } catch (_e) {}
        card.innerHTML = '';
        card.append(UI.h('div', { className: 'card-title' }, isSchoolScope ? '⊛ เจ้าหน้าที่การลาของสถานศึกษา (3 ลำดับ)' : '⊛ เจ้าหน้าที่การลาของ สพป.แพร่ เขต 2 (3 ลำดับ)'));
        card.append(UI.h('p', { className: 'hint', style: { marginBottom: '14px' } }, 'กำหนดเจ้าหน้าที่ที่จะพิจารณาคำขอลาตามลำดับขั้น — เลือกผู้ตรวจสอบ ผู้อนุมัติขั้นต้น ผู้อนุมัติ ให้แต่ละคนได้อย่างอิสระ (ตัวเลือกแสดงเฉพาะเจ้าหน้าที่ สพป.แพร่ เขต 2)'));
        // แถวของตาราง: หน้า สพป. = เจ้าหน้าที่ สพป. | หน้าสถานศึกษา = เจ้าหน้าที่สถานศึกษา
        const groupOf = (u) => u.user_group || (u.school_code === '54020000' ? 'office' : 'school');
        const activeStaff = allStaff.filter((u) => u.status === 'active');
        const rowStaff = activeStaff.filter((u) => isSchoolScope ? groupOf(u) === 'school' : groupOf(u) === 'office');
        // ตัวเลือกใน dropdown: เฉพาะเจ้าหน้าที่ สพป.แพร่ เขต 2 เท่านั้น (ทั้งสองหน้า)
        const optStaff = activeStaff.filter((u) => groupOf(u) === 'office');
        // Per-person data: approvers['1'][staffId] = approverId
        const perPerson = laData.approvers || { 1: {}, 2: {}, 3: {} };
        const thStyle = 'padding:6px 10px;border:1px solid #d1d5db;text-align:center;font-weight:700;font-size:13px;white-space:nowrap;';
        const tdStyle = 'padding:5px 10px;border:1px solid #d1d5db;font-size:13.5px;';
        var html = '<div class="table-wrap"><table class="tbl">' ;
        html += '<thead><tr>';
        html += '<th style="' + thStyle + 'text-align:left;">ชื่อบุคลากร</th>';
        html += '<th style="' + thStyle + 'text-align:left;">สังกัด/ตำแหน่ง</th>';
        html += '<th style="' + thStyle + 'text-align:center;">❶ ผู้ตรวจสอบ</th>';
        html += '<th style="' + thStyle + 'text-align:center;">❷ ผู้อนุมัติขั้นต้น</th>';
        html += '<th style="' + thStyle + 'text-align:center;">❸ ผู้อนุมัติ</th>';
        html += '</tr></thead><tbody>';
        for (var i = 0; i < rowStaff.length; i++) {
          var u = rowStaff[i];
          var uid = String(u.id);
          var sv1 = Number(perPerson['1'][uid]) || 0;
          var sv2 = Number(perPerson['2'][uid]) || 0;
          var sv3 = Number(perPerson['3'][uid]) || 0;
          html += '<tr>';
          html += '<td style="' + tdStyle + 'font-weight:600;">' + (u.title || '') + ' ' + (u.first_name || u.full_name || '') + ' ' + (u.last_name || '') + '</td>';
          html += '<td style="' + tdStyle + ';color:#6b7280;font-size:12.5px;">' + (u.position || '-') + '</td>';
          html += '<td style="' + tdStyle + 'text-align:center;"><select class="la-sel la-sel-1" data-uid="' + u.id + '" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;width:100%;">' + buildOptHtml(sv1, optStaff) + '</select></td>';
          html += '<td style="' + tdStyle + 'text-align:center;"><select class="la-sel la-sel-2" data-uid="' + u.id + '" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;width:100%;">' + buildOptHtml(sv2, optStaff) + '</select></td>';
          html += '<td style="' + tdStyle + 'text-align:center;"><select class="la-sel la-sel-3" data-uid="' + u.id + '" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;width:100%;">' + buildOptHtml(sv3, optStaff) + '</select></td>';
          html += '</tr>';
        }
        html += '</tbody></table></div>';
        const wrap = UI.h('div', { style: { marginTop: '10px', overflowX: 'auto' } });
        wrap.innerHTML = html;
        card.append(wrap);
        card.append(UI.h('div', { className: 'form-actions', style: { marginTop: '14px' } },
          UI.h('button', { className: 'btn btn-primary', onclick: saveLA }, '▽ บันทึกเจ้าหน้าที่การลา')));

        async function saveLA() {
          const body = { 1: {}, 2: {}, 3: {} };
          document.querySelectorAll('.la-sel').forEach(function(sel) {
            var staffId = sel.getAttribute('data-uid');
            var val = Number(sel.value);
            var lv = sel.classList.contains('la-sel-1') ? '1' : sel.classList.contains('la-sel-2') ? '2' : '3';
            if (val && staffId) body[lv][staffId] = val;
          });
          try {
            const res = await API.put('/settings/leave-approvers?scope=' + scope, body);
            UI.toast(res.message);
          } catch (e) { UI.toast(e.message, 'error'); }
        }

        function buildOptHtml(selectedId, staffList) {
          var h = '<option value="">-- เลือกบุคลากร --</option>';
          for (var i = 0; i < staffList.length; i++) {
            var u = staffList[i];
            var nm = (u.title || '') + ' ' + (u.first_name || u.full_name || '') + ' ' + (u.last_name || '');
            var isSel = (selectedId === u.id) ? ' selected' : '';
            h += '<option value="' + u.id + '"' + isSel + '>' + nm + '</option>';
          }
          return h;
        }

      } catch (e) {
        card.innerHTML = '';
        card.append(UI.empty(e.message, '⚠️'));
      }
    }




    showSubElements();
  },

  editBalance(r, year) {
    const body = UI.h('div', { className: 'form-grid' },
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'บุคลากร'),
        UI.h('div', { style: { fontWeight: 700 } }, `${UI.personName(r)} — ${r.position || ''} (${r.workplace || '-'})`)),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'วันลาพักผ่อนสะสม (วัน)', UI.h('span', { className: 'req' }, ' *')),
        UI.h('input', { id: 'bal-acc', type: 'number', min: '0', value: String(r.accumulated) })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'วันลาพักผ่อนประจำปี (วัน)', UI.h('span', { className: 'req' }, ' *')),
        UI.h('input', { id: 'bal-ann', type: 'number', min: '0', value: String(r.annual) })),
      UI.h('div', { className: 'form-group full', style: { marginTop: '-6px' } },
        UI.h('div', { className: 'hint' }, 'ข้อมูลแยกเก็บเป็นรายปีงบประมาณ — การบันทึกจะเป็นของปีงบประมาณ ' + year + ' เท่านั้น ไม่กระทบข้อมูลของปีงบประมาณอื่น')),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '▽ บันทึก'));
    const m = UI.modal({ title: '✎ แก้ไขวันลาพักผ่อนสะสม — ปีงบประมาณ ' + year, body, footer: foot });
    async function save() {
      const accumulated = parseFloat(document.getElementById('bal-acc').value) || 0;
      const annual = parseFloat(document.getElementById('bal-ann').value) || 0;
      try {
        const res = await API.put(`/leave-balances/${r.id}`, { year, vacation_accumulated: accumulated, vacation_annual: annual });
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  async openView(r) {
    // ดึงข้อมูลผู้ขอลา + ผู้อนุมัติ + สถิติการลา
    let userData = {};
    try { const d = await API.get('/staff-public/' + r.user_id); userData = d.user || d; } catch (_e) {}
    let approverData = {};
    try {
      const la = await API.get('/leave-approvers-public');
      approverData = la.approvers || {};
    } catch (_e) {}
    let statsData = [];
    let fyYear = new Date().getFullYear() + 543;
    try { const sd = await API.get('/leave-stats?userId=' + r.user_id + '&excludeId=' + (r.id || 0)); statsData = sd.stats || []; fyYear = sd.fyYear + 543; } catch (_e) {}

    // ดึงข้อมูลผู้อนุมัติแต่ละขั้น
    const approvals = (r.approvals || []);
    const getApproverName = (level) => {
      const a = approvals.find(x => x.level === level);
      if (a) return a.name;
      return '-';
    };
    const getApproverAt = (level) => {
      const a = approvals.find(x => x.level === level);
      if (a && a.at) return UI.date(a.at);
      return '';
    };
    // ดึงลายเซ็นผู้อนุมัติ
    const getSignatureImg = (level) => {
      const a = approvals.find(x => x.level === level);
      if (a && a.by) {
        return `/uploads/signature_${a.by}.png`;
      }
      return null;
    };

    const nameReq = [(r.title || userData.title || '') + (r.first_name || userData.first_name || r.full_name || userData.full_name || ''), r.last_name || userData.last_name || ''].filter(Boolean).join(' ');
    const posReq = r.position || userData.position || '-';
    const workReq = r.workplace || userData.workplace || '-';

    // สร้างฟอร์ม A4
    const a4 = UI.h('div', {
      id: 'leave-a4-form',
      style: {
        maxWidth: '900px',
        margin: '0 auto',
        padding: '21px 5px 0 35px',
        fontFamily: "'THSarabunIT๙', 'TH Sarabun', 'THSarabun', sans-serif",
        fontSize: '20px', lineHeight: '1.55', color: '#1f2937', background: '#fff',
        position: 'relative',
      }
    });

    // === ส่วนหัว ===
    const headerTitle = r.leave_type === 'ลาพักผ่อน' ? 'แบบใบลาพักผ่อน' : 'แบบใบลาป่วย ลาคลอดบุตร ลากิจส่วนตัว';
    const header = UI.h('div', { style: { textAlign: 'center', marginBottom: '15px' } },
      UI.h('div', { style: { fontSize: '26px', fontWeight: 'bold', textDecoration: 'underline', marginBottom: '15px' } }, headerTitle),
    );
    a4.append(header);

    // === เขียนที่ + วันที่ (จัดชิดขวา) ===
    const thaiFormDate = (d) => {
      if (!d) return '-';
      const p = String(d).slice(0, 10).split('-');
      if (p.length !== 3) return String(d);
      const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
      return `วันที่ ${parseInt(p[2], 10)} ${months[parseInt(p[1], 10) - 1]} พ.ศ.${parseInt(p[0], 10) + 543}`;
    };
    const headerRight = UI.h('div', { style: { textAlign: 'right', marginBottom: '10px', fontSize: '20px' } },
      UI.h('div', {}, `เขียนที่ ${r.writing_at || 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2'}`),
      UI.h('div', {}, r.created_at ? thaiFormDate(r.created_at) : '-'),
    );
    a4.append(headerRight);

    // === เรื่อง ===
    a4.append(UI.h('div', { style: { marginBottom: '8px', fontSize: '20px' } },
      UI.h('span', { style: { fontWeight: 'bold' } }, 'เรื่อง  '), r.leave_type || '-'));

    // === เรียน ===
    a4.append(UI.h('div', { style: { marginBottom: '15px', fontSize: '20px' } },
      UI.h('span', { style: { fontWeight: 'bold' } }, 'เรียน  '), 'ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2'));

    // === เนื้อหา (ห่างจากหัวข้อ 60px) ===
    const content = UI.h('div', { style: { fontSize: '20px', lineHeight: '1.8', textAlign: 'justify', marginTop: '10px' } });

    // ข้าพเจ้า + ตำแหน่ง (บรรทัดเดียวกัน)
    content.append(UI.h('p', { style: { textIndent: '80px', margin: '0 0 10px 0' } },
      UI.h('span', { style: { marginRight: '40px' } }, 'ข้าพเจ้า'), nameReq,
      UI.h('span', { style: { marginRight: '40px', marginLeft: '40px' } }, 'ตำแหน่ง'), posReq));

    // สังกัด (ชิดซ้าย)
    content.append(UI.h('p', { style: { margin: '0 0 10px 0' } },
      UI.h('span', { style: { marginRight: '40px' } }, 'สังกัด'), workReq, ' สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2'));

    // === เนื้อหาเฉพาะลาพักผ่อน ===
    if (r.leave_type === 'ลาพักผ่อน') {
      let vacBalance = {};
      try { vacBalance = await API.get('/my-leave-balance'); } catch (_e) {}
      content.append(UI.h('p', { style: { margin: '0 0 10px 0' } },
        UI.h('span', {}, `มีวันลาพักผ่อนสะสม ${vacBalance.accumulated || 0} วันทำการ, มีสิทธิ์ลาพักผ่อนประจำปีนี้อีก ${vacBalance.annual || 10} วันทำการ, รวมเป็น ${vacBalance.total || (vacBalance.accumulated + vacBalance.annual) || 10} วันทำการ`)));
    }

    // ขอลาพักผ่อน/ขอลา (ชิดซ้าย)
    if (r.leave_type === 'ลาพักผ่อน') {
      content.append(UI.h('p', { style: { margin: '0 0 10px 0' } },
        UI.h('span', { style: { marginRight: '40px' } }, 'ขอลาพักผ่อน')));
    } else {
      const reasonText = ((r.leave_type === 'ลากิจ' || r.leave_type === 'ลาป่วย') && r.reason) ? [UI.h('span', { style: { marginRight: '40px' } }, ' เนื่องจาก '), UI.h('span', {}, r.reason)] : [];
      content.append(UI.h('p', { style: { margin: '0 0 10px 0' } },
        UI.h('span', { style: { marginRight: '40px' } }, 'ขอลา'), UI.h('span', {}, r.leave_type), ...reasonText));
    }

    // ตั้งแต่วันที่ (ชิดซ้าย)
    content.append(UI.h('p', { style: { margin: '0 0 10px 0' } },
      UI.h('span', { style: { marginRight: '40px' } }, 'ตั้งแต่วันที่'),
      UI.h('span', { style: { marginRight: '40px' } }, UI.thaiDate(r.date_from)),
      UI.h('span', { style: { marginRight: '40px' } }, 'ถึง'),
      UI.h('span', { style: { marginRight: '40px' } }, UI.thaiDate(r.date_to)),
      UI.h('span', { style: { marginRight: '5px' } }, 'มีกำหนด'), ` ${r.days} วัน`));

    // ลาครั้งสุดท้ายเมื่อ
    if (r.last_leave_from || r.last_leave_to) {
      content.append(UI.h('p', { style: { margin: '0 0 10px 0' } },
        UI.h('span', { style: { marginRight: '40px' } }, 'ลาครั้งสุดท้ายเมื่อ'),
        UI.h('span', { style: { marginRight: '40px' } }, UI.thaiDate(r.last_leave_from)),
        UI.h('span', { style: { marginRight: '40px' } }, 'ถึง'),
        UI.h('span', { style: { marginRight: '40px' } }, UI.thaiDate(r.last_leave_to)),
        r.last_leave_days ? [UI.h('span', { style: { marginRight: '5px' } }, 'มีกำหนด'), ` ${r.last_leave_days} วัน`] : ''));
    }

    // ระหว่างลาติดต่อข้าพเจ้าได้ที่ (ชิดซ้าย)
    content.append(UI.h('p', { style: { margin: '0 0 10px 0' } },
      UI.h('span', { style: { marginRight: '40px' } }, 'ระหว่างลาติดต่อข้าพเจ้าได้ที่'),
      UI.h('span', { style: { marginRight: '40px' } }, r.address || '-'),
      UI.h('span', { style: { marginRight: '40px' } }, 'เบอร์โทรศัพท์'), r.phone || '-'));

    // เอกสารแนบ
    if (r.attachment) {
      content.append(UI.h('p', { style: { textIndent: '40px', margin: '0 0 10px 0' } },
        `เอกสารแนบ ${r.attachment}`));
    }

    // มอบหมายงาน
    if (r.delegate_to) {
      let delegateName = '-';
      try { const d = await API.get('/staff-public/' + r.delegate_to); delegateName = UI.personName(d.user || d); } catch (_e) {}
      content.append(UI.h('p', { style: { margin: '0 0 10px 0' } },
        UI.h('span', { style: { marginRight: '40px' } }, 'มอบหมายงานให้'), delegateName,
        UI.h('span', { style: { marginRight: '40px', marginLeft: '40px' } }, 'ทำหน้าที่แทน')));
    }

    a4.append(content);

    // === ขอแสดงความนับถือ + ลายเซ็นผู้ขอลา ===
    const requesterSig = userData.signature ? '/uploads/' + UI.encodePath(userData.signature) : null;
    const signWrap = UI.h('div', { style: { textAlign: 'center', marginTop: '30px', marginBottom: '15px' } });
    signWrap.append(UI.h('div', { style: { marginBottom: '20px', fontSize: '20px' } }, 'ขอแสดงความนับถือ'));
    if (requesterSig) {
      signWrap.append(UI.h('img', { src: requesterSig, style: { maxHeight: '60px', display: 'block', margin: '0 auto 5px auto' } }));
    }
    signWrap.append(UI.h('div', {}, `(${nameReq})`));
    signWrap.append(UI.h('div', {}, posReq));
    a4.append(signWrap);

    // === สถิติการลา + ความเห็นผู้บังคับบัญชา (2 คอลัมน์) ===
    let finalStats = statsData;
    let reviewedStats = null;
    try { reviewedStats = r.reviewed_stats ? (typeof r.reviewed_stats === 'string' ? JSON.parse(r.reviewed_stats) : r.reviewed_stats) : null; } catch (_e) {}
    if (reviewedStats && Array.isArray(reviewedStats) && reviewedStats.length > 0) {
      finalStats = reviewedStats;
    }
    // --- คอลัมน์ซ้าย: สถิติการลา ---
    const statsCol = UI.h('div', { style: { flex: '1', fontSize: '14px', textAlign: 'left' } });
    statsCol.append(UI.h('div', { style: { fontWeight: 'bold', marginBottom: '5px', fontSize: '16px' } }, 'สถิติการลาในปีงบประมาณนี้'));
    let stbl;
    if (r.leave_type === 'ลาพักผ่อน') {
      const vacUsed = (finalStats.find(s => s.leave_type === 'ลาพักผ่อน') || {}).used || 0;
      const vacThis = r.days || 1;
      stbl = UI.h('table', { style: { borderCollapse: 'collapse', fontSize: '13px', width: 'auto' } },
        UI.h('thead', {}, UI.h('tr', { style: { background: '#f1f5f9' } },
          UI.h('th', { style: { padding: '4px 12px', border: '1px solid #d1d5db', textAlign: 'center' } }, 'ลามาแล้ว', UI.h('br'), '(วันทำการ)'),
          UI.h('th', { style: { padding: '4px 12px', border: '1px solid #d1d5db', textAlign: 'center' } }, 'ลาครั้งนี้', UI.h('br'), '(วันทำการ)'),
          UI.h('th', { style: { padding: '4px 12px', border: '1px solid #d1d5db', textAlign: 'center', fontWeight: 700 } }, 'รวมเป็น', UI.h('br'), '(วันทำการ)'))),
        UI.h('tbody', {}, UI.h('tr', {},
          UI.h('td', { style: { padding: '4px 12px', border: '1px solid #d1d5db', textAlign: 'center' } }, vacUsed),
          UI.h('td', { style: { padding: '4px 12px', border: '1px solid #d1d5db', textAlign: 'center' } }, vacThis),
          UI.h('td', { style: { padding: '4px 12px', border: '1px solid #d1d5db', textAlign: 'center', fontWeight: 700, color: '#059669' } }, vacUsed + vacThis))));
    } else {
      const sick = (finalStats.find(s => s.leave_type === 'ลาป่วย') || {}).used || 0;
      const personal = (finalStats.find(s => s.leave_type === 'ลากิจ') || {}).used || 0;
      const maternity = (finalStats.find(s => s.leave_type === 'ลาคลอดบุตร') || {}).used || 0;
      const sickNow = (r.leave_type === 'ลาป่วย') ? (r.days || 1) : 0;
      const personalNow = (r.leave_type === 'ลากิจ') ? (r.days || 1) : 0;
      const maternityNow = (r.leave_type === 'ลาคลอดบุตร') ? (r.days || 1) : 0;
      stbl = UI.h('table', { className: 'leave-stats-table' },
        UI.h('thead', {}, UI.h('tr', {},
          UI.h('th', {}, 'ประเภทการลา'),
          UI.h('th', {}, 'ลามาแล้ว'),
          UI.h('th', {}, 'ลาครั้งนี้'),
          UI.h('th', { style: { fontWeight: 700 } }, 'รวมเป็น'))),
        UI.h('tbody', {},
          UI.h('tr', {},
            UI.h('td', { style: { textAlign: 'left' } }, 'ป่วย'),
            UI.h('td', {}, sick),
            UI.h('td', {}, sickNow),
            UI.h('td', { style: { fontWeight: 700, color: '#059669' } }, sick + sickNow)),
          UI.h('tr', {},
            UI.h('td', { style: { textAlign: 'left' } }, 'กิจส่วนตัว'),
            UI.h('td', {}, personal),
            UI.h('td', {}, personalNow),
            UI.h('td', { style: { fontWeight: 700, color: '#059669' } }, personal + personalNow)),
          UI.h('tr', {},
            UI.h('td', { style: { textAlign: 'left' } }, 'คลอดบุตร'),
            UI.h('td', {}, maternity),
            UI.h('td', {}, maternityNow),
            UI.h('td', { style: { fontWeight: 700, color: '#059669' } }, maternity + maternityNow))));;
    }
    statsCol.append(stbl);
    statsCol.append(UI.h('div', { style: { marginTop: '8px', fontSize: '20px', fontWeight: 'bold', textDecoration: 'underline', textAlign: 'left' } }, 'ผู้ตรวจสอบ'));
    // ลายเซ็นผู้ตรวจสอบ
    if (r.reviewed && approvals.length > 0) {
      const reviewer = approvals.find(x => x.level === 1);
      if (reviewer && reviewer.by) {
        let revUserData = {};
        try { const rd = await API.get('/staff-public/' + reviewer.by); revUserData = rd.user || rd; } catch (_e) {}
        const revSigFile = revUserData.signature || null;
        const revSig = revSigFile ? '/uploads/' + UI.encodePath(revSigFile) : null;
        const revSigDiv = UI.h('div', { style: { marginTop: '10px', textAlign: 'center', width: 'fit-content', fontSize: '20px' } });
        if (revSig) {
          const revImg = UI.h('img', { src: revSig, style: { maxHeight: '50px', display: 'block', margin: '0 auto 3px auto' } });
          revImg.onerror = function(){ this.style.display='none'; };
          revSigDiv.append(revImg);
        }
        const revName = [(revUserData.title || '') + (revUserData.first_name || reviewer.name || ''), revUserData.last_name || ''].filter(Boolean).join(' ');
        revSigDiv.append(UI.h('div', {}, `(${revName})`));
        revSigDiv.append(UI.h('div', {}, revUserData.position || 'ผู้ตรวจสอบ'));
        if (reviewer.at) revSigDiv.append(UI.h('div', { style: { marginTop: '3px' } }, thaiFormDate(reviewer.at)));
        statsCol.append(revSigDiv);
      }
    }
    // --- คอลัมน์ขวา: ความเห็นผู้บังคับบัญชา ---
    const approvalCol = UI.h('div', { style: { flex: '1', fontSize: '20px', textAlign: 'center', paddingLeft: '20px', width: 'fit-content', margin: '0 auto' } });
    // หาข้อมูล level 2 (ผู้อนุมัติขั้นต้น)
    const approver2 = approvals.find(x => x.level === 2);
    if (approver2) {
      let a2UserData = {};
      try { const a2d = await API.get('/staff-public/' + approver2.by); a2UserData = a2d.user || a2d; } catch (_e) {}
      approvalCol.append(UI.h('div', { style: { fontWeight: 'bold', marginBottom: '5px', fontSize: '20px', textAlign: 'left', textDecoration: 'underline' } }, 'ความเห็นผู้บังคับบัญชา'));
      // ข้อความความเห็น
      const noteText = approver2.note || '';
      if (noteText) {
        approvalCol.append(UI.h('div', { style: { marginBottom: '10px', fontSize: '20px', textAlign: 'center' } }, noteText));
      }
      // ลายเซ็น
      const a2SigFile = a2UserData.signature || null;
      const a2Sig = a2SigFile ? '/uploads/' + UI.encodePath(a2SigFile) : null;
      if (a2Sig) {
        const a2Img = UI.h('img', { src: a2Sig, style: { maxHeight: '50px', display: 'block', margin: '0 auto 3px auto' } });
        a2Img.onerror = function(){ this.style.display='none'; };
        approvalCol.append(a2Img);
      }
      const a2Name = [(a2UserData.title || '') + (a2UserData.first_name || approver2.name || ''), a2UserData.last_name || ''].filter(Boolean).join(' ');
      approvalCol.append(UI.h('div', {}, `(${a2Name})`));
      approvalCol.append(UI.h('div', {}, a2UserData.position || 'ผู้อนุมัติขั้นต้น'));
      if (approver2.at) approvalCol.append(UI.h('div', { style: { marginTop: '3px' } }, thaiFormDate(approver2.at)));
    }
    // === คำสั่ง (level 3 - ผู้อนุมัติ) ===
    const approver3 = approvals.find(x => x.level === 3);
    if (approver3) {
      let a3UserData = {};
      try { const a3d = await API.get('/staff-public/' + approver3.by); a3UserData = a3d.user || a3d; } catch (_e) {}
      approvalCol.append(UI.h('div', { style: { marginTop: '20px', borderTop: '1px solid #d1d5db', paddingTop: '10px' } }));
      approvalCol.append(UI.h('div', { style: { fontWeight: 'bold', marginBottom: '5px', fontSize: '20px', textAlign: 'left', textDecoration: 'underline' } }, 'คำสั่ง'));
      // แสดง☑ อนุญาต / ☐ ไม่อนุญาต (STATIC)
      approvalCol.append(UI.h('div', { style: { fontSize: '20px', textAlign: 'center', marginBottom: '10px', lineHeight: '1.8' } },
        UI.h('span', { style: { marginRight: '15px' } }, '☑  อนุญาต'),
        UI.h('span', {}, '☐  ไม่อนุญาต')));
      // ลายเซ็น
      const a3SigFile = a3UserData.signature || null;
      const a3Sig = a3SigFile ? '/uploads/' + UI.encodePath(a3SigFile) : null;
      if (a3Sig) {
        const a3Img = UI.h('img', { src: a3Sig, style: { maxHeight: '50px', display: 'block', margin: '0 auto 3px auto' } });
        a3Img.onerror = function(){ this.style.display='none'; };
        approvalCol.append(a3Img);
      }
      const a3Name = [(a3UserData.title || '') + (a3UserData.first_name || approver3.name || ''), a3UserData.last_name || ''].filter(Boolean).join(' ');
      approvalCol.append(UI.h('div', {}, `(${a3Name})`));
      approvalCol.append(UI.h('div', {}, a3UserData.position || 'ผู้อนุมัติ'));
      if (approver3.at) approvalCol.append(UI.h('div', { style: { marginTop: '3px' } }, thaiFormDate(approver3.at)));
    }
    // รวม 2 คอลัมน์เป็น flex row
    const bottomRow = UI.h('div', { style: { display: 'flex', alignItems: 'flex-start', marginTop: '15px', marginBottom: '10px' } }, statsCol, approvalCol);
    a4.append(bottomRow);

    // === Footer: ปุ่มพิมพ์ + ปิด ===
    let m;
    const foot = UI.h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', width: '100%' } },
      UI.h('button', {
        className: 'btn btn-primary',
        style: { fontSize: '14px', padding: '8px 24px' },
        onclick: () => {
          const css = document.querySelector('link[href*="style.css"]');
          const styleTag = css ? `<link rel="stylesheet" href="${css.href}">` : '';
          const bodyHtml = a4.outerHTML;
          const w = window.open('', '_blank', 'width=900,height=1200');
          if (!w) return UI.toast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต pop-up', 'error');
          w.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>ใบ${r.leave_type} ${r.leave_no}</title>${styleTag}<style>body{background:#f0f2f5;padding:32px;margin:0}@media print{body{background:#fff;padding:0}}</style></head><body>${bodyHtml}</body></html>`);
          w.document.close();
          setTimeout(() => { w.focus(); w.print(); }, 400);
        }
      }, '⬢ พิมพ์'),
      UI.h('button', { className: 'btn btn-outline', onclick: () => { if (m) m.close(); } }, 'ปิด'),
    );
    m = UI.modal({ title: `▭ ใบ${r.leave_type} ${r.leave_no || ''}`, body: a4, footer: foot, size: 'lg' });
  },

  async openForm(presetGroup) {
    if (presetGroup === 'vacation' || presetGroup === 'vacation-school') { return LeaveView.openVacationForm(); }
    // === แบบฟอร์มยื่นคำลาป่วย ลากิจ ลาคลอด (แบบฟอร์มราชการ) ===
    return LeaveView.openLeaveForm(null);
  },

  /** แก้ไขคำขอลา (admin) — เปิดฟอร์มเดียวกับตอนสร้าง พร้อมค่าเดิม */
  async openEdit(r) {
    return LeaveView.openLeaveForm(r);
  },

  async openLeaveForm(editRow) {
    const r = editRow || null;
    if (r && String(r.leave_type) === 'ลาพักผ่อน') { return LeaveView.openVacationForm(r); }
    const u = Auth.user;
    const uName = r ? `${r.title || u.title || ''} ${r.first_name || r.full_name || u.full_name || ''} ${r.last_name || u.last_name || ''}`.trim() : `${u.title || ''} ${u.first_name || u.full_name || ''} ${u.last_name || ''}`.trim();
    const uPos = r ? (r.position || u.position || '') : (u.position || '');
    // วันที่ปัจจุบัน (วัน วันที่ เดือน พ.ศ.)
    const now = new Date();
    const daysThai = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
    const monthsThai = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const todayThai = `วัน${daysThai[now.getDay()]}ที่ ${now.getDate()} เดือน${monthsThai[now.getMonth()]} พ.ศ. ${now.getFullYear() + 543}`;
    const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // โหลดรายชื่อบุคลากรกลุ่มงานเดียวกัน
    let coUsers = [];
    try { const d = await API.get('/leave-users'); coUsers = d.users || []; } catch (_e) {}
    // โหลดสถิติการลา (เมื่อแก้ไข ไม่นับรายการที่กำลังแก้ไข)
    let statsData = [];
    let fyYear = new Date().getFullYear() + 543;
    try { const sd = await API.get('/leave-stats' + (r ? '?excludeId=' + r.id : '')); statsData = sd.stats || []; fyYear = sd.fyYear + 543; } catch (_e) {}

    const body = UI.h('div', { className: 'form-grid', style: { fontSize: '15px' } },
      // วันที่
      UI.h('div', { className: 'form-group full' },
        UI.h('label', { style: { fontWeight: 700 } }, 'วันที่'),
        UI.h('div', { style: { padding: '6px 0', fontSize: '15px' } }, todayThai)),
      // เขียนที่
      UI.h('div', { className: 'form-group full' },
        UI.h('label', { style: { fontWeight: 700 } }, 'เขียนที่'),
        UI.h('input', { id: 'lf-writing', value: (r && r.writing_at) ? r.writing_at : 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2', style: { width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '8px' } })),
      // เรื่อง
      UI.h('div', { className: 'form-group full' },
        UI.h('label', { style: { fontWeight: 700 } }, 'เรื่อง', UI.h('span', { className: 'req' }, ' *')),
        UI.h('select', { id: 'lf-type', style: { padding: '8px', border: '1px solid #d1d5db', borderRadius: '8px', width: '100%' } },
          ['ลาป่วย', 'ลากิจ', 'ลาคลอดบุตร'].map((t) => UI.h('option', { value: t, selected: r ? String(r.leave_type) === t : t === 'ลาป่วย' }, t)))),
      // เนื่องจาก (แสดงเฉพาะลากิจและลาป่วย)
      UI.h('div', { className: 'form-group full', id: 'lf-reason-wrap', style: { display: 'none' } },
        UI.h('label', { style: { fontWeight: 700 } }, 'เนื่องจาก'),
        UI.h('textarea', { id: 'lf-reason', rows: 3, placeholder: 'กรอกเหตุผลการลา', style: { width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '8px', resize: 'vertical' } }, r ? (r.reason || '') : '')),
      // เรียน
      UI.h('div', { className: 'form-group full' },
        UI.h('label', { style: { fontWeight: 700 } }, 'เรียน'),
        UI.h('div', { style: { padding: '6px 0', fontSize: '15px', fontWeight: 600 } }, 'ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2')),
      // ข้าพเจ้า
      UI.h('div', { className: 'form-group full' },
        UI.h('label', { style: { fontWeight: 700 } }, 'ข้าพเจ้า'),
        UI.h('div', { style: { padding: '6px 0', fontSize: '15px' } }, `${uName} ${uPos}`)),

      // ขอลาตั้งแต่ ... ถึง ...
      UI.h('div', { className: 'form-group' },
        UI.h('label', { style: { fontWeight: 700 } }, 'ขอลาตั้งแต่วันที่', UI.h('span', { className: 'req' }, ' *')),
        UI.thaiDatePicker('lf-from', { value: r ? r.date_from : undefined, onChange: calcDays })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', { style: { fontWeight: 700 } }, 'ถึงวันที่', UI.h('span', { className: 'req' }, ' *')),
        UI.thaiDatePicker('lf-to', { value: r ? r.date_to : undefined, onChange: calcDays })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', { style: { fontWeight: 700 } }, 'มีกำหนด'),
        UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          UI.h('input', { id: 'lf-days', type: 'number', min: '1', value: r ? (r.days || 1) : '1', style: { width: '80px', padding: '8px', border: '1px solid #d1d5db', borderRadius: '8px' } }),
          UI.h('span', {}, 'วัน'))),
      // ลาครั้งสุดท้าย
      UI.h('div', { className: 'form-group full', style: { marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #e5e7eb' } },
        UI.h('label', { style: { fontWeight: 700, color: '#6b7280' } }, 'ลาครั้งสุดท้าย')),      
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ตั้งแต่วันที่'),
        UI.thaiDatePicker('lf-last-from', { value: r ? r.last_leave_from : undefined })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ถึงวันที่'),
        UI.thaiDatePicker('lf-last-to', { value: r ? r.last_leave_to : undefined, onChange: calcLastDays })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'มีกำหนด'),
        UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          UI.h('input', { id: 'lf-last-days', type: 'number', min: '0', value: r && r.last_leave_days ? r.last_leave_days : '', style: { width: '80px', padding: '8px', border: '1px solid #d1d5db', borderRadius: '8px' } }),
          UI.h('span', {}, 'วัน'))),
      // ระหว่างลาติดต่อได้ที่ + เบอร์โทรศัพท์ (บรรทัดเดียวกัน)
      UI.h('div', { className: 'form-group' },
        UI.h('label', { style: { fontWeight: 700 } }, 'ระหว่างลาติดต่อได้ที่'),
        UI.h('input', { id: 'lf-addr', value: r ? (r.address || '') : '', placeholder: 'เช่น 123/45 ต.เด่นชัย อ.เด่นชัย จ.แพร่', style: { width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '8px' } })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', { style: { fontWeight: 700 } }, 'เบอร์โทรศัพท์'),
        UI.h('input', { id: 'lf-phone', value: r ? (r.phone || '') : '', placeholder: 'เช่น 081-2345678', style: { width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '8px' } })),
      // สถิติการลาปีงบประมาณนี้
      UI.h('div', { className: 'form-group full', id: 'lf-stats-wrap' },
        UI.h('label', { style: { fontWeight: 700, marginBottom: '6px', display: 'block' } }, 'สถิติการลาในปีงบประมาณนี้'),
        UI.h('div', { id: 'lf-stats' }, UI.h('span', { className: 'hint' }, 'กำลังโหลด...'))),
      // เอกสารแนบ
      UI.h('div', { className: 'form-group full' },
        UI.h('label', { style: { fontWeight: 700 } }, 'เอกสาร (ถ้ามี)'),
        UI.h('input', { id: 'lf-file', type: 'file', style: { padding: '6px 0' } })),
      // มอบหมายงาน
      UI.h('div', { className: 'form-group full' },
        UI.h('label', { style: { fontWeight: 700 } }, 'มอบหมายงานให้ผู้ทำหน้าที่แทน'),
        UI.h('select', { id: 'lf-delegate', style: { width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '8px' } },
          [UI.h('option', { value: '' }, '-- ไม่มี --'),
            ...coUsers.map((c) => UI.h('option', { value: c.id, selected: r ? Number(r.delegate_to) === Number(c.id) : false }, UI.personName(c) + ' (' + (c.position || '') + ')'))])),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, r ? '💾 บันทึกการแก้ไข' : '📨 ส่งคำขอ'));
    const m = UI.modal({ title: r ? '✎ แก้ไขคำขอลา — ' + (r.leave_no || '') : '🤒 ยื่นคำลาป่วย ลากิจ ลาคลอด', body, footer: foot, size: 'lg' });

    // ดึงรายการลาล่าสุดมาแสดงในช่อง ลาครั้งสุดท้าย
    (async () => {
      try {
        const d = await API.get('/leave-last');
        const last = d.last;
        if (last && last.date_from) {
          const fromEl = document.getElementById('lf-last-from');
          const toEl = document.getElementById('lf-last-to');
          const daysEl = document.getElementById('lf-last-days');
          if (fromEl) fromEl.value = UI.isoToBE(last.date_from);
          if (toEl) toEl.value = UI.isoToBE(last.date_to);
          if (daysEl) daysEl.value = last.days || '';
        }
      } catch (_e) {}
    })();

    // แสดงตารางสถิติการลา
    function renderStats() {
      const el = document.getElementById('lf-stats');
      if (!el) return;
      const thisDays = parseInt(document.getElementById('lf-days').value, 10) || 0;
      const thisType = document.getElementById('lf-type').value;
      const sick = (statsData.find(s => s.leave_type === 'ลาป่วย') || {}).used || 0;
      const personal = (statsData.find(s => s.leave_type === 'ลากิจ') || {}).used || 0;
      const maternity = (statsData.find(s => s.leave_type === 'ลาคลอดบุตร') || {}).used || 0;
      const sickNow = (thisType === 'ลาป่วย') ? thisDays : 0;
      const personalNow = (thisType === 'ลากิจ') ? thisDays : 0;
      const maternityNow = (thisType === 'ลาคลอดบุตร') ? thisDays : 0;
      let html = '<table class="leave-stats-table">';
      html += '<thead><tr>';
      html += '<th>ประเภทการลา</th>';
      html += '<th>ลามาแล้ว</th>';
      html += '<th>ลาครั้งนี้</th>';
      html += '<th style="font-weight:700;">รวมเป็น</th>';
      html += '</tr></thead><tbody>';
      html += '<tr><td style="text-align:left;">ป่วย</td>';
      html += '<td>' + sick + '</td>';
      html += '<td>' + sickNow + '</td>';
      html += '<td style="font-weight:700;color:#059669;">' + (sick + sickNow) + '</td></tr>';
      html += '<tr><td style="text-align:left;">กิจส่วนตัว</td>';
      html += '<td>' + personal + '</td>';
      html += '<td>' + personalNow + '</td>';
      html += '<td style="font-weight:700;color:#059669;">' + (personal + personalNow) + '</td></tr>';
      html += '<tr><td style="text-align:left;">คลอดบุตร</td>';
      html += '<td>' + maternity + '</td>';
      html += '<td>' + maternityNow + '</td>';
      html += '<td style="font-weight:700;color:#059669;">' + (maternity + maternityNow) + '</td></tr>';
      html += '</tbody></table>';
      el.innerHTML = html;
    }
    renderStats();
    // แสดง/ซ่อนช่องเนื่องจากเมื่อเลือกลากิจ
    function toggleReason() {
      const type = document.getElementById('lf-type').value;
      const wrap = document.getElementById('lf-reason-wrap');
      if (wrap) wrap.style.display = (type === 'ลากิจ' || type === 'ลาป่วย') ? '' : 'none';
    }
    toggleReason();
    document.getElementById('lf-type').addEventListener('change', () => { renderStats(); toggleReason(); });
    document.getElementById('lf-days').addEventListener('change', renderStats);

    function calcDays() {
      const from = UI.readThaiDateInput('lf-from');
      const to = UI.readThaiDateInput('lf-to');
      if (!from || !to) return;
      const a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00');
      const days = Math.max(1, Math.round((b - a) / 86400000) + 1);
      document.getElementById('lf-days').value = days;
    }
    function calcLastDays() {
      const from = UI.readThaiDateInput('lf-last-from');
      const to = UI.readThaiDateInput('lf-last-to');
      if (!from || !to) return;
      const a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00');
      const days = Math.max(1, Math.round((b - a) / 86400000) + 1);
      document.getElementById('lf-last-days').value = days;
    }

    async function save() {
      const leave_type = document.getElementById('lf-type').value;
      const date_from = UI.readThaiDateInput('lf-from');
      const date_to = UI.readThaiDateInput('lf-to');
      const days = parseInt(document.getElementById('lf-days').value, 10) || 1;
      const writing_at = document.getElementById('lf-writing').value.trim();
      const address = document.getElementById('lf-addr').value.trim();
      const phone = document.getElementById('lf-phone').value.trim();
      const last_leave_from = UI.readThaiDateInput('lf-last-from');
      const last_leave_to = UI.readThaiDateInput('lf-last-to');
      const last_leave_days = parseInt(document.getElementById('lf-last-days').value, 10) || 0;
      const delegate_to = document.getElementById('lf-delegate').value;
      if (!date_from || !date_to) return UI.toast('กรุณาระบุวันลา', 'error');
      // ส่งแบบ multipart/form-data (รองรับไฟล์แนบ)
      const fd = new FormData();
      fd.append('leave_type', leave_type);
      fd.append('date_from', date_from);
      fd.append('date_to', date_to);
      fd.append('days', days);
      fd.append('writing_at', writing_at);
      fd.append('address', address);
      fd.append('phone', phone);
      if (last_leave_from) fd.append('last_leave_from', last_leave_from);
      if (last_leave_to) fd.append('last_leave_to', last_leave_to);
      if (last_leave_days) fd.append('last_leave_days', last_leave_days);
      if (delegate_to) fd.append('delegate_to', delegate_to);
      const reason = document.getElementById('lf-reason') ? document.getElementById('lf-reason').value.trim() : '';
      if ((leave_type === 'ลากิจ' || leave_type === 'ลาป่วย') && reason) fd.append('reason', reason);
      const fileInput = document.getElementById('lf-file');
      if (fileInput && fileInput.files.length) fd.append('attachment', fileInput.files[0]);
      try {
        if (r) {
          const res = await API.putForm('/leaves/' + r.id, fd);
          UI.toast(res.message || 'แก้ไขคำขอลาเรียบร้อย');
        } else {
          const res = await API.postForm('/leaves', fd);
          UI.toast(res.message);
        }
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  async openVacationForm(editRow) {
    // === แบบฟอร์มยื่นคำลาพักผ่อน (เหมือนแบบฟอร์มราชการ) ===
    const r = editRow || null;
    const u = Auth.user;
    const uName = r ? `${r.title || u.title || ''} ${r.first_name || r.full_name || u.full_name || ''} ${r.last_name || u.last_name || ''}`.trim() : `${u.title || ''} ${u.first_name || u.full_name || ''} ${u.last_name || ''}`.trim();
    const uPos = r ? (r.position || u.position || '') : (u.position || '');
    const now = new Date();
    const daysThai = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
    const monthsThai = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const todayThai = `วัน${daysThai[now.getDay()]}ที่ ${now.getDate()} เดือน${monthsThai[now.getMonth()]} พ.ศ. ${now.getFullYear() + 543}`;

    // โหลดรายชื่อบุคลากรกลุ่มงานเดียวกัน
    let coUsers = [];
    try { const d = await API.get('/leave-users'); coUsers = d.users || []; } catch (_e) {}
    // โหลดสถิติการลา (เมื่อแก้ไข ไม่นับรายการที่กำลังแก้ไข)
    let statsData = [];
    let fyYear = new Date().getFullYear() + 543;
    try { const sd = await API.get('/leave-stats' + (r ? '?excludeId=' + r.id : '')); statsData = sd.stats || []; fyYear = sd.fyYear + 543; } catch (_e) {}
    // โหลดข้อมูลวันลาพักผ่อนสะสม
    let balanceData = { accumulated: 0, annual: 10, total: 10, used: 0, remaining: 10 };
    try { balanceData = await API.get('/my-leave-balance'); } catch (_e) {}

    const body = UI.h('div', { className: 'form-grid', style: { fontSize: '15px' } },
      UI.h('div', { className: 'form-group full' },
        UI.h('label', { style: { fontWeight: 700 } }, 'วันที่'),
        UI.h('div', { style: { padding: '6px 0', fontSize: '15px' } }, todayThai)),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', { style: { fontWeight: 700 } }, 'เขียนที่'),
        UI.h('input', { id: 'lf-writing', value: (r && r.writing_at) ? r.writing_at : 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2', style: { width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '8px' } })),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', { style: { fontWeight: 700 } }, 'เรื่อง'),
        UI.h('div', { style: { padding: '6px 0', fontSize: '15px' } }, 'ขอลาพักผ่อน')),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', { style: { fontWeight: 700 } }, 'เรียน'),
        UI.h('div', { style: { padding: '6px 0', fontSize: '15px', fontWeight: 600 } }, 'ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2')),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', { style: { fontWeight: 700 } }, 'ข้าพเจ้า'),
        UI.h('div', { style: { padding: '6px 0', fontSize: '15px' } }, `${uName} ${uPos}`)),
      // แสดงสิทธิ์ลาพักผ่อน
      UI.h('div', { className: 'form-group full' },
        UI.h('div', { style: { fontSize: '14px', lineHeight: '1.8' } },
          UI.h('span', {}, `มีวันลาพักผ่อนสะสม ${balanceData.accumulated || 0} วันทำการ`),
          UI.h('br'),
          UI.h('span', {}, `มีสิทธิ์ลาพักผ่อนประจำปีนี้อีก ${balanceData.annual || 10} วันทำการ`),
          UI.h('br'),
          UI.h('span', { style: { fontWeight: 700 } }, `รวมเป็น ${balanceData.total || (balanceData.accumulated + balanceData.annual) || 10} วันทำการ`))),

      UI.h('div', { className: 'form-group' },
        UI.h('label', { style: { fontWeight: 700 } }, 'ขอลาพักผ่อนตั้งแต่วันที่', UI.h('span', { className: 'req' }, ' *')),
        UI.thaiDatePicker('lf-from', { value: r ? r.date_from : undefined, onChange: calcDays })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', { style: { fontWeight: 700 } }, 'ถึงวันที่', UI.h('span', { className: 'req' }, ' *')),
        UI.thaiDatePicker('lf-to', { value: r ? r.date_to : undefined, onChange: calcDays })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', { style: { fontWeight: 700 } }, 'มีกำหนด'),
        UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          UI.h('input', { id: 'lf-days', type: 'number', min: '1', value: r ? (r.days || 1) : '1', style: { width: '80px', padding: '8px', border: '1px solid #d1d5db', borderRadius: '8px' } }),
          UI.h('span', {}, 'วัน'))),
      UI.h('div', { className: 'form-group' },
        UI.h('label', { style: { fontWeight: 700 } }, 'ระหว่างลาติดต่อข้าพเจ้าได้ที่'),
        UI.h('input', { id: 'lf-addr', value: r ? (r.address || '') : '', placeholder: 'เช่น 123/45 ต.เด่นชัย อ.เด่นชัย จ.แพร่', style: { width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '8px' } })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', { style: { fontWeight: 700 } }, 'เบอร์โทรศัพท์'),
        UI.h('input', { id: 'lf-phone', placeholder: 'เช่น 081-2345678', style: { width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '8px' } })),
      UI.h('div', { className: 'form-group full', id: 'lf-stats-wrap' },
        UI.h('label', { style: { fontWeight: 700, marginBottom: '6px', display: 'block' } }, 'สถิติการลาในปีงบประมาณนี้'),
        UI.h('div', { id: 'lf-stats' }, UI.h('span', { className: 'hint' }, 'กำลังโหลด...'))),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', { style: { fontWeight: 700 } }, 'เอกสาร (ถ้ามี)'),
        UI.h('input', { id: 'lf-file', type: 'file', style: { padding: '6px 0' } })),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', { style: { fontWeight: 700 } }, 'มอบหมายงานให้ผู้ทำหน้าที่แทน'),
        UI.h('select', { id: 'lf-delegate', style: { width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '8px' } },
          [UI.h('option', { value: '' }, '-- ไม่มี --'),
            ...coUsers.map((c) => UI.h('option', { value: c.id, selected: r ? Number(r.delegate_to) === Number(c.id) : false }, UI.personName(c) + ' (' + (c.position || '') + ')'))])),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, r ? '💾 บันทึกการแก้ไข' : '📨 ส่งคำขอ'));
    const m = UI.modal({ title: r ? '✎ แก้ไขคำขอลา — ' + (r.leave_no || '') : '🏖️ ยื่นคำลาพักผ่อน', body, footer: foot, size: 'lg' });

    // แสดงตารางสถิติการลาพักผ่อน
    function renderStats() {
      const el = document.getElementById('lf-stats');
      if (!el) return;
      const thisDays = parseInt(document.getElementById('lf-days').value, 10) || 0;
      // ลามาแล้ว = ผลรวมคอลั่ม จำนวนวัน จากรายการขออนุญาตลาพักผ่อน (approved + pending)
      const usedBefore = (statsData.find(s => s.leave_type === 'ลาพักผ่อน') || {}).used || 0;
      const total = usedBefore + thisDays;
      let html = '<table style="border-collapse:collapse;font-size:13px;">';
      html += '<thead><tr style="background:#f1f5f9;">';
      html += '<th style="padding:4px 12px;border:1px solid #d1d5db;text-align:center;">ลามาแล้ว<br>(วันทำการ)</th>';
      html += '<th style="padding:4px 12px;border:1px solid #d1d5db;text-align:center;">ลาครั้งนี้<br>(วันทำการ)</th>';
      html += '<th style="padding:4px 12px;border:1px solid #d1d5db;text-align:center;font-weight:700;">รวมเป็น<br>(วันทำการ)</th>';
      html += '</tr></thead><tbody><tr>';
      html += '<td style="padding:4px 12px;border:1px solid #d1d5db;text-align:center;">' + usedBefore + '</td>';
      html += '<td style="padding:4px 12px;border:1px solid #d1d5db;text-align:center;">' + thisDays + '</td>';
      html += '<td style="padding:4px 12px;border:1px solid #d1d5db;text-align:center;font-weight:700;color:#059669;">' + total + '</td>';
      html += '</tr></tbody></table>';
      el.innerHTML = html;
    }
    renderStats();
    document.getElementById('lf-days').addEventListener('change', renderStats);

    function calcDays() {
      const from = UI.readThaiDateInput('lf-from');
      const to = UI.readThaiDateInput('lf-to');
      if (!from || !to) return;
      const a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00');
      const days = Math.max(1, Math.round((b - a) / 86400000) + 1);
      document.getElementById('lf-days').value = days;
    }
    function calcLastDays() {
      const from = UI.readThaiDateInput('lf-last-from');
      const to = UI.readThaiDateInput('lf-last-to');
      if (!from || !to) return;
      const a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00');
      const days = Math.max(1, Math.round((b - a) / 86400000) + 1);
      document.getElementById('lf-last-days').value = days;
    }

    async function save() {
      const date_from = UI.readThaiDateInput('lf-from');
      const date_to = UI.readThaiDateInput('lf-to');
      const days = parseInt(document.getElementById('lf-days').value, 10) || 1;
      const writing_at = document.getElementById('lf-writing').value.trim();
      const address = document.getElementById('lf-addr').value.trim();
      const phone = document.getElementById('lf-phone').value.trim();
      const delegate_to = document.getElementById('lf-delegate').value;
      if (!date_from || !date_to) return UI.toast('กรุณาระบุวันลา', 'error');
      const fd = new FormData();
      fd.append('leave_type', 'ลาพักผ่อน');
      fd.append('date_from', date_from);
      fd.append('date_to', date_to);
      fd.append('days', days);
      fd.append('writing_at', writing_at);
      fd.append('address', address);
      fd.append('phone', phone);
      if (delegate_to) fd.append('delegate_to', delegate_to);
      const fileInput = document.getElementById('lf-file');
      if (fileInput && fileInput.files.length) fd.append('attachment', fileInput.files[0]);
      try {
        if (r) {
          const res = await API.putForm('/leaves/' + r.id, fd);
          UI.toast(res.message || 'แก้ไขคำขอลาเรียบร้อย');
        } else {
          const res = await API.postForm('/leaves', fd);
          UI.toast(res.message);
        }
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  async openReview(r) {
    // โหลดสถิติการลาของผู้ขอลานี้
    let statsData = [];
    let fyYear = new Date().getFullYear() + 543;
    try { const sd = await API.get('/leave-stats?userId=' + r.user_id + '&excludeId=' + (r.id || 0)); statsData = sd.stats || []; fyYear = sd.fyYear + 543; } catch (_e) {}
    const thisDays = r.days || 1;
    const thisType = r.leave_type || '';
    // แยกชื่อหัวข้อตรวจสอบตามประเภทการลา: ลาพักผ่อน / ลาป่วย ลากิจ ลาคลอด
    const isVacation = thisType === 'ลาพักผ่อน';
    const reviewTitle = isVacation ? 'ตรวจสอบคำขอลาพักผ่อน' : 'ตรวจสอบคำขอลาป่วย ลากิจ ลาคลอด';
    // สร้างตารางสถิติ (แก้ไขได้เฉพาะคอลัมน์ 'ลามาแล้ว') — แยกคอลัมน์ตามประเภทการลา
    function buildStatsHtml() {
      const inptStyle = 'width:60px;text-align:center;border:1px solid #d1d5db;border-radius:4px;padding:2px 4px;font-size:13px;';
      if (isVacation) {
        const vac = (statsData.find(s => s.leave_type === 'ลาพักผ่อน') || {}).used || 0;
        let html = '<table style="border-collapse:collapse;font-size:13px;width:auto;">';
        html += '<thead><tr style="background:#f1f5f9;">';
        html += '<th style="padding:4px 12px;border:1px solid #d1d5db;text-align:center;">ลาพักผ่อน<br>(วันทำการ)</th>';
        html += '<th style="padding:4px 12px;border:1px solid #d1d5db;text-align:center;font-weight:700;">รวมเป็น<br>(วันทำการ)</th>';
        html += '</tr></thead><tbody><tr>';
        html += '<td style="padding:4px 12px;border:1px solid #d1d5db;text-align:center;"><input type="number" class="stat-used" data-key="ลาพักผ่อน" value="' + vac + '" min="0" style="' + inptStyle + '"></td>';
        html += '<td style="padding:4px 12px;border:1px solid #d1d5db;text-align:center;font-weight:700;color:#059669;"><span class="stat-total" data-key="ลาพักผ่อน">' + vac + '</span></td>';
        html += '</tr></tbody></table>';
        return html;
      }
      const sick = (statsData.find(s => s.leave_type === 'ลาป่วย') || {}).used || 0;
      const personal = (statsData.find(s => s.leave_type === 'ลากิจ') || {}).used || 0;
      const maternity = (statsData.find(s => s.leave_type === 'ลาคลอดบุตร') || {}).used || 0;
      let html = '<table style="border-collapse:collapse;font-size:13px;width:auto;">';
      html += '<thead><tr style="background:#f1f5f9;">';
      html += '<th style="padding:4px 12px;border:1px solid #d1d5db;text-align:center;">ลาป่วย<br>(วันทำการ)</th>';
      html += '<th style="padding:4px 12px;border:1px solid #d1d5db;text-align:center;">ลากิจ<br>(วันทำการ)</th>';
      html += '<th style="padding:4px 12px;border:1px solid #d1d5db;text-align:center;">ลาคลอดบุตร<br>(วันทำการ)</th>';
      html += '</tr></thead><tbody><tr>';
      html += '<td style="padding:4px 12px;border:1px solid #d1d5db;text-align:center;"><input type="number" class="stat-used" data-key="ลาป่วย" value="' + sick + '" min="0" style="' + inptStyle + '"></td>';
      html += '<td style="padding:4px 12px;border:1px solid #d1d5db;text-align:center;"><input type="number" class="stat-used" data-key="ลากิจ" value="' + personal + '" min="0" style="' + inptStyle + '"></td>';
      html += '<td style="padding:4px 12px;border:1px solid #d1d5db;text-align:center;"><input type="number" class="stat-used" data-key="ลาคลอดบุตร" value="' + maternity + '" min="0" style="' + inptStyle + '"></td>';
      html += '</tr></tbody></table>';
      return html;
    }
    // สถานะ (แสดงเหมือนหน้ารายการลา)
    let statusLabel = '';
    if (r.status === 'pending' && !r.reviewed) statusLabel = '◷ รอตรวจสอบ';
    else if (r.status === 'pending' && r.reviewed) statusLabel = '◷ รออนุมัติ';
    else if (r.status === 'approved') statusLabel = '● อนุมัติแล้ว';
    else if (r.status === 'rejected') statusLabel = '✕ ไม่อนุมัติ';
    else statusLabel = r.status;
    // สร้างรายละเอียดแบบฟอร์ม (เหมือนฟอร์มยื่นคำลาป่วย ลากิจ ลาคลอด)
    const body = UI.h('div', { style: { fontSize: '14px' } },
      // แถวบน: เลขที่ + สถานะ
      UI.h('div', { className: 'form-grid' },
        UI.h('div', { className: 'form-group' }, UI.h('label', { style: { fontWeight: 700 } }, 'เลขที่คำขอ'), UI.h('div', { style: { fontWeight: 600 } }, r.leave_no || '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', { style: { fontWeight: 700 } }, 'สถานะ'), UI.h('div', {}, statusLabel))),
      // วันที่ปัจจุบัน
      UI.h('div', { className: 'form-group full' }, UI.h('label', { style: { fontWeight: 700 } }, 'วันที่'),
        UI.h('div', { style: { padding: '4px 0' } }, r.created_at ? UI.thaiDate(r.created_at.split(' ')[0]) : '-')),
      // เขียนที่
      UI.h('div', { className: 'form-group full' }, UI.h('label', { style: { fontWeight: 700 } }, 'เขียนที่'),
        UI.h('div', { style: { padding: '4px 0' } }, r.writing_at || '-')),
      // เรื่อง
      UI.h('div', { className: 'form-group full' }, UI.h('label', { style: { fontWeight: 700 } }, 'เรื่อง'),
        UI.h('div', { style: { padding: '4px 0', fontWeight: 600 } }, r.leave_type)),
      // เรียน
      UI.h('div', { className: 'form-group full' }, UI.h('label', { style: { fontWeight: 700 } }, 'เรียน'),
        UI.h('div', { style: { padding: '4px 0', fontWeight: 600 } }, 'ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2')),
      // ข้าพเจ้า
      UI.h('div', { className: 'form-group full' }, UI.h('label', { style: { fontWeight: 700 } }, 'ข้าพเจ้า'),
        UI.h('div', { style: { padding: '4px 0' } }, `${UI.personName(r)} ${r.position || ''}`)),

      // ขอลาตั้งแต่ ... ถึง ... + กำหนด
      UI.h('div', { className: 'form-grid' },
        UI.h('div', { className: 'form-group' }, UI.h('label', { style: { fontWeight: 700 } }, 'ขอลาตั้งแต่วันที่'),
          UI.h('div', { style: { padding: '4px 0' } }, UI.thaiDate(r.date_from))),
        UI.h('div', { className: 'form-group' }, UI.h('label', { style: { fontWeight: 700 } }, 'ถึงวันที่'),
          UI.h('div', { style: { padding: '4px 0' } }, UI.thaiDate(r.date_to))),
        UI.h('div', { className: 'form-group' }, UI.h('label', { style: { fontWeight: 700 } }, 'มีกำหนด'),
          UI.h('div', { style: { padding: '4px 0' } }, `${r.days || '-'} วัน`))),
      // ลาครั้งสุดท้าย
      (r.last_leave_from || r.last_leave_to) ? UI.h('div', { className: 'form-group full', style: { marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed #e5e7eb' } },
        UI.h('label', { style: { fontWeight: 700, color: '#6b7280' } }, 'ลาครั้งสุดท้าย'),
        UI.h('div', { className: 'form-grid' },
          UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ตั้งแต่วันที่'), UI.h('div', {}, r.last_leave_from ? UI.thaiDate(r.last_leave_from) : '-')),
          UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ถึงวันที่'), UI.h('div', {}, r.last_leave_to ? UI.thaiDate(r.last_leave_to) : '-')),
          UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'มีกำหนด'), UI.h('div', {}, r.last_leave_days ? `${r.last_leave_days} วัน` : '-')))) : null,
      // ระหว่างลาติดต่อได้ที่ + เบอร์โทรศัพท์
      UI.h('div', { className: 'form-grid' },
        UI.h('div', { className: 'form-group' }, UI.h('label', { style: { fontWeight: 700 } }, 'ระหว่างลาติดต่อได้ที่'),
          UI.h('div', { style: { padding: '4px 0' } }, r.address || '-')),
        UI.h('div', { className: 'form-group' }, UI.h('label', { style: { fontWeight: 700 } }, 'เบอร์โทรศัพท์'),
          UI.h('div', { style: { padding: '4px 0' } }, r.phone || '-'))),
      // สถิติการลาในปีงบประมาณนี้ (แก้ไขได้)
      UI.h('div', { className: 'form-group full', style: { marginTop: '10px', paddingTop: '10px', borderTop: '2px solid #e5e7eb' } },
        UI.h('label', { style: { fontWeight: 700, marginBottom: '6px', display: 'block' } }, '📊 สถิติการลาในปีงบประมาณนี้ (แก้ไขได้)'),
        (() => { const d = UI.h('div', { id: 'review-stats' }); d.innerHTML = buildStatsHtml(); return d; })()),
      // มอบหมายงาน
      r.delegate_name ? UI.h('div', { className: 'form-group full' },
        UI.h('label', { style: { fontWeight: 700 } }, 'มอบหมายงานให้ผู้ทำหน้าที่แทน'),
        UI.h('div', { style: { padding: '4px 0' } }, `${r.delegate_name} (${r.delegate_position || '-'})`)) : null,
      // ผู้ยื่นคำขอ + ความคืบหน้า
      UI.h('div', { className: 'form-group full' }, UI.h('label', { style: { fontWeight: 700 } }, 'ผู้ยื่นคำขอ'),
        UI.h('div', { style: { padding: '4px 0' } }, `${UI.personName(r)} (${r.position || '-'})`)),
      UI.h('div', { className: 'form-group full' }, UI.h('label', { style: { fontWeight: 700 } }, 'ความคืบหน้าการอนุมัติ'), UI.approvalDetail(r)),
    );
    const foot = UI.h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end' } },
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-danger', onclick: doReject }, '✕ ไม่อนุญาติ'),
      UI.h('button', { className: 'btn btn-primary', onclick: doReview }, '● ตรวจสอบแล้ว'));
    const m = UI.modal({ title: `▭ ${reviewTitle} — ${r.leave_no || ''}`, body, footer: foot, size: 'lg' });
    // อัปเดต "รวมเป็น" อัตโนมัติเมื่อแก้ไขค่าในตารางสถิติ (รวมทุกคอลัมน์ลามาแล้ว)
    function recalcStats() {
      const updateTotal = () => {
        let sum = 0;
        document.querySelectorAll('#review-stats .stat-used').forEach((inp) => { sum += parseInt(inp.value, 10) || 0; });
        const totalEl = document.querySelector('#review-stats .stat-total');
        if (totalEl) totalEl.textContent = sum;
      };
      document.querySelectorAll('#review-stats .stat-used').forEach((inp) => inp.addEventListener('input', updateTotal));
    }
    recalcStats();
    // ปุ่มไม่อนุญาติ
    async function doReject() {
      const note = prompt('เหตุผลที่ไม่อนุญาติ (ไม่บังคับ):') || '';
      const ok = await UI.confirm(`ไม่อนุญาติคำขอลา ${r.leave_type} ของ ${UI.personName(r)}?`, { okText: '✕ ไม่อนุญาติ', danger: true });
      if (!ok) return;
      try {
        const res = await API.put(`/leaves/${r.id}/reject`, { note });
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
    // ปุ่มตรวจสอบแล้ว
    async function doReview() {
      const ok = await UI.confirm(`ตรวจสอบคำขอลา ${r.leave_type} ของ ${UI.personName(r)} แล้ว ยืนยันส่งต่อผู้อนุมัติขั้นต้น?`, { okText: '● ตรวจสอบแล้ว' });
      if (!ok) return;
      // ดึงค่าสถิติจากตาราง (แก้ไขได้)
      const stats = {};
      document.querySelectorAll('.stat-used').forEach((inp) => {
        stats[inp.getAttribute('data-key')] = { used: parseInt(inp.value, 10) || 0 };
      });
      document.querySelectorAll('.stat-this').forEach((inp) => {
        const key = inp.getAttribute('data-key');
        if (stats[key]) stats[key].thisTime = parseInt(inp.value, 10) || 0;
      });
      try {
        const res = await API.put(`/leaves/${r.id}/review`, { reviewed_stats: stats });
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  async decide(r, action, customLabel) {
    const label = customLabel || (action === 'approve' ? 'อนุมัติ' : 'ไม่อนุมัติ');
    // ผู้อนุมัติขั้นต้น (level 2) → แสดง modal มีช่องความเห็น
    if (action === 'approve' && customLabel === 'อนุมัติขั้นต้น') {
      const noteResult = await new Promise((resolve) => {
        let noteVal = 'เห็นควรอนุญาต';
        const body = UI.h('div', { style: { fontSize: '16px' } },
          UI.h('div', { style: { marginBottom: '15px' } }, `ต้องการอนุมัติขั้นต้นคำขอลา ${r.leave_type} ของ ${UI.personName(r)} ใช่หรือไม่?`),
          UI.h('label', { style: { fontWeight: 700, display: 'block', marginBottom: '5px' } }, 'ความเห็นผู้บังคับบัญชา'),
          UI.h('textarea', {
            style: { width: '100%', minHeight: '80px', padding: '8px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box' },
            oninput: (e) => { noteVal = e.target.value; }
          }, 'เห็นควรอนุญาต')
        );
        const foot = UI.h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end' } },
          UI.h('button', { className: 'btn', onclick: () => { m.close(); resolve(null); } }, 'ยกเลิก'),
          UI.h('button', { className: 'btn btn-primary', onclick: () => { m.close(); resolve(noteVal); } }, '● อนุมัติขั้นต้น')
        );
        let m;
        m = UI.modal({ title: 'อนุมัติขั้นต้น', body, footer: foot });
      });
      if (noteResult === null) return;
      try {
        const res = await API.put(`/leaves/${r.id}/${action}`, { note: noteResult });
        UI.toast(res.message);
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
      return;
    }
    const ok = await UI.confirm(`ต้องการ${label}คำขอลา ${r.leave_type} ของ ${UI.personName(r)} ใช่หรือไม่?`, { okText: label, danger: action !== 'approve' });
    if (!ok) return;
    try {
      const res = await API.put(`/leaves/${r.id}/${action}`, {});
      UI.toast(res.message);
      render();
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  async remove(r) {
    const ok = await UI.confirm('ต้องการลบรายการคำขอนี้ใช่หรือไม่?', { danger: true, okText: 'ลบ' });
    if (!ok) return;
    try {
      const res = await API.del('/leaves/' + r.id);
      UI.toast(res.message);
      render();
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  // ขอยกเลิกวันลา — ส่งเรื่องให้ผู้ตรวจสอบ (สิ้นสุดที่ผู้ตรวจสอบ พร้อมแจ้ง Telegram)
  async requestCancel(r) {
    const ok = await UI.confirm(`ต้องการขอยกเลิกวันลา ${r.leave_type} ${UI.date(r.date_from)} ถึง ${UI.date(r.date_to)} (${r.days || 1} วัน) ใช่หรือไม่?\nระบบจะส่งเรื่องไปยังผู้ตรวจสอบพิจารณา`, { okText: '↺ ขอยกเลิกวันลา' });
    if (!ok) return;
    try {
      const res = await API.post(`/leaves/${r.id}/cancel-request`, {});
      UI.toast(res.message);
      render();
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  // ผู้ตรวจสอบยืนยันยกเลิกวันลา — รายการถูกลบ สถิติคำนวณใหม่อัตโนมัติ + แจ้ง Telegram ผู้ขอ
  async confirmCancel(r) {
    const ok = await UI.confirm(`ต้องการยกเลิกวันลา ${r.leave_type} ของ ${UI.personName(r)}\n${UI.date(r.date_from)} ถึง ${UI.date(r.date_to)} (${r.days || 1} วัน) ใช่หรือไม่?\nเมื่อยืนยัน รายการวันลานี้จะถูกลบและสถิติการลาจะคำนวณใหม่ทันที`, { okText: '↺ ยกเลิกวันลา', danger: true });
    if (!ok) return;
    try {
      const res = await API.put(`/leaves/${r.id}/cancel-confirm`, {});
      UI.toast(res.message);
      render();
    } catch (e) { UI.toast(e.message, 'error'); }
  },
};
