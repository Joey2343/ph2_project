<script setup>
/**
 * DocumentsCertA4Modal — แบบฟอร์มหนังสือรับรอง ขนาด A4
 *
 * ย้ายจาก DocumentsView.showCertificateFormA4() + certFormA4Html() + printCertificateA4()
 *
 * ข้อควรระวัง
 *   - โลโก้และฟอนต์ถูกเสิร์ฟจาก backend (ไม่ใช่ Vite asset) → ต้องผูกเป็น runtime URL
 *   - หน้าต่างพิมพ์เปิดด้วย window.open แล้วเขียนเอกสารเอง
 *     เพราะเรียก window.print() ตรง ๆ จะถูกเบราว์เซอร์บล็อก pop-up
 *   - ย่อสเกล 0.78 เพื่อให้กระดาษ A4 พอดีกับ modal (ตอนพิมพ์จริงยังเป็น A4 เต็ม)
 */
import { ref, computed } from 'vue';
import { UI } from '../../ui/ui.js';
import { CERT_OFFICE_NAME, CERT_OFFICE_ADDR, CERT_OFFICE_ADDR2, TH_MONTHS } from '../../lib/documents.js';
import { CERT_PRINT_CSS } from '../../lib/cert-print-css.js';
import AppModal from '../ui/AppModal.vue';

const props = defineProps({
  /** record หนังสือรับรอง */
  doc: { type: Object, default: null },
});

const emit = defineEmits(['close']);

/** หลัง mount แล้วย่อกระดาษให้พอดี modal */
const scaled = ref(false);

/* ---------- สร้างเนื้อหาแบบฟอร์ม ---------- */

/** escape HTML — ค่ามาจากฐานข้อมูล จึงต้อง escape ก่อนแทรก */
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * วันที่แบบไทยแบบเต็ม (ไม่มีวันในสัปดาห์)
 * @param {string} iso YYYY-MM-DD
 */
function certDate(iso) {
  const p = String(iso).slice(0, 10).split('-');
  if (p.length !== 3) return String(iso);
  return parseInt(p[2], 10) + ' ' + TH_MONTHS[parseInt(p[1], 10) - 1] + ' พ.ศ.' + (parseInt(p[0], 10) + 543);
}

/** เนื้อหาแบบฟอร์ม (ใช้ทั้งใน modal และหน้าต่างพิมพ์) */
const formHtml = computed(() => {
  const d = props.doc || {};
  const body = String(d.body_text || '').trim();
  const note = String(d.note || '').trim();
  return (
    '<div class="cert-doc">' +
    '<div class="cert-doc-logo"><img src="/form/big_krut.png" alt="โลโก้"></div>' +
    '<div class="cert-doc-headrow">' +
    '<div class="cert-doc-no">' +
    esc(d.doc_no) +
    '</div>' +
    '<div class="cert-doc-officeblock">' +
    '<div>' +
    esc(CERT_OFFICE_NAME) +
    '</div>' +
    '<div>' +
    esc(CERT_OFFICE_ADDR) +
    '</div>' +
    '<div>' +
    esc(CERT_OFFICE_ADDR2) +
    '</div>' +
    '</div>' +
    '</div>' +
    (body
      ? '<div class="cert-doc-body">' +
        body
          .split('\n')
          .map((p, idx) => '<p' + (idx === 0 ? ' class="indent"' : '') + '>' + esc(p) + '</p>')
          .join('') +
        '</div>'
      : '') +
    (d.date ? '<div class="cert-doc-date">ให้ไว้ ณ วันที่ ' + certDate(d.date) + '</div>' : '') +
    (note ? '<div class="cert-doc-note-line">' + esc(note) + '</div>' : '') +
    '<div class="cert-doc-check">' +
    '<div>ร่าง........................</div>' +
    '<div>พิมพ์.....................</div>' +
    '<div>ทาน......................</div>' +
    '</div>' +
    '</div>'
  );
});

/* ---------- พิมพ์ ---------- */

/**
 * เปิดหน้าต่างพิมพ์ A4
 *
 * ต้องเรียกจาก event ของผู้ใช้โดยตรง (คลิกปุ่ม) ไม่ใช่หลัง await
 * เพราะเบราว์เซอร์จะบล็อก pop-up ถ้าหน้าต่างเปิดหลังสัญญาณผู้ใช้หายไป
 */
function print() {
  const w = window.open('', '_blank', 'width=940,height=1200');
  if (!w) {
    UI.toast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต pop-up', 'error');
    return;
  }
  w.document.write(
    '<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>หนังสือรับรอง</title>\n<style>\n' +
      CERT_PRINT_CSS +
      '</style></head><body>' +
      '<div class="toolbar"><button class="btn-close" onclick="window.close()">ปิด</button>' +
      '<button class="btn-print" onclick="window.print()">⬢ พิมพ์</button></div>\n' +
      formHtml.value +
      '\n</body></html>',
  );
  w.document.close();
  setTimeout(() => {
    try {
      w.focus();
      w.print();
    } catch {
      /* ผู้ใช้ปิดหน้าต่างไปแล้ว */
    }
  }, 600);
}

/* ย่อกระดาษหลัง modal วาดเสร็จ (ของเดิมใช้ setTimeout 50ms) */
setTimeout(() => {
  scaled.value = true;
}, 50);
</script>

<template>
  <AppModal v-if="doc" title="▭ แบบฟอร์มหนังสือรับรอง (A4)" size="lg" footer @close="emit('close')">
    <div style="background: #f0f2f5; padding: 14px; overflow: auto">
      <!--
        v-html จำเป็นเพราะเนื้อหานี้ถูกสร้างเป็น HTML ชุดเดียวกับที่ใช้ตอนพิมพ์
        ค่าที่แทรกผ่าน esc() ทั้งหมดแล้ว
      -->
      <div :style="scaled ? { transform: 'scale(0.78)', transformOrigin: 'top center' } : {}" v-html="formHtml" />
    </div>

    <template #footer>
      <button class="btn btn-outline" @click="emit('close')">ปิด</button>
      <button class="btn btn-primary" @click="print">⬢ พิมพ์</button>
    </template>
  </AppModal>
</template>

<style scoped>
/*
 * คลาส cert-doc* อยู่ใน styles/theme.css ของระบบเดิม
 * (ต้องเป็น global เพราะเนื้อหาถูกสร้างด้วย v-html ซึ่ง scoped style ไม่ครอบคลุม)
 */
</style>
