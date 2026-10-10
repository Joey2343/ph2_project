<script setup>
/**
 * MemoFileGroup — กลุ่มแนบไฟล์ของบันทึกข้อความ
 *
 * ย้ายจาก MemosView.fileGroup() / fileRow() / collectFiles()
 *
 * 3 กลุ่มตามของเดิม:
 *   kind='ref'   อ้างถึง           (หลายไฟล์)
 *   kind='enc'   สิ่งที่ส่งมาด้วย   (หลายไฟล์)
 *   kind='draft' ร่างหนังสือส่ง     (ไฟล์เดียว)
 *
 * แต่ละแถว = เลือกไฟล์ + ตั้งชื่อไฟล์ + ลบแถว
 * แถวไฟล์เดิม (ตอนแก้ไข) จะ disable ช่องเลือกไฟล์และอ่านชื่อไม่ได้ → เก็บไฟล์เดิมไว้ฝั่งเซิร์ฟเวอร์
 */
import { ref, computed } from 'vue';
import { UI } from '../../ui/ui.js';

const props = defineProps({
  /** 'ref' | 'enc' | 'draft' */
  kind: { type: String, required: true },
  label: { type: String, required: true },
  /** JSON ของไฟล์เดิมตอนแก้ไข */
  existingJson: { type: String, default: '' },
  /** true = เลือกได้ไฟล์เดียว (ร่างหนังสือส่ง) */
  single: { type: Boolean, default: false },
});

const emit = defineEmits(['files']);

/** แถวที่ผู้ใช้เพิ่มใหม่ — เก็บ File object ไว้ใน memory แล้วส่งออกตอน save */
const newRows = ref([]);

const existing = computed(() => {
  try {
    const d = JSON.parse(props.existingJson || '[]');
    if (Array.isArray(d)) return d;
    if (d && d.file) return [d];
  } catch {
    /* ข้อมูลเสียรูปแบบ → ถือว่าไม่มีไฟล์เดิม */
  }
  return [];
});

/** ขนาดไฟล์สูงสุด 5 MB ต่อไฟล์ (ตรงกับฝั่งเซิร์ฟเวอร์) */
const MAX_BYTES = 5 * 1024 * 1024;

function fmtSize(bytes) {
  if (bytes === 0 || bytes === undefined || bytes === null) return '';
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}

function addRow() {
  // ร่างหนังสือส่งเลือกได้ไฟล์เดียว → แทนที่ของเดิมแทนที่จะเพิ่ม
  if (props.single) newRows.value = [{ file: null, name: props.label, size: 0 }];
  else newRows.value.push({ file: null, name: props.label, size: 0 });
}

function removeRow(i) {
  newRows.value.splice(i, 1);
}

function onPick(i, e) {
  const f = e.target.files && e.target.files[0];
  const row = newRows.value[i];
  if (!row) return;
  row.file = f || null;
  row.size = f ? f.size : 0;
}

/** ไฟล์ที่ใหญ่เกินลิมิต (คืนค่าข้อความเดียว เหมือนของเดิม) */
const tooLarge = computed(() => {
  for (const r of newRows.value) {
    if (r.file && r.file.size > MAX_BYTES) {
      // loop-exit: แสดงข้อความของไฟล์ที่ใหญ่เกินไปไฟล์แรกไฟล์เดียว
      return `ไฟล์ "${r.file.name}" ใหญ่เกินไป (สูงสุด 5 MB ต่อไฟล์) — กรุณาเลือกไฟล์เล็กลงหรือบีบอัดก่อนแนบ`; // loop-exit
    }
  }
  return '';
});

/**
 * แปลงเป็นรูปแบบที่ฟอร์มหลักจะใช้ต่อ
 * @returns {{files: File[], names: string[]}}
 */
function toPayload() {
  const files = [];
  const names = [];
  for (const r of newRows.value) {
    if (!r.file) continue;
    files.push(r.file);
    names.push((r.name || '').trim());
  }
  return { files, names };
}

defineExpose({ toPayload, tooLarge });

const rowStyle = { width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '8px' };
</script>

<template>
  <div class="form-group full">
    <label>{{ label }}<span v-if="!single" class="req"> *</span></label>

    <!-- ไฟล์เดิม (ตอนแก้ไข) — เก็บไว้ฝั่งเซิร์ฟเวอร์ ไม่ให้เลือกใหม่ -->
    <div v-for="f in existing" :key="'ex' + f.file" class="file-row">
      <div class="file-pick">
        <a
          class="file-size"
          style="color: #2563eb; text-decoration: underline"
          :href="'/uploads/' + UI.encodePath(f.file)"
          target="_blank"
        >
          ไฟล์เดิม
        </a>
      </div>
      <input type="text" class="fr-name" :value="f.name || f.file" readonly />
      <span style="width: 32px"></span>
    </div>

    <!-- แถวใหม่ -->
    <div v-for="(r, i) in newRows" :key="'new' + i" class="file-row">
      <div class="file-pick">
        <input
          type="file"
          class="fr-file"
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip"
          @change="onPick(i, $event)"
        />
        <div v-if="r.size" class="file-size" :class="{ over: r.size > MAX_BYTES }">
          ขนาดไฟล์: {{ fmtSize(r.size) }}
        </div>
      </div>
      <input v-model="r.name" type="text" class="fr-name" :placeholder="single ? 'ตั้งชื่อไฟล์' : 'ตั้งชื่อไฟล์'" :style="rowStyle" />
      <button type="button" class="btn btn-xs btn-outline fr-del" title="ลบแถวนี้" @click="removeRow(i)">
        ✕
      </button>
    </div>

    <div style="margin-top: 8px">
      <button type="button" class="btn btn-outline btn-sm" @click="addRow">
        {{ single ? '△ เลือกไฟล์' : '+ เพิ่มเอกสาร' }}
      </button>
    </div>

    <div v-if="tooLarge" class="file-size over" style="margin-top: 6px">{{ tooLarge }}</div>
  </div>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
