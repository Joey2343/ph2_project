'use strict';
/* Helpers สำหรับสร้าง UI: elements, modal, toast, format ต่าง ๆ */

const UI = {
  /** encode file path สำหรับ URL — รักษา / ไว้ (รองรับ subfolder เช่น staff/filename.png) */
  encodePath(p) { return p ? p.split('/').map(encodeURIComponent).join('/') : ''; },
  /** สร้าง element: h('div', {className:'x', onclick: fn}, ...children) */
  h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'className') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'style') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat(10)) {
      if (c === undefined || c === null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  },

  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[m]));
  },

  /**
   * ส่งออกตารางเป็นไฟล์ Excel (.xls — เปิดใน Excel ได้ทันที ไม่ต้องใช้ไลบรารี)
   * @param {string} filename ชื่อไฟล์ (ไม่ต้องมีนามสกุล)
   * @param {string} sheetTitle หัวชีต
   * @param {Array<string>} headers ชื่อคอลัมน์
   * @param {Array<Array<string|number>>} dataRows แถวข้อมูล
   */
  exportExcel(filename, sheetTitle, headers, dataRows) {
    const th = headers.map((h) => `<th style="background:#0f766e;color:#fff;font-weight:700;padding:6px 10px;border:1px solid #94a3b8;">${UI.esc(h)}</th>`).join('');
    const trs = dataRows.map((row) => '<tr>' + row.map((c) => {
      const isNum = typeof c === 'number';
      return `<td style="border:1px solid #cbd5e1;padding:5px 10px;${isNum ? 'text-align:center;mso-number-format:"0";' : ''}">${UI.esc(c)}</td>`;
    }).join('') + '</tr>').join('\n');
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>${UI.esc(sheetTitle).slice(0, 30)}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body>
<table><thead><tr><th colspan="${headers.length}" style="font-size:15px;font-weight:700;padding:8px;border:none;">${UI.esc(sheetTitle)}</th></tr><tr>${th}</tr></thead><tbody>${trs}</tbody></table>
</body></html>`;
    const blob = new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename + '.xls';
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  },

  toast(msg, type = 'success', duration = 3500) {
    const root = document.getElementById('toast-root');
    const icons = { success: '✅', error: '⛔', warning: '⚠️' };
    const t = UI.h('div', { className: `toast ${type}` },
      UI.h('span', {}, icons[type] || 'ℹ️'),
      UI.h('span', {}, msg));
    root.append(t);
    setTimeout(() => {
      t.style.transition = 'opacity .3s, transform .3s';
      t.style.opacity = '0';
      t.style.transform = 'translateX(30px)';
      setTimeout(() => t.remove(), 320);
    }, duration);
  },

  /** เปิด modal. คืน { close, bodyEl, footEl } */
  modal({ title, body, footer, size, headClass, stack }) {
    // stack: true → เปิดเป็นเลเยอร์ซ้อนทับ modal เดิม (ไม่ทำ modal ที่เปิดอยู่หาย) เช่น ตัวอย่างพิมพ์จากฟอร์มแก้ไข
    let root = document.getElementById(stack ? 'modal-root-stacked' : 'modal-root');
    if (stack && !root) {
      root = UI.h('div', { id: 'modal-root-stacked' });
      document.body.append(root);
    }
    root.innerHTML = '';
    const modal = UI.h('div', { className: 'modal' + (size === 'lg' ? ' lg' : size === 'xxl' ? ' xxl' : size === 'full' ? ' full' : '') },
      UI.h('div', { className: 'modal-head' + (headClass ? ' ' + headClass : '') },
        UI.h('div', { className: 'modal-title' }, title),
        UI.h('button', { className: 'modal-close', 'aria-label': 'ปิด', onclick: close }, '✕')),
      UI.h('div', { className: 'modal-body' }));
    const bodyEl = modal.querySelector('.modal-body');
    if (body !== undefined) bodyEl.append(body);
    let footEl = null;
    if (footer !== undefined) {
      footEl = UI.h('div', { className: 'modal-foot' });
      footEl.append(footer);
      modal.append(footEl);
    }
    // คลิกนอกหน้าต่าง (พื้นหลัง) จะไม่ปิดหน้าต่าง — ต้องกดปิด/ยกเลิก/บันทึก หรือทำรายการให้เสร็จเท่านั้น
    const backdrop = UI.h('div', { className: 'modal-backdrop' }, modal);
    root.append(backdrop);

    function close() {
      root.innerHTML = '';
      // ถ้ายังมี modal หลักเปิดอยู่ (โหมด stack) คงล็อกสกอลล์ไว้
      const mainRoot = document.getElementById('modal-root');
      document.body.style.overflow = (stack && mainRoot && mainRoot.children.length) ? 'hidden' : '';
    }
    document.body.style.overflow = 'hidden';
    return { close, bodyEl, footEl, root };
  },

  /** กล่องยืนยัน คืน Promise<boolean> */
  confirm(message, { okText = 'ยืนยัน', danger = false, body: extraBody, size, onConfirm } = {}) {
    return new Promise((resolve) => {
      const foot = UI.h('div', {},
        UI.h('button', { className: 'btn btn-outline', onclick: () => { m.close(); resolve(false); } }, 'ยกเลิก'),
        UI.h('button', {
          className: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'),
          onclick: () => { const data = onConfirm ? onConfirm() : undefined; m.close(); resolve(data !== undefined ? data : true); },
        }, okText));
      const bodyContent = UI.h('div', { style: { fontSize: '15px' } }, message);
      if (extraBody) bodyContent.append(extraBody);
      const m = UI.modal({
        title: 'ยืนยันการดำเนินการ',
        body: bodyContent,
        footer: foot,
        size: size,
      });
    });
  },

  badge(status) {
    const labels = {
      pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ', returned: 'ส่งกลับเพื่อแก้ไข', cancelled: 'ยกเลิก',
      active: 'ใช้งาน', inactive: 'ระงับ', rejected_user: 'ปฏิเสธ',
      draft: 'ฉบับร่าง', submitted: 'ส่งแล้ว', planned: 'วางแผน', ongoing: 'ดำเนินการ', done: 'เสร็จสิ้น',
      available: 'พร้อมใช้', maintenance: 'ซ่อมบำรุง', income: 'รายรับ', expense: 'รายจ่าย',
    };
    let cls = status;
    if (status === 'rejected' || status === 'cancelled' || status === 'returned') cls = 'rejected';
    if (status === 'inactive' || status === 'draft') cls = 'inactive';
    if (status === 'planned') cls = 'submitted';
    return UI.h('span', { className: `badge badge-${cls === 'active' ? 'active' : cls}` }, labels[status] || status);
  },

  statusPill(status) {
    const map = {
      pending: ['รออนุมัติ', 'status-pill', 'background:#fef3c7;color:#b45309'],
      approved: ['อนุมัติแล้ว', 'status-pill', 'background:#dcfce7;color:#15803d'],
      rejected: ['ไม่อนุมัติ', 'status-pill', 'background:#fee2e2;color:#b91c1c'],
      cancelled: ['ยกเลิก', 'status-pill', 'background:#f1f5f9;color:#64748b'],
      active: ['ใช้งาน', 'status-pill', 'background:#dcfce7;color:#15803d'],
      inactive: ['ระงับ', 'status-pill', 'background:#f1f5f9;color:#64748b'],
      draft: ['ฉบับร่าง', 'status-pill', 'background:#f1f5f9;color:#64748b'],
      submitted: ['ส่งแล้ว', 'status-pill', 'background:#dbeafe;color:#1d4ed8'],
      planned: ['วางแผน', 'status-pill', 'background:#dbeafe;color:#1d4ed8'],
      ongoing: ['ดำเนินการ', 'status-pill', 'background:#fef3c7;color:#b45309'],
      done: ['เสร็จสิ้น', 'status-pill', 'background:#dcfce7;color:#15803d'],
      available: ['พร้อมใช้', 'status-pill', 'background:#dcfce7;color:#15803d'],
      maintenance: ['ซ่อมบำรุง', 'status-pill', 'background:#fef3c7;color:#b45309'],
    };
    const [label, cls, style] = map[status] || [status, 'status-pill', 'background:#f1f5f9;color:#64748b'];
    return UI.h('span', { className: cls, style: { background: style.match(/background:([^;]+)/)[1], color: style.match(/color:([^;]+)/)[1], padding: '3px 10px', borderRadius: '999px', fontSize: '12.5px', fontWeight: 700 } }, label);
  },

  empty(text, icon = '🗂️') {
    return UI.h('div', { className: 'empty-state' },
      UI.h('span', { className: 'em' }, icon), text);
  },

  loading(text = 'กำลังโหลดข้อมูล...') {
    return UI.h('div', { className: 'center-load' },
      UI.h('span', { className: 'spin' }), text);
  },

  /** สร้างตาราง. cols = [{label, render(row), className, key}] */
  table(cols, rows, opts = {}) {
    const wrap = UI.h('div', { className: 'table-wrap' });
    if (!rows || rows.length === 0) {
      wrap.append(UI.empty(opts.emptyText || 'ไม่มีข้อมูลในขณะนี้'));
      return wrap;
    }
    const thead = UI.h('thead', {},
      UI.h('tr', {}, cols.map((c) => UI.h('th', { className: c.className || '' }, c.label))));
    const tbody = UI.h('tbody', {}, rows.map((row, i) =>
      UI.h('tr', {},
        cols.map((c) => {
          const td = UI.h('td', { className: c.className || '' });
          const v = c.render ? c.render(row, i) : row[c.key];
          td.append(v === undefined || v === null ? '' : v);
          return td;
        }))));
    const tbl = UI.h('table', { className: 'tbl' }, thead, tbody);
    wrap.append(tbl);
    return wrap;
  },

  money(n) {
    if (n == null || isNaN(Number(n))) return '0.00';
    return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },

  moneyB(n) {
    return UI.h('span', { className: 'money' }, UI.money(n) + ' บาท');
  },

  /** จัดรูปแบบชื่อบุคคล: คำนำหน้าชื่อ+ชื่อ ติดกัน แล้วเว้น 2 วรรค ตามด้วยนามสกุล เช่น นายสมชาย  ใจดี */
  personName(p) {
    if (!p) return '-';
    const title = p.title || '';
    let first = p.first_name || '';
    let last = p.last_name || '';
    if (!first && !last && p.full_name) {
      // fallback: แยกจาก full_name (token สุดท้ายเป็นนามสกุล)
      const parts = String(p.full_name).trim().split(/\s+/);
      if (parts.length > 1) { last = parts.pop(); first = parts.join(' '); }
      else first = parts[0] || '';
    }
    if (!first && !last) return String(p.full_name || '');
    return `${title}${first}  ${last}`.trim();
  },

  /** แสดงวันที่แบบสั้น: DD/MM/BBBB (ปี พ.ศ.) */
  date(d) {
    if (!d) return '-';
    const parts = String(d).slice(0, 10).split('-');
    if (parts.length !== 3) return String(d);
    return `${parts[2]}/${parts[1]}/${parseInt(parts[0], 10) + 543}`;
  },

  /** แสดงวันที่แบบเต็ม: 14 สิงหาคม 2569 (ปี พ.ศ.) */
  thaiDate(d) {
    if (!d) return '-';
    const parts = String(d).slice(0, 10).split('-');
    if (parts.length !== 3) return String(d);
    const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const y = (parseInt(parts[0], 10) + 543);
    return `${parseInt(parts[2], 10)} ${months[parseInt(parts[1], 10) - 1]} ${y}`;
  },

  /** แสดงวันที่แบบทางการเต็ม: วันอังคารที่ 11 เดือนสิงหาคม พ.ศ. 2569 */
  thaiFullDate(d) {
    if (!d) return '-';
    const parts = String(d).slice(0, 10).split('-');
    if (parts.length !== 3) return String(d);
    const days = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
    const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const y = parseInt(parts[0], 10);
    const dt = new Date(y, parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    if (isNaN(dt.getTime())) return String(d);
    return `วัน${days[dt.getDay()]}ที่ ${parseInt(parts[2], 10)} เดือน${months[parseInt(parts[1], 10) - 1]} พ.ศ. ${y + 543}`;
  },

  /** แปลงเดือน YYYY-MM เป็น พ.ศ. เช่น 2026-08 → สิงหาคม 2569 */
  thaiMonth(m) {
    if (!m) return '-';
    const p = String(m).slice(0, 7).split('-');
    if (p.length !== 2) return String(m);
    const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const mi = parseInt(p[1], 10);
    if (mi < 1 || mi > 12) return String(m);
    return `${months[mi - 1]} ${parseInt(p[0], 10) + 543}`;
  },

  /** แปลง ISO YYYY-MM-DD → DD/MM/BBBB (พ.ศ.) สำหรับแสดงในช่องกรอก */
  isoToBE(iso) {
    if (!iso) return '';
    const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    return `${parseInt(m[3], 10)}/${parseInt(m[2], 10)}/${parseInt(m[1], 10) + 543}`;
  },

  /** แปลง DD/MM/BBBB (พ.ศ.) → ISO YYYY-MM-DD — คืน '' ถ้าไม่ถูกต้อง */
  beToISO(dmy) {
    if (!dmy) return '';
    const m = String(dmy).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!m) return '';
    const dd = parseInt(m[1], 10), mm = parseInt(m[2], 10), be = parseInt(m[3], 10);
    const ce = be - 543;
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12 || ce < 1) return '';
    const dt = new Date(ce, mm - 1, dd);
    if (dt.getFullYear() !== ce || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return '';
    return `${ce}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  },

  /** สร้างช่องกรอกวันที่แบบไทย (DD/MM/BBBB) — ค่าเริ่มต้นรับ ISO */
  thaiDateInput(id, { value, onChange, min, placeholder = 'วว/ดด/ปปปป (พ.ศ.)' } = {}) {
    const inp = UI.h('input', {
      id, type: 'text', inputmode: 'numeric', placeholder,
      value: UI.isoToBE(value),
      autocomplete: 'off',
    });
    if (onChange) inp.addEventListener('change', onChange);
    if (min) inp.setAttribute('data-min', UI.isoToBE(min));
    return inp;
  },

  /** ปฏิทินไทย (พ.ศ.) — ช่องวันที่กดแล้วเปิดปฏิทินเลือกวัน (คืน wrapper div, input ข้างในมี id เดิม) */
  thaiDatePicker(id, { value, onChange, min } = {}) {
    const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const wrap = UI.h('div', { className: 'thai-date-picker' });
    const inp = UI.h('input', { id, type: 'text', readonly: true, autocomplete: 'off',
      placeholder: 'วว/ดด/ปปปป (พ.ศ.)', value: UI.isoToBE(value) });
    if (min) inp.setAttribute('data-min', UI.isoToBE(min));
    const pop = UI.h('div', { className: 'thai-cal-pop' });
    pop.style.display = 'none';
    wrap.append(inp, pop);

    let view = new Date();
    const curIso = UI.beToISO(String(inp.value || '').trim());
    if (curIso) view = new Date(curIso + 'T00:00:00');

    function render() {
      const y = view.getFullYear(), m = view.getMonth();
      pop.innerHTML = '';
      pop.append(UI.h('div', { className: 'cal-head' },
        UI.h('button', { type: 'button', className: 'btn btn-outline btn-sm', onclick: (e) => { e.stopPropagation(); view = new Date(y, m - 1, 1); render(); } }, '◀'),
        UI.h('div', { className: 'cal-title' }, `${months[m]} ${y + 543}`),
        UI.h('button', { type: 'button', className: 'btn btn-outline btn-sm', onclick: (e) => { e.stopPropagation(); view = new Date(y, m + 1, 1); render(); } }, '▶')));
      const grid = UI.h('div', { className: 'cal-grid cal-pick-grid' });
      ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'].forEach((w) =>
        grid.append(UI.h('div', { className: 'cal-weekday' }, w)));
      const startDow = (new Date(y, m, 1).getDay() + 6) % 7;
      for (let i = 0; i < startDow; i++) grid.append(UI.h('div', { className: 'cal-day cal-outside' }));
      const daysIn = new Date(y, m + 1, 0).getDate();
      const todayIso = UI.today();
      const minIso = UI.beToISO(min ? UI.isoToBE(min) : '');
      for (let d = 1; d <= daysIn; d++) {
        const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const disabled = !!minIso && iso < minIso;
        const cell = UI.h('div', {
          className: 'cal-day cal-pick-day' + (iso === todayIso ? ' cal-today' : '') + (disabled ? ' cal-disabled' : ''),
        }, UI.h('div', { className: 'cal-day-num' }, String(d).padStart(2, '0')));
        if (!disabled) {
          cell.onclick = (e) => {
            e.stopPropagation();
            inp.value = UI.isoToBE(iso);
            pop.style.display = 'none';
            if (onChange) onChange();
          };
        }
        grid.append(cell);
      }
      pop.append(grid);
    }

    inp.addEventListener('click', (e) => {
      e.stopPropagation();
      const showing = pop.style.display !== 'none';
      pop.style.display = showing ? 'none' : 'block';
      if (!showing) render();
    });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) pop.style.display = 'none'; });
    return wrap;
  },

  /** อ่านค่าวันที่จากช่องกรอกแบบไทย (DD/MM/BBBB) → ISO — คืน '' ถ้าไม่ครบ */
  readThaiDateInput(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    const v = String(el.value || '').trim();
    if (!v) return '';
    const iso = UI.beToISO(v);
    if (!iso) return '';
    // ตรวจ min ถ้ามี
    const mn = el.getAttribute('data-min');
    if (mn && iso < UI.beToISO(mn)) return '';
    return iso;
  },

  /** แปลงเดือน YYYY-MM → MM/BBBB (พ.ศ.) สำหรับแสดงในช่องกรอก */
  isoToBEMonth(ym) {
    if (!ym) return '';
    const m = String(ym).slice(0, 7).match(/^(\d{4})-(\d{2})$/);
    if (!m) return '';
    return `${parseInt(m[2], 10)}/${parseInt(m[1], 10) + 543}`;
  },

  /** แปลง MM/BBBB (พ.ศ.) → YYYY-MM — คืน '' ถ้าไม่ถูกต้อง */
  beMonthToISO(mm) {
    if (!mm) return '';
    const m = String(mm).trim().match(/^(\d{1,2})[/-](\d{4})$/);
    if (!m) return '';
    const mo = parseInt(m[1], 10), be = parseInt(m[2], 10);
    const ce = be - 543;
    if (mo < 1 || mo > 12 || ce < 1) return '';
    return `${ce}-${String(mo).padStart(2, '0')}`;
  },

  /** สร้างช่องกรอกเดือนแบบไทย (MM/BBBB) — ค่าเริ่มต้นรับ YYYY-MM */
  thaiMonthInput(id, { value, onChange, placeholder = 'ดด/ปปปป (พ.ศ.)' } = {}) {
    const inp = UI.h('input', {
      id, type: 'text', inputmode: 'numeric', placeholder,
      value: UI.isoToBEMonth(value),
      autocomplete: 'off',
    });
    if (onChange) inp.addEventListener('change', onChange);
    return inp;
  },

  /** อ่านค่าเดือนจากช่องกรอกแบบไทย (MM/BBBB) → YYYY-MM — คืน '' ถ้าไม่ครบ */
  readThaiMonthInput(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    return UI.beMonthToISO(String(el.value || '').trim());
  },

  /** ช่องกรอกปีแบบไทย (BBBB พ.ศ.) — ค่าเริ่มต้นรับ YYYY (ค.ศ.) */
  thaiYearInput(id, { value, onChange, placeholder = 'ปปปป (พ.ศ.)' } = {}) {
    const inp = UI.h('input', {
      id, type: 'text', inputmode: 'numeric', placeholder,
      value: value ? String(parseInt(String(value).slice(0, 4), 10) + 543) : '',
      autocomplete: 'off',
    });
    if (onChange) inp.addEventListener('change', onChange);
    return inp;
  },

  /** อ่านค่าปีจากช่องกรอกแบบไทย (BBBB) → YYYY (ค.ศ.) — คืน '' ถ้าไม่ถูกต้อง */
  readThaiYearInput(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    const m = String(el.value || '').trim().match(/^(\d{4})$/);
    if (!m) return '';
    const be = parseInt(m[1], 10);
    const ce = be - 543;
    if (ce < 1) return '';
    return String(ce);
  },

  today() {
    return new Date().toISOString().slice(0, 10);
  },

  nowTime() {
    return new Date().toTimeString().slice(0, 5);
  },

  time(t) {
    return t ? String(t).slice(0, 5) : '-';
  },

  /** ตรวจสอบเลขบัตรประชาชน 13 หลัก */
  citizenIdValid(id) {
    if (!/^\d{13}$/.test(id)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += parseInt(id[i], 10) * (13 - i);
    return ((11 - (sum % 11)) % 10) === parseInt(id[12], 10);
  },

  /** คำนวณอายุ (ปี) จากวันเกิด YYYY-MM-DD — คืน string ว่างถ้าไม่มี/ไม่ถูกต้อง */
  ageFromBirth(birth) {
    if (!birth) return '';
    const m = String(birth).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    const bd = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const now = new Date();
    if (isNaN(bd) || bd > now) return '';
    let age = now.getFullYear() - bd.getFullYear();
    const dm = now.getMonth() - bd.getMonth();
    if (dm < 0 || (dm === 0 && now.getDate() < bd.getDate())) age--;
    return age >= 0 ? String(age) : '';
  },

  /** สร้างช่องเลือก วัน/เดือน/ปี พ.ศ. (ไทย) — id prefix เช่น 'reg-birth' → reg-birth-day / -month / -year */
  thaiBirthPicker(prefix, value) {
    const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const now = new Date();
    const maxBE = now.getFullYear() + 543; // ปี พ.ศ. ปัจจุบัน
    const minBE = maxBE - 90;
    const sel = (name, opts) => UI.h('select', { id: prefix + '-' + name, className: 'birth-select' }, opts);
    const opt = (v, t) => UI.h('option', { value: v }, t);

    const day = sel('day', [opt('', 'วัน')].concat(Array.from({ length: 31 }, (_, i) => opt(String(i + 1), String(i + 1)))));
    const month = sel('month', [opt('', 'เดือน')].concat(months.map((m, i) => opt(String(i + 1), m))));
    const year = sel('year', [opt('', 'ปี พ.ศ.')].concat(
      Array.from({ length: maxBE - minBE + 1 }, (_, i) => {
        const be = maxBE - i;
        return opt(String(be), String(be));
      })));

    // ตั้งค่าจากค่าเดิม (YYYY-MM-DD)
    if (value) {
      const m = String(value).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) {
        day.value = String(parseInt(m[3], 10));
        month.value = String(parseInt(m[2], 10));
        year.value = String(parseInt(m[1], 10) + 543);
      }
    }
    return UI.h('div', { className: 'birth-row' }, day, month, year);
  },

  /** อ่านค่าวันเกิดจากช่องเลือก (เป็น YYYY-MM-DD) — คืน '' ถ้าไม่ครบ */
  readThaiBirth(prefix) {
    const d = document.getElementById(prefix + '-day');
    const m = document.getElementById(prefix + '-month');
    const y = document.getElementById(prefix + '-year');
    if (!d || !m || !y) return '';
    const day = d.value, month = m.value, be = y.value;
    if (!day || !month || !be) return '';
    const ce = parseInt(be, 10) - 543;
    if (ce < 1) return '';
    return `${ce}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  },

  /** form ไปเป็น object */
  formData(formEl) {
    const fd = new FormData(formEl);
    const out = {};
    for (const [k, v] of fd.entries()) out[k] = v;
    return out;
  },

  /** เรียกใช้เมื่อกด submit form: รวบรวม data แล้วส่ง callback */
  onSubmit(formEl, fn) {
    formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      fn(UI.formData(formEl), formEl);
    });
  },

  /** ปุ่มเล็กในตาราง */
  actionBtn(label, onclick, cls = '') {
    return UI.h('button', { className: `btn btn-xs btn-outline ${cls}`, onclick }, label);
  },

  /** รูปไฟล์หรือลิงก์ดาวน์โหลด */
  fileLink(filename, label) {
    if (!filename) return UI.h('span', { className: 'hint' }, '-');
    var files = [];
    try {
      if (filename.startsWith('[')) {
        files = JSON.parse(filename);
      } else {
        files = [filename];
      }
    } catch(e) {
      files = [filename];
    }
    if (files.length === 0) return UI.h('span', { className: 'hint' }, '-');
    var wrap = UI.h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } });
    files.forEach(function(f) {
      var isImg = /.(png|jpe?g|gif|webp)$/i.test(f);
      var name = f.split('/').pop();
      if (isImg) {
        wrap.append(UI.h('a', { href: '/uploads/' + encodeURIComponent(f), target: '_blank', title: name, style: { fontSize: '12px' } }, '🖼️ ' + name));
      } else {
        wrap.append(UI.h('a', { href: '/uploads/' + encodeURIComponent(f), target: '_blank', title: name, style: { fontSize: '12px' } }, '📎 ' + name));
      }
    });
    return wrap;
  },

  // ---- ระบบอนุมัติหลายขั้น ----
  APPROVAL_LEVELS: { 1: 'ขั้นต้น', 2: 'ขั้นอนุมัติ', 3: 'ขั้นอนุมัติ' },

  approvalLevelName(level) {
    return UI.APPROVAL_LEVELS[level] || `ขั้นที่ ${level}`;
  },

  /** จำนวนขั้นที่ดำเนินการแล้ว (รวมตรวจสอบ + อนุมัติ) */
  approvalDone(r) {
    const approvalsDone = (r.approvals && r.approvals.length) || (r.approval_level || 0);
    return approvalsDone;
  },

  /** ผู้ใช้ปัจจุบันสามารถอนุมัติขั้นถัดไปของรายการนี้ได้หรือไม่ */
  canApproveNext(r) {
    if (!Auth.isLoggedIn() || !r || r.status !== 'pending') return false;
    const u = Auth.user;
    if (u.role === 'admin') return true;
    if (!u.can_approve) return false;
    const levels = { group_head: [1], deputy: [2, 3], director: [3] }[u.role] || [];
    const next = UI.approvalDone(r) + 1;
    return levels.includes(next);
  },

  /** ผู้ใช้ปัจจุบันเป็นผู้มีสิทธิ์อนุมัติโดยรวม (admin หรือได้รับสิทธิ์) หรือไม่ */
  isApprover() {
    if (!Auth.isLoggedIn()) return false;
    if (Auth.isAdmin()) return true;
    return !!Auth.user.can_approve && !!{ group_head: 1, deputy: 2, director: 3 }[Auth.user.role];
  },

  /** ผู้ใช้ปัจจุบันมีสิทธิ์พิจารณา (อนุมัติ/ไม่อนุมัติ) รายการนี้หรือไม่ */
  canDecide(r) {
    if (!Auth.isLoggedIn() || !r || r.status !== 'pending') return false;
    return Auth.isAdmin() || (Auth.user.can_approve && !!{ group_head: 1, deputy: 2, director: 3 }[Auth.user.role]);
  },

  /** แสดงความคืบหน้าการอนุมัติ: อนุมัติ X/Y ขั้น */
  approvalPill(r) {
    const done = UI.approvalDone(r);
    const required = r.required_levels || 1;
    const color = done >= required ? 'background:#dcfce7;color:#15803d' : 'background:#fef3c7;color:#b45309';
    return UI.h('span', { style: { display: 'inline-block', background: color.match(/background:([^;]+)/)[1], color: color.match(/color:([^;]+)/)[1], padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 700, marginTop: '4px' } },
      done >= required ? `✅ อนุมัติครบ ${required} ขั้น` : `⏳ อนุมัติแล้ว ${done}/${required} ขั้น`);
  },

  /** ปุ่มอนุมัติ/ไม่อนุมัติตามสิทธิ์ของผู้ใช้ปัจจุบัน */
  approvalButtons(r, onApprove, onReject) {
    const btns = [];
    if (UI.canApproveNext(r)) {
      const next = UI.approvalDone(r) + 1;
      btns.push(UI.actionBtn(`✅ อนุมัติ${UI.approvalLevelName(next)}`, onApprove));
    }
    if (UI.canDecide(r)) {
      btns.push(UI.actionBtn('❌ ไม่อนุมัติ', onReject, 'danger-btn'));
    }
    return btns;
  },

  /** แสดงรายละเอียดผู้ที่อนุมัติแต่ละขั้น (levelNames เช่น {1:'อนุมัติขั้นต้น', 2:'อนุมัติขั้นสุดท้าย'}) */
  approvalDetail(r, levelNames, opts) {
    const inline = opts && opts.inline;
    const required = r.required_levels || 1;
    const done = UI.approvalDone(r);
    const name = (i) => (levelNames && levelNames[i]) || UI.approvalLevelName(i);
    const steps = [];
    const isLeave = r.leave_type && !levelNames;
    if (isLeave) {
      // ระดับ 1 ใน approval_data = ตรวจสอบ; แสดงเป็น "ตรวจสอบ" ไม่ใช่ "อนุมัติขั้นที่ 1"
      const reviewEntry = (r.approvals || []).find((x) => x.level === 1);
      steps.push({ i: 1, a: reviewEntry || null, label: 'ตรวจสอบ', isReview: true });
      for (let i = 2; i <= required; i++) {
        const a = (r.approvals || []).find((x) => x.level === i);
        steps.push({ i, a });
      }
    } else {
      for (let i = 1; i <= required; i++) {
        const a = (r.approvals || []).find((x) => x.level === i);
        steps.push({ i, a });
      }
    }
    if (inline) {
      // รวมทุกขั้นไว้ในแถวเดียว
      const chips = steps.map(({ i, a, isReview, label }, idx) => {
        const displayLabel = isReview ? (label || 'ตรวจสอบ') : name(i);
        const bg = a ? '#dcfce7' : (isReview && !a && r.status === 'pending' && !r.reviewed ? '#fef3c7' : (!a && i === done + 1 ? '#fef3c7' : '#f1f5f9'));
        const clr = a ? '#15803d' : (isReview && !a && r.status === 'pending' && !r.reviewed ? '#92400e' : (!a && i === done + 1 ? '#92400e' : '#64748b'));
        const chip = UI.h('span', { style: {
          display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderRadius: '999px',
          fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap',
          background: bg, color: clr,
        } },
          displayLabel,
          a ? `✅ ${a.name}` : (isReview && !a ? '— รอตรวจสอบ —' : '— รออนุมัติ —'));
        return UI.h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } },
          chip,
          idx < steps.length - 1 ? UI.h('span', { style: { color: '#94a3b8' } }, '→') : null);
      });
      return UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '8px' } }, chips);
    }
    const rows = steps.map(({ i, a, isReview, label }) => {
      const displayLabel = isReview ? (label || 'ตรวจสอบ') : name(i);
      const nextStep = done + 1;
      const isCurrentPending = r.status === 'pending' && i === nextStep;
      return UI.h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: '13px' } },
        UI.h('span', { style: { fontWeight: 600 } }, `${isCurrentPending ? '👉 ' : ''}${displayLabel}`),
        a
          ? UI.h('span', { style: { color: '#15803d' } }, `✅ ${a.name}${a.at ? ' (' + UI.date(a.at) + ')' : ''}`)
          : UI.h('span', { className: 'hint' }, isReview ? '— รอตรวจสอบ —' : '— รออนุมัติ —'));
    });
    return UI.h('div', { style: { marginTop: '8px' } }, rows);
  },
};
