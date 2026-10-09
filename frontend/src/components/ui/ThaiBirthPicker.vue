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
import { computed, ref, watch } from 'vue';

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

/** รวม วัน/เดือน/ปี กลับเป็น ISO — ต้องครบทั้งสามค่า */
function toIso(p) {
  if (!p.day || !p.month || !p.year) return '';
  const ce = parseInt(p.year, 10) - 543;
  if (!ce || ce < 1) return '';
  return `${ce}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * ค่าที่เลือกไว้ เก็บไว้ใน component เอง
 *
 * ⚠️ ถ้าไม่เก็บไว้ การเลือกทีละช่องจะหายไป
 *
 *   ค่า v-model เป็น ISO ก้อนเดียว จึง "เก็บค่าไม่ครบไม่ได้"
 *   ถ้าเลือกวันก่อน (ยังไม่มีเดือน/ปี) แล้ว emit ค่าว่างกลับไป
 *   watcher ข้างล่างก็จะมาล้างช่องเดือนและปีทิ้ง → พอเลือกครบทั้ง 3 ช่อง
 *   กลับได้ค่าว่าง ไม่มีอะไรถูกบันทึก (เจอจริงตอนเพิ่งกรอกวันเกิดให้เจ้าหน้าที่คนใหม่)
 *
 * วิธีแก้: เก็บรายช่องไว้ใน draft แล้วค่อย emit เฉพาะตอนครบสามช่อง
 */
const draft = ref(parse(props.modelValue));

const day = computed({
  get: () => draft.value.day,
  set: (v) => emitParts({ day: v }),
});
const month = computed({
  get: () => draft.value.month,
  set: (v) => emitParts({ month: v }),
});
const year = computed({
  get: () => draft.value.year,
  set: (v) => emitParts({ year: v }),
});

/** รวมสามช่องแล้วส่งออก — ครบทั้งสามค่อยส่ง */
function emitParts(patch) {
  const next = { ...draft.value, ...patch };
  draft.value = next;

  const iso = toIso(next);
  if (iso) {
    emit('update:modelValue', iso);
  } else if (!next.day && !next.month && !next.year) {
    // ล้างทั้งหมด → คืนค่าว่างจริง ๆ
    emit('update:modelValue', '');
  }
  // เลือกแล้วยังไม่ครบ → เก็บใน draft เงียบ ๆ ไม่ emit
}

/** แม่เปลี่ยนค่ามาเอง (เช่นสลับไปแก้เจ้าหน้าที่คนอื่น) → ใช้ค่าใหม่ */
watch(
  () => props.modelValue,
  (v) => {
    const incoming = parse(v);
    // ถ้าเป็นค่าที่ตัวเองเพิ่ง emit ไป ไม่ต้องมาทับ draft
    if (toIso(incoming) !== toIso(draft.value)) draft.value = incoming;
  },
);

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
