<script setup>
/**
 * DocumentsStaffSettingsModal — กำหนดเจ้าหน้าที่หนังสือราชการ (admin only)
 *
 * ย้ายจาก DocumentsView.openStaffSettings() (119 บรรทัด)
 *
 * สองส่วน:
 *   1. ⬡ เจ้าหน้าที่หนังสือราชการ สพป.แพร่ เขต 2  — เห็นหนังสือที่สถานศึกษาส่งมา
 *   2. 🏫 เจ้าหน้าที่หนังสือราชการ สถานศึกษา          — รับหนังสือจาก สพป. (ต้องเลือกหลายคนได้)
 *
 * ต้องเลือกสถานศึกษาก่อน จึงจะเห็นรายชื่อเจ้าหน้าที่ของโรงเรียนนั้น
 */
import { ref, computed, onMounted } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import AppModal from '../ui/AppModal.vue';

const emit = defineEmits(['close']);

/* ---------- ข้อมูลจาก API ---------- */
const data = ref({ officeStaff: [], schoolStaff: [] });
const allStaff = ref([]);
const allSchools = ref([]);

const loading = ref(true);
const saving = ref(false);

/* ---------- ส่วนที่ 1: เจ้าหน้าที่ สพป. ---------- */
const officeSet = computed(() => new Set((data.value.officeStaff || []).map((s) => s.user_id)));
const officeCandidates = computed(() =>
  allStaff.value.filter((u) => u.user_group !== 'school' && u.status === 'active' && !officeSet.value.has(u.id)),
);
const officeSel = ref('');

