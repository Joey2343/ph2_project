<script setup>
/**
 * DocumentsStampEditor — ตัวปั้มตรา/ลายเซ็นลงบนเอกสาร
 *
 * ย้ายจาก DocumentsView._stampOverlay() (163 บรรทัด) + openStampEditor() (8 บรรทัด) เป็น Vue SFC
 *
 * วิธีใช้
 *   1. เลือกเครื่องมือ: ปั้มรับ / เครื่องหมายถูก / ข้อความ / วันที่
 *   2. ลากปั้มรับจากแถบเครื่องมือลงหน้ากระดาษ หรือคลิกที่หน้ากระดาษตอนเครื่องมือ "ปั้มรับ" เลือกอยู่
 *   3. ลากย้าย / ลากมุมขวาล่างเพื่อย่อขยาย / กด ✕ เพื่อลบ
 *   4. กด "ปั้มรับ" → ได้ไฟล์ PDF (ถ้าต้นฉบับเป็น PDF) หรือ PNG (ถ้าต้นฉบับเป็นรูปภาพ)
 *
 * การคืนค่า: emit('stamped', file) ให้ผู้เรียกจัดการต่อ
 * (ของเดิมเขียนกลับลง input#df-file1 ด้วย DataTransfer ซึ่งผูกกับ DOM ของฟอร์มโมดุลเดิม
 *  การผูกผ่าน emit ทำให้ component นี้ไม่ต้องรู้จักฟอร์มข้างนอก)
 *
 * หมายเหตุ: ยังใช้ pdf.js (อ่านต้นฉบับ) + pdf-lib (ฝังภาพกลับเข้า PDF)
 * ซึ่งเป็นเหตุผลที่ dialog นี้อยู่ใน Vue แล้วแต่ยังต้องพึ่งสองไลบรารี PDF
 */
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { UI } from '../../ui/ui.js';
import { pdfjsLib, pdfWorkerUrl } from '../../lib/pdfjs.js';
import * as PDFLib from 'pdf-lib';

const props = defineProps({
  /** ไฟล์ต้นฉบับที่จะปั้ม (PDF หรือรูปภาพ) */
  file: { type: Object, required: true },
});

const emit = defineEmits(['close', 'stamped']);

/* ---------- หน้ากระดาษ ---------- */
/** [{ n: เลขหน้า }] — เรียงตามลำดับที่โหลด */
const pages = ref([]);
const canvasEls = ref([]);
const wrapEls = ref([]);

/** ผูก element ของแต่ละหน้าเข้า array (ต้องฟังก์ชัน ref) */
function setCanvas(el, i) {
  if (el) canvasEls.value[i] = el;
}
function setWrap(el, i) {
  if (el) wrapEls.value[i] = el;
}

const status = ref('กำลังโรย PDF...');
const loading = ref(true);

/* ---------- เครื่องมือ ---------- */
/** 'stamp' | 'symbol' | 'text' | 'date' | null (null = ไม่ได้เลือก) */
const tool = ref('stamp');

const textVal = ref('');
const textColor = ref('#3b82f6');
const textSize = ref(16);

const showTextPanel = computed(() => tool.value === 'text');

/** ปุ่มเครื่องมือที่ถูกเลือกอยู่ */
const activeTool = computed(() => tool.value);

function pickTool(t) {
  tool.value = t;
}

const datePopup = ref(false);

const TH_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const STAMP_SRC = '/form/pumprub.png';
const STAMP_W = 140;

/* ---------- สิ่งที่วางไว้ ---------- */
/**
 * placements = [{ id, page, type: 'image'|'symbol'|'text', left, top, w, fontSize, text, color }]
 * พิกัดเป็น CSS px ที่วัดจากมุมบนซ้ายของหน้ากระดาษ
 */
const placements = ref([]);
let nextId = 1;

/** รายการของหน้าที่ระบุ ใช้ใน template */
function itemsFor(page) {
  return placements.value.filter((p) => p.page === page);
}

