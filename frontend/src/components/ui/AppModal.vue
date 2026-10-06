<script setup>
/**
 * AppModal — โครง modal สำหรับ Vue
 *
 * markup ตรงกับ UI.modal() ใน ui/ui.js ทุกส่วน:
 *   .modal-backdrop > .modal(.lg/.xxl/.full) > .modal-head > .modal-body (+ .modal-foot)
 *
 * ต่างกันแค่ 2 จุดที่จำเป็น:
 *   1. ล็อกการเลื่อนหน้า body ด้วย watcher แทนการเขียน document.body.style ตรง ๆ
 *   2. ปุ่มปิด / ปุ่มยกเลิก เรียก close ผ่าน emit ให้ component ที่เปิด modal จัดการ state
 *
 * หมายเหตุเรื่องพฤติกรรม: ระบบเดิม "คลิกพื้นหลังไม่ปิด" โดยเฉพาะ ๆ
 * จึงไม่มีการปิดเมื่อคลิกนอกกรอบ — คงพฤติกรรมนั้นไว้
 */
import { ref, watch, onBeforeUnmount, computed } from 'vue';

const props = defineProps({
  title: { type: String, default: '' },
  /** '' | 'lg' | 'xxl' | 'full' — ตรงกับค่าของ UI.modal() */
  size: { type: String, default: '' },
  /** แสดงแถบปุ่มด้านล่างหรือไม่ */
  footer: { type: Boolean, default: false },
  /** ไม่แสดงเส้นคั่นใต้หัวเรื่อง */
  flatHead: { type: Boolean, default: false },
});

const emit = defineEmits(['close']);

/** อ้างถึงกรอบของ modal ตัวเอง — ต้องใช้ตอนนับ modal ตัวอื่น */
const root = ref(null);

/**
 * ล็อก/ปลดล็อกการเลื่อนหน้าของ body ตามจำนวน modal ที่เปิดอยู่
 *
 * ⚠️ ต้องตัด "ตัวเอง" ออกจากการนับเสมอ ไม่งั้นจะค้างล็อกตลอด
 *
 *   เพราะ Vue เรียก onBeforeUnmount() ก่อนถอด element ออกจาก DOM
 *   ถ้านับรวมตัวเอง ตอนปิด modal จะเจอตัวเอง 1 ตัว → คิดว่ายังมี modal ค้าง → ล็อกค้าง
 *   ผลคือผู้ใช้เลื่อนหน้าไม่ได้หลังเปิด-ปิด modal ใด ๆ (เจอจริงระหว่างทดสอบหน้าแรก)
 */
function lock() {
  const others = [...document.querySelectorAll('[data-app-modal]')].filter((el) => el !== root.value);
  document.body.style.overflow = others.length > 0 ? 'hidden' : '';
}

watch(() => props.title, lock, { immediate: true });
onBeforeUnmount(lock);

const sizeClass = computed(() => ({ lg: 'lg', xxl: 'xxl', full: 'full' })[props.size] || '');
</script>

<template>
  <div ref="root" class="modal-backdrop" data-app-modal>
    <div class="modal" :class="sizeClass">
      <div class="modal-head" :class="{ 'modal-head-flat': flatHead }">
        <div class="modal-title">{{ title }}</div>
        <button class="modal-close" aria-label="ปิด" @click="emit('close')">✕</button>
      </div>
      <div class="modal-body">
        <slot />
      </div>
      <div v-if="footer" class="modal-foot">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ไม่เพิ่มสไตล์ — ใช้ของเดิมจาก theme.css ทั้งหมด */
</style>
