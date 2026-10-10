<script setup>
/**
 * TravelPage — เมนู 8/9: ขออนุมัติ/อนุญาตเดินทางไปราชการ
 *
 * ย้าจาก src/views/TravelView.js (โค้ดเดิมที่ port เป็น ES module)
 * เป็น Vue SFC โดยแยกหน้าต่างย่อยเป็น component:
 *   TravelForm.vue       — แบบฟอร์มยื่นคำขอ (A4)
 *   TravelDoc.vue        — ฉบับสำเร็จสำหรับดูรายละเอียดและพิมพ์
 *   TravelDecide.vue     — หน้าต่างพิจารณา (3 รูปแบบตามขั้น)
 *   TravelApprovers.vue  — กำหนดผู้อนุมัติ (admin)
 *
 * หน้าเดียวใช้ 2 สโคป
 *   scope = 'office' → เมนู 8  (เจ้าหน้าที่ สพป.แพร่ เขต 2)
 *   scope = 'school' → เมนู 9  (เจ้าหน้าที่สถานศึกษา)
 * แตกต่างกันแค่ชื่อหน้า และการซ่อนปุ่ม "ยื่นคำขอ" เมื่อผู้ใช้เป็นฝ่าย สพป.
 * (ฝ่าย สพป. บนหน้าสถานศึกษามีหน้าที่ตรวจสอบเท่านั้น จึงยื่นไม่ได้)
 */
import { ref, computed, watch, onMounted } from 'vue';
import api from '../api/client.js';
import { UI } from '../ui/ui.js';
import { Auth } from '../stores/auth.js';
import { ExportFilterDialog } from '../ui/ExportFilter.js';
import StatusBadge from '../components/ui/StatusBadge.vue';
import TravelForm from '../components/ui/TravelForm.vue';
import TravelDoc from '../components/ui/TravelDoc.vue';
import TravelDecide from '../components/ui/TravelDecide.vue';
import TravelApprovers from '../components/ui/TravelApprovers.vue';

const props = defineProps({
  /** 'office' | 'school' — ส่งมาจาก registry */
  scope: { type: String, default: 'office' },
});

const isSchoolScope = computed(() => props.scope === 'school');
const groupParam = computed(() => (isSchoolScope.value ? 'school' : 'office'));
const pageTitle = computed(() =>
  isSchoolScope.value
    ? 'ขออนุมัติ/อนุญาตเดินทางไปราชการ (สถานศึกษา)'
    : 'ขออนุมัติ/อนุญาตเดินทางไปราชการ',
);

/**
 * ปุ่มยื่นคำขอ
 * หน้าสถานศึกษา: ซ่อนเมื่อผู้ใช้เป็นฝ่าย สพป. เพราะหน้านั้นเป็นหน้าตรวจสอบของ สพป.
 */
const canSubmit = computed(
  () =>
    !isSchoolScope.value ||
    (Auth.user && (Auth.user.user_group === 'school' || Auth.user.role === 'admin')),
);

/* ---------- ตัวกรอง ---------- */
const curYear = new Date().getFullYear() + 543;
const status = ref('');
const year = ref(String(curYear));

/* ---------- รายการ ---------- */
const requests = ref([]);
const loading = ref(true);
const loadError = ref('');
const approvers = ref({});
const approversSchool = ref({});

async function load() {
  loading.value = true;
  loadError.value = '';
  const params = [];
  if (status.value) params.push('status=' + UI.encodePath(status.value));
  if (year.value) params.push('year=' + year.value);
  params.push('group=' + groupParam.value);
  try {
    const data = await api.get('/travel?' + params.join('&'));
    requests.value = data.requests || [];
    approvers.value = data.travelApprovers || {};
    approversSchool.value = data.travelApproversSchool || {};
  } catch (e) {
    requests.value = [];
    loadError.value = e.message;
  } finally {
    loading.value = false;
  }
}

watch([status, year, groupParam], load);
onMounted(load);

