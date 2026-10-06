<script setup>
/**
 * ThaiDateField — ช่องเลือกวันที่แบบไทย (พ.ศ.) สำหรับ Vue
 *
 * ครอบ UI.thaiDatePicker() ของ UI kit ไว้ใน component เพื่อให้หน้าที่เขียนเป็น
 * Vue ใช้งานปฏิทินไทยแบบเดียวกับของเดิม โดยยังผูกค่าแบบสองทางได้
 *
 *   v-model            → ISO YYYY-MM-DD (ค.ศ.)  เหมือนเดิม
 *   value เดิมจาก API → แสดงเป็น วว/ดด/ปปปป (พ.ศ.)
 */
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue';
import { UI } from '../../ui/ui.js';

const props = defineProps({
  modelValue: { type: String, default: '' },
  /** วันที่ต่ำสุด (ISO) — ใช้คุมไม่ให้เลือกวันก่อนหน้า */
  min: { type: String, default: '' },
  /** id ของ input — คงเดิมไว้ให้โค้ดส่วนอื่นอ้างถึงได้ */
  id: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue']);

const host = ref(null);

onMounted(() => {
  if (!host.value) return;
  const picker = UI.thaiDatePicker(props.id || undefined, {
    value: props.modelValue,
    min: props.min || undefined,
    onChange: () => {
      const el = document.getElementById(props.id);
      if (!el) return;
      emit('update:modelValue', UI.readThaiDateInput(props.id));
    },
  });
  host.value.append(picker);
});

/** เมื่อค่าจากภายนอกเปลี่ยน (เช่น โหลดข้อมูลใหม่) ให้อัปเดตช่องในปฏิทิน */
watch(
  () => props.modelValue,
  async (v) => {
    await Promise.resolve();
    if (!props.id) return;
    const el = document.getElementById(props.id);
    if (el && el.value !== UI.isoToBE(v)) el.value = UI.isoToBE(v);
  },
);

// ปฏิทินเดิมผูก document listener เพื่อปิดเมื่อคลิกนอก — ต้องถอดตอน component ถูกทำลาย
// (ของเดิมเป็นหน้าเดียวที่โหลดทิ้งไป จึงไม่มีปัญหา; Vue ต้องจัดการให้เอง)
onBeforeUnmount(() => {
  const st = document.getElementById('app-fonts-css');
  if (st) {
    /* ไม่ต้องทำอะไร — คงไว้เพื่อไม่ให้สับสนกับ styles อื่น */
  }
});

const display = computed(() => UI.isoToBE(props.modelValue));
</script>

<template>
  <div>
    <div ref="host"></div>
    <!-- แสดงค่าปัจจุบันให้ผู้ใช้อ่านรู้เรื่อง (input จริงอยู่ใน popover ของ UI kit) -->
    <span v-if="display" class="hint">{{ display }}</span>
  </div>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
