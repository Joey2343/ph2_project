<script setup>
/**
 * HomePage — หน้าแรก: การ์ดเมนูทั้งหมด + วิดเจ็ตลงเวลา + สรุปงานที่ค้าง
 *
 * ย้ายจาก src/views/HomeView.js (320 บรรทัด) เป็น Vue SFC — เป็นหน้าที่ย้ายท้ายสุด
 *
 * โครงหน้า (เรียงตามของเดิม)
 *   1. แบนเนอร์ต้อนรับ + กล่องลงเวลา (ซ่อนสำหรับสถานศึกษา เพราะไม่ใช้ระบบลงเวลา)
 *   2. สถิติรออนุมัติ (admin / ผู้มีสิทธิ์อนุมัติ) — การ์ดที่เป็น 0 ไม่แสดง
 *   3. การ์ดสถานะวันนี้ (ทุกคนฝั่งสำนักงาน) — คลิกดูรายชื่อ
 *   4. งานที่ค้าง / รออนุมัติของฉัน (deep-link ไปเมนูที่เกี่ยวข้อง)
  *      ส่วน "งานรอการอนุมัติจากฉัน" ถูกเอาออกแล้ว เพราะซ้ำกับป้ายแจ้งเตือน
  *      บนการ์ดเมนูหลัก (แต่ละใบมีป้ายแดงมุมขวาบนบอกจำนวนที่รอฉันอยู่)
 *   5. ตารางเมนูหลัก
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import api from '../api/client.js';
import { UI } from '../ui/ui.js';
import { Auth } from '../stores/auth.js';
import { MENUS, canAccess } from '../router/menus.js';
import AppModal from '../components/ui/AppModal.vue';

/* ---------- กล่องลงเวลา ---------- */
const isSchoolUser = computed(() => Auth.user && Auth.user.user_group === 'school');
const showClock = computed(() => Auth.isLoggedIn() && !isSchoolUser.value);

const clockNow = ref('--:--:--');
const clockDate = ref('');
const clockStatus = ref(null);
const clockRec = ref(null);
const checking = ref(false);
let clockTimer = null;

const DAYS_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

async function loadClock() {
  try {
    const data = await api.get('/time/today');
    const rec = data.record;
    clockRec.value = rec;
    if (rec && rec.clock_out) {
      clockStatus.value = {
        text: `● ลงเวลาครบแล้ว (เข้า ${fmtTime(rec.clock_in)} • ออก ${fmtTime(rec.clock_out)})`,
        bg: '#dcfce7',
        color: '#15803d',
      };
    } else if (rec && rec.clock_in) {
      clockStatus.value = {
        text: `◷ เข้างานแล้ว ${fmtTime(rec.clock_in)} — อย่าลืมลงเวลาออกงาน`,
        bg: '#fef3c7',
        color: '#b45309',
      };
    } else {
      clockStatus.value = { text: 'ยังไม่ได้ลงเวลาเข้างานวันนี้', bg: '#fef3c7', color: '#b45309' };
    }
  } catch {
    /* โหลดสถานะไม่ได้ → ปล่อยเป็นค่าเริ่มต้น */
  }
}

function fmtTime(t) {
  return t ? String(t).slice(0, 5) : '-';
}

async function checkTime(type) {
  if (checking.value) return;
  checking.value = true;
  try {
    const res = await api.post('/time/check', { type });
    UI.toast(res.message);
    await loadClock();
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    checking.value = false;
  }
}

/* ---------- สถิติรออนุมัติ (admin / ผู้มีสิทธิ์อนุมัติ) ---------- */
const isManager = computed(
  () => Auth.isLoggedIn() && (Auth.isAdmin() || (Auth.user.can_approve && UI.isApprover())),
);
const dashboard = ref(null);

