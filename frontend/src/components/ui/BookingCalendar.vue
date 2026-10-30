<script setup>
/**
 * BookingCalendar — มุมมองปฏิทินรายเดือนของรายการจอง
 *
 * ใช้ร่วมกัน 2 ระบบ: จองห้องประชุม (rooms) · จองยานพาหนะ (vehicles)
 * ทั้งสองใช้โครงปฏิทินเดียวกัน ต่างกันแค่ข้อความบนชิปกับไอคอนสำรอง
 *
 * class ทั้งหมดมาจาก theme.css ของระบบเดิม:
 *   .cal-head .cal-title .cal-grid .cal-weekday
 *   .cal-day .cal-outside .cal-today .cal-day-num
 *   .cal-chip .c-approved .c-rejected .c-pending
 */
import { computed } from 'vue';
import { UI } from '../../ui/ui.js';

const props = defineProps({
  /** รายการจองทั้งหมด */
  bookings: { type: Array, default: () => [] },
  /** เดือนที่แสดง (Date วันที่ 1 ของเดือน) */
  month: { type: Date, required: true },
  /** 'rooms' = จองห้องประชุม · 'vehicles' = จองยานพาหนะ */
  kind: { type: String, default: 'rooms' },
});

const emit = defineEmits(['pick', 'shift']);

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const WEEKDAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];

const year = computed(() => props.month.getFullYear());
const monthIdx = computed(() => props.month.getMonth());
const title = computed(() => `${THAI_MONTHS[monthIdx.value]} ${year.value + 543}`);

const pad2 = (n) => String(n).padStart(2, '0');

/** บวก 1 วันบนสตริง YYYY-MM-DD (ใช้ UTC กันเวลาเขตโซนเลื่อนวัน) */
function nextDay(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/**
 * จัดการจองแยกตามวันของเดือนที่แสดง
 *
 * ⚠️ ต้องไล่ทุกวันตั้งแต่ date ถึง date_to
 *    เดิมใช้แค่ b.date (วันแรก) → การจองหลายวันโผล่ในปฏิทินวันเดียว
 *    (เจอจริง: จองรถ 3 วัน แต่ปฏิทินแสดงแค่วันแรก)
 *
 * _cont = true เมื่อเป็นวันต่อเนื่อง (ไม่ใช่วันเริ่ม) → ใช้เติมลูกศรนำหน้าชิป
 * จำกัดช่วง 400 วัน กันข้อมูลผิดปกติ (date_to ไกลเกินจริง) ทำให้ลูปยาว
 */
const byDay = computed(() => {
  const prefix = `${year.value}-${pad2(monthIdx.value + 1)}`;
  const out = {};
  for (const b of props.bookings) {
    const start = String(b.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) continue;
    let end = String(b.date_to || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) end = start;

    let cur = start;
    for (let guard = 0; cur <= end && guard < 400; guard++) {
      if (cur.slice(0, 7) === prefix) {
        const d = parseInt(cur.slice(8, 10), 10);
        (out[d] = out[d] || []).push({ ...b, _cont: cur !== start });
      }
      cur = nextDay(cur);
    }
  }
  return out;
});

const today = computed(() => new Date());

/** ช่องทั้งหมดของปฏิทิน (รวมช่องว่างขอบต้น/ปลายเดือน) */
const cells = computed(() => {
  const first = new Date(year.value, monthIdx.value, 1);
  const startOffset = (first.getDay() + 6) % 7; // จันทร์ = 0
  const daysInMonth = new Date(year.value, monthIdx.value + 1, 0).getDate();
  const total = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const t = today.value;
  const out = [];
  for (let i = 0; i < total; i++) {
    const dayNum = i - startOffset + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      out.push({ dayNum: null });
      continue;
    }
    out.push({
      dayNum,
      isToday: dayNum === t.getDate() && monthIdx.value === t.getMonth() && year.value === t.getFullYear(),
      items: byDay.value[dayNum] || [],
    });
  }
  return out;
});

