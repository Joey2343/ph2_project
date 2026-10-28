<script setup>
/**
 * ClockPage — เมนู 4: ลงเวลาทำงาน
 *
 * Phase 4: เขียนใหม่เป็น Vue component
 * (เดิมเป็น src/views/ClockView.js แบบ UI.h() — 560 บรรทัด)
 *
 * ฟีเจอร์เท่าเดิมทุกอย่าง:
 *   - นาฬิกาเรียงเวลาจริง + สถานะวันนี้ + ปุ่มลงเวลาเข้า/ออก
 *   - ตรวจตำแหน่ง: ใช้ GPS ของอุปกรณ์เทียบกับพิกัดสถานที่ทำงาน (2 แห่ง)
 *     พร้อมข้อความแจ้งเตือนแยกตามสาเหตุที่ระบุตำแหน่งไม่ได้
 *   - สิทธิ์ดูทั้งหมด: admin หรือผู้ได้รับสิทธิ์ (is_time_editor)
 *   - ภาพรวมวันนี้ 3 ช่อง · ตัวกรองวันที่ (ปฏิทิน พ.ศ.) แสดงทีละวัน · แก้ไข/ลบบันทึก
 *   - รายงาน cascade ปี→เดือน→สัปดาห์→วัน + ดาวน์โหลด .xlsx + พิมพ์
 *   - admin: ตั้งค่าตำแหน่ง (พิกัด/รัศมี ของ 2 สถานที่) + เลือกผู้มีสิทธิ์แก้ไขเวลา
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import api from '../api/client.js';
import { UI } from '../ui/ui.js';
import { Auth } from '../stores/auth.js';
import AppModal from '../components/ui/AppModal.vue';
import ThaiDateField from '../components/ui/ThaiDateField.vue';
// ขอตำแหน่ง GPS + แปลงชื่อสถานที่ทำงาน — ใช้ร่วมกับการ์ดลงเวลาหน้าแรก (src/lib/clock-geo.js)
import { getPosition, geoErrorMessage, workSiteLabel } from '../lib/clock-geo.js';

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

/** ลงเวลาพร้อมตรวจตำแหน่ง (GPS เฉพาะเข้างาน — ออกงานไม่ต้องมีพิกัด) */
async function doCheck(type) {
  if (checking.value) return;
  checking.value = type;
  try {
    const payload = { type };
    // ตรวจพิกัดเฉพาะ "เข้างาน" (ออกงานไม่ต้องอ้างอิงพิกัด)
    if (type === 'in') {
      try {
        const pos = await getPosition();
        payload.lat = pos.coords.latitude;
        payload.lng = pos.coords.longitude;
      } catch (e) {
        return UI.toast(geoErrorMessage(e), 'error');
      }
    }
    const res = await api.post('/time/check', payload);
    const hasWarn = res.warning && res.warning.length;
    UI.toast(hasWarn ? res.message + ' — ' + res.warning.join('; ') : res.message, hasWarn ? 'warning' : 'success');
    await Promise.all([loadToday(), loadRecords(), loadStats()]);
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    checking.value = '';
  }
}

/* ---------- ภาพรวมวันนี้ ---------- */
const stats = ref(null);

async function loadStats() {
  if (!canViewAll.value) return;
  try {
    stats.value = await api.get('/time/stats');
  } catch (e) {
    /* ignore */
  }
}

/* ---------- ตารางบันทึกเวลา (แสดงวันเดียว) ---------- */
const tableLoading = ref(true);
const tableError = ref('');
const records = ref([]);
const canEditMine = ref(false);

/** วันนี้ตามเวลาท้องถิ่น (YYYY-MM-DD) — UI.today() คิดจาก UTC จึงใช้ไม่ได้ช่วงเช้ามืด */
function localTodayISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** วันที่เลือกจากปฏิทิน (YYYY-MM-DD ค.ศ.) — ค่าเริ่มต้นคือวันนี้ */
const day = ref(localTodayISO());
const dayLabel = computed(() => UI.thaiDate(day.value));
/** 'all' = ทั้งหน่วยงาน · 'mine' = ของฉัน */
const scope = ref(canViewAll.value ? 'all' : 'mine');