/** การ์ดที่มีค่า > 0 เท่านั้น (การ์ดที่เป็น 0 ไม่ต้องแสดง) */
const pendingStats = computed(() => {
  const d = dashboard.value;
  if (!d) return [];
  return [
    { icon: '◷', label: 'จองยานพาหนะรออนุมัติ', value: d.pendingVehicle, color: 'var(--info-light)' },
    { icon: '⬡', label: 'จองห้องประชุมรออนุมัติ', value: d.pendingRoom, color: 'var(--success-light)' },
    { icon: '✈', label: 'ไปราชการรออนุมัติ', value: d.pendingTravel, color: 'var(--warning-light)' },
    { icon: '❋', label: 'ขอลารออนุมัติ', value: d.pendingLeave, color: 'var(--danger-light)' },
    { icon: '⊕', label: 'รออนุมัติสมาชิกใหม่', value: d.pendingUsers, color: 'var(--accent-light)' },
    { icon: '◷', label: 'รออนุมัติทั้งหมด', value: d.pendingTotal, color: 'var(--warning-light)' },
    // ไม่มีการ์ด "มาทำงานวันนี้" ตรงนี้ เพราะ todayCards มีอยู่แล้ว
    // (นับคนเดียวกันจาก /api/today-summary และคลิกเปิดรายชื่อได้)
    // ถ้าใส่ทั้งสองใบจะขึ้นซ้ำติดกันในแถวเดียว
  ].filter((s) => s.value > 0);
});

/* ---------- การ์ดสถานะวันนี้ ---------- */
const todaySummary = ref(null);

/** คอลัมน์ของแต่ละการ์ดสถานะวันนี้ — ใช้ร่วมกันกับหน้าต่างรายชื่อ */
const TODAY_COLS = {
  worked: [
    { key: 'full_name', label: 'ชื่อ-นามสกุล', cell: (p) => ({ text: UI.personName(p) }) },
    { key: 'position', label: 'ตำแหน่ง' },
    { key: 'workplace', label: 'กลุ่มงาน' },
    { key: 'clock_in', label: 'เวลาเข้า', cell: (p) => ({ text: UI.time(p.clock_in) }) },
    { key: 'clock_out', label: 'เวลาออก', cell: (p) => ({ text: UI.time(p.clock_out) }) },
  ],
  birthdays: [
    { key: 'full_name', label: 'ชื่อ-นามสกุล', cell: (p) => ({ text: UI.personName(p) }) },
    { key: 'age', label: 'อายุ', cell: (p) => ({ text: p.age != null ? p.age + ' ปี' : '-' }) },
    { key: 'position', label: 'ตำแหน่ง' },
    { key: 'workplace', label: 'กลุ่มงาน' },
  ],
  leave: [
    { key: 'full_name', label: 'ชื่อ-นามสกุล', cell: (p) => ({ text: UI.personName(p) }) },
    { key: 'leave_type', label: 'ประเภทการลา' },
    {
      key: 'date_from',
      label: 'วันลา',
      cell: (p) => ({ text: UI.date(p.date_from) + ' ถึง ' + UI.date(p.date_to) }),
    },
    { key: 'position', label: 'ตำแหน่ง' },
  ],
  travel: [
    { key: 'full_name', label: 'ชื่อ-นามสกุล', cell: (p) => ({ text: UI.personName(p) }) },
    { key: 'destination', label: 'สถานที่ไปราชการ' },
    {
      key: 'date_from',
      label: 'วันเดินทาง',
      cell: (p) => ({ text: UI.date(p.date_from) + ' ถึง ' + UI.date(p.date_to) }),
    },
    { key: 'position', label: 'ตำแหน่ง' },
  ],
};

const todayCards = computed(() => {
  const s = todaySummary.value;
  if (!s) return [];
  return [
    {
      key: 'worked',
      icon: '▭',
      label: 'มาทำงานวันนี้',
      count: s.worked.length,
      color: 'var(--success-light)',
      title: '▭ มาทำงานวันนี้',
      subtitle: `ผู้ที่ลงเวลาเข้างานวันนี้ ${UI.thaiDate(s.today)} — ${s.worked.length} คน`,
    },
    {
      key: 'birthdays',
      icon: '★',
      label: 'เกิดวันนี้',
      count: s.birthdays.length,
      color: 'var(--warning-light)',
      title: '★ วันเกิดวันนี้',
      subtitle: `ผู้ที่เกิดวันนี้ ${UI.thaiDate(s.today)} — ${s.birthdays.length} คน`,
    },
    {
      key: 'leave',
      icon: '❋',
      label: 'ลา',
      count: s.leave.length,
      color: 'var(--danger-light)',
      title: '❋ ลาวันนี้',
      subtitle: `ผู้ที่ลาวันนี้ ${UI.thaiDate(s.today)} — ${s.leave.length} คน`,
    },
    {
      key: 'travel',
      icon: '✈',
      label: 'ไปราชการ',
      count: s.travel.length,
      color: 'var(--info-light)',
      title: '✈ ไปราชการวันนี้',
      subtitle: `ผู้ที่ไปราชการวันนี้ ${UI.thaiDate(s.today)} — ${s.travel.length} คน`,
    },
  ].filter((c) => c.count > 0);
});

