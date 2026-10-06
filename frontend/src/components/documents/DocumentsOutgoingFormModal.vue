<script setup>
/**
 * DocumentsOutgoingFormModal — ฟอร์มลงทะเบียนเลขหนังสือส่ง
 *
 * ย้ายจาก DocumentsView.openForm() สาขา outgoing (บรรทัด 801-928)
 *
 * เลขที่หนังสือต่างกันตามฝั่งผู้ส่ง:
 *   สพป.      ที่ ศธ 04110/[ว]N      (มีช่องติ๊ก "ว" สำหรับหนังสือที่มีหมายเลขวง/ฉบับ)
 *   สถานศึกษา ที่ ศธ 04110.N/N      (N = เลขที่กำหนดไว้ในระบบ)
 *
 * เปลี่ยนวันที่แล้วเลขรันจะเปลี่ยนตามปีของวันนั้น (เฉพาะตอนสร้างใหม่และผู้ใช้สำนักงาน)
 */
import { ref, computed, watch, onMounted } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import { Auth } from '../../stores/auth.js';
import { fetchNextDocNo, fetchWorkplaceGroups, fetchOfficeStaff } from '../../lib/documents-form.js';
import ThaiDateField from '../ui/ThaiDateField.vue';
import AppModal from '../ui/AppModal.vue';

const props = defineProps({
  /** record ที่กำลังแก้ไข (null = สร้างใหม่) */
  doc: { type: Object, default: null },
});

const emit = defineEmits(['close', 'saved']);

const d = computed(() => props.doc || {});
const u = computed(() => Auth.user || {});
const isSchoolUser = computed(() => u.value.user_group === 'school');

const modalTitle = computed(() =>
  d.value.id
    ? '✎ แก้ไขหนังสือราชการ'
    : isSchoolUser.value
      ? '▭ ลงทะเบียนเลขหนังสือส่งของสถานศึกษา'
      : '▭ ลงทะเบียนเลขหนังสือส่ง',
);

/* ---------- ค่าในฟอร์ม ---------- */
const noMain = ref('1'); // เลขรันหลัก
const noWor = ref(false); // ช่องติ๊ก "ว" (ฝั่ง สพป.)
const noSchool = ref('1'); // เลขรันของสถานศึกษา
const dateTH = ref(UI.today());
const fromOrg = ref('');
const toOrg = ref('');
const title = ref('');
const workgroup = ref('');
const assignee = ref('');
const note = ref('');

/** เลขที่หนังสือสถานศึกษาที่กำหนดไว้ในระบบ (readonly) */
const schoolPrefix = ref('');
const schoolPrefixLocked = computed(() => !!schoolPrefix.value);

/* ---------- ตัวเลือก ---------- */
const workgroups = ref([]);
const staffList = ref([]);

/* ---------- ไฟล์แนบ ---------- */
const fileRows = ref([]);
let seq = 1;

const MAX_FILES = 7;

function addFileRow() {
  if (fileRows.value.length >= MAX_FILES) {
    UI.toast('แนบไฟล์ได้สูงสุด 7 ไฟล์', 'error');
    return;
  }
  fileRows.value.push({ key: seq++, file: null });
}

function removeFileRow(key) {
  fileRows.value = fileRows.value.filter((r) => r.key !== key);
}

/* ---------- โหลด ---------- */
const saving = ref(false);

onMounted(async () => {
  // ค่าจาก record
  toOrg.value = d.value.to_org || '';
  title.value = d.value.title || '';
  workgroup.value = d.value.workgroup || '';
  assignee.value = d.value.assignee ? String(d.value.assignee) : '';
  note.value = d.value.note || '';
  dateTH.value = d.value.date || UI.today();

  // ฝั่งสถานศึกษา: "จาก" ตามโรงเรียนของผู้ใช้
  fromOrg.value = isSchoolUser.value
    ? (u.value.current_school || u.value.workplace || '')
    : 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2';

  // เลขที่รันถัดไป
  const next = await fetchNextDocNo('outgoing');
  noMain.value = next || '1';
  noSchool.value = next || '1';

  if (!isSchoolUser.value) {
    workgroups.value = await fetchWorkplaceGroups();
    staffList.value = await fetchOfficeStaff();
  }

  // เลขที่หนังสือสถานศึกษา (ถ้าผู้ใช้เป็นเจ้าหน้าที่สถานศึกษา)
  if (isSchoolUser.value) {
    try {
      const px = await api.get('/document-staff/school-prefix');
      schoolPrefix.value = px.doc_prefix || '';
    } catch {
      schoolPrefix.value = '';
    }
  }

  addFileRow();
});

/**
 * เปลี่ยนวันที่ → ดึงเลขรันใหม่ตามปีของวันที่
 * (เฉพาะสร้างใหม่และผู้ใช้สำนักงาน เพราะสถานศึกษาใช้เลขที่ตั้งไว้แทน)
 */
watch(dateTH, async (iso) => {
  if (d.value.id || isSchoolUser.value) return;
  if (!iso) return;
  const next = await fetchNextDocNo('outgoing&date=' + iso);
  if (next) noMain.value = next;
});

/* ---------- เลขที่หนังสือเต็ม ---------- */
const fullDocNo = computed(() =>
  isSchoolUser.value
    ? 'ที่ ศธ 04110.' + (noMain.value.trim() || '1') + '/' + (noSchool.value.trim() || '1')
    : 'ที่ ศธ 04110/' + (noWor.value ? 'ว' : '') + (noMain.value.trim() || '1'),
);

