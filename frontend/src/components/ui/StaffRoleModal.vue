<script setup>
/**
 * StaffRoleModal — กำหนดสิทธิ์การใช้งาน 5 ระดับ
 *
 * ย้ายจาก StaffView.setRole()
 *
 * แสดงคำอธิบายสิทธิ์ของระดับที่เลือกอยู่เสมอ ด้านล่าง dropdown
 */
import { ref, computed } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import { CONSTANTS } from '../../constants/index.js';
import AppModal from './AppModal.vue';

const props = defineProps({
  staff: { type: Object, required: true },
});

const emit = defineEmits(['close', 'saved']);

const busy = ref(false);
const role = ref(props.staff.role || 'member');

/** คำอธิบายของสิทธิ์ที่เลือก */
const desc = computed(() => {
  const r = CONSTANTS.ROLES.find((x) => x.value === role.value);
  return r ? `${r.icon} ${r.label} — ${r.desc}` : '';
});

async function save() {
  busy.value = true;
  try {
    const res = await api.put(`/staff/${props.staff.id}/role`, { role: role.value });
    UI.toast(res.message);
    emit('saved');
    emit('close');
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppModal title="⊛ กำหนดสิทธิ์การใช้งาน" footer @close="emit('close')">
    <p style="margin-bottom: 12px; font-weight: 600">กำหนดสิทธิ์การใช้งานให้ "{{ UI.personName(staff) }}"</p>

    <select v-model="role" style="width: 100%; margin-bottom: 12px">
      <option v-for="r in CONSTANTS.ROLES" :key="r.value" :value="r.value">{{ r.icon }} {{ r.label }}</option>
    </select>

    <div class="hint" style="min-height: 40px">{{ desc }}</div>

    <template #footer>
      <button class="btn btn-outline" :disabled="busy" @click="emit('close')">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="busy" @click="save">
        {{ busy ? 'กำลังบันทึก…' : '▽ บันทึกสิทธิ์' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