/** การ์ดสถานะวันนี้ + การ์ดรออนุมัติของผู้จัดการอยู่แถวเดียวกัน */
const managerRow = computed(() =>
  isManager.value ? [...pendingStats.value, ...todayCards.value] : todayCards.value,
);

/* ---------- หน้าต่างรายชื่อ ---------- */
const listOpen = ref(false);
const listTitle = ref('');
const listSubtitle = ref('');
const listRows = ref([]);
const listCols = ref([]);

function openList(card) {
  listTitle.value = card.title;
  listSubtitle.value = card.subtitle;
  listRows.value = todaySummary.value[card.key] || [];
  listCols.value = TODAY_COLS[card.key] || [];
  listOpen.value = true;
}

/* ---------- งานที่ค้าง / รออนุมัติของฉัน ---------- */
const myPending = ref(null);
const isSchool = computed(() => Auth.user && Auth.user.user_group === 'school');

const myCards = computed(() => {
  const mp = myPending.value;
  if (!mp) return [];
  const cards = [
    { icon: '▣', label: 'จองยานพาหนะรออนุมัติ', count: mp.vehicle, color: 'var(--info-light)', href: '#/vehicles' },
    { icon: '⬡', label: 'จองห้องประชุมรออนุมัติ', count: mp.room, color: 'var(--success-light)', href: '#/rooms' },
    {
      icon: '✈',
      label: 'ไปราชการรออนุมัติ',
      count: mp.travel,
      color: 'var(--warning-light)',
      href: isSchool.value ? '#/travel-school' : '#/travel',
    },
    ...(mp.leaveTypes && mp.leaveTypes.vacation > 0
      ? [
          {
            icon: '❋',
            label: 'ขอลาพักผ่อนรออนุมัติ',
            count: mp.leaveTypes.vacation,
            color: 'var(--danger-light)',
            href: isSchool.value ? '#/leave?tab=vacation-school' : '#/leave?tab=vacation',
          },
        ]
      : []),
    ...(mp.leaveTypes && mp.leaveTypes.general > 0
      ? [
          {
            icon: '❋',
            label: 'ขอลา (ป่วย/กิจ/คลอด)รออนุมัติ',
            count: mp.leaveTypes.general,
            color: 'var(--danger-light)',
            href: isSchool.value ? '#/leave?tab=general-school' : '#/leave?tab=general',
          },
        ]
      : []),
    ...(mp.leaveTypes && mp.leaveTypes.general + mp.leaveTypes.vacation === 0 && mp.leave > 0
      ? [{ icon: '❋', label: 'ขอลารออนุมัติ', count: mp.leave, color: 'var(--danger-light)', href: '#/leave' }]
      : []),
    { icon: '✎', label: 'บันทึกข้อความรออนุมัติ', count: mp.memo, color: 'var(--accent-light)', href: '#/memos' },
    {
      icon: '↻',
      label: 'บันทึกข้อความส่งกลับเพื่อแก้ไข',
      count: mp.memoReturned || 0,
      color: 'var(--warning-light)',
      href: '#/memos',
    },
    {
      icon: '↩',
      label: 'หนังสือรอให้แก้ไข',
      count: mp.docReturned || 0,
      color: 'var(--warning-light)',
      href: '#/documents',
    },
    {
      icon: '▣',
      label: 'แจ้งเตือนการจองยานพาหนะ',
      count: mp.vehicleNotices || 0,
      color: 'var(--warning-light)',
      href: '#/vehicles',
    },
  ];
  return cards.filter((c) => c.count > 0);
});

