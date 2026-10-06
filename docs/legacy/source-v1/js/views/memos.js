'use strict';
/* เมนู 6: บันทึกข้อความ */

const MemosView = {
  /** ชื่อขั้นในระบบบันทึกข้อความ (admin กำหนดลำดับขั้น) */
  LEVEL_NAMES: { 1: 'ขั้นที่ 1 (ผู้อนุมัติขั้นต้น)', 2: 'ขั้นที่ 2 (ขั้นกลาง)', 3: 'ขั้นที่ 3 (ขั้นสูง)' },

  async render(app) {
    // ขั้นที่ผู้ใช้ปัจจุบันได้รับมอบหมายให้อนุมัติบันทึกข้อความ (admin ได้ทุกขั้น)
    // รายบุคคล: คำนวณจากชุดผู้อนุมัติทั้งหมด (flat) — สิทธิ์รายบุคคลตรวจอีกทีต่อรายการที่ backend
    MemosView.myLevels = [];
    try {
      const d = await API.get('/memo/approvers');
      const ap = d.approvers || {};
      MemosView.myLevels = Auth.isAdmin() ? [1, 2, 3] : [1, 2, 3].filter((l) => (ap[l] || []).includes(Auth.user.id));
    } catch (e) { /* ignore */ }
    const head = UI.h('div', { className: 'page-head' },
      UI.h('div', {},
        UI.h('div', { className: 'page-title' }, UI.h('span', { className: 'pi' }, '✎'), 'บันทึกข้อความ'),
        UI.h('div', { className: 'page-desc' }, 'จัดทำและส่งบันทึกข้อความภายในหน่วยงาน')),
      Auth.isAdmin()
        ? UI.h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
          UI.h('button', { className: 'btn btn-primary', onclick: () => MemosView.openForm() }, '✎ เขียนบันทึกข้อความ'),
          UI.h('button', { className: 'btn btn-outline', onclick: () => MemosView.openApproversModal() }, '+ เพิ่มเจ้าหน้าที่ (ลำดับขั้น)'))
        : UI.h('button', { className: 'btn btn-primary', onclick: () => MemosView.openForm() }, '✎ เขียนบันทึกข้อความ'),
    );
    app.append(head);

    // ปุ่ม "บันทึกข้อความของฉัน" — กรองเฉพาะของตัวเอง
    let mineOnly = false;
    const mineBtn = UI.h('button', { className: 'btn btn-sm btn-outline', onclick: toggleMine },
      '✎ บันทึกข้อความของฉัน');
    async function toggleMine() {
      mineOnly = !mineOnly;
      mineBtn.className = 'btn btn-sm ' + (mineOnly ? 'btn-primary' : 'btn-outline');
      // ปุ่มสลับ: เมื่อกรองของฉันอยู่ ปุ่มจะเปลี่ยนเป็น "บันทึกข้อความทั้งหมด" (กดเพื่อกลับไปดูทั้งหมด)
      mineBtn.textContent = mineOnly ? '▭ บันทึกข้อความทั้งหมด' : '✎ บันทึกข้อความของฉัน';
      load();
    }
    const now = new Date(); const curYear = now.getFullYear() + 543;
    const yearSel = UI.h('select', { id: 'mem-year', onchange: () => load() },
      UI.h('option', { value: curYear }, curYear),
      UI.h('option', { value: curYear - 1 }, curYear - 1),
      UI.h('option', { value: '' }, 'ทุกปี'));
    const filterRow = UI.h('div', { className: 'filter-row' },
      UI.h('input', { id: 'mem-q', type: 'search', placeholder: '⊕ ค้นหาเรื่อง...', oninput: () => load() }),
      UI.h('select', { id: 'mem-status', onchange: () => load() },
        UI.h('option', { value: '' }, 'ทุกสถานะ'),
        UI.h('option', { value: 'draft' }, 'ฉบับร่าง'),
        UI.h('option', { value: 'submitted' }, 'ส่งแล้ว / รออนุมัติ'),
        UI.h('option', { value: 'approved' }, 'อนุมัติแล้ว'),
        UI.h('option', { value: 'rejected' }, 'ไม่อนุมัติ'),
        UI.h('option', { value: 'returned' }, '↻ ส่งกลับเพื่อแก้ไข'),
        UI.h('option', { value: 'myapprove' }, '◷ รอการอนุมัติของฉัน')),
      yearSel,
      mineBtn,
    );
    app.append(filterRow);
    const card = UI.h('div', { className: 'card' }, UI.loading());
    app.append(card);

    async function load() {
      const q = document.getElementById('mem-q').value.trim();
      const status = document.getElementById('mem-status').value;
      const year = document.getElementById('mem-year').value;
      let url = '/memos?';
      if (q) url += 'q=' + UI.encodePath(q) + '&';
      if (status) url += 'status=' + UI.encodePath(status) + '&';
      if (year) url += 'year=' + year + '&';
      if (mineOnly) url += 'mine=1';
      try {
        const data = await API.get(url);
        card.innerHTML = '';
        card.append(UI.h('div', { className: 'card-title' }, `▭ รายการบันทึกข้อความ (${data.memos.length} รายการ)`));
        if (!data.memos.length) {
          card.append(UI.empty('ยังไม่มีบันทึกข้อความ', '✎'));
          return;
        }
        const cols = [
          { key: 'doc_no', label: 'ที่', render: (r) => r.doc_no || UI.h('span', { className: 'hint' }, '-') },
          { key: 'title', label: 'เรื่อง' },
          { key: 'date', label: 'วันที่', render: (r) => UI.date(r.date) },
          { key: 'status', label: 'สถานะ', render: (r) => UI.badge(r.status) },
          { key: 'progress', label: 'ความคืบหน้า', render: (r) => (r.status === 'submitted' || r.status === 'approved' ? UI.approvalPill({ ...r, required_levels: MemosView.memoRequiredLevels(r) }) : UI.h('span', { className: 'hint' }, '-')) },
          { key: 'send_to', label: 'ส่งถึง', render: (r) => UI.h('span', { className: 'hint' }, MemosView.sendToNames(r.send_to) || '-') },
          { key: 'draft', label: 'ร่างหนังสือ', render: (r) => MemosView.draftFileLink(r) },
        ];
        // คอลัมน์ 'ร่างหนังสือ' อยู่หลัง 'ส่งถึง' เสมอ — ย้ายตำแหน่งให้ตรงกันแม้แทรกคอลัมน์ 'ผู้จัดทำ' (admin)
        if (Auth.isAdmin()) {
          const draftIdx = cols.findIndex((c) => c.key === 'draft');
          cols.splice(draftIdx, 0, { key: 'full_name', label: 'ผู้จัดทำ', render: (r) => UI.h('div', {}, UI.personName(MemosView.maker(r)), UI.h('div', { className: 'hint' }, r.username)) });
        }
        cols.push({
          key: 'actions', label: '',
          render: (r) => {
            const canEditRow = Auth.isAdmin() || r.user_id === Auth.user.id;
            const box = UI.h('div', { className: 'status-btns' },
              UI.actionBtn('👁️', () => MemosView.openView(r)),
              canEditRow ? UI.actionBtn('✎', () => MemosView.openForm(r)) : null,
              canEditRow ? UI.actionBtn('✕', () => MemosView.remove(r), 'danger-btn') : null);
            MemosView.decideButtons(r).forEach((b) => box.append(b));
            return box;
          },
        });
        card.append(UI.table(cols, data.memos));
        // แสดงสิ่งที่ให้แก้ไขสำหรับรายการที่ถูกส่งกลับ (ผู้จัดทำเห็นเพื่อแก้ไขตามคอมเม้น)
        for (const r of data.memos) {
          if (r.status === 'returned' && r.revision_note) {
            card.append(UI.h('div', { className: 'hint', style: { marginTop: '8px', color: '#b45309' } },
              `↻ รายการ ${r.doc_no || r.id}: สิ่งที่ให้แก้ไข — ${r.revision_note}`));
          }
        }
      } catch (e) {
        card.innerHTML = '';
        card.append(UI.empty(e.message, '⚠️'));
      }
    }
    load();
  },

  /** สร้างข้อมูลผู้จัดทำจากแถว memo (คำนำหน้าชื่อแยกเป็น maker_title) */
  maker(r) {
    return { title: r.maker_title, full_name: r.full_name, first_name: r.first_name, last_name: r.last_name };
  },

  /** แปลง JSON send_to → รายการชื่อ (คั่นด้วย ", ") */
  sendToNames(json) {
    try {
      const arr = JSON.parse(json || '[]');
      if (!Array.isArray(arr)) return '';
      return arr.map((p) => `${p.title || ''}${p.first_name || p.name || ''}  ${p.last_name || ''}`.trim()).join(', ');
    } catch (e) { return ''; }
  },

  /** ไอคอนร่างหนังสือส่ง (รูปเอกสารสีเหลืองอ่อน) — สร้างด้วย SVG namespace ตรง ๆ เพราะ UI.h สร้าง element ใน namespace HTML */
  draftIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', 17);
    svg.setAttribute('height', 21);
    svg.setAttribute('viewBox', '0 0 18 22');
    svg.setAttribute('aria-hidden', 'true');
    const body = document.createElementNS(NS, 'path');
    body.setAttribute('d', 'M1 1h10l6 6v14H1z');
    body.setAttribute('fill', '#FDE68A');
    body.setAttribute('stroke', '#D97706');
    body.setAttribute('stroke-width', '1.2');
    const fold = document.createElementNS(NS, 'path');
    fold.setAttribute('d', 'M11 1v6h6');
    fold.setAttribute('fill', '#FEF9C3');
    fold.setAttribute('stroke', '#D97706');
    fold.setAttribute('stroke-width', '1.2');
    svg.append(body, fold);
    return svg;
  },

  /** ส่วน "ที่แนบเอกสาร" — ไฟล์แนบทั้งหมด (อ้างถึง/สิ่งที่ส่งมาด้วย/ร่างหนังสือส่ง) เป็นลิงก์เปิดไฟล์ ไว้ส่วนบนของหน้าอนุมัติ */
  attachmentsSection(memo) {
    const parseFiles = (json) => {
      try {
        const d = JSON.parse(json || 'null');
        if (Array.isArray(d)) return d;
        if (d && d.file) return [d]; // รองรับ draft_file ที่เก็บเป็น object เดียว
      } catch (e) { /* ignore */ }
      return [];
    };
    const groups = [
      { label: 'อ้างถึง', json: memo.ref_files },
      { label: 'สิ่งที่ส่งมาด้วย', json: memo.enc_files },
      { label: 'ร่างหนังสือส่ง', json: memo.draft_file },
    ];
    const rows = [];
    for (const g of groups) {
      const files = parseFiles(g.json);
      if (!files.length) continue;
      rows.push(UI.h('div', { style: { marginTop: '4px' } },
        UI.h('span', { style: { fontWeight: 600 } }, `${g.label}: `),
        files.map((f) => UI.h('a', { href: '/uploads/' + UI.encodePath(f.file), target: '_blank', style: { marginRight: '10px' } }, `△ ${f.name || f.file}`))));
    }
    if (!rows.length) return null;
    return UI.h('div', { className: 'form-group full', style: { marginTop: '12px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '10px', padding: '12px' } },
      UI.h('label', {}, '△ ที่แนบเอกสาร'),
      ...rows);
  },

  /** ลิงก์ร่างหนังสือส่ง (ไฟล์ที่ผู้บันทึกแนบ) — รองรับทั้ง JSON array และ object เดียว */
  draftFileLink(memo) {
    let arr = null;
    try {
      const d = JSON.parse(memo.draft_file || 'null');
      if (Array.isArray(d)) arr = d;
      else if (d && d.file) arr = [d];
    } catch (e) { /* ignore */ }
    if (!arr || !arr.length) return UI.h('span', { className: 'hint' }, '-');
    return UI.h('div', { style: { display: 'flex', gap: '8px' } },
      arr.map((f) => UI.h('a', { href: '/uploads/' + UI.encodePath(f.file), target: '_blank', title: 'เปิดร่างหนังสือส่ง', className: 'memo-draft-link' }, MemosView.draftIcon())));
  },

  /** แสดงรายการไฟล์ (JSON array) เป็นลิงก์ดาวน์โหลดพร้อมชื่อ */
  fileList(json) {
    try {
      const arr = JSON.parse(json || '[]');
      if (!Array.isArray(arr) || !arr.length) return null;
      return UI.h('div', {}, arr.map((f) => UI.h('div', { style: { marginTop: '4px' } },
        UI.h('a', { href: '/uploads/' + UI.encodePath(f.file), target: '_blank' }, `△ ${f.name || f.file}`))));
    } catch (e) { return null; }
  },

  /** แบบฟอร์มข้อมูลทั้งหมดที่ผู้บันทึกเสนอมา — ใช้ในหน้าดู และหน้าต่างอนุมัติ (ให้ตรวจสอบก่อนส่งต่อขั้นถัดไป) */
  detailBody(memo) {
    const filesRow = (label, json) => {
      const list = MemosView.fileList(json);
      return list ? UI.h('div', { className: 'form-group full' }, UI.h('label', {}, label), list) : null;
    };
    return UI.h('div', {},
      UI.h('div', { style: { textAlign: 'center', marginBottom: '14px' } },
        UI.h('div', { className: 'hint' }, memo.doc_no ? `บันทึกข้อความ ที่ ${memo.doc_no}` : 'บันทึกข้อความ (ฉบับร่าง)'),
        UI.h('div', { style: { fontSize: '18px', fontWeight: 800, margin: '4px 0' } }, memo.title),
        UI.h('div', { className: 'hint' }, `ส่วนราชการ ${memo.office || '-'} • ${memo.urgency || 'ปกติ'} • วันที่ ${UI.thaiDate(memo.date)} • ผู้จัดทำ ${UI.personName(MemosView.maker(memo))}`)),
      UI.h('div', { className: 'form-grid' },
        UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'เรียน'), UI.h('div', {}, memo.to_text || 'ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2')),
        filesRow('△ อ้างถึง', memo.ref_files),
        filesRow('△ สิ่งที่ส่งมาด้วย', memo.enc_files),
        filesRow('△ ร่างหนังสือส่ง', memo.draft_file),
      ),
      UI.h('div', { className: 'card', style: { background: '#f8fafc', marginTop: '12px' } },
        UI.h('div', { className: 'card-title' }, '✎ บันทึกข้อความ'),
        UI.h('div', { style: { lineHeight: '1.7' }, html: memo.content || '-' })),
      UI.h('div', { className: 'form-grid', style: { marginTop: '12px' } },
        UI.h('div', { className: 'form-group full' },
          UI.h('label', {}, 'ความคืบหน้าการอนุมัติ'),
          UI.approvalDetail({ ...memo, approvals: memo.approvals || [], required_levels: MemosView.memoRequiredLevels(memo) }, MemosView.LEVEL_NAMES),
          MemosView.nextApproverLine(memo)),
        UI.h('div', { className: 'form-group full' }, UI.h('label', {}, 'ส่งบันทึกข้อความถึง'), UI.h('div', {}, MemosView.sendToNames(memo.send_to) || UI.h('span', { className: 'hint' }, '-'))),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'บันทึกโดย'), UI.h('div', {}, UI.personName(MemosView.maker(memo)))),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ตำแหน่ง'), UI.h('div', {}, memo.maker_position || '-')),
      ),
    );
  },

  openView(memo) {
    const foot = UI.h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end' } },
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ปิด'));
    // ปุ่มสร้างแบบฟอร์มบันทึกข้อความ (ตามฟอร์ม form_bunteugkokeam) — แสดงเมื่อมีเลขที่หนังสือแล้ว
    if (memo.doc_no) {
      foot.prepend(UI.h('button', { className: 'btn btn-primary', onclick: () => MemosView.showForm(memo) }, '⬢ พิมพ์'));
    }
    // ปุ่มแก้ไข — เฉพาะเจ้าของหรือ admin
    if (Auth.isAdmin() || memo.user_id === Auth.user.id) {
      foot.prepend(UI.h('button', { className: 'btn btn-primary', onclick: () => { m.close(); MemosView.openForm(memo); } }, '✎ แก้ไข'));
    }
    const m = UI.modal({ title: '👁️ ดูบันทึกข้อความ', body: MemosView.formDocument(memo), footer: foot, size: 'lg' });
  },

  /** แบบฟอร์มบันทึกข้อความ — สร้างตามฟอร์ม form_bunteugkokeam (เอกสารทางการ) */
  formDocument(memo) {
    const office = (memo.office || '').trim();
    const val = (text) => UI.h('span', {}, text || '');
    return UI.h('div', { className: 'doc memo-doc' },
      UI.h('div', { className: 'memo-doc-head' },
        UI.h('img', { className: 'memo-doc-emblem', src: '/form/krut.png', alt: '' }),
        UI.h('div', { className: 'memo-doc-title' }, 'บันทึกข้อความ')),
      // บรรทัดที่ 1: ส่วนราชการ (ดึงจากเขียนบันทึกข้อความ) สพป.แพร่ เขต 2
      UI.h('div', { className: 'memo-line' },
        UI.h('span', { className: 'memo-label' }, 'ส่วนราชการ '),
        val(`${office}${office && office !== 'สพป.แพร่ เขต 2' ? ' ' : ''}สพป.แพร่ เขต 2`)),
      // บรรทัดที่ 2: ที่ (ดึงจากเขียนบันทึกข้อความ) วันที่ (วันที่ เดือน พ.ศ. ที่เขียนบันทึกข้อความ)
      UI.h('div', { className: 'memo-line' },
        UI.h('span', { className: 'memo-label' }, 'ที่ '),
        val(memo.doc_no),
        UI.h('span', { className: 'memo-label', style: { marginLeft: '50px' } }, 'วันที่ '),
        val(UI.thaiDate(memo.date))),
      // บรรทัดที่ 3: เรื่อง (ดึงจากเขียนบันทึกข้อความ)
      UI.h('div', { className: 'memo-line' },
        UI.h('span', { className: 'memo-label' }, 'เรื่อง '),
        val(memo.title)),
      UI.h('div', { className: 'memo-line' },
        UI.h('span', { className: 'memo-label' }, 'เรียน '),
        val(memo.to_text || 'ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2')),
      // เส้นยาวเต็มบรรทัดใต้ เรียน
      UI.h('div', { className: 'memo-divider' }),
      UI.h('div', { className: 'memo-content', html: memo.content || '-' }),
      UI.h('div', { className: 'memo-sig' },
        // แถวบน: ผู้อนุมัติขั้นที่ 1 (ลายเซ็น/ชื่อ/ตำแหน่ง + ความเห็น) + ผู้บันทึก ถัดกัน บรรทัดล่างสุดตรงกัน
        UI.h('div', { className: 'memo-sig-row' },
          MemosView.sigColForLevel1(memo),
          MemosView.sigCol(memo.maker_signature, UI.personName(MemosView.maker(memo)), memo.maker_position || '-', null)),
        // แถวล่าง: ผู้อนุมัติขั้นที่ 2 + ขั้นที่ 3 (เมื่ออนุมัติแล้ว) — อยู่ด้านล่างผู้อนุมัติขั้นที่ 1
        UI.h('div', { className: 'memo-sig-row' },
          MemosView.sigColForLevel2(memo),
          MemosView.sigColForLevel3(memo)),
      ),
    );
  },

  /** คอลัมน์ลายเซ็นในแบบฟอร์ม (ลายเซ็น + ชื่อ + ตำแหน่ง [+ ความเห็นหลายบรรทัด]) — extraClass เพิ่มคลาสพิเศษได้ */
  sigCol(sig, name, pos, lines, extraClass) {
    const arr = Array.isArray(lines) ? lines : (lines ? [lines] : []);
    return UI.h('div', { className: 'memo-sig-col' + (extraClass ? ' ' + extraClass : '') },
      ...arr.map((t) => UI.h('div', { className: 'memo-sig-decide' }, t)),
      sig
        ? UI.h('img', { className: 'doc-sig', src: '/uploads/' + UI.encodePath(sig), alt: 'ลายเซ็น' })
        : UI.h('div', { className: 'doc-sig-empty' }, '(ยังไม่มีลายเซ็น)'),
      UI.h('div', { className: 'doc-sig-name' }, name),
      UI.h('div', { className: 'doc-sig-pos' }, pos || '-'));
  },

  /** คอลัมน์ลายเซ็นผู้อนุมัติขั้นที่ 1 (แสดงเมื่ออนุมัติขั้นต้นแล้ว) — ขยับมาข้างหน้า 7 เคาะ */
  sigColForLevel1(memo) {
    const lvl1 = (memo.approvals || []).find((a) => Number(a.level) === 1);
    if (!lvl1) return null;
    const lines = lvl1.decide ? [`☑ ${lvl1.decide}`] : [];
    return MemosView.sigCol(lvl1.signature, UI.personName(lvl1), lvl1.position || '-', lines, 'sig-approver');
  },

  /** คอลัมน์ลายเซ็นผู้อนุมัติขั้นที่ 2 — ผ่านเรื่อง: ความเห็นบนลายเซ็น + ความเห็นเพิ่มเติมด้านล่าง / ปฏิบัติราชการ: ตัวเลือกที่ติ๊ก + ความเห็น — ขยับมาข้างหน้า 7 เคาะ */
  sigColForLevel2(memo) {
    const lvl2 = (memo.approvals || []).find((a) => Number(a.level) === 2);
    if (!lvl2) return null;
    const lines = [];
    if (lvl2.mode === 'act') {
      if (Array.isArray(lvl2.act_choices) && lvl2.act_choices.length) lines.push(`☑ ${lvl2.act_choices.join(', ')}`);
    } else if (lvl2.decide) {
      lines.push(`☑ ${lvl2.decide}`);
    }
    if (lvl2.comment) lines.push(lvl2.comment);
    return MemosView.sigCol(lvl2.signature, UI.personName(lvl2), lvl2.position || '-', lines, 'sig-approver sig-pos-single');
  },

  /** คอลัมน์ลายเซ็นผู้อนุมัติขั้นที่ 3 (สุดท้าย) — บันทึกสั่งการ: ตัวเลือกที่ติ๊ก + ความเห็น */
  sigColForLevel3(memo) {
    const lvl3 = (memo.approvals || []).find((a) => Number(a.level) === 3);
    if (!lvl3) return null;
    const lines = [];
    if (Array.isArray(lvl3.act_choices) && lvl3.act_choices.length) lines.push(`☑ ${lvl3.act_choices.join(', ')}`);
    else if (lvl3.decide) lines.push(`☑ ${lvl3.decide}`);
    if (lvl3.comment) lines.push(lvl3.comment);
    return MemosView.sigCol(lvl3.signature, UI.personName(lvl3), lvl3.position || '-', lines, 'sig-pos-single');
  },

  /** แสดงการส่งต่อเฉพาะเจาะจง: เรียนเสนอ (ขั้นที่ 1 → 2) และ ผ่านเรื่อง/เสนอต่อ (ขั้นที่ 2 → 3) */
  nextApproverLine(memo) {
    const parts = [];
    const lvl1 = (memo.approvals || []).find((a) => Number(a.level) === 1);
    if (lvl1 && lvl1.next_approver_name) parts.push(`📨 เรียนเสนอ: ${lvl1.next_approver_name}`);
    const lvl2 = (memo.approvals || []).find((a) => Number(a.level) === 2);
    if (lvl2 && lvl2.mode === 'pass' && lvl2.next_approver_name) parts.push(`📨 ผ่านเรื่อง/เสนอต่อ: ${lvl2.next_approver_name}`);
    if (!parts.length) return null;
    return UI.h('div', { className: 'hint', style: { marginTop: '6px', color: '#0369a1', fontWeight: 600 } }, parts.join('  •  '));
  },

  /** แสดงแบบฟอร์มบันทึกข้อความในหน้าต่าง (พร้อมปุ่มพิมพ์) */
  showForm(memo) {
    const body = MemosView.formDocument(memo);
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ปิด'),
      UI.h('button', { className: 'btn btn-primary', onclick: () => MemosView.printDocument(body) }, '⬢ พิมพ์'));
    const m = UI.modal({ title: '▭ บันทึกข้อความ', body, footer: foot, size: 'lg' });
  },

  /** พิมพ์เอกสารบันทึกข้อความ (เปิดหน้าต่างใหม่) */
  printDocument(body) {
    const css = document.querySelector('link[href*="style.css"]');
    const styleTag = css ? `<link rel="stylesheet" href="${css.href}">` : '';
    const w = window.open('', '_blank', 'width=900,height=1200');
    if (!w) return UI.toast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต pop-up', 'error');
    w.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>บันทึกข้อความ</title>${styleTag}<style>body{background:#f0f2f5;padding:32px;margin:0}@media print{body{background:#fff;padding:0}}</style></head><body>${body.outerHTML}</body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 400);
  },

  /** จำนวนขั้นที่ต้องอนุมัติจริง — ถ้าขั้นที่ 2 ใช้ ปฏิบัติราชการ/รักษาราชการแทน (สิ้นสุดที่ขั้นที่ 2) ให้เท่ากับ 2 */
  memoRequiredLevels(memo) {
    const req = memo.required_levels || 1;
    const lvl2 = (memo.approvals || []).find((a) => Number(a.level) === 2);
    if (lvl2 && lvl2.mode === 'act') return 2;
    return req;
  },

  /** ปุ่มอนุมัติ/ไม่อนุมัติตามสิทธิ์ของผู้ใช้ปัจจุบัน (เฉพาะขั้นที่กำลังรอ) */
  decideButtons(r) {
    const btns = [];
    if (r.status === 'submitted' && (MemosView.myLevels || []).includes(UI.approvalDone(r) + 1)) {
      btns.push(UI.actionBtn('● อนุมัติ', () => MemosView.openDecide(r, 'approve')));
      btns.push(UI.actionBtn('✕ ไม่อนุมัติ', () => MemosView.openDecide(r, 'reject'), 'danger-btn'));
    }
    return btns;
  },

  /** หน้าต่างอนุมัติ/ไม่อนุมัติบันทึกข้อความ — แสดงแบบฟอร์มข้อมูลที่ผู้บันทึกเสนอมาให้อ่านตรวจสอบ + ความคืบหน้า + หมายเหตุ แล้วยืนยัน */
  async openDecide(memo, action) {
    const isApprove = action === 'approve';
    const required = memo.required_levels || 1;
    const next = UI.approvalDone(memo) + 1;
    // ขั้นที่ 1 (ผู้อนุมัติขั้นต้น): เลือกความเห็น + เลือกผู้อนุมัติขั้นที่ 2 (เรียนเสนอ) + ส่งกลับเพื่อแก้ไข
    const isFirst = next === 1;
    // ขั้นที่ 2: เลือก ผ่านเรื่อง (ส่งต่อขั้นที่ 3) หรือ ปฏิบัติราชการ/รักษาราชการแทน (สิ้นสุดที่ขั้นที่ 2)
    const isSecond = next === 2;
    // ขั้นที่ 3 (สุดท้าย): บันทึกสั่งการ — ติ๊กได้หลายช่อง (ทราบ/ลงนามแล้ว/อนุญาต/...) แล้วถือเป็นสิ้นสุดการพิจารณา
    const isThird = next === 3;
    // รายชื่อผู้อนุมัติขั้นที่ 2 ให้เลือกในส่วน เรียนเสนอ (จาก chain snapshot ณ เวลาส่ง หรือ config ปัจจุบัน)
    let nextOptions = [];
    if (isApprove && isFirst) {
      try {
        const d = await API.get('/memo/approvers');
        const staff = d.staff || [];
        let ids = [];
        try {
          const chain = JSON.parse(memo.approval_chain || '[]');
          if (Array.isArray(chain)) {
            const lv = chain.find((x) => Number(x.level) === 2);
            if (lv && Array.isArray(lv.ids) && lv.ids.length) ids = lv.ids.map(Number);
          }
        } catch (e) { /* ignore */ }
        if (!ids.length) ids = ((d.approvers || {})[2] || []).map(Number);
        const byId = {};
        staff.forEach((u) => { byId[u.id] = u; });
        nextOptions = ids.map((id) => byId[id]).filter(Boolean);
      } catch (e) { /* ignore */ }
    }
    // รายชื่อผู้อนุมัติขั้นที่ 3 (สุดท้าย) ให้เลือกในส่วน ผ่านเรื่อง/เสนอต่อ (จาก chain snapshot ณ เวลาส่ง หรือ config ปัจจุบัน)
    let level3Options = [];
    if (isApprove && isSecond) {
      try {
        const d = await API.get('/memo/approvers');
        const staff = d.staff || [];
        let ids = [];
        try {
          const chain = JSON.parse(memo.approval_chain || '[]');
          if (Array.isArray(chain)) {
            const lv = chain.find((x) => Number(x.level) === 3);
            if (lv && Array.isArray(lv.ids) && lv.ids.length) ids = lv.ids.map(Number);
          }
        } catch (e) { /* ignore */ }
        if (!ids.length) ids = ((d.approvers || {})[3] || []).map(Number);
        const byId = {};
        staff.forEach((u) => { byId[u.id] = u; });
        level3Options = ids.map((id) => byId[id]).filter(Boolean);
      } catch (e) { /* ignore */ }
    }
    const note = UI.h('textarea', { rows: 2, placeholder: 'หมายเหตุ (ไม่บังคับ)', style: { width: '100%' } });
    // ตัวเลือกอนุมัติขั้นต้น (ติ๊กได้ 1 ช่อง) — ข้อความธรรมดา มีเครื่องหมายติ๊กข้างหน้า ไม่มีกรอบ เรียงบรรทัดเดียวเสมอ
    let decideVal = '';
    const radio = (label) => UI.h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 400, whiteSpace: 'nowrap' } },
      UI.h('input', { type: 'radio', name: 'memo-decide', value: label, onclick: (e) => { decideVal = e.target.value; } }),
      label);
    const decideBox = isApprove && isFirst
      ? UI.h('div', { className: 'form-group full', style: { marginTop: '12px' } },
        UI.h('label', {}, 'อนุมัติขั้นต้น', UI.h('span', { className: 'req' }, ' *')),
        UI.h('div', { style: { display: 'flex', gap: '18px', flexWrap: 'nowrap', marginTop: '6px' } },
          radio('เพื่อโปรดพิจารณา'),
          radio('เพื่อโปรดทราบ')))
      : null;
    // ส่วน เรียนเสนอ — เลือกผู้อนุมัติขั้นที่ 2 จากดรอปดาวน์ (ขั้นที่ 1 ต้องเลือกก่อนอนุมัติ เพื่อส่งต่องานไปที่คนนั้น)
    let nextVal = '';
    const nextBox = isApprove && isFirst && nextOptions.length
      ? UI.h('div', { className: 'form-group full', style: { marginTop: '12px' } },
        UI.h('label', {}, 'เรียนเสนอ', UI.h('span', { className: 'req' }, ' *')),
        UI.h('select', { id: 'memo-next-approver', style: { width: '100%' }, onchange: (e) => { nextVal = e.target.value; } },
          UI.h('option', { value: '' }, '— กรุณาเลือกผู้อนุมัติขั้นที่ 2 —'),
          nextOptions.map((u) => UI.h('option', { value: u.id },
            `${UI.personName(u)}${u.position ? ' (' + u.position + ')' : ''}`))))
      : null;
    // ขั้นที่ 2: ปุ่มติ๊กเลือกอย่างใดอย่างหนึ่ง — ผ่านเรื่อง (ส่งต่อขั้นที่ 3) หรือ ปฏิบัติราชการ/รักษาราชการแทน (สิ้นสุดที่ขั้นที่ 2)
    let modeVal = '';
    let decide2Val = '';
    let comment2Val = '';
    let level3Val = '';
    const actSet = new Set();
    const ACT_CHOICES = ['ทราบ', 'ลงนามแล้ว', 'อนุญาต', 'ไม่อนุญาต', 'อนุมัติ', 'ไม่อนุมัติ', 'ชอบ/ให้ดำเนินการตามเสนอ'];
    const mkComment = () => UI.h('textarea', { rows: 2, placeholder: 'ความเห็นเพิ่มเติม (ไม่บังคับ)', style: { width: '100%' }, oninput: (e) => { comment2Val = e.target.value.trim(); } });
    const radio2 = (label) => UI.h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 400, whiteSpace: 'nowrap' } },
      UI.h('input', { type: 'radio', name: 'memo-decide2', value: label, onclick: (e) => { decide2Val = e.target.value; } }),
      label);
    const modeRadio = (value, label) => UI.h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 400, whiteSpace: 'nowrap' } },
      UI.h('input', { type: 'radio', name: 'memo-mode2', value, onclick: (e) => { modeVal = e.target.value; toggleMode(); } }),
      label);
    const modeBox = isApprove && isSecond
      ? UI.h('div', { className: 'form-group full', style: { marginTop: '12px', borderTop: '1px dashed var(--border)', paddingTop: '14px' } },
        UI.h('label', {}, 'ขั้นตอนการพิจารณา', UI.h('span', { className: 'req' }, ' *')),
        UI.h('div', { style: { display: 'flex', gap: '24px', flexWrap: 'wrap', marginTop: '6px' } },
          level3Options.length ? modeRadio('pass', 'ผ่านเรื่อง') : null,
          modeRadio('act', 'ปฏิบัติราชการ/รักษาราชการแทน')))
      : null;
    // เมนูย่อยเมื่อเลือก ผ่านเรื่อง: ความเห็น (เพื่อโปรดทราบ/เพื่อโปรดพิจารณา) + ความเห็นเพิ่มเติม + เลือกผู้อนุมัติขั้นที่ 3
    const passBox = isApprove && isSecond && level3Options.length
      ? UI.h('div', { id: 'memo-pass-box', style: { display: 'none' } },
        UI.h('div', { className: 'form-group full', style: { marginTop: '12px' } },
          UI.h('label', {}, 'ผ่านเรื่อง/เสนอต่อ', UI.h('span', { className: 'req' }, ' *')),
          UI.h('div', { style: { display: 'flex', gap: '18px', flexWrap: 'nowrap', marginTop: '6px' } },
            radio2('เพื่อโปรดพิจารณา'),
            radio2('เพื่อโปรดทราบ'))),
        UI.h('div', { className: 'form-group full', style: { marginTop: '12px' } },
          UI.h('label', {}, 'ความเห็นเพิ่มเติม'),
          mkComment()),
        UI.h('div', { className: 'form-group full', style: { marginTop: '12px' } },
          UI.h('label', {}, 'เลือกผู้อนุมัติขั้นที่ 3 (สุดท้าย)', UI.h('span', { className: 'req' }, ' *')),
          UI.h('select', { style: { width: '100%' }, onchange: (e) => { level3Val = e.target.value; } },
            UI.h('option', { value: '' }, '— กรุณาเลือกผู้อนุมัติขั้นที่ 3 (สุดท้าย) —'),
            level3Options.map((u) => UI.h('option', { value: u.id },
              `${UI.personName(u)}${u.position ? ' (' + u.position + ')' : ''}`)))))
      : null;
    // ลงนามในร่างเอกสาร — เฉพาะผูอนุมัติขั้นที่ 2/3: เปิดหน้าต่างแก้ไขร่างหนังสือส่ง แล้ววางลายเซ็น (บันทึกทับไฟล์เดิม)
    // ขั้นที่ 2: อยู่ในส่วน ขั้นตอนการพิจารณา แสดงเฉพาะเมื่อเลือก ปฏิบัติราชการ/รักษาราชการแทน
    // ขั้นที่ 3: อยู่ต่อจาก บันทึกสั่งการ
    const mkSignBox = () => UI.h('div', { className: 'form-group full', style: { marginTop: '16px', borderTop: '1px dashed var(--border)', paddingTop: '14px' } },
      UI.h('label', {}, UI.h('span', { style: { color: '#2563eb' } }, '✎'), ' ลงนามในร่างเอกสาร'),
      UI.h('div', { className: 'hint', style: { marginTop: '4px' } }, 'เปิดร่างหนังสือส่งเพื่อวางลายเซ็นของคุณลงในเอกสาร แล้วบันทึกทับไฟล์เดิม'),
      UI.h('button', { className: 'btn btn-blue btn-sm', style: { marginTop: '8px' }, onclick: () => MemosView.openSignEditor(memo) }, '✎ ลงนามในร่างเอกสาร'));
    // เมนูย่อยเมื่อเลือก ปฏิบัติราชการ/รักษาราชการแทน: ติ๊กได้หลายช่อง + ความเห็นเพิ่มเติม + ลงนามในร่างเอกสาร
    const actBox = isApprove && isSecond
      ? UI.h('div', { id: 'memo-act-box', style: { display: 'none' } },
        UI.h('div', { className: 'form-group full', style: { marginTop: '12px' } },
          UI.h('label', {}, 'ปฏิบัติราชการ/รักษาราชการแทน', UI.h('span', { className: 'req' }, ' *')),
          UI.h('div', { style: { display: 'flex', gap: '14px', flexWrap: 'wrap', marginTop: '6px' } },
            ACT_CHOICES.map((c) => UI.h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 400, whiteSpace: 'nowrap' } },
              UI.h('input', { type: 'checkbox', value: c, onclick: (e) => { if (e.target.checked) actSet.add(c); else actSet.delete(c); } }),
              c)))),
        UI.h('div', { className: 'form-group full', style: { marginTop: '12px' } },
          UI.h('label', {}, 'ความเห็นเพิ่มเติม'),
          mkComment()),
        mkSignBox())
      : null;
    function toggleMode() {
      const pb = document.getElementById('memo-pass-box');
      const ab = document.getElementById('memo-act-box');
      if (pb) pb.style.display = modeVal === 'pass' ? 'block' : 'none';
      if (ab) ab.style.display = modeVal === 'act' ? 'block' : 'none';
    }
    // ขั้นที่ 3 (สุดท้าย): บันทึกสั่งการ — ติ๊กได้หลายช่อง (ทราบ/ลงนามแล้ว/อนุญาต/...) + ความเห็นเพิ่มเติม
    const orderSet = new Set();
    let orderCommentVal = '';
    const orderBox = isApprove && isThird
      ? UI.h('div', { className: 'form-group full', style: { marginTop: '12px', borderTop: '1px dashed var(--border)', paddingTop: '14px' } },
        UI.h('label', {}, 'บันทึกสั่งการ', UI.h('span', { className: 'req' }, ' *')),
        UI.h('div', { style: { display: 'flex', gap: '14px', flexWrap: 'wrap', marginTop: '6px' } },
          ACT_CHOICES.map((c) => UI.h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 400, whiteSpace: 'nowrap' } },
            UI.h('input', { type: 'checkbox', value: c, onclick: (e) => { if (e.target.checked) orderSet.add(c); else orderSet.delete(c); } }),
            c))),
        UI.h('div', { className: 'form-group full', style: { marginTop: '12px' } },
          UI.h('label', {}, 'ความเห็นเพิ่มเติม'),
          UI.h('textarea', { rows: 2, placeholder: 'ความเห็นเพิ่มเติม (ไม่บังคับ)', style: { width: '100%' }, oninput: (e) => { orderCommentVal = e.target.value.trim(); } })))
      : null;
    // ขั้นที่ 3 (สุดท้าย): ปุ่มลงนามในร่างเอกสาร — แสดงต่อจาก บันทึกสั่งการ (ขั้นที่ 2 แสดงในส่วน ปฏิบัติราชการฯ แล้ว)
    const signBox3 = isApprove && isThird ? mkSignBox() : null;
    // ส่งกลับ/คืนเรื่องเพื่อให้แก้ไข — ขั้นที่ 1 ใช้ชื่อเดิม ส่วนขั้นที่ 2 ขึ้นไปใช้ชื่อ "คืนเรื่องเพื่อแก้ไข"
    // (เมื่อผู้อนุมัติขั้นที่ 2 คืนเรื่อง ผู้บันทึกข้อความแก้ไขแล้วส่งใหม่ เรื่องจะกลับมาที่ขั้นที่ 2 ทันที โดยไม่ผ่านขั้นที่ 1)
    const revNote = UI.h('textarea', { rows: 2, placeholder: 'สิ่งที่ให้แก้ไข (ผู้บันทึกข้อความจะเห็นข้อความนี้และแก้ไขตามที่ระบุ)', style: { width: '100%' } });
    const returnTitle = isFirst ? 'ส่งกลับเพื่อให้แก้ไข' : 'คืนเรื่องเพื่อแก้ไข';
    const returnBtnText = isFirst ? '↩ ส่งกลับเพื่อแก้ไข' : '↩ คืนเรื่องเพื่อแก้ไข';
    const sendBackBox = isApprove
      ? UI.h('div', { className: 'form-group full', style: { marginTop: '16px', borderTop: '1px dashed var(--border)', paddingTop: '14px' } },
        UI.h('label', {}, UI.h('span', { style: { color: '#ea580c' } }, '↩'), ` ${returnTitle}`),
        revNote,
        UI.h('button', { className: 'btn btn-sendback', style: { marginTop: '8px' }, onclick: sendBack }, returnBtnText))
      : null;
    const body = UI.h('div', {},
      UI.h('div', { style: { fontWeight: 600, marginBottom: '10px' } },
        isApprove
          ? (isThird
              ? '● ยืนยันการอนุมัติ (ขั้นที่ 3) — เลือก บันทึกสั่งการ ด้านล่าง'
              : next >= required
                ? '● ยืนยันการอนุมัติ — เมื่ออนุมัติแล้วถือเป็นสิ้นสุดการพิจารณา'
                : isSecond
                  ? '● ยืนยันการอนุมัติ (ขั้นที่ 2) — เลือก ผ่านเรื่อง หรือ ปฏิบัติราชการ/รักษาราชการแทน ด้านล่าง'
                  : `● ยืนยันการอนุมัติ (${MemosView.LEVEL_NAMES[next] || 'ขั้นที่ ' + next}) — ระบบจะส่งเรื่องต่อไปยังขั้นถัดไป`)
          : '✕ ยืนยันการไม่อนุมัติ — จะแจ้งเตือนผู้จัดทำทันที'),
      // ส่วนบน: ไฟล์แนบ (อ้างถึง/สิ่งที่ส่งมาด้วย/ร่างหนังสือส่ง) — ผู้อนุมัติเปิดตรวจสอบเอกสารได้ก่อนตัดสินใจ
      MemosView.attachmentsSection(memo),
      // แบบฟอร์มบันทึกข้อความจริง (ตามฟอร์ม form_bunteugkokeam) — อ่าน/ตรวจสอบก่อนส่งต่อขั้นถัดไป
      MemosView.formDocument(memo),
      UI.h('div', { className: 'form-group full', style: { marginTop: '12px' } },
        UI.h('label', {}, 'ความคืบหน้าการอนุมัติ'),
        UI.approvalDetail({ ...memo, approvals: memo.approvals || [], required_levels: MemosView.memoRequiredLevels(memo) }, MemosView.LEVEL_NAMES, { inline: true }),
        MemosView.nextApproverLine(memo)),
      UI.h('div', { className: 'form-group full', style: { marginTop: '12px' } }, UI.h('label', {}, 'หมายเหตุ'), note),
      decideBox,
      nextBox,
      modeBox,
      passBox,
      actBox,
      orderBox,
      signBox3,
      sendBackBox,
    );
    const foot = UI.h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end' } },
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn ' + (isApprove ? 'btn-success' : 'btn-danger'), onclick: submit },
        isApprove ? '● ยืนยันอนุมัติ' : '✕ ยืนยันไม่อนุมัติ'));
    const m = UI.modal({ title: isApprove ? '● อนุมัติบันทึกข้อความ' : '✕ ไม่อนุมัติบันทึกข้อความ', body, footer: foot, size: 'lg' });

    async function submit() {
      try {
        // ขั้นที่ 1 ต้องเลือกความเห็นก่อนอนุมัติ
        if (isApprove && isFirst && !decideVal) {
          return UI.toast('กรุณาเลือกความเห็นในส่วนอนุมัติขั้นต้น (เพื่อโปรดพิจารณา / เพื่อโปรดทราบ)', 'error');
        }
        // ขั้นที่ 1 ต้องเลือกผู้อนุมัติขั้นที่ 2 (เรียนเสนอ) ก่อนอนุมัติ — เมื่อมีผู้ได้รับมอบหมายขั้นที่ 2
        if (isApprove && isFirst && nextOptions.length && !nextVal) {
          return UI.toast('กรุณาเลือกผู้อนุมัติขั้นที่ 2 (เรียนเสนอ) ก่อนยืนยันอนุมัติ', 'error');
        }
        // ขั้นที่ 2 ต้องเลือก ผ่านเรื่อง หรือ ปฏิบัติราชการ/รักษาราชการแทน
        if (isApprove && isSecond && !modeVal) {
          return UI.toast('กรุณาเลือก ผ่านเรื่อง หรือ ปฏิบัติราชการ/รักษาราชการแทน', 'error');
        }
        if (isApprove && isSecond && modeVal === 'pass') {
          if (!decide2Val) return UI.toast('กรุณาเลือกความเห็นในส่วน ผ่านเรื่อง/เสนอต่อ (เพื่อโปรดทราบ / เพื่อโปรดพิจารณา)', 'error');
          if (level3Options.length && !level3Val) return UI.toast('กรุณาเลือกผู้อนุมัติขั้นที่ 3 (สุดท้าย)', 'error');
        }
        if (isApprove && isSecond && modeVal === 'act' && actSet.size === 0) {
          return UI.toast('กรุณาเลือกอย่างน้อย 1 รายการในส่วน ปฏิบัติราชการ/รักษาราชการแทน', 'error');
        }
        // ขั้นที่ 3 (สุดท้าย) ต้องเลือกอย่างน้อย 1 รายการในส่วน บันทึกสั่งการ
        if (isApprove && isThird && orderSet.size === 0) {
          return UI.toast('กรุณาเลือกอย่างน้อย 1 รายการในส่วน บันทึกสั่งการ', 'error');
        }
        const payload = { note: note.value };
        if (isApprove && isFirst) {
          payload.decide = decideVal;
          payload.next_approver_id = nextVal ? Number(nextVal) : undefined;
        }
        if (isApprove && isSecond) {
          payload.mode = modeVal;
          payload.comment = comment2Val || undefined;
          if (modeVal === 'pass') {
            payload.decide = decide2Val;
            payload.next_approver_id = level3Val ? Number(level3Val) : undefined;
          } else {
            payload.act_choices = [...actSet];
          }
        }
        if (isApprove && isThird) {
          payload.act_choices = [...orderSet];
          payload.comment = orderCommentVal || undefined;
        }
        const res = await API.put(`/memos/${memo.id}/${isApprove ? 'approve' : 'reject'}`, payload);
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }

    async function sendBack() {
      const t = revNote.value.trim();
      if (!t) return UI.toast('กรุณากรอกสิ่งที่ให้แก้ไขก่อนส่งกลับ', 'error');
      try {
        const res = await API.put(`/memos/${memo.id}/return`, { note: t });
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  /** เปิดหน้าต่างลงนามในร่างเอกสาร (หน้าต่างใหม่) — แสดงร่างหนังสือส่ง (PDF) ให้ลากลายเซ็นไปวาง แล้วบันทึกทับไฟล์เดิม */
  openSignEditor(memo) {
    let draft = null;
    try {
      const d = JSON.parse(memo.draft_file || 'null');
      if (Array.isArray(d)) draft = d[0];
      else if (d && d.file) draft = d;
    } catch (e) { /* ignore */ }
    if (!draft || !draft.file) return UI.toast('บันทึกข้อความนี้ไม่มีไฟล์ร่างหนังสือส่ง', 'error');
    if (!Auth.user.signature) return UI.toast('คุณยังไม่มีลายเซ็นในระบบ — กรุณาอัปโหลดลายเซ็นก่อนลงนามในร่างเอกสาร', 'error');
    const w = window.open(`/sign-editor.html?id=${memo.id}`, '_blank', 'width=1080,height=900');
    if (!w) return UI.toast('เบราว์เซอร์บล็อกหน้าต่างลงนาม กรุณาอนุญาต pop-up', 'error');
    w.focus();
  },

  /** ช่องเลือกส่วนราชการแบบ combobox — กดเปิดรายการเป็นพื้นขาว ตัวหนังสือชัดเจน พิมพ์หาได้ */
  comboBox({ id, options, value, placeholder }) {
    const wrap = UI.h('div', { className: 'combo' });
    const input = UI.h('input', { id, type: 'text', value: value || '', placeholder, autocomplete: 'off' });
    const btn = UI.h('button', { type: 'button', className: 'combo-btn', tabindex: '-1', title: 'เลือก' }, '▾');
    const panel = UI.h('div', { className: 'combo-panel' });
    wrap.append(input, btn, panel);

    function render(filter) {
      panel.innerHTML = '';
      const f = String(filter || '').trim().toLowerCase();
      const list = options.filter((o) => !f || String(o).toLowerCase().includes(f));
      if (!list.length) panel.append(UI.h('div', { className: 'combo-empty' }, 'ไม่พบรายการ'));
      list.forEach((o) => panel.append(UI.h('div', {
        className: 'combo-opt',
        onmousedown: (e) => e.preventDefault(),
        onclick: () => { input.value = o; hide(); input.focus(); },
      }, o)));
    }
    function show(all) { panel.style.display = 'block'; render(all ? '' : input.value); }
    function hide() { panel.style.display = 'none'; }
    input.addEventListener('focus', () => show(true));
    input.addEventListener('input', () => { if (panel.style.display !== 'none') render(input.value); });
    btn.addEventListener('click', (e) => { e.stopPropagation(); if (panel.style.display === 'none') show(true); else hide(); });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) hide(); });
    return wrap;
  },

  /** แปลงขนาดไฟล์เป็นข้อความอ่านง่าย (B / KB / MB) */
  fmtFileSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
    return bytes + ' B';
  },

  /** แถวแนบไฟล์: ช่องเลือกไฟล์ (แสดงขนาดไฟล์ใต้ช่องเป็นตัวหนังสือเล็ก ๆ) + ช่องตั้งชื่อไฟล์ + ปุ่มลบ (existing = ไฟล์เดิมตอนแก้ไข) */
  fileRow(container, { existing, name } = {}) {
    const sizeEl = UI.h('div', { className: 'file-size' });
    const fileInp = UI.h('input', { type: 'file', className: 'fr-file', accept: 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip', disabled: existing ? true : null,
      onchange: (e) => {
        const f = e.target.files && e.target.files[0];
        sizeEl.textContent = f ? `ขนาดไฟล์: ${MemosView.fmtFileSize(f.size)}` : '';
        sizeEl.classList.toggle('over', !!(f && f.size > 5 * 1024 * 1024));
      } });
    const row = UI.h('div', { className: 'file-row' },
      UI.h('div', { className: 'file-pick' }, fileInp, sizeEl),
      UI.h('input', { type: 'text', className: 'fr-name', value: name || '', placeholder: existing ? 'ไฟล์เดิม (เก็บไว้)' : 'ตั้งชื่อไฟล์', readonly: existing ? true : null }),
      UI.h('button', { type: 'button', className: 'btn btn-xs btn-outline fr-del', title: 'ลบแถวนี้', onclick: () => row.remove() }, '✕'));
    container.append(row);
    return row;
  },

  /** กลุ่มไฟล์: หลายแถว + ปุ่มเพิ่มเอกสาร (kind = ref/enc/draft) */
  fileGroup({ kind, label, existingJson, single }) {
    const box = UI.h('div', { className: 'form-group full' },
      UI.h('label', {}, label, single ? null : UI.h('span', { className: 'req' }, ' *')));
    const rows = UI.h('div', { className: 'file-rows', id: 'mf-' + kind + '-rows' });
    box.append(rows);
    // ช่องตั้งชื่อไฟล์: ค่าแรกเริ่มเป็นชื่อหัวข้อ (อ้างถึง/สิ่งที่ส่งมาด้วย/ร่างหนังสือส่ง) แก้ไขได้ตามต้องการ
    const addBtn = UI.h('button', { type: 'button', className: 'btn btn-outline btn-sm', onclick: () => MemosView.fileRow(rows, { name: label }) },
      single ? '△ เลือกไฟล์' : '+ เพิ่มเอกสาร');
    box.append(UI.h('div', { style: { marginTop: '8px' } }, addBtn));
    // แสดงไฟล์เดิม (ตอนแก้ไข)
    let existingList = [];
    try { existingList = JSON.parse(existingJson || '[]'); } catch (e) { existingList = []; }
    if (!Array.isArray(existingList)) existingList = [];
    (existingList || []).forEach((f) => MemosView.fileRow(rows, { existing: true, name: f.name || f.file }));
    return box;
  },

  /** รวบรวมไฟล์จากแถวใน container ลง FormData (ข้ามแถวไฟล์เดิม) */
  collectFiles(kind, fd, namesArr) {
    const rows = document.getElementById('mf-' + kind + '-rows');
    if (!rows) return;
    const fileField = kind === 'ref' ? 'ref_files' : kind === 'enc' ? 'enc_files' : 'draft_file';
    rows.querySelectorAll('.file-row').forEach((row) => {
      const fileInp = row.querySelector('.fr-file');
      const nameInp = row.querySelector('.fr-name');
      if (!fileInp || fileInp.disabled) return; // แถวไฟล์เดิม — เก็บไว้ฝั่งเซิร์ฟเวอร์
      if (fileInp.files && fileInp.files[0]) {
        fd.append(fileField, fileInp.files[0]);
        namesArr.push(nameInp ? nameInp.value.trim() : '');
      }
    });
    fd.append(kind + '_names', JSON.stringify(namesArr));
  },

  async openForm(memo) {
    const m = memo || {};
    const isNew = !m.id;
    await ensureAppFonts(); // ฟอนต์จากโฟล์เดอร์ font/ สำหรับเครื่องมือเลือกฟอนต์
    // ตัวเลือกส่วนราชการ: สังกัด/กลุ่มงานของ user + กลุ่มงานทั้งหมด
    const myWorkplace = (Auth.user && Auth.user.workplace) || '';
    const officeOptions = [...new Set([myWorkplace, ...CONSTANTS.WORKPLACES].filter(Boolean))];
    const officeVal = isNew ? myWorkplace : (m.office || myWorkplace);
    // ผู้รับ (ส่งบันทึกข้อความถึง) จากลำดับขั้นที่ admin กำหนด
    let approvers = { 1: [], 2: [], 3: [] };
    let perPerson = { 1: {}, 2: {}, 3: {} };
    let staff = [];
    try {
      const d = await API.get('/memo/approvers');
      approvers = d.approvers || { 1: [], 2: [], 3: [] };
      perPerson = d.perPerson || { 1: {}, 2: {}, 3: {} };
      staff = d.staff || [];
    } catch (e) { /* ignore */ }
    const byId = {};
    staff.forEach((u) => { byId[u.id] = u; });
    // ผู้รับเมื่อเขียนใหม่: ส่งถึง "ผู้อนุมัติขั้นที่ 1 ของผู้จัดทำเอง" (รายบุคคล) — ไม่ใช่ทั้งลำดับรวม
    // (ตอนแก้ไขบันทึกเก่า: คงผู้รับที่บันทึกไว้เดิม)
    let sendToList = [];
    try {
      const parsed = JSON.parse(m.send_to || '[]');
      if (Array.isArray(parsed) && parsed.length) sendToList = parsed;
    } catch (e) { /* ignore */ }
    if (!sendToList.length) {
      const myId = String((Auth.user && Auth.user.id) || '');
      const myL1 = Number((perPerson['1'] || {})[myId]) || 0;
      const l1Ids = myL1 ? [myL1] : (approvers[1] || []).map(Number);
      l1Ids.forEach((uid) => {
        const u = byId[uid];
        if (u) sendToList.push({ id: u.id, title: u.title, first_name: u.first_name, last_name: u.last_name, name: u.full_name, position: u.position, level: 1 });
      });
    }

    const body = UI.h('div', { className: 'form-grid memo-form' },
      // แบนเนอร์สิ่งที่ให้แก้ไข (เมื่อถูกส่งกลับเพื่อแก้ไข)
      (m.status === 'returned' && m.revision_note)
        ? UI.h('div', { className: 'form-group full', style: { background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '10px', padding: '12px', color: '#92400e', fontWeight: 600 } },
          `↻ ส่งกลับเพื่อแก้ไข — ${m.revision_note}`)
        : null,
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'ส่วนราชการ', UI.h('span', { className: 'req' }, ' *')),
        MemosView.comboBox({ id: 'mf-office', options: officeOptions, value: officeVal, placeholder: 'เลือกหรือพิมพ์ส่วนราชการ' })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ที่'),
        UI.h('input', { id: 'mf-no', value: m.doc_no || '', readonly: true, placeholder: 'ระบบออกเลขให้อัตโนมัติ' })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ความเร่งด่วน'),
        MemosView.urgencyGroup('mf-urgency', m.urgency || 'ปกติ')),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'วันที่', UI.h('span', { className: 'req' }, ' *')),
        UI.thaiDatePicker('mf-date', { value: m.date || UI.today() })),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'เรื่อง', UI.h('span', { className: 'req' }, ' *')),
        UI.h('input', { id: 'mf-title', value: m.title || '', placeholder: 'เช่น ขออนุมัติจัดซื้อวัสดุสำนักงาน' })),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'เรียน'),
        UI.h('input', { id: 'mf-to', value: m.to_text || 'ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2', readonly: true })),
      MemosView.fileGroup({ kind: 'ref', label: 'อ้างถึง', existingJson: m.ref_files }),
      MemosView.fileGroup({ kind: 'enc', label: 'สิ่งที่ส่งมาด้วย', existingJson: m.enc_files }),
      MemosView.fileGroup({ kind: 'draft', label: 'ร่างหนังสือส่ง', existingJson: m.draft_file, single: true }),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'บันทึกข้อความ'),
        MemosView.richEditor('mf-content', m.content)),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'ส่งบันทึกข้อความถึง'),
        MemosView.sendToBox('mf-sendto', sendToList)),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'บันทึกโดย'),
        UI.h('input', { id: 'mf-recorder', value: UI.personName(Auth.user) || (Auth.user && Auth.user.full_name) || '', readonly: true })),
      UI.h('div', { className: 'form-group' },
        UI.h('label', {}, 'ตำแหน่ง'),
        UI.h('input', { id: 'mf-pos', value: (Auth.user && Auth.user.position) || '', readonly: true })),
    );
    // ปุ่ม: บันทึกฉบับร่าง / ส่ง (ส่งต่อไปยังผู้ที่เลือกในช่อง ส่งบันทึกข้อความถึง) / บันทึก (กรณีอนุมัติแล้ว)
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => mclose() }, 'ยกเลิก'),
      (m.status === 'approved' || m.status === 'rejected')
        ? UI.h('button', { className: 'btn btn-primary', onclick: () => save('keep') }, '▽ บันทึก')
        : UI.h('div', { style: { display: 'inline-flex', gap: '10px' } },
          UI.h('button', { className: 'btn btn-outline', onclick: () => save('draft') }, '▽ บันทึกฉบับร่าง'),
          UI.h('button', { className: 'btn btn-primary', onclick: () => save('submit') }, '▲ ส่ง')));
    // modal-head-flat: เอาขีดเส้นใต้ส่วนหัว (ระหว่างส่วนหัวกับส่วนราชการ) ออก
    const modal = UI.modal({ title: m.id ? '✎ แก้ไขบันทึกข้อความ' : '✎ เขียนบันทึกข้อความ', body, footer: foot, size: 'lg', headClass: 'modal-head-flat' });

    // เลขที่อัตโนมัติ (แสดงอย่างเดียว แก้ไขไม่ได้) — ออกเลขถัดไปให้อัตโนมัติ
    if (isNew) {
      API.get('/memos/next-no').then((d) => {
        const el = document.getElementById('mf-no');
        if (el && !el.value) el.value = d.next || '';
      }).catch(() => { /* ignore */ });
    }

    // ตรวจสอบขนาดไฟล์แนบก่อนส่ง (ตรงกับฝั่งเซิร์ฟเวอร์: สูงสุด 5 MB ต่อไฟล์)
    const MAX_MEMO_FILE = 5 * 1024 * 1024;
    function fileTooLargeMsg() {
      for (const kind of ['ref', 'enc', 'draft']) {
        const rows = document.getElementById('mf-' + kind + '-rows');
        if (!rows) continue;
        for (const row of rows.querySelectorAll('.file-row')) {
          const inp = row.querySelector('.fr-file');
          if (!inp || inp.disabled) continue; // แถวไฟล์เดิม — ไม่เช็ค
          if (inp.files && inp.files[0] && inp.files[0].size > MAX_MEMO_FILE) {
            return `ไฟล์ "${inp.files[0].name}" ใหญ่เกินไป (สูงสุด 5 MB ต่อไฟล์) — กรุณาเลือกไฟล์เล็กลงหรือบีบอัดก่อนแนบ`;
          }
        }
      }
      return null;
    }

    async function save(mode) {
      const title = document.getElementById('mf-title').value.trim();
      const office = document.getElementById('mf-office').value.trim();
      if (!title) return UI.toast('กรุณากรอกเรื่อง (หัวข้อ) ของบันทึกข้อความ', 'error');
      if (!office) return UI.toast('กรุณากรอกส่วนราชการ', 'error');
      const big = fileTooLargeMsg();
      if (big) return UI.toast(big, 'error');
      const isSubmit = mode === 'submit';
      // ส่ง: ต้องมีผู้รับ (ส่งบันทึกข้อความถึง) เพื่อส่งต่อไปทำงานขั้นถัดไป
      if (isSubmit && !sendToList.length) return UI.toast('กรุณากำหนดผู้รับในช่อง ส่งบันทึกข้อความถึง ก่อนส่ง', 'error');
      const fd = new FormData();
      fd.append('doc_no', document.getElementById('mf-no').value.trim());
      fd.append('date', UI.readThaiDateInput('mf-date'));
      fd.append('office', office);
      fd.append('urgency', MemosView.readUrgency('mf-urgency'));
      fd.append('title', title);
      fd.append('to_text', document.getElementById('mf-to').value.trim());
      const ed = document.getElementById('mf-content');
      fd.append('content', ed ? ed.innerHTML : '');
      // ฉบับร่าง = draft / กดส่ง = submitted / อนุมัติแล้ว = คงสถานะเดิม
      fd.append('status', isSubmit ? 'submitted' : (mode === 'keep' ? (m.status || 'draft') : 'draft'));
      fd.append('send_to', JSON.stringify(sendToList));
      MemosView.collectFiles('ref', fd, []);
      MemosView.collectFiles('enc', fd, []);
      MemosView.collectFiles('draft', fd, []);
      // เก็บค่าสำหรับสร้างแบบฟอร์มบันทึกข้อความ (ต้องอ่านก่อนปิดฟอร์ม เพราะหลังปิดแล้ว DOM จะถูกลบ)
      const formDoc = isSubmit ? {
        doc_no: document.getElementById('mf-no').value.trim(),
        date: UI.readThaiDateInput('mf-date'),
        office,
        title,
        to_text: document.getElementById('mf-to').value.trim(),
        content: ed ? ed.innerHTML : '',
        maker_title: (Auth.user && Auth.user.title) || '',
        full_name: (Auth.user && Auth.user.full_name) || '',
        first_name: (Auth.user && Auth.user.first_name) || '',
        last_name: (Auth.user && Auth.user.last_name) || '',
        maker_position: (Auth.user && Auth.user.position) || '',
        maker_signature: (Auth.user && Auth.user.signature) || '',
      } : null;
      try {
        const res = m.id
          ? await API.putForm('/memos/' + m.id, fd)
          : await API.postForm('/memos', fd);
        UI.toast(res.message);
        mclose();
        render();
        // เมื่อกด "ส่ง" แล้ว: สร้างแบบฟอร์มบันทึกข้อความ (ตามฟอร์ม form_bunteugkokeam) ให้ทันที
        if (formDoc) MemosView.showForm(formDoc);
      } catch (e) { UI.toast(e.message, 'error'); }
    }

    function mclose() { modal.close(); }
  },

  /** ช่องติ๊กเลือกความเร่งด่วน (เลือกได้ตัวเดียว — ค่าเริ่มต้น ปกติ) */
  urgencyGroup(name, current) {
    const opts = ['ปกติ', 'ด่วน', 'ด่วนที่สุด'];
    const wrap = UI.h('div', { className: 'urgency-row', id: name + '-wrap' });
    opts.forEach((u) => {
      const id = name + '-' + u;
      wrap.append(UI.h('label', { className: 'urgency-opt urgency-' + u, for: id },
        UI.h('input', { type: 'radio', id, name, value: u, checked: (current || 'ปกติ') === u }),
        u));
    });
    return wrap;
  },

  /** อ่านค่าความเร่งด่วนที่เลือก */
  readUrgency(name) {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : 'ปกติ';
  },

  /** ตัวแก้ไขข้อความแบบ rich text (บันทึกข้อความ) — ฟอนต์ ขนาดอักษร จัดตำแหน่ง และเครื่องมืออื่น */
  richEditor(id, value) {
    const editor = UI.h('div', { id, className: 'memo-editor', contenteditable: 'true' });
    if (value) {
      if (/<[a-z][\s\S]*>/i.test(value)) editor.innerHTML = value;
      else editor.textContent = value;
    }
    const tb = (label, cmd, title) => UI.h('button', {
      type: 'button', className: 'memo-tb', title: title || label,
      onmousedown: (e) => e.preventDefault(),
      onclick: (e) => { e.preventDefault(); document.execCommand(cmd); editor.focus(); },
    }, label);
    // เลือกฟอนต์ — ดึงรายชื่อจากโฟล์เดอร์ font/ (ถ้ายังโหลดไม่ทัน ใช้รายการสำรอง)
    const fonts = (window.APP_FONT_LABELS && window.APP_FONT_LABELS.length)
      ? window.APP_FONT_LABELS
      : ['THSarabun', 'Sarabun', 'Angsana New', 'Cordia New', 'Tahoma', 'Arial'];
    const fontSel = UI.h('select', {
      className: 'memo-tb-select', title: 'ฟอนต์',
      onchange: (e) => {
        const f = e.target.value;
        if (f) { document.execCommand('fontName', false, f); editor.focus(); }
        e.target.value = '';
      },
    }, UI.h('option', { value: '' }, 'ฟอนต์'), fonts.map((f) => UI.h('option', { value: f, style: { fontFamily: f } }, f)));
    // เลือกขนาดอักษร (px) — ใช้ font[size] กลางแล้วแทนเป็น px
    const sizeSel = UI.h('select', {
      className: 'memo-tb-select', title: 'ขนาดอักษร',
      onchange: (e) => {
        const px = Number(e.target.value);
        if (!px) return;
        document.execCommand('fontSize', false, '7');
        editor.querySelectorAll('font[size="7"]').forEach((sp) => {
          sp.removeAttribute('size');
          sp.style.fontSize = px + 'px';
        });
        editor.focus();
        e.target.value = '';
      },
    }, UI.h('option', { value: '' }, 'ขนาด'), [14, 16, 18, 20, 24, 28, 32].map((px) => UI.h('option', { value: px }, px + ' px')));
    const toolbar = UI.h('div', { className: 'memo-toolbar' },
      fontSel,
      sizeSel,
      tb('B', 'bold'),
      tb('I', 'italic'),
      tb('U', 'underline'),
      tb('• รายการ', 'insertUnorderedList'),
      tb('1. รายการ', 'insertOrderedList'),
      tb('ซ้าย', 'justifyLeft', 'จัดชิดซ้าย'),
      tb('กลาง', 'justifyCenter', 'จัดกึ่งกลาง'),
      tb('ขวา', 'justifyRight', 'จัดชิดขวา'));
    return UI.h('div', {}, toolbar, editor);
  },

  /** ช่อง "ส่งบันทึกข้อความถึง" — แสดงชื่อบุคคล กดแล้วเปิดรายชื่อทั้งหมด */
  sendToBox(id, list) {
    const wrap = UI.h('div', { className: 'combo' });
    const text = UI.h('div', { id, className: 'sendto-box' });
    const btn = UI.h('button', { type: 'button', className: 'combo-btn', tabindex: '-1', title: 'ดูรายชื่อ' }, '👥');
    const panel = UI.h('div', { className: 'combo-panel sendto-panel' });
    wrap.append(text, btn, panel);

    const names = list.map((p) => `${p.title || ''}${p.first_name || p.name || ''}  ${p.last_name || ''}`.trim());
    text.textContent = names.length ? names.join(', ') : 'ยังไม่ได้กำหนด — ติดต่อผู้ดูแลระบบ';
    text.title = 'กดเพื่อดูรายชื่อทั้งหมด';

    function renderPanel() {
      panel.innerHTML = '';
      if (!list.length) {
        panel.append(UI.h('div', { className: 'combo-empty' }, 'ยังไม่ได้กำหนดลำดับขั้นการส่งบันทึกข้อความ'));
        return;
      }
      [1, 2, 3].forEach((lv) => {
        const people = list.filter((p) => p.level === lv);
        if (!people.length) return;
        panel.append(UI.h('div', { className: 'sendto-lv' }, MemosView.LEVEL_NAMES[lv]));
        people.forEach((p) => panel.append(UI.h('div', { className: 'combo-opt' },
          `${p.title || ''}${p.first_name || p.name || ''}  ${p.last_name || ''}`,
          UI.h('div', { className: 'hint' }, p.position || ''))));
      });
    }
    function show() { renderPanel(); panel.style.display = 'block'; }
    function hide() { panel.style.display = 'none'; }
    text.addEventListener('click', (e) => { e.stopPropagation(); if (panel.style.display === 'none') show(); else hide(); });
    btn.addEventListener('click', (e) => { e.stopPropagation(); if (panel.style.display === 'none') show(); else hide(); });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) hide(); });
    return wrap;
  },

  /** admin กำหนดลำดับขั้นการส่งบันทึกข้อความ (ชื่อผู้รับในช่อง ส่งบันทึกข้อความถึง) */
  async openApproversModal() {
    let data;
    try {
      data = await API.get('/memo/approvers');
    } catch (e) { return UI.toast(e.message, 'error'); }
    const perPerson = data.perPerson || { 1: {}, 2: {}, 3: {} };
    const staff = data.staff || [];
    const nameOf = (u) => `${u.title || ''} ${u.first_name || u.full_name || ''} ${u.last_name || ''}`.replace(/\s+/g, ' ').trim();
    const buildOptHtml = (selectedId) => {
      let h = '<option value="">-- เลือกบุคคล --</option>';
      for (const u of staff) {
        const isSel = Number(selectedId) === Number(u.id) ? ' selected' : '';
        h += '<option value="' + u.id + '"' + isSel + '>' + UI.esc(nameOf(u)) + '</option>';
      }
      return h;
    };
    const thStyle = 'padding:6px 10px;border:1px solid #d1d5db;text-align:center;font-weight:700;font-size:13px;white-space:nowrap;';
    const tdStyle = 'padding:5px 10px;border:1px solid #d1d5db;font-size:13.5px;';
    const selCss = 'padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;width:100%;min-width:170px;';
    const wpStyle = tdStyle + 'color:#6b7280;font-size:12.5px;white-space:nowrap;';
    let html = '<table class="tbl">';
    html += '<thead><tr>';
    html += '<th style="' + thStyle + 'text-align:left;">ชื่อบุคลากร</th>';
    html += '<th style="' + thStyle + 'text-align:left;">สังกัด/ตำแหน่ง</th>';
    html += '<th style="' + thStyle + 'text-align:center;">❶ ขั้นที่ 1</th>';
    html += '<th style="' + thStyle + 'text-align:center;">❷ ขั้นที่ 2</th>';
    html += '<th style="' + thStyle + 'text-align:center;">❸ ขั้นที่ 3</th>';
    html += '</tr></thead><tbody>';
    for (const u of staff) {
      const uid = String(u.id);
      const v1 = Number((perPerson['1'] || {})[uid]) || 0;
      const v2 = Number((perPerson['2'] || {})[uid]) || 0;
      const v3 = Number((perPerson['3'] || {})[uid]) || 0;
      html += '<tr>';
      html += '<td style="' + tdStyle + 'font-weight:600;white-space:nowrap;">' + UI.esc(nameOf(u)) + '</td>';
      html += '<td style="' + wpStyle + '">' + UI.esc(u.workplace || '-') + '<br>' + UI.esc(u.position || '-') + '</td>';
      html += '<td style="' + tdStyle + 'text-align:center;"><select class="ma-sel ma-sel-1" data-uid="' + u.id + '" style="' + selCss + '">' + buildOptHtml(v1) + '</select></td>';
      html += '<td style="' + tdStyle + 'text-align:center;"><select class="ma-sel ma-sel-2" data-uid="' + u.id + '" style="' + selCss + '">' + buildOptHtml(v2) + '</select></td>';
      html += '<td style="' + tdStyle + 'text-align:center;"><select class="ma-sel ma-sel-3" data-uid="' + u.id + '" style="' + selCss + '">' + buildOptHtml(v3) + '</select></td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
    const body = UI.h('div', {},
      UI.h('p', { className: 'hint', style: { marginBottom: '12px' } },
        'กำหนดลำดับขั้นการส่งบันทึกข้อความรายบุคคล — เลือกผู้อนุมัติขั้นที่ 1/2/3 ของแต่ละคนได้อย่างอิสระ รวมถึงเลือกชื่อตัวเองได้ เมื่อคนนั้นส่งบันทึกข้อความ ระบบจะส่งตามลำดับขั้นของบุคคลนั้น'),
      UI.h('div', { className: 'table-wrap', style: { maxHeight: '420px', overflowY: 'auto', overflowX: 'auto' } },
        (() => { const d = UI.h('div'); d.innerHTML = html; return d.firstChild; })()));
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '▽ บันทึกสิทธิ์'));
    const m = UI.modal({ title: '+ เพิ่มเจ้าหน้าที่ (ลำดับขั้นบันทึกข้อความ)', body, footer: foot, size: 'xxl' });

    async function save() {
      const per = { 1: {}, 2: {}, 3: {} };
      document.querySelectorAll('.ma-sel').forEach((sel) => {
        const staffId = sel.getAttribute('data-uid');
        const val = Number(sel.value);
        const lv = sel.classList.contains('ma-sel-1') ? '1' : sel.classList.contains('ma-sel-2') ? '2' : '3';
        if (val && staffId) per[lv][staffId] = val;
      });
      try {
        const res = await API.put('/memo/approvers', per);
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  async remove(m) {
    const ok = await UI.confirm(`ต้องการลบบันทึกข้อความ "${m.title}" ใช่หรือไม่?`, { danger: true, okText: 'ลบ' });
    if (!ok) return;
    try {
      const res = await API.del('/memos/' + m.id);
      UI.toast(res.message);
      render();
    } catch (e) { UI.toast(e.message, 'error'); }
  },
};
