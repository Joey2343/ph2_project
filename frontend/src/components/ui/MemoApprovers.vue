<script setup>
/**
 * MemoApprovers — admin กำหนดลำดับขั้นการส่งบันทึกข้อความ (3 ขั้น)
 *
 * ย้ายจาก MemosView.openApproversModal()
 *
 * mapping: { [level]: { [userId]: approverId } }
 *   ❶ ขั้นที่ 1 · ❷ ขั้นที่ 2 · ❸ ขั้นที่ 3
 *
 * เลือกชื่อตัวเองได้ด้วย (ตามเดิม) — เมื่อคนนั้นส่งบันทึกข้อความ
 * ระบบจะส่งตามลำดับขั้นของบุคคลนั้น
 */
import { ref, onMounted } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import AppModal from './AppModal.vue';

const emit = defineEmits(['close', 'saved']);

const loading = ref(true);
const saving = ref(false);
const error = ref('');
const staff = ref([]);
/** { 1: {}, 2: {}, 3: {} } */
const perPerson = ref({ 1: {}, 2: {}, 3: {} });

const LEVELS = [
  { n: 1, label: '❶ ขั้นที่ 1' },
  { n: 2, label: '❷ ขั้นที่ 2' },
  { n: 3, label: '❸ ขั้นที่ 3' },
];

onMounted(async () => {
  loading.value = true;
  try {
    const d = await api.get('/memo/approvers');
    perPerson.value = d.perPerson || { 1: {}, 2: {}, 3: {} };
    staff.value = d.staff || [];
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});

function nameOf(u) {
  return `${u.title || ''} ${u.first_name || u.full_name || ''} ${u.last_name || ''}`
    .replace(/\s+/g, ' ')
    .trim();
}

function valOf(uid, level) {
  return Number((perPerson.value[level] || {})[String(uid)]) || 0;
}

function setVal(uid, level, v) {
  const n = Number(v) || 0;
  const map = { ...(perPerson.value[level] || {}) };
  if (n) map[String(uid)] = n;
  else delete map[String(uid)];
  perPerson.value = { ...perPerson.value, [level]: map };
}

async function save() {
  saving.value = true;
  try {
    const per = { 1: {}, 2: {}, 3: {} };
    for (const lvl of [1, 2, 3]) {
      for (const [uid, aid] of Object.entries(perPerson.value[lvl] || {})) {
        if (aid) per[lvl][uid] = Number(aid);
      }
    }
    const res = await api.put('/memo/approvers', per);
    UI.toast(res.message);
    emit('saved');
    emit('close');
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    saving.value = false;
  }
}

const thStyle = {
  padding: '6px 10px',
  border: '1px solid #d1d5db',
  textAlign: 'center',
  fontWeight: 700,
  fontSize: '13px',
  whiteSpace: 'nowrap',
};
const tdStyle = { padding: '5px 10px', border: '1px solid #d1d5db', fontSize: '13.5px' };
const selStyle = 'padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;width:100%;min-width:170px;';
</script>

<template>
  <AppModal title="+ เพิ่มเจ้าหน้าที่ (ลำดับขั้นบันทึกข้อความ)" size="xxl" footer @close="emit('close')">
    <p class="hint" style="margin-bottom: 12px">
      กำหนดลำดับขั้นการส่งบันทึกข้อความรายบุคคล — เลือกผู้อนุมัติขั้นที่ 1/2/3 ของแต่ละคนได้อย่างอิสระ
      รวมถึงเลือกชื่อตัวเองได้ เมื่อคนนั้นส่งบันทึกข้อความ ระบบจะส่งตามลำดับขั้นของบุคคลนั้น
    </p>

    <div v-if="loading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
    <div v-else-if="error" class="empty-state"><span class="em">⚠️</span>{{ error }}</div>

    <div v-else class="table-wrap" style="max-height: 420px; overflow-y: auto; overflow-x: auto">
      <table class="tbl">
        <thead>
          <tr>
            <th :style="{ ...thStyle, textAlign: 'left' }">ชื่อบุคลากร</th>
            <th :style="{ ...thStyle, textAlign: 'left' }">สังกัด/ตำแหน่ง</th>
            <th v-for="l in LEVELS" :key="l.n" :style="thStyle">{{ l.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in staff" :key="u.id">
            <td :style="{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }">{{ nameOf(u) }}</td>
            <td :style="{ ...tdStyle, color: '#6b7280', fontSize: '12.5px', whiteSpace: 'nowrap' }">
              {{ u.workplace || '-' }}<br />{{ u.position || '-' }}
            </td>
            <td v-for="l in LEVELS" :key="l.n" :style="tdStyle">
              <select
                :value="valOf(u.id, l.n)"
                :style="selStyle"
                @change="setVal(u.id, l.n, $event.target.value)"
              >
                <option :value="0">-- เลือกบุคคล --</option>
                <option v-for="o in staff" :key="o.id" :value="o.id">{{ nameOf(o) }}</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <template #footer>
      <button class="btn btn-outline" :disabled="saving" @click="emit('close')">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="saving || loading" @click="save">
        {{ saving ? 'กำลังบันทึก…' : '▽ บันทึกสิทธิ์' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