/* ---------- เพิ่มสิ่งที่วาง ---------- */
function addStamp(page, x, y, w = STAMP_W) {
  placements.value.push({
    id: nextId++,
    page,
    type: 'image',
    left: Math.max(0, x - w / 2),
    top: Math.max(0, y - 20),
    w,
  });
}

function addText(page, x, y, text, color, size) {
  placements.value.push({
    id: nextId++,
    page,
    type: 'text',
    left: Math.max(0, x),
    top: Math.max(0, y - size),
    w: 0,
    text,
    color,
    fontSize: size,
  });
}

function addSymbol(page, x, y) {
  placements.value.push({
    id: nextId++,
    page,
    type: 'symbol',
    left: Math.max(0, x - 15),
    top: Math.max(0, y - 20),
    w: 0,
    text: '✔',
    color: '#3b82f6',
    fontSize: 24,
  });
}

/* ---------- คลิกบนหน้ากระดาษเพื่อวาง ---------- */
function onPageDown(page, e) {
  // คลิกที่ตัวที่วางไว้ → ไม่ต้องเพิ่มใหม่ (จัดการโดยตัวมันเอง)
  if (e.target.closest('.stamp-elem')) return;
  const r = wrapEls.value[page - 1].getBoundingClientRect();
  const sx = e.clientX - r.left;
  const sy = e.clientY - r.top;

  if (tool.value === 'text') {
    if (!textVal.value.trim()) {
      UI.toast('Enter text', 'error');
      return;
    }
    addText(page, sx, sy, textVal.value, textColor.value, parseInt(textSize.value, 10) || 16);
    return;
  }
  if (tool.value === 'symbol') {
    addSymbol(page, sx, sy);
    return;
  }
  if (tool.value === 'date') return; // วันที่ใช้ popup แยก
  addStamp(page, sx, sy);
}

/* ---------- ลากย้าย / ย่อขยาย / ลบ ---------- */
const drag = ref(null); // { id, mode:'move'|'resize', dx, dy, startW, startSize }
const ghost = ref(null); // ตำแหน่ง ghost ตอนลากปั้มจากแถบเครื่องมือ

function startMove(p, e) {
  // คลิกที่ปุ่มลบหรือหัวปรับขนาด → ไม่ให้ลาก
  if (e.target.closest('button') || e.target.classList.contains('rz')) return;
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget;
  const sr = el.getBoundingClientRect();
  drag.value = { id: p.id, mode: 'move', dx: e.clientX - sr.left, dy: e.clientY - sr.top };
  el.setPointerCapture(e.pointerId);
}

function startResize(p, e) {
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget.parentElement;
  el.setPointerCapture(e.pointerId);
  drag.value = { id: p.id, mode: 'resize', startW: p.w, startSize: p.fontSize || 16 };
}

function onPointerMove(e) {
  const d = drag.value;
  if (!d) return;
  const p = placements.value.find((x) => x.id === d.id);
  if (!p) return;

  if (d.mode === 'move') {
    const r = wrapEls.value[p.page - 1].getBoundingClientRect();
    p.left = e.clientX - r.left - d.dx;
    p.top = e.clientY - r.top - d.dy;
    return;
  }

  // ย่อขยาย: วัดจากมุมซ้ายบนของตัวที่วางไปถึงตำแหน่งเมาส์
  const el = wrapEls.value[p.page - 1].querySelector(`[data-id="${p.id}"]`);
  if (!el) return;
  const er = el.getBoundingClientRect();
  const nw = e.clientX - er.left;

  if (p.type === 'image') {
    const max = wrapEls.value[p.page - 1].getBoundingClientRect().width - 20;
    p.w = Math.max(40, Math.min(max, nw));
  } else if (p.type === 'text') {
    p.fontSize = Math.max(8, Math.round((d.startSize * nw) / 100));
  } else {
    p.fontSize = Math.max(16, Math.round((d.startSize * nw) / 50));
  }
}

function onPointerUp() {
  drag.value = null;
}

