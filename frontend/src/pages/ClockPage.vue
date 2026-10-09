<script setup>
/**
 * ClockPage — เมนู 4: ลงเวลาทำงาน
 *
 * Phase 4: เขียนใหม่เป็น Vue component
 * (เดิมเป็น src/views/ClockView.js แบบ UI.h() — 560 บรรทัด)
 *
 * ฟีเจอร์เท่าเดิมทุกอย่าง:
 *   - นาฬิกาเรียงเวลาจริง + สถานะวันนี้ + ปุ่มลงเวลาเข้า/ออก
 *   - ตรวจตำแหน่ง: มือถือ/แท็บเล็ต → GPS · คอมพิวเตอร์/แล็ปท็อป → IP
 *     พร้อมข้อความแจ้งเตือนแยกตามสาเหตุที่ระบุตำแหน่งไม่ได้
 *   - สิทธิ์ดูทั้งหมด: admin หรือผู้ได้รับสิทธิ์ (is_time_editor)
 *   - ภาพรวมวันนี้ 3 ช่อง · ตัวกรองเดือน (พ.ศ.) · แก้ไข/ลบบันทึก
 *   - รายงาน cascade ปี→เดือน→สัปดาห์→วัน + ดาวน์โหลด .xlsx + พิมพ์
 *   - admin: ตั้งค่าตำแหน่ง (GPS/IP) + เลือกผู้มีสิทธิ์แก้ไขเวลา
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import api from '../api/client.js';
import { UI } from '../ui/ui.js';
import { Auth } from '../stores/auth.js';
import AppModal from '../components/ui/AppModal.vue';

/* ---------- สิทธิ์ ---------- */
const canViewAll = computed(() => Auth.isAdmin() || !!(Auth.user && Auth.user.is_time_editor));

/* ---------- นาฬิกาเรียงเวลา ---------- */
const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const clockLoading = ref(true);
const clockError = ref('');
const today = ref('');
const record = ref(null);
const nowTime = ref('');
const nowDay = ref('');
const checking = ref(''); // '' | 'in' | 'out'
let clockTimer = null;

const checkedIn = computed(() => !!(record.value && record.value.clock_in));
const checkedOut = computed(() => !!(record.value && record.value.clock_out));

async function loadToday() {
  clockLoading.value = true;
  clockError.value = '';
  try {
    const data = await api.get('/time/today');
    record.value = data.record || null;
    today.value = data.today || '';
    const now = new Date();
    nowTime.value = now.toTimeString().slice(0, 8);
    nowDay.value = THAI_DAYS[now.getDay()];
  } catch (e) {
    clockError.value = e.message;
    record.value = null;
  } finally {
    clockLoading.value = false;
  }
}

/** ตรวจว่าอุปกรณ์ปัจจุบันเป็นมือถือ/แท็บเล็ต (ใช้ GPS) หรือคอมพิวเตอร์/แล็ปท็อป (ใช้ IP) */
function isMobileDevice() {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile|Tablet|Opera Mini|IEMobile|Silk/i.test(ua)) return true;
  return (
    typeof navigator.maxTouchPoints === 'number' &&
    navigator.maxTouchPoints > 0 &&
    window.matchMedia('(max-width: 1024px)').matches
  );
}

/** ข้อความแจ้งเตือนตามสาเหตุที่ระบุตำแหน่งไม่ได้ (ตามของเดิมทุกกรณี) */
function geoErrorMessage(e) {
  const code = e && e.code;
  if (e && e.message === 'NO_GEO') return 'เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง GPS';
  if (code === 1) return 'คุณไม่อนุญาตให้ระบบใช้ตำแหน่ง GPS — กรุณาอนุญาตตำแหน่งในเบราว์เซอร์';
  if (code === 2) return 'ไม่สามารถระบุตำแหน่ง GPS ได้ (สัญญาณดาวเทียมไม่ดี) — กรุณาลองใหม่';
  if (code === 3) return 'การระบุตำแหน่งใช้เวลานานเกินไป — กรุณาลองใหม่';
  return 'ไม่สามารถระบุตำแหน่ง GPS ได้ — กรุณาลองใหม่';
}

