<script setup>
/**
 * LeaveApprovers — ตั้งค่าเจ้าหน้าที่การลา 3 ลำดับ (admin เท่านั้น)
 *
 * ย้ายจาก loadSettingsApprover() ใน LeaveView.js ที่สร้างตารางด้วย HTML string
 *
 * โครงสร้าง: mapping ต่อ "ผู้ขอ" 1 คน → { level1: id, level2: id, level3: id }
 *   ขั้น ❶ ผู้ตรวจสอบ → ❷ ผู้อนุมัติขั้นต้น → ❸ ผู้อนุมัติ
 *   แถวของตาราง = กลุ่มผู้ขอ (สพป. หรือสถานศึกษา)
 *   ตัวเลือกใน dropdown = เจ้าหน้าที่ สพป.แพร่ เขต 2 เสมอ (ทั้งสองหน้า)
 */
import { ref, computed, onMounted } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';

const props = defineProps({
  /** 'office' | 'school' */
  scope: { type: String, default: 'office' },
});

const emit = defineEmits(['saved']);

const isSchoolScope = computed(() => props.scope === 'school');

const loading = ref(true);
const saving = ref(false);
const error = ref('');
const staff = ref([]);
/** { 1: {userId: approverId}, 2: {...}, 3: {...} } */
const perPerson = ref({ 1: {}, 2: {}, 3: {} });

function groupOf(u) {
  return u.user_group || (u.school_code === '54020000' ? 'office' : 'school');
}

/** แถวของตาราง = ผู้ขอในกลุ่มของหน้านี้ */
const rowStaff = computed(() =>
  staff.value.filter((u) => u.status === 'active' && groupOf(u) === (isSchoolScope.value ? 'school' : 'office')),
);

/** ตัวเลือก = เจ้าหน้าที่ สพป. เท่านั้น (ทั้งสองหน้า) */
const optStaff = computed(() => staff.value.filter((u) => u.status === 'active' && groupOf(u) === 'office'));

const LEVELS = [
  { n: 1, label: '❶ ผู้ตรวจสอบ' },
  { n: 2, label: '❷ ผู้อนุมัติขั้นต้น' },
  { n: 3, label: '❸ ผู้อนุมัติ' },
];

function nameOf(u) {
  return [(u.title || '') + ' ' + (u.first_name || u.full_name || ''), u.last_name || '']
    .filter((s) => s && s.trim())
    .join(' ')
    .trim();
}

function valOf(uid, level) {
  return Number((perPerson.value[level] || {})[String(uid)]) || 0;
}

function setVal(uid, level, v) {
  const n = Number(v) || 0;
  if (!perPerson.value[level]) perPerson.value[level] = {};
  const map = { ...perPerson.value[level] };
  if (n) map[String(uid)] = n;
  else delete map[String(uid)];
  perPerson.value = { ...perPerson.value, [level]: map };
}

onMounted(async () => {
  loading.value = true;
  error.value = '';
  try {
    const [la, s] = await Promise.all([
      api.get('/settings/leave-approvers?scope=' + props.scope),
      api.get('/staff').catch(() => ({})),
    ]);
    perPerson.value = la.approvers || { 1: {}, 2: {}, 3: {} };
    staff.value = s.staff || s.users || [];
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});

async function save() {
  saving.value = true;
  try {
    // ส่งเฉพาะ key ที่เลือกจริง ชุดละ 3 ระดับ
    const body = { 1: {}, 2: {}, 3: {} };
    for (const lvl of [1, 2, 3]) {
      for (const [uid, aid] of Object.entries(perPerson.value[lvl] || {})) {
        if (aid) body[lvl][uid] = Number(aid);
      }
    }
    const res = await api.put('/settings/leave-approvers?scope=' + props.scope, body);
    UI.toast(res.message);
    emit('saved');
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
</script>

<template>
  <div>
    <div class="card-title">
      {{ isSchoolScope ? '⊛ เจ้าหน้าที่การลาของสถานศึกษา (3 ลำดับ)' : '⊛ เจ้าหน้าที่การลาของ สพป.แพร่ เขต 2 (3 ลำดับ)' }}
    </div>
    <p class="hint" style="margin-bottom: 14px">
      กำหนดเจ้าหน้าที่ที่จะพิจารณาคำขอลาตามลำดับขั้น — เลือกผู้ตรวจสอบ ผู้อนุมัติขั้นต้น ผู้อนุมัติ
      ให้แต่ละคนได้อย่างอิสระ (ตัวเลือกแสดงเฉพาะเจ้าหน้าที่ สพป.แพร่ เขต 2)
    </p>

    <div v-if="loading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
    <div v-else-if="error" class="empty-state"><span class="em">⚠️</span>{{ error }}</div>
    <div v-else-if="rowStaff.length === 0" class="empty-state">
      <span class="em">👤</span>ไม่มีข้อมูลบุคลากรในกลุ่มนี้
    </div>

    <div v-else class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th :style="{ ...thStyle, textAlign: 'left' }">ชื่อบุคลากร</th>
            <th :style="{ ...thStyle, textAlign: 'left' }">สังกัด/ตำแหน่ง</th>
            <th v-for="l in LEVELS" :key="l.n" :style="thStyle">{{ l.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in rowStaff" :key="u.id">
            <td :style="{ ...tdStyle, fontWeight: 600 }">{{ nameOf(u) }}</td>
            <td :style="{ ...tdStyle, color: '#6b7280', fontSize: '12.5px' }">{{ u.position || '-' }}</td>
            <td v-for="l in LEVELS" :key="l.n" :style="tdStyle">
              <select
                :value="valOf(u.id, l.n)"
                style="padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; width: 100%"
                @change="setVal(u.id, l.n, $event.target.value)"
              >
                <option :value="0">-- เลือกบุคลากร --</option>
                <option v-for="o in optStaff" :key="o.id" :value="o.id">{{ nameOf(o) }}</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="form-actions" style="margin-top: 14px">
      <button
        class="btn btn-primary"
        :disabled="saving || loading || rowStaff.length === 0"
        @click="save"
      >
        {{ saving ? 'กำลังบันทึก…' : '▽ บันทึกเจ้าหน้าที่การลา' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
