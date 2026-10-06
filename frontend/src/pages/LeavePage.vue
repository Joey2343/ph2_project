<script setup>
/**
 * LeavePage — เมนู 5/6: ขออนุญาตลา
 *
 * ย้ายจาก src/views/LeaveView.js (1,735 บรรทัด) เป็น Vue SFC
 *
 * หน้านี้มีแท็บย่อยหลายแท็บที่เห็นไม่เหมือนกันตามสิทธิ์:
 *   กลุ่มผู้ขอ   general (ลาป่วย/กิจ/คลอด) · vacation (ลาพักผ่อน) · general-school (สถานศึกษา)
 *   กลุ่มผู้ดูแล balance · settings-approver · settings-approver-school
 *   สถิติ        leave-stats · vac-stats · my-stats
 *
 * ผู้ใช้แต่ละกลุ่มเห็นแท็บต่างกัน:
 *   เจ้าหน้าที่สถานศึกษา → เฉพาะแท็บสถานศึกษา + สถิติของตัวเอง
 *   เจ้าหน้าที่ สพป.        → เฉพาะแท็บ สพป. + สถิติทุกแบบ (ยกเว้นสถิติของสถานศึกษา)
 *   admin                    → เห็นทั้งหมด
 *
 * แต่ละส่วนแยกเป็น component:
 *   LeaveForm.vue         — ฟอร์มยื่น/แก้ไขคำขอลา
 *   LeaveDoc.vue          — ใบลา A4 พร้อมพิมพ์
 *   LeaveReview.vue       — หน้าต่างผู้ตรวจสอบ (แก้สถิติได้)
 *   LeaveApproveNote.vue  — ความเห็นผู้บังคับบัญชาขั้นต้น
 *   LeaveBalance.vue      — แท็บวันลาพักผ่อนสะสม
 *   LeaveApprovers.vue    — ตั้งค่าเจ้าหน้าที่การลา 3 ลำดับ
 *   LeaveStats.vue        — แท็บสถิติ 3 แบบ
 */
import { ref, computed, watch, onMounted } from 'vue';
import api from '../api/client.js';
import { UI } from '../ui/ui.js';
import { Auth } from '../stores/auth.js';
import StatusBadge from '../components/ui/StatusBadge.vue';
import ApprovalSteps from '../components/ui/ApprovalSteps.vue';
import LeaveForm from '../components/ui/LeaveForm.vue';
import LeaveDoc from '../components/ui/LeaveDoc.vue';
import LeaveReview from '../components/ui/LeaveReview.vue';
import LeaveApproveNote from '../components/ui/LeaveApproveNote.vue';
import LeaveBalance from '../components/ui/LeaveBalance.vue';
import LeaveApprovers from '../components/ui/LeaveApprovers.vue';
import LeaveStats from '../components/ui/LeaveStats.vue';

/* ---------- นิยามแท็บ ---------- */
const LEAVE_GROUPS = [
  { key: 'general', label: '🤒 ขออนุญาตลาป่วย ลากิจ ลาคลอด', short: 'ลาป่วย / ลากิจ / ลาคลอด', btn: '🤒 ยื่นคำลาป่วย ลากิจ ลาคลอด', ugroup: 'office' },
  { key: 'vacation', label: '🏖️ ขออนุญาตลาพักผ่อน', short: 'ลาพักผ่อน', btn: '🏖️ ยื่นคำลาพักผ่อน', ugroup: 'office' },
  { key: 'general-school', label: '🏫 ลาป่วย ลากิจ ลาคลอด (สถานศึกษา)', short: 'ลาป่วย/ลากิจ/ลาคลอด (สถานศึกษา)', btn: '🤒 ยื่นคำลาป่วย ลากิจ ลาคลอด', ugroup: 'school' },
];
const ADMIN_GROUPS = [
  { key: 'balance', label: '◷ วันลาพักผ่อนสะสม', short: 'วันลาพักผ่อนสะสม' },
  { key: 'settings-approver', label: '⊛ เจ้าหน้าที่การลา สพป. (3 ลำดับ)', short: 'เจ้าหน้าที่การลา สพป.' },
  { key: 'settings-approver-school', label: '⊛ เจ้าหน้าที่การลาสถานศึกษา (3 ลำดับ)', short: 'เจ้าหน้าที่การลาสถานศึกษา' },
  { key: 'leave-stats', label: '📊 สถิติลาป่วย ลากิจ ลาคลอด', short: 'สถิติลา' },
  { key: 'vac-stats', label: '📊 สถิติลาพักผ่อน', short: 'สถิติลาพักผ่อน' },
  { key: 'my-stats', label: '📊 สถิติการลาของฉัน', short: 'สถิติการลาของฉัน' },
];

