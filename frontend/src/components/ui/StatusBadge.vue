<script setup>
/**
 * StatusBadge — ป้ายสถานะ (ตรงกับ UI.badge และ UI.statusPill ของ UI kit)
 *
 * ย้ายเป็น component เพื่อให้หน้าที่เขียนเป็น Vue ใช้ป้ายสถานะเหมือนกันทุกหน้า
 * ข้อความและคลาสยังคงมาจาก UI kit รายการเดิมทุกตัว จึงไม่หลุดจากของเดิม
 */
import { computed } from 'vue';
import { UI } from '../../ui/ui.js';

const props = defineProps({
  status: { type: String, default: '' },
  /** 'badge' = ป้ายเล็กในตาราง · 'pill' = ป้ายใหญ่มน ๆ */
  variant: { type: String, default: 'badge' },
});

/** ดึงข้อความ + คลาส/สี จาก UI kit ตัวจริง เพื่อให้ผลลัพธ์ตรงกับของเดิมทุกประการ */
const info = computed(() => {
  if (props.variant === 'pill') {
    const el = UI.statusPill(props.status);
    return {
      text: el.textContent,
      cls: el.className,
      background: el.style.background,
      color: el.style.color,
    };
  }
  const el = UI.badge(props.status);
  return { text: el.textContent, cls: el.className, background: '', color: '' };
});
</script>

<template>
  <span
    :class="info.cls"
    :style="variant === 'pill' ? { background: info.background, color: info.color } : null"
  >
    {{ info.text }}
  </span>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
