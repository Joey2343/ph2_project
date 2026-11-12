<script setup>
/**
 * LeaveApproveNote — หน้าต่างความเห็นผู้บังคับบัญชา (ขั้นที่ 2)
 *
 * ย้ายจาก Promise + UI.modal ใน LeaveView.decide() ตอน customLabel === 'อนุมัติขั้นต้น'
 *
 * ต่างจาก TravelDecide.vue: ขั้นนี้ไม่มีตัวเลือก checkbox แต่มีช่องข้อความอิสระ
 * ค่าเริ่มต้น "เห็นควรอนุญาต" และผู้อนุมัติแก้ได้ทั้งหมด
 *
 * ผู้ใช้สั่ง 12 พ.ย. 2569: แท็บ "ลาป่วย ลากิจ ลาคลอด (สถานศึกษา)"
 *   → เพิ่มส่วน "ตัวเลือกตำแหน่ง" **ก่อน** ส่วน "ความเห็นผู้บังคับบัญชา"
 *     (เฉพาะสายสถานศึกษา — สาย สพป. คงเดิม)
 */
import { ref, computed, watch } from 'vue';
import { UI } from '../../ui/ui.js';
import { Auth } from '../../stores/auth.js';
import AppModal from './AppModal.vue';

const props = defineProps({
  record: { type: Object, required: true },
  /** 'office' | 'school' — สายสถานศึกษาเท่านั้นที่มีตัวเลือกตำแหน่ง */
  scope: { type: String, default: 'office' },
});

const emit = defineEmits(['close', 'confirm']);

const DEFAULT_NOTE = 'เห็นควรอนุญาต';
const note = ref(DEFAULT_NOTE);
const position = ref('');

/** ตัวเลือกตำแหน่ง — ใช้ตำแหน่งจริงของผู้ลงนาม (สายสถานศึกษา) */
const posOptions = computed(() => {
  const p = String((Auth.user && Auth.user.position) || '').trim();
  return [p || 'ไม่ระบุตำแหน่ง'];
});

// เปิดใหม่ทุกครั้งที่เปลี่ยน record — ไม่อีกข้อความ/ตำแหน่งเดิมค้างมาจากรายการก่อน
watch(() => props.record, () => {
  note.value = DEFAULT_NOTE;
  position.value = posOptions.value[0] || '';
}, { immediate: true });

function confirm() {
  emit('confirm', {
    note: note.value,
    // ส่งตำแหน่งเฉพาะสายสถานศึกษา (สาย สพป. ไม่มีตัวเลือกนี้)
    position: props.scope === 'school' ? position.value : '',
  });
}
</script>

<template>
  <AppModal title="อนุมัติขั้นต้น" footer @close="emit('close')">
    <div style="font-size: 16px">
      <div style="margin-bottom: 15px">
        ต้องการอนุมัติขั้นต้นคำขอลา {{ record.leave_type }} ของ {{ UI.personName(record) }} ใช่หรือไม่?
      </div>

      <!-- ---------- ตัวเลือกตำแหน่ง (ก่อนความเห็น — ผู้ใช้สั่ง 12 พ.ย. 2569) ---------- -->
      <template v-if="scope === 'school'">
        <label style="font-weight: 700; display: block; margin-bottom: 5px">กรุณาเลือกตำแหน่งที่จะอนุมัติ/อนุญาต</label>
        <select
          id="lv-level1-position"
          v-model="position"
          style="width: 100%; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; margin-bottom: 15px; box-sizing: border-box"
        >
          <option v-for="p in posOptions" :key="p" :value="p">{{ p }}</option>
        </select>
      </template>

      <label style="font-weight: 700; display: block; margin-bottom: 5px">ความเห็นผู้บังคับบัญชา</label>
      <textarea
        v-model="note"
        style="width: 100%; min-height: 80px; padding: 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; box-sizing: border-box"
      ></textarea>
    </div>

    <template #footer>
      <button class="btn btn-outline" @click="emit('close')">ยกเลิก</button>
      <button class="btn btn-primary" @click="confirm">● อนุมัติขั้นต้น</button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