const isAdmin = computed(() => Auth.isAdmin());
const isSchool = computed(() => Auth.user && Auth.user.user_group === 'school');

/* ---------- สิทธิ์เจ้าหน้าที่การลา ---------- */
const approversData = ref(null);
const perPerson = ref(null);
const isLeaveStaff = ref(false);

const canSeeAll = computed(() => isAdmin.value || isLeaveStaff.value);

/* ---------- แท็บที่ผู้ใช้คนนี้เข้าถึงได้ ---------- */
const groups = computed(() => {
  const myUgroup = isSchool.value ? 'school' : 'office';
  const out = isAdmin.value
    ? LEAVE_GROUPS.slice()
    : LEAVE_GROUPS.filter((g) => g.ugroup === myUgroup);
  // วันลาพักผ่อนสะสม: admin + ผู้ตรวจสอบ
  if (isAdmin.value || isLeaveStaff.value) out.push(ADMIN_GROUPS[0]);
  // สถิติลาป่วย/กิจ/คลอด + สถิติลาพักผ่อน: เจ้าหน้าที่ สพป. เห็นทุกคน
  if (isAdmin.value || !isSchool.value) out.push(ADMIN_GROUPS[3], ADMIN_GROUPS[4]);
  // สถิติของฉัน: ทุกคนเห็น
  out.push(ADMIN_GROUPS[5]);
  // ตั้งค่าเจ้าหน้าที่การลา: admin เท่านั้น
  if (isAdmin.value) out.push(ADMIN_GROUPS[1], ADMIN_GROUPS[2]);
  return out;
});

/** แท็บที่ซ่อนปุ่มยื่นคำขอและแถวตัวกรอง */
const HIDE_FILTERS = ['balance', 'settings-approver', 'settings-approver-school'];
const STATS_TABS = ['leave-stats', 'vac-stats', 'my-stats'];

/* ---------- แท็บปัจจุบัน ----------
 * deep-link จาก URL: #/leave?tab=vacation (การ์ดแจ้งเตือนหน้าแรก)
 */
const current = ref('general');

/** รอบพิจารณาความชอบ: ปีงบประมาศเริ่มที่ ต.ค. */
function currentFY() {
  const d = new Date();
  return d.getMonth() >= 9 ? d.getFullYear() + 544 : d.getFullYear() + 543;
}

const fyOptions = computed(() => [currentFY() + 1, currentFY(), currentFY() - 1]);
const fy = ref(String(currentFY()));
const round = ref('year');
const status = ref('');
const myOnly = ref(!canSeeAll.value);

/** ตัวเลือกรอบต้องผูกกับปีงบประมาณที่เลือก */
const roundOptions = computed(() => {
  const y = Number(fy.value) || currentFY();
  return [
    { value: 'year', label: `ในรอบปีงบประมาณ ${y}` },
    { value: 'round1', label: `รอบที่ 1 (1 ต.ค. ${y - 1} - 31 มี.ค. ${y})` },
    { value: 'round2', label: `รอบที่ 2 (1 เม.ย. - 30 ก.ย. ${y})` },
  ];
});

/** ตั้งแท็บจาก URL/localStorage แล้วกรันตัวที่ผู้ใช้เข้าไม่ได้ออก */
function pickInitialTab() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '').get('tab');
  let t = q || localStorage.getItem('leave_tab') || 'general';
  // เจ้าหน้าที่การลา/ผู้ตรวจสอบที่ไม่ใช่ admin ยังเข้าแท็บสถิติ/ตั้งค่าไม่ได้
  if (!groups.value.some((g) => g.key === t)) t = 'general';
  if (!LEAVE_GROUPS.some((g) => g.key === t)) t = 'general';
  current.value = t;
  if (q) localStorage.setItem('leave_tab', t);
}

function setTab(k) {
  current.value = k;
  localStorage.setItem('leave_tab', k);
}

const hideSubmitRow = computed(() => HIDE_FILTERS.includes(current.value) || STATS_TABS.includes(current.value));
const hideFilterRow = computed(() => HIDE_FILTERS.includes(current.value));
/** แท็บสถิติของฉันต้องเห็นปีงบประมาณด้วย ส่วนแท็บสถิติอื่นใช้แค่รอบ */
const showFy = computed(() => current.value !== 'my-stats');

