/**
 * ตัวกรองดาวน์โหลด Excel (ปี พ.ศ. / เดือน / สัปดาห์) — ใช้ร่วมกันโดย VehiclesView + RoomsView
 *
 * port จาก public/js/export-filter.js ด้วยการแปลงแบบสคริปต์ (ตรงต้นฉบับทุกตัวอักษร)
 *   เปลี่ยนแค่: export + แก้การปิด modal ให้เข้าผ่าน UI.closeTopModal() แทนการล้าง DOM ตรง ๆ
 */
import { UI } from './ui.js';
/* ตัวกรองดาวน์โหลด Excel (ปี พ.ศ. / เดือน / สัปดาห์) — ใช้ร่วมกันโดย VehiclesView + RoomsView
 * options = { years: [2569, 2568, ...], title: 'จองยานพาหนะ',
 *             getRows: async (yearBE, month, weekStart, weekEnd) => ({ rows, headers, fileName }) } */

export const ExportFilterDialog = {
  TH_MONTHS: ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'],
  TH_M_ABBR: ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'],
  pad: (n) => (n < 10 ? '0' : '') + n,

  open(options) {
    const { years, title, getRows } = options;
    const yearSel = UI.h('select', { style: { minWidth: '170px' } });
    yearSel.append(UI.h('option', { value: '' }, 'ทุกปี (พ.ศ.)'));
    (years && years.length ? years : [new Date().getFullYear() + 543]).forEach((y) => yearSel.append(UI.h('option', { value: String(y) }, 'ปี พ.ศ. ' + y)));
    yearSel.value = String(years[0]);

    const monthSel = UI.h('select', { style: { minWidth: '160px' }, onchange: () => fillWeeks() });
    monthSel.append(UI.h('option', { value: '' }, 'ทุกเดือน'));
    for (let m = 0; m < 12; m++) monthSel.append(UI.h('option', { value: String(m + 1) }, this.TH_MONTHS[m]));

    const weekSel = UI.h('select', { style: { minWidth: '230px' }, disabled: true });
    weekSel.append(UI.h('option', { value: '' }, 'ทุกสัปดาห์'));

    // สัปดาห์ของเดือนที่เลือก (ยึดวันจันทร์ - อาทิตย์) — เลือกเดือนก่อนจึงเปิดให้เลือก
    const self = this;
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
        const fmt = (x) => x.getDate() + ' ' + self.TH_M_ABBR[x.getMonth()];
        weekSel.append(UI.h('option', { value: self.pad(s.getFullYear()) + '-' + self.pad(s.getMonth() + 1) + '-' + self.pad(s.getDate()) + '|' + self.pad(e.getFullYear()) + '-' + self.pad(e.getMonth() + 1) + '-' + self.pad(e.getDate()) }, `สัปดาห์ที่ ${n} (${fmt(s)} - ${fmt(e)} ${s.getFullYear() + 543})`));
        start.setDate(start.getDate() + 7); n++;
      }
    }

    const rowOf = (label, sel) => UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
      UI.h('div', { style: { width: '90px', fontWeight: 600, fontSize: '13.5px', color: '#334155' } }, label), sel);
    const body = UI.h('div', { style: { padding: '4px 2px' } },
      UI.h('div', { style: { marginBottom: '12px', fontWeight: 700, fontSize: '13.5px', color: '#0f766e' } }, `หน้า: ${title}`),
      UI.h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        rowOf('ปี พ.ศ.', yearSel),
        rowOf('เดือน', monthSel),
        rowOf('สัปดาห์', weekSel),
        UI.h('div', { className: 'hint', style: { marginTop: '4px' } }, 'เลือกได้ทั้ง 3 ช่องหรือเฉพาะบางช่อง — เว้นไว้หมด = ดาวน์โหลดทุกรายการ')));

    async function doExport() {
      const yBE = parseInt(yearSel.value, 10) || 0;
      const m = parseInt(monthSel.value, 10) || 0;
      const wk = (weekSel.value || '').split('|');
      const wkLabel = wk.length === 2 && wk[0] && weekSel.options[weekSel.selectedIndex] ? weekSel.options[weekSel.selectedIndex].textContent : '';
      try {
        UI.toast('กำลังเตรียมข้อมูล...', 'success', 1500);
        const out = await getRows(yBE, m, wk.length === 2 ? wk[0] : '', wk.length === 2 ? wk[1] : '');
        if (!out) return; // getRows จัดการ error เอง
        const filt = [];
        if (yBE) filt.push('ปี ' + yBE);
        if (m) filt.push(self.TH_MONTHS[m - 1]);
        if (wkLabel) filt.push(wkLabel);
        const fname = (out.fileName + (filt.length ? '_' + filt.join('_') : '')).replace(/[\\/:*?"<>|]/g, '');
        UI.exportExcel(fname, out.fileName + (filt.length ? ' (' + filt.join(' | ') + ')' : ''), out.headers, out.rows);
        modal.close();
        UI.toast(`ดาวน์โหลดแล้ว ${out.rows.length} รายการ`, 'success');
      } catch (e) { UI.toast(e.message, 'error'); }
    }

    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => UI.closeTopModal() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', style: { background: '#059669' }, onclick: doExport }, '⬇ ดาวน์โหลด Excel'));
    const modal = UI.modal({ title: '⬇ ดาวน์โหลดข้อมูล', body, footer: foot, size: 'md' });
    fillWeeks();
  },

  /** กรองแถวตามปี พ.ศ. / เดือน / ช่วงสัปดาห์ จากฟิลด์วันที่ (YYYY-MM-DD) */
  filterRows(rows, dateKey, yBE, month, wkStart, wkEnd) {
    return rows.filter((r) => {
      const d = r[dateKey];
      if (!d) return !yBE && !month && !wkStart; // ไม่มีวันที่ → เฉพาะเมื่อไม่กรองอะไรเลย
      if (yBE && (parseInt(String(d).slice(0, 4), 10) + 543) !== yBE) return false;
      if (month && parseInt(String(d).slice(5, 7), 10) !== month) return false;
      if (wkStart && (String(d) < wkStart || String(d) > wkEnd)) return false;
      return true;
    });
  },

  /** ปุ่ม ⬇ ดาวน์โหลดข้อมูล (ชิดขวาใน toolbar) */
  toolbarBtn(onclick) {
    return UI.h('button', { className: 'btn btn-primary', style: { background: '#059669', marginLeft: 'auto' }, title: 'ดาวน์โหลดข้อมูลเป็นไฟล์ Excel ตามตัวกรอง', onclick }, '⬇ ดาวน์โหลดข้อมูล');
  },
};
