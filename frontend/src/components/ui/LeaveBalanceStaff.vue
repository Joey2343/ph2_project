<script setup>
/**
 * LeaveBalanceStaff — หน้าต่าง "เจ้าหน้าที่วันลาพักผ่อนสะสม" (admin เท่านั้น)
 *
 * ผู้ใช้สั่ง 11 พ.ย. 2569:
 *   "เพิ่มปุ่ม เจ้าหน้าที่วันลาพักผ่อนสะสม เมื่อกดจะมีตัวเลือกเจ้าหน้าที่
 *    และกดเพิ่มได้หลายคน — เจ้าหน้าที่ส่วนนี้จะมีปุ่มแก้ไขวันลาพักผ่อนสะสมของทุกคน
 *    ส่วนคนที่ไม่ใช่จะไม่มีปุ่มแก้ไข"
 *
 * เก็บรายชื่อใน settings key `leave_balance_staff` (JSON array ของ user id)
 * เพิ่ม/ลบทีละคนแล้วบันทึกทันที (เหมือนหน้าต่างกำหนดเจ้าหน้าที่สารบัญ)
 */
import { ref, computed, onMounted } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import AppModal from './AppModal.vue';

const emit = defineEmits(['close', 'updated']);

const loading = ref(true);
const busy = ref(false);
const error = ref('');
const staffUsers = ref([]);
const candidates = ref([]);
const pick = ref('');

function nameOf(u) {
  return [(u.title || '') + ' ' + (u.first_name || u.full_name || ''), u.last_name || '']
    .filter((s) => s && s.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const pickOptions = computed(() => candidates.value);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const d = await api.get('/leave-balance-staff');
    staffUsers.value = d.staffUsers || [];
    candidates.value = d.candidates || [];
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

/** บันทึกรายชื่อทั้งชุด (แทนที่) */
async function save(list) {
  busy.value = true;
  try {
    const res = await api.put('/leave-balance-staff', { userIds: list.map((u) => u.id) });
    UI.toast(res.message || 'บันทึกเรียบร้อย');
    await load();
    emit('updated');
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}

/** เพิ่มเจ้าหน้าที่ที่เลือก (กดซ้ำได้หลายคน) */
async function add() {
  const id = Number(pick.value);
  if (!id) {
    UI.toast('กรุณาเลือกเจ้าหน้าที่', 'error');
    return;
  }
  const u = candidates.value.find((x) => Number(x.id) === id);
  if (!u) return;
  await save([...staffUsers.value, u]);
  pick.value = '';
}

async function remove(u) {
  await save(staffUsers.value.filter((x) => Number(x.id) !== Number(u.id)));
}
</script>

<template>
  <AppModal
    v-if="true"
    title="👤 เจ้าหน้าที่วันลาพักผ่อนสะสม"
    size="lg"
    footer
    @close="emit('close')"
  >
    <div v-if="loading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
    <div v-else-if="error" class="empty-state"><span class="em">⚠️</span>{{ error }}</div>
    <div v-else>
      <p class="hint" style="margin-bottom: 12px">
        เจ้าหน้าที่ที่กำหนดไว้จะเห็นปุ่มแก้ไข (✎) วันลาพักผ่อนสะสมของบุคลากรทุกคนในแท็บ
        "วันลาพักผ่อนสะสม" — ผู้ที่ไม่ได้ถูกกำหนดจะไม่มีปุ่มแก้ไข
      </p>

      <div class="form-group" style="max-width: 100%">
        <label>เลือกเจ้าหน้าที่</label>
        <div style="display: flex; gap: 8px; flex-wrap: wrap">
          <select
            id="lbs-pick"
            v-model="pick"
            :disabled="busy"
            style="flex: 1; min-width: 240px; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13.5px"
          >
            <option value="">-- เลือกเจ้าหน้าที่ --</option>
            <option v-for="u in pickOptions" :key="u.id" :value="u.id">
              {{ nameOf(u) }}{{ u.position ? ' — ' + u.position : '' }}{{ u.workplace ? ' (' + u.workplace + ')' : '' }}
            </option>
          </select>
          <button id="lbs-add" class="btn btn-primary" :disabled="busy || !pick" @click="add">
            ＋ เพิ่ม
          </button>
        </div>
      </div>

      <div v-if="staffUsers.length === 0" class="empty-state" style="margin-top: 8px">
        <span class="em">👤</span>ยังไม่ได้กำหนดเจ้าหน้าที่วันลาพักผ่อนสะสม
      </div>
      <div v-else class="table-wrap" style="margin-top: 10px">
        <table class="tbl">
          <thead>
            <tr>
              <th style="width: 50px; text-align: center">ลำดับ</th>
              <th>ชื่อ-สกุล</th>
              <th>ตำแหน่ง</th>
              <th>สังกัด/กลุ่มงาน</th>
              <th style="width: 60px; text-align: center">ลบ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(u, i) in staffUsers" :key="u.id">
              <td style="text-align: center">{{ i + 1 }}</td>
              <td style="font-weight: 600">{{ nameOf(u) }}</td>
              <td>{{ u.position || '-' }}</td>
              <td>{{ u.workplace || '-' }}</td>
              <td style="text-align: center">
                <button class="btn btn-xs btn-outline" :disabled="busy" @click="remove(u)">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-outline" @click="emit('close')">ปิด</button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
