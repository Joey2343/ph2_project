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
 * ปลายทาง: `PUT /memos/:id/return` (backend บังคับให้ต้องมีข้อความเสมอ)
 *   → บันทึกข้อความกลับไปหาเจ้าของเรื่อง (status = returned)
 *   → แจ้งเตือนเจ้าของเรื่อง (การ์ดหน้าแรก + Telegram) พร้อมข้อความสิ่งที่ให้แก้ไข
 *   → เจ้าของแก้ไขแล้วส่งใหม่ เรื่องจะกลับเข้าสายอนุมัติขั้นเดิม
 */
import { ref, computed } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import AppModal from '../ui/AppModal.vue';

const props = defineProps({
  /** บันทึกข้อความที่จะคืนเรื่อง */
  memo: { type: Object, default: null },
});

/** ส่ง { id, row } ให้หน้าหลักอัปเดตเฉพาะแถวทันที */
const emit = defineEmits(['close', 'returned']);

const note = ref('');
const saving = ref(false);

const info = computed(() => props.memo || {});

async function sendBack() {
  const t = note.value.trim();
  if (!t) return UI.toast('กรุณากรอกสิ่งที่ให้แก้ไขก่อนคืนเรื่อง', 'error');
  saving.value = true;
  try {
    const res = await api.put(`/memos/${info.value.id}/return`, { note: t });
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
      <textarea
        v-model="note"
        rows="4"
        placeholder="ระบุให้ชัดว่าต้องแก้อะไร เช่น เรื่องไม่ตรงกับเนื้อหา / ควรเพิ่มรายละเอียด / แก้ผู้รับผิดชอบ"
        style="width: 100%"
      ></textarea>
      <div class="hint">
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
