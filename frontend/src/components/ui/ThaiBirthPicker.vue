<script setup>
/**
 * ThaiBirthPicker — ช่องเลือก วัน / เดือน / ปี พ.ศ.
 *
 * ย้ายจาก UI.thaiBirthPicker() ใน ui/ui.js มาเป็น Vue component
 * ช่วงปี = ปี พ.ศ. ปัจจุบัน ย้อนหลัง 90 ปี (เหมือนของเดิม)
 *
 * ค่าที่ส่งออก: ISO YYYY-MM-DD (ค.ศ.) ใน v-model
 * ถ้าเลือกไม่ครบสามช่อง จะคืนค่าว่าง
 */
import { computed } from 'vue';

const props = defineProps({
  /** ค่าเริ่มต้นรูปแบบ YYYY-MM-DD (ค.ศ.) */
  modelValue: { type: String, default: '' },
  /**
   * คำนำหน้าของ id เช่น 'reg-birth' → reg-birth-day / -month / -year
   * ต้องตรงกับของเดิม เพื่อให้โค้ดส่วนอื่นที่อ้างถึง id เหล่านี้ยังทำงานได้
   */
  prefix: { type: String, default: 'birth' },
});

const emit = defineEmits(['update:modelValue']);

const MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const now = new Date();
const maxBE = now.getFullYear() + 543;
const minBE = maxBE - 90;

/** แยกค่าเริ่มต้นเป็น วัน / เดือน / ปี(พ.ศ.) */
function parse(iso) {
  if (!iso) return { day: '', month: '', year: '' };
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { day: '', month: '', year: '' };
  return { day: String(parseInt(m[3], 10)), month: String(parseInt(m[2], 10)), year: String(parseInt(m[1], 10) + 543) };
}

const parts = computed(() => parse(props.modelValue));

const day = computed({
  get: () => parts.value.day,
  set: (v) => emitParts({ day: v }),
});
const month = computed({
  get: () => parts.value.month,
  set: (v) => emitParts({ month: v }),
});
const year = computed({
  get: () => parts.value.year,
  set: (v) => emitParts({ year: v }),
});

/** รวมสามช่องเป็น ISO แล้วส่งออก — ครบทั้งสามค่อยส่ง */
function emitParts(patch) {
  const next = { ...parts.value, ...patch };
  if (!next.day || !next.month || !next.year) {
    emit('update:modelValue', '');
    return;
  }
  const ce = parseInt(next.year, 10) - 543;
  if (ce < 1) {
    emit('update:modelValue', '');
    return;
  }
  emit('update:modelValue', `${ce}-${String(next.month).padStart(2, '0')}-${String(next.day).padStart(2, '0')}`);
}

/** ปี พ.ศ. เรียงจากใหม่ไปเก่า */
const years = Array.from({ length: maxBE - minBE + 1 }, (_, i) => maxBE - i);
const days = Array.from({ length: 31 }, (_, i) => i + 1);
</script>

<template>
  <div class="birth-row">
    <select :id="prefix + '-day'" class="birth-select" v-model="day">
      <option value="">วัน</option>
      <option v-for="d in days" :key="d" :value="String(d)">{{ d }}</option>
    </select>
    <select :id="prefix + '-month'" class="birth-select" v-model="month">
      <option value="">เดือน</option>
      <option v-for="(m, i) in MONTHS" :key="i" :value="String(i + 1)">{{ m }}</option>
    </select>
    <select :id="prefix + '-year'" class="birth-select" v-model="year">
      <option value="">ปี พ.ศ.</option>
      <option v-for="y in years" :key="y" :value="String(y)">{{ y }}</option>
    </select>
  </div>
</template>

<style scoped>
/* ใช้ .birth-row / .birth-select จาก theme.css ของเดิม */
</style>