/** ลงเวลาพร้อมตรวจตำแหน่ง */
async function doCheck(type) {
  if (checking.value) return;
  checking.value = type;
  try {
    const device = isMobileDevice() ? 'mobile' : 'desktop';
    const payload = { type, device };
    if (device === 'mobile') {
      try {
        const pos = await new Promise((resolve, reject) => {
          if (!navigator.geolocation) return reject(new Error('NO_GEO'));
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 30000,
          });
        });
        payload.lat = pos.coords.latitude;
        payload.lng = pos.coords.longitude;
      } catch (e) {
        return UI.toast(geoErrorMessage(e), 'error');
      }
    }
    const res = await api.post('/time/check', payload);
    const hasWarn = res.warning && res.warning.length;
    UI.toast(hasWarn ? res.message + ' — ' + res.warning.join('; ') : res.message, hasWarn ? 'warning' : 'success');
    await loadToday();
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    checking.value = '';
  }
}

/* ---------- ภาพรวมวันนี้ ---------- */
const stats = ref(null);

/* ---------- ตารางบันทึกเวลา ---------- */
const tableLoading = ref(true);
const tableError = ref('');
const records = ref([]);
const canEditMine = ref(false);
/** เดือนที่เลือก (YYYY-MM ค.ศ.) */
const month = ref(new Date().toISOString().slice(0, 7));
/** 'all' = ทั้งหน่วยงาน · 'mine' = ของฉัน */
const scope = ref(canViewAll.value ? 'all' : 'mine');

const monthBE = computed(() => UI.isoToBEMonth(month.value));

async function loadRecords() {
  tableLoading.value = true;
  tableError.value = '';
  const m = UI.beMonthToISO(monthBE.value) || month.value;
  try {
    if (scope.value === 'all') {
      const data = await api.get('/time/all?month=' + encodeURIComponent(m));
      records.value = data.records || [];
      canEditMine.value = true;
    } else {
      const data = await api.get('/time/mine?month=' + encodeURIComponent(m));
      records.value = data.records || [];
      canEditMine.value = !!data.can_edit;
    }
  } catch (e) {
    tableError.value = e.message;
    records.value = [];
  } finally {
    tableLoading.value = false;
  }
}

/* ---------- แก้ไข / ลบบันทึกเวลา ---------- */
const editOpen = ref(false);
const editing = ref(null);
const editIn = ref('');
const editOut = ref('');
const editSaving = ref(false);

function openEdit(r) {
  editing.value = r;
  editIn.value = r.clock_in ? String(r.clock_in).slice(0, 5) : '';
  editOut.value = r.clock_out ? String(r.clock_out).slice(0, 5) : '';
  editOpen.value = true;
}

async function saveEdit() {
  if (!editing.value) return;
  editSaving.value = true;
  try {
    const res = await api.put(`/time/${editing.value.id}`, {
      clock_in: editIn.value || null,
      clock_out: editOut.value || null,
    });
    UI.toast(res.message);
    editOpen.value = false;
    await Promise.all([loadRecords(), loadToday()]);
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    editSaving.value = false;
  }
}

