<script setup>
/**
 * RoomsPage — เมนู 6: จองห้องประชุม
 *
 * Phase 5: เขียนใหม่เป็น Vue component
 * (เดิมเป็น src/views/RoomsView.js แบบ UI.h() — 539 บรรทัด)
 *
 * ฟีเจอร์เท่าเดิมทุกอย่าง:
 *   - 2 แท็บ: การจองห้องประชุม / รายการห้องประชุม
 *   - มุมมองตาราง + ปฏิทินรายเดือน (สลับได้) + ปี พ.ศ. + ดาวน์โหลด Excel
 *   - อนุมัติ 2 ขั้น: ขั้นต้นอนุมัติตรง · ขั้นสุดท้ายต้องยืนยันอีกครั้ง
 *   - ตรวจช่วงเวลาชนกันก่อนส่งคำขอจอง (ปิดปุ่มส่งเมื่อชน)
 *   - admin: เพิ่ม/แก้/ลบห้อง + กำหนดผู้อนุมัติ
 */
import { ref, computed, onMounted, watch } from 'vue';
import api from '../api/client.js';
import { UI } from '../ui/ui.js';
import { Auth } from '../stores/auth.js';
import { ExportFilterDialog } from '../ui/ExportFilter.js';
import AppModal from '../components/ui/AppModal.vue';
import StatusBadge from '../components/ui/StatusBadge.vue';
import ApprovalSteps from '../components/ui/ApprovalSteps.vue';
import BookingCalendar from '../components/ui/BookingCalendar.vue';

/* ---------- สิทธิ์อนุมัติ ---------- */
const LEVEL_NAMES = { 1: 'อนุมัติขั้นต้น', 2: 'อนุมัติขั้นสุดท้าย' };
const myLevels = ref([]);

const canApproveLevel = (level) => myLevels.value.includes(level);
const canDecideRoom = computed(() => Auth.isAdmin() || myLevels.value.length > 0);

/* ---------- ข้อมูลหลัก ---------- */
const tab = ref('bookings'); // 'bookings' | 'list'
const rooms = ref([]);
const roomsLoading = ref(true);

async function loadRooms() {
  try {
    const data = await api.get('/rooms');
    rooms.value = data.rooms || [];
  } catch (e) {
    /* ignore */
  } finally {
    roomsLoading.value = false;
  }
}

onMounted(async () => {
  myLevels.value = Auth.isAdmin() ? [1, 2, 3] : [];
  try {
    const me = await api.get('/room/approvers/me');
    myLevels.value = (me.levels || []).map(Number);
  } catch (e) {
    /* ignore */
  }
  await loadRooms();
  // ต้องโหลดรายการจองตอนเปิดหน้า
  // watch ข้างล่างดูแลตอน "เปลี่ยน" ค่าเท่านั้น จึงไม่ยิงตอน mount (tab เริ่มต้นเป็น 'bookings' อยู่แล้ว)
  // เคยลืมบรรทัดนี้ → หน้าค้างที่ "กำลังโหลดข้อมูล..." ตลอด ไม่มีทางหายเอง
  if (tab.value === 'bookings') await loadBookings();
});

/* ---------- แท็บ: การจอง ---------- */
const curYear = new Date().getFullYear() + 543;
const yearFilter = ref(String(curYear));
const calView = ref(false);
const calMonth = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

const bookingsLoading = ref(true);
const bookingsError = ref('');
const bookings = ref([]);

async function loadBookings() {
  bookingsLoading.value = true;
  bookingsError.value = '';
  try {
    const url = yearFilter.value ? '/room-bookings?year=' + yearFilter.value : '/room-bookings';
    const data = await api.get(url);
    bookings.value = data.bookings || [];
  } catch (e) {
    bookingsError.value = e.message;
    bookings.value = [];
  } finally {
    bookingsLoading.value = false;
  }
}

watch([tab, yearFilter], async (v) => {
  if (v[0] === 'bookings') await loadBookings();
});

function shiftMonth(delta) {
  const m = calMonth.value;
  calMonth.value = delta === 0 ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(m.getFullYear(), m.getMonth() + delta, 1);
}

/* ---------- รายละเอียดการจอง ---------- */
const detailOpen = ref(false);
const detail = ref(null);
const progressFor = ref(null); // รายการที่กำลังดูความคืบหน้า