/* ---------- บันทึก ---------- */
async function save() {
  if (saving.value) return;

  if (!title.value.trim()) {
    UI.toast('กรุณากรอกเรื่อง', 'error');
    return;
  }
  if (!dateTH.value) {
    UI.toast('กรุณาระบุวันที่', 'error');
    return;
  }

  saving.value = true;
  try {
    const fd = new FormData();
    fd.append('doc_type', 'outgoing');
    fd.append('sender_type', 'registered');
    fd.append('doc_no', fullDocNo.value);
    fd.append('date', dateTH.value);
    fd.append('title', title.value.trim());
    fd.append('from_org', fromOrg.value.trim());
    fd.append('to_org', toOrg.value.trim());
    fd.append('note', note.value.trim());
    fd.append('workgroup', workgroup.value);
    if (isSchoolUser.value) fd.append('assignee', assignee.value);

    for (const r of fileRows.value) {
      if (r.file) fd.append('files', r.file);
    }

    if (d.value.id) await api.putForm('/documents/' + d.value.id, fd);
    else await api.postForm('/documents', fd);

    UI.toast('บันทึกเรียบร้อย');
    emit('saved');
  } catch (e) {
    UI.toast(e.message || 'เกิดข้อผิดพลาด', 'error');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :title="modalTitle" size="lg" footer @close="emit('close')">
    <div class="form-grid">
      <!-- ---------- เลขที่หนังสือ ---------- -->
      <div class="form-group full">
        <label>เลขที่หนังสือ<span class="req"> *</span></label>
        <div style="display: flex; align-items: center; gap: 4px; width: 100%">
          <template v-if="isSchoolUser">
            <span style="font-size: 14px; color: #334155; white-space: nowrap">ที่ ศธ 04110.</span>
            <input
              v-model="noMain"
              :readonly="schoolPrefixLocked"
              :style="{ width: '80px', textAlign: 'center', background: schoolPrefixLocked ? '#f0f0f0' : '#fff' }"
            />
            <span style="font-size: 14px; color: #334155; white-space: nowrap">/</span>
            <input
              v-model="noSchool"
              readonly
              style="width: 60px; text-align: center; background: #f0f0f0"
            />
          </template>

          <template v-else>
            <span style="font-size: 14px; color: #334155; white-space: nowrap">ที่ ศธ 04110/</span>
            <input v-model="noWor" type="checkbox" style="width: 16px; height: 16px; cursor: pointer" />
            <span style="font-size: 14px; color: #334155; cursor: pointer" @click="noWor = !noWor">ว</span>
            <input v-model="noMain" style="width: 60px; text-align: center" />
          </template>
        </div>
      </div>

      <div class="form-group">
        <label>วันที่<span class="req"> *</span></label>
        <ThaiDateField v-model="dateTH" />
      </div>

      <div class="form-group full">
        <label>จาก<span class="req"> *</span></label>
        <input v-model="fromOrg" readonly style="background: #f0f0f0" />
      </div>

      <div class="form-group full">
        <label>ถึง</label>
        <input v-model="toOrg" placeholder="เช่น โรงเรียนในสังกัด" />
      </div>

      <div class="form-group full">
        <label>เรื่อง<span class="req"> *</span></label>
        <input v-model="title" placeholder="เช่น ขอความอนุเคราะห์ข้อมูลบุคลากร" />
      </div>

      <!-- ---------- กลุ่มปฏิบัติ + ผู้ปฏิบัติ (เฉพาะฝั่ง สพป.) ---------- -->
      <template v-if="!isSchoolUser">
        <div class="form-group">
          <label>กลุ่มปฏิบัติ</label>
          <select v-model="workgroup" style="width: 100%; padding: 8px; font-size: 14px">
            <option value="">-- เลือกกลุ่มปฏิบัติ --</option>
            <option v-for="g in workgroups" :key="g" :value="g">{{ g }}</option>
          </select>
        </div>
        <div class="form-group">
          <label>บุคคลปฏิบัติ</label>
          <select v-model="assignee" style="width: 100%; padding: 8px; font-size: 14px">
            <option value="">-- เลือกบุคคลปฏิบัติ --</option>
            <option v-for="s in staffList" :key="s.id" :value="String(s.id)">
              {{ (s.title || '') + ' ' + (s.full_name || '') }}
            </option>
          </select>
        </div>
      </template>

      <div class="form-group full">
        <label>หมายเหตุ</label>
        <input v-model="note" />
      </div>

      <!-- ---------- แนบไฟล์ ---------- -->
      <div class="form-group full">
        <label>แนบไฟล์</label>
        <div style="display: flex; flex-direction: column; gap: 4px">
          <div v-for="r in fileRows" :key="r.key" style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px">
            <input
              type="file"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
              style="font-size: 13px; flex: 1"
              @change="
                (e) => {
                  const row = fileRows.find((x) => x.key === r.key);
                  if (row) row.file = e.target.files[0] || null;
                }
              "
            />
            <button
              type="button"
              style="background: #ef4444; color: #fff; border: none; border-radius: 4px; cursor: pointer; padding: 2px 6px; font-size: 12px; line-height: 1"
              @click="removeFileRow(r.key)"
            >
              ✕
            </button>
          </div>

          <button
            type="button"
            style="align-self: flex-start; background: #2563eb; color: #fff; border: none; border-radius: 4px; cursor: pointer; padding: 4px 14px; font-size: 13px; margin-top: 4px"
            @click="addFileRow"
          >
            เพิ่มไฟล์
          </button>
        </div>
      </div>
    </div>

    <template #footer>
      <div style="display: flex; gap: 8px">
        <button class="btn btn-outline" @click="emit('close')">ยกเลิก</button>
        <button class="btn btn-primary" :disabled="saving" @click="save">
          {{ saving ? 'กำลังบันทึก...' : '▽ บันทึก' }}
        </button>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
/* form-grid / form-group / req มาจาก styles/theme.css */
</style>