async function deleteRecord(r) {
  const yes = await UI.confirm(
    `ต้องการลบบันทึกเวลา ${UI.date(r.date)}${r.full_name ? ' ของ ' + UI.personName(r) : ''} ใช่หรือไม่?`,
    { danger: true, okText: 'ลบ' },
  );
  if (!yes) return;
  try {
    const res = await api.del(`/time/${r.id}`);
    UI.toast(res.message);
    await Promise.all([loadRecords(), loadToday()]);
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

/* ---------- รายงาน ---------- */
const reportOpen = ref(false);

// ปีที่ผู้ใช้เลือกใน dropdown เป็น พ.ศ. แต่ API (/time/report) รับวันที่เป็น ค.ศ.
// ต้องแปลงก่อนทุกครั้งที่เอาไปคำนวณด้วย Date หรือส่งไปที่ backend
const BE_OFFSET = 543;
/** พ.ศ. → ค.ศ. */
const beToCe = (yBE) => Number(yBE) - BE_OFFSET;

// ค่าเริ่มต้องเป็นปี พ.ศ. ปัจจุบัน ไม่ใช่ ค.ศ.
// เดิมใช้ getFullYear() ตรง ๆ ได้ค.ศ. (เช่น 2026) ซึ่งไม่ตรงกับตัวเลือกใน dropdown
// ที่เป็น พ.ศ. (2564-2570) → ช่องเลือกปีจะไม่ตรงกับค่าใดเลย
const rp = ref({ year: String(new Date().getFullYear() + BE_OFFSET), month: '', week: '', day: '' });
const reportLoading = ref(false);
const reportError = ref('');
const report = ref(null);

const pad2 = (n) => String(n).padStart(2, '0');
const thShort = (mm, dd) => `${dd} ${MONTHS[mm - 1].slice(0, 3)}.`;

/** ปี พ.ศ. ที่เลือกได้: ปีปัจจุบัน + ย้อนหลัง 5 ปี + ปีถัดไป 1 ปี */
const reportYears = computed(() => {
  const y = new Date().getFullYear();
  const out = [];
  for (let i = y + 1; i >= y - 5; i--) out.push(String(i + 543));
  return out;
});

/** สัปดาห์ (จันทร์-อาทิตย์) ของเดือน/ปีที่เลือก */
const reportWeeks = computed(() => {
  if (!rp.value.month) return [];
  const y = beToCe(rp.value.year); // พ.ศ. → ค.ศ. ก่อนคำนวณวันที่
  const mo = Number(rp.value.month);
  const lastDay = new Date(y, mo, 0).getDate();
  const dow1 = (new Date(y, mo - 1, 1).getDay() + 6) % 7; // จันทร์ = 0
  const out = [];
  let start = 1 - dow1;
  let n = 1;
  while (start <= lastDay) {
    const end = start + 6;
    const sD = new Date(y, mo - 1, start);
    const eD = new Date(y, mo - 1, end);
    const sOk = start >= 1;
    const eOk = end <= lastDay;
    let label;
    if (sOk && eOk) label = `สัปดาห์ที่ ${n} (${sD.getDate()} - ${eD.getDate()} ${MONTHS[mo - 1].slice(0, 3)}.)`;
    else if (!sOk && eOk) label = `สัปดาห์ที่ ${n} (ถึง ${eD.getDate()} ${MONTHS[mo - 1].slice(0, 3)}.)`;
    else if (sOk && !eOk) label = `สัปดาห์ที่ ${n} (${sD.getDate()} ${MONTHS[mo - 1].slice(0, 3)}. ถึงสิ้นเดือน)`;
    else label = `สัปดาห์ที่ ${n}`;
    out.push({ value: `${y}-${pad2(mo)}-${pad2(Math.max(start, 1))}`, label });
    start += 7;
    n++;
  }
  return out;
});

/** วัน: ถ้าเลือกสัปดาห์ → 7 วันในสัปดาห์นั้น · ไม่เลือก → ทุกวันในเดือน */
const reportDays = computed(() => {
  if (!rp.value.month) return [];
  const y = beToCe(rp.value.year); // พ.ศ. → ค.ศ. ก่อนคำนวณวันที่
  const mo = Number(rp.value.month);
  const names = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
  if (rp.value.week) {
    const s = new Date(y, mo - 1, Number(rp.value.week.slice(8, 10)));
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i);
      out.push({
        value: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
        label: `${names[i]} ${thShort(d.getMonth() + 1, d.getDate())}`,
      });
    }
    return out;
  }
  const daysIn = new Date(y, mo, 0).getDate();
  const out = [];
  for (let d = 1; d <= daysIn; d++) out.push({ value: String(d), label: String(d) });
  return out;
});

/** cascade: เปลี่ยนปี → ล้างเดือน/สัปดาห์/วัน · เปลี่ยนเดือน → ล้างสัปดาห์/วัน */
function onYearChange() {
  rp.value.month = '';
  rp.value.week = '';
  rp.value.day = '';
}
function onMonthChange() {
  rp.value.week = '';
  rp.value.day = '';
}
function onWeekChange() {
  rp.value.day = '';
}

