<script setup>
/**
 * DocumentsCertStaffModal — กำหนดเจ้าหน้าที่หนังสือรับรอง (admin only)
 *
 * ย้ายจาก DocumentsView.openCertStaffSettings() (35 บรรทัด)
 *
 * เจ้าหน้าที่กลุ่มนี้จะเห็นปุ่ม ลงทะเบียนหนังสือรับรอง
 * และแก้ไข/ลบ/เปลี่ยนสถานะได้ (คนละชุดกับเจ้าหน้าที่หนังสือราชการทั่วไป)
 */
import { ref, computed, onMounted } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import AppModal from '../ui/AppModal.vue';

const emit = defineEmits(['close']);

const certStaff = ref([]);
const candidates = ref([]);
const sel = ref('');
const loading = ref(true);
const busy = ref(false);

const staffLabel = (u) => (u.title ? u.title + ' ' : '') + (u.full_name || '') + (u.position ? ' — ' + u.position : '');

async function reload() {
  try {
    const d = await api.get('/cert-staff');
    certStaff.value = d.certStaff || [];
  } catch {
    certStaff.value = [];
  }
  try {
    const d = await api.get('/staff');
    const all = d.users || d.staff || [];
    const assigned = new Set(certStaff.value.map((s) => s.user_id));
    // เฉพาะเจ้าหน้าที่ สพป. ที่ยังใช้งานอยู่และยังไม่ได้กำหนด
    candidates.value = all.filter((u) => u.user_group !== 'school' && u.status === 'active' && !assigned.has(u.id));
  } catch {
    candidates.value = [];
  }
}

async function addStaff() {
  const uid = Number(sel.value);
  if (!uid) {
    UI.toast('กรุณาเลือกเจ้าหน้าที่', 'error');
    return;
  }
  busy.value = true;
  try {
    await api.post('/cert-staff', { userIds: [uid] });
    UI.toast('เพิ่มเจ้าหน้าที่เรียบร้อย');
    sel.value = '';
    await reload();
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}

async function removeStaff(s) {
  busy.value = true;
  try {
    await api.del('/cert-staff/' + s.id);
    UI.toast('ลบเรียบร้อย');
    await reload();
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}

const hasList = computed(() => certStaff.value.length > 0);

onMounted(async () => {
  await reload();
  loading.value = false;
});
</script>

<template>
  <AppModal title="⊗ กำหนดเจ้าหน้าที่หนังสือรับรอง" size="lg" @close="emit('close')" footer>
    <div style="max-height: 70vh; overflow-y: auto">
      <div style="font-size: 13px; color: #64748b; margin-bottom: 12px">
        เจ้าหน้าที่ที่กำหนดจะเห็นปุ่ม ลงทะเบียนหนังสือรับรอง และแก้ไข/ลบ/เปลี่ยนสถานะได้
      </div>

      <div v-if="loading" class="hint">กำลังโหลดข้อมูล...</div>

      <template v-else>
        <div v-if="!hasList" style="color: #94a3b8; font-size: 13px">ยังไม่มีเจ้าหน้าที่</div>
        <div v-else>
          <div
            v-for="s in certStaff"
            :key="s.id"
            style="display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid #f1f5f9"
          >
            <span style="flex: 1; font-size: 14px">
              {{ (s.title || '') + ' ' + (s.full_name || '') + (s.position ? ' — ' + s.position : '') }}
            </span>
            <button
              class="btn btn-danger"
              style="font-size: 11px; padding: 2px 8px"
              :disabled="busy"
              @click="removeStaff(s)"
            >
              ✕ ลบ
            </button>
          </div>
        </div>

        <div style="display: flex; align-items: center; margin-top: 10px; gap: 8px">
          <select
            v-model="sel"
            style="padding: 6px; border-radius: 6px; font-size: 14px; min-width: 300px; vertical-align: middle"
          >
            <option value="">-- เลือกเจ้าหน้าที่ สพป.แพร่ เขต 2 --</option>
            <option v-for="u in candidates" :key="u.id" :value="String(u.id)">{{ staffLabel(u) }}</option>
          </select>
          <button
            class="btn btn-primary"
            style="font-size: 13px; padding: 6px 16px"
            :disabled="busy"
            @click="addStaff"
          >
            + เพิ่ม
          </button>
        </div>
      </template>
    </div>

    <template #footer>
      <button class="btn btn-outline" @click="emit('close')">ปิด</button>
    </template>
  </AppModal>
</template>

<style scoped>
/* คลาส .hint / .btn-* มาจาก styles/theme.css */
</style>
