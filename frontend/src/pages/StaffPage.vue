<script setup>
/**
 * StaffPage — เมนู 13: เจ้าหน้าที่ในระบบ
 *
 * ย้ายจาก src/views/StaffView.js (674 บรรทัด) เป็น Vue SFC
 *
 * 5 แท็บ
 *   pending    ผู้รออนุมัติ (การ์ด + รูป + ลายเซ็น)
 *   office     เจ้าหน้าที่ สพป.แพร่ เขต 2 (ตาราง + เรียงตามกลุ่มงาน)
 *   school     เจ้าหน้าที่สถานศึกษา (ตาราง + เรียงตามรหัสโรงเรียน)
 *   settings   จำนวนขั้นตอนการอนุมัติของแต่ละระบบ
 *   simdate    โหมดจำลองวันที่ (ทดสอบการเปลี่ยนปี พ.ศ.)
 *
 * แท็บถูกเก็บใน URL hash (?tab=) เพื่อคงแท็บเดิมหลังรีเฟรช
 */
import { ref, computed, watch, onMounted } from 'vue';
import api from '../api/client.js';
import { UI } from '../ui/ui.js';
import { CONSTANTS } from '../constants/index.js';
import StatusBadge from '../components/ui/StatusBadge.vue';
import ThaiDateField from '../components/ui/ThaiDateField.vue';
import StaffEditModal from '../components/ui/StaffEditModal.vue';
import StaffDetailModal from '../components/ui/StaffDetailModal.vue';
import StaffRoleModal from '../components/ui/StaffRoleModal.vue';
import StaffResetPassModal from '../components/ui/StaffResetPassModal.vue';

const TABS = [
  { key: 'pending', label: '◷ รออนุมัติ' },
  { key: 'office', label: '📋 เจ้าหน้าที่ สพป.แพร่ เขต 2' },
  { key: 'school', label: '🏫 เจ้าหน้าที่สถานศึกษา' },
  { key: 'settings', label: '⊛ ตั้งค่าการอนุมัติ' },
  { key: 'simdate', label: '⏱ โหมดจำลองวันที่' },
];

/** คงแท็บเดิมไว้เมื่อกดรีเฟรช — อ่านค่า ?tab= จาก URL hash */
const tab = ref('pending');
try {
  const t = new URLSearchParams(location.hash.split('?')[1] || '').get('tab');
  if (TABS.some((x) => x.key === t)) tab.value = t;
} catch {
  /* URL ผิดรูปแบบ → ใช้ค่าเริ่มต้น */
}

function setTab(k) {
  tab.value = k;
  try {
    const base = location.hash.split('?')[0];
    history.replaceState(null, '', base + '?tab=' + k);
  } catch {
    /* history ใช้ไม่ได้ → ข้าม */
  }
}

/* ---------- ตัวกรองของแท็บรายชื่อเจ้าหน้าที่ ---------- */
const q = ref('');
const statusFilter = ref('');

let searchTimer = null;
function onSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadStaff, 350);
}

/* ---------- แท็บ: รออนุมัติ ---------- */
const pending = ref([]);
const pendingLoading = ref(false);
const pendingError = ref('');

async function loadPending() {
  pendingLoading.value = true;
  pendingError.value = '';
  try {
    const d = await api.get('/staff?status=pending');
    pending.value = d.staff || [];
  } catch (e) {
    pending.value = [];
    pendingError.value = e.message;
  } finally {
    pendingLoading.value = false;
  }
}

/* ---------- แท็บ: รายชื่อเจ้าหน้าที่ ---------- */
const staff = ref([]);
const staffLoading = ref(false);
const staffError = ref('');

/** กลุ่มงานของแท็บที่เลือก */
const staffGroup = computed(() => (tab.value === 'school' ? 'school' : 'office'));

async function loadStaff() {
  staffLoading.value = true;
  staffError.value = '';
  const p = [];
  if (q.value.trim()) p.push('q=' + UI.encodePath(q.value.trim()));
  if (statusFilter.value) p.push('status=' + UI.encodePath(statusFilter.value));
  p.push('user_group=' + UI.encodePath(staffGroup.value));
  try {
    const d = await api.get('/staff?' + p.join('&'));
    staff.value = d.staff || [];
  } catch (e) {
    staff.value = [];
    staffError.value = e.message;
  } finally {
    staffLoading.value = false;
  }
}