/* ---------- สิทธิ์อนุมัติ ----------
 * โครงสร้างต่างกันตามสายของ "ผู้ขอ" ไม่ใช่สายของหน้าที่เห็น
 *   สาย สพป.   : ขั้น1 supervisor, ขั้น2 approver
 *   สายสถานศึกษา: ขั้น1 reviewer, ขั้น2 supervisor, ขั้น3 approver
 */
function requestIsSchool(r) {
  return (r.user_group || 'office') === 'school';
}

/** ขั้นถัดไปที่ต้องดำเนินการ */
function nextLevel(r) {
  return UI.approvalDone(r) + 1;
}

/** ผู้ใช้คนนี้อนุมัติคำขอนี้ในขั้นที่ยังรออยู่หรือไม่ */
function canApprove(r) {
  if (!Auth.isLoggedIn() || !r || r.status !== 'pending') return false;
  const u = Auth.user;
  if (!u) return false;
  if (u.role === 'admin') return true;
  if (!u.can_approve) return false;

  const next = nextLevel(r);
  const school = requestIsSchool(r);
  const entry = school
    ? approversSchool.value[String(r.user_id)]
    : approvers.value[String(r.user_id)];
  if (!entry) return false;

  if (school) {
    if (next === 1) return Number(entry.reviewer) === u.id;
    if (next === 2) return Number(entry.supervisor) === u.id;
    if (next === 3) return Number(entry.approver) === u.id;
    return false;
  }
  if (next === 1) return Number(entry.supervisor) === u.id;
  if (next === 2) return Number(entry.approver) === u.id;
  return false;
}

function canDecide(r) {
  if (!Auth.isLoggedIn() || !r || r.status !== 'pending') return false;
  if (Auth.isAdmin()) return true;
  return canApprove(r);
}

/** ป้ายปุ่มอนุมัติตามขั้น — สายสถานศึกษาขั้นแรกใช้คำว่า "ตรวจสอบ" */
function approveButtonLabel(r) {
  const next = nextLevel(r);
  if (requestIsSchool(r) && next === 1) return '⊙ ตรวจสอบ';
  return next === 1 ? '● ควรอนุมัติ/อนุญาต' : '● อนุมัติ/อนุญาต';
}

/** เลขที่เอกสาร — รายการเก่าที่ไม่มีเลขต้องแสดงเป็นขีดกลาง ไม่ใช่ช่องว่าง */
function noOf(r) {
  return r.travel_no || '-';
}

function attachmentOf(r) {
  try {
    const raw = r.form_data;
    const fd = typeof raw === 'string' ? JSON.parse(raw) : raw || {};
    return fd.attachment || '';
  } catch {
    return '';
  }
}

function nameOf(r) {
  const first = [(r.user_title || '') + (r.first_name || ''), r.last_name || '']
    .filter(Boolean)
    .join(' ');
  return first || r.full_name || '';
}

/* ---------- รายละเอียด ---------- */
const detail = ref(null);

function openDetail(r) {
  detail.value = r;
}

/* ---------- ยื่นคำขอ ---------- */
const formOpen = ref(false);
const formSaving = ref(false);

async function submitForm(payload) {
  formSaving.value = true;
  try {
    let res;
    if (payload.attachment) {
      // มีไฟล์แนบ → ต้องส่งเป็น multipart/form-data
      const { attachment, ...rest } = payload;
      const fd = new FormData();
      for (const [k, v] of Object.entries(rest)) {
        fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v);
      }
      fd.append('attachment', attachment);
      res = await fetch('/api/travel', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + Auth.token },
        body: fd,
      }).then((r) => r.json());
      if (res.error) throw new Error(res.error);
    } else {
      const { attachment, ...rest } = payload;
      res = await api.post('/travel', rest);
    }
    UI.toast(res.message);
    formOpen.value = false;
    await load();
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    formSaving.value = false;
  }
}

/* ---------- พิจารณา ---------- */
const decideOpen = ref(false);
const decideTarget = ref(null);
const decideMode = ref('level1');