const myTotal = computed(() => {
  const mp = myPending.value;
  if (!mp) return 0;
  return mp.vehicle + mp.room + mp.travel + mp.leave + mp.memo + (mp.memoReturned || 0) + (mp.docReturned || 0) + (mp.vehicleNotices || 0);
});

/*
 * เคยมีส่วน "◷ งานรอการอนุมัติจากฉัน" อยู่ตรงนี้
 * เอาออกแล้ว เพราะแสดงซ้ำกับป้ายแจ้งเตือนบนการ์ดเมนูหลัก
 * (การ์ดแต่ละใบมีป้ายแดงมุมขวาบนบอกจำนวนรายการที่รอฉันอนุมัติอยู่แล้ว)
 * ข้อมูลที่เคยใช้ตรงนี้ยังอยู่ใน /my-pending เพราะป้ายบนการ์ดใช้อยู่
 */

/* ---------- เมนูหลัก ---------- */
const gridMenus = computed(() => MENUS.filter((m) => !m.hideFromGrid && canAccess(m.key)));

/** รวมค่าของ approve ที่มีหลายขั้น (เช่น approve.vehicle = {1: 2, 2: 1}) */
function sumApprove(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  let n = 0;
  for (const k of Object.keys(obj)) {
    if (k === 'group') continue; // ไม่ใช่ตัวเลข
    const v = obj[k];
    if (typeof v === 'number') n += v;
  }
  return n;
}

/**
 * ป้ายแจ้งเตือนมุมขวาบนของการ์ดเมนูหลัก
 *
 * นับเฉพาะ "รอฉันทำ" — คือรายการที่รอให้ผู้ใช้คนนี้อนุมัติ/ตรวจสอบ
 * ไม่รวมคำขอของผู้ใช้เองที่ยังรอผล (ดูได้จากการ์ด "งานที่ค้างของฉัน" ด้านบนแล้ว)
 *
 * เมนูไหนไม่มีงานรอ ไม่ต้องแสดงป้าย (0 = ไม่แสดง)
 */
const menuBadges = computed(() => {
  const p = myPending.value;
  if (!p) return {};
  const ap = p.approve || {};
  return {
    vehicles: sumApprove(ap.vehicle),
    rooms: sumApprove(ap.room),
    travel: sumApprove(ap.travel),
    'travel-school': sumApprove(ap.travel_school),
    leave: sumApprove(ap.leave),
    memos: sumApprove(ap.memo),
    documents: Number(p.documentsUnread) || 0,
    staff: Number(p.pendingUsers) || 0,
  };
});

/** ตัวเลขบนป้ายของการ์ดใบนี้ (0 = ไม่ต้องแสดงป้าย) */
function badgeOf(key) {
  return Number(menuBadges.value[key]) || 0;
}

/** เกิน 99 แสดงเป็น 99+ */
function badgeText(n) {
  return n > 99 ? '99+' : String(n);
}

/**
 * ไปยังหน้าของเมนู
 *
 * ต้องเป็นฟังก์ชันใน script ไม่ใช่เรียก window.__P2_GO__ ใน template
 * เพราะ template ของ Vue เข้าถึงได้แค่ตัวแปรใน scope ของ component และ global ที่อนุญาต
 * (window ไม่ใช่หนึ่งในนั้น → ได้ ReferenceError ตอนคลิก)
 */
function goTo(key) {
  if (typeof window.__P2_GO__ === 'function') window.__P2_GO__(key);
}

/* ---------- โหลด ---------- */
onMounted(async () => {
  // นาฬิกาสด + สถานะลงเวลา
  if (showClock.value) {
    const d = new Date();
    clockDate.value = `${UI.thaiDate(UI.today())} • ${DAYS_TH[d.getDay()]}`;
    const tick = () => {
      clockNow.value = new Date().toTimeString().slice(0, 8);
    };
    tick();
    clockTimer = setInterval(tick, 1000);
    loadClock();
  }

  // สถิติรออนุมัติ — เฉพาะผู้จัดการฝั่งสำนักงาน
  if (isManager.value && !isSchoolUser.value) {
    try {
      dashboard.value = await api.get('/dashboard');
    } catch {
      /* การ์ดสถิติโหลดไม่ได้ → ไม่แสดง */
    }
  }

  // การ์ดสถานะวันนี้ — ทุกคนฝั่งสำนักงาน
  if (!isSchoolUser.value) {
    try {
      todaySummary.value = await api.get('/today-summary');
    } catch {
      /* ไม่แสดง */
    }
  }

  // งานที่ค้างของฉัน — ทุกคนที่ล็อกอิน (รวมสถานศึกษา)
  if (Auth.isLoggedIn()) {
    try {
      myPending.value = await api.get('/my-pending');
    } catch {
      /* ไม่แสดง */
    }
  }
});

