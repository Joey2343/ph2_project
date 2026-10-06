<script setup>
/**
 * DocumentsSchoolPrefixModal — กำหนดเลขหนังสือสถานศึกษา
 *
 * ย้ายจาก DocumentsView.openSetSchoolDocPrefix() (25 บรรทัด)
 *
 * เลขหนังสือสถานศึกษาจะขึ้นต้นด้วย "ที่ ศธ 04110.<ค่านี้>"
 * เจ้าหน้าที่สถานศึกษาแต่ละแห่งจึงต้องกำหนดค่าของตัวเอง
 */
import { ref } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import AppModal from '../ui/AppModal.vue';

const props = defineProps({
  /** ค่าเลขหนังสือปัจจุบันของสถานศึกษานี้ */
  currentPrefix: { type: String, default: '' },
});

const emit = defineEmits(['close', 'saved']);

const value = ref(props.currentPrefix || '');
const saving = ref(false);

async function save() {
  if (saving.value) return;
  saving.value = true;
  try {
    const val = value.value.trim();
    const res = await api.put('/document-staff/school-prefix', { doc_prefix: val });
    UI.toast(res.message);
    emit('saved', val);
    emit('close');
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal title="🔢 กำหนดเลขหนังสือสถานศึกษา" footer @close="emit('close')">
    <div style="padding: 8px">
      <p style="margin-bottom: 12px; font-size: 14px; color: #334155">กำหนดเลขหนังสือสถานศึกษา</p>
      <div style="display: flex; align-items: center; gap: 4px; margin-bottom: 12px">
        <span style="font-size: 14px; color: #334155; white-space: nowrap">ที่ ศธ 04110.</span>
        <input
          v-model="value"
          placeholder="ให้กรอกเลข"
          style="width: 120px; text-align: center; font-size: 14px; padding: 6px"
          @keyup.enter="save"
        />
      </div>
    </div>

    <template #footer>
      <div style="display: flex; gap: 8px">
        <button class="btn btn-outline" @click="emit('close')">ยกเลิก</button>
        <button class="btn btn-primary" :disabled="saving" @click="save">
          {{ saving ? 'กำลังบันทึก...' : 'บันทึก' }}
        </button>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
/* input/button ใช้สไตล์จาก theme.css */
</style>