/** ลากปั้มจากแถบเครื่องมือมาวาง (ghost ตามเมาส์) */
function onSourceDown(e) {
  e.preventDefault();
  ghost.value = { x: e.clientX - 40, y: e.clientY - 30 };
  pickTool('stamp');
}

function onSourceMove(e) {
  if (!ghost.value) return;
  ghost.value = { x: e.clientX - 40, y: e.clientY - 30 };
}

function onSourceUp(e) {
  if (!ghost.value) return;
  ghost.value = null;
  const wraps = wrapEls.value;
  for (let i = 0; i < wraps.length; i++) {
    if (!wraps[i]) continue;
    const r = wraps[i].getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      addStamp(i + 1, e.clientX - r.left, e.clientY - r.top);
      return; // loop-exit — ลงตราประทับได้หน้าเดียวต่อคลิก
    }
  }
}

function removeItem(id) {
  placements.value = placements.value.filter((p) => p.id !== id);
}

function clearAll() {
  placements.value = [];
}

/* ---------- วันที่ (popup) ---------- */
const dateInput = ref('');
const todayISO = () => {
  const n = new Date();
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
};

function toggleDatePopup() {
  pickTool('date');
  if (datePopup.value) {
    datePopup.value = false;
    return;
  }
  dateInput.value = todayISO();
  datePopup.value = true;
}

/** ยืนยันวันที่ → วางข้อความวันที่ (สีแดง) ที่มุมบนซ้ายของหน้าแรก */
function confirmDate() {
  const val = dateInput.value;
  if (!val) {
    datePopup.value = false;
    return;
  }
  const d = new Date(val);
  const thai = d.getDate() + ' ' + TH_MONTHS[d.getMonth()] + ' ' + (d.getFullYear() + 543);
  if (pages.value.length) addText(1, 20, 40, thai, '#ef4444', 16);
  tool.value = null;
  datePopup.value = false;
}

function cancelDate() {
  tool.value = null;
  datePopup.value = false;
}

/* ---------- โหลดไฟล์ ---------- */
async function load() {
  const f = props.file;

  if (f.type === 'application/pdf') {
    try {
      const buf = await f.arrayBuffer();
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      status.value = 'PDF ' + pdf.numPages + ' pages';
      for (let n = 1; n <= pdf.numPages; n++) {
        pages.value.push({ n });
        await nextTick();
        const cv = canvasEls.value[n - 1];
        if (!cv) continue;
        const pg = await pdf.getPage(n);
        const vp = pg.getViewport({ scale: 1.2 });
        cv.width = vp.width;
        cv.height = vp.height;
        await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      }
    } catch (e) {
      status.value = 'Error: ' + e.message;
    }
  } else if (f.type.startsWith('image/')) {
    const url = URL.createObjectURL(f);
    try {
      const im = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('อ่านไฟล์รูปภาพไม่สำเร็จ'));
        i.src = url;
      });
      pages.value.push({ n: 1 });
      await nextTick();
      const cv = canvasEls.value[0];
      if (cv) {
        const mw = Math.min(window.innerWidth - 100, 900);
        const sc = Math.min(mw / im.width, 1.5);
        cv.width = im.width * sc;
        cv.height = im.height * sc;
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      }
      status.value = 'Image loaded';
    } catch (e) {
      status.value = 'Error: ' + e.message;
    } finally {
      URL.revokeObjectURL(url);
    }
  } else {
    status.value = 'Unsupported file';
  }

  loading.value = false;
}

/* ---------- ปั้มจริง ---------- */
const saving = ref(false);

