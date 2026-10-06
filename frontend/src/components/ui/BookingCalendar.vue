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

/** จัดการจองแยกตามวันของเดือนที่แสดง */
const byDay = computed(() => {
  const prefix = `${year.value}-${String(monthIdx.value + 1).padStart(2, '0')}`;
  const out = {};
  for (const b of props.bookings) {
    if (b.date && String(b.date).slice(0, 7) === prefix) {
      const d = parseInt(String(b.date).slice(8, 10), 10);
      (out[d] = out[d] || []).push(b);
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

/** ข้อความบนชิป: ห้องประชุมใช้ชื่อห้อง · ยานพาหนะใช้คำแรกของชื่อรถ + โลโก้เมื่อมอบเจ้าหน้าที่ */
function chipText(b) {
  if (props.kind === 'vehicles') {
    return `${b.vehicle_name ? b.vehicle_name.split(' ')[0] : '🤝'} ${b.start_time || ''}`;
  }
  return `${b.room_name} ${b.start_time}`;
}

/** tooltip ของชิป: ยานพาหนะไม่มี topic จึงใช้ชื่อรถ/ปลายทางแทน (ตามของเดิม) */
function chipTip(b) {
  if (props.kind === 'vehicles') {
    return `${b.vehicle_name || 'มอบเจ้าหน้าที่จัดให้'} • ${b.start_time || '-'}-${b.end_time || '-'} • ${UI.personName(b)}`;
  }
  return chipTitle(b);
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
            :class="chipClass(b.status)"
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
</style>