/** เลือก period/date จากค่าที่เลือก — ส่งไปเป็น ค.ศ. ตามที่ API คาดหวัง */
function reportQuery() {
  const y = beToCe(rp.value.year); // พ.ศ. → ค.ศ.
  const mo = rp.value.month;
  const wk = rp.value.week;
  const d = rp.value.day;
  if (mo && wk && d) return { period: 'day', date: d };
  if (mo && wk) return { period: 'week', date: wk };
  if (mo && d) return { period: 'day', date: `${y}-${pad2(mo)}-${pad2(d)}` };
  if (mo) return { period: 'month', date: `${y}-${pad2(mo)}` };
  return { period: 'year', date: y };
}

const reportKind = computed(() => {
  const p = reportQuery().period;
  return p === 'day' ? 'รายวัน' : p === 'week' ? 'รายสัปดาห์' : p === 'month' ? 'รายเดือน' : 'รายปี';
});

async function loadReport() {
  const { period, date } = reportQuery();
  reportLoading.value = true;
  reportError.value = '';
  report.value = null;
  try {
    const data = await api.get('/time/report?period=' + encodeURIComponent(period) + '&date=' + encodeURIComponent(date));
    report.value = data;
  } catch (e) {
    reportError.value = e.message;
  } finally {
    reportLoading.value = false;
  }
}

function downloadXlsx() {
  const { period, date } = reportQuery();
  window.open(
    '/api/time/report.xlsx?period=' + encodeURIComponent(period) + '&date=' + encodeURIComponent(date),
    '_blank',
  );
}

/* ---------- admin: ตั้งค่าตำแหน่งที่ทำงาน ---------- */
const locOpen = ref(false);
const locSaving = ref(false);
const locBusy = ref(false);
const loc = ref({ enabled: true, lat: null, lng: null, radius: 200, ips: '' });

async function openLocationSettings() {
  try {
    const cfg = await api.get('/time/location-settings');
    loc.value = { enabled: cfg.enabled !== false, lat: cfg.lat ?? null, lng: cfg.lng ?? null, radius: cfg.radius ?? 200, ips: cfg.ips || '' };
  } catch (e) {
    return UI.toast(e.message, 'error');
  }
  locOpen.value = true;
}

/** ดึงตำแหน่งปัจจุบันมาใส่ช่อง (ตามของเดิม) */
function useMyPosition() {
  if (!navigator.geolocation) return UI.toast('เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง GPS', 'error');
  locBusy.value = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      loc.value.lat = pos.coords.latitude;
      loc.value.lng = pos.coords.longitude;
      locBusy.value = false;
      UI.toast('ดึงตำแหน่งปัจจุบันมาใส่แล้ว — กดบันทึกเพื่อใช้งาน');
    },
    (e) => {
      locBusy.value = false;
      UI.toast(e && e.code === 1 ? 'คุณไม่อนุญาตให้ใช้ตำแหน่ง GPS' : 'ไม่สามารถระบุตำแหน่ง GPS ได้ — กรุณาใส่พิกัดเอง', 'error');
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

async function saveLocationSettings() {
  locSaving.value = true;
  try {
    const res = await api.put('/time/location-settings', {
      enabled: loc.value.enabled,
      lat: loc.value.lat,
      lng: loc.value.lng,
      radius: loc.value.radius,
      ips: loc.value.ips,
    });
    UI.toast(res.message);
    locOpen.value = false;
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    locSaving.value = false;
  }
}

/* ---------- admin: ผู้มีสิทธิ์แก้ไขเวลา ---------- */
const editorsOpen = ref(false);
const editorsSaving = ref(false);
const editorsLoading = ref(false);
const editors = ref([]);
const editorsChecked = ref([]);

async function openEditors() {
  editorsLoading.value = true;
  try {
    const [editorsData, staffData] = await Promise.all([api.get('/time/editors'), api.get('/staff?status=active')]);
    editors.value = staffData.staff || [];
    editorsChecked.value = (editorsData.ids || []).map(Number);
  } catch (e) {
    UI.toast(e.message, 'error');
    editorsLoading.value = false;
    return;
  }
  editorsLoading.value = false;
  editorsOpen.value = true;
}

async function saveEditors() {
  editorsSaving.value = true;
  try {
    const res = await api.put('/time/editors', { user_ids: editorsChecked.value });
    UI.toast(res.message);
    editorsOpen.value = false;
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    editorsSaving.value = false;
  }
}

onMounted(async () => {
  await loadToday();
  await loadRecords();

  // นาฬิกาเดินทุกวินาที
  clockTimer = setInterval(() => {
    if (document.getElementById('clock-now')) nowTime.value = new Date().toTimeString().slice(0, 8);
  }, 1000);

  if (canViewAll.value) {
    try {
      stats.value = await api.get('/time/stats');
    } catch (e) {
      /* ignore */
    }
  }
});

onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer);
});
</script>

