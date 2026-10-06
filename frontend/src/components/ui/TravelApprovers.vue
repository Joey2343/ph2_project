<script setup>
/**
 * TravelApprovers — กำหนดผู้บังคับบัญชาขั้นต้น/ผู้อนุมัติ สำหรับคำขอไปราชการ (admin เท่านั้น)
 *
 * ย้ายจาก TravelView.openApproverSettings() ที่สร้างตารางด้วย DOM ซ้อ ๆ
 *
 * โครงสร้างต่างจากหน้าอื่น: เก็บ mapping ราย "ผู้ขอ" ไม่ใช่ราย "ผู้อนุมัติ"
 *   สาย สพป.แพร่ เขต 2 (office)  → 2 ขั้น: supervisor → approver
 *   สายสถานศึกษา (school)         → 3 ขั้น: reviewer → supervisor → approver
 *   ทั้งสองสายเลือกตัวผู้อนุมัติจาก "เจ้าหน้าที่ สพป.แพร่ เขต 2" เสมอ
 */
import { ref, computed, watch } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import AppModal from './AppModal.vue';

const props = defineProps({
  saving: { type: Boolean, default: false },
});

const emit = defineEmits(['close', 'save']);

const tab = ref('office');
const loading = ref(true);
const staff = ref([]);

/** mapping: { [userId]: { reviewer?, supervisor?, approver } } */
const officeMap = ref({});
const schoolMap = ref({});

/* ---------- คอลัมน์ของแต่ละสาย ---------- */
const COLS = {
  office: [
    { field: 'supervisor', label: 'ผู้บังคับบัญชาขั้นต้น', width: '22%' },
    { field: 'approver', label: 'ผู้อนุมัติ', width: '22%' },
  ],
  school: [
    { field: 'reviewer', label: 'ผู้ตรวจสอบ (ขั้นที่ 1)', width: '17%' },
    { field: 'supervisor', label: 'ผู้บังคับบัญชาขั้นต้น (ขั้นที่ 2)', width: '17%' },
    { field: 'approver', label: 'ผู้อนุมัติ (ขั้นที่ 3)', width: '17%' },
  ],
};

const cols = computed(() => COLS[tab.value]);

/** แยกกลุ่มผู้ใช้อย่างชัดเจน */
const officeStaff = computed(() => staff.value.filter((u) => (u.user_group || 'office') !== 'school'));
const schoolStaff = computed(() => staff.value.filter((u) => (u.user_group || 'office') === 'school'));

/** รายการที่แสดงในแท็บปัจจุบัน */
const rows = computed(() => (tab.value === 'office' ? officeStaff.value : schoolStaff.value));

/** ตัวเลือกของ dropdown — ทั้งสองสายเลือกจากเจ้าหน้าที่ สพป.แพร่ เขต 2 */
const pool = computed(() => officeStaff.value);

function fullNameOf(u) {
  const first = [(u.title || '') + (u.first_name || ''), u.last_name || ''].filter(Boolean).join(' ');
  return first || u.full_name || '';
}

function deptOf(u) {
  return u.workplace || u.department || u.group || '-';
}

/** mapping ของแท็บที่กำลังแก้ */
function mapFor(which) {
  return which === 'office' ? officeMap.value : schoolMap.value;
}

/** อ่านค่าที่เลือกไว้ของผู้ขอหนึ่งคน */
function getVal(u, field) {
  return Number(mapFor(tab.value)[String(u.id)]?.[field] || 0);
}

/** บันทึกค่าที่เลือกลง mapping ของแท็บปัจจุบัน */
function setVal(u, field, val) {
  const which = tab.value;
  const key = String(u.id);
  const target = which === 'office' ? officeMap.value : schoolMap.value;
  target[key] = { ...(target[key] || {}), [field]: Number(val) || 0 };
}

/* ---------- โหลดข้อมูล ---------- */
async function load() {
  loading.value = true;
  try {
    // โหลดข้อมูลทั้ง 3 ชุดพร้อมกัน — ชุดใดพังไม่ทำให้ทั้งหน้าต่างล้ม
    const [a, b, c] = await Promise.all([
      api.get('/settings/travel-approvers').catch(() => ({})),
      api.get('/settings/travel-approvers-school').catch(() => ({})),
      api.get('/staff').catch(() => ({})),
    ]);
    officeMap.value = a.travelApprovers || {};
    schoolMap.value = b.travelApprovers || {};
    staff.value = c.users || c.staff || [];
    staff.value.sort(
      (x, y) => (x.sort_order || 0) - (y.sort_order || 0) || (x.id - y.id),
    );
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    loading.value = false;
  }
}