// นาฬิกาต้องหยุดเมื่อออกจากหน้า ไม่งั้นจะยังเดินอยู่ในหลังเป็น
onBeforeUnmount(() => {
  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
});

/** ข้อความต้อนรับตามสิทธิ์ */
const greeting = computed(() => {
  if (!Auth.isLoggedIn()) {
    return {
      title: 'ยินดีต้อนรับสู่ สพป.แพร่ เขต 2',
      desc: 'ระบบศูนย์กลางการบริหารจัดการภายในสำนักงาน — สมาชิกทั่วไปสามารถเข้าดูได้เฉพาะเมนูข้อมูลพื้นฐาน และพิกัดโรงเรียนในสังกัด',
    };
  }
  if (Auth.isAdmin()) {
    return {
      title: `ยินดีต้อนรับ คุณ${Auth.user.full_name}`,
      desc: 'คุณเป็นผู้ดูแลระบบ สามารถบริหารจัดการได้ทุกเมนูในระบบ',
    };
  }
  if (isSchoolUser.value) {
    return {
      title: `ยินดีต้อนรับ คุณ${Auth.user.full_name}`,
      desc: '🏫 เจ้าหน้าที่สถานศึกษา — สามารถเข้าดูได้เฉพาะเมนูข้อมูลพื้นฐาน พิกัดโรงเรียน และหนังสือราชการ',
    };
  }
  return {
    title: `ยินดีต้อนรับ คุณ${Auth.user.full_name}`,
    desc: `ยินดีต้อนรับสู่ระบบบริหารจัดการภายในสำนักงาน — สิทธิ์ของคุณ: ${Auth.user.role_label || 'เจ้าหน้าที่'}`,
  };
});

/** การ์ดติดกันแบบแถวเดียว: ขอบหวังแยกระหว่างกัน */
function cardStyle(i, total) {
  return {
    flex: '0 0 auto',
    ...(i < total - 1 ? { borderRight: '1px solid #e5e7eb' } : {}),
  };
}
</script>

