/**
 * เกียรติบัตร — รวบรวมข้อมูลจากฟอร์มแล้ววาดลงบนแบบเกียรติบัตรด้วย canvas
 *
 * ย้ายจาก DocumentsView.openForm() (เครื่องมือฝั่งขวาของฟอร์มเกียรติบัตร)
 *
 * แยกเป็นโมดุลเพราะเป็นงานวาดบน canvas ที่ไม่มี state ของ Vue เลย
 * ทำให้ทดสอบและใช้ซ้ำได้โดยไม่ต้องเปิดฟอร์ม
 */
import api from '../api/client.js';
import { UI } from '../ui/ui.js';

/** เลขที่หนังสือรับรอง/คำสั่ง/เกียรติบัตรที่ระบบจะรันให้ */
export async function fetchNextDocNo(type) {
  try {
    const d = await api.get('/next-doc-no?type=' + encodeURIComponent(type));
    return (d && d.next) || '';
  } catch {
    return '';
  }
}

/** เลขที่หนังสือรับถัดไป (ไม่มี type) */
export async function fetchNextRegNo() {
  try {
    const d = await api.get('/next-doc-no');
    return (d && d.next) || '';
  } catch {
    return '';
  }
}

/**
 * รายชื่อสำหรับ autocomplete (บุคลากร + สถานศึกษา)
 * @returns {Promise<Array<{text:string, sub:string}>>}
 */
export async function fetchPersonSuggestions(kind) {
  try {
    const d = await api.get('/next-doc-no?type=honorees');
    const persons = (d.persons || []).map((p) =>
      kind === 'honor'
        ? { text: p.name, sub: 'บุคลากร' + (p.workplace ? ' · ' + p.workplace : '') }
        : { text: p.name, sub: p.workplace || '' },
    );
    const schools = kind === 'honor' ? (d.schools || []).map((s) => ({ text: s, sub: 'สถานศึกษา' })) : [];
    return persons.concat(schools);
  } catch {
    return [];
  }
}

/** รายชื่อเจ้าหน้าที่ สพป. (มี title / full_name / position / signature) */
export async function fetchOfficeStaff() {
  try {
    const d = await api.get('/office-staff');
    return d.staff || [];
  } catch {
    return [];
  }
}

/** กลุ่มงาน/สังกัดสำหรับ dropdown */
export async function fetchWorkplaceGroups() {
  try {
    const d = await api.get('/workplace-groups');
    return d.groups || [];
  } catch {
    return [];
  }
}

/** รายชื่อสถานศึกษาทั้งหมด */
export async function fetchSchools() {
  try {
    const d = await api.get('/schools');
    return d.schools || [];
  } catch {
    return [];
  }
}

/* ---------- คำนำหน้าชื่อ ---------- */

/**
 * ติดคำนำหน้ากับชื่อให้ติดกัน (ไม่มีช่องว่าง)
 * "นางสาว อ้อนจันทร์" → "นางสาวอ้อนจันทร์"
 */
export function attachHonorTitle(name) {
  return String(name || '').replace(/^((?:นาย|นาง|นางสาว|น\.ส\.|ด\.ช\.|ด\.ญ\.)\s+)/, (m, p) =>
    p.replace(/\s+/g, ''),
  );
}

/** ผู้ที่มีสิทธิ์ลงนามเกียรติบัตร = ผอ. / รอง ผอ. */
export function canSignHonor(s) {
  const p = String(s.position || '').trim();
  return p.indexOf('รองผู้อำนวยการ') === 0 || (p.indexOf('ผู้อำนวยการ') === 0 && p.indexOf('รองผู้อำนวยการ') !== 0);
}

/** ชื่อพร้อมคำนำหน้า + ตำแหน่งในรูปแบบเดียวกับ dropdown */
export const staffLabel = (s) => ((s.title ? s.title + ' ' : '') + s.full_name).trim() + (s.position ? ' (' + s.position + ')' : '');

/* ---------- ฟอนต์ ---------- */

/**
 * canvas ของเบราว์เซอร์ parse ชื่อฟอนต์ที่มีอักขระไทย (๙) ใน font string ไม่ได้
 * ต้องโหลดผ่าน FontFace ด้วยชื่อ alias ที่เป็น ASCII
 */
export const HONOR_FONT_ALIAS = 'THSarabunIT9Canvas';

let honorFontLoaded = false;