const submitBtn = computed(() => {
  const meta = LEAVE_GROUPS.find((g) => g.key === current.value);
  return meta ? meta.btn : '';
});

/** โหมดของฟอร์มยื่นคำขอ */
const formMode = computed(() => (current.value === 'vacation' ? 'vacation' : 'general'));

/* ---------- โหลดสิทธิ์เจ้าหน้าที่การลา ---------- */
onMounted(async () => {
  try {
    const la = await api.get('/leave-approvers-public');
    approversData.value = la.approvers;
    perPerson.value = la.perPerson || null;
    const uid = Auth.user.id;
    isLeaveStaff.value =
      (la.approvers['1'] || []).includes(uid) ||
      (la.approvers['2'] || []).includes(uid) ||
      (la.approvers['3'] || []).includes(uid);
  } catch {
    /* โหลดไม่ได้ = ไม่มีสิทธิ์พิจารณา */
  }
  pickInitialTab();
  await load();
});

// แท็บอาจยังเลือกไม่ได้ตอน mount (สิทธิ์โหลดช้า) → ตรวจซ้ำเมื่อสิทธิ์เปลี่ยน
watch(groups, () => pickInitialTab());

/* ---------- ตารางรายการคำขอลา ---------- */
const rows = ref([]);
const loading = ref(false);
const loadError = ref('');

async function load() {
  if (HIDE_FILTERS.includes(current.value)) return; // แท็บนี้โหลดเอง
  if (STATS_TABS.includes(current.value)) return;
  loading.value = true;
  loadError.value = '';
  try {
    const meta = LEAVE_GROUPS.find((g) => g.key === current.value);
    const p = new URLSearchParams();
    if (status.value) p.set('status', status.value);
    // รอบใช้ได้เมื่อระบุปีงบประมาณ (เลือก "ทุกปี" = ไม่กรองช่วงวันที่)
    if (round.value && fy.value) p.set('round', round.value);
    if (current.value === 'vacation') p.set('group', 'vacation');
    else if (current.value === 'general' || current.value === 'general-school') p.set('group', 'general');
    if (meta && meta.ugroup) p.set('ugroup', meta.ugroup);
    if (fy.value) p.set('year', fy.value);

    const data = await api.get('/leaves' + (p.toString() ? '?' + p.toString() : ''));
    let list = data.requests || [];

    if (myOnly.value && Auth.user) {
      list = list.filter((r) => r.user_id === Auth.user.id);
    } else if (!myOnly.value && !isAdmin.value && isLeaveStaff.value && perPerson.value && Auth.user) {
      // ผู้ตรวจสอบ/ผู้อนุมัติเห็นเฉพาะรายการที่ตนเกี่ยวข้อง + ของตัวเอง
      list = list.filter((r) => {
        if (r.user_id === Auth.user.id) return true;
        for (const lv of [1, 2, 3]) {
          if (Number((perPerson.value[String(lv)] || {})[String(r.user_id)]) === Auth.user.id) return true;
        }
        return false;
      });
    }
    rows.value = list;
  } catch (e) {
    rows.value = [];
    loadError.value = e.message;
  } finally {
    loading.value = false;
  }
}

watch([current, fy, round, status, myOnly], load);

/* ---------- สิทธิ์กดปุ่ม ---------- */
function myLevels(r) {
  const out = [];
  for (const lvl of [1, 2, 3]) {
    if (Auth.isAdmin()) { out.push(lvl); continue; }
    if (perPerson.value && perPerson.value[String(lvl)]) {
      if (Number((perPerson.value[String(lvl)] || {})[String(r.user_id)]) === Auth.user.id) out.push(lvl);
    } else if (approversData.value) {
      if ((approversData.value[lvl] || []).includes(Auth.user.id)) out.push(lvl);
    }
  }
  return out;
}

const isOwner = (r) => r.user_id === Auth.user?.id;
const level2Approved = (r) => (r.approvals || []).some((a) => a.level === 2);