async function addOfficeStaff() {
  const uid = Number(officeSel.value);
  if (!uid) {
    UI.toast('กรุณาเลือกเจ้าหน้าที่', 'error');
    return;
  }
  try {
    await api.post('/document-staff/office', { userIds: [uid] });
    UI.toast('เพิ่มเจ้าหน้าที่เรียบร้อย');
    data.value = await api.get('/document-staff');
    officeSel.value = '';
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

async function removeOfficeStaff(s) {
  try {
    await api.del('/document-staff/office/' + s.id);
    UI.toast('ลบเรียบร้อย');
    data.value = await api.get('/document-staff');
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

/* ---------- ส่วนที่ 2: เจ้าหน้าที่สถานศึกษา ---------- */
const schoolSel = ref('');
const schoolSelSaving = ref(false);

/**
 * เจ้าหน้าที่สถานศึกษาของโรงเรียนที่เลือก
 *
 * รวมทั้งผู้ที่ดูแลโรงเรียนนี้เป็นที่หลัก (workplace ขึ้นต้นด้วยรหัส)
 * และผู้ที่ดูแลเป็นที่รอง (workplace_secondary เป็น JSON array)
 */
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

/** user id ที่ติ๊กไว้แล้วของโรงเรียนที่เลือก */
const checkedIds = ref([]);

const assignedForSchool = computed(() =>
  (data.value.schoolStaff || []).filter((s) => s.school_code === schoolSel.value),
);

function toggleUser(id) {
  const i = checkedIds.value.indexOf(id);
  if (i >= 0) checkedIds.value.splice(i, 1);
  else checkedIds.value.push(id);
}

/** สลับเลือกทั้งหมดของโรงเรียนที่เลือก */
function toggleAll() {
  checkedIds.value =
    checkedIds.value.length === schoolUsers.value.length
      ? []
      : schoolUsers.value.map((u) => u.id);
}

async function saveSchoolStaff() {
  const code = schoolSel.value;
  if (!code) return;
  schoolSelSaving.value = true;
  try {
    await api.post('/document-staff/school', { school_code: code, userIds: checkedIds.value });
    UI.toast('บันทึกเจ้าหน้าที่สถานศึกษาเรียบร้อย');
    data.value = await api.get('/document-staff');
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    schoolSelSaving.value = false;
  }
}

// เปลี่ยนโรงเรียน → เตรียมรายการที่ติ๊กไว้ตามที่บันทึกไว้แล้ว
function onSchoolChange() {
  const assigned = (data.value.schoolStaff || []).filter((s) => s.school_code === schoolSel.value);
  checkedIds.value = assigned.map((s) => s.user_id);
}

const staffLabel = (u) => (u.title ? u.title + ' ' : '') + (u.full_name || '') + (u.position ? ' — ' + u.position : '');

onMounted(async () => {
  try {
    data.value = await api.get('/document-staff');
  } catch {
    data.value = { officeStaff: [], schoolStaff: [] };
  }
  try {
    const d = await api.get('/staff');
    allStaff.value = d.users || d.staff || [];
  } catch {
    allStaff.value = [];
  }
  try {
    const d = await api.get('/schools');
    allSchools.value = (d.schools || []).sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'th', { numeric: true }));
  } catch {
    allSchools.value = [];
  }
  loading.value = false;
});
</script>

<template>
  <AppModal title="⊛ ตั้งค่าเจ้าหน้าที่หนังสือราชการ" size="lg" @close="emit('close')" footer>
    <div style="max-height: 70vh; overflow-y: auto">
      <div v-if="loading" class="hint">กำลังโหลดข้อมูล...</div>

      <template v-else>
        <!-- ===== ส่วนที่ 1: เจ้าหน้าที่ สพป. ===== -->
        <div style="margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px">
          <div style="font-size: 16px; font-weight: bold; margin-bottom: 12px; color: #1e40af">
            ⬡ กำหนดเจ้าหน้าที่หนังสือราชการ สพป.แพร่ เขต 2
          </div>
          <div style="font-size: 13px; color: #64748b; margin-bottom: 10px">
            เจ้าหน้าที่ที่เลือกจะเห็นหนังสือที่สถานศึกษาส่งมาให้ สพป.แพร่ เขต 2
          </div>

          <div v-if="!data.officeStaff.length" style="color: #94a3b8; font-size: 13px">ยังไม่มีเจ้าหน้าที่</div>
          <div v-else>
            <div
              v-for="s in data.officeStaff"
              :key="s.id"
              style="display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid #f1f5f9"
            >
              <span style="flex: 1; font-size: 14px">{{ (s.title || '') + ' ' + (s.full_name || '') }}</span>
              <button
                class="btn btn-danger"
                style="font-size: 11px; padding: 2px 8px"
                :disabled="saving"
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
              :disabled="saving"
              @click="addOfficeStaff"
            >
              + เพิ่ม
            </button>
          </div>
        </div>

        <!-- ===== ส่วนที่ 2: เจ้าหน้าที่สถานศึกษา ===== -->
        <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px">
          <div style="font-size: 16px; font-weight: bold; margin-bottom: 12px; color: #1e40af">
            🏫 กำหนดเจ้าหน้าที่หนังสือราชการ สถานศึกษา
          </div>
          <div style="font-size: 13px; color: #64748b; margin-bottom: 10px">
            เลือกสถานศึกษา แล้วเลือกเจ้าหน้าที่สารบัญ (เลือกได้หลายคน ต้องเป็นเจ้าหน้าที่ที่ดูแลสถานศึกษานั้นๆ)
          </div>

          <select
            v-model="schoolSel"
            style="padding: 6px; border-radius: 6px; min-width: 300px; margin-bottom: 10px"
            @change="onSchoolChange"
          >
            <option value="">-- เลือกสถานศึกษา --</option>
            <option v-for="s in allSchools" :key="s.code" :value="s.code || ''">{{ (s.code || '') + ' ' + (s.name || '') }}</option>
          </select>

          <div v-if="schoolSel">
            <div v-if="!schoolUsers.length" class="hint" style="padding: 8px">
              ไม่มีเจ้าหน้าที่สถานศึกษาในโรงเรียนนี้
            </div>

            <template v-else>
              <div
                style="display: flex; align-items: center; gap: 8px; padding: 4px; font-size: 13px; margin-bottom: 4px; color: #334155"
              >
                <input
                  type="checkbox"
                  :checked="checkedIds.length === schoolUsers.length && schoolUsers.length > 0"
                  @change="toggleAll"
                />
                <span>เลือกทั้งหมด</span>
                <span class="hint">
                  (ติ๊กไว้ {{ checkedIds.length }} / {{ schoolUsers.length }} · บันทึกแล้ว
                  {{ assignedForSchool.length }} คน)
                </span>
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
                :disabled="schoolSelSaving"
                @click="saveSchoolStaff"
              >
                {{ schoolSelSaving ? 'กำลังบันทึก...' : '▽ บันทึก' }}
              </button>
            </template>
          </div>
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