export async function ensureHonorFont() {
  if (honorFontLoaded) return;
  try {
    const u = '/fonts/' + encodeURIComponent('THSarabunIT๙.ttf');
    const ub = '/fonts/' + encodeURIComponent('THSarabunIT๙ Bold.ttf');
    const ff = new FontFace(HONOR_FONT_ALIAS, 'url("' + u + '") format("truetype")', { weight: '400' });
    await ff.load();
    document.fonts.add(ff);
    const fb = new FontFace(HONOR_FONT_ALIAS, 'url("' + ub + '") format("truetype")', { weight: '700' });
    await fb.load();
    document.fonts.add(fb);
    honorFontLoaded = true;
  } catch {
    /* ใช้ฟอนต์ fallback ต่อไป */
  }
}

/** โหลดฟอนต์แอปให้เสร็จก่อนวาดลง canvas (ป้องกันวาดด้วยฟอนต์ไม่ครบ) */
export async function ensureAppFonts() {
  if (window.APP_FONTS_LOADED) return;
  window.APP_FONTS_LOADED = true;
  try {
    const d = await api.get('/fonts');
    const fonts = d.fonts || [];
    const css = fonts
      .flatMap((f) =>
        f.files.map(
          (fl) =>
            `@font-face{font-family:'${f.family}';src:url('/fonts/${encodeURIComponent(fl.file)}');font-weight:${f.weight};font-style:${f.style};}`,
        ),
      )
      .join('\n');
    if (css) {
      const st = document.createElement('style');
      st.id = 'app-fonts-css';
      st.textContent = css;
      document.head.append(st);
    }
    window.APP_FONT_LABELS = fonts.map((f) => f.family);
  } catch {
    window.APP_FONT_LABELS = window.APP_FONT_LABELS || [];
  }
}

/** เตรียมฟอนต์ทั้งหมดให้พร้อมวาดเกียรติบัตร */
export async function prepareHonorFonts() {
  await ensureAppFonts();
  await ensureHonorFont();
  try {
    await document.fonts.load('700 60px ' + HONOR_FONT_ALIAS);
    await document.fonts.load('60px ' + HONOR_FONT_ALIAS);
  } catch {
    /* ใช้ฟอนต์ที่โหลดได้ */
  }
}

/* ---------- รูปแบบเกียรติบัดร ---------- */

const imgCache = {};

/** โหลดรูปแบบเกียรติบัตร (มี cache เพราะใช้ซ้ำบ่อย) */
export async function loadHonorTemplate(n) {
  if (imgCache[n]) return imgCache[n];
  const img = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = '/form/certificate/' + n + '.png';
  });
  imgCache[n] = img;
  return img;
}

/** โหลดลายเซ็นผู้ลงนาม (ไม่มีก็คืน null — ไม่มีลายเซ็นก็พิมพ์ได้) */
export async function loadHonorSignature(url) {
  if (!url) return null;
  try {
    return await new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = url;
    });
  } catch {
    return null;
  }
}

/* ---------- ตรวจข้อมูลก่อนพิมพ์ ---------- */

/**
 * ตรวจว่าข้อมูลพอสำหรับพิมพ์เกียรติบัตรหรือยัง
 * @returns {string|null} ข้อความ error หรือ null ถ้าผ่าน
 */
export function validateHonor(data) {
  if (!data.template) return 'กรุณาเลือกแบบเกียรติบัตร';
  if (!String(data.personName || '').trim()) return 'กรุณาระบุชื่อ-นามสกุล, โรงเรียน ฯลฯ';
  if (!String(data.title || '').trim()) return 'กรุณากรอกเรื่อง';
  if (!data.signer) return 'กรุณาเลือกผู้ลงนาม';
  return null;
}

/* ---------- วาดลงแบบ ---------- */

/**
 * ย่อขนาดฟอนต์อัตโนมัติจนข้อความพอดีความกว้าง
 * @param {CanvasRenderingContext2D} ctx
 */
function fitFont(ctx, text, startSize, minSize, maxWidth, weight) {
  let size = startSize;
  ctx.font = (weight ? weight + ' ' : '') + size + 'px FONT_PLACEHOLDER';
  while (ctx.measureText(text).width > maxWidth && size > minSize) {
    size -= Math.max(1, Math.round(startSize * 0.03));
    ctx.font = (weight ? weight + ' ' : '') + size + 'px FONT_PLACEHOLDER';
  }
  return size;
}

/**
 * วาดข้อมูลลงบนรูปแบบเกียรติบัตร
 *
 * ตำแหน่ง (คัดลอกจากต้นฉบับ ห้ามเปลี่ยนเพราะผลลัพธ์คือเอกสารที่ส่งออกจริง):
 *   เลขเกียรติบัตร  ขวาบน
 *   ชื่อผู้ได้รับ   จัดกลาง ใหญ่
 *   เรื่อง         จัดกลาง ต่อจากชื่อ
 *   เนื้อหา        จัดกลาง ต่อจากเรื่อง
 *   วันที่         ต่อท้าย "ณ วันที่"
 *   ลายเซ็น+ชื่อ  กลางล่าง
 *
 * @param {object} data ข้อมูลจาก collectHonorData()
 * @param {HTMLImageElement} img รูปแบบ
 * @param {HTMLImageElement|null} sigImg ลายเซ็น
 * @returns {HTMLCanvasElement}
 */
