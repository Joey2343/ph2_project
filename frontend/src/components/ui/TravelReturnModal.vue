<script setup>
/**
 * TravelReturnModal — ส่งกลับคำขอไปราชการเพื่อให้แก้ไข (ผู้ใช้สั่ง 26 พ.ย. 2569)
 *
 * ผู้ตรวจสอบ (ขั้นที่ 1 ของสายสถานศึกษา) ใช้ปุ่ม "ส่งกลับเพื่อแก้ไข"
 *   → กรอกสิ่งที่ให้แก้ไข → บันทึกเป็น travel_requests.revision_note (status = 'returned')
 *   → ผู้ยื่นแก้ไขแล้วบันทึก ระบบส่งเข้าสายอนุมัติใหม่ให้เอง
 */
import { ref } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import AppModal from './AppModal.vue';

const props = defineProps({
  /** record ที่กำลังส่งกลับ */
  record: { type: Object, default: null },
});

const emit = defineEmits(['close', 'done']);

const note = ref('');
const busy = ref(false);

function requesterName() {
  const r = props.record || {};
  const first = [(r.user_title || '') + (r.first_name || ''), r.last_name || ''].filter(Boolean).join(' ');
  return first || r.full_name || '';
}

async function submit() {
  if (busy.value) return;
  const text = String(note.value || '').trim();
  if (!text) {
    UI.toast('กรุณากรอกสิ่งที่ให้แก้ไขก่อนส่งกลับ', 'error');
    return;
  }
  const ok = await UI.confirm(
    `ส่งกลับคำขอของ ${requesterName()} เพื่อให้แก้ไขใช่หรือไม่?`,
    { okText: '↩ ส่งกลับเพื่อแก้ไข' },
  );
  if (!ok) return;
  busy.value = true;
  try {
    const res = await api.put(`/travel/${props.record.id}/return`, { note: text });
    UI.toast(res.message);
    emit('done', { id: props.record.id, row: res.row || null });
    emit('close');
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppModal title="↩ ส่งกลับเพื่อให้แก้ไข" size="lg" footer @close="emit('close')">
    <div style="font-size: 15px">
      <p style="margin-bottom: 10px">
        คำขอของ <b>{{ requesterName() }}</b> — ระบุสิ่งที่ให้แก้ไข แล้วผู้ยื่นจะแก้ไขและส่งคำขอใหม่ได้
      </p>
      <label style="font-weight: 700; display: block; margin-bottom: 6px">สิ่งที่ให้แก้ไข<span class="req"> *</span></label>
      <textarea
        id="travel-return-note"
        v-model="note"
        rows="4"
        placeholder="เช่น วันเดินทางไม่ถูกต้อง / ไม่ได้แนบหนังสืออนุมัติ / ค่าใช้จ่ายไม่ครบ"
        style="width: 100%; min-height: 90px; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; box-sizing: border-box; resize: vertical"
      ></textarea>
    </div>

    <template #footer>
      <button class="btn btn-outline" :disabled="busy" @click="emit('close')">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="busy" @click="submit">
        {{ busy ? 'กำลังส่งกลับ...' : '↩ ส่งกลับเพื่อแก้ไข' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