watch(() => props.saving, load, { immediate: true });

/* ---------- บันทึก ---------- */
function save() {
  // ส่งเฉพาะ key ที่มีการเลือกจริง เพื่อไม่ให้บันทึก 0 ทับค่าเดิม
  const office = {};
  for (const u of officeStaff.value) {
    const e = officeMap.value[String(u.id)];
    if (!e) continue;
    const row = {};
    if (e.supervisor) row.supervisor = Number(e.supervisor);
    if (e.approver) row.approver = Number(e.approver);
    if (Object.keys(row).length) office[String(u.id)] = row;
  }

  const school = {};
  for (const u of schoolStaff.value) {
    const e = schoolMap.value[String(u.id)];
    if (!e) continue;
    const row = {};
    if (e.reviewer) row.reviewer = Number(e.reviewer);
    if (e.supervisor) row.supervisor = Number(e.supervisor);
    if (e.approver) row.approver = Number(e.approver);
    if (Object.keys(row).length) school[String(u.id)] = row;
  }

  emit('save', { office, school });
}

const thStyle = {
  padding: '6px 8px',
  textAlign: 'left',
  borderBottom: '2px solid #d1d5db',
  fontSize: '13px',
  fontWeight: 'bold',
};
const tdStyle = { padding: '5px 8px', borderBottom: '1px solid #e5e7eb', fontSize: '13px' };
</script>

<template>
  <AppModal title="⊛ กำหนดผู้อนุมัติไปราชการ" size="xxl" footer @close="emit('close')">
    <div v-if="loading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>

    <div v-else style="font-size: 14px; max-height: 560px; overflow-y: auto">
      <div style="margin-bottom: 10px; color: #64748b">
        กำหนดผู้บังคับบัญชาขั้นต้นและผู้อนุมัติสำหรับแต่ละบุคคล — แยกตามกลุ่ม
        ตัวเลือกในแต่ละแท็บเป็นเจ้าหน้าที่ของกลุ่มนั้นเท่านั้น
      </div>

      <div class="tabs" style="margin-bottom: 12px">
        <button class="tab" :class="{ active: tab === 'office' }" @click="tab = 'office'">
          📋 เจ้าหน้าที่ สพป.แพร่ เขต 2 ({{ officeStaff.length }})
        </button>
        <button class="tab" :class="{ active: tab === 'school' }" @click="tab = 'school'">
          🏫 เจ้าหน้าที่สถานศึกษา ({{ schoolStaff.length }})
        </button>
      </div>

      <div v-if="rows.length === 0" class="empty-state"><span class="em">👤</span>ไม่มีข้อมูลบุคลากรในกลุ่มนี้</div>

      <table v-else style="width: 100%; border-collapse: collapse">
        <thead>
          <tr>
            <th :style="{ ...thStyle, width: '20%', whiteSpace: 'nowrap' }">ชื่อบุคลากร</th>
            <th :style="{ ...thStyle, width: '30%', whiteSpace: 'nowrap' }">สังกัด/กลุ่มงาน</th>
            <th v-for="c in cols" :key="c.field" :style="{ ...thStyle, width: c.width, whiteSpace: 'nowrap' }">
              {{ c.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in rows" :key="u.id">
            <td :style="{ ...tdStyle, whiteSpace: 'nowrap' }">{{ fullNameOf(u) }}</td>
            <td :style="{ ...tdStyle, whiteSpace: 'nowrap' }">{{ deptOf(u) }}</td>
            <td v-for="c in cols" :key="c.field" :style="tdStyle">
              <select
                :id="'trv-' + u.id + '-' + c.field"
                :value="getVal(u, c.field)"
                style="width: 100%; padding: 4px; font-size: 13px; border-radius: 4px; border: 1px solid #d1d5db"
                @change="setVal(u, c.field, $event.target.value)"
              >
                <option :value="0">-- เลือก --</option>
                <option v-for="p in pool" :key="p.id" :value="p.id">{{ fullNameOf(p) }}</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <template #footer>
      <button class="btn btn-outline" :disabled="saving" @click="emit('close')">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="saving || loading" @click="save">
        {{ saving ? 'กำลังบันทึก…' : '▽ บันทึก' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