function openDetail(r) {
  detail.value = r;
  detailOpen.value = true;
}

/* ---------- ฟอร์มจอง ---------- */
const bookingOpen = ref(false);
const bookingSaving = ref(false);
const bk = ref({ room_id: '', date: '', start_time: '', end_time: '', topic: '', attendees: 10 });
const conflict = ref([]);
const conflictBusy = ref(false);

const availableRooms = computed(() => rooms.value.filter((r) => r.status === 'available'));

function openBookingForm() {
  bk.value = { room_id: '', date: UI.today(), start_time: '', end_time: '', topic: '', attendees: 10 };
  conflict.value = [];
  bookingOpen.value = true;
}

/** ตรวจว่าช่วงเวลาที่เลือกถูกจองไว้แล้วหรือยัง */
async function checkConflict() {
  const { room_id, date, start_time, end_time } = bk.value;
  if (!room_id || !date || !start_time || !end_time) {
    conflict.value = [];
    return;
  }
  conflictBusy.value = true;
  try {
    const data = await api.get(
      '/room-bookings/conflicts?room_id=' + encodeURIComponent(room_id) +
        '&date=' + encodeURIComponent(date) +
        '&start_time=' + encodeURIComponent(start_time) +
        '&end_time=' + encodeURIComponent(end_time),
    );
    conflict.value = data.conflicts || [];
  } catch (e) {
    /* ignore */
  } finally {
    conflictBusy.value = false;
  }
}

watch(() => [bk.value.room_id, bk.value.date, bk.value.start_time, bk.value.end_time], checkConflict);

async function submitBooking() {
  if (conflict.value.length) return UI.toast('ช่วงเวลานี้ถูกจองไว้แล้ว ไม่สามารถจองซ้ำได้', 'error');
  if (!bk.value.room_id || !bk.value.date) return UI.toast('กรุณาเลือกห้องประชุมและวันที่', 'error');
  if (!bk.value.topic.trim()) return UI.toast('กรุณากรอกหัวข้อการประชุม', 'error');
  bookingSaving.value = true;
  try {
    const res = await api.post('/room-bookings', {
      room_id: bk.value.room_id,
      date: bk.value.date,
      start_time: bk.value.start_time,
      end_time: bk.value.end_time,
      topic: bk.value.topic.trim(),
      attendees: parseInt(bk.value.attendees, 10) || 0,
    });
    UI.toast(res.message);
    bookingOpen.value = false;
    await loadBookings();
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    bookingSaving.value = false;
  }
}

/* ---------- อนุมัติ ---------- */
const finalOpen = ref(false);
const finalTarget = ref(null);

/** ปุ่มอนุมัติ/ไม่อนุมัติตามสิทธิ์ — คืนรายการปุ่มที่ควรแสดง */
function buttonsFor(r) {
  const btns = [];
  const isPending = r.status === 'pending';
  const next = UI.approvalDone(r) + 1;
  const required = r.required_levels || 1;
  if (isPending && next <= required && canApproveLevel(next)) {
    if (next >= required) btns.push({ label: '● อนุมัติ', kind: 'final' });
    else btns.push({ label: '● อนุมัติขั้นต้น', kind: 'approve' });
  }
  if (isPending && canDecideRoom.value) btns.push({ label: '✕ ไม่อนุมัติ', kind: 'reject', danger: true });
  return btns;
}

function onRoomButton(r, kind) {
  if (kind === 'final') {
    finalTarget.value = r;
    finalOpen.value = true;
  } else {
    decide(r, kind);
  }
}

/** ขั้นสุดท้าย: เปิดรายละเอียดแล้วกดยืนยันอีกครั้ง */
async function confirmFinalApprove() {
  finalOpen.value = false;
  await decideDirect(finalTarget.value, 'approve');
}

async function decide(r, action) {
  const label = action === 'approve' ? 'อนุมัติ' : 'ไม่อนุมัติ';
  const yes = await UI.confirm(`ต้องการ${label}การจองห้อง "${r.room_name}" วันที่ ${UI.date(r.date)} ใช่หรือไม่?`, {
    okText: label,
    danger: action !== 'approve',
  });
  if (!yes) return;
  await decideDirect(r, action);
}

