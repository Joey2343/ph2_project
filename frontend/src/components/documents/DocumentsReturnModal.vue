<script setup>
/**
 * DocumentsReturnModal — หน้าต่าง "ส่งกลับเพื่อแก้ไข" หนังสือที่สถานศึกษาส่งเข้ามา
 *
 * ทำไมต้องมี
 * ──────────
 * โรงเรียนส่งหนังสือเข้ามาที่ สพป. แล้วข้อมูลผิด
 * เดิมต้องโทรหรือไปบอกให้แก้ แล้วส่งใหม่อีกรอบ → เสียเวลา
 * ตอนนี้ สพป. กดส่งกลับพร้อมระบุสาเหตุ → โรงเรียนเห็นในรายการหนังสือส่งของตัวเองทันที
 *
 * ⚠️ ต้องมีช่องใส่สาเหตุเสมอ (backend บังคับด้วย)
 *   ไม่กรอก = โรงเรียนไม่รู้จะแก้อะไร เสียเวลาถามกลับ
 *
 * ปุ่มใช้ class .btn-sendback ของ theme.css (ห้ามแก้ theme.css — verify:build เทียบ SHA256)
 */
import { ref, computed } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import AppModal from '../ui/AppModal.vue';

const props = defineProps({
  /** หนังสือที่กำลังจะส่งกลับ */
  doc: { type: Object, default: null },
});

/** 'returned' = ส่งกลับเสร็จแล้ว (ส่ง { id, row } ให้หน้าหลักอัปเดตแถวทันที) */
const emit = defineEmits(['close', 'returned']);

const note = ref('');
const saving = ref(false);

/** ข้อมูลหนังสือที่จะแสดงให้ผู้ใช้ยืนยันก่อนส่งกลับ */
const info = computed(() => props.doc || {});
const wasReturned = computed(() => info.value.status === 'returned');

async function sendBack() {
  const t = note.value.trim();
  if (!t) return UI.toast('กรุณากรอกสาเหตุที่ส่งกลับเพื่อแก้ไข', 'error');
  saving.value = true;
  try {
    const res = await api.put(`/documents/${info.value.id}/return`, { note: t });
    /*
     * กันข้อความที่ส่งไปเป็นเครื่องหมาย (?) ทั้งหมด
     * backend ปฏิเสธอยู่แล้ว แต่เช็คซ้ำฝั่งหน้าเว็บเพื่อจับกรณีที่ backend รุ่นเก่ายังไม่มี
     */
    if (/^[\s?]+$/.test(t)) {
      UI.toast('ข้อความที่ส่งไปมีแต่เครื่องหมาย (?) ลองคัดลอกข้อความภาษาไทยมาวางแทนการพิมพ์', 'error');
      return;
    }
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
  <AppModal v-if="doc" title="↩ ส่งกลับเพื่อแก้ไข" size="md" footer @close="emit('close')">
    <div class="form-group">
      <label>หนังสือที่จะส่งกลับ</label>
      <div
        style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; line-height: 1.9"
      >
        <div><strong>{{ info.title || '-' }}</strong></div>
        <div class="hint">เลขที่: {{ info.reg_no || info.doc_no || 'ยังไม่มีเลขที่' }}</div>
        <div class="hint">จาก: {{ info.from_org || '-' }}</div>
        <div class="hint">ไป: {{ info.to_org || '-' }}</div>
        <div class="hint">วันที่: {{ UI.date(info.date) }}</div>
      </div>
    </div>

    <div v-if="wasReturned && info.revision_note" class="form-group">
      <label><span style="color: #ea580c">↩</span> เคยส่งกลับไปแล้วเมื่อ {{ UI.date(info.returned_at) }}</label>
      <div
        style="background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 10px 12px; color: #92400e; font-weight: 600"
      >
        {{ info.revision_note }}
      </div>
      <div class="hint">กดส่งกลับอีกครั้งเพื่อแจ้งสาเหตุใหม่ (ข้อความเดิมจะถูกแทนที่)</div>
    </div>

    <div class="form-group">
      <label><span style="color: #ea580c">❗</span> สาเหตุที่ส่งกลับเพื่อแก้ไข</label>
      <textarea
        v-model="note"
        rows="4"
        placeholder="ระบุให้ชัดว่าต้องแก้อะไร เช่น เลขที่หนังสือไม่ถูก / ชื่อเรื่องต้องแก้ / ปลายทางไม่ถูกต้อง"
        style="width: 100%"
      ></textarea>
      <div class="hint">ผู้ส่งหนังสือจะเห็นข้อความนี้ทันที พร้อมแจ้งเตือนทาง Telegram</div>
    </div>

    <template #footer>
      <div style="display: flex; gap: 8px">
        <button class="btn btn-outline" @click="emit('close')">ยกเลิก</button>
        <button class="btn btn-sendback" :disabled="saving" @click="sendBack">
          {{ saving ? 'กำลังส่งกลับ...' : '↩ ส่งกลับเพื่อแก้ไข' }}
        </button>
      </div>
    </template>
  </AppModal>
</template>