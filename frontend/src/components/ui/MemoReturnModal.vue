<script setup>
/**
 * MemoReturnModal — หน้าต่าง "คืนเรื่องเพื่อแก้ไข" บันทึกข้อความ
 *
 * ทำไมต้องมี
 * ──────────
 * เดิมผู้อนุมัติต้องเปิดหน้าต่าง "อนุมัติ" ก่อน แล้วเลื่อนลงไปสุดเพื่อหาส่วน
 * "ส่งกลับ/คืนเรื่องเพื่อแก้ไข" → ช้าและหาง่าย
 * ตอนนี้มีปุ่มในแถวรายการโดยตรง กดแล้วกรอก "สิ่งที่ให้แก้ไข" → คืนเรื่องได้ทันที
 *
 * เครื่องมือไฮไลท์ (ผู้ใช้ขอ)
 * ──────────────────────────
 * ช่อง "สิ่งที่ให้แก้ไข" เป็น editor ที่คลุมสีข้อความได้ (ส้ม · เหลือง · เขียว)
 * ใช้ document.execCommand('hiliteColor') เหมือน MemoRichEditor (ทั้งระบบใช้ API นี้)
 *
 * ⚠️ ข้อความที่เก็บเป็น HTML → ต้องทำความสะอาดด้วย sanitizeNoteHtml()
 *    ก่อนส่งให้ backend และก่อนแสดงด้วย v-html ในรายการ/ฟอร์มแก้ไข
 *
 * ปลายทาง: `PUT /memos/:id/return`
 *   → บันทึกข้อความกลับไปหาเจ้าของเรื่อง (status = returned)
 *   → แจ้งเตือนเจ้าของเรื่อง (การ์ดหน้าแรก + Telegram) พร้อมสิ่งที่ให้แก้ไข (ข้อความล้วน)
 *   → เจ้าของแก้ไขแล้วส่งใหม่ เรื่องจะกลับเข้าสายอนุมัติขั้นเดิม
 */
import { ref, computed } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import AppModal from '../ui/AppModal.vue';
import { sanitizeNoteHtml, notePlainText } from '../../lib/note-html.js';

const props = defineProps({
  /** บันทึกข้อความที่จะคืนเรื่อง */
  memo: { type: Object, default: null },
});

/** ส่ง { id, row } ให้หน้าหลักอัปเดตเฉพาะแถวทันที */
const emit = defineEmits(['close', 'returned']);

const editor = ref(null);
const saving = ref(false);

const info = computed(() => props.memo || {});

/** สีไฮไลท์ที่ให้เลือก (อ่อนพอให้อ่านตัวอักษรดำได้ชัด) */
const HIGHLIGHTS = [
  { label: 'ส้ม', color: '#fdba74', title: 'ไฮไลท์สีส้ม' },
  { label: 'เหลือง', color: '#fde047', title: 'ไฮไลท์สีเหลือง' },
  { label: 'เขียว', color: '#86efac', title: 'ไฮไลท์สีเขียว' },
];

/** คลุมสีข้อความที่เลือกไว้ */
function applyHighlight(color) {
  const el = editor.value;
  if (!el) return;
  el.focus();
  // ให้เบราว์เซอร์เขียนเป็น <span style="background-color:..."> ไม่ใช่ <font backColor>
  document.execCommand('styleWithCSS', false, true);
  document.execCommand('hiliteColor', false, color);
}

/** ลบไฮไลท์/รูปแบบของข้อความที่เลือก */
function clearHighlight() {
  const el = editor.value;
  if (!el) return;
  el.focus();
  document.execCommand('removeFormat');
}

