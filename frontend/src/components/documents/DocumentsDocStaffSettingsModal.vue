<script setup>
/**
 * DocumentsDocStaffSettingsModal — กำหนดเจ้าหน้าที่สารบัญ (admin only)
 *
 * ย้ายจาก DocumentsView.openDocStaffSettings(type) (121 บรรทัด)
 *
 * prop type:
 *   'office' — 📋 กำหนดเจ้าหน้าที่สารบัญเขต  (เห็นหนังสือที่สถานศึกษาส่งมาให้ สพป.)
 *   'school' — 🏫 กำหนดเจ้าหน้าที่สารบัญสถานศึกษา  (รับหนังสือจาก สพป.)
 */
import { ref, computed, onMounted } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import AppModal from '../ui/AppModal.vue';

const props = defineProps({
  /** 'office' | 'school' */
  type: { type: String, default: 'office' },
});

const emit = defineEmits(['close']);

const isOffice = computed(() => props.type === 'office');

const title = computed(() =>
  isOffice.value ? '📋 กำหนดเจ้าหน้าที่สารบัญเขต' : '🏫 กำหนดเจ้าหน้าที่สารบัญสถานศึกษา',
);

/* ---------- ข้อมูลจาก API ---------- */
const officeStaff = ref([]);
const allStaff = ref([]);
const allSchools = ref([]);
const loading = ref(true);
const busy = ref(false);

const staffLabel = (u) => (u.title ? u.title + ' ' : '') + (u.full_name || '') + (u.position ? ' — ' + u.position : '');

/* ---------- ส่วนสารบัญเขต ---------- */
const officeSet = computed(() => new Set(officeStaff.value.map((s) => s.user_id)));
const officeCandidates = computed(() =>
  allStaff.value.filter((u) => u.user_group !== 'school' && u.status === 'active' && !officeSet.value.has(u.id)),
);
const officeSel = ref('');

async function reload() {
  try {
    const d = await api.get('/document-staff');
    officeStaff.value = d.officeStaff || [];
  } catch {
    officeStaff.value = [];
  }
}

async function addOfficeStaff() {
  const uid = Number(officeSel.value);
  if (!uid) {
    UI.toast('กรุณาเลือกเจ้าหน้าที่', 'error');
    return;
  }
  busy.value = true;
  try {
    await api.post('/document-staff/office', { userIds: [uid] });
    UI.toast('เพิ่มเจ้าหน้าที่เรียบร้อย');
    officeSel.value = '';
    await reload();
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}

async function removeOfficeStaff(s) {
  busy.value = true;
  try {
    await api.del('/document-staff/office/' + s.id);
    UI.toast('ลบเรียบร้อย');
    await reload();
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}

/* ---------- ส่วนสารบัญสถานศึกษา ---------- */
const schoolStaff = ref([]);
const schoolSel = ref('');
const checkedIds = ref([]);
const staffLoading = ref(false);

const assignedForSchool = computed(() => schoolStaff.value.filter((s) => s.school_code === schoolSel.value));

const schoolUsers = computed(() => {
  const code = schoolSel.value;
  if (!code) return [];
  return allStaff.value.filter((u) => {
    if (u.user_group !== 'school' || u.status !== 'active') return false;
    if (u.workplace && u.workplace.startsWith(code)) return true;
    try {
      const extras = JSON.parse(u.workplace_secondary || '[]');
      return extras.some((e) => e && e.startsWith(code));
    } catch {
      return false;
    }
  });
});

function toggleUser(id) {
  const i = checkedIds.value.indexOf(id);
  if (i >= 0) checkedIds.value.splice(i, 1);
  else checkedIds.value.push(id);
}

/** เปลี่ยนโรงเรียน → โหลดรายชื่อเจ้าหน้าที่ของโรงเรียนนั้น */
async function onSchoolChange() {
  checkedIds.value = [];
  const code = schoolSel.value;
  if (!code) return;
  staffLoading.value = true;
  try {
    const d = await api.get('/document-staff');
    schoolStaff.value = d.schoolStaff || [];
    checkedIds.value = schoolStaff.value.filter((s) => s.school_code === code).map((s) => s.user_id);
  } catch {
    schoolStaff.value = [];
  } finally {
    staffLoading.value = false;
  }
}

async function saveSchoolStaff() {
  const code = schoolSel.value;
  if (!code) return;
  busy.value = true;
  try {
    await api.post('/document-staff/school', { school_code: code, userIds: checkedIds.value });
    UI.toast('บันทึกเจ้าหน้าที่สถานศึกษาเรียบร้อย');
    await onSchoolChange();
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  await reload();
  try {
    const d = await api.get('/staff');
    allStaff.value = d.users || d.staff || [];
  } catch {
    allStaff.value = [];
  }
  try {
    const d = await api.get('/schools');
    allSchools.value = (d.schools || []).sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'th', { numeric: true }));
    // ส่วนสารบัญสถานศึกษาต้องมีรายชื่อสถานศึกษาก่อนเลือกได้
    try {
      const ds = await api.get('/document-staff');
      schoolStaff.value = ds.schoolStaff || [];
    } catch {
      schoolStaff.value = [];
    }
  } catch {
    allSchools.value = [];
  }
  loading.value = false;
});
</script>

