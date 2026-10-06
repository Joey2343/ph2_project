<script setup>
/**
 * MemoRichEditor — เครื่องมือแก้ไขข้อความ rich text สำหรับบันทึกข้อความ
 *
 * ย้ายจาก MemosView.richEditor() ที่สร้าง DOM เอง
 * คง document.execCommand ไว้ เพราะเป็น API ของเบราว์เซอร์ที่ระบบเดิมใช้
 * และผลลัพธ์ (HTML) ถูกเก็บลงฐานข้อมูลและใช้แสดงในแบบฟอร์มทางการ
 *
 * ใช้ v-model เป็น HTML string
 */
import { ref, computed, onMounted, watch } from 'vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue']);

const editor = ref(null);

/** รายชื่อฟอนต์ — ใช้รายการที่ main.js โหลดจากโฟลเดอร์ font/ ถ้ายังไม่ทันใช้รายการสำรอง */
const fonts = computed(() =>
  window.APP_FONT_LABELS && window.APP_FONT_LABELS.length
    ? window.APP_FONT_LABELS
    : ['THSarabun', 'Sarabun', 'Angsana New', 'Cordia New', 'Tahoma', 'Arial'],
);

const SIZES = [14, 16, 18, 20, 24, 28, 32];

/** ใส่ค่าเริ่มต้น: ถ้าเป็น HTML ใช้ innerHTML, ถ้าเป็นข้อความธรรมดาใช้ textContent */
function setValue(v) {
  const el = editor.value;
  if (!el) return;
  if (v) {
    if (/<[a-z][\s\S]*>/i.test(v)) el.innerHTML = v;
    else el.textContent = v;
  } else {
    el.innerHTML = '';
  }
}

onMounted(() => setValue(props.modelValue));

// ค่าจากภายนอกเปลี่ยน (เช่น เปิดฟอร์มแก้ไขรายการอื่น) → อัปเดต editor
watch(
  () => props.modelValue,
  (v) => {
    // ไม่เขียนทับตอนผู้ใช้พิมพ์อยู่ (ค่าใน editor จะตรงกับ v อยู่แล้ว)
    if (editor.value && editor.value.innerHTML === v) return;
    setValue(v);
  },
);

function emitValue() {
  if (editor.value) emit('update:modelValue', editor.value.innerHTML);
}

/** ป้องกันการกด Enter หรือ format ทำให้ editor สูญเสีย focus ก่อนเก็บค่า */
function onMouseDown(e) {
  e.preventDefault();
}

function exec(cmd, arg) {
  if (editor.value) {
    editor.value.focus();
    document.execCommand(cmd, false, arg);
    emitValue();
  }
}

/** ขนาดอักษร: ใช้ font[size] กลางแล้วแปลงเป็น px (วิธีเดียวกับของเดิม) */
function setFont(px) {
  if (!px || !editor.value) return;
  editor.value.focus();
  document.execCommand('fontSize', false, '7');
  editor.value.querySelectorAll('font[size="7"]').forEach((sp) => {
    sp.removeAttribute('size');
    sp.style.fontSize = px + 'px';
  });
  emitValue();
}

const TOOLS = [
  { label: 'B', cmd: 'bold', title: 'ตัวหนา' },
  { label: 'I', cmd: 'italic', title: 'ตัวเอียง' },
  { label: 'U', cmd: 'underline', title: 'ขีดเส้นใต้' },
  { label: '• รายการ', cmd: 'insertUnorderedList', title: 'รายการแบบจุด' },
  { label: '1. รายการ', cmd: 'insertOrderedList', title: 'รายการแบบเลข' },
  { label: 'ซ้าย', cmd: 'justifyLeft', title: 'จัดชิดซ้าย' },
  { label: 'กลาง', cmd: 'justifyCenter', title: 'จัดกึ่งกลาง' },
  { label: 'ขวา', cmd: 'justifyRight', title: 'จัดชิดขวา' },
];
</script>

<template>
  <div>
    <div class="memo-toolbar">
      <select
        class="memo-tb-select"
        title="ฟอนต์"
        @change="exec('fontName', $event.target.value); $event.target.value = ''"
      >
        <option value="">ฟอนต์</option>
        <option v-for="f in fonts" :key="f" :value="f" :style="{ fontFamily: f }">{{ f }}</option>
      </select>

      <select class="memo-tb-select" title="ขนาดอักษร" @change="setFont(Number($event.target.value)); $event.target.value = ''">
        <option value="">ขนาด</option>
        <option v-for="px in SIZES" :key="px" :value="px">{{ px }} px</option>
      </select>

      <button
        v-for="t in TOOLS"
        :key="t.cmd"
        type="button"
        class="memo-tb"
        :title="t.title"
        @mousedown="onMouseDown"
        @click="exec(t.cmd)"
      >
        {{ t.label }}
      </button>
    </div>

    <div
      ref="editor"
      class="memo-editor"
      contenteditable="true"
      @input="emitValue"
      @blur="emitValue"
    ></div>
  </div>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