export function drawHonorOnTemplate(data, img, sigImg) {
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const W = cv.width;
  const H = cv.height;
  const isTpl2 = String(data.template) === '2';
  const dateY = isTpl2 ? 0.705 : 0.685;
  const FONT = `"${HONOR_FONT_ALIAS}", "THSarabun", "TH Sarabun New", Sarabun, sans-serif`;

  /** ตั้งฟอนต์และคืนขนาดที่ใช้จริง (ย่อให้พอดีความกว้าง) */
  const setFit = (text, startSize, minSize, maxWidth, weight, align, x, y) => {
    const size = fitFont(ctx, text, startSize, minSize, maxWidth, weight);
    ctx.font = (weight ? weight + ' ' : '') + size + 'px ' + FONT;
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
  };

  ctx.fillStyle = '#1e293b';

  // เลขเกียรติบัตร — ขวาบน (ขอบขวา 350px จากขวา)
  ctx.textAlign = 'right';
  ctx.font = Math.round(W * 0.026) + 'px ' + FONT;
  ctx.fillText(data.docNo || '', W - 350, H * 0.1);

  // ชื่อผู้ได้รับเกียรติบัตร — จัดกลาง ใหญ่
  ctx.textAlign = 'center';
  ctx.font = '700 ' + Math.round(W * 0.042) + 'px ' + FONT;
  ctx.fillText(data.personName || '', W / 2, H * 0.46);

  // เรื่อง — ตัวหนา ย่อขนาดอัตโนมัติให้พอดีความกว้าง
  if (data.title && data.title.trim()) {
    setFit(data.title.trim(), Math.round(W * 0.032), W * 0.018, W * 0.8, '700', 'center', W / 2, H * 0.535);
  }

  // เนื้อหา — บรรทัดเดียว ย่อขนาดอัตโนมัติ
  if (data.body && data.body.trim()) {
    setFit(data.body.trim(), Math.round(W * 0.026), W * 0.016, W * 0.8, '', 'center', W / 2, H * 0.585);
  }

  // วันที่ — ต่อท้าย "ณ วันที่"
  ctx.textAlign = 'left';
  ctx.font = Math.round(W * 0.026) + 'px ' + FONT;
  ctx.fillText(data.dateTH || '', W * 0.45, H * dateY);

  // ผู้ลงนาม — ลายเซ็น + ชื่อ + ตำแหน่ง กลางล่าง
  ctx.textAlign = 'center';
  const parts = String(data.signer || '').match(/^([^()]+)(?:\((.*)\))?$/);
  const signerName = parts ? parts[1].trim() : String(data.signer || '');
  const signerPos = parts && parts[2] ? parts[2].trim() : '';
  const sigCX = W / 2;
  let nameY = H * 0.82;

  // ลายเซ็น — เหนือชื่อ; ถ้าสูงจนทับบรรทัดวันที่ → เลื่อนบล็อกลงและย่อให้พอดี
  if (sigImg && sigImg.naturalWidth) {
    const safeTop = H * (isTpl2 ? 0.735 : 0.715); // ขอบบนที่ลายเซ็นสูงได้
    const maxShift = H * 0.03; // เลื่อนลงได้ไม่เกินนี้ (กันล้นขอบล่าง)
    let sigW = W * 0.27;
    let sigH = sigW * (sigImg.naturalHeight / sigImg.naturalWidth);
    if (sigH > H * 0.16) {
      sigH = H * 0.16;
      sigW = sigH * (sigImg.naturalWidth / sigImg.naturalHeight);
    }
    let sigBottom = nameY - H * 0.02;
    let sigTop = sigBottom - sigH;
    if (sigTop < safeTop) {
      nameY += Math.min(safeTop - sigTop, maxShift);
      sigBottom = nameY - H * 0.02;
      const room = sigBottom - safeTop; // พื้นที่เหลือให้ลายเซ็น (ไม่บังวันที่)
      if (sigH > room && room > 0) {
        sigH = room;
        sigW = sigH * (sigImg.naturalWidth / sigImg.naturalHeight);
      }
    }
    ctx.drawImage(sigImg, sigCX - sigW / 2, sigBottom - sigH, sigW, sigH);
  }

  ctx.font = Math.round(W * 0.026) + 'px ' + FONT;
  ctx.fillText(signerName, sigCX, nameY);

  if (signerPos) {
    /*
     * ตำแหน่งยาวเกินกึ่งหน้ากระดาษ → ลองแยก "เขต N" ลงบรรทัดถัดไป แล้วย่อฟอนต์ให้พอดี
     * (ไม่ตัดกลางคำ)
     */
    let posLines = [signerPos];
    const pm = signerPos.match(/^(.+)[\s]+(เขต[\s]*\S*)$/);
    if (ctx.measureText(signerPos).width > W * 0.55 && pm && pm[1].trim() && pm[2].trim()) {
      posLines = [pm[1].trim(), pm[2].trim()];
    }
    let posFont = Math.round(W * 0.026);
    let longest = 0;
    for (const l of posLines) longest = Math.max(longest, ctx.measureText(l).width);
    if (longest > W * 0.55) {
      posFont = Math.max(Math.round(W * 0.018), Math.floor(posFont * (W * 0.55) / longest));
    }
    ctx.font = posFont + 'px ' + FONT;
    posLines
      .slice(0, 3)
      .forEach((ln, i) => ctx.fillText(ln, sigCX, nameY + H * (0.048 + i * 0.042)));
  }

  return cv;
}