/**
 * เรียงลำดับตามที่ระบบเดิมกำหนด — สองกลุ่มใช้ลำดับคนละแบบ
 *
 * ฝั่ง สพป.: ผู้บริหารการศึกษาอันดับแรก, หน่วยตรวจสอบภายในท้ายสุด,
 *   กลุ่มอื่นตามลำดับใน WORKPLACES — ในกลุ่มผู้บริหารฯ ผู้อำนวยการมาก่อนรองผู้อำนวยการ
 * ฝั่งสถานศึกษา: รหัสสถานศึกษา (น้อย→มาก) แล้วตามตำแหน่ง ผอ.→รอง ผอ.→ครู→เจ้าหน้าที่ธุรการ
 */
function sortStaff(rows, group) {
  const out = rows.slice();
  if (group === 'office') {
    const mids = CONSTANTS.WORKPLACES.filter(
      (w) => w !== 'ผู้บริหารการศึกษา' && w !== 'หน่วยตรวจสอบภายใน',
    );
    const wpRank = (w) =>
      w === 'ผู้บริหารการศึกษา' ? 0 : w === 'หน่วยตรวจสอบภายใน' ? 999 : 1 + mids.indexOf(w);
    const staffNo = (u) => {
      const n = parseInt(u.staff_no, 10);
      return isNaN(n) ? 9999 : n;
    };
    out.sort((a, b) => {
      const wa = wpRank(a.workplace || '');
      const wb = wpRank(b.workplace || '');
      if (wa !== wb) return wa - wb;
      if ((a.workplace || '') === 'ผู้บริหารการศึกษา') {
        const pa = (a.position || '').startsWith('ผู้อำนวยการ') && !(a.position || '').startsWith('รองผู้อำนวยการ') ? 0 : 1;
        const pb = (b.position || '').startsWith('ผู้อำนวยการ') && !(b.position || '').startsWith('รองผู้อำนวยการ') ? 0 : 1;
        if (pa !== pb) return pa - pb;
      }
      return staffNo(a) - staffNo(b) || a.id - b.id;
    });
  } else {
    const schoolCode = (u) => {
      const m = (u.workplace || '').match(/^(\d{8})/);
      return m ? m[1] : '99999999';
    };
    const posRank = (p) => {
      const s = p || '';
      if (s.startsWith('ผู้อำนวยการสถานศึกษา')) return 0;
      if (s.startsWith('รองผู้อำนวยการ')) return 1;
      if (s.startsWith('ครู')) return 2;
      if (s.startsWith('เจ้าหน้าที่ธุรการ')) return 3;
      return 4;
    };
    out.sort(
      (a, b) =>
        schoolCode(a).localeCompare(schoolCode(b)) ||
        posRank(a.position) - posRank(b.position) ||
        a.id - b.id,
    );
  }
  return out.map((u, i) => ({ ...u, _seq: i + 1 }));
}

const staffSorted = computed(() => sortStaff(staff.value, staffGroup.value));

/* ---------- แท็บ: ตั้งค่าการอนุมัติ ---------- */
const APPROVAL_SYSTEMS = [
  { key: 'approval_vehicle', label: '▣ การจองยานพาหนะ' },
  { key: 'approval_room', label: '⬡ การจองห้องประชุม' },
  { key: 'approval_travel', label: '✈ การขออนุญาตไปราชการ' },
  { key: 'approval_leave', label: '❋ การขออนุญาตลา' },
];

const approvalSettings = ref({});
const approvalLoading = ref(false);
const approvalError = ref('');
const approvalSaving = ref(false);

async function loadApprovalSettings() {
  approvalLoading.value = true;
  approvalError.value = '';
  try {
    const d = await api.get('/settings/approvals');
    approvalSettings.value = d.settings || {};
  } catch (e) {
    approvalError.value = e.message;
  } finally {
    approvalLoading.value = false;
  }
}

async function saveApprovalSettings() {
  approvalSaving.value = true;
  try {
    const body = {};
    for (const s of APPROVAL_SYSTEMS) body[s.key] = parseInt(approvalSettings.value[s.key], 10) || 1;
    const res = await api.put('/settings/approvals', body);
    UI.toast(res.message);
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    approvalSaving.value = false;
  }
}

/* ---------- แท็บ: โหมดจำลองวันที่ ---------- */
const simDate = ref(null);
const simLoading = ref(false);
const simSaving = ref(false);
const simError = ref('');

