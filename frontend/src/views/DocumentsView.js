/**
 * เมนู 3: หนังสือราชการ — ฟอร์มที่สร้าง PDF
 *
 * port จาก public/js/views/documents.js ของระบบเดิมด้วย scripts/port-frontend.mjs
 * (แปลงแบบสคริปต์ ไม่ได้พิมพ์ใหม่ → ข้อความไทย/class/markup ตรงต้นฉบับทุกตัวอักษร)
 *
 * ไฟล์นี้เหลือเฉพาะ 2 ฟอร์มที่สร้าง PDF ด้วย PDFLib แล้วเปิดหน้าต่างพิมพ์
 * ส่วนที่เหลือ (ตารางทะเบียน · รายละเอียด · แบบฟอร์ม A4 · ตัวปั้มตรา · ฟอร์มลงทะเบียน
 * · ดาวน์โหลด Excel · ตั้งเจ้าหน้าที่ · กำหนดเลขหนังสือสถานศึกษา) ย้ายเป็น Vue แล้ว
 * ดู src/pages/DocumentsPage.vue และ src/components/documents/
 *
 * เหลือเพราะสองฟอร์มนี้ต้องฝังรูปและลายเซ็นลง PDF ผ่าน PDFLib
 * แล้วเขียนเอกสารลงหน้าต่างที่เปิดใหม่ ซึ่ง Vue SFC ไม่ได้ช่วยอะไร
 */
import { UI } from '../ui/ui.js';
import api from '../api/client.js';
import { Auth } from '../stores/auth.js';
import { CONSTANTS } from '../constants/index.js';
import * as PDFLib from 'pdf-lib';

export const DocumentsView = {
  async openSendForm(senderType) {
    const isSchool = senderType === 'school' || senderType === 'school_to_school';
    const isSchoolToSchool = senderType === 'school_to_school';
    const title = isSchoolToSchool ? '▲ ส่งหนังสือไปสถานศึกษาในสังกัด' : (isSchool ? '▲ ส่งหนังสือไป สพป.แพร่ เขต 2' : '▲ ส่งหนังสือไปสถานศึกษา');
    const u = Auth.user || {};
    // สถานศึกษาที่ใช้ = สถานศึกษาที่เลือกตอนลงชื่อเข้า (current_school) ไม่ใช่สถานศึกษาหลักในโปรไฟล์
    const activeSchool = (u.user_group === 'school') ? (u.current_school || u.workplace || '') : (u.workplace || '');
    const fromText = isSchool ? activeSchool : ((u.title || '') + ' ' + (u.full_name || '') + ' ' + (u.workplace || ''));
    let allSchools = [], allStaff = [], officeStaff = [];
    try { const d = await api.get('/schools'); allSchools = (d.schools || []).sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'th', { numeric: true })); } catch (_e) {}
    try { const d = await api.get('/staff'); allStaff = d.users || d.staff || []; } catch (_e) {}
    try { const d = await api.get('/document-staff'); officeStaff = (d.officeStaff || []); } catch (_e) {}
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
        const res = await api.postForm('/documents', fd);
        UI.toast(res.message);
        m.close();
        window.__P2_RERENDER__();
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
    try { const d = await api.get('/office-staff'); officeStaffList = d.staff || []; } catch (_e) {}
    try { const d = await api.get('/schools'); allSchools = (d.schools || []).sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'th', { numeric: true })); } catch (_e) {}

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
        const res = await api.postForm('/documents', fd);
        UI.toast(res.message);
        m.close();
        window.__P2_RERENDER__();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  }
};
