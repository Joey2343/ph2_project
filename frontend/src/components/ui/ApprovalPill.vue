<script setup>
/**
 * ApprovalPill — ป้ายแสดงความคืบหน้าการอนุมัติ (ตรงกับ UI.approvalPill ของ UI kit)
 *
 * ย้ายเป็น component เพราะ UI.approvalPill() คืน **DOM element** ไม่ใช่สตริง
 * ถ้าเขียนในเทมเพลต Vue ว่า {{ UI.approvalPill(r) }}
 * Vue จะแปลง element เป็นข้อความ แล้วหน้าเว็บจะขึ้นว่า
 *   "[object HTMLSpanElement]"
 * วิธีแก้คือดึงข้อความกับสไตล์ออกมา แล้วให้ Vue วาดเอง
 * (แบบเดียวกับ StatusBadge.vue)
 */
import { computed } from 'vue';
import { UI } from '../../ui/ui.js';

const props = defineProps({
  /** แถวที่มีข้อมูลการอนุมัติ (required_levels, approvals ฯลฯ) */
  row: { type: Object, required: true },
});

const info = computed(() => {
  const el = UI.approvalPill(props.row);
  const s = el.style;
  return {
    text: el.textContent,
    style: {
      display: s.display,
      background: s.background,
      color: s.color,
      padding: s.padding,
      borderRadius: s.borderRadius,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      marginTop: s.marginTop,
    },
  };
});
</script>

<template>
  <span :style="info.style">{{ info.text }}</span>
</template>

<style scoped>
/* ใช้สไตล์ inline จาก UI kit ตัวจริง เหมือนของเดิมทุกประการ */
</style>