function showReviewBtn(r) {
  return r.status === 'pending' && !r.reviewed && myLevels(r).includes(1);
}
function showLevel2Btn(r) {
  return r.status === 'pending' && r.reviewed && !level2Approved(r) && myLevels(r).includes(2);
}
function showLevel3Btn(r) {
  return r.status === 'pending' && (r.approvals || []).length >= 2 && myLevels(r).includes(3);
}
/** ปุ่มลบของเจ้าของ: ได้ถ้ายังไม่อนุมัติขั้นต้น */
function showOwnerDelete(r) {
  return isOwner(r) && r.status !== 'approved' && !level2Approved(r);
}
function showCancelRequest(r) {
  return (isOwner(r) || Auth.isAdmin()) && r.status === 'approved' && r.cancel_status !== 'cancel_requested';
}
function showCancelConfirm(r) {
  return r.cancel_status === 'cancel_requested' && (Auth.isAdmin() || myLevels(r).includes(1));
}

/* ---------- หน้าต่าง ---------- */
const detail = ref(null);
const review = ref(null);
const noteFor = ref(null);
const formOpen = ref(false);
const editTarget = ref(null);

function openDetail(r) { detail.value = r; }
function openReview(r) { review.value = r; }
function openForm() { editTarget.value = null; formOpen.value = true; }
function openEdit(r) { editTarget.value = r; formOpen.value = true; }

async function afterChange() {
  await load();
}

