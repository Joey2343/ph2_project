<script setup>
/**
 * VehiclesPage — เมนู 5: จองยานพาหนะ
 *
 * Phase 5: เขียนใหม่เป็น Vue component
 * (เดิมเป็น src/views/VehiclesView.js แบบ UI.h() — 1045 บรรทัด)
 *
 * ฟีเจอร์เท่าเดิมทุกอย่าง:
 *   - 2 แท็บ: การจองยานพาหนะ / รายการยานพาหนะ (พร้อมรูป)
 *   - ฟิลเตอร์ ทั้งหมด/ของฉัน (จำค่าใน localStorage) + ปี พ.ศ. + Excel
 *   - มุมมองตาราง/ปฏิทิน + แจ้งเตือนการยกเลิก/แก้ไขการจอง
 *   - กันจองซ้ำ: เช็คก่อนส่ง + ก่อนอนุมัติ + ก่อนบันทึกการแก้ไข
 *   - อนุมัติ 2 ขั้น: ขั้นต้นเลือกพนักงานขับ+จัดยานพาหนะ · ขั้นสุดท้ายยืนยันซ้ำ
 *   - แก้ไข/ยกเลิกตามสิทธิ์ · แบบฟอร์มทางการ + พิมพ์
 *   - admin: เพิ่ม/แก้/ลบยานพาหนะ (มีรูป) + กำหนดผู้อนุมัติ
 */
import { ref, computed, onMounted, watch } from 'vue';
import api from '../api/client.js';
import { UI } from '../ui/ui.js';
import { Auth } from '../stores/auth.js';
import { ExportFilterDialog } from '../ui/ExportFilter.js';
import AppModal from '../components/ui/AppModal.vue';
import StatusBadge from '../components/ui/StatusBadge.vue';
import ApprovalPill from '../components/ui/ApprovalPill.vue';
import ApprovalSteps from '../components/ui/ApprovalSteps.vue';
import BookingCalendar from '../components/ui/BookingCalendar.vue';
import ThaiDateField from '../components/ui/ThaiDateField.vue';
import VehicleDoc from '../components/ui/VehicleDoc.vue';

const LEVEL_NAMES = { 1: 'อนุมัติขั้นต้น', 2: 'อนุมัติขั้นสุดท้าย' };

/* ---------- สิทธิ์อนุมัติ ---------- */
const myLevels = ref([]);
const canApproveLevel = (level) => myLevels.value.includes(level);
const canDecideVehicle = computed(() => Auth.isAdmin() || myLevels.value.length > 0);

/* ---------- ข้อมูลหลัก ---------- */
const tab = ref('bookings'); // 'bookings' | 'list'
const vehicles = ref([]);

const curYear = new Date().getFullYear() + 543;
const myFilter = ref(localStorage.getItem('vehicle_tab') || 'all'); // 'all' | 'mine'
const yearFilter = ref(String(curYear));
const calView = ref(false);
const calMonth = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

const bookingsLoading = ref(true);
const bookingsError = ref('');
const bookings = ref([]);

const isMine = (r) => Auth.user && Number(r.user_id) === Number(Auth.user.id);

const visibleBookings = computed(() =>
  myFilter.value === 'mine' ? bookings.value.filter(isMine) : bookings.value,
);

onMounted(async () => {
  myLevels.value = Auth.isAdmin() ? [1, 2, 3] : [];
  try {
    const me = await api.get('/vehicle/approvers/me');
    myLevels.value = (me.levels || []).map(Number);
  } catch (e) {
    /* ignore */
  }
  try {
    const data = await api.get('/vehicles');
    vehicles.value = data.vehicles || [];
  } catch (e) {
    /* ignore */
  }
  if (tab.value === 'bookings') await loadBookings();
});

async function loadBookings() {
  bookingsLoading.value = true;
  bookingsError.value = '';
  try {
    const url = yearFilter.value ? '/vehicle-bookings?year=' + yearFilter.value : '/vehicle-bookings';
    const data = await api.get(url);
    bookings.value = data.bookings || [];
  } catch (e) {
    bookingsError.value = e.message;
    bookings.value = [];
  } finally {
    bookingsLoading.value = false;
  }
}

watch([tab, yearFilter, myFilter], async (v) => {
  if (v[0] === 'bookings') await loadBookings();
});

function setMyFilter(v) {
  myFilter.value = v;
  localStorage.setItem('vehicle_tab', v);
}

function shiftMonth(delta) {
  const m = calMonth.value;
  calMonth.value = delta === 0 ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(m.getFullYear(), m.getMonth() + delta, 1);
}

/* ---------- ข้อความแจ้งเตือนในระบบ ---------- */
const notices = ref([]);
async function loadNotices() {
  try {
    const nres = await api.get('/vehicle-bookings/notices');
    notices.value = nres.notices || [];
  } catch (e) {
    /* ไม่ต้องแสดง error */
  }
}
onMounted(loadNotices);