<template>
  <AppModal :title="title" size="lg" @close="emit('close')" footer>
    <div style="max-height: 70vh; overflow-y: auto">
      <div v-if="loading" class="hint">กำลังโหลดข้อมูล...</div>

      <!-- ===== สารบัญเขต ===== -->
      <template v-else-if="isOffice">
        <div style="font-size: 16px; font-weight: bold; margin-bottom: 8px; color: #1e40af">
          📋 กำหนดเจ้าหน้าที่สารบัญเขต
        </div>
        <div style="font-size: 13px; color: #64748b; margin-bottom: 12px">
          เจ้าหน้าที่ที่เลือกจะเห็นหนังสือที่สถานศึกษาส่งมาให้ สพป. และรับมอบหมายเป็นสารบัญ
        </div>

        <div v-if="!officeStaff.length" style="color: #94a3b8; font-size: 13px">ยังไม่มีเจ้าหน้าที่</div>
        <div v-else>
          <div
            v-for="s in officeStaff"
            :key="s.id"
            style="display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid #f1f5f9"
          >
            <span style="flex: 1; font-size: 14px">{{ (s.title || '') + ' ' + (s.full_name || '') }}</span>
            <button
              class="btn btn-danger"
              style="font-size: 11px; padding: 2px 8px"
              :disabled="busy"
              @click="removeOfficeStaff(s)"
            >
              ✕ ลบ
            </button>
          </div>
        </div>

        <div style="display: flex; align-items: center; margin-top: 10px; gap: 8px">
          <select
            v-model="officeSel"
            style="padding: 6px; border-radius: 6px; font-size: 14px; min-width: 300px; margin-right: 8px; vertical-align: middle"
          >
            <option value="">-- เลือกเจ้าหน้าที่ --</option>
            <option v-for="u in officeCandidates" :key="u.id" :value="String(u.id)">{{ staffLabel(u) }}</option>
          </select>
          <button
            class="btn btn-primary"
            style="font-size: 13px; padding: 6px 16px; vertical-align: middle"
            :disabled="busy"
            @click="addOfficeStaff"
          >
            + เพิ่ม
          </button>
        </div>
      </template>

      <!-- ===== สารบัญสถานศึกษา ===== -->
      <template v-else>
        <div style="font-size: 16px; font-weight: bold; margin-bottom: 8px; color: #1e40af">
          🏫 กำหนดเจ้าหน้าที่สารบัญสถานศึกษา
        </div>
        <div style="font-size: 13px; color: #64748b; margin-bottom: 12px">
          เลือกสถานศึกษา แล้วเลือกเจ้าหน้าที่สถานศึกษาที่จะรับหนังสือจาก สพป.
        </div>

        <select
          v-model="schoolSel"
          style="padding: 6px; border-radius: 6px; min-width: 300px; margin-bottom: 10px"
          @change="onSchoolChange"
        >
          <option value="">-- เลือกสถานศึกษา --</option>
          <option v-for="s in allSchools" :key="s.code" :value="s.code || ''">{{ (s.code || '') + ' ' + (s.name || '') }}</option>
        </select>

        <div v-if="staffLoading" class="hint">กำลังโหลดเจ้าหน้าที่...</div>

        <template v-else-if="schoolSel">
          <div v-if="!schoolUsers.length" class="hint" style="padding: 8px">
            ไม่มีเจ้าหน้าที่สถานศึกษาในโรงเรียนนี้
          </div>

          <template v-else>
            <div class="hint" style="margin-bottom: 4px">
              ติ๊กไว้ {{ checkedIds.length }} / {{ schoolUsers.length }} · บันทึกแล้ว
              {{ assignedForSchool.length }} คน
            </div>
            <div
              v-for="u in schoolUsers"
              :key="u.id"
              style="display: flex; align-items: center; gap: 8px; padding: 6px 4px; border-bottom: 1px solid #f1f5f9; cursor: pointer; font-size: 14px; white-space: nowrap; justify-content: flex-start"
              @click="toggleUser(u.id)"
            >
              <input type="checkbox" :checked="checkedIds.includes(u.id)" @click.stop="toggleUser(u.id)" />
              <span class="ds-name">{{ (u.title || '') + ' ' + (u.full_name || '') }}</span>
              <span v-if="u.position" class="ds-position">{{ u.position }}</span>
            </div>

            <button
              class="btn btn-primary"
              style="margin-top: 10px; font-size: 13px"
              :disabled="busy"
              @click="saveSchoolStaff"
            >
              ▽ บันทึก
            </button>
          </template>
        </template>
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