/* ---------- ตัดสิน ---------- */
async function decide(r, action, customLabel) {
  // ผู้อนุมัติขั้นต้น → เปิดหน้าความเห็นก่อน
  if (action === 'approve' && customLabel === 'อนุมัติขั้นต้น') {
    noteFor.value = r;
    return;
  }
  const label = customLabel || (action === 'approve' ? 'อนุมัติ' : 'ไม่อนุมัติ');
  const ok = await UI.confirm(`ต้องการ${label}คำขอลา ${r.leave_type} ของ ${UI.personName(r)} ใช่หรือไม่?`, {
    okText: label,
    danger: action !== 'approve',
  });
  if (!ok) return;
  try {
    const res = await api.put(`/leaves/${r.id}/${action}`, {});
    UI.toast(res.message);
    await load();
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

async function sendApproveNote(note) {
  const r = noteFor.value;
  noteFor.value = null;
  if (!r) return;
  try {
    const res = await api.put(`/leaves/${r.id}/approve`, { note });
    UI.toast(res.message);
    await load();
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

async function remove(r) {
  const ok = await UI.confirm('ต้องการลบรายการคำขอนี้ใช่หรือไม่?', { danger: true, okText: 'ลบ' });
  if (!ok) return;
  try {
    const res = await api.del('/leaves/' + r.id);
    UI.toast(res.message);
    await load();
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

/* ---------- ขอยกเลิกวันลา ---------- */
async function requestCancel(r) {
  const ok = await UI.confirm(
    `ต้องการขอยกเลิกวันลา ${r.leave_type} ${UI.date(r.date_from)} ถึง ${UI.date(r.date_to)} (${r.days || 1} วัน) ใช่หรือไม่?\nระบบจะส่งเรื่องไปยังผู้ตรวจสอบพิจารณา`,
    { okText: '↺ ขอยกเลิกวันลา' },
  );
  if (!ok) return;
  try {
    const res = await api.post(`/leaves/${r.id}/cancel-request`, {});
    UI.toast(res.message);
    await load();
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

async function confirmCancel(r) {
  const ok = await UI.confirm(
    `ต้องการยกเลิกวันลา ${r.leave_type} ของ ${UI.personName(r)}\n${UI.date(r.date_from)} ถึง ${UI.date(r.date_to)} (${r.days || 1} วัน) ใช่หรือไม่?\nเมื่อยืนยัน รายการวันลานี้จะถูกลบและสถิติการลาจะคำนวณใหม่ทันที`,
    { okText: '↺ ยกเลิกวันลา', danger: true },
  );
  if (!ok) return;
  try {
    const res = await api.put(`/leaves/${r.id}/cancel-confirm`, {});
    UI.toast(res.message);
    await load();
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

/* ---------- ป้ายสถานะ ---------- */
function statusPill(r) {
  if (r.status === 'pending' && !r.reviewed) return { text: '◷ รอตรวจสอบ', bg: '#fef3c7', color: '#92400e' };
  return null;
}
</script>

<template>
  <div class="page-head">
    <div>
      <div class="page-title"><span class="pi">☀</span>ขออนุญาตลา</div>
      <div class="page-desc">ยื่นคำขอลา รอผู้ดูแลระบบอนุมัติ</div>
    </div>
  </div>

  <!-- ---------- เมนูย่อย ---------- -->
  <div class="toolbar" style="justify-content: flex-start">
    <div class="seg" style="flex-wrap: wrap">
      <button
        v-for="g in groups"
        :key="g.key"
        class="seg-btn"
        :class="{ active: current === g.key }"
        :title="g.short"
        @click="setTab(g.key)"
      >
        {{ g.label }}
      </button>
    </div>
  </div>

  <!-- ---------- ปุ่มยื่นคำขอ + ตัวกรอง ---------- -->
  <div v-if="!hideSubmitRow" class="toolbar" style="justify-content: flex-start; margin-top: -4px">
    <button class="btn btn-primary" @click="openForm">{{ submitBtn }}</button>
  </div>

  <div
    v-if="!hideFilterRow"
    class="filter-row"
    style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center"
  >
    <button
      v-if="canSeeAll"
      id="lv-all-btn"
      class="btn"
      :class="{ active: !myOnly }"
      @click="myOnly = false"
    >
      ขออนุญาตลาทั้งหมด
    </button>
    <button id="lv-my-btn" class="btn" :class="{ active: myOnly }" @click="myOnly = true">
      ขออนุญาตลาของฉัน
    </button>

    <select v-if="showFy" id="lv-year" v-model="fy">
      <option v-for="y in fyOptions" :key="y" :value="String(y)">ปีงบประมาณ {{ y }}</option>
      <option value="">ทุกปีงบประมาณ</option>
    </select>

    <select id="lv-round" v-model="round" :style="{ display: fy ? '' : 'none' }">
      <option v-for="o in roundOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>

    <select id="lv-status" v-model="status">
      <option value="">ทุกสถานะ</option>
      <option value="pending">รออนุมัติ</option>
      <option value="approved">อนุมัติแล้ว</option>
      <option value="rejected">ไม่อนุมัติ</option>
      <option value="cancelled">ยกเลิก</option>
    </select>
  </div>

  <!-- ---------- เนื้อหา ---------- -->
  <div class="card">
    <!-- ---------- รายการคำขอลา ---------- -->
    <template v-if="!HIDE_FILTERS.includes(current) && !STATS_TABS.includes(current)">
      <div class="card-title">
        ▭ {{ (LEAVE_GROUPS.find((g) => g.key === current) || {}).label || 'รายการขอลา' }}
        ({{ rows.length }} รายการ)
      </div>

      <div v-if="loading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
      <div v-else-if="loadError" class="empty-state"><span class="em">⚠️</span>{{ loadError }}</div>
      <div v-else-if="rows.length === 0" class="empty-state"><span class="em">☀</span>ยังไม่มีรายการ</div>

      <div v-else class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>เลขที่คำขอ</th>
              <th v-if="canSeeAll">ผู้ยื่นคำขอ</th>
              <th>ประเภทการลา</th>
              <th>วันลา</th>
              <th class="num">จำนวนวัน</th>
              <th>เหตุผล</th>
              <th>สถานะ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id">
              <td>{{ r.leave_no || '-' }}</td>
              <td v-if="canSeeAll">
                <div>{{ UI.personName(r) }}</div>
                <div class="hint">{{ r.position || '' }}</div>
              </td>
              <td>
                <span
                  style="background: #eff6ff; color: #1d4ed8; padding: 3px 10px; border-radius: 999px; font-weight: 700; font-size: 12.5px"
                  >{{ r.leave_type }}</span
                >
              </td>
              <td>{{ UI.date(r.date_from) }} ถึง {{ UI.date(r.date_to) }}</td>
              <td class="num">{{ r.days }}</td>
              <td>
                <div style="max-width: 260px">{{ r.reason || '-' }}</div>
              </td>
              <td>
                <span
                  v-if="statusPill(r)"
                  :style="{
                    background: statusPill(r).bg,
                    color: statusPill(r).color,
                    padding: '3px 10px',
                    borderRadius: '999px',
                    fontWeight: 700,
                    fontSize: '12px',
                  }"
                  >◷ รอตรวจสอบ</span
                >
                <StatusBadge v-else :status="r.status" />
                <div
                  v-if="r.cancel_status === 'cancel_requested'"
                  class="cancel-request-blink"
                  style="margin-top: 4px; background: #ffedd5; color: #c2410c; padding: 2px 10px; border-radius: 999px; font-weight: 700; font-size: 11.5px"
                >
                  ↺ รอยกเลิกวันลา
                </div>
                <div style="cursor: pointer" title="ดูความคืบหน้าการอนุมัติ">
                  <ApprovalSteps :record="r" inline />
                </div>
              </td>
              <td>
                <div class="status-btns">
                  <button class="btn btn-xs btn-outline" @click="openDetail(r)">👁️</button>

                  <button
                    v-if="showReviewBtn(r)"
                    class="btn btn-xs btn-primary"
                    style="font-size: 12px; padding: 4px 10px; white-space: nowrap"
                    @click="openReview(r)"
                  >
                    ▭ ตรวจสอบ
                  </button>

                  <template v-if="showLevel2Btn(r)">
                    <button class="btn btn-xs btn-primary" @click="decide(r, 'approve', 'อนุมัติขั้นต้น')">
                      ● อนุมัติขั้นต้น
                    </button>
                    <button class="btn btn-xs btn-outline danger-btn" @click="decide(r, 'reject')">
                      ✕ ไม่อนุมัติ
                    </button>
                  </template>

                  <template v-if="showLevel3Btn(r)">
                    <button class="btn btn-xs btn-primary" @click="decide(r, 'approve', 'อนุมัติ')">
                      ● อนุมัติ
                    </button>
                    <button class="btn btn-xs btn-outline danger-btn" @click="decide(r, 'reject')">
                      ✕ ไม่อนุมัติ
                    </button>
                  </template>

                  <button
                    v-if="showOwnerDelete(r)"
                    class="btn btn-xs btn-outline danger-btn"
                    @click="remove(r)"
                  >
                    ✕
                  </button>

                  <button
                    v-if="showCancelRequest(r)"
                    class="btn btn-xs btn-warning"
                    style="font-size: 12px; padding: 4px 10px; white-space: nowrap"
                    title="ขอยกเลิกวันลา"
                    @click="requestCancel(r)"
                  >
                    ↺ ขอยกเลิกวันลา
                  </button>

                  <button
                    v-if="showCancelConfirm(r)"
                    class="btn btn-xs btn-primary"
                    style="font-size: 12px; padding: 4px 10px; white-space: nowrap"
                    title="ยืนยันยกเลิกวันลา (ลบรายการ)"
                    @click="confirmCancel(r)"
                  >
                    ↺ ยกเลิกวันลา
                  </button>

                  <button
                    v-if="Auth.isAdmin()"
                    class="btn btn-xs btn-outline"
                    title="แก้ไข"
                    @click="openEdit(r)"
                  >
                    ✎
                  </button>
                  <button
                    v-if="Auth.isAdmin()"
                    class="btn btn-xs btn-outline danger-btn"
                    title="ลบ"
                    @click="remove(r)"
                  >
                    ✕
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- หมายเหตุรายการ -->
        <div v-for="r in rows.filter((x) => x.note)" :key="'n' + r.id" class="hint" style="margin-top: 8px">
          หมายเหตุรายการ {{ r.leave_no }}: {{ r.note }}
        </div>
      </div>
    </template>

    <!-- ---------- วันลาพักผ่อนสะสม ---------- -->
    <LeaveBalance
      v-else-if="current === 'balance'"
      :can-edit="canSeeAll"
      @changed="afterChange"
    />

    <!-- ---------- ตั้งค่าเจ้าหน้าที่การลา ---------- -->
    <LeaveApprovers
      v-else-if="current === 'settings-approver'"
      scope="office"
      @saved="afterChange"
    />
    <LeaveApprovers
      v-else-if="current === 'settings-approver-school'"
      scope="school"
      @saved="afterChange"
    />

    <!-- ---------- สถิติ ---------- -->
    <LeaveStats
      v-else-if="current === 'leave-stats'"
      kind="leave-stats"
      :year="fy"
      :round="round"
      @changed="afterChange"
    />
    <LeaveStats
      v-else-if="current === 'vac-stats'"
      kind="vac-stats"
      :year="fy"
      :round="round"
      @changed="afterChange"
    />
    <LeaveStats
      v-else-if="current === 'my-stats'"
      kind="my-stats"
      :year="fy"
      :round="round"
      @changed="afterChange"
    />
  </div>

  <!-- ---------- หน้าต่างย่อย ---------- -->
  <LeaveForm
    v-if="formOpen"
    :mode="formMode"
    :record="editTarget"
    @close="formOpen = false"
    @saved="afterChange"
  />

  <LeaveDoc v-if="detail" :record="detail" @close="detail = null" />

  <LeaveReview v-if="review" :record="review" @close="review = null" @done="afterChange" />

  <LeaveApproveNote
    v-if="noteFor"
    :record="noteFor"
    @close="noteFor = null"
    @confirm="sendApproveNote"
  />
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