/**
 * สร้างเกียรติบัตรจากข้อมูล → data URL
 * @param {object} data
 * @param {number} quality คุณภาพ JPEG (0..1)
 * @returns {Promise<string>}
 */
export async function renderHonorDataUrl(data, quality = 0.9) {
  const err = validateHonor(data);
  if (err) {
    UI.toast(err, 'error');
    return null;
  }
  await prepareHonorFonts();
  const img = await loadHonorTemplate(data.template);
  const sigImg = await loadHonorSignature(data.signerSignature);
  const cv = drawHonorOnTemplate(data, img, sigImg);
  return cv.toDataURL('image/jpeg', quality);
}

/**
 * อัปโหลดเกียรติบัตรขึ้นเซิร์ฟเวอร์ → ได้ path สำหรับผูกกับรายการ
 * @returns {Promise<string>} path ที่บันทึกไว้
 */
export async function saveHonorCertificate(data) {
  const dataUrl = await renderHonorDataUrl(data, 0.9);
  if (!dataUrl) return null;
  try {
    const r = await api.post('/honor-certificate', { image: dataUrl });
    if (!r || !r.path) throw new Error('ไม่ได้ path กลับมา');
    return r.path;
  } catch (e) {
    UI.toast(e.message || 'บันทึกไฟล์เกียรติบัตรไม่สำเร็จ', 'error');
    return null;
  }
}

/** พิมพ์เกียรติบัตรเป็น data URL (ต้องเรียกจากคลิกของผู้ใช้โดยตรง) */
export async function printHonor(data) {
  const dataUrl = await renderHonorDataUrl(data, 0.92);
  if (!dataUrl) return;
  try {
    const w = window.open('', '_blank', 'width=1100,height=800');
    if (!w) {
      UI.toast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต pop-up แล้วลองใหม่', 'error');
      return;
    }
    w.document.write(
      '<html><head><title>พิมพ์เกียรติบัตร</title><style>' +
        '@page { size: A4 landscape; margin: 0; }' +
        'html,body { margin:0; padding:0; height:100%; }' +
        'img { width:100%; height:100%; object-fit:contain; }' +
        '</style></head><body>' +
        '<img src="' +
        dataUrl +
        '" onload="setTimeout(function(){window.print();},300)" />' +
        '</body></html>',
    );
    w.document.close();
  } catch (e) {
    UI.toast('พิมพ์ไม่สำเร็จ: ' + (e.message || e), 'error');
  }
}

/**
 * พิมพ์จากไฟล์เกียรติบัตรที่บันทึกไว้แล้ว (คอลัมน์ "พิมพ์" ในตาราง)
 */
export function printHonorFile(filePath) {
  const src = '/uploads/' + UI.encodePath(filePath);
  const w = window.open(src, '_blank', 'width=1100,height=800');
  if (!w) {
    UI.toast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต pop-up แล้วลองใหม่', 'error');
    return;
  }
  w.document.write(
    '<html><head><title>พิมพ์เกียรติบัตร</title><style>' +
      '@page { size: A4 landscape; margin: 0; }' +
      'html,body { margin:0; padding:0; height:100%; }' +
      'img { width:100%; height:100%; object-fit:contain; }' +
      '</style></head><body>' +
      '<img src="' +
      src +
      '" onload="setTimeout(function(){window.print();},300)" />' +
      '</body></html>',
  );
  w.document.close();
}
