<script setup>
/**
 * StaffResetPassModal — ตั้งรหัสผ่านใหม่ให้สมาชิก
 *
 * ย้ายจาก StaffView.resetPass()
 *
 * ผู้ใช้ต้องเข้าสู่ระบบใหม่ด้วยชื่อผู้ใช้/รหัสผ่านนี้
 */
import { ref } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import AppModal from './AppModal.vue';

const props = defineProps({
  staff: { type: Object, required: true },
});

const emit = defineEmits(['close', 'saved']);

const busy = ref(false);
const username = ref(props.staff.username || '');
const password = ref('');

async function save() {
  if (!password.value) return UI.toast('กรุณากรอกรหัสผ่านใหม่', 'error');
  if (!username.value.trim()) return UI.toast('กรุณากรอกชื่อผู้ใช้', 'error');
  busy.value = true;
  try {
    const res = await api.post(`/staff/${props.staff.id}/reset-password`, {
      new_password: password.value,
      username: username.value.trim(),
    });
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
  <AppModal title="⊙ ตั้งรหัสผ่านใหม่" footer @close="emit('close')">
    <p style="margin-bottom: 12px">ตั้งรหัสผ่านใหม่ให้ "{{ UI.personName(staff) }}"</p>

    <div class="form-group">
      <label>ชื่อผู้ใช้ (Username)</label>
      <input v-model="username" placeholder="ตัวอักษร ตัวเลข _ . - (3-30 ตัว)" />
    </div>

    <div class="form-group">
      <label>รหัสผ่านใหม่</label>
      <input v-model="password" type="text" placeholder="อย่างน้อย 8 ตัวอักษร มีตัวพิมพ์ใหญ่ ตัวเลข อักขระพิเศษ" />
    </div>

    <div class="hint">ผู้ใช้จะต้องเข้าสู่ระบบใหม่ด้วยชื่อผู้ใช้/รหัสผ่านนี้</div>

    <template #footer>
      <button class="btn btn-outline" :disabled="busy" @click="emit('close')">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="busy" @click="save">
        {{ busy ? 'กำลังบันทึก…' : '⊙ ตั้งรหัสใหม่' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