async function applyStamp() {
  if (saving.value) return;
  if (!placements.value.length) {
    UI.toast('กรุณาวางสิ่งที่ต้องการปั้มก่อน', 'error');
    return;
  }
  saving.value = true;

  try {
    // โหลดรูปปั้มรับ (มี timeout เผื่อไฟล์โหลดไม่ขึ้น)
    const stampImg = new Image();
    stampImg.src = STAMP_SRC;
    await new Promise((res) => {
      stampImg.onload = res;
      stampImg.onerror = res;
      setTimeout(res, 1000);
    });

    const isPdf = props.file.type === 'application/pdf';

    // วาดทุกอย่างลง canvas ชั่วคราวทีละหน้า
    const pageImages = [];
    for (let ci = 0; ci < pages.value.length; ci++) {
      const cv = canvasEls.value[ci];
      if (!cv) continue;
      const pn = ci + 1;

      const tmp = document.createElement('canvas');
      tmp.width = cv.width;
      tmp.height = cv.height;
      const ctx = tmp.getContext('2d');
      ctx.drawImage(cv, 0, 0);

      const wrap = wrapEls.value[ci];
      const wr = wrap.getBoundingClientRect();

      for (const x of placements.value.filter((p) => p.page === pn)) {
        const el = wrap.querySelector(`[data-id="${x.id}"]`);
        if (!el) continue;
        const er = el.getBoundingClientRect();

        // แปลงจาก CSS px → canvas px (หน้ากระดาษอาจถูกย่อ/ขยายตามจอ)
        const ox = ((er.left - wr.left) / wr.width) * cv.width;
        const oy = ((er.top - wr.top) / wr.height) * cv.height;
        const ow = (er.width / wr.width) * cv.width;

        if (x.type === 'image') {
          ctx.drawImage(stampImg, ox, oy, ow, ow * (stampImg.naturalHeight / stampImg.naturalWidth || 1));
        } else if (x.type === 'symbol') {
          ctx.font = x.fontSize + 'px sans-serif';
          ctx.fillStyle = x.color || '#3b82f6';
          ctx.fillText((x.text || '').trim(), ox, oy + 20);
        } else {
          ctx.font = (x.fontSize || 16) + 'px TH SarabunNew, sans-serif';
          ctx.fillStyle = x.color || '#000';
          ctx.fillText((x.text || '').trim(), ox, oy + (x.fontSize || 16));
        }
      }

      const imgData = await new Promise((res) => tmp.toBlob(res, 'image/png'));
      pageImages.push({ data: imgData, width: cv.width, height: cv.height });
    }

    // ประกอบกลับเป็นไฟล์เดิม
    let resultBlob = null;
    if (isPdf) {
      const origBytes = await props.file.arrayBuffer();
      const pdfDoc = await PDFLib.PDFDocument.load(origBytes);
      for (let pi = 0; pi < pageImages.length; pi++) {
        const pg = pdfDoc.getPage(pi);
        const dims = pg.getSize();
        const imgBytes = await pageImages[pi].data.arrayBuffer();
        const imgEmbed = await pdfDoc.embedPng(imgBytes);
        pg.drawImage(imgEmbed, { x: 0, y: 0, width: dims.width, height: dims.height });
      }
      resultBlob = new Blob([await pdfDoc.save()], { type: 'application/pdf' });
    } else if (pageImages.length > 0) {
      resultBlob = new Blob([await pageImages[0].data.arrayBuffer()], { type: 'image/png' });
    }

    if (!resultBlob) {
      UI.toast('ไม่สามารถปั้มไฟล์ได้', 'error');
      return;
    }

    const ext = isPdf ? '.pdf' : '.png';
    const mime = isPdf ? 'application/pdf' : 'image/png';
    const fname = String(props.file.name).split('.').slice(0, -1).join('.') + ext;

    emit('stamped', new File([resultBlob], fname, { type: mime }));
    emit('close');
  } catch (e) {
    UI.toast('ข้อผิดพลาด: ' + e.message, 'error');
  } finally {
    saving.value = false;
  }
}

/* ---------- สีของปุ่มเครื่องมือ ---------- */
function toolStyle(name) {
  const on = activeTool.value === name;
  const base = 'padding:4px 12px;font-size:13px;';
  if (name === 'symbol') {
    return base + 'font-size:18px;color:#3b82f6;border:1px solid #3b82f6;background:' + (on ? '#dbeafe' : '#fff') + (on ? ';border-color:#16a34a' : '');
  }
  const color = name === 'date' ? '#ef4444' : '#3b82f6';
  return (
    base +
    'color:' +
    color +
    ';border:1px solid ' +
    color +
    ';background:' +
    (on ? '#dbeafe' : '#fff') +
    (on ? ';border-color:#16a34a' : '')
  );
}

