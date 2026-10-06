'use strict';
/* เมนู 11: บริหารงานวิชาการ */

const AcademicsView = {
  async render(app) {
    const head = UI.h('div', { className: 'page-head' },
      UI.h('div', {},
        UI.h('div', { className: 'page-title' }, UI.h('span', { className: 'pi' }, '📚'), 'บริหารงานวิชาการ'),
        UI.h('div', { className: 'page-desc' }, 'โครงการและกิจกรรมทางวิชาการของหน่วยงาน')),
      Auth.isAdmin() ? UI.h('button', { className: 'btn btn-primary', onclick: () => AcademicsView.openForm() }, '+ เพิ่มโครงการ/กิจกรรม') : null,
    );
    app.append(head);

    const filterRow = UI.h('div', { className: 'filter-row' },
      UI.h('select', { id: 'ac-status', onchange: () => load() },
        UI.h('option', { value: '' }, 'ทุกสถานะ'),
        UI.h('option', { value: 'planned' }, 'วางแผน'),
        UI.h('option', { value: 'ongoing' }, 'ดำเนินการ'),
        UI.h('option', { value: 'done' }, 'เสร็จสิ้น')),
    );
    app.append(filterRow);
    const card = UI.h('div', { className: 'card' }, UI.loading());
    app.append(card);

    async function load() {
      const status = document.getElementById('ac-status').value;
      const url = '/academic' + (status ? '?status=' + encodeURIComponent(status) : '');
      try {
        const data = await API.get(url);
        card.innerHTML = '';
        card.append(UI.h('div', { className: 'card-title' }, `▭ โครงการ/กิจกรรม (${data.projects.length} รายการ)`));
        if (!data.projects.length) {
          card.append(UI.empty('ยังไม่มีโครงการ/กิจกรรม', '📚'));
          return;
        }
        const cols = [
          {
            key: 'kind', label: 'ประเภท', render: (p) =>
              UI.h('span', { className: 'status-pill', style: p.kind === 'project'
                ? { background: '#ede9fe', color: '#6d28d9', padding: '3px 10px', borderRadius: '999px', fontWeight: 700, fontSize: '12.5px' }
                : { background: '#cffafe', color: '#0e7490', padding: '3px 10px', borderRadius: '999px', fontWeight: 700, fontSize: '12.5px' } },
                p.kind === 'project' ? '▭ โครงการ' : '🎯 กิจกรรม') },
          { key: 'name', label: 'ชื่อโครงการ/กิจกรรม' },
          { key: 'date', label: 'ช่วงเวลา', render: (p) => (p.date_from ? `${UI.date(p.date_from)}${p.date_to ? ' ถึง ' + UI.date(p.date_to) : ''}` : '-') },
          { key: 'responsible', label: 'ผู้รับผิดชอบ' },
          { key: 'budget', label: 'งบประมาณ', className: 'num', render: (p) => UI.money(p.budget) + ' บาท' },
          { key: 'status', label: 'สถานะ', render: (p) => UI.badge(p.status) },
          Auth.isAdmin() ? {
            key: 'actions', label: '',
            render: (p) => UI.h('div', { className: 'status-btns' },
              UI.actionBtn('👁️', () => AcademicsView.openView(p)),
              UI.actionBtn('✎', () => AcademicsView.openForm(p)),
              UI.actionBtn('✕', () => AcademicsView.remove(p), 'danger-btn')),
          } : null,
        ].filter(Boolean);
        card.append(UI.table(cols, data.projects));
      } catch (e) {
        card.innerHTML = '';
        card.append(UI.empty(e.message, '⚠️'));
      }
    }
    load();
  },

  openView(p) {
    const body = UI.h('div', { className: 'form-grid' },
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ประเภท'), UI.h('div', {}, p.kind === 'project' ? '▭ โครงการ' : '🎯 กิจกรรม')),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'สถานะ'), UI.h('div', {}, UI.badge(p.status))),
      UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'ชื่อโครงการ/กิจกรรม'), UI.h('div', {}, p.name)),
      UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'รายละเอียด'), UI.h('div', { style: { whiteSpace: 'pre-wrap' } }, p.detail || '-')),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ช่วงเวลา'), UI.h('div', {}, p.date_from ? `${UI.thaiDate(p.date_from)} ถึง ${UI.thaiDate(p.date_to)}` : '-')),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ผู้รับผิดชอบ'), UI.h('div', {}, p.responsible || '-')),
      UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'งบประมาณ'), UI.h('div', {}, UI.moneyB(p.budget))),
      UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'ผลการดำเนินงาน'), UI.h('div', { style: { whiteSpace: 'pre-wrap' } }, p.result || '-')),
    );
    UI.modal({ title: '👁️ รายละเอียดโครงการ/กิจกรรม', body, size: 'lg' });
  },

  openForm(proj) {
    const p = proj || {};
    const body = UI.h('div', { className: 'form-grid' },
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ประเภท'),
        UI.h('select', { id: 'af-kind' },
          UI.h('option', { value: 'project', selected: p.kind !== 'activity' }, '▭ โครงการ'),
          UI.h('option', { value: 'activity', selected: p.kind === 'activity' }, '🎯 กิจกรรม'))),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'สถานะ'),
        UI.h('select', { id: 'af-status' },
          UI.h('option', { value: 'planned', selected: p.status !== 'ongoing' && p.status !== 'done' }, 'วางแผน'),
          UI.h('option', { value: 'ongoing', selected: p.status === 'ongoing' }, 'ดำเนินการ'),
          UI.h('option', { value: 'done', selected: p.status === 'done' }, 'เสร็จสิ้น'))),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'ชื่อโครงการ/กิจกรรม', UI.h('span', { className: 'req' }, ' *')),
        UI.h('input', { id: 'af-name', value: p.name || '', placeholder: 'เช่น โครงการยกระดับผลสัมฤทธิ์ทางการเรียน' })),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'รายละเอียด'),
        UI.h('textarea', { id: 'af-detail', rows: '3' }, p.detail || '')),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'วันเริ่ม'),
        UI.thaiDatePicker('af-from', { value: p.date_from || '' })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'วันสิ้นสุด'),
        UI.thaiDatePicker('af-to', { value: p.date_to || '' })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ผู้รับผิดชอบ'),
        UI.h('input', { id: 'af-resp', value: p.responsible || '', placeholder: 'เช่น กลุ่มนิเทศ ติดตามฯ' })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'งบประมาณ (บาท)'),
        UI.h('input', { id: 'af-budget', type: 'number', min: '0', step: '0.01', value: p.budget || 0 })),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'ผลการดำเนินงาน'),
        UI.h('textarea', { id: 'af-result', rows: '3' }, p.result || '')),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '▽ บันทึก'));
    const m = UI.modal({ title: p.id ? '✎ แก้ไขโครงการ/กิจกรรม' : '+ เพิ่มโครงการ/กิจกรรม', body, footer: foot, size: 'lg' });

    async function save() {
      const data = {
        name: document.getElementById('af-name').value.trim(),
        kind: document.getElementById('af-kind').value,
        detail: document.getElementById('af-detail').value.trim(),
        date_from: UI.readThaiDateInput('af-from'),
        date_to: UI.readThaiDateInput('af-to'),
        responsible: document.getElementById('af-resp').value.trim(),
        budget: parseFloat(document.getElementById('af-budget').value) || 0,
        status: document.getElementById('af-status').value,
        result: document.getElementById('af-result').value.trim(),
      };
      if (!data.name) return UI.toast('กรุณากรอกชื่อโครงการ/กิจกรรม', 'error');
      try {
        const res = p.id
          ? await API.put('/academic/' + p.id, data)
          : await API.post('/academic', data);
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  async remove(p) {
    const ok = await UI.confirm(`ต้องการลบ "${p.name}" ใช่หรือไม่?`, { danger: true, okText: 'ลบ' });
    if (!ok) return;
    try {
      const res = await API.del('/academic/' + p.id);
      UI.toast(res.message);
      render();
    } catch (e) { UI.toast(e.message, 'error'); }
  },
};