/**
 * เปิดหน้าต่างพิจารณา และเลือกรูปแบบให้ตรงกับขั้น
 *   ขั้น 1 สายสถานศึกษา → 'forward'  (เสนอเรื่อง ไม่บันทึกความเห็น)
 *   ขั้น 1 สาย สพป.   → 'level1'   (ควรอนุมัติ/ไม่ควรอนุมัติ/…)
 *   ขั้นสุดท้าย         → 'final'    (อนุมัติ/ไม่อนุมัติ/… + ตำแหน่ง)
 */
function openDecide(r) {
  const next = nextLevel(r);
  const school = requestIsSchool(r);
  if (school && next === 1) decideMode.value = 'forward';
  else if (next === 1) decideMode.value = 'level1';
  else decideMode.value = 'final';

  decideTarget.value = r;
  decideOpen.value = true;
}

async function onDecide(out) {
  const r = decideTarget.value;
  if (!r) return;
  decideOpen.value = false;

  try {
    let res;
    if (decideMode.value === 'forward') {
      // ผู้ตรวจสอบสายสถานศึกษา: ส่ง approve ว่าง ๆ ไม่บันทึกความเห็น
      res = await api.put(`/travel/${r.id}/approve`, {});
    } else {
      const note = JSON.stringify({ choices: out.choices || [], reasonMap: out.reasonMap || {} });
      const body = decideMode.value === 'final' ? { note, position: out.position } : { note };
      res = await api.put(`/travel/${r.id}/approve`, body);
    }
    UI.toast(res.message);
    await load();
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

/* ---------- ลบ ---------- */
async function remove(r) {
  const yes = await UI.confirm('ต้องการลบรายการคำขอนี้ใช่หรือไม่?', { danger: true, okText: 'ลบ' });
  if (!yes) return;
  try {
    const res = await api.del('/travel/' + r.id);
    UI.toast(res.message);
    await load();
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

/* ---------- กำหนดผู้อนุมัติ ---------- */
const approversOpen = ref(false);
const approversSaving = ref(false);

async function saveApprovers({ office, school }) {
  approversSaving.value = true;
  try {
    await api.put('/settings/travel-approvers', office);
    const res = await api.put('/settings/travel-approvers-school', school);
    UI.toast(res.message);
    approversOpen.value = false;
    await load();
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    approversSaving.value = false;
  }
}

/* ---------- ดาวน์โหลด Excel ---------- */
const STATUS_TH = {
  pending: 'รออนุมัติ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก',
};

function openExportDialog() {
  ExportFilterDialog.open({
    years: [curYear, curYear - 1],
    title: pageTitle.value,
    getRows: async (yBE, m, wkStart, wkEnd) => {
      const qs = [];
      if (yBE) qs.push('year=' + yBE);
      qs.push('group=' + groupParam.value);
      const data = await api.get('/travel?' + qs.join('&'));
      const rows = ExportFilterDialog.filterRows(
        data.requests || [],
        'date_from',
        yBE,
        m,
        wkStart,
        wkEnd,
      );
      const headers = [
        'เลขที่คำขอ',
        'เรื่อง',
        'ผู้ขอ',
        'สถานที่',
        'วันเดินทาง',
        'ถึงวันที่',
        'จำนวนวัน',
        'สถานะ',
      ];
      const out = rows.map((r) => [
        r.travel_no || '',
        r.title || '',
        nameOf(r),
        r.destination || '',
        r.date_from ? UI.date(r.date_from) : '',
        r.date_to ? UI.date(r.date_to) : '',
        r.days || 1,
        STATUS_TH[r.status] || r.status || '',
      ]);
      return { rows: out, headers, fileName: pageTitle.value };
    },
  });
}
</script>

<template>
  <div class="page-head">
    <div>
      <div class="page-title"><span class="pi">✈</span>{{ pageTitle }}</div>
      <div class="page-desc">ยื่นคำขอเดินทางไปราชการ รอผู้อนุมัติ</div>
    </div>
    <button v-if="canSubmit" class="btn btn-primary" @click="formOpen = true">
      ✈ ยื่นคำขอไปราชการ
    </button>
  </div>

  <!-- ---------- ตัวกรอง ---------- -->
  <div class="filter-row" style="display: flex; align-items: center; gap: 10px">
    <select id="trv-status" v-model="status">
      <option value="">ทุกสถานะ</option>
      <option value="pending">รออนุมัติ</option>
      <option value="approved">อนุมัติแล้ว</option>
      <option value="rejected">ไม่อนุมัติ</option>
      <option value="cancelled">ยกเลิก</option>
    </select>
    <select id="trv-year" v-model="year">
      <option :value="String(curYear)">{{ curYear }}</option>
      <option :value="String(curYear - 1)">{{ curYear - 1 }}</option>
      <option value="">ทุกปี</option>
    </select>

    <button
      class="btn btn-primary"
      style="background: #059669; margin-left: auto"
      title="ดาวน์โหลดข้อมูลเป็นไฟล์ Excel ตามตัวกรอง"
      @click="openExportDialog"
    >
      ⬇ ดาวน์โหลดข้อมูล
    </button>
    <button
      v-if="Auth.isAdmin()"
      class="btn btn-primary"
      style="font-size: 13px"
      @click="approversOpen = true"
    >
      ⊛ กำหนดผู้อนุมัติ
    </button>
  </div>

  <!-- ---------- ตาราง ---------- -->
  <div class="card">
    <div class="card-title">
      ▭ รายการขออนุมัติ/อนุญาตเดินทางไปราชการ ({{ requests.length }} รายการ)
    </div>

    <div v-if="loading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>

    <div v-else-if="loadError" class="empty-state"><span class="em">⚠️</span>{{ loadError }}</div>

    <div v-else-if="requests.length === 0" class="empty-state">
      <span class="em">✈</span>ยังไม่มีรายการ
    </div>

    <div v-else class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>เลขที่คำขอ</th>
            <th>เรื่อง</th>
            <th>สถานที่</th>
            <th>วันเดินทาง</th>
            <th class="num">จำนวนวัน</th>
            <th>สถานะ</th>
            <th>เอกสารแนบ</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in requests" :key="r.id">
            <td>{{ noOf(r) }}</td>
            <td>{{ r.title }}</td>
            <td>{{ r.destination }}</td>
            <td>{{ UI.date(r.date_from) }} ถึง {{ UI.date(r.date_to) }}</td>
            <td class="num">{{ r.days }}</td>
            <td><StatusBadge :status="r.status" /></td>
            <td>
              <a
                v-if="attachmentOf(r)"
                :href="'/uploads/' + UI.encodePath(attachmentOf(r))"
                target="_blank"
                style="color: #2563eb; text-decoration: underline"
                @click.stop
                >✈ ดูเอกสาร</a
              >
              <span v-else style="color: #9ca3af">-</span>
            </td>
            <td>
              <div class="status-btns">
                <button class="btn btn-xs btn-outline" @click="openDetail(r)">👁️</button>
                <button
                  v-if="canApprove(r)"
                  class="btn btn-xs btn-primary"
                  @click="openDecide(r)"
                >
                  {{ approveButtonLabel(r) }}
                </button>
                <button
                  v-if="Auth.isAdmin() || r.user_id === Auth.user?.id"
                  class="btn btn-xs btn-outline danger-btn"
                  @click="remove(r)"
                >
                  ✕
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- ---------- หน้าต่างย่อย ---------- -->
  <TravelForm v-if="formOpen" :saving="formSaving" @close="formOpen = false" @submit="submitForm" />

  <TravelDoc v-if="detail" :record="detail" @close="detail = null" />

  <TravelDecide
    v-if="decideOpen"
    :record="decideTarget"
    :mode="decideMode"
    @close="decideOpen = false"
    @confirm="onDecide"
  />

  <TravelApprovers
    v-if="approversOpen"
    :saving="approversSaving"
    @close="approversOpen = false"
    @save="saveApprovers"
  />
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