onMounted(load);
onBeforeUnmount(() => {
  drag.value = null;
  ghost.value = null;
});
</script>

<template>
  <div class="stamp-overlay">
    <!-- ---------- แถบหัวเรื่อง ---------- -->
    <div class="stamp-head">
      <span>🔼️ Stamp Document</span>
      <button class="btn-stamp-close" @click="emit('close')">✕ ปิด</button>
    </div>

    <!-- ---------- แถบเครื่องมือ ---------- -->
    <div class="stamp-toolbar">
      <div
        class="stamp-source"
        :style="activeTool === 'stamp' ? 'border-color:#16a34a;background:#dbeafe' : ''"
        @click="pickTool('stamp')"
        @pointerdown="onSourceDown"
        @pointermove="onSourceMove"
        @pointerup="onSourceUp"
        @pointercancel="onSourceUp"
      >
        <img :src="STAMP_SRC" alt="ปั้มรับ" style="height: 36px; pointer-events: none" />
        <span>ปั้มรับ</span>
      </div>

      <button class="btn btn-outline" style="padding: 4px 10px" :style="toolStyle('symbol')" title="เครื่องหมายถูก" @click="pickTool('symbol')">
        ✔
      </button>
      <button class="btn btn-outline" :style="toolStyle('text')" @click="pickTool('text')">✍️ Text</button>
      <button class="btn btn-outline" :style="toolStyle('date')" @click="toggleDatePopup">◷ Date</button>
      <button class="btn btn-outline" style="margin-left: auto" @click="clearAll">✖ ล้างทั้งหมด</button>
    </div>

    <!-- ---------- แผงตั้งค่าข้อความ ---------- -->
    <div v-show="showTextPanel" class="stamp-text-panel">
      <span>Text:</span>
      <input v-model="textVal" style="width: 200px; padding: 4px" />
      <span>Color:</span>
      <input v-model="textColor" type="color" style="width: 40px; height: 28px" />
      <span>Size:</span>
      <input v-model.number="textSize" type="number" min="8" max="72" style="width: 60px; padding: 4px" />
    </div>

    <!-- ---------- หน้ากระดาษ ---------- -->
    <div class="stamp-pages" @pointermove="onPointerMove" @pointerup="onPointerUp">
      <div
        v-for="p in pages"
        :key="p.n"
        :ref="(el) => setWrap(el, p.n - 1)"
        class="stamp-page"
        @pointerdown="onPageDown(p.n, $event)"
      >
        <div class="stamp-page-no">{{ p.n }}/{{ pages.length }}</div>
        <canvas :ref="(el) => setCanvas(el, p.n - 1)" />

        <!-- สิ่งที่วางไว้บนหน้านี้ -->
        <div
          v-for="x in itemsFor(p.n)"
          :key="x.id"
          class="stamp-elem"
          :data-id="x.id"
          :style="{
            left: x.left + 'px',
            top: x.top + 'px',
            ...(x.type === 'image'
              ? {}
              : {
                  color: x.color,
                  fontSize: x.fontSize + 'px',
                }),
          }"
          @pointerdown="startMove(x, $event)"
        >
          <img v-if="x.type === 'image'" :src="STAMP_SRC" :style="{ width: x.w + 'px' }" alt="" />
          <template v-else>{{ x.text }}</template>

          <button class="stamp-del" @click="removeItem(x.id)">✕</button>
          <div class="rz" @pointerdown="startResize(x, $event)">⤡</div>
        </div>
      </div>
    </div>

    <!-- ---------- สถานะ ---------- -->
    <div class="stamp-status">{{ status }}</div>

    <!-- ---------- ปุ่มปั้มรับ ---------- -->
    <div class="stamp-bar">
      <button class="btn btn-primary" :disabled="saving || loading" @click="applyStamp">
        {{ saving ? 'กำลังปั้ม...' : 'ปั้มรับ' }}
      </button>
    </div>

    <!-- ---------- popup เลือกวันที่ ---------- -->
    <div v-if="datePopup" class="stamp-date-popup">
      <div class="sd-title">เลือกวันที่</div>
      <input v-model="dateInput" type="date" class="sd-input" @keyup.enter="confirmDate" />
      <div class="sd-btns">
        <button class="sd-ok" @click="confirmDate">ตกลง</button>
        <button class="sd-cancel" @click="cancelDate">ยกเลิก</button>
      </div>
    </div>

    <!-- ---------- ghost ตอนลากปั้มจากแถบเครื่องมือ ---------- -->
    <img v-if="ghost" :src="STAMP_SRC" :style="{ position: 'fixed', pointerEvents: 'none', zIndex: 10000, opacity: 0.8, height: '60px', left: ghost.x + 'px', top: ghost.y + 'px' }" alt="" />
  </div>
