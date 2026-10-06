'use strict';
/* เมนู 1: ข้อมูลพื้นฐาน สพป.แพร่ เขต 2 */

const OfficeView = {
  async render(app) {
    const head = UI.h('div', { className: 'page-head' },
      UI.h('div', {},
        UI.h('div', { className: 'page-title' }, UI.h('span', { className: 'pi' }, '🏛️'), 'ข้อมูลพื้นฐาน สพป.แพร่ เขต 2'),
        UI.h('div', { className: 'page-desc' }, 'ประวัติ วิสัยทัศน์ โครงสร้างหน่วยงาน และข้อมูลการติดต่อ')),
      Auth.isAdmin() ? UI.h('button', { className: 'btn btn-primary', onclick: () => OfficeView.openEdit() }, '✏️ แก้ไขข้อมูล') : null,
    );
    app.append(head);
    const body = UI.h('div', { className: 'card' }, UI.loading());
    app.append(body);

    try {
      const data = await API.get('/office');
      body.innerHTML = '';
      if (!data.sections || data.sections.length === 0) {
        body.append(UI.empty('ยังไม่มีข้อมูล', '📭'));
        return;
      }
      for (const s of data.sections) {
        body.append(UI.h('div', { className: 'content-block' },
          UI.h('h3', {}, s.title),
          UI.h('div', { className: 'content-text' }, s.content || '-')));
      }
    } catch (e) {
      body.innerHTML = '';
      body.append(UI.empty(e.message, '⚠️'));
    }
  },

  async openEdit() {
    let sections = [];
    try {
      const data = await API.get('/office');
      sections = data.sections || [];
    } catch (e) { return UI.toast(e.message, 'error'); }

    const listBox = UI.h('div', { id: 'sec-list' });
    function renderList() {
      listBox.innerHTML = '';
      sections.forEach((s, i) => {
        const row = UI.h('div', { className: 'card', style: { padding: '14px', marginBottom: '12px' } },
          UI.h('div', { className: 'form-grid' },
            UI.h('div', { className: 'form-group full' },
              UI.h('label', {}, `หัวข้อที่ ${i + 1}`),
              UI.h('input', { id: `sec-title-${i}`, value: s.title || '', placeholder: 'ชื่อหัวข้อ เช่น ประวัติความเป็นมา' })),
            UI.h('div', { className: 'form-group full' },
              UI.h('label', {}, 'เนื้อหา'),
              UI.h('textarea', { id: `sec-content-${i}`, rows: '5', placeholder: 'รายละเอียดเนื้อหา' }, s.content || '')),
            UI.h('div', { className: 'form-actions', style: { marginTop: '0', gridColumn: '1 / -1', justifyContent: 'space-between' } },
              UI.h('span', {}),
              UI.h('button', { className: 'btn btn-danger btn-sm', onclick: () => { sections.splice(i, 1); renderList(); } }, '🗑️ ลบหัวข้อนี้')),
          ));
        row.querySelector(`#sec-title-${i}`).addEventListener('input', (e) => { s.title = e.target.value; });
        row.querySelector(`#sec-content-${i}`).addEventListener('input', (e) => { s.content = e.target.value; });
        listBox.append(row);
      });
    }
    renderList();

    const body = UI.h('div', {},
      UI.h('p', { className: 'hint', style: { marginBottom: '12px' } }, 'แก้ไขเนื้อหาข้อมูลพื้นฐานของหน่วยงาน (สมาชิกทั่วไปสามารถดูได้)'),
      listBox,
      UI.h('button', {
        className: 'btn btn-outline btn-sm',
        onclick: () => { sections.push({ key: 'c' + Date.now(), title: 'หัวข้อใหม่', content: '' }); renderList(); },
      }, '➕ เพิ่มหัวข้อ'),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '💾 บันทึกข้อมูล'));
    const m = UI.modal({ title: '✏️ แก้ไขข้อมูลพื้นฐานหน่วยงาน', body, footer: foot, size: 'lg' });

    async function save() {
      // อ่านค่าล่าสุดจาก inputs
      sections.forEach((s, i) => {
        const t = document.getElementById(`sec-title-${i}`);
        const c = document.getElementById(`sec-content-${i}`);
        if (t) s.title = t.value;
        if (c) s.content = c.value;
      });
      const valid = sections.filter((s) => s.title && String(s.title).trim());
      if (valid.length === 0) return UI.toast('กรุณาใส่หัวข้ออย่างน้อย 1 หัวข้อ', 'error');
      try {
        const res = await API.put('/office', { sections: valid });
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },
};