async function markNoticesRead() {
  try {
    await api.put('/vehicle-bookings/notices/read', {});
    notices.value = [];
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

function noticeTime(created) {
  return new Date(String(created).replace(' ', 'T')).toLocaleString('th-TH');
}

/* ---------- รายละเอียด / เอกสาร ---------- */
const detail = ref(null);
const docFor = ref(null);

function openDetail(r) {
  detail.value = r;
}

const progressFor = ref(null);

/* ---------- ฟอร์มจอง ---------- */
const bookingOpen = ref(false);
const bookingSaving = ref(false);
const availableVehicles = computed(() => vehicles.value.filter((v) => v.status === 'available'));

const bk = ref(emptyBooking());
const conflict = ref([]);
const conflictBusy = ref(false);
let clashTimer = null;

function emptyBooking() {
  return {
    vehicle_id: '',
    date: UI.today(),
    start_time: '',
    date_to: UI.today(),
    end_time: '',
    total_days: 1,
    purpose: '',
    destination: '',
    passenger_count: 0,
    controller: Auth.user ? UI.personName(Auth.user) : '',
    fuel: { none: false, central: false, project: false },
    fuel_project: '',
    fuel_activity: '',
    fuel_amount: null,
    self_drive: false,
  };
}

function openBookingForm() {
  bk.value = emptyBooking();
  conflict.value = [];
  bookingOpen.value = true;
}

/** รูปยานพาหนะที่เลือก (ด้านบนฟอร์ม) */
const selectedVehicle = computed(() => vehicles.value.find((v) => String(v.id) === String(bk.value.vehicle_id)) || null);

/** คำนวณจำนวนวันรวมจาก ตั้งแต่ → ถึง */
function calcDays() {
  const { date, date_to } = bk.value;
  if (!date || !date_to) {
    bk.value.total_days = 1;
    return;
  }
  const a = new Date(date + 'T00:00:00');
  const b = new Date(date_to + 'T00:00:00');
  bk.value.total_days = b >= a ? Math.max(1, Math.round((b - a) / 86400000) + 1) : 1;
}

watch(() => [bk.value.date, bk.value.date_to], calcDays);

/** เช็คว่ายานพาหนะ + ช่วงเวลาที่เลือกถูกจองไว้แล้วหรือยัง (หน่วง 350 ms) */
function checkConflict() {
  clearTimeout(clashTimer);
  clashTimer = setTimeout(async () => {
    const { vehicle_id, date, date_to, start_time, end_time } = bk.value;
    conflict.value = [];
    if (!vehicle_id || !date) return;
    conflictBusy.value = true;
    try {
      const q = new URLSearchParams({
        vehicle_id,
        date,
        date_to: date_to || '',
        start_time: start_time || '',
        end_time: end_time || '',
      });
      const res = await api.get('/vehicle-bookings/conflicts?' + q.toString());
      conflict.value = res.conflicts || [];
    } catch (e) {
      /* ไม่ต้องแสดง error */
    } finally {
      conflictBusy.value = false;
    }
  }, 350);
}

watch(() => [bk.value.vehicle_id, bk.value.start_time, bk.value.end_time, bk.value.date, bk.value.date_to], checkConflict);

const FUEL_LABELS = {
  none: 'ไม่ขอใช้งบประมาณ',
  central: 'ขอใช้จากงบเชื้อเพลิงกลางของ สพท.',
  project: 'ขอใช้จากงบเชื้อเพลิงจากโครงการ',
};

async function submitBooking() {
  // กันจองซ้ำอีกชั้นตอนกดส่ง
  if (conflict.value.length) {
    const hit = conflict.value[0];
    return UI.toast(`ไม่สามารถจองได้ — ยานพาหนะคันนี้ถูกจองไว้แล้วในช่วงเวลานี้ (${hit.full_name} • ${hit.purpose})`, 'error');
  }
  const labels = Object.keys(FUEL_LABELS).filter((k) => bk.value.fuel[k]).map((k) => FUEL_LABELS[k]);
  const amount = bk.value.fuel_amount === '' || bk.value.fuel_amount === null ? 0 : Number(bk.value.fuel_amount);
  if (bk.value.fuel.project) {
    if (!bk.value.fuel_project.trim()) return UI.toast('กรุณากรอกชื่อโครงการ', 'error');
    if (!bk.value.fuel_activity.trim()) return UI.toast('กรุณากรอกชื่อกิจกรรม', 'error');
    if (!(amount > 0)) return UI.toast('กรุณากรอกจำนวนเงิน (บาท) ให้ถูกต้อง', 'error');
  }
  if (!bk.value.date) return UI.toast('กรุณาเลือกวันที่ (ตั้งแต่วันที่)', 'error');
  if (!bk.value.purpose.trim()) return UI.toast('กรุณากรอกวัตถุประสงค์', 'error');

  bookingSaving.value = true;
  try {
    const res = await api.post('/vehicle-bookings', {
      vehicle_id: bk.value.vehicle_id,
      date: bk.value.date,
      start_time: bk.value.start_time,
      date_to: bk.value.date_to,
      end_time: bk.value.end_time,
      total_days: bk.value.total_days,
      purpose: bk.value.purpose.trim(),
      destination: bk.value.destination.trim(),
      passenger_count: parseInt(bk.value.passenger_count, 10) || 0,
      controller: bk.value.controller.trim(),
      fuel_choice: labels.join(', '),
      fuel_project: bk.value.fuel_project.trim(),
      fuel_activity: bk.value.fuel_activity.trim(),
      fuel_amount: amount,
      self_drive: bk.value.self_drive ? 1 : 0,
    });
    UI.toast(res.message);
    bookingOpen.value = false;
    await Promise.all([loadBookings(), loadNotices()]);
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    bookingSaving.value = false;
  }
}

/* ---------- อนุมัติขั้นต้น ---------- */
const l1Open = ref(false);
const l1Target = ref(null);
const l1Saving = ref(false);
const l1Users = ref([]);
const l1Driver = ref('');
const l1Vehicle = ref('');
const l1Conflict = ref(null);

/** กรณีผู้ขอเลือก "มอบเจ้าหน้าที่จัดให้" → ผู้อนุมัติขั้นต้นเลือกยานพาหนะให้ผู้ขอได้ */
const l1NeedVehicle = computed(() => l1Target.value && !l1Target.value.vehicle_id);

const l1Assignable = computed(() => vehicles.value.filter((v) => v.status === 'available'));

async function openApproveLevel1(r) {
  l1Target.value = r;
  l1Driver.value = r.driver_name || '';
  l1Vehicle.value = '';
  l1Conflict.value = null;
  try {
    const res = await api.get('/users/active');
    l1Users.value = res.users || [];
  } catch (e) {
    /* ignore */
  }
  l1Open.value = true;
}

/** เช็คว่ายานพาหนะที่เลือกจัดให้ซ้อนกับรายการอื่นหรือไม่ */
async function checkAssignConflict() {
  l1Conflict.value = null;
  const r = l1Target.value;
  if (!r || !l1Vehicle.value) return;
  try {
    const q = new URLSearchParams({
      date: r.date,
      date_to: r.date_to || '',
      start_time: r.start_time || '',
      end_time: r.end_time || '',
    });
    const res = await api.get('/vehicle-bookings/conflicts?vehicle_id=' + l1Vehicle.value + '&' + q.toString());
    l1Conflict.value = (res.conflicts || [])[0] || null;
  } catch (e) {
    /* ข้ามถ้าเช็คไม่สำเร็จ */
  }
}

async function submitApproveLevel1() {
  const r = l1Target.value;
  if (!r) return;
  // กันจองซ้ำ: ถ้าเลือกยานพาหนะจัดให้แล้วซ้อนกับรายการอื่น → บล็อก
  if (l1Vehicle.value) {
    if (l1Conflict.value) {
      return UI.toast(`ไม่สามารถจัดยานพาหนะคันนี้ได้ — ถูกจองไว้แล้วในช่วงเวลาที่ขอ (${l1Conflict.value.full_name} • ${l1Conflict.value.purpose})`, 'error');
    }
    try {
      const q = new URLSearchParams({
        date: r.date,
        date_to: r.date_to || '',
        start_time: r.start_time || '',
        end_time: r.end_time || '',
      });
      const res = await api.get('/vehicle-bookings/conflicts?vehicle_id=' + l1Vehicle.value + '&' + q.toString());
      const hit = (res.conflicts || [])[0];
      if (hit) {
        return UI.toast(`ไม่สามารถจัดยานพาหนะคันนี้ได้ — ถูกจองไว้แล้วในช่วงเวลาที่ขอ (${hit.full_name} • ${hit.purpose})`, 'error');
      }
    } catch (e) {
      /* ข้ามถ้าเช็คไม่สำเร็จ — backend กันซ้ำอีกชั้น */
    }
  }
  const payload = { driver_name: (l1Driver.value || '').trim() };
  if (l1Vehicle.value) payload.vehicle_id = Number(l1Vehicle.value);
  l1Open.value = false;
  l1Saving.value = true;
  try {
    const res = await api.put(`/vehicle-bookings/${r.id}/approve`, payload);
    UI.toast(res.message);
    await Promise.all([loadBookings(), loadNotices()]);
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    l1Saving.value = false;
  }
}

/* ---------- อนุมัติขั้นสุดท้าย ---------- */
const finalOpen = ref(false);
const finalTarget = ref(null);

function openFinalApprove(r) {
  finalTarget.value = r;
  finalOpen.value = true;
}

async function confirmFinalApprove() {
  finalOpen.value = false;
  await decideDirect(finalTarget.value, 'approve');
}

/** ปุ่มอนุมัติ/ไม่อนุมัติตามสิทธิ์ */
function buttonsFor(r) {
  const btns = [];
  const isPending = r.status === 'pending';
  const next = UI.approvalDone(r) + 1;
  const required = r.required_levels || 1;
  if (isPending && next <= required && canApproveLevel(next)) {
    if (next >= required) btns.push({ label: '● อนุมัติ', kind: 'final' });
    else btns.push({ label: '● อนุมัติขั้นต้น', kind: 'approve1' });
  }
  if (isPending && canDecideVehicle.value) btns.push({ label: '✕ ไม่อนุมัติ', kind: 'reject', danger: true });
  return btns;
}

function onButton(r, kind) {
  if (kind === 'final') openFinalApprove(r);
  else if (kind === 'approve1') openApproveLevel1(r);
  else decide(r, kind);
}

async function decide(r, action) {
  const label = action === 'approve' ? 'อนุมัติ' : 'ไม่อนุมัติ';
  const yes = await UI.confirm(
    `ต้องการ${label}การจองยานพาหนะ "${r.vehicle_name || 'มอบเจ้าหน้าที่จัดให้'}" วันที่ ${UI.date(r.date)} ใช่หรือไม่?`,
    { okText: label, danger: action !== 'approve' },
  );
  if (!yes) return;
  await decideDirect(r, action);
}

async function decideDirect(r, action) {
  if (!r) return;
  try {
    const res = await api.put(`/vehicle-bookings/${r.id}/${action}`, {});
    UI.toast(res.message);
    await Promise.all([loadBookings(), loadNotices()]);
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

async function removeBooking(r) {
  const yes = await UI.confirm(
    'ต้องการยกเลิกรายการจองยานพาหนะนี้ใช่หรือไม่?\n\nระบบจะลบรายการออกและแจ้งเตือนผู้จองและพนักงานขับรถ',
    { danger: true, okText: 'ยกเลิกรายการ' },
  );
  if (!yes) return;
  try {
    const res = await api.del('/vehicle-bookings/' + r.id);
    UI.toast(res.message);
    await Promise.all([loadBookings(), loadNotices()]);
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

/* ---------- แก้ไขการจอง ---------- */
const editOpen = ref(false);
const editSaving = ref(false);
const editTarget = ref(null);
const editUsers = ref([]);
const eb = ref({ vehicle_id: '', date: '', date_to: '', start_time: '', end_time: '', total_days: 1, driver_name: '' });
const editConflict = ref(null);
let editTimer = null;

async function openEditBooking(r) {
  editTarget.value = r;
  eb.value = {
    vehicle_id: r.vehicle_id ? String(r.vehicle_id) : '',
    date: r.date || '',
    date_to: r.date_to || r.date || '',
    start_time: r.start_time || '',
    end_time: r.end_time || '',
    total_days: r.total_days || 1,
    driver_name: r.driver_name || '',
  };
  editConflict.value = null;
  try {
    const res = await api.get('/users/active');
    editUsers.value = res.users || [];
  } catch (e) {
    /* ignore */
  }
  editOpen.value = true;
}

function calcEditDays() {
  if (!eb.value.date || !eb.value.date_to) {
    eb.value.total_days = 1;
    return;
  }
  const a = new Date(eb.value.date + 'T00:00:00');
  const b = new Date(eb.value.date_to + 'T00:00:00');
  eb.value.total_days = b >= a ? Math.max(1, Math.round((b - a) / 86400000) + 1) : 1;
}

function checkEditConflict() {
  clearTimeout(editTimer);
  editTimer = setTimeout(async () => {
    const r = editTarget.value;
    editConflict.value = null;
    if (!r || !eb.value.vehicle_id || !eb.value.date) return;
    try {
      const q = new URLSearchParams({
        vehicle_id: eb.value.vehicle_id,
        date: eb.value.date,
        date_to: eb.value.date_to || '',
        start_time: eb.value.start_time || '',
        end_time: eb.value.end_time || '',
        exclude: String(r.id),
      });
      const res = await api.get('/vehicle-bookings/conflicts?' + q.toString());
      editConflict.value = (res.conflicts || [])[0] || null;
    } catch (e) {
      /* ไม่ต้องแสดง error */
    }
  }, 350);
}

watch(
  () => [eb.value.vehicle_id, eb.value.date, eb.value.date_to, eb.value.start_time, eb.value.end_time],
  () => {
    calcEditDays();
    checkEditConflict();
  },
);

async function saveEditBooking() {
  const r = editTarget.value;
  if (!r) return;
  if (!eb.value.date) return UI.toast('กรุณาระบุวันที่', 'error');
  if (editConflict.value) {
    return UI.toast(`ไม่สามารถแก้ไขได้ — ยานพาหนะคันนี้ถูกจองไว้แล้วในช่วงเวลาที่แก้ไข (${editConflict.value.full_name} • ${editConflict.value.purpose})`, 'error');
  }
  editSaving.value = true;
  try {
    const res = await api.put(`/vehicle-bookings/${r.id}/edit`, {
      vehicle_id: eb.value.vehicle_id,
      date: eb.value.date,
      date_to: eb.value.date_to || '',
      start_time: eb.value.start_time,
      end_time: eb.value.end_time,
      driver_name: eb.value.driver_name,
    });
    UI.toast(res.message);
    editOpen.value = false;
    await Promise.all([loadBookings(), loadNotices()]);
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    editSaving.value = false;
  }
}

/* ---------- ฟอร์มยานพาหนะ (admin) ---------- */
const vFormOpen = ref(false);
const vSaving = ref(false);
const editingVehicle = ref(null);
const vPhoto = ref(null);
const vRemovePhoto = ref(false);
const vf = ref(emptyVehicle());

/** URL ของรูปที่เพิ่งเลือก (ต้อง revoke เมื่อเปลี่ยน/ปิด เพื่อไม่รั่ว object URL) */
const vPhotoUrl = ref('');
watch(
  vPhoto,
  (f) => {
    if (vPhotoUrl.value) URL.revokeObjectURL(vPhotoUrl.value);
    vPhotoUrl.value = f ? URL.createObjectURL(f) : '';
  },
);
watch(vFormOpen, (open) => {
  if (!open && vPhotoUrl.value) {
    URL.revokeObjectURL(vPhotoUrl.value);
    vPhotoUrl.value = '';
    vPhoto.value = null;
  }
});

function emptyVehicle() {
  return { id: null, name: '', plate: '', type: '', capacity: 1, status: 'available', notes: '', photo: '' };
}

function openVehicleCreate() {
  editingVehicle.value = null;
  vf.value = emptyVehicle();
  vPhoto.value = null;
  vRemovePhoto.value = false;
  vFormOpen.value = true;
}

/** คลิกรูปในคอลั่ม "รูป" เพื่อดูขนาดเต็ม (ช่องเล็ก เห็นรายละเอียดไม่ครบ) */
function viewVehiclePhoto(v) {
  if (!v || !v.photo) return;
  window.open('/uploads/' + UI.encodePath(v.photo), '_blank', 'noopener');
}

function openVehicleEdit(v) {
  editingVehicle.value = v;
  vf.value = {
    id: v.id,
    name: v.name || '',
    plate: v.plate || '',
    type: v.type || '',
    capacity: v.capacity || 1,
    status: v.status || 'available',
    notes: v.notes || '',
    photo: v.photo || '',
  };
  vPhoto.value = null;
  vRemovePhoto.value = false;
  vFormOpen.value = true;
}

async function saveVehicle() {
  if (!vf.value.name.trim()) return UI.toast('กรุณากรอกชื่อยานพาหนะ', 'error');
  const fd = new FormData();
  fd.append('name', vf.value.name.trim());
  fd.append('plate', vf.value.plate.trim());
  fd.append('type', vf.value.type.trim());
  fd.append('capacity', parseInt(vf.value.capacity, 10) || 0);
  fd.append('status', vf.value.status);
  fd.append('notes', vf.value.notes.trim());
  if (vPhoto.value) fd.append('photo', vPhoto.value);
  else if (vRemovePhoto) fd.append('photo', '');
  vSaving.value = true;
  try {
    const res = vf.value.id ? await api.putForm('/vehicles/' + vf.value.id, fd) : await api.postForm('/vehicles', fd);
    UI.toast(res.message);
    vFormOpen.value = false;
    const data = await api.get('/vehicles');
    vehicles.value = data.vehicles || [];
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    vSaving.value = false;
  }
}

async function removeVehicle(v) {
  const yes = await UI.confirm(`ต้องการลบยานพาหนะ "${v.name}" ใช่หรือไม่?`, { danger: true, okText: 'ลบ' });
  if (!yes) return;
  try {
    const res = await api.del('/vehicles/' + v.id);
    UI.toast(res.message);
    const data = await api.get('/vehicles');
    vehicles.value = data.vehicles || [];
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

/* ---------- ผู้อนุมัติ (admin) ---------- */
const apprOpen = ref(false);
const apprSaving = ref(false);
const apprStaff = ref([]);
const apprL1 = ref([]);
const apprL2 = ref([]);

async function openApprovers() {
  try {
    const data = await api.get('/vehicle/approvers');
    const cur = data.approvers || { 1: [], 2: [] };
    apprStaff.value = data.staff || [];
    apprL1.value = (cur[1] || []).map(Number);
    apprL2.value = (cur[2] || []).map(Number);
    apprOpen.value = true;
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

async function saveApprovers() {
  apprSaving.value = true;
  try {
    const res = await api.put('/vehicle/approvers', { level1: apprL1.value, level2: apprL2.value });
    UI.toast(res.message);
    apprOpen.value = false;
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    apprSaving.value = false;
  }
}

/* ---------- Excel ---------- */
const STATUS_TH = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิก' };

function openExportDialog() {
  ExportFilterDialog.open({
    years: [new Date().getFullYear() + 543, new Date().getFullYear() + 542],
    title: 'จองยานพาหนะ',
    getRows: async (yBE, m, wkStart, wkEnd) => {
      const url = '/vehicle-bookings' + (yBE ? '?year=' + yBE : '');
      const data = await api.get(url);
      const rows = ExportFilterDialog.filterRows(data.bookings || [], 'date', yBE, m, wkStart, wkEnd);
      const headers = [
        'วันที่', 'ถึงวันที่', 'ผู้จอง', 'ยานพาหนะ', 'ทะเบียน', 'เวลา', 'รวม (วัน)',
        'พนักงานขับรถ', 'ผู้โดยสาร', 'วัตถุประสงค์', 'สถานที่ไปราชการ', 'สถานะ',
      ];
      const out = rows.map((r) => [
        r.date ? UI.date(r.date) : '',
        r.date_to ? UI.date(r.date_to) : '',
        r.full_name || '',
        r.vehicle_name || 'มอบเจ้าหน้าที่จัดให้',
        r.plate || '',
        `${UI.time(r.start_time)} - ${UI.time(r.end_time)}`,
        r.total_days || 1,
        r.driver_name || (r.self_drive ? 'ผู้ขอขับเอง' : ''),
        r.passenger_count || '',
        r.purpose || '',
        r.destination || '',
        STATUS_TH[r.status] || r.status || '',
      ]);
      return { rows: out, headers, fileName: 'จองยานพาหนะ' };
    },
  });
}

/* ---------- ตัวช่วยแสดงผล ---------- */

/** วันที่ (รองรับช่วงหลายวัน) */
function dateCell(r) {
  return r.date_to && r.date_to !== r.date ? `${UI.date(r.date)} → ${UI.date(r.date_to)}` : UI.date(r.date);
}

function vehicleCell(r) {
  return r.vehicle_name
    ? { title: r.vehicle_name, hint: r.plate }
    : { title: '🤝 มอบเจ้าหน้าที่จัดให้', hint: 'รอเจ้าหน้าที่จัดรถ' };
}

function driverCell(r) {
  return r.driver_name || (r.self_drive ? 'ผู้ขอขับเอง' : '-');
}

function passengerCell(r) {
  return r.passenger_count ? `${r.passenger_count} คน` : '-';
}

/** แก้ไขได้: ผู้อนุมัติขั้นต้น/admin และรายการยังรออนุมัติหรืออนุมัติแล้ว */
function canEditRow(r) {
  return (Auth.isAdmin() || canApproveLevel(1)) && (r.status === 'pending' || r.status === 'approved');
}

/** ยกเลิกได้: ผู้อนุมัติขั้นต้น/admin (ทุกรายการ) หรือเจ้าของที่ยังรออนุมัติ */
function canCancelRow(r) {
  return Auth.isAdmin() || canApproveLevel(1) || (isMine(r) && r.status === 'pending');
}
</script>

<template>
  <div class="page-head">
    <div>
      <div class="page-title"><span class="pi">🚐</span>จองยานพาหนะ</div>
      <div class="page-desc">ขอใช้ยานพาหนะของทางราชการ รอผู้ดูแลระบบอนุมัติ</div>
    </div>
    <div v-if="Auth.isAdmin()" style="display: flex; gap: 10px; flex-wrap: wrap">
      <button class="btn btn-primary" @click="openVehicleCreate">+ เพิ่มยานพาหนะ</button>
      <button class="btn btn-outline" @click="openApprovers">+ เพิ่มเจ้าหน้าที่</button>
    </div>
  </div>

  <!-- ---------- แท็บ ---------- -->
  <div class="tabs">
    <button id="v-tab-bookings" class="tab" :class="{ active: tab === 'bookings' }" @click="tab = 'bookings'">
      ◷ การจองยานพาหนะ
    </button>
    <button id="v-tab-list" class="tab" :class="{ active: tab === 'list' }" @click="tab = 'list'">
      🚐 รายการยานพาหนะ
    </button>
  </div>

  <!-- ---------- แท็บ: รายการยานพาหนะ ---------- -->
  <div v-if="tab === 'list'" class="card">
    <div class="card-title">🚐 รายการยานพาหนะ ({{ vehicles.length }} คัน)</div>
    <div v-if="vehicles.length === 0" class="empty-state"><span class="em">🚐</span>ยังไม่มีข้อมูลยานพาหนะ</div>
    <div v-else class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th class="vehicle-thumb-cell">รูป</th>
            <th>ชื่อยานพาหนะ</th>
            <th>ทะเบียน</th>
            <th>ประเภท</th>
            <th class="num">ที่นั่ง</th>
            <th>สถานะ</th>
            <th v-if="Auth.isAdmin()">จัดการ</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in vehicles" :key="v.id">
            <td class="vehicle-thumb-cell">
              <img
                v-if="v.photo"
                class="vehicle-thumb"
                :src="'/uploads/' + UI.encodePath(v.photo)"
                :alt="v.name"
                title="คลิกเพื่อดูรูปขนาดเต็ม"
                @click="viewVehiclePhoto(v)"
              />
              <span v-else class="vehicle-thumb ph">🚐</span>
            </td>
            <td>{{ v.name }}</td>
            <td>{{ v.plate }}</td>
            <td>{{ v.type }}</td>
            <td class="num">{{ v.capacity }}</td>
            <td><StatusBadge :status="v.status" /></td>
            <td v-if="Auth.isAdmin()">
              <div class="status-btns">
                <button class="btn btn-xs btn-outline" @click="openVehicleEdit(v)">✎</button>
                <button class="btn btn-xs btn-outline danger-btn" @click="removeVehicle(v)">✕</button>
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
      <button class="btn btn-primary" @click="openBookingForm">🚐 จองยานพาหนะ</button>
      <div class="seg">
        <button id="v-filter-all" class="seg-btn" :class="{ active: myFilter === 'all' }" @click="setMyFilter('all')">
          ทั้งหมด
        </button>
        <button id="v-filter-mine" class="seg-btn" :class="{ active: myFilter === 'mine' }" @click="setMyFilter('mine')">
          ของฉัน
        </button>
      </div>
      <select id="vb-year" v-model="yearFilter" style="width: fit-content">
        <option :value="String(curYear)">{{ curYear }}</option>
        <option :value="String(curYear - 1)">{{ curYear - 1 }}</option>
        <option value="">ทุกปี</option>
      </select>
      <button id="vb-view-toggle" class="btn btn-outline" @click="calView = !calView">
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

    <!-- ข้อความแจ้งเตือนในระบบ -->
    <div
      v-if="notices.length"
      class="card"
      style="border: 1px solid #fcd34d; background: #fffbeb; margin-bottom: 14px"
    >
      <div class="card-title">📢 แจ้งเตือนการจองยานพาหนะ ({{ notices.length }} ข้อความ)</div>
      <div
        v-for="(n, i) in notices"
        :key="i"
        style="padding: 10px 12px; border-bottom: 1px solid #fde68a; white-space: pre-wrap; font-size: 13px; line-height: 1.6"
      >
        <span style="color: #92400e; font-weight: 600">{{ n.type === 'cancel' ? '✕ ยกเลิกการจอง' : '✎ แก้ไขการจอง' }}</span>
        — {{ noticeTime(n.created_at) }}
        {{ n.text }}
      </div>
      <div style="padding: 10px 12px; text-align: right">
        <button class="btn btn-outline btn-sm" @click="markNoticesRead">✔️ อ่านแล้วทั้งหมด</button>
      </div>
    </div>

    <div class="card">
      <div v-if="bookingsLoading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
      <div v-else-if="bookingsError" class="empty-state"><span class="em">⚠️</span>{{ bookingsError }}</div>

      <!-- มุมมองปฏิทิน -->
      <template v-else-if="calView">
        <div class="card-title">🗓️ มุมมองปฏิทิน{{ myFilter === 'mine' ? ' (ของฉัน)' : '' }}</div>
        <BookingCalendar
          kind="vehicles"
          :bookings="visibleBookings"
          :month="calMonth"
          @pick="openDetail"
          @shift="shiftMonth"
        />
      </template>

      <!-- มุมมองตาราง -->
      <template v-else>
        <div class="card-title">
          ▭ {{ myFilter === 'mine' ? 'รายการจองของฉัน' : 'รายการจองทั้งหมด' }} ({{ visibleBookings.length }})
        </div>
        <div v-if="visibleBookings.length === 0" class="empty-state"><span class="em">🚐</span>ยังไม่มีรายการจอง</div>
        <div v-else class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>วันที่</th>
                <th>ผู้จอง</th>
                <th>ยานพาหนะ</th>
                <th>เวลา</th>
                <th class="num">รวม (วัน)</th>
                <th>พนักงานขับรถ</th>
                <th class="num">ผู้โดยสาร</th>
                <th>วัตถุประสงค์</th>
                <th>สถานที่ไปราชการ</th>
                <th>รายละเอียด</th>
                <th>สถานะ</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in visibleBookings" :key="r.id">
                <td>{{ dateCell(r) }}</td>
                <td class="nowrap">{{ UI.personName(r) }}</td>
                <td>
                  <div>{{ vehicleCell(r).title }}</div>
                  <div class="hint">{{ vehicleCell(r).hint }}</div>
                </td>
                <td>{{ UI.time(r.start_time) }} - {{ UI.time(r.end_time) }}</td>
                <td class="num">{{ r.total_days || 1 }} วัน</td>
                <td>{{ driverCell(r) }}</td>
                <td class="num">{{ passengerCell(r) }}</td>
                <td><div class="clamp-2" :title="r.purpose">{{ r.purpose }}</div></td>
                <td>{{ r.destination }}</td>
                <td>
                  <button class="btn btn-xs btn-outline" @click="docFor = r">▭ รายละเอียด</button>
                </td>
                <td>
                  <div>
                    <StatusBadge :status="r.status" />
                    <div style="cursor: pointer" title="ดูความคืบหน้าการอนุมัติ" @click="progressFor = r">
                      <ApprovalPill :row="r" />
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
                      @click="onButton(r, b.kind)"
                    >
                      {{ b.label }}
                    </button>
                    <button v-if="canEditRow(r)" class="btn btn-xs btn-outline" @click="openEditBooking(r)">
                      ✎ แก้ไข
                    </button>
                    <button
                      v-if="canCancelRow(r)"
                      class="btn btn-xs btn-outline danger-btn"
                      @click="removeBooking(r)"
                    >
                      ✕ ยกเลิก
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-for="r in visibleBookings.filter((x) => x.note)" :key="'n' + r.id" class="hint" style="margin-top: 10px">
          หมายเหตุรายการ {{ r.id }}: {{ r.note }}
        </div>
      </template>
    </div>
  </template>

  <!-- ---------- รายละเอียดการจอง ---------- -->
  <AppModal v-if="detail" title="▭ รายละเอียดการจอง" size="lg" @close="detail = null">
    <div class="form-grid">
      <div class="form-group">
        <label>ยานพาหนะ</label>
        <div>{{ detail.vehicle_name ? `${detail.vehicle_name}${detail.plate ? ` (${detail.plate})` : ''}` : '🤝 มอบเจ้าหน้าที่จัดให้' }}</div>
      </div>
      <div class="form-group">
        <label>วันที่</label>
        <div>{{ dateCell(detail) }}</div>
      </div>
      <div class="form-group">
        <label>เวลา</label>
        <div>{{ UI.time(detail.start_time) }} - {{ UI.time(detail.end_time) }}</div>
      </div>
      <div class="form-group">
        <label>ผู้จอง</label>
        <div>{{ UI.personName(detail) }}</div>
      </div>
      <div class="form-group">
        <label>พนักงานขับรถ</label>
        <div>{{ driverCell(detail) }}</div>
      </div>
      <div class="form-group">
        <label>ผู้โดยสาร</label>
        <div>{{ detail.passenger_count || 0 }} คน</div>
      </div>
      <div class="form-group full">
        <label>สถานที่ไปราชการ</label>
        <div>{{ detail.destination || '-' }}</div>
      </div>
      <div class="form-group full">
        <label>วัตถุประสงค์</label>
        <div>{{ detail.purpose }}</div>
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
  <AppModal v-if="progressFor" title="▭ ความคืบหน้าการอนุมัติ" @close="progressFor = null">
    <ApprovalSteps :record="progressFor" :level-names="LEVEL_NAMES" />
  </AppModal>

  <!-- ---------- แบบฟอร์มทางการ ---------- -->
  <VehicleDoc
    v-if="docFor"
    :booking-id="docFor.id"
    :vehicle-name="docFor.vehicle_name"
    :plate="docFor.plate"
    @close="docFor = null"
  />

  <!-- ---------- ฟอร์มจอง ---------- -->
  <AppModal v-if="bookingOpen" title="🚐 จองยานพาหนะ" size="lg" footer @close="bookingOpen = false">
    <!-- รูปยานพาหนะที่เลือก -->
    <div class="form-group full">
      <div class="vehicle-booking-photo">
        <img v-if="selectedVehicle && selectedVehicle.photo" :src="'/uploads/' + UI.encodePath(selectedVehicle.photo)" :alt="selectedVehicle.name" />
        <div v-else class="vehicle-booking-photo-empty">🚐</div>
      </div>
    </div>

    <div class="form-grid">
      <div class="form-group full">
        <label>ยานพาหนะ <span class="req"> *</span></label>
        <select id="vb-vehicle" v-model="bk.vehicle_id">
          <option value="">🤝 มอบเจ้าหน้าที่จัดให้</option>
          <option v-for="v in availableVehicles" :key="v.id" :value="v.id">{{ v.name }} ({{ v.plate || '-' }})</option>
        </select>
        <div class="hint">เลือก "มอบเจ้าหน้าที่จัดให้" หากยังไม่ระบุรถเฉพาะ เจ้าหน้าที่จะจัดรถให้</div>
      </div>

      <div class="form-group full">
        <label>สถานที่ไปราชการ</label>
        <input id="vb-dest" v-model="bk.destination" placeholder="เช่น กรุงเทพมหานคร" />
      </div>

      <div class="form-group full">
        <label>เพื่อวัตถุประสงค์ <span class="req"> *</span></label>
        <input id="vb-purpose" v-model="bk.purpose" placeholder="เช่น ไปราชการส่งเอกสารที่ สพฐ." />
      </div>

      <div class="form-group">
        <label>ตั้งแต่วันที่ <span class="req"> *</span></label>
        <ThaiDateField id="vb-date-from" v-model="bk.date" :min="UI.today()" />
      </div>

      <div class="form-group">
        <label>ตั้งแต่เวลา</label>
        <input id="vb-time-from" v-model="bk.start_time" type="time" />
      </div>

      <div class="form-group">
        <label>ถึงวันที่</label>
        <ThaiDateField id="vb-date-to" v-model="bk.date_to" :min="UI.today()" />
      </div>

      <div class="form-group">
        <label>ถึงเวลา</label>
        <input id="vb-time-to" v-model="bk.end_time" type="time" />
      </div>

      <!-- แจ้งเตือนช่วงเวลาชน -->
      <div v-if="conflict.length" class="form-group full">
        <div style="background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; border-radius: 10px; padding: 12px 14px">
          <div style="font-weight: 700; margin-bottom: 6px">⚠️ ยานพาหนะคันนี้ถูกจองไว้ก่อนแล้ว — ไม่สามารถจองซ้ำได้</div>
          <div>ผู้จอง: {{ conflict[0].full_name }} • {{ conflict[0].purpose }}</div>
        </div>
      </div>
      <div v-else-if="conflictBusy" class="hint full">กำลังตรวจสอบช่วงเวลาว่าง...</div>

      <div class="form-group">
        <label>รวม (วัน)</label>
        <input id="vb-total" v-model.number="bk.total_days" type="number" min="1" readonly />
      </div>

      <div class="form-group">
        <label>มีผู้โดยสารทั้งหมด (คน)</label>
        <input id="vb-passengers" v-model.number="bk.passenger_count" type="number" min="0" />
      </div>

      <div class="form-group full">
        <label>ผู้ควบคุมรถคือ</label>
        <input id="vb-controller" v-model="bk.controller" />
      </div>

      <div class="form-group full">
        <label>เชื้อเพลิง</label>
        <div class="fuel-opts">
          <label class="fuel-opt"><input v-model="bk.fuel.none" type="checkbox" /> ไม่ขอใช้งบประมาณ</label>
          <label class="fuel-opt"><input v-model="bk.fuel.central" type="checkbox" /> ขอใช้จากงบเชื้อเพลิงกลางของ สพท.</label>
          <label class="fuel-opt"><input v-model="bk.fuel.project" type="checkbox" /> ขอใช้จากงบเชื้อเพลิงจากโครงการ</label>
        </div>
      </div>

      <div v-if="bk.fuel.project" class="form-group full" id="vb-fuel-project-box">
        <div class="form-grid" style="margin-top: 8px">
          <div class="form-group">
            <label>ชื่อโครงการ</label>
            <input id="vb-fuel-pname" v-model="bk.fuel_project" placeholder="เช่น โครงการนิเทศติดตาม" />
          </div>
          <div class="form-group">
            <label>ชื่อกิจกรรม</label>
            <input id="vb-fuel-act" v-model="bk.fuel_activity" placeholder="เช่น กิจกรรมนิเทศภายใน" />
          </div>
          <div class="form-group">
            <label>จำนวนเงิน (บาท)</label>
            <input id="vb-fuel-amt" v-model.number="bk.fuel_amount" type="number" min="0" step="0.01" placeholder="0.00" />
          </div>
        </div>
      </div>

      <div class="form-group full">
        <label style="color: var(--danger); font-weight: 700">⚠️ กรณีไม่มีพนักงานขับรถ</label>
        <label class="fuel-opt" style="margin-top: 6px">
          <input id="vb-selfdrive" v-model="bk.self_drive" type="checkbox" />
          ขออนุญาตเป็นผู้ขับรถคันดังกล่าว ซึ่งได้รับใบอนุญาตในการขับขี่รถจากทางราชการประเภทนี้
        </label>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-outline" :disabled="bookingSaving" @click="bookingOpen = false">ยกเลิก</button>
      <button
        class="btn btn-primary"
        :disabled="bookingSaving || conflict.length > 0"
        @click="submitBooking"
      >
        {{ bookingSaving ? 'กำลังส่ง...' : '📨 ส่งคำขอยืม' }}
      </button>
    </template>
  </AppModal>

  <!-- ---------- อนุมัติขั้นต้น ---------- -->
  <AppModal
    v-if="l1Open"
    title="● อนุมัติขั้นต้น — การใช้ยานพาหนะ"
    size="lg"
    footer
    @close="l1Open = false"
  >
    <div v-if="l1Target" class="form-grid">
      <!-- กรณีผู้ขอเลือกมอบเจ้าหน้าที่จัดให้ → ต้องเลือกยานพาหนะให้ -->
      <div v-if="l1NeedVehicle" class="form-group">
        <label>ยานพาหนะ (จัดให้ผู้ขอ)</label>
        <select id="vb-vehicle-assign" v-model="l1Vehicle" class="vb-assign-select" @change="checkAssignConflict">
          <option value="">🤝 มอบเจ้าหน้าที่จัดให้</option>
          <option v-for="v in l1Assignable" :key="v.id" :value="v.id">
            {{ v.name }}{{ v.plate ? ` (${v.plate})` : '' }}
          </option>
        </select>
        <div v-if="l1Conflict" id="vb-assign-conflict" style="margin-top: 8px">
          <div style="background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; border-radius: 10px; padding: 10px 12px">
            <div style="font-weight: 700; margin-bottom: 4px">⚠️ ยานพาหนะคันนี้ถูกจองไว้ก่อนแล้วในช่วงเวลาที่ขอ — ไม่สามารถจัดให้ได้</div>
            <div>ผู้จอง: {{ l1Conflict.full_name }} • {{ l1Conflict.purpose }}</div>
          </div>
        </div>
        <div class="hint">
          ผู้ขอเลือกมอบเจ้าหน้าที่จัดให้ — กรุณาเลือกยานพาหนะที่จัดให้ผู้ขอ
          (เลือกแล้วระบบจะเช็ควัน/เวลาที่ขอว่าซ้อนกับรายการอื่นหรือไม่)
        </div>
      </div>
      <div v-else class="form-group">
        <label>ยานพาหนะ</label>
        <div>{{ l1Target.vehicle_name ? `${l1Target.vehicle_name} (${l1Target.plate || '-'})` : '🤝 มอบเจ้าหน้าที่จัดให้' }}</div>
      </div>

      <div class="form-group">
        <label>ตั้งแต่วันที่</label>
        <div>{{ UI.date(l1Target.date) }}</div>
      </div>
      <div class="form-group">
        <label>ตั้งแต่เวลา</label>
        <div>{{ UI.time(l1Target.start_time) || '-' }}</div>
      </div>
      <div class="form-group">
        <label>ถึงวันที่</label>
        <div>{{ l1Target.date_to ? UI.date(l1Target.date_to) : '-' }}</div>
      </div>
      <div class="form-group">
        <label>ถึงเวลา</label>
        <div>{{ UI.time(l1Target.end_time) || '-' }}</div>
      </div>
      <div class="form-group">
        <label>รวม (วัน)</label>
        <div>{{ l1Target.total_days || 1 }} วัน</div>
      </div>
      <div class="form-group">
        <label>ผู้ควบคุมรถ</label>
        <div>{{ l1Target.controller || '-' }}</div>
      </div>
      <div class="form-group">
        <label>ผู้โดยสาร</label>
        <div>{{ l1Target.passenger_count || 0 }} คน</div>
      </div>
      <div class="form-group">
        <label>สถานที่ไปราชการ</label>
        <div>{{ l1Target.destination || '-' }}</div>
      </div>
      <div class="form-group">
        <label>ผู้จอง</label>
        <div>{{ UI.personName(l1Target) }}</div>
      </div>
      <div class="form-group full">
        <label>วัตถุประสงค์</label>
        <div>{{ l1Target.purpose }}</div>
      </div>
      <div class="form-group">
        <label>เชื้อเพลิง</label>
        <div>{{ l1Target.fuel_choice || '-' }}</div>
      </div>
      <div class="form-group">
        <label>ขับรถเอง</label>
        <div>{{ l1Target.self_drive ? '● ขออนุญาตเป็นผู้ขับรถ' : '-' }}</div>
      </div>

      <div class="form-group full">
        <label>เลือกพนักงานขับรถ</label>
        <select id="vb-driver" v-model="l1Driver" class="vb-driver-select">
          <option value="">— เลือกพนักงานขับรถ —</option>
          <option v-for="u in l1Users" :key="u.id" :value="UI.personName(u)">{{ UI.personName(u) }}</option>
        </select>
        <div class="hint">เลือกรายชื่อบุคลากรที่จะเป็นพนักงานขับรถสำหรับคำขอนี้ (ปล่อยว่าง = เจ้าหน้าที่จัดให้)</div>
      </div>

      <div class="form-group full">
        <label>ความคืบหน้าการอนุมัติ</label>
        <ApprovalSteps :record="l1Target" :level-names="LEVEL_NAMES" />
      </div>
    </div>

    <p class="hint" style="margin-top: 12px">
      ตรวจสอบรายละเอียดให้ครบถ้วน แล้วกดอนุมัติขั้นต้นเพื่อส่งเรื่องต่อไปยังผู้อนุมัติขั้นถัดไป
    </p>

    <template #footer>
      <button class="btn btn-outline" :disabled="l1Saving" @click="l1Open = false">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="l1Saving" @click="submitApproveLevel1">
        {{ l1Saving ? 'กำลังบันทึก...' : '● อนุมัติขั้นต้น' }}
      </button>
    </template>
  </AppModal>

  <!-- ---------- ยืนยันอนุมัติขั้นสุดท้าย ---------- -->
  <AppModal v-if="finalOpen" title="● อนุมัติการใช้ยานพาหนะ" size="lg" footer @close="finalOpen = false">
    <div v-if="finalTarget" class="form-grid">
      <div class="form-group">
        <label>ยานพาหนะ</label>
        <div>{{ finalTarget.vehicle_name ? `${finalTarget.vehicle_name} (${finalTarget.plate || '-'})` : '🤝 มอบเจ้าหน้าที่จัดให้' }}</div>
      </div>
      <div class="form-group">
        <label>ตั้งแต่วันที่</label>
        <div>{{ UI.date(finalTarget.date) }}</div>
      </div>
      <div class="form-group">
        <label>ตั้งแต่เวลา</label>
        <div>{{ UI.time(finalTarget.start_time) || '-' }}</div>
      </div>
      <div class="form-group">
        <label>ถึงวันที่</label>
        <div>{{ finalTarget.date_to ? UI.date(finalTarget.date_to) : '-' }}</div>
      </div>
      <div class="form-group">
        <label>ถึงเวลา</label>
        <div>{{ UI.time(finalTarget.end_time) || '-' }}</div>
      </div>
      <div class="form-group">
        <label>รวม (วัน)</label>
        <div>{{ finalTarget.total_days || 1 }} วัน</div>
      </div>
      <div class="form-group">
        <label>ผู้ควบคุมรถ</label>
        <div>{{ finalTarget.controller || '-' }}</div>
      </div>
      <div class="form-group">
        <label>พนักงานขับรถ</label>
        <div>{{ finalTarget.driver_name || (finalTarget.self_drive ? 'ผู้ขอขับเอง' : 'เจ้าหน้าที่จัดให้') }}</div>
      </div>
      <div class="form-group">
        <label>ผู้โดยสาร</label>
        <div>{{ finalTarget.passenger_count || 0 }} คน</div>
      </div>
      <div class="form-group">
        <label>สถานที่ไปราชการ</label>
        <div>{{ finalTarget.destination || '-' }}</div>
      </div>
      <div class="form-group">
        <label>ผู้จอง</label>
        <div>{{ UI.personName(finalTarget) }}</div>
      </div>
      <div class="form-group full">
        <label>วัตถุประสงค์</label>
        <div>{{ finalTarget.purpose }}</div>
      </div>
      <div class="form-group">
        <label>เชื้อเพลิง</label>
        <div>{{ finalTarget.fuel_choice || '-' }}</div>
      </div>
      <div v-if="finalTarget.fuel_project" class="form-group">
        <label>โครงการ</label>
        <div>{{ finalTarget.fuel_project }}</div>
      </div>
      <div v-if="finalTarget.fuel_activity" class="form-group">
        <label>กิจกรรม</label>
        <div>{{ finalTarget.fuel_activity }}</div>
      </div>
      <div v-if="Number(finalTarget.fuel_amount)" class="form-group">
        <label>จำนวนเงิน</label>
        <div>{{ Number(finalTarget.fuel_amount).toFixed(2) }} บาท</div>
      </div>
      <div class="form-group">
        <label>ขับรถเอง</label>
        <div>{{ finalTarget.self_drive ? '● ขออนุญาตเป็นผู้ขับรถ' : '-' }}</div>
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

  <!-- ---------- แก้ไขการจอง ---------- -->
  <AppModal v-if="editOpen" title="✎ แก้ไขการจองยานพาหนะ" size="lg" footer @close="editOpen = false">
    <div class="form-grid">
      <div class="form-group full">
        <label>ยานพาหนะ</label>
        <select id="vb-edit-vehicle" v-model="eb.vehicle_id">
          <option value="">🤝 มอบเจ้าหน้าที่จัดให้</option>
          <option v-for="v in vehicles" :key="v.id" :value="v.id">
            {{ v.name }} ({{ v.plate || '-' }}){{ v.status === 'maintenance' ? ' [ซ่อมบำรุง]' : '' }}
          </option>
        </select>
        <div class="hint">เปลี่ยนยานพาหนะได้ — ระบบจะเช็ควัน/เวลาที่แก้ไขว่าซ้อนกับรายการอื่นหรือไม่</div>
      </div>

      <div class="form-group">
        <label>ตั้งแต่วันที่</label>
        <ThaiDateField id="vb-edit-date-from" v-model="eb.date" />
      </div>
      <div class="form-group">
        <label>ตั้งแต่เวลา</label>
        <input id="vb-edit-time-from" v-model="eb.start_time" type="time" />
      </div>
      <div class="form-group">
        <label>ถึงวันที่</label>
        <ThaiDateField id="vb-edit-date-to" v-model="eb.date_to" />
      </div>
      <div class="form-group">
        <label>ถึงเวลา</label>
        <input id="vb-edit-time-to" v-model="eb.end_time" type="time" />
      </div>
      <div class="form-group">
        <label>รวม (วัน)</label>
        <input id="vb-edit-total" v-model.number="eb.total_days" type="number" min="1" readonly />
      </div>

      <div v-if="editConflict" class="form-group full" id="vb-edit-conflict">
        <div style="background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; border-radius: 10px; padding: 12px 14px">
          <div style="font-weight: 700; margin-bottom: 6px">⚠️ ยานพาหนะคันนี้ถูกจองไว้ก่อนแล้วในช่วงเวลาที่แก้ไข</div>
          <div>ผู้จอง: {{ editConflict.full_name }} • {{ editConflict.purpose }}</div>
        </div>
      </div>

      <div class="form-group full">
        <label>พนักงานขับรถ</label>
        <select id="vb-edit-driver" v-model="eb.driver_name">
          <option value="">— เลือกพนักงานขับรถ —</option>
          <option v-for="u in editUsers" :key="u.id" :value="UI.personName(u)">{{ UI.personName(u) }}</option>
        </select>
        <div class="hint">เปลี่ยนพนักงานขับรถได้ — ระบบจะแจ้งเตือนพนักงานขับรถเดิมและคนใหม่</div>
      </div>

      <div v-if="editTarget" class="form-group full">
        <label>ผู้จอง</label>
        <div>{{ UI.personName(editTarget) }}</div>
      </div>
      <div v-if="editTarget" class="form-group full">
        <label>ความคืบหน้าการอนุมัติ</label>
        <ApprovalSteps :record="editTarget" :level-names="LEVEL_NAMES" />
      </div>
    </div>

    <template #footer>
      <button class="btn btn-outline" :disabled="editSaving" @click="editOpen = false">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="editSaving || editConflict" @click="saveEditBooking">
        {{ editSaving ? 'กำลังบันทึก...' : '▽ บันทึกการแก้ไข' }}
      </button>
    </template>
  </AppModal>

  <!-- ---------- ฟอร์มยานพาหนะ ---------- -->
  <AppModal
    v-if="vFormOpen"
    :title="vf.id ? '✎ แก้ไขยานพาหนะ' : '+ เพิ่มยานพาหนะ'"
    footer
    @close="vFormOpen = false"
  >
    <div class="form-grid">
      <div class="form-group">
        <label>ชื่อยานพาหนะ <span class="req"> *</span></label>
        <input id="vf-name" v-model="vf.name" placeholder="เช่น รถตู้โดยสาร 12 ที่นั่ง" />
      </div>
      <div class="form-group">
        <label>ทะเบียน</label>
        <input id="vf-plate" v-model="vf.plate" placeholder="เช่น กฉ 1234 แพร่" />
      </div>
      <div class="form-group">
        <label>ประเภท</label>
        <input id="vf-type" v-model="vf.type" placeholder="เช่น รถตู้ / รถยนต์ / รถกระบะ" />
      </div>
      <div class="form-group">
        <label>จำนวนที่นั่ง</label>
        <input id="vf-cap" v-model.number="vf.capacity" type="number" min="1" />
      </div>
      <div class="form-group">
        <label>สถานะ</label>
        <select id="vf-status" v-model="vf.status">
          <option value="available">พร้อมใช้</option>
          <option value="maintenance">ซ่อมบำรุง</option>
        </select>
      </div>

      <div class="form-group full">
        <label>รูปภาพยานพาหนะ</label>
        <div id="vf-photo-wrap">
          <div class="file-preview">
            <img
              v-if="vPhoto || (vf.photo && !vRemovePhoto)"
              class="preview-thumb"
              :src="vPhoto ? vPhotoUrl : '/uploads/' + UI.encodePath(vf.photo)"
              alt="preview"
            />
          </div>
          <input
            id="vf-photo"
            type="file"
            accept="image/*"
            @change="vPhoto = $event.target.files[0] || null; vRemovePhoto = false"
          />
          <div class="hint">
            {{ vf.photo && !vRemovePhoto ? 'รูปปัจจุบันแสดงด้านบน — เลือกไฟล์เพื่อแทนที่ หรือกดปุ่มลบรูปด้านล่าง' : 'ไฟล์ภาพ (jpg, png, gif, webp)' }}
          </div>
          <button
            v-if="vf.photo && !vPhoto"
            class="btn btn-outline btn-sm"
            id="vf-photo-clear"
            style="margin-top: 6px"
            @click="vRemovePhoto = true"
          >
            ✕ ลบรูปภาพ
          </button>
        </div>
      </div>

      <div class="form-group full">
        <label>หมายเหตุ</label>
        <input id="vf-notes" v-model="vf.notes" />
      </div>
    </div>

    <template #footer>
      <button class="btn btn-outline" :disabled="vSaving" @click="vFormOpen = false">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="vSaving" @click="saveVehicle">
        {{ vSaving ? 'กำลังบันทึก...' : '▽ บันทึก' }}
      </button>
    </template>
  </AppModal>

  <!-- ---------- ผู้อนุมัติยานพาหนะ ---------- -->
  <AppModal
    v-if="apprOpen"
    title="+ เพิ่มเจ้าหน้าที่ (สิทธิ์อนุมัติการจองห้องประชุม/ยานพาหนะ)"
    size="lg"
    footer
    @close="apprOpen = false"
  >
    <p class="hint" style="margin-bottom: 12px">
      เลือกเจ้าหน้าที่และกำหนดสิทธิ์การอนุมัติ — ผู้อนุมัติขั้นต้น (ขั้นที่ 1) และ ผู้อนุมัติ
      (ขั้นสุดท้าย) ใช้ร่วมกันทั้งการจองยานพาหนะและจองห้องประชุม ผู้ดูแลระบบมีสิทธิ์ครบทุกขั้นอยู่แล้ว
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
          <tr v-for="u in apprStaff" :key="u.id">
            <td>{{ UI.personName(u) }}</td>
            <td>{{ u.position || '-' }}</td>
            <td style="text-align: center"><input v-model="apprL1" class="va-l1" type="checkbox" :value="u.id" /></td>
            <td style="text-align: center"><input v-model="apprL2" class="va-l2" type="checkbox" :value="u.id" /></td>
          </tr>
        </tbody>
      </table>
    </div>

    <template #footer>
      <button class="btn btn-outline" :disabled="apprSaving" @click="apprOpen = false">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="apprSaving" @click="saveApprovers">
        {{ apprSaving ? 'กำลังบันทึก...' : '▽ บันทึกสิทธิ์' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของระบบเดิมทั้งหมด */

/*
 * รูปยานพาหนะในคอลั่ม "รูป" ของรายการยานพาหนะ
 *
 * ปัญหาเดิม 2 ชั้น ต้องแก้ทั้งสองชั้นถึงจะพอดี
 *
 * 1. theme.css ตั้ง .vehicle-thumb { position:absolute; width:100%; height:100%; object-fit:cover }
 *    คือยืดภาพให้เต็มช่องแล้ว "ตัดส่วนที่เกินออก" ทิ้ง
 *    ช่องสูงแค่ ~49px รูปแนวนอนจึงถูกตัดทิ้งราว 1 ใน 3 มองไม่ออกว่าเป็นรถคันไหน
 *
 * 2. พอเปลี่ยนเป็น contain แล้ว รูปก็ไม่ถูกตัด แต่กลับเหลือ "พื้นที่ว่าง" แทน
 *    เพราะรูปกว้างกว่าช่องสูงมาก พอ scale ให้สูงเต็มช่อง ด้านข้างเหลือคนละ ~22px
 *    ขณะที่ .vehicle-thumb-cell ยังบังคับ min-width:100px ไว้
 *    ผลคือคอลั่มกว้าง 120px แต่ตัวรูปจริงแค่ 76px เหลือพื้นเทาว่างสองข้าง
 *
 * วิธีแก้: ให้รูปกำหนดความกว้างคอลั่มเอง แทนที่จะไปขยายช่องแล้วค่อยจัดรูปให้พอดี
 *   - ถอด position:absolute ออก ให้รูปไหลตามปกติแล้วค่อยจำกัดขนาดด้วย max-*
 *   - ถอด min-width ของช่องออก คอลั่มจะหดตามความกว้างรูปที่กว้างที่สุดในคอลั่ม
 *   - เก็บ object-fit:contain ไว้ เผื่อมีรูปแนวตั้งหรือสี่เหลี่ยมที่กว้างเกิน
 *     รูปจะย่อตัวให้พอดีช่องโดยไม่ถูกตัด
 *
 * ผลกับรูปจริงในระบบ (500x320 = อัตราส่วน 1.56)
 *   ก่อน: คอลั่ม 120px · ตัวรูป 76px · เหลือว่างข้าง 22px ทั้งสองฝั่ง
 *   หลัง:  คอลั่ม 77px  · ตัวรูป 76px · เหลือว่างรวมไม่ถึง 1px
 *
 * ⚠️ แก้ที่นี่ ไม่แก้ theme.css เพราะไฟล์นั้นห้ามแตะ
 *    (verify-build เทียบ SHA256 กับ docs/legacy/source-v1/css/style.css)
 *    scoped ของ SFC เติม [data-v-xxx] เพิ่ม specificity จึงชนะเสมอ
 */

/* ถอด min-width ของ theme.css เพื่อให้คอลั่มหดตามรูป */
.vehicle-thumb-cell {
  min-width: 0;
  width: 1px;
}

img.vehicle-thumb {
  position: static;
  display: block;
  width: auto;
  height: auto;
  max-width: 160px;
  max-height: 52px;
  object-fit: contain;
  cursor: pointer;
}

/* ช่องที่ไม่มีรูป (🚐) — กำหนดความสูงเท่ากันเพื่อให้ทุกแถวสูงเท่ากัน */
.vehicle-thumb.ph {
  position: static;
  display: flex;
  align-items: center;
  justify-content: center;
  width: auto;
  height: 52px;
  min-width: 52px;
  cursor: default;
}
</style>
