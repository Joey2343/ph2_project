'use strict';
/* เมนู 10: บริหารงบประมาณ */

const BudgetsView = {
  budgets: [],
  activeId: null,
  txCache: {},

  async render(app) {
    const head = UI.h('div', { className: 'page-head' },
      UI.h('div', {},
        UI.h('div', { className: 'page-title' }, UI.h('span', { className: 'pi' }, '💰'), 'บริหารงบประมาณ'),
        UI.h('div', { className: 'page-desc' }, 'แผนงบประมาณและการใช้จ่ายของหน่วยงาน')),
      Auth.isAdmin() ? UI.h('button', { className: 'btn btn-primary', onclick: () => BudgetsView.openBudgetForm() }, '+ เพิ่มรายการงบประมาณ') : null,
    );
    app.append(head);

    let data;
    try {
      data = await API.get('/budgets');
    } catch (e) {
      app.append(UI.h('div', { className: 'card' }, UI.empty(e.message, '⚠️')));
      return;
    }
    BudgetsView.budgets = data.budgets || [];

    // ---- สรุปภาพรวม ----
    const stats = [
      { icon: '📊', label: 'งบประมาณรวม', value: UI.money(data.totalPlan) + ' บาท', bg: 'var(--info-light)' },
      { icon: '💸', label: 'ใช้จ่ายแล้ว', value: UI.money(data.totalUsed) + ' บาท', bg: 'var(--danger-light)' },
      { icon: '💎', label: 'คงเหลือ', value: UI.money(data.totalRemaining) + ' บาท', bg: 'var(--success-light)' },
    ];
    app.append(UI.h('div', { className: 'stat-grid' }, stats.map((s) =>
      UI.h('div', { className: 'stat-card' },
        UI.h('div', { className: 'stat-icon', style: { background: s.bg } }, s.icon),
        UI.h('div', {},
          UI.h('div', { className: 'stat-value', style: { fontSize: '17px' } }, s.value),
          UI.h('div', { className: 'stat-label' }, s.label))))));

    // ---- รายการงบประมาณรายหมวด ----
    const grid = UI.h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '14px', marginBottom: '18px' } });
    for (const b of BudgetsView.budgets) {
      const pct = b.plan > 0 ? Math.min(100, Math.round((b.used / b.plan) * 100)) : 0;
      const barCls = pct >= 90 ? 'progress-fill high' : pct >= 70 ? 'progress-fill mid' : '';
      const card = UI.h('div', { className: 'card', style: { marginBottom: '0', cursor: 'pointer' }, onclick: () => BudgetsView.showTx(b.id) },
        UI.h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' } },
          UI.h('div', {},
            UI.h('div', { style: { fontWeight: 800, fontSize: '15.5px' } }, b.category),
            UI.h('div', { className: 'hint' }, `ปีงบประมาณ ${b.year}${b.note ? ' • ' + b.note : ''}`)),
          Auth.isAdmin() ? UI.h('div', { className: 'status-btns', onclick: (e) => e.stopPropagation() },
            UI.actionBtn('✎', () => BudgetsView.openBudgetForm(b)),
            UI.actionBtn('✕', () => BudgetsView.removeBudget(b), 'danger-btn')) : null),
        UI.h('div', { style: { display: 'flex', justifyContent: 'space-between', margin: '10px 0 6px', fontSize: '13.5px' } },
          UI.h('span', { className: 'hint' }, `แผน ${UI.money(b.plan)} บาท`),
          UI.h('span', { className: 'hint' }, `ใช้แล้ว ${UI.money(b.used)} บาท`)),
        UI.h('div', { className: 'progress-wrap' },
          UI.h('div', { className: 'progress-fill ' + barCls, style: { width: pct + '%' } })),
        UI.h('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontSize: '14px' } },
          UI.h('span', {}, 'คงเหลือ'),
          UI.h('span', { className: 'money' + (b.remaining < 0 ? ' negative' : '') }, UI.money(b.remaining) + ' บาท')),
      );
      grid.append(card);
    }
    if (BudgetsView.budgets.length === 0) {
      app.append(UI.h('div', { className: 'card' }, UI.empty('ยังไม่มีรายการงบประมาณ', '💰')));
    } else {
      app.append(grid);
    }

    // ---- รายการเดินบัญชีของหมวดที่เลือก ----
    const txCard = UI.h('div', { className: 'card' });
    BudgetsView.txCard = txCard;
    app.append(txCard);
    if (BudgetsView.budgets.length > 0) {
      await BudgetsView.showTx(BudgetsView.activeId || BudgetsView.budgets[0].id);
    }
  },

  async showTx(budgetId, cardEl) {
    const card = cardEl || BudgetsView.txCard;
    if (!card) return;
    const b = BudgetsView.budgets.find((x) => x.id === budgetId);
    if (!b) return;
    BudgetsView.activeId = budgetId;
    card.innerHTML = '';
    card.append(UI.h('div', { className: 'card-title' }, `🧾 รายการเดินบัญชี — ${b.category}`));

    // ฟอร์มเพิ่มรายการ (admin)
    if (Auth.isAdmin()) {
      const form = UI.h('div', { className: 'form-grid', style: { marginBottom: '16px' } },
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'วันที่'),
          UI.thaiDatePicker('bt-date')),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'ประเภท'),
          UI.h('select', { id: 'bt-type' },
            UI.h('option', { value: 'expense' }, '💸 รายจ่าย'),
            UI.h('option', { value: 'income' }, '💵 รายรับ'))),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'จำนวนเงิน (บาท)'),
          UI.h('input', { id: 'bt-amount', type: 'number', min: '0', step: '0.01' })),
        UI.h('div', { className: 'form-group full' },
          UI.h('label', {}, 'รายละเอียด'),
          UI.h('input', { id: 'bt-desc', placeholder: 'เช่น ค่าจ้างเหมาทำอาหารกลางวัน เดือน ก.ค.' })),
        UI.h('div', { className: 'form-group full', style: { display: 'flex', justifyContent: 'flex-end' } },
          UI.h('button', { className: 'btn btn-primary', onclick: addTx }, '+ บันทึกรายการ')),
      );
      card.append(form);
      document.getElementById('bt-date').value = UI.isoToBE(UI.today());
    }

    const listEl = UI.h('div', {}, UI.loading());
    card.append(listEl);

    try {
      const data = await API.get(`/budgets/${budgetId}/transactions`);
      listEl.innerHTML = '';
      if (!data.transactions.length) {
        listEl.append(UI.empty('ยังไม่มีรายการเดินบัญชี', '🧾'));
        return;
      }
      listEl.append(UI.table([
        { key: 'date', label: 'วันที่', render: (t) => UI.date(t.date) },
        { key: 'type', label: 'ประเภท', render: (t) => UI.h('span', { className: 'status-pill', style: t.type === 'expense' ? { background: '#fee2e2', color: '#b91c1c', padding: '3px 10px', borderRadius: '999px', fontWeight: 700, fontSize: '12.5px' } : { background: '#dcfce7', color: '#15803d', padding: '3px 10px', borderRadius: '999px', fontWeight: 700, fontSize: '12.5px' } }, t.type === 'expense' ? '💸 รายจ่าย' : '💵 รายรับ') },
        { key: 'description', label: 'รายละเอียด' },
        { key: 'amount', label: 'จำนวนเงิน', className: 'num', render: (t) => UI.h('span', { className: 'money' + (t.type === 'expense' ? ' negative' : '') }, (t.type === 'expense' ? '- ' : '+ ') + UI.money(t.amount)) },
        Auth.isAdmin() ? {
          key: 'actions', label: '',
          render: (t) => UI.actionBtn('✕', () => removeTx(t), 'danger-btn'),
        } : null,
      ].filter(Boolean), data.transactions));
    } catch (e) {
      listEl.innerHTML = '';
      listEl.append(UI.empty(e.message, '⚠️'));
    }

    async function addTx() {
      const data2 = {
        date: UI.readThaiDateInput('bt-date'),
        type: document.getElementById('bt-type').value,
        amount: parseFloat(document.getElementById('bt-amount').value),
        description: document.getElementById('bt-desc').value.trim(),
      };
      if (!data2.description) return UI.toast('กรุณากรอกรายละเอียดรายการ', 'error');
      if (!data2.amount || data2.amount <= 0) return UI.toast('กรุณาระบุจำนวนเงินที่ถูกต้อง', 'error');
      try {
        const res = await API.post(`/budgets/${budgetId}/transactions`, data2);
        UI.toast(res.message);
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }

    async function removeTx(t) {
      const ok = await UI.confirm('ต้องการลบรายการนี้ใช่หรือไม่?', { danger: true, okText: 'ลบ' });
      if (!ok) return;
      try {
        const res = await API.del(`/budgets/${budgetId}/transactions/${t.id}`);
        UI.toast(res.message);
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  openBudgetForm(b) {
    const budget = b || {};
    const body = UI.h('div', { className: 'form-grid' },
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ปีงบประมาณ'),
        UI.h('input', { id: 'bf-year', type: 'number', value: budget.year || (new Date().getFullYear() + 543) })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'หมวดงบประมาณ', UI.h('span', { className: 'req' }, ' *')),
        UI.h('input', { id: 'bf-cat', value: budget.category || '', placeholder: 'เช่น งบดำเนินงาน' })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'วงเงินงบประมาณ (บาท)'),
        UI.h('input', { id: 'bf-plan', type: 'number', min: '0', step: '0.01', value: budget.plan || 0 })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ลำดับการแสดง'),
        UI.h('input', { id: 'bf-sort', type: 'number', value: budget.sort || 0 })),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'หมายเหตุ'),
        UI.h('input', { id: 'bf-note', value: budget.note || '' })),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '▽ บันทึก'));
    const m = UI.modal({ title: budget.id ? '✎ แก้ไขงบประมาณ' : '+ เพิ่มรายการงบประมาณ', body, footer: foot });

    async function save() {
      const data = {
        year: parseInt(document.getElementById('bf-year').value, 10) || (new Date().getFullYear() + 543),
        category: document.getElementById('bf-cat').value.trim(),
        plan: parseFloat(document.getElementById('bf-plan').value) || 0,
        sort: parseInt(document.getElementById('bf-sort').value, 10) || 0,
        note: document.getElementById('bf-note').value.trim(),
      };
      if (!data.category) return UI.toast('กรุณากรอกหมวดงบประมาณ', 'error');
      try {
        const res = budget.id
          ? await API.put('/budgets/' + budget.id, data)
          : await API.post('/budgets', data);
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  async removeBudget(b) {
    const ok = await UI.confirm(`ต้องการลบหมวด "${b.category}" พร้อมรายการเดินบัญชีทั้งหมด ใช่หรือไม่?`, { danger: true, okText: 'ลบ' });
    if (!ok) return;
    try {
      const res = await API.del('/budgets/' + b.id);
      UI.toast(res.message);
      render();
    } catch (e) { UI.toast(e.message, 'error'); }
  },
};