async function loadSimDate() {
  simLoading.value = true;
  simError.value = '';
  try {
    simDate.value = await api.get('/sim-date');
  } catch (e) {
    simDate.value = null;
    simError.value = e.message;
  } finally {
    simLoading.value = false;
  }
}

/** วันที่ +n วันในรูปแบบ YYYY-MM-DD (ใช้เวลาท้องถิ่น ไม่ใช่ UTC) */
function localISO(d) {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

const quickDays = computed(() =>
  [1, 2, 3].map((n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    const iso = localISO(d);
    return { iso, label: '+' + n + ' วัน (' + UI.thaiDate(iso) + ')' };
  }),
);

const simActive = computed(() => !!simDate.value?.sim_today);

/** สีแถบแจ้งสถานะโหมดจำลอง — ต้องเป็น style ที่คำนวณล่วงหน้า
 *  เขียน v-bind() ใน style ของ template ไม่ได้ เพราะ Vue แปลงเป็นชื่อ attribute แล้วพัง */
const simBannerStyle = computed(() => ({
  padding: '10px 14px',
  background: simActive.value ? '#fff7e0' : '#eef6ee',
  border: '1px solid ' + (simActive.value ? '#f0d98c' : '#cfe6cf'),
  borderRadius: '10px',
  marginBottom: '14px',
}));

/** เมื่อบันทึกแล้วต้องแจ้ง header ให้รีเฟรชป้าย "วันนี้" ด้วย */
async function saveSimDate(dateStr) {
  simSaving.value = true;
  try {
    const res = await api.put('/sim-date', { date: dateStr });
    UI.toast(res.message);
    if (window.__SIM_DATE) await window.__SIM_DATE.refresh();
    await loadSimDate();
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    simSaving.value = false;
  }
}

const simInput = ref('');

function saveSimDateFromInput() {
  if (!simInput.value) return UI.toast('กรุณาเลือกวันที่จำลอง', 'error');
  saveSimDate(simInput.value);
}

/* ---------- โหลดตามแท็บ ---------- */
watch(tab, (k) => {
  if (k === 'pending') loadPending();
  else if (k === 'settings') loadApprovalSettings();
  else if (k === 'simdate') loadSimDate();
  else loadStaff();
});
watch(staffGroup, loadStaff);

onMounted(() => {
  if (tab.value === 'pending') loadPending();
  else if (tab.value === 'settings') loadApprovalSettings();
  else if (tab.value === 'simdate') loadSimDate();
  else loadStaff();
});

/* ---------- หน้าต่างย่อย ---------- */
const detail = ref(null);
const editTarget = ref(null);
const roleTarget = ref(null);
const resetTarget = ref(null);

const STATUS_LABELS = { active: 'เปิดใช้งาน/อนุมัติ', inactive: 'ระงับการใช้งาน', rejected: 'ปฏิเสธ' };

async function setStatus(u, status) {
  const ok = await UI.confirm(`ต้องการ${STATUS_LABELS[status]}บัญชี "${UI.personName(u)}" ใช่หรือไม่?`, {
    okText: STATUS_LABELS[status],
    danger: status !== 'active',
  });
  if (!ok) return;
  try {
    const res = await api.put(`/staff/${u.id}/status`, { status });
    UI.toast(res.message);
    await reload();
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

async function toggleApprove(u) {
  const next = !u.can_approve;
  const ok = await UI.confirm(
    next
      ? `ให้สิทธิ์ "${UI.personName(u)}" อนุมัติคำขอตามบทบาท (${CONSTANTS.roleLabel(u.role)}) ใช่หรือไม่?`
      : `ถอนสิทธิ์การอนุมัติของ "${UI.personName(u)}" ใช่หรือไม่?`,
    { okText: next ? 'ให้สิทธิ์' : 'ถอนสิทธิ์', danger: !next },
  );
  if (!ok) return;
  try {
    const res = await api.put(`/staff/${u.id}/approve`, { can_approve: next });
    UI.toast(res.message);
    await reload();
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

async function removeStaff(u) {
  const ok = await UI.confirm(
    `ต้องการลบบัญชี "${UI.personName(u)}" ออกจากระบบ ใช่หรือไม่? (ข้อมูลส่วนตัวจะถูกลบถาวร)`,
    { danger: true, okText: 'ลบ' },
  );
  if (!ok) return;
  try {
    const res = await api.del('/staff/' + u.id);
    UI.toast(res.message);
    await reload();
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

/** โหลดใหม่ตามแท็บที่กำลังอยู่ */
function reload() {
  if (tab.value === 'pending') return loadPending();
  return loadStaff();
}

const pendingGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: '14px',
};
</script>

<template>
  <div class="page-head">
    <div>
      <div class="page-title"><span class="pi">👥</span>เจ้าหน้าที่ในระบบ</div>
      <div class="page-desc">
        จัดการสมาชิก อนุมัติการสมัคร แก้ไขข้อมูล กำหนดสิทธิ์ 5 ระดับ และสิทธิ์การอนุมัติ
      </div>
    </div>
  </div>

  <!-- ---------- แท็บ ---------- -->
  <div class="tabs">
    <button
      v-for="t in TABS"
      :key="t.key"
      :id="'s-tab-' + t.key"
      class="tab"
      :class="{ active: tab === t.key }"
      @click="setTab(t.key)"
    >
      {{ t.label }}
    </button>
  </div>

  <div id="s-content">
    <!-- ============ แท็บ: ผู้รออนุมัติ ============ -->
    <div v-if="tab === 'pending'" class="card">
      <div class="card-title">◷ ผู้รออนุมัติ ({{ pending.length }} คน)</div>

      <div v-if="pendingLoading" class="center-load"><span class="spin"></span> กำลังโหลดผู้รออนุมัติ...</div>
      <div v-else-if="pendingError" class="empty-state"><span class="em">⚠️</span>{{ pendingError }}</div>
      <div v-else-if="pending.length === 0" class="empty-state">
        <span class="em">●</span>ไม่มีผู้รออนุมัติในขณะนี้
      </div>

      <div v-else :style="pendingGridStyle">
        <div v-for="u in pending" :key="u.id" class="card" style="margin-bottom: 0">
          <div style="display: flex; gap: 12px; align-items: flex-start; margin-bottom: 10px">
            <img
              v-if="u.photo"
              class="profile-photo"
              :src="'/uploads/' + UI.encodePath(u.photo)"
              style="width: 64px; height: 64px"
              alt=""
            />
            <div
              v-else
              class="profile-photo"
              style="width: 64px; height: 64px; display: grid; place-items: center; font-size: 24px; background: var(--primary-light); color: var(--primary-deep)"
            >
              {{ (u.first_name || u.full_name || '?').charAt(0) }}
            </div>
            <div>
              <div style="font-weight: 700">{{ UI.personName(u) }}</div>
              <div class="hint">
                @{{ u.username }}{{ u.nickname ? ' • ชื่อเล่น ' + u.nickname : '' }}
              </div>
              <div class="hint">{{ u.position || '' }}{{ u.workplace ? ' • ' + u.workplace : '' }}</div>
            </div>
          </div>

          <div style="font-size: 13px; margin-bottom: 8px">
            <div class="hint">เลขบัตรประชาชน: {{ u.citizen_id || '-' }}</div>
            <div class="hint">โทร: {{ u.phone || '-' }}{{ u.email ? ' • ' + u.email : '' }}</div>
            <div class="hint">สมัครเมื่อ: {{ UI.date(u.created_at) }}</div>
          </div>

          <div style="display: flex; gap: 6px; align-items: center; margin-bottom: 10px">
            <img
              v-if="u.signature"
              class="signature-img"
              :src="'/uploads/' + UI.encodePath(u.signature)"
              title="ลายเซ็น"
              alt=""
            />
            <span v-else class="hint">ไม่มีลายเซ็น</span>
          </div>

          <div class="status-btns" style="display: flex; gap: 8px; flex-wrap: wrap">
            <button class="btn btn-sm btn-primary" @click="setStatus(u, 'active')">● อนุมัติ</button>
            <button class="btn btn-sm btn-outline" @click="editTarget = u">✎ แก้ไข</button>
            <button class="btn btn-sm btn-danger" @click="setStatus(u, 'rejected')">✕ ปฏิเสธ</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============ แท็บ: รายชื่อเจ้าหน้าที่ ============ -->
    <template v-else-if="tab === 'office' || tab === 'school'">
      <div class="filter-row" style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center">
        <input
          id="st-q"
          v-model="q"
          type="search"
          placeholder="☺ ค้นหาชื่อ/username/ตำแหน่ง/เลขบัตร..."
          style="min-width: 240px"
          @input="onSearch"
        />
        <select id="st-status" v-model="statusFilter" @change="loadStaff">
          <option value="">ทุกสถานะ</option>
          <option value="active">ใช้งาน</option>
          <option value="pending">รออนุมัติ</option>
          <option value="inactive">ระงับ</option>
          <option value="rejected">ปฏิเสธ</option>
        </select>
      </div>

      <div class="card">
        <div class="card-title">
          {{ staffGroup === 'office' ? '📋 เจ้าหน้าที่ สพป.แพร่ เขต 2' : '🏫 เจ้าหน้าที่สถานศึกษา' }}
          ({{ staff.length }} คน)
        </div>

        <div v-if="staffLoading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
        <div v-else-if="staffError" class="empty-state"><span class="em">⚠️</span>{{ staffError }}</div>
        <div v-else-if="staff.length === 0" class="empty-state"><span class="em">👥</span>ไม่พบเจ้าหน้าที่</div>

        <div v-else class="table-wrap">
          <table class="tbl staff-grid">
            <thead>
              <tr>
                <th>ที่</th>
                <th>ชื่อ-นามสกุล</th>
                <th>ตำแหน่ง</th>
                <th>กลุ่มงาน</th>
                <th>สิทธิ์</th>
                <th>สิทธิ์อนุมัติ</th>
                <th>สถานะ</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in staffSorted" :key="u.id">
                <td><span style="font-weight: 400; color: var(--muted)">{{ u._seq }}</span></td>
                <td>
                  <div style="display: flex; align-items: center; gap: 8px">
                    <img
                      v-if="u.photo"
                      :src="'/uploads/' + UI.encodePath(u.photo)"
                      style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover"
                      alt=""
                    />
                    <div
                      v-else
                      style="width: 32px; height: 32px; border-radius: 50%; background: var(--primary-light); color: var(--primary-deep); display: grid; place-items: center; font-weight: 700"
                    >
                      {{ (u.first_name || u.full_name || '?').charAt(0) }}
                    </div>
                    <div>{{ UI.personName(u) }}</div>
                  </div>
                </td>
                <td>{{ u.position || '-' }}</td>
                <td>{{ u.workplace || '-' }}</td>
                <td>
                  <span class="badge" :class="u.role === 'admin' ? 'badge-admin' : 'badge-member'">
                    {{ CONSTANTS.roleLabel(u.role) }}
                  </span>
                </td>
                <td>
                  <span v-if="u.can_approve" class="badge badge-active">● อนุมัติได้</span>
                  <span v-else class="hint">—</span>
                </td>
                <td><StatusBadge :status="u.status" /></td>
                <td>
                  <div class="status-btns">
                    <button class="btn btn-xs btn-outline" @click="detail = u">👁️</button>
                    <button class="btn btn-xs btn-outline" @click="editTarget = u">✎</button>
                    <button class="btn btn-xs btn-outline" @click="roleTarget = u">⊛ สิทธิ์</button>
                    <button class="btn btn-xs btn-outline" @click="toggleApprove(u)">
                      {{ u.can_approve ? '🚫 ถอนสิทธิ์อนุมัติ' : '● ให้สิทธิ์อนุมัติ' }}
                    </button>
                    <button class="btn btn-xs btn-outline" @click="resetTarget = u">⊙</button>
                    <button
                      v-if="u.status === 'active'"
                      class="btn btn-xs btn-outline danger-btn"
                      @click="setStatus(u, 'inactive')"
                    >
                      ⏸ ระงับ
                    </button>
                    <button
                      v-else-if="u.status !== 'pending'"
                      class="btn btn-xs btn-outline"
                      @click="setStatus(u, 'active')"
                    >
                      ▶ เปิดใช้
                    </button>
                    <button class="btn btn-xs btn-outline danger-btn" @click="removeStaff(u)">✕</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- ============ แท็บ: ตั้งค่าการอนุมัติ ============ -->
    <div v-else-if="tab === 'settings'" class="card">
      <div class="card-title">⊛ จำนวนขั้นตอนการอนุมัติของแต่ละระบบ</div>
      <p class="hint" style="margin-bottom: 14px">
        กำหนดว่าคำขอแต่ละประเภทต้องผ่านการอนุมัติกี่ขั้น (1-3 ขั้น) ก่อนจะถือว่าอนุมัติอย่างเป็นทางการ —
        ขั้นที่ 1 (ขั้นต้น): ผู้อำนวยการกลุ่ม/หน่วย • ขั้นที่ 2 (ขั้นกลาง): รองผู้อำนวยการ •
        ขั้นที่ 3 (ขั้นสูง): ผู้อำนวยการ สพป.แพร่ เขต 2
      </p>

      <div v-if="approvalLoading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
      <div v-else-if="approvalError" class="empty-state"><span class="em">⚠️</span>{{ approvalError }}</div>

      <template v-else>
        <div class="form-grid">
          <div v-for="s in APPROVAL_SYSTEMS" :key="s.key" class="form-group">
            <label>{{ s.label }}</label>
            <select :id="'as-' + s.key" v-model="approvalSettings[s.key]">
              <option v-for="n in [1, 2, 3]" :key="n" :value="n">{{ n }} ขั้น</option>
            </select>
          </div>
        </div>
        <div class="form-actions" style="margin-top: 14px">
          <button class="btn btn-primary" :disabled="approvalSaving" @click="saveApprovalSettings">
            {{ approvalSaving ? 'กำลังบันทึก…' : '▽ บันทึกการตั้งค่า' }}
          </button>
        </div>
      </template>
    </div>

    <!-- ============ แท็บ: โหมดจำลองวันที่ ============ -->
    <div v-else-if="tab === 'simdate'" class="card">
      <div class="card-title">⏱ โหมดจำลองวันที่ (ทดสอบการเปลี่ยนปี พ.ศ.)</div>

      <div v-if="simLoading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
      <div v-else-if="simError" class="empty-state"><span class="em">⚠️</span>{{ simError }}</div>

      <template v-else-if="simDate">
        <!-- สีกรอบขึ้นกับสถานะ โหมดจำลองเปิดอยู่หรือไม่ -->
        <div :style="simBannerStyle">
          <template v-if="simActive">
            <b>🟠 เปิดโหมดจำลองอยู่ — ระบบถือว่า "วันนี้" คือ {{ UI.thaiDate(simDate.sim_today) }}</b>
            <div class="hint" style="margin-top: 6px">
              วันจริงของเครื่อง: {{ UI.thaiDate(simDate.real_today) }} • ระบบทั้งหมด (เลขที่หนังสือ ปีงบประมาณ การลา
              ลงเวลา) ใช้วันที่จำลองนี้เป็น "วันนี้"
            </div>
          </template>
          <template v-else>
            <b>🟢 ปิดโหมดจำลอง — ใช้เวลาจริงของเครื่อง ({{ UI.thaiDate(simDate.real_today) }})</b>
            <div class="hint" style="margin-top: 6px">เหมาะกับการใช้งานจริงทั่วไป</div>
          </template>
        </div>

        <div class="form-grid">
          <div class="form-group">
            <label>ตั้งวันที่จำลอง (วันที่ ค.ศ. เช่น 2027-01-01)</label>
            <ThaiDateField id="sim-date-input" v-model="simInput" />
          </div>
          <div class="form-group">
            <label>ตัวเลือกด่วน</label>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0">
              <button
                v-for="d in quickDays"
                :key="d.iso"
                class="btn btn-outline btn-sm"
                :disabled="simSaving"
                @click="saveSimDate(d.iso)"
              >
                {{ d.label }}
              </button>
            </div>
          </div>
        </div>

        <div class="form-actions" style="margin-top: 10px">
          <button class="btn btn-primary" :disabled="simSaving" @click="saveSimDateFromInput">
            {{ simSaving ? 'กำลังบันทึก…' : '▽ บันทึกและเริ่มจำลอง' }}
          </button>
          <button
            v-if="simActive"
            class="btn btn-outline"
            style="margin-left: 8px"
            :disabled="simSaving"
            @click="saveSimDate(null)"
          >
            ⏹ ปิดโหมดจำลอง — กลับสู่เวลาจริง
          </button>
        </div>
      </template>
    </div>
  </div>

  <!-- ---------- หน้าต่างย่อย ---------- -->
  <StaffDetailModal v-if="detail" :staff="detail" @close="detail = null" />

  <StaffEditModal
    v-if="editTarget"
    :staff="editTarget"
    @close="editTarget = null"
    @saved="reload()"
  />

  <StaffRoleModal v-if="roleTarget" :staff="roleTarget" @close="roleTarget = null" @saved="reload()" />

  <StaffResetPassModal
    v-if="resetTarget"
    :staff="resetTarget"
    @close="resetTarget = null"
    @saved="reload()"
  />
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
