<script setup>
/**
 * LeaveStatsExport — หน้าต่างส่งออกสถิติการลาเป็น Excel
 *
 * ย้ายจาก openStatsExportDialog() ใน LeaveView.js
 *
 * ให้ผู้ใช้เลือก "ปีงบประมาณ + รอบพิจารณาความชอบ" แล้วจึงส่งออก
 * นิยามปีงบประมาณ: 1 ต.ค. (ปีก่อน) – 30 ก.ย. (ปีที่เลือก)
 *   ทั้งปี = ปีงบประมาณเต็ม | รอบที่ 1 = 1 ต.ค.–31 มี.ค. | รอบที่ 2 = 1 เม.ย.–30 ก.ย.
 */
import { ref, computed, watch } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import AppModal from './AppModal.vue';

const props = defineProps({
  sheetLabel: { type: String, required: true },
  /** 'leave-stats' | 'vac-stats' — my-stats ไม่มีปุ่มส่งออก */
  kind: { type: String, required: true },
});

const emit = defineEmits(['close', 'exported']);

const busy = ref(false);

function currentFY() {
  const d = new Date();
  return d.getMonth() >= 9 ? d.getFullYear() + 544 : d.getFullYear() + 543;
}

const fy = ref(String(currentFY()));
const round = ref('year');

/** ปีงบประมาณที่เลือกได้: ปีปัจจุบัน, ก่อนหน้า, ปีหน้า */
const fyOptions = computed(() => [currentFY(), currentFY() - 1, currentFY() + 1]);

/** ตัวเลือกรอบต้องเปลี่ยนตามปีงบประมาณที่เลือก */
const rounds = computed(() => {
  const y = Number(fy.value) || currentFY();
  return [
    { value: 'year', label: `ทั้งปีงบประมาณ (1 ต.ค. ${y - 1} - 30 ก.ย. ${y})` },
    { value: 'round1', label: `รอบที่ 1 (1 ต.ค. ${y - 1} - 31 มี.ค. ${y})` },
    { value: 'round2', label: `รอบที่ 2 (1 เม.ย. - 30 ก.ย. ${y})` },
  ];
});

// ถ้าเปลี่ยนปีงบประมาณ ให้รอบกลับเป็น "ทั้งปี" เพื่อไม่ให้ค้างเป็นรอบของปีเก่า
watch(fy, () => {
  round.value = 'year';
});

const range = computed(() => {
  const yBE = Number(fy.value) || currentFY();
  const y = yBE - 543;
  if (round.value === 'round1') {
    return { from: `${y - 1}-10-01`, to: `${y}-03-31`, label: `รอบที่ 1 (1 ต.ค. ${yBE - 1} - 31 มี.ค. ${yBE})` };
  }
  if (round.value === 'round2') {
    return { from: `${y}-04-01`, to: `${y}-09-30`, label: `รอบที่ 2 (1 เม.ย. - 30 ก.ย. ${yBE})` };
  }
  return { from: `${y - 1}-10-01`, to: `${y}-09-30`, label: `ปีงบประมาณ ${yBE}` };
});

function inRange(iso) {
  const d = String(iso || '').slice(0, 10);
  return d >= range.value.from && d <= range.value.to;
}