<template>
  <!-- ---------- แบนเนอร์ต้อนรับ + กล่องลงเวลา ---------- -->
  <div class="welcome-banner">
    <!--
      โลโก้เสิร์ฟอยู่ที่ root ของ backend (ไม่ได้อยู่ใน frontend/public)
      ต้องผูกเป็น runtime URL ถ้าใช้ src="..." ตรง ๆ
      Vite จะพยายามหาไฟล์ในโปรเจกต์ตอน build แล้ว fail
    -->
    <img class="banner-logo" :src="'logo.png'" alt="สพป.แพร่ เขต 2" />
    <div>
      <h2>{{ greeting.title }}</h2>
      <p>{{ greeting.desc }}</p>

      <!-- กล่องลงเวลา — สถานศึกษาไม่ใช้ระบบนี้ -->
      <div v-if="showClock" class="home-clock">
        <div class="home-clock-time">{{ clockNow }}</div>
        <div class="home-clock-date">{{ clockDate }}</div>
        <div v-if="clockStatus" class="home-clock-status">
          <span
            class="status-pill"
            :style="{
              background: clockStatus.bg,
              color: clockStatus.color,
              padding: '4px 12px',
              borderRadius: '999px',
              fontWeight: 700,
              fontSize: '12.5px',
            }"
            >{{ clockStatus.text }}</span
          >
        </div>
        <div class="home-clock-btns">
          <button
            id="home-clock-in"
            class="btn btn-clock-in btn-sm"
            :disabled="checking || !!(clockRec && clockRec.clock_in)"
            @click="checkTime('in')"
          >
            ⬡ เข้างาน
          </button>
          <button
            id="home-clock-out"
            class="btn btn-clock-out btn-sm"
            :disabled="checking || !clockRec || !clockRec.clock_in || !!clockRec.clock_out"
            @click="checkTime('out')"
          >
            🏁 ออกงาน
          </button>
          <a class="home-clock-history" href="#/clock" title="ดูประวัติการลงเวลา" aria-label="ดูประวัติการลงเวลา">🕘</a>
        </div>
      </div>
    </div>
  </div>

  <!-- ---------- การ์ดรออนุมัติ + สถานะวันนี้ (แถวเดียวกัน) ---------- -->
  <div v-if="managerRow.length" class="stat-grid">
    <div
      v-for="(c, i) in managerRow"
      :key="c.label"
      class="stat-card"
      :class="{ clickable: !!c.key }"
      :title="c.key ? 'ดูรายละเอียด' : undefined"
      @click="c.key && openList(c)"
    >
      <div class="stat-icon" :style="{ background: c.color }">{{ c.icon }}</div>
      <div>
        <div class="stat-value">{{ c.count }}</div>
        <div class="stat-label">{{ c.label }}</div>
      </div>
    </div>
  </div>

  <!-- ---------- งานที่ค้าง / รออนุมัติของฉัน ---------- -->
  <template v-if="myCards.length">
    <div class="section-title">▭ งานที่ค้าง / รออนุมัติของฉัน ({{ myTotal }} รายการ)</div>
    <div style="display: flex; flex-wrap: wrap; gap: 0; margin-bottom: 22px">
      <a
        v-for="(c, i) in myCards"
        :key="c.label"
        class="stat-card clickable"
        :href="c.href"
        title="ดูรายการของฉัน"
        :style="cardStyle(i, myCards.length)"
      >
        <div class="stat-icon" :style="{ background: c.color }">{{ c.icon }}</div>
        <div>
          <div class="stat-value">{{ c.count }}</div>
          <div class="stat-label">{{ c.label }}</div>
        </div>
      </a>
    </div>
  </template>

  <!--
    เคยมีส่วน "◷ งานรอการอนุมัติจากฉัน" ตรงนี้
    เอาออกแล้ว เพราะซ้ำกับป้ายแจ้งเตือนบนการ์ดเมนูหลักด้านล่าง
  -->

  <!-- ---------- ตารางเมนูหลัก ---------- -->
  <div class="section-title">▭ เมนูหลัก</div>
  <div class="menu-grid">
    <div
      v-for="m in gridMenus"
      :key="m.key"
      class="menu-card"
      @click="goTo(m.key)"
    >
      <!-- ป้ายแจ้งเตือนมุมขวาบน: รายการที่รอฉันอนุมัติ/ตรวจสอบ
           ใช้คลาส .menu-count ที่มีอยู่ใน theme.css ของเดิมอยู่แล้ว (ไม่ต้องเพิ่ม CSS) -->
      <span
        v-if="badgeOf(m.key)"
        class="menu-count"
        :title="'มี ' + badgeOf(m.key) + ' รายการที่รอคุณอนุมัติ/ตรวจสอบ'"
      >{{ badgeText(badgeOf(m.key)) }}</span>
      <div
        class="menu-icon"
        :style="{ background: m.grad, boxShadow: '0 4px 10px rgba(0,0,0,.15)' }"
      >
        {{ m.icon }}
      </div>
      <div class="menu-name">{{ m.title }}</div>
      <div class="menu-desc">{{ m.desc }}</div>
    </div>
  </div>

  <!-- ---------- หน้าต่างรายชื่อ (การ์ดสถานะวันนี้) ---------- -->
  <AppModal v-if="listOpen" :title="listTitle" size="lg" footer @close="listOpen = false">
    <p class="hint" style="margin-bottom: 12px">{{ listSubtitle }}</p>

    <div v-if="listRows.length === 0" class="empty-state"><span class="em">▭</span>ไม่มีรายการในวันนี้</div>

    <div v-else class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th v-for="c in listCols" :key="c.key">{{ c.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in listRows" :key="i">
            <td v-for="c in listCols" :key="c.key">{{ c.cell ? c.cell(r).text : r[c.key] }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <template #footer>
      <button class="btn btn-outline" @click="listOpen = false">ปิด</button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