async function decideDirect(r, action) {
  if (!r) return;
  try {
    const res = await api.put(`/room-bookings/${r.id}/${action}`, {});
    UI.toast(res.message);
    await loadBookings();
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

async function removeBooking(r) {
  const yes = await UI.confirm('ต้องการลบรายการจองนี้ใช่หรือไม่?', { danger: true, okText: 'ลบ' });
  if (!yes) return;
  try {
    const res = await api.del('/room-bookings/' + r.id);
    UI.toast(res.message);
    await loadBookings();
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

/* ---------- ฟอร์มห้องประชุม (admin) ---------- */
const roomFormOpen = ref(false);
const roomSaving = ref(false);
const editingRoom = ref(null);
const rf = ref({ id: null, name: '', capacity: 10, location: '', status: 'available', equipment: '', notes: '' });

function openRoomCreate() {
  editingRoom.value = null;
  rf.value = { id: null, name: '', capacity: 10, location: '', status: 'available', equipment: '', notes: '' };
  roomFormOpen.value = true;
}

function openRoomEdit(r) {
  editingRoom.value = r;
  rf.value = {
    id: r.id,
    name: r.name || '',
    capacity: r.capacity || 10,
    location: r.location || '',
    status: r.status || 'available',
    equipment: r.equipment || '',
    notes: r.notes || '',
  };
  roomFormOpen.value = true;
}

async function saveRoom() {
  if (!rf.value.name.trim()) return UI.toast('กรุณากรอกชื่อห้องประชุม', 'error');
  roomSaving.value = true;
  try {
    const data = {
      name: rf.value.name.trim(),
      capacity: parseInt(rf.value.capacity, 10) || 0,
      location: rf.value.location.trim(),
      equipment: rf.value.equipment.trim(),
      status: rf.value.status,
      notes: rf.value.notes.trim(),
    };
    const res = rf.value.id ? await api.put('/rooms/' + rf.value.id, data) : await api.post('/rooms', data);
    UI.toast(res.message);
    roomFormOpen.value = false;
    await loadRooms();
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    roomSaving.value = false;
  }
}

async function removeRoom(r) {
  const yes = await UI.confirm(`ต้องการลบห้องประชุม "${r.name}" ใช่หรือไม่?`, { danger: true, okText: 'ลบ' });
  if (!yes) return;
  try {
    const res = await api.del('/rooms/' + r.id);
    UI.toast(res.message);
    await loadRooms();
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

/* ---------- ผู้อนุมัติ (admin) ---------- */
const approversOpen = ref(false);
const approversSaving = ref(false);
const approvers = ref([]);
const level1 = ref([]);
const level2 = ref([]);

async function openApprovers() {
  try {
    const data = await api.get('/room/approvers');
    const cur = data.approvers || { 1: [], 2: [] };
    approvers.value = data.staff || [];
    level1.value = (cur[1] || []).map(Number);
    level2.value = (cur[2] || []).map(Number);
    approversOpen.value = true;
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

async function saveApprovers() {
  approversSaving.value = true;
  try {
    const res = await api.put('/room/approvers', { level1: level1.value, level2: level2.value });
    UI.toast(res.message);
    approversOpen.value = false;
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    approversSaving.value = false;
  }
}

/* ---------- ดาวน์โหลด Excel ---------- */
const STATUS_TH = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิก' };

function openExportDialog() {
  ExportFilterDialog.open({
    years: [new Date().getFullYear() + 543, new Date().getFullYear() + 542],
    title: 'จองห้องประชุม',
    getRows: async (yBE, m, wkStart, wkEnd) => {
      const url = '/room-bookings' + (yBE ? '?year=' + yBE : '');
      const data = await api.get(url);
      const rows = ExportFilterDialog.filterRows(data.bookings || [], 'date', yBE, m, wkStart, wkEnd);
      const headers = ['วันที่', 'ห้องประชุม', 'รองรับ (คน)', 'ผู้จอง', 'เวลา', 'หัวข้อการประชุม', 'ผู้เข้าร่วม', 'สถานะ'];
      const out = rows.map((r) => [
        r.date ? UI.date(r.date) : '',
        r.room_name || '',
        r.room_capacity || '',
        r.full_name || '',
        `${UI.time(r.start_time)} - ${UI.time(r.end_time)}`,
        r.topic || '',
        r.attendees || '',
        STATUS_TH[r.status] || r.status || '',
      ]);
      return { rows: out, headers, fileName: 'จองห้องประชุม' };
    },
  });
}
</script>

<template>
  <div class="page-head">
    <div>
      <div class="page-title"><span class="pi">⌂</span>จองห้องประชุม</div>
      <div class="page-desc">จองห้องประชุมสำหรับการประชุมหรืออบรม รอผู้ดูแลระบบอนุมัติ</div>
    </div>
    <div v-if="Auth.isAdmin()" style="display: flex; gap: 10px; flex-wrap: wrap">
      <button class="btn btn-primary" @click="openRoomCreate">+ เพิ่มห้องประชุม</button>
      <button class="btn btn-outline" @click="openApprovers">+ เพิ่มเจ้าหน้าที่</button>
    </div>
  </div>

  <!-- ---------- แท็บ ---------- -->
  <div class="tabs">
    <button id="r-tab-bookings" class="tab" :class="{ active: tab === 'bookings' }" @click="tab = 'bookings'">
      ◷ การจองห้องประชุม
    </button>
    <button id="r-tab-list" class="tab" :class="{ active: tab === 'list' }" @click="tab = 'list'">
      ⌂ รายการห้องประชุม
    </button>
  </div>

  <!-- ---------- แท็บ: รายการห้องประชุม ---------- -->
  <div v-if="tab === 'list'" class="card">
    <div class="card-title">⌂ รายการห้องประชุม ({{ rooms.length }} ห้อง)</div>
    <div v-if="roomsLoading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
    <div v-else-if="rooms.length === 0" class="empty-state"><span class="em">⌂</span>ยังไม่มีข้อมูลห้องประชุม</div>
    <div v-else class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>ชื่อห้อง</th>
            <th class="num">รองรับ (คน)</th>
            <th>สถานที่ตั้ง</th>
            <th>อุปกรณ์</th>
            <th>สถานะ</th>
            <th v-if="Auth.isAdmin()">จัดการ</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rooms" :key="r.id">
            <td>{{ r.name }}</td>
            <td class="num">{{ r.capacity }}</td>
            <td>{{ r.location }}</td>
            <td>{{ r.equipment }}</td>
            <td><StatusBadge :status="r.status" /></td>
            <td v-if="Auth.isAdmin()">
              <div class="status-btns">
                <button class="btn btn-xs btn-outline" @click="openRoomEdit(r)">✎</button>
                <button class="btn btn-xs btn-outline danger-btn" @click="removeRoom(r)">✕</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- ---------- แท็บ: การจอง ---------- -->
  <template v-else>
    <div class="toolbar">
      <button class="btn btn-primary" @click="openBookingForm">⌂ จองห้องประชุม</button>
      <select id="rb-year" v-model="yearFilter" style="width: fit-content">
        <option :value="String(curYear)">{{ curYear }}</option>
        <option :value="String(curYear - 1)">{{ curYear - 1 }}</option>
        <option value="">ทุกปี</option>
      </select>
      <button id="rb-view-toggle" class="btn btn-outline" @click="calView = !calView">
        {{ calView ? '▭ มุมมองตาราง' : '🗓️ มุมมองปฏิทิน' }}
      </button>
      <button
        class="btn btn-primary"
        style="background: #059669; margin-left: auto"
        title="ดาวน์โหลดข้อมูลเป็นไฟล์ Excel ตามตัวกรอง"
        @click="openExportDialog"
      >
        ⬇ ดาวน์โหลดข้อมูล
      </button>
    </div>

    <div class="card">
      <div v-if="bookingsLoading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
      <div v-else-if="bookingsError" class="empty-state"><span class="em">⚠️</span>{{ bookingsError }}</div>

      <!-- มุมมองปฏิทิน -->
      <template v-else-if="calView">
        <div class="card-title">🗓️ มุมมองปฏิทิน</div>
        <BookingCalendar :bookings="bookings" :month="calMonth" @pick="openDetail" @shift="shiftMonth" />
      </template>

      <!-- มุมมองตาราง -->
      <template v-else>
        <div class="card-title">▭ รายการจองทั้งหมด</div>
        <div v-if="bookings.length === 0" class="empty-state"><span class="em">⌂</span>ยังไม่มีรายการจอง</div>
        <div v-else class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>วันที่</th>
                <th>ห้องประชุม</th>
                <th>ผู้จอง</th>
                <th>เวลา</th>
                <th>หัวข้อการประชุม</th>
                <th class="num">ผู้เข้าร่วม</th>
                <th>สถานะ</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in bookings" :key="r.id">
                <td>{{ UI.date(r.date) }}</td>
                <td>
                  <div>{{ r.room_name }}</div>
                  <div class="hint">รองรับ {{ r.room_capacity }} คน</div>
                </td>
                <td>
                  <div>{{ UI.personName(r) }}</div>
                  <div class="hint">{{ r.username }}</div>
                </td>
                <td>{{ UI.time(r.start_time) }} - {{ UI.time(r.end_time) }}</td>
                <td>{{ r.topic }}</td>
                <td class="num">{{ r.attendees }}</td>
                <td>
                  <div>
                    <StatusBadge :status="r.status" />
                    <div
                      style="cursor: pointer"
                      title="ดูความคืบหน้าการอนุมัติ"
                      @click="progressFor = r"
                    >
                      {{ UI.approvalPill(r) }}
                    </div>
                  </div>
                </td>
                <td>
                  <div class="status-btns">
                    <button
                      v-for="(b, bi) in buttonsFor(r)"
                      :key="bi"
                      class="btn btn-xs btn-outline"
                      :class="{ 'danger-btn': b.danger }"
                      @click="onRoomButton(r, b.kind)"
                    >
                      {{ b.label }}
                    </button>
                    <!-- ยกเลิก/ลบได้เฉพาะรายการของตัวเอง (admin ยกเว้น) -->
                    <button
                      v-if="Auth.isAdmin() || (r.user_id === Auth.user.id && r.status === 'pending')"
                      class="btn btn-xs btn-outline danger-btn"
                      @click="removeBooking(r)"
                    >
                      {{ Auth.isAdmin() ? '✕' : '✕ ยกเลิก' }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-for="r in bookings.filter((x) => x.note)" :key="'n' + r.id" class="hint" style="margin-top: 10px">
          หมายเหตุรายการ {{ r.id }}: {{ r.note }}
        </div>
      </template>
    </div>
  </template>

  <!-- ---------- รายละเอียดการจอง ---------- -->
  <AppModal v-if="detailOpen" title="▭ รายละเอียดการจอง" size="lg" @close="detailOpen = false">
    <div v-if="detail" class="form-grid">
      <div class="form-group">
        <label>ห้องประชุม</label>
        <div>{{ detail.room_name }} (รองรับ {{ detail.room_capacity }} คน)</div>
      </div>
      <div class="form-group">
        <label>วันที่</label>
        <div>{{ UI.date(detail.date) }}</div>
      </div>
      <div class="form-group">
        <label>เวลา</label>
        <div>{{ UI.time(detail.start_time) }} - {{ UI.time(detail.end_time) }}</div>
      </div>
      <div class="form-group">
        <label>ผู้จอง</label>
        <div>{{ UI.personName(detail) }}</div>
      </div>
      <div class="form-group full">
        <label>หัวข้อการประชุม</label>
        <div>{{ detail.topic }}</div>
      </div>
      <div class="form-group">
        <label>ผู้เข้าร่วม</label>
        <div>{{ detail.attendees || 0 }} คน</div>
      </div>
      <div class="form-group">
        <label>สถานะ</label>
        <div><StatusBadge :status="detail.status" /></div>
      </div>
      <div class="form-group full">
        <label>ความคืบหน้าการอนุมัติ</label>
        <ApprovalSteps :record="detail" :level-names="LEVEL_NAMES" />
      </div>
    </div>
  </AppModal>

  <!-- ---------- ความคืบหน้าการอนุมัติ (คลิกที่ป้าย) ---------- -->
  <AppModal
    v-if="progressFor"
    title="▭ ความคืบหน้าการอนุมัติ"
    @close="progressFor = null"
  >
    <ApprovalSteps :record="progressFor" :level-names="LEVEL_NAMES" />
  </AppModal>

  <!-- ---------- ฟอร์มจอง ---------- -->
  <AppModal v-if="bookingOpen" title="⌂ จองห้องประชุม" footer @close="bookingOpen = false">
    <div class="form-grid">
      <div class="form-group full">
        <label>ห้องประชุม <span class="req"> *</span></label>
        <div v-if="availableRooms.length === 0" class="hint">⚠️ ไม่มีห้องประชุมที่ว่างในขณะนี้</div>
        <select v-else id="rb-room" v-model="bk.room_id">
          <option v-for="r in availableRooms" :key="r.id" :value="r.id">
            {{ r.name }} (รองรับ {{ r.capacity }} คน)
          </option>
        </select>
      </div>
      <div class="form-group">
        <label>วันที่ใช้ <span class="req"> *</span></label>
        <input id="rb-date" v-model="bk.date" type="date" :min="UI.today()" />
      </div>
      <div class="form-group">
        <label>เวลาเริ่ม</label>
        <input id="rb-start" v-model="bk.start_time" type="time" />
      </div>
      <div class="form-group">
        <label>เวลาสิ้นสุด</label>
        <input id="rb-end" v-model="bk.end_time" type="time" />
      </div>
      <div class="form-group full">
        <label>หัวข้อการประชุม/กิจกรรม <span class="req"> *</span></label>
        <input id="rb-topic" v-model="bk.topic" placeholder="เช่น ประชุมคณะกรรมการประเมินผล" />
      </div>
      <div class="form-group">
        <label>จำนวนผู้เข้าร่วม</label>
        <input id="rb-att" v-model.number="bk.attendees" type="number" min="1" />
      </div>

      <!-- แจ้งเตือนช่วงเวลาชน -->
      <div v-if="conflict.length" class="form-group full">
        <div style="background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; border-radius: 10px; padding: 12px 14px">
          <div style="font-weight: 700; margin-bottom: 6px">⚠️ ช่วงเวลานี้มีผู้จองไว้ก่อนแล้ว — ไม่สามารถจองได้</div>
          <div v-for="(c, i) in conflict" :key="i" style="margin-top: 4px">
            • {{ UI.personName(c) }} — {{ c.topic }} ({{ UI.time(c.start_time) }} - {{ UI.time(c.end_time) }})
          </div>
        </div>
      </div>
      <div v-else-if="conflictBusy" class="hint full">กำลังตรวจสอบช่วงเวลาว่าง...</div>
    </div>

    <template #footer>
      <button class="btn btn-outline" :disabled="bookingSaving" @click="bookingOpen = false">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="bookingSaving || conflict.length > 0" @click="submitBooking">
        {{ bookingSaving ? 'กำลังส่ง...' : '📨 ส่งคำขอจอง' }}
      </button>
    </template>
  </AppModal>

  <!-- ---------- ฟอร์มห้องประชุม ---------- -->
  <AppModal
    v-if="roomFormOpen"
    :title="rf.id ? '✎ แก้ไขห้องประชุม' : '+ เพิ่มห้องประชุม'"
    footer
    @close="roomFormOpen = false"
  >
    <div class="form-grid">
      <div class="form-group">
        <label>ชื่อห้องประชุม <span class="req"> *</span></label>
        <input id="rf-name" v-model="rf.name" placeholder="เช่น ห้องประชุมใหญ่ ชั้น 2" />
      </div>
      <div class="form-group">
        <label>รองรับจำนวน (คน)</label>
        <input id="rf-cap" v-model.number="rf.capacity" type="number" min="1" />
      </div>
      <div class="form-group">
        <label>สถานที่ตั้ง</label>
        <input id="rf-loc" v-model="rf.location" placeholder="เช่น อาคารอำนวยการ ชั้น 2" />
      </div>
      <div class="form-group">
        <label>สถานะ</label>
        <select id="rf-status" v-model="rf.status">
          <option value="available">พร้อมใช้</option>
          <option value="maintenance">ซ่อมบำรุง/ปิดใช้</option>
        </select>
      </div>
      <div class="form-group full">
        <label>อุปกรณ์ภายในห้อง</label>
        <input id="rf-eq" v-model="rf.equipment" placeholder="เช่น โปรเจกเตอร์, จอ, เครื่องเสียง" />
      </div>
      <div class="form-group full">
        <label>หมายเหตุ</label>
        <input id="rf-notes" v-model="rf.notes" />
      </div>
    </div>

    <template #footer>
      <button class="btn btn-outline" :disabled="roomSaving" @click="roomFormOpen = false">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="roomSaving" @click="saveRoom">
        {{ roomSaving ? 'กำลังบันทึก...' : '▽ บันทึก' }}
      </button>
    </template>
  </AppModal>

  <!-- ---------- ผู้อนุมัติห้องประชุม ---------- -->
  <AppModal
    v-if="approversOpen"
    title="+ เพิ่มเจ้าหน้าที่ (สิทธิ์อนุมัติการจองห้องประชุม/ยานพาหนะ)"
    size="lg"
    footer
    @close="approversOpen = false"
  >
    <p class="hint" style="margin-bottom: 12px">
      เลือกเจ้าหน้าที่และกำหนดสิทธิ์การอนุมัติ — ผู้อนุมัติขั้นต้น (ขั้นที่ 1) และ ผู้อนุมัติ
      (ขั้นสุดท้าย) ใช้ร่วมกันทั้งการจองห้องประชุมและจองยานพาหนะ ผู้ดูแลระบบมีสิทธิ์ครบทุกขั้นอยู่แล้ว
    </p>
    <div class="table-wrap" style="max-height: 380px; overflow-y: auto">
      <table class="tbl">
        <thead>
          <tr>
            <th>ชื่อ-นามสกุล</th>
            <th>ตำแหน่ง</th>
            <th style="text-align: center">ผู้อนุมัติขั้นต้น</th>
            <th style="text-align: center">ผู้อนุมัติ</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in approvers" :key="u.id">
            <td>{{ UI.personName(u) }}</td>
            <td>{{ u.position || '-' }}</td>
            <td style="text-align: center">
              <input v-model="level1" class="ra-l1" type="checkbox" :value="u.id" />
            </td>
            <td style="text-align: center">
              <input v-model="level2" class="ra-l2" type="checkbox" :value="u.id" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <template #footer>
      <button class="btn btn-outline" :disabled="approversSaving" @click="approversOpen = false">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="approversSaving" @click="saveApprovers">
        {{ approversSaving ? 'กำลังบันทึก...' : '▽ บันทึกสิทธิ์' }}
      </button>
    </template>
  </AppModal>

  <!-- ---------- ยืนยันอนุมัติขั้นสุดท้าย ---------- -->
  <AppModal v-if="finalOpen" title="● อนุมัติการใช้ห้องประชุม" size="lg" footer @close="finalOpen = false">
    <div v-if="finalTarget" class="form-grid">
      <div class="form-group">
        <label>ห้องประชุม</label>
        <div>{{ finalTarget.room_name }}</div>
      </div>
      <div class="form-group">
        <label>วันที่</label>
        <div>{{ UI.date(finalTarget.date) }}</div>
      </div>
      <div class="form-group">
        <label>เวลา</label>
        <div>{{ UI.time(finalTarget.start_time) }} - {{ UI.time(finalTarget.end_time) }}</div>
      </div>
      <div class="form-group">
        <label>ผู้จอง</label>
        <div>{{ UI.personName(finalTarget) }}</div>
      </div>
      <div class="form-group full">
        <label>หัวข้อการประชุม</label>
        <div>{{ finalTarget.topic }}</div>
      </div>
      <div class="form-group full">
        <label>ความคืบหน้าการอนุมัติ</label>
        <ApprovalSteps :record="finalTarget" :level-names="LEVEL_NAMES" />
      </div>
    </div>
    <p class="hint" style="margin-top: 12px">
      กรุณาตรวจสอบรายละเอียดให้ครบถ้วนก่อนกดยืนยัน — เมื่ออนุมัติแล้วจะถือเป็นการสิ้นสุดการอนุมัติ
    </p>

    <template #footer>
      <button class="btn btn-outline" @click="finalOpen = false">ยกเลิก</button>
      <button class="btn btn-primary" @click="confirmFinalApprove">● ยืนยันอนุมัติ</button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของระบบเดิมทั้งหมด */
</style>