/** สีชิปตามสถานะ */
function chipClass(status) {
  return status === 'approved' ? 'c-approved' : status === 'rejected' ? 'c-rejected' : 'c-pending';
}

function chipTitle(b) {
  return `${b.topic} • ${b.start_time}-${b.end_time} • ${UI.personName(b)}`;
}

/** ข้อความบนชิป: ห้องประชุมใช้ชื่อห้อง · ยานพาหนะใช้ชื่อรถเต็ม (ไม่แสดงทะเบียน) */
function chipText(b) {
  // ↳ = วันต่อเนื่องของการจองหลายวัน (วันแรกไม่มีลูกศร)
  const cont = b._cont ? '↳ ' : '';
  if (props.kind === 'vehicles') {
    // ผู้ใช้ขอ: แสดงแค่ชื่อยานพาหนะ เช่น "รถตู้เทา 9506" — ไม่ต้องแสดงทะเบียน
    if (!b.vehicle_name) return `${cont}🤝 มอบเจ้าหน้าที่จัดให้ ${b.start_time || ''}`.trim();
    return `${cont}${b.vehicle_name}${b.start_time ? ' ' + b.start_time : ''}`;
  }
  return `${cont}${b.room_name} ${b.start_time}`;
}

/** tooltip ของชิป: ยานพาหนะไม่มี topic จึงใช้ชื่อรถ/ปลายทางแทน (ตามของเดิม) */
function chipTip(b) {
  const range = b.date_to && b.date_to !== b.date
    ? ` • ${UI.date(b.date)} → ${UI.date(b.date_to)}`
    : '';
  if (props.kind === 'vehicles') {
    return `${b.vehicle_name || 'มอบเจ้าหน้าที่จัดให้'} • ${b.start_time || '-'}-${b.end_time || '-'} • ${UI.personName(b)}${range}`;
  }
  return `${chipTitle(b)}${range}`;
}
</script>

<template>
  <div>
    <div class="cal-head">
      <button class="btn btn-outline btn-sm" title="เดือนก่อนหน้า" @click="emit('shift', -1)">◀</button>
      <div class="cal-title">{{ title }}</div>
      <button class="btn btn-outline btn-sm" title="เดือนถัดไป" @click="emit('shift', 1)">▶</button>
      <button class="btn btn-outline btn-sm" @click="emit('shift', 0)">เดือนนี้</button>
    </div>

    <div class="cal-grid">
      <div v-for="w in WEEKDAYS" :key="w" class="cal-weekday">{{ w }}</div>

      <template v-for="(c, i) in cells" :key="i">
        <div v-if="c.dayNum === null" class="cal-day cal-outside"></div>
        <div v-else class="cal-day" :class="{ 'cal-today': c.isToday }">
          <div class="cal-day-num">{{ String(c.dayNum).padStart(2, '0') }}</div>
          <div
            v-for="(b, bi) in c.items"
            :key="bi"
            class="cal-chip"
            :class="[chipClass(b.status), { 'chip-vehicle': kind === 'vehicles' }]"
            :title="chipTip(b)"
            @click="emit('pick', b)"
          >
            {{ chipText(b) }}
          </div>
        </div>
      </template>
    </div>

    <p class="hint" style="margin-top: 10px">💡 กดการ์ดจองในปฏิทินเพื่อดูรายละเอียด</p>
  </div>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */

/*
 * ชิปยานพาหนะแสดง "ชื่อรถเต็ม + ทะเบียน" ซึ่งยาวกว่าชื่อห้องมาก
 * theme.css ตั้ง .cal-chip เป็น nowrap + ellipsis (ห้ามแก้ theme.css)
 * → override เฉพาะชิปของยานพาหนะให้ตัดขึ้นบรรทัดใหม่ได้ จะได้เห็นชื่อเต็ม
 */
.cal-chip.chip-vehicle {
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
  word-break: break-word;
  line-height: 1.3;
}
</style>