/** สร้างข้อมูลสำหรับส่งออก */
async function build() {
  const r = range.value;
  if (props.kind === 'leave-stats') {
    const data = await api.get('/leaves?group=general&status=approved');
    const list = (data.requests || []).filter((x) => inRange(x.date_from));
    const map = {};
    for (const x of list) {
      if (!map[x.user_id]) {
        map[x.user_id] = { name: UI.personName(x), position: x.position || '-', sick: 0, personal: 0, maternity: 0, total: 0 };
      }
      const u = map[x.user_id];
      const d = Number(x.days) || 0;
      u.total += d;
      if (x.leave_type === 'ลาป่วย') u.sick += d;
      else if (x.leave_type === 'ลากิจ') u.personal += d;
      else if (x.leave_type === 'ลาคลอดบุตร') u.maternity += d;
    }
    const users = Object.values(map).sort((a, b) => b.total - a.total);
    return {
      headers: ['ลำดับ', 'ชื่อบุคลากร', 'ตำแหน่ง', 'ลาป่วย (วัน)', 'ลากิจ (วัน)', 'ลาคลอด (วัน)', 'รวม (วัน)'],
      dataRows: users.map((u, i) => [i + 1, u.name, u.position, u.sick, u.personal, u.maternity, u.total]),
      count: users.length,
    };
  }

  // vac-stats
  const [balData, lvData] = await Promise.all([
    api.get('/leave-balances?year=' + (Number(fy.value) || currentFY())),
    api.get('/leaves?group=vacation&status=approved'),
  ]);
  const usedByUser = {};
  for (const x of (lvData.requests || []).filter((y) => inRange(y.date_from))) {
    if (!usedByUser[x.user_id]) usedByUser[x.user_id] = { times: 0, days: 0 };
    usedByUser[x.user_id].times += 1;
    usedByUser[x.user_id].days += Number(x.days) || 0;
  }
  const list = (balData.balances || [])
    .filter((b) => b.user_group !== 'school')
    .map((b) => {
      const u = usedByUser[b.id] || { times: 0, days: 0 };
      return { ...b, used: u.days, usedTimes: u.times, remaining: Math.max(0, (Number(b.total) || 0) - u.days) };
    })
    .sort((a, b) => (a.seq || 9999) - (b.seq || 9999));

  return {
    headers: ['ที่', 'ชื่อบุคลากร', 'ตำแหน่ง', 'สังกัด/กลุ่มงาน', 'สะสม (วัน)', 'ประจำปี (วัน)', 'สิทธิ์รวม (วัน)', 'ใช้ไป — ครั้ง', 'ใช้ไป — วัน', 'คงเหลือ (วัน)'],
    dataRows: list.map((b, i) => [
      b.seq || i + 1,
      UI.personName(b),
      b.position || '-',
      b.workplace || '-',
      Number(b.accumulated) || 0,
      Number(b.annual) || 0,
      Number(b.total) || 0,
      b.usedTimes || 0,
      b.used || 0,
      b.remaining || 0,
    ]),
    count: list.length,
  };
}

async function doExport() {
  busy.value = true;
  try {
    UI.toast('กำลังเตรียมข้อมูล...', 'success', 1500);
    const out = await build();
    const fname = (props.sheetLabel.replace(/\s+/g, '') + '_' + range.value.label).replace(/[\\/:*?"<>|]/g, '');
    UI.exportExcel(fname, `${props.sheetLabel} (${range.value.label})`, out.headers, out.dataRows);
    UI.toast('ส่งออกแล้ว ' + out.count + ' รายการ', 'success');
    emit('exported');
    emit('close');
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppModal title="📥 ส่งออกข้อมูล (Excel)" footer @close="emit('close')">
    <div style="padding: 4px 2px">
      <div style="margin-bottom: 12px; font-weight: 700; font-size: 13.5px; color: #0f766e">
        ส่งออก: {{ sheetLabel }}
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px">
        <div style="display: flex; align-items: center; gap: 12px">
          <div style="width: 170px; font-weight: 600; font-size: 13.5px; color: #334155">ปีงบประมาณ พ.ศ.</div>
          <select v-model="fy" style="min-width: 170px">
            <option v-for="y in fyOptions" :key="y" :value="String(y)">ปีงบประมาณ {{ y }}</option>
          </select>
        </div>
        <div style="display: flex; align-items: center; gap: 12px">
          <div style="width: 170px; font-weight: 600; font-size: 13.5px; color: #334155">รอบพิจารณาความชอบ</div>
          <select v-model="round" style="min-width: 300px">
            <option v-for="o in rounds" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="hint" style="margin-top: 4px">เลือกปีงบประมาณและรอบที่ต้องการ แล้วกดส่งออก</div>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-outline" :disabled="busy" @click="emit('close')">ยกเลิก</button>
      <button class="btn btn-primary" style="background: #059669" :disabled="busy" @click="doExport">
        {{ busy ? 'กำลังส่งออก…' : '⬇ ส่งออก Excel' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
