<script setup>
/**
 * LeaveApproveNote — หน้าต่างความเห็นผู้บังคับบัญชา (ขั้นที่ 2)
 *
 * ย้ายจาก Promise + UI.modal ใน LeaveView.decide() ตอน customLabel === 'อนุมัติขั้นต้น'
 *
 * ต่างจาก TravelDecide.vue: ขั้นนี้ไม่มีตัวเลือก checkbox แต่มีช่องข้อความอิสระ
 * ค่าเริ่มต้น "เห็นควรอนุญาต" และผู้อนุมัติแก้ได้ทั้งหมด
 */
import { ref, watch } from 'vue';
import { UI } from '../../ui/ui.js';
import AppModal from './AppModal.vue';

const props = defineProps({
  record: { type: Object, required: true },
});

const emit = defineEmits(['close', 'confirm']);

const DEFAULT_NOTE = 'เห็นควรอนุญาต';
const note = ref(DEFAULT_NOTE);

// เปิดใหม่ทุกครั้งที่เปลี่ยน record — ไม่งั้นข้อความเดิมจะค้างมาจากรายการก่อน
watch(() => props.record, () => {
  note.value = DEFAULT_NOTE;
}, { immediate: true });
</script>

<template>
  <AppModal title="อนุมัติขั้นต้น" footer @close="emit('close')">
    <div style="font-size: 16px">
      <div style="margin-bottom: 15px">
        ต้องการอนุมัติขั้นต้นคำขอลา {{ record.leave_type }} ของ {{ UI.personName(record) }} ใช่หรือไม่?
      </div>
      <label style="font-weight: 700; display: block; margin-bottom: 5px">ความเห็นผู้บังคับบัญชา</label>
      <textarea
        v-model="note"
        style="width: 100%; min-height: 80px; padding: 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; box-sizing: border-box"
      ></textarea>
    </div>

    <template #footer>
      <button class="btn btn-outline" @click="emit('close')">ยกเลิก</button>
      <button class="btn btn-primary" @click="emit('confirm', note)">● อนุมัติขั้นต้น</button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
