<script setup>
/**
 * FilePicker — ช่องเลือกไฟล์ + ตัวอย่างรูป
 *
 * ย้ายจากโค้ดใน auth-legacy.js ที่ใช้ `input[type=file]` + `.file-preview`
 * แล้วสร้าง <img> จาก URL.createObjectURL(file)
 *
 * หมายเหตุ: URL.createObjectURL คืน URL ที่ปิดไม่ได้ จึงต้อง revoke
 * เมื่อเลือกไฟล์ใหม่หรือ component ถูกทำลาย (ของเดิมไม่ revoke — เป็นการรั่วเล็กน้อย
 * ที่แก้ไปได้โดยไม่กระทบหน้าตา)
 */
import { ref, watch, onBeforeUnmount } from 'vue';

const props = defineProps({
  /** ค่าของ field ใน form */
  modelValue: { type: [File, String], default: null },
  accept: { type: String, default: 'image/*' },
  label: { type: String, default: '' },
  required: { type: Boolean, default: false },
  /** id ของ input — ต้องตรงกับของเดิม เพื่อให้โค้ดส่วนอื่นอ้างถึงได้ */
  id: { type: String, default: '' },
  /** name ของ input — ต้องตรงกับของเดิม (ตอนสมัครใช้ photo / signature) */
  name: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue']);

const preview = ref('');
let objectUrl = null;

function clearUrl() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function revokeIfChanged(next) {
  if (next instanceof File && objectUrl !== next) clearUrl();
}

watch(
  () => props.modelValue,
  (v) => {
    revokeIfChanged(v);
    if (v instanceof File) {
      preview.value = URL.createObjectURL(v);
    } else {
      preview.value = '';
    }
  },
  { immediate: true },
);

onBeforeUnmount(clearUrl);

function onChange(e) {
  emit('update:modelValue', e.target.files && e.target.files[0] ? e.target.files[0] : null);
}
</script>

<template>
  <div class="form-group">
    <label v-if="label">
      {{ label }}
      <span v-if="required" class="req"> *</span>
    </label>
    <input :id="id" :name="name" type="file" :accept="accept" @change="onChange" />
    <div class="file-preview">
      <img v-if="preview" :src="preview" alt="preview" />
    </div>
  </div>
</template>

<style scoped>
/* ใช้ .form-group / .req / .file-preview จาก theme.css */
</style>