<template>
  <div class="page-head">
    <div>
      <div class="page-title"><span class="pi">⏰</span>ลงเวลาทำงาน</div>
      <div class="page-desc">ลงเวลาเข้างานและออกงานประจำวัน</div>
    </div>
  </div>

  <!-- ---------- กล่องลงเวลา ---------- -->
  <div class="card">
    <div v-if="clockLoading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
    <div v-else-if="clockError" class="empty-state"><span class="em">⚠️</span>{{ clockError }}</div>
    <div v-else class="clock-box">
      <div id="clock-now" class="clock-time">{{ nowTime }}</div>
      <div class="clock-date">{{ UI.thaiDate(today) }} • {{ nowDay }}</div>
      <div style="margin-bottom: 14px">
        <span
          v-if="record"
          class="status-pill"
          :style="{
            background: record.clock_out ? '#e2e8f0' : '#dcfce7',
            color: record.clock_out ? '#64748b' : '#15803d',
            padding: '4px 14px',
            borderRadius: '999px',
            fontWeight: 700,
          }"
        >
          {{
            record.clock_out
              ? `● ลงเวลาครบแล้ววันนี้ (เข้า ${UI.time(record.clock_in)} • ออก ${UI.time(record.clock_out)})`
              : `◷ เข้างานแล้วเมื่อ ${UI.time(record.clock_in)} — อย่าลืมลงเวลาออกงาน`
          }}
        </span>
        <span
          v-else
          class="status-pill"
          style="background: #fef3c7; color: #b45309; padding: 4px 14px; border-radius: 999px; font-weight: 700"
        >
          ยังไม่ได้ลงเวลาเข้างานวันนี้
        </span>
      </div>
      <div class="clock-btns">
        <button
          class="btn btn-primary clock-btn"
          :disabled="checkedIn || checking === 'in'"
          @click="doCheck('in')"
        >
          {{ checking === 'in' ? '📡 กำลังตรวจสอบตำแหน่ง...' : '⬡ ลงเวลาเข้างาน' }}
        </button>
        <button
          class="btn btn-accent clock-btn"
          :disabled="!checkedIn || checkedOut || checking === 'out'"
          @click="doCheck('out')"
        >
          {{ checking === 'out' ? '📡 กำลังตรวจสอบตำแหน่ง...' : '🏁 ลงเวลาออกงาน' }}
        </button>
      </div>
    </div>
  </div>

  <!-- ---------- ภาพรวมวันนี้ (เฉพาะผู้ดูทั้งหมด) ---------- -->
  <div v-if="canViewAll && stats" class="card">
    <div class="card-title">📊 ภาพรวมการลงเวลาวันนี้</div>
    <div class="stat-grid" style="margin-bottom: 0">
      <div class="stat-card">
        <div class="stat-icon" style="background: var(--primary-light)">🧑‍▭</div>
        <div>
          <div class="stat-value">{{ stats.activeUsers }}</div>
          <div class="stat-label">เจ้าหน้าที่ทั้งหมด</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: var(--primary-light)">●</div>
        <div>
          <div class="stat-value">{{ stats.checkedIn }}</div>
          <div class="stat-label">ลงเวลาเข้างานแล้ว</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: var(--primary-light)">🏁</div>
        <div>
          <div class="stat-value">{{ stats.checkedOut }}</div>
          <div class="stat-label">ลงเวลาออกงานแล้ว</div>
        </div>
      </div>
    </div>
  </div>

  <!-- ---------- ตัวกรอง ---------- -->
  <div class="filter-row">
    <input
      id="clock-month"
      :value="monthBE"
      type="text"
      inputmode="numeric"
      placeholder="ดด/ปปปป (พ.ศ.)"
      style="min-width: 130px"
      @change="month = UI.beMonthToISO($event.target.value) || month; loadRecords()"
    />
    <button class="btn btn-outline btn-sm" @click="loadRecords">⊕ แสดงข้อมูล</button>
    <button v-if="canViewAll" class="btn btn-info btn-sm" @click="reportOpen = true">📊 รายงาน</button>
    <div v-if="Auth.isAdmin()" style="display: flex; gap: 8px">
      <button class="btn btn-primary btn-sm" @click="openEditors">+ เพิ่มเจ้าหน้าที่</button>
      <button class="btn btn-outline btn-sm" @click="openLocationSettings">📍 ตั้งค่าตำแหน่งที่ทำงาน</button>
    </div>
    <span v-else-if="canViewAll" class="hint" style="margin-left: auto">คุณมีสิทธิ์แก้ไข/ดูบันทึกเวลาทั้งหมด</span>
  </div>

  <!-- ---------- ตารางบันทึกเวลา ---------- -->
  <div class="card">
    <div v-if="tableLoading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
    <div v-else-if="tableError" class="empty-state"><span class="em">⚠️</span>{{ tableError }}</div>
    <div v-else-if="records.length === 0" class="empty-state">
      <span class="em">🗓️</span>ยังไม่มีข้อมูลการลงเวลาในเดือนนี้
    </div>

    <template v-else>
      <div class="card-title">
        ▭ {{ scope === 'all' ? 'บันทึกเวลาทำงานของเจ้าหน้าที่' : 'บันทึกเวลาของฉัน (' + monthBE + ')' }}
      </div>
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>วันที่</th>
              <th v-if="scope === 'all'">ชื่อ-นามสกุล</th>
              <th v-if="scope === 'all'">กลุ่มงาน</th>
              <th>เวลาเข้า</th>
              <th>เวลาออก</th>
              <th v-if="scope === 'all' || canEditMine"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in records" :key="r.id">
              <td>{{ UI.date(r.date) }}</td>
              <td v-if="scope === 'all'">{{ UI.personName(r) }}</td>
              <td v-if="scope === 'all'">{{ r.workplace }}</td>
              <td>{{ UI.time(r.clock_in) }}</td>
              <td>{{ UI.time(r.clock_out) }}</td>
              <td v-if="scope === 'all' || canEditMine">
                <div style="display: inline-flex; gap: 6px">
                  <button class="btn btn-xs btn-outline" title="แก้ไขเวลา" @click="openEdit(r)">✎</button>
                  <button class="btn btn-xs btn-danger" title="ลบบันทึกเวลา" @click="deleteRecord(r)">✕</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>

  <!-- ---------- แก้ไขเวลาลงเวลา ---------- -->
  <AppModal v-if="editOpen" title="✎ แก้ไขเวลาลงเวลา" footer @close="editOpen = false">
    <p class="hint" style="margin-bottom: 12px">
      แก้ไขเวลาลงเวลา {{ UI.date(editing.date) }}{{ editing.full_name ? ' • ' + UI.personName(editing) : '' }}
    </p>
    <div class="form-row">
      <div class="form-group" style="flex: 1">
        <label>เวลาเข้างาน</label>
        <input id="tt-in" v-model="editIn" type="time" />
      </div>
      <div class="form-group" style="flex: 1">
        <label>เวลาออกงาน</label>
        <input id="tt-out" v-model="editOut" type="time" />
      </div>
    </div>

    <template #footer>
      <button class="btn btn-danger" :disabled="editSaving" @click="deleteRecord(editing); editOpen = false">✕ ลบ</button>
      <button class="btn btn-outline" :disabled="editSaving" @click="editOpen = false">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="editSaving" @click="saveEdit">
        {{ editSaving ? 'กำลังบันทึก...' : '▽ บันทึก' }}
      </button>
    </template>
  </AppModal>

  <!-- ---------- รายงาน ---------- -->
  <AppModal v-if="reportOpen" title="📊 รายงานการลงเวลาทำงาน" size="lg" footer @close="reportOpen = false">
    <div class="form-row" style="align-items: flex-end">
      <div class="form-group" style="flex: 1">
        <label>เลือกปี พ.ศ.</label>
        <select id="rp-year" v-model="rp.year" @change="onYearChange">
          <option v-for="y in reportYears" :key="y" :value="y">{{ y }}</option>
        </select>
      </div>
      <div class="form-group" style="flex: 1">
        <label>เลือกเดือน</label>
        <select id="rp-month" v-model="rp.month" @change="onMonthChange">
          <option value="">ทุกเดือน</option>
          <option v-for="(m, i) in MONTHS" :key="i" :value="String(i + 1)">{{ m }}</option>
        </select>
      </div>
      <div v-if="rp.month" class="form-group" style="flex: 1">
        <label>เลือกสัปดาห์</label>
        <select id="rp-week" v-model="rp.week" @change="onWeekChange">
          <option value="">ทุกสัปดาห์</option>
          <option v-for="w in reportWeeks" :key="w.value" :value="w.value">{{ w.label }}</option>
        </select>
      </div>
      <div v-if="rp.month" class="form-group" style="flex: 1">
        <label>เลือกวัน</label>
        <select id="rp-day" v-model="rp.day">
          <option value="">ทุกวัน</option>
          <option v-for="d in reportDays" :key="d.value" :value="d.value">{{ d.label }}</option>
        </select>
      </div>
      <button class="btn btn-primary" @click="loadReport">⊕ แสดงรายงาน</button>
    </div>

    <div style="margin-top: 14px">
      <div v-if="reportLoading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
      <div v-else-if="reportError" class="empty-state"><span class="em">⚠️</span>{{ reportError }}</div>
      <div v-else-if="!report" class="empty-state"><span class="em">📊</span>เลือกปี พ.ศ. แล้วกด “แสดงรายงาน”</div>
      <template v-else>
        <div class="card-title" style="margin-bottom: 10px">รายงาน {{ reportKind }} — {{ report.range.label }}</div>
        <div v-if="!report.records.length" class="empty-state">
          <span class="em">🗓️</span>ไม่มีข้อมูลการลงเวลาในช่วงเวลานี้
        </div>
        <div v-else class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>วันที่</th>
                <th>ชื่อ-นามสกุล</th>
                <th>ตำแหน่ง</th>
                <th>กลุ่มงาน</th>
                <th>เวลาเข้า</th>
                <th>เวลาออก</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in report.records" :key="i">
                <td>{{ UI.date(r.date) }}</td>
                <td>{{ UI.personName(r) }}</td>
                <td>{{ r.position }}</td>
                <td>{{ r.workplace }}</td>
                <td>{{ UI.time(r.clock_in) }}</td>
                <td>{{ UI.time(r.clock_out) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>

    <template #footer>
      <button class="btn btn-outline" @click="reportOpen = false">ปิด</button>
      <button id="rp-xlsx" class="btn btn-info" @click="downloadXlsx">⬇️ ดาวน์โหลด .xlsx</button>
      <button class="btn btn-accent" @click="window.print()">⬢ พิมพ์</button>
    </template>
  </AppModal>

  <!-- ---------- ตั้งค่าตำแหน่งที่ทำงาน ---------- -->
  <AppModal v-if="locOpen" title="📍 ตั้งค่าตำแหน่งที่ทำงาน (การลงเวลา)" size="lg" footer @close="locOpen = false">
    <p class="hint" style="margin-bottom: 12px">
      มือถือ/แท็บเล็ต ตรวจด้วย GPS ของอุปกรณ์ว่าอยู่ในรัศมีที่กำหนด ส่วนคอมพิวเตอร์/แล็ปท็อป
      ตรวจด้วย IP อินเทอร์เน็ตของที่ทำงาน — หากไม่อยู่ในพื้นที่/IP ที่กำหนดจะลงเวลาไม่ได้
    </p>

    <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 14px; cursor: pointer; width: fit-content">
      <input id="cg-enabled" v-model="loc.enabled" type="checkbox" />
      <span style="white-space: nowrap">เปิดใช้การตรวจสอบตำแหน่งการลงเวลา (ถ้าปิด จะไม่ตรวจตำแหน่งใด ๆ)</span>
    </label>

    <div class="form-row" style="align-items: flex-end">
      <div class="form-group" style="flex: 1">
        <label>ละติจูด (Latitude)</label>
        <input id="cg-lat" v-model.number="loc.lat" type="number" step="any" placeholder="เช่น 18.1442" />
      </div>
      <div class="form-group" style="flex: 1">
        <label>ลองติจูด (Longitude)</label>
        <input id="cg-lng" v-model.number="loc.lng" type="number" step="any" placeholder="เช่น 100.1526" />
      </div>
      <div class="form-group" style="width: 130px">
        <label>รัศมี (เมตร)</label>
        <input id="cg-radius" v-model.number="loc.radius" type="number" min="1" />
      </div>
      <div style="padding-bottom: 2px">
        <button class="btn btn-outline btn-sm" :disabled="locBusy" @click="useMyPosition">
          {{ locBusy ? '📡 กำลังระบุตำแหน่ง...' : '📡 ใช้ตำแหน่งปัจจุบันของฉัน' }}
        </button>
      </div>
    </div>

    <div class="form-group" style="margin-top: 12px">
      <label>IP อินเทอร์เน็ตของที่ทำงาน (คอมพิวเตอร์/แล็ปท็อป) — คั่นด้วยเครื่องหมายจุลภาค , รองรับ prefix เช่น 192.168.1.</label>
      <input id="cg-ips" v-model="loc.ips" type="text" placeholder="เช่น 192.168.1.0, 10.0.0." />
    </div>

    <template #footer>
      <button class="btn btn-outline" :disabled="locSaving" @click="locOpen = false">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="locSaving" @click="saveLocationSettings">
        {{ locSaving ? 'กำลังบันทึก...' : '▽ บันทึก' }}
      </button>
    </template>
  </AppModal>

  <!-- ---------- เลือกผู้มีสิทธิ์แก้ไขเวลา ---------- -->
  <AppModal
    v-if="editorsOpen"
    title="+ เพิ่มเจ้าหน้าที่ (สิทธิ์แก้ไขเวลาลงเวลา)"
    size="lg"
    footer
    @close="editorsOpen = false"
  >
    <div v-if="editorsLoading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
    <template v-else>
      <p class="hint" style="margin-bottom: 12px">
        เลือกเจ้าหน้าที่ที่ต้องการให้สิทธิ์เห็นปุ่มแก้ไขเวลา/ลบบันทึกในหน้าลงเวลาทำงาน
        (ผู้ดูแลระบบมีสิทธิ์อยู่แล้ว)
      </p>
      <div style="max-height: 320px; overflow-y: auto; border: 1px solid var(--border); border-radius: 10px; padding: 8px">
        <label
          v-for="u in editors"
          :key="u.id"
          class="editor-opt"
          style="display: flex; align-items: center; gap: 10px; padding: 8px; cursor: pointer; border-radius: 8px"
        >
          <input v-model="editorsChecked" type="checkbox" :value="u.id" />
          <div>
            <div>{{ UI.personName(u) }}</div>
            <div class="hint">{{ u.position || '' }}{{ u.workplace ? ' • ' + u.workplace : '' }}</div>
          </div>
        </label>
      </div>
    </template>

    <template #footer>
      <button class="btn btn-outline" :disabled="editorsSaving" @click="editorsOpen = false">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="editorsSaving" @click="saveEditors">
        {{ editorsSaving ? 'กำลังบันทึก...' : '▽ บันทึกสิทธิ์' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของระบบเดิมทั้งหมด */
</style>