async function sendBack() {
  const html = sanitizeNoteHtml(editor.value ? editor.value.innerHTML : '');
  if (!notePlainText(html)) {
    return UI.toast('กรุณากรอกสิ่งที่ให้แก้ไขก่อนคืนเรื่อง', 'error');
  }
  saving.value = true;
  try {
    const res = await api.put(`/memos/${info.value.id}/return`, { note: html });
    UI.toast(res.message);
    emit('returned', { id: info.value.id, row: res.row || null });
    emit('close');
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal v-if="memo" title="↩ คืนเรื่องเพื่อแก้ไข" size="md" footer @close="emit('close')">
    <div class="form-group">
      <label>บันทึกข้อความที่จะคืนเรื่อง</label>
      <div
        style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; line-height: 1.9"
      >
        <div><strong>{{ info.title || '-' }}</strong></div>
        <div class="hint">เลขที่: {{ info.doc_no || 'ยังไม่มีเลขที่' }}</div>
        <div class="hint">วันที่: {{ UI.date(info.date) }}</div>
        <div v-if="info.full_name" class="hint">ผู้จัดทำ: {{ (info.maker_title || '') + info.full_name }}</div>
      </div>
    </div>

    <div class="form-group">
      <label><span style="color: #ea580c">❗</span> สิ่งที่ให้แก้ไข</label>

      <!-- เครื่องมือไฮไลท์: คลุมสีข้อความที่เลือก -->
      <div class="hl-toolbar">
        <span class="hl-label">✏️ ไฮไลท์</span>
        <button
          v-for="h in HIGHLIGHTS"
          :key="h.color"
          type="button"
          class="hl-btn"
          :title="h.title"
          :style="{ background: h.color }"
          @mousedown.prevent
          @click="applyHighlight(h.color)"
        >
          {{ h.label }}
        </button>
        <button type="button" class="hl-btn hl-clear" title="ลบไฮไลท์ของข้อความที่เลือก" @mousedown.prevent @click="clearHighlight">
          ลบไฮไลท์
        </button>
      </div>

      <!-- เลือกข้อความแล้วกดสีเพื่อคลุมสี (ไม่ต้องกดปุ่มก่อน) -->
      <div
        id="memo-return-note"
        ref="editor"
        class="hl-editor"
        contenteditable="true"
        data-placeholder="ระบุให้ชัดว่าต้องแก้อะไร เช่น เรื่องไม่ตรงกับเนื้อหา / ควรเพิ่มรายละเอียด / แก้ผู้รับผิดชอบ"
      ></div>

      <div class="hint">
        เลือกข้อความที่ต้องการเน้น แล้วกดสีเพื่อไฮไลท์ ·
        เจ้าของเรื่องจะเห็นข้อความนี้ทันที พร้อมแจ้งเตือน (การ์ดหน้าแรก + Telegram)
        แล้วแก้ไขและส่งใหม่ตามลำดับขั้นได้
      </div>
    </div>

    <template #footer>
      <div style="display: flex; gap: 8px">
        <button class="btn btn-outline" @click="emit('close')">ยกเลิก</button>
        <button class="btn btn-sendback" :disabled="saving" @click="sendBack">
          {{ saving ? 'กำลังคืนเรื่อง...' : '↩ คืนเรื่องเพื่อแก้ไข' }}
        </button>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
/* แถบเครื่องมือไฮไลท์ */
.hl-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 6px 8px;
  border: 1px solid #d1d5db;
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  background: #f8fafc;
}
.hl-label {
  font-size: 13px;
  font-weight: 700;
  color: #475569;
  margin-right: 2px;
}
.hl-btn {
  padding: 3px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 700;
  color: #1f2937;
  cursor: pointer;
  line-height: 1.5;
}
.hl-btn:hover {
  filter: brightness(0.95);
}
.hl-clear {
  background: #fff;
  color: #64748b;
}

/*
 * ช่องพิมพ์ — ใช้ contenteditable (ไม่ใช่ textarea) เพื่อให้คลุมสีข้อความได้
 * ต้องกำหนด border ให้ต่อกับแถบเครื่องมือดูเป็นกล่องเดียว
 */
.hl-editor {
  min-height: 96px;
  max-height: 240px;
  overflow-y: auto;
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 0 0 8px 8px;
  background: #fff;
  line-height: 1.7;
  outline: none;
}
.hl-editor:focus {
  border-color: var(--primary, #0f766e);
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.12);
}
/* placeholder ของ contenteditable */
.hl-editor:empty::before {
  content: attr(data-placeholder);
  color: #9ca3af;
}
</style>
