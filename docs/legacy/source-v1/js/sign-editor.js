'use strict';
/* หน้าต่างลงนามในร่างเอกสาร — เปิดจากหน้าอนุมัติบันทึกข้อความ (ผู้อนุมัติขั้นที่ 2/3)
   แสดงร่างหนังสือส่ง (PDF) ให้ลากลายเซ็นไปวาง แล้วบันทึกฝังลายเซ็นทับไฟล์เดิมในระบบ */

(async () => {
  const statusEl = document.getElementById('sign-status');
  const memoLabel = document.getElementById('tb-memo');
  const setStatus = (msg, ok) => {
    statusEl.textContent = msg;
    statusEl.style.color = ok ? '#15803d' : '#dc2626';
  };
  const fail = (msg) => {
    if (memoLabel) memoLabel.textContent = msg;
    setStatus('⛔ ' + msg, false);
  };

  const params = new URLSearchParams(location.search);
  const memoId = Number(params.get('id'));
  if (!memoId) return fail('ไม่พบเลขที่บันทึกข้อความ');

  // ดึงผู้ใช้ปัจจุบัน (มีลายเซ็น) + ข้อมูลบันทึกข้อความ
  let me = null, memo = null;
  try {
    const d = await fetch('/api/auth/me', { credentials: 'same-origin' }).then((r) => r.json());
    me = d.user || null;
    const list = await fetch('/api/memos', { credentials: 'same-origin' }).then((r) => r.json());
    memo = (list.memos || []).find((m) => Number(m.id) === memoId);
  } catch (e) { /* handled below */ }
  if (!me) return fail('กรุณาเข้าสู่ระบบก่อนใช้งาน');
  if (!memo) return fail('ไม่พบบันทึกข้อความนี้ (อาจถูกลบไปแล้ว)');
  if (!me.signature) return fail('คุณยังไม่มีลายเซ็นในระบบ — กรุณาอัปโหลดลายเซ็นก่อนลงนามในร่างเอกสาร');
  let draft = null;
  try {
    const d = JSON.parse(memo.draft_file || 'null');
    if (Array.isArray(d)) draft = d[0];
    else if (d && d.file) draft = d;
  } catch (e) { /* ignore */ }
  if (!draft || !draft.file) return fail('บันทึกข้อความนี้ไม่มีไฟล์ร่างหนังสือส่ง');

  document.title = `🖊️ ลงนามในร่างเอกสาร — ${memo.doc_no || 'บันทึกข้อความ'}`;
  memoLabel.textContent = `${memo.doc_no || 'บันทึกข้อความ'} — ${memo.title || ''}`;
  document.getElementById('sig-thumb').src = '/uploads/' + encodeURIComponent(me.signature);
  const uname = `${me.title || ''}${me.first_name || ''} ${me.last_name || ''}`.trim();
  document.getElementById('sig-user').textContent = uname || me.username || me.full_name || '';

  const sigThumb = document.getElementById('sig-thumb');
  const STAMP_W = 160; // ความกว้างลายเซ็นบนหน้าจอ (px) — เทียบสัดส่วนกับหน้ากระดาษ
  const pagesBox = document.getElementById('sign-pages');
  const pageWraps = [];
  const stamps = []; // { el, page }

  // ---- วางลายเซ็นลงหน้าเอกสาร (ตำแหน่งอ้างอิง clientX/clientY) ----
  function placeStamp(pageIndex, clientX, clientY) {
    const wrap = pageWraps[pageIndex];
    if (!wrap) return false;
    const rect = wrap.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    const w = STAMP_W / rect.width;
    addStampDom(pageIndex, x, y, w);
    return true;
  }

  function addStampDom(pageIndex, x, y, w) {
    const wrap = pageWraps[pageIndex];
    const stamp = document.createElement('div');
    stamp.className = 'sig-stamp';
    const img = document.createElement('img');
    img.src = '/uploads/' + encodeURIComponent(me.signature);
    img.alt = 'ลายเซ็น';
    stamp.append(img);
    const del = document.createElement('button');
    del.className = 'sig-del';
    del.textContent = '✕';
    del.title = 'ลบลายเซ็นนี้';
    del.onclick = (e) => { e.stopPropagation(); stamp.remove(); };
    stamp.append(del);
    // เครื่องมือปรับขนาดลายเซ็น — ลากมุมขวาล่างเพื่อย่อ/ขยาย (ความกว้างเป็นสัดส่วนกับหน้ากระดาษเมื่อบันทึก)
    const rz = document.createElement('div');
    rz.className = 'sig-rz';
    rz.title = 'ปรับขนาดลายเซ็น (ลากมุมขวาล่าง)';
    rz.textContent = '⤡';
    stamp.append(rz);
    let rzDrag = false;
    rz.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      rzDrag = true;
      rz.setPointerCapture(e.pointerId);
    });
    rz.addEventListener('pointermove', (e) => {
      if (!rzDrag) return;
      const wr = wrap.getBoundingClientRect();
      const sr = stamp.getBoundingClientRect();
      let w = e.clientX - sr.left; // ความกว้างใหม่ = ระยะจากขอบซ้ายของลายเซ็นถึงจุดลาก
      const minW = 40, maxW = wr.right - sr.left - 4;
      w = Math.max(minW, Math.min(maxW, w));
      stamp.style.width = Math.round(w) + 'px';
    });
    rz.addEventListener('pointerup', () => { rzDrag = false; });
    rz.addEventListener('pointercancel', () => { rzDrag = false; });
    wrap.append(stamp);
    const rect = wrap.getBoundingClientRect();
    stamp.style.width = Math.round(w * rect.width) + 'px';
    stamp.style.left = Math.round(x * rect.width) + 'px';
    stamp.style.top = Math.round(y * rect.height) + 'px';
    // ลากย้ายตำแหน่งลายเซ็นภายในหน้า
    let dragging = false, dx = 0, dy = 0;
    stamp.addEventListener('pointerdown', (e) => {
      if (e.target === del) return;
      e.preventDefault();
      dragging = true;
      stamp.classList.add('dragging');
      const sr = stamp.getBoundingClientRect();
      dx = e.clientX - sr.left;
      dy = e.clientY - sr.top;
      stamp.setPointerCapture(e.pointerId);
    });
    stamp.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const wr = wrap.getBoundingClientRect();
      let left = e.clientX - wr.left - dx;
      let top = e.clientY - wr.top - dy;
      left = Math.max(0, Math.min(wr.width - stamp.offsetWidth, left));
      top = Math.max(0, Math.min(wr.height - stamp.offsetHeight, top));
      stamp.style.left = left + 'px';
      stamp.style.top = top + 'px';
    });
    stamp.addEventListener('pointerup', () => { dragging = false; stamp.classList.remove('dragging'); });
    stamp.addEventListener('pointercancel', () => { dragging = false; stamp.classList.remove('dragging'); });
    stamps.push({ el: stamp, page: pageIndex + 1 });
  }

  // ---- แสดงหน้าต่างๆ ของ PDF ด้วย pdf.js ----
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
  let pdf = null;
  try {
    pdf = await pdfjsLib.getDocument({ url: '/uploads/' + encodeURIComponent(draft.file) }).promise;
  } catch (e) {
    return fail('ไม่สามารถเปิดไฟล์ร่างหนังสือส่งได้ (รองรับเฉพาะไฟล์ PDF): ' + (e.message || ''));
  }
  const first = await pdf.getPage(1);
  const base = first.getViewport({ scale: 1 });
  const scale = Math.min(1.5, 900 / base.width); // พอดีกับความกว้างหน้าต่าง
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const wrap = document.createElement('div');
    wrap.className = 'sig-page-wrap';
    const label = document.createElement('div');
    label.className = 'sig-page-label';
    label.textContent = `หน้า ${i}/${pdf.numPages}`;
    wrap.append(label);
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    wrap.append(canvas);
    pagesBox.append(wrap);
    pageWraps.push(wrap);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    // คลิกที่หน้าเอกสาร → วางลายเซ็นตรงจุดนั้น
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target !== canvas && e.target !== wrap) return;
      placeStamp(pageWraps.indexOf(wrap), e.clientX, e.clientY);
    });
  }

  // ---- ลากลายเซ็นจากแถบเมนู (source) ไปวางบนเอกสาร ----
  const source = document.getElementById('sig-source');
  let carrying = false;
  let ghost = null;
  function moveGhost(clientX, clientY) {
    if (!ghost) return;
    ghost.style.left = clientX - ghost.offsetWidth / 2 + 'px';
    ghost.style.top = clientY - ghost.offsetHeight / 2 + 'px';
  }
  source.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    carrying = true;
    ghost = document.createElement('div');
    ghost.className = 'sig-ghost';
    const gimg = document.createElement('img');
    gimg.src = '/uploads/' + encodeURIComponent(me.signature);
    gimg.alt = '';
    ghost.append(gimg);
    ghost.style.width = STAMP_W + 'px';
    document.body.append(ghost);
    moveGhost(e.clientX, e.clientY);
    source.setPointerCapture(e.pointerId);
  });
  source.addEventListener('pointermove', (e) => { if (carrying) moveGhost(e.clientX, e.clientY); });
  source.addEventListener('pointerup', (e) => {
    if (!carrying) return;
    carrying = false;
    if (ghost) { ghost.remove(); ghost = null; }
    let placed = false;
    for (let i = 0; i < pageWraps.length; i++) {
      if (placeStamp(i, e.clientX, e.clientY)) { placed = true; break; }
    }
    if (!placed) setStatus('ℹ️ ปล่อยลายเซ็นลงบนหน้าเอกสารเพื่อวาง', false);
    else setStatus('', true);
  });
  source.addEventListener('pointercancel', () => {
    carrying = false;
    if (ghost) { ghost.remove(); ghost = null; }
  });

  // ---- บันทึก: ส่งตำแหน่งลายเซ็น (สัดส่วน 0-1 ต่อหน้า) ให้เซิร์ฟเวอร์ฝังลง PDF แล้วเซฟทับไฟล์เดิม ----
  const saveBtn = document.getElementById('btn-save');
  saveBtn.onclick = async () => {
    const active = stamps.filter((s) => s.el.isConnected);
    if (!active.length) return setStatus('⛔ กรุณาวางลายเซ็นลงในเอกสารก่อนบันทึก', false);
    const data = active.map((s) => {
      const r = s.el.parentElement.getBoundingClientRect();
      return {
        page: s.page,
        x: parseFloat(s.el.style.left) / r.width,
        y: parseFloat(s.el.style.top) / r.height,
        w: s.el.offsetWidth / r.width,
      };
    });
    saveBtn.disabled = true;
    setStatus('⏳ กำลังบันทึกลายเซ็นลงเอกสาร...', true);
    try {
      const res = await fetch('/api/memos/' + memoId + '/sign-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ stamps: data }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'ไม่สามารถบันทึกได้');
      setStatus('✅ ' + (j.message || 'บันทึกลงนามเรียบร้อย'), true);
      saveBtn.textContent = '✅ บันทึกแล้ว';
      setTimeout(() => window.close(), 1500);
    } catch (e) {
      setStatus('⛔ ' + e.message, false);
      saveBtn.disabled = false;
    }
  };
  document.getElementById('btn-close').onclick = () => window.close();
})();