/*
 * เรียงจากใหม่ → เก่า
 *   · วันล่าสุดขึ้นก่อน (date เป็น string 'YYYY-MM-DD' เพราะ connection ตั้ง dateStrings: true)
 *   · วันเดียวกัน เรียงตามเวลาเข้าล่าสุดก่อน (คนที่ลงเวลาล่าสุดอยู่บนสุด)
 *   · แถวที่ยังไม่มีเวลาเข้า (clock_in ว่าง) ไปท้ายสุด
 */
function sortNewestFirst(rows) {
  return rows.slice().sort((a, b) => {
    const d1 = String(a.date || '');
    const d2 = String(b.date || '');
    if (d1 !== d2) return d2.localeCompare(d1);
    const t1 = String(a.clock_in || '');
    const t2 = String(b.clock_in || '');
    if (!t1 && !t2) return 0;
    if (!t1) return 1;
    if (!t2) return -1;
    return t2.localeCompare(t1);
  });
}

/** เลือกวันจากปฏิทิน → โหลดรายการของวันนั้น */
function onDayChange(iso) {
  day.value = iso || localTodayISO();
  loadRecords();
}

async function loadRecords() {
  tableLoading.value = true;
  tableError.value = '';
  const d = day.value || localTodayISO();
  try {
    if (scope.value === 'all') {
      const data = await api.get('/time/all?date=' + encodeURIComponent(d));
      records.value = sortNewestFirst(data.records || []);
      canEditMine.value = true;
    } else {
      const data = await api.get('/time/mine?date=' + encodeURIComponent(d));
      records.value = sortNewestFirst(data.records || []);
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
    await Promise.all([loadRecords(), loadToday(), loadStats()]);
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
    await Promise.all([loadRecords(), loadToday(), loadStats()]);
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
const locBusy = ref('');
/** ตำแหน่ง GPS ล่าสุดที่แอดมินกดดึงมา — ใช้แสดงระยะห่างจากแต่ละสถานที่ */
const locProbe = ref(null);
/**
 * สถานที่ทำงาน 2 แห่ง (ชื่อคงที่จาก backend)
 * แอดมินตั้งได้เฉพาะ ละติจูด · ลองติจูด · รัศมี
 */
const loc = ref({ enabled: true, sites: [] });

async function openLocationSettings() {
  try {
    const cfg = await api.get('/time/location-settings');
    loc.value = {
      enabled: cfg.enabled !== false,
      sites: (cfg.sites || []).map((s) => ({
        key: s.key,
        name: s.name,
        lat: s.lat ?? null,
        lng: s.lng ?? null,
        radius: s.radius ?? 200,
      })),
    };
  } catch (e) {
    return UI.toast(e.message, 'error');
  }
  locProbe.value = null;
  locOpen.value = true;
}

/** ระยะทาง (เมตร) ระหว่างพิกัด 2 จุด — ใช้สูตร Haversine เหมือนฝั่งเซิร์ฟเวอร์ */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** ระยะจากตำแหน่ง GPS ล่าสุดถึงสถานที่นี้ (null ถ้ายังไม่ได้ดึงตำแหน่ง/ยังไม่กรอกพิกัด) */
function siteDistance(site) {
  const p = locProbe.value;
  if (!p || site.lat === null || site.lng === null) return null;
  return Math.round(distanceMeters(p.lat, p.lng, Number(site.lat), Number(site.lng)));
}

/** ดึงตำแหน่งปัจจุบันมาใส่ช่องของสถานที่นั้น */
async function useMyPosition(site) {
  locBusy.value = site.key;
  try {
    const pos = await getPosition();
    site.lat = Number(pos.coords.latitude.toFixed(6));
    site.lng = Number(pos.coords.longitude.toFixed(6));
    locProbe.value = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    UI.toast(`ดึงตำแหน่งปัจจุบันมาใส่ "${site.name}" แล้ว — กดบันทึกเพื่อใช้งาน`);
  } catch (e) {
    UI.toast(geoErrorMessage(e), 'error');
  } finally {
    locBusy.value = '';
  }
}

async function saveLocationSettings() {
  // ตรวจฝั่งหน้าเว็บก่อน เพื่อให้เห็นข้อความตรงช่องที่ผิด
  // (ใช้ .find() ไม่ใช่ return ในลูป — return ในลูปจะออกจากฟังก์ชันทั้งตัว)
  const halfFilled = loc.value.sites.find((s) => {
    const hasLat = s.lat !== null && s.lat !== '';
    const hasLng = s.lng !== null && s.lng !== '';
    return hasLat !== hasLng;
  });
  if (halfFilled) {
    return UI.toast(`กรุณากรอกละติจูดและลองติจูดของ "${halfFilled.name}" ให้ครบทั้งคู่`, 'error');
  }
  locSaving.value = true;
  try {
    const res = await api.put('/time/location-settings', {
      enabled: loc.value.enabled,
      sites: loc.value.sites.map((s) => ({
        key: s.key,
        lat: s.lat === '' ? null : s.lat,
        lng: s.lng === '' ? null : s.lng,
        radius: s.radius,
      })),
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

/** ตำแหน่ง • กลุ่มงาน ของแต่ละคน — แสดงในบรรทัดเดียวกันกับชื่อ */
function editorMeta(u) {
  return [u.position, u.workplace].filter(Boolean).join(' • ');
}

onMounted(async () => {
  await loadToday();
  // ใช้ "วันนี้" ของเซิร์ฟเวอร์ (รองรับโหมดจำลองวันที่) เป็นค่าเริ่มต้นของตาราง
  if (today.value && today.value !== day.value) day.value = today.value;
  await loadRecords();

  // นาฬิกาเดินทุกวินาที
  clockTimer = setInterval(() => {
    if (document.getElementById('clock-now')) nowTime.value = new Date().toTimeString().slice(0, 8);
  }, 1000);

  await loadStats();
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
          class="btn clock-btn clock-btn-in"
          :class="{ 'clock-btn-blink': !checkedIn }"
          :disabled="checkedIn || checking === 'in'"
          @click="doCheck('in')"
        >
          {{ checking === 'in' ? '📡 กำลังตรวจสอบตำแหน่ง...' : '⬡ ลงเวลาเข้างาน' }}
        </button>
        <button
          class="btn clock-btn clock-btn-out"
          :class="{ 'clock-btn-blink': checkedIn && !checkedOut }"
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

  <!-- ---------- ตัวกรอง (ปฏิทินไทย เลือกได้ทีละวัน) ---------- -->
  <div class="filter-row">
    <div class="clock-day-picker">
      <ThaiDateField id="clock-day" :model-value="day" @update:model-value="onDayChange" />
    </div>
    <button class="btn btn-outline btn-sm" @click="loadRecords">⊕ แสดงข้อมูล</button>
    <button v-if="canViewAll" class="btn btn-info btn-sm" @click="reportOpen = true">📊 รายงาน</button>
    <div v-if="Auth.isAdmin()" style="display: flex; gap: 8px">
      <button class="btn btn-primary btn-sm" @click="openEditors">+ เพิ่มเจ้าหน้าที่</button>
      <button class="btn btn-outline btn-sm" @click="openLocationSettings">📍 ตั้งค่าตำแหน่งที่ทำงาน</button>
    </div>
    <span v-else-if="canViewAll" class="hint" style="margin-left: auto">คุณมีสิทธิ์แก้ไข/ดูบันทึกเวลาทั้งหมด</span>
  </div>

  <!-- ---------- ตารางบันทึกเวลา (เฉพาะวันที่เลือก) ---------- -->
  <div class="card">
    <div v-if="tableLoading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
    <div v-else-if="tableError" class="empty-state"><span class="em">⚠️</span>{{ tableError }}</div>
    <div v-else-if="records.length === 0" class="empty-state">
      <span class="em">🗓️</span>ยังไม่มีข้อมูลการลงเวลาในวันที่เลือก
    </div>

    <template v-else>
      <div class="card-title">
        ▭ {{ scope === 'all' ? 'บันทึกเวลาทำงานของเจ้าหน้าที่ (' + dayLabel + ')' : 'บันทึกเวลาของฉัน (' + dayLabel + ')' }}
      </div>
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>วันที่</th>
              <th v-if="scope === 'all'">ชื่อ-นามสกุล</th>
              <th v-if="scope === 'all'">กลุ่มงาน</th>
              <th>สถานที่ทำงาน</th>
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
              <td>{{ workSiteLabel(r) }}</td>
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
                <th>สถานที่ทำงาน</th>
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
                <td>{{ workSiteLabel(r) }}</td>
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
      ใช้ตำแหน่ง GPS ของอุปกรณ์ (มือถือ/แท็บเล็ต/คอมพิวเตอร์) ตรวจเฉพาะ <b>การลงเวลาเข้างาน</b>
      — ลงเวลาเข้าได้เมื่ออยู่ในรัศมีของสถานที่ใดสถานที่หนึ่งด้านล่าง
      (การลงเวลาออกงานไม่ตรวจตำแหน่ง)
    </p>

    <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 14px; cursor: pointer; width: fit-content">
      <input id="cg-enabled" v-model="loc.enabled" type="checkbox" />
      <span style="white-space: nowrap">เปิดใช้การตรวจสอบตำแหน่งการลงเวลา (ถ้าปิด จะไม่ตรวจตำแหน่งใด ๆ)</span>
    </label>

    <div v-for="(site, i) in loc.sites" :key="site.key" class="site-card">
      <div class="site-head">
        <span class="site-no">{{ i + 1 }}</span>
        <span class="site-name">{{ site.name }}</span>
        <span v-if="site.lat !== null && site.lng !== null" class="site-ok">✓ ตั้งพิกัดแล้ว</span>
        <span v-else class="site-todo">ยังไม่ได้ตั้งพิกัด</span>
      </div>

      <div class="form-row" style="align-items: flex-end">
        <div class="form-group" style="flex: 1">
          <label>ละติจูด (Latitude)</label>
          <input
            :id="'cg-site-' + site.key + '-lat'"
            v-model.number="site.lat"
            type="number"
            step="any"
            placeholder="เช่น 18.144200"
          />
        </div>
        <div class="form-group" style="flex: 1">
          <label>ลองติจูด (Longitude)</label>
          <input
            :id="'cg-site-' + site.key + '-lng'"
            v-model.number="site.lng"
            type="number"
            step="any"
            placeholder="เช่น 100.152600"
          />
        </div>
        <div class="form-group" style="width: 130px">
          <label>รัศมี (เมตร)</label>
          <input :id="'cg-site-' + site.key + '-radius'" v-model.number="site.radius" type="number" min="1" />
        </div>
        <div style="padding-bottom: 2px">
          <button class="btn btn-outline btn-sm" :disabled="!!locBusy" @click="useMyPosition(site)">
            {{ locBusy === site.key ? '📡 กำลังระบุตำแหน่ง...' : '📡 ใช้ตำแหน่งปัจจุบัน' }}
          </button>
        </div>
      </div>

      <div v-if="siteDistance(site) !== null" class="site-dist">
        ตำแหน่ง GPS ล่าสุดอยู่ห่างจากจุดนี้ <b>{{ siteDistance(site) }} เมตร</b>
        <template v-if="siteDistance(site) <= (site.radius || 0)"> — อยู่ในรัศมีที่ลงเวลาได้</template>
        <template v-else> — อยู่นอกรัศมี ({{ site.radius }} เมตร)</template>
      </div>
    </div>

    <p class="hint" style="margin-top: 10px">
      เคล็ดลับ: ไปยืนที่สถานที่นั้นแล้วกด "📡 ใช้ตำแหน่งปัจจุบัน" เพื่อให้พิกัดตรงที่สุด
      (GPS ในอาคารอาจคลาดเคลื่อนได้ 10–30 เมตร ควรตั้งรัศมีเผื่อไว้)
    </p>

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
      <div class="editor-list">
        <label v-for="u in editors" :key="u.id" class="editor-opt">
          <input v-model="editorsChecked" type="checkbox" :value="u.id" />
          <span class="editor-name">{{ UI.personName(u) }}</span>
          <span v-if="editorMeta(u)" class="editor-meta">{{ editorMeta(u) }}</span>
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

/* ช่องปฏิทินในแถบตัวกรอง — ให้กว้างเท่าช่องเดิม และซ่อนข้อความวันที่ที่ซ้ำกับในช่อง */
.clock-day-picker :deep(input) {
  min-width: 130px;
}
.clock-day-picker :deep(.hint) {
  display: none;
}

/*
 * รายชื่อผู้มีสิทธิ์แก้ไขเวลา — คนละ 1 บรรทัด มีเส้นคั่นบาง ๆ ระหว่างคน
 * เดิมชื่อกับตำแหน่ง/กลุ่มงานขึ้นคนละบรรทัด ทำให้รายการสูงและอ่านยาก
 */
.editor-list {
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
}
.editor-opt {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  text-align: left;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
}
.editor-opt:last-child {
  border-bottom: none;
}
.editor-opt:hover {
  background: var(--primary-light, #eef4ff);
}
/*
 * ⚠️ ต้องกำหนด width/height เอง — theme.css ตั้ง input ให้กว้าง 100%
 *    (กฎกลางของฟอร์ม) ทำให้ checkbox ยืดเต็มแถว แล้วชื่อ/ตำแหน่งถูกดันตกขอบ
 *    ห้ามแก้ theme.css → override ใน component เท่านั้น
 */
.editor-opt input[type='checkbox'] {
  flex: 0 0 16px;
  width: 16px;
  min-width: 16px;
  height: 16px;
  margin: 0;
  cursor: pointer;
}
.editor-name {
  flex: 0 0 auto;
  white-space: nowrap;
  line-height: 1.5;
}
.editor-meta {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--text-muted, #6b7280);
  font-size: 13px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/*
 * การ์ดสถานที่ทำงาน (กล่อง "ตั้งค่าตำแหน่งที่ทำงาน")
 * ────────────────────────────────────────────────
 * แยกเป็นการ์ดละสถานที่ เพื่อให้เห็นชัดว่าพิกัด/รัศมีชุดไหนเป็นของที่ไหน
 * (เดิมมีช่องเดียว ใส่ได้ชุดเดียว → ลงเวลาได้ที่ทำงานที่เดียว)
 */
.site-card {
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 10px;
  padding: 12px 14px 10px;
  margin-bottom: 10px;
  background: var(--surface-2, #f8fafc);
}
.site-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.site-no {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--primary, #0f766e);
  color: #fff;
  font-size: 12.5px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.site-name {
  font-weight: 700;
  line-height: 1.4;
}
.site-ok,
.site-todo {
  margin-left: auto;
  font-size: 12px;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 999px;
  white-space: nowrap;
}
.site-ok {
  background: #dcfce7;
  color: #15803d;
}
.site-todo {
  background: #fef3c7;
  color: #b45309;
}
.site-dist {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--text-muted, #6b7280);
}

/*
 * ปุ่มลงเวลาเข้า/ออกงาน
 * ─────────────────────
 * ขยายให้ใหญ่ขึ้นเล็กน้อย (เดิม 150px · 15.5px) เพื่อให้กดง่ายและเห็นชัด
 * สี: เข้างาน = เขียวอ่อน · ออกงาน = ส้ม
 * กระพริบช้า ๆ เฉพาะปุ่มที่ "ต้องกดเป็นลำดับถัดไป"
 *   ยังไม่เข้างาน   → ปุ่มเข้างานกระพริบ
 *   เข้างานแล้ว     → ปุ่มออกงานกระพริบ (ปุ่มเข้างานถูกปิดใช้งาน)
 *   ครบทั้งวันแล้ว  → ไม่กระพริบทั้งคู่
 * ⚠️ ห้ามแก้ theme.css → override เฉพาะใน component นี้
 */
.clock-btn {
  width: auto;
  min-width: 190px;
  padding: 18px 26px;
  font-size: 17px;
  border-radius: 14px;
}
.clock-btn-in {
  background: #dcfce7;
  border: 1px solid #86efac;
  color: #15803d;
}
.clock-btn-in:hover:not(:disabled) {
  background: #bbf7d0;
  box-shadow: 0 4px 12px rgba(21, 128, 61, 0.25);
}
.clock-btn-out {
  background: #f97316;
  border: 1px solid #ea580c;
  color: #fff;
}
.clock-btn-out:hover:not(:disabled) {
  background: #ea580c;
  box-shadow: 0 4px 12px rgba(249, 115, 22, 0.35);
}
.clock-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  animation: none; /* ปิดใช้งานแล้วต้องไม่กระพริบให้สับสน */
}
.clock-btn-blink {
  animation: clock-blink 1.8s ease-in-out infinite;
}
@keyframes clock-blink {
  0%,
  100% {
    opacity: 1;
    box-shadow: 0 0 0 0 rgba(249, 115, 22, 0);
  }
  50% {
    opacity: 0.55;
    box-shadow: 0 0 0 6px rgba(249, 115, 22, 0.12);
  }
}
/* ผู้ใช้ที่ตั้งค่าระบบให้ลดการเคลื่อนไหว → ไม่ต้องกระพริบ */
@media (prefers-reduced-motion: reduce) {
  .clock-btn-blink {
    animation: none;
  }
}
</style>