</template>

<style scoped>
.stamp-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: #fff;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.stamp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  background: #1e293b;
  color: #fff;
  flex-shrink: 0;
}
.stamp-head span {
  font-size: 18px;
  font-weight: bold;
}

.btn-stamp-close {
  background: #ef4444;
  color: #fff;
  border: none;
  padding: 6px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.stamp-toolbar {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding: 8px 20px;
  background: #f1f5f9;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
  align-items: center;
}

.stamp-source {
  cursor: grab;
  padding: 4px;
  border: 2px solid #3b82f6;
  border-radius: 6px;
  background: #fff;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.stamp-text-panel {
  display: flex;
  padding: 8px 20px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
  gap: 8px;
  font-size: 13px;
  align-items: center;
}

.stamp-pages {
  flex: 1;
  overflow: auto;
  background: #e2e8f0;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.stamp-page {
  position: relative;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  margin-bottom: 16px;
}
.stamp-page canvas {
  display: block;
}

.stamp-page-no {
  position: absolute;
  top: 4px;
  right: 8px;
  font-size: 12px;
  color: #64748b;
  background: rgba(255, 255, 255, 0.8);
  padding: 2px 8px;
  border-radius: 4px;
  pointer-events: none;
}

.stamp-elem {
  position: absolute;
  cursor: move;
  user-select: none;
  font-family: 'TH SarabunNew', sans-serif;
  white-space: nowrap;
  font-weight: normal;
  text-shadow: 1px 1px 2px rgba(255, 255, 255, 0.8);
}
.stamp-elem img {
  display: block;
  pointer-events: none;
}

.stamp-del {
  position: absolute;
  top: -8px;
  right: -8px;
  background: #ef4444;
  color: #fff;
  border: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 12px;
  line-height: 20px;
  text-align: center;
  padding: 0;
  z-index: 2;
}

.rz {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 16px;
  height: 16px;
  background: #3b82f6;
  cursor: nwse-resize;
  border-radius: 0 0 4px 0;
  font-size: 10px;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}

.stamp-status {
  font-size: 12px;
  color: #64748b;
  padding: 4px 20px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.stamp-bar {
  text-align: right;
  padding: 8px 20px;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
  flex-shrink: 0;
}

.stamp-date-popup {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: #fff;
  border: 2px solid #3b82f6;
  border-radius: 12px;
  padding: 20px;
  z-index: 999999;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  min-width: 280px;
}
.sd-title {
  font-size: 16px;
  font-weight: bold;
  margin-bottom: 12px;
  color: #334155;
}
.sd-input {
  width: 100%;
  padding: 10px;
  font-size: 16px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  box-sizing: border-box;
}
.sd-btns {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.sd-ok,
.sd-cancel {
  flex: 1;
  padding: 10px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
}
.sd-ok {
  background: #3b82f6;
  color: #fff;
}
.sd-cancel {
  background: #e5e7eb;
  color: #374151;
}
</style>
