<script setup>
/**
 * LeaveStats — แท็บสถิติการลา 3 แบบ + ปุ่มส่งออก Excel
 *
 *   kind = 'leave-stats' | 'vac-stats' | 'my-stats'
 *
 * ย้ายจาก loadLeaveStats() / loadVacStats() / loadMyStats() ใน LeaveView.js
 *
 * ทุกแท็บใช้ "รอบพิจารณาความชอบ" ร่วมกัน (ปีงบประมาณ + รอบที่ 1/2/ทั้งปี)
 * นิยามปีงบประมาณ: 1 ต.ค. (ปีก่อน) – 30 ก.ย. (ปีที่เลือก)
 */
import { ref, computed, onMounted, watch } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import { Auth } from '../../stores/auth.js';
import LeaveStatsExport from './LeaveStatsExport.vue';

const props = defineProps({
  /** 'leave-stats' | 'vac-stats' | 'my-stats' */
  kind: { type: String, required: true },
  /** ปีงบประมาณที่เลือก (พ.ศ.) */
  year: { type: String, default: '' },
  /** รอบ: 'year' | 'round1' | 'round2' */
  round: { type: String, default: 'year' },
});

const emit = defineEmits(['changed']);

const loading = ref(true);
const error = ref('');
const rows = ref([]); // สำหรับ leave-stats
const vacRows = ref([]); // สำหรับ vac-stats
const mine = ref(null); // สำหรับ my-stats
const fyYear = ref('');

const exportOpen = ref(false);
const exportSheet = computed(() =>
  props.kind === 'leave-stats' ? 'สถิติลาป่วย ลากิจ ลาคลอด อนุมัติแล้ว' : 'สถิติลาพักผ่อน',
);

/* ---------- ช่วงวันที่ของรอบพิจารณาความชอบ ---------- */
const range = computed(() => {
  const yBE = Number(props.year) || currentFY();
  const y = yBE - 543;
  if (props.round === 'round1') {
    return { from: `${y - 1}-10-01`, to: `${y}-03-31`, label: `รอบที่ 1 (1 ต.ค. ${yBE - 1} - 31 มี.ค. ${yBE})` };
  }
  if (props.round === 'round2') {
    return { from: `${y}-04-01`, to: `${y}-09-30`, label: `รอบที่ 2 (1 เม.ย. - 30 ก.ย. ${yBE})` };
  }
  return { from: `${y - 1}-10-01`, to: `${y}-09-30`, label: `${yBE} (1 ต.ค. ${yBE - 1} - 30 ก.ย. ${yBE})` };
});

function currentFY() {
  const d = new Date();
  return d.getMonth() >= 9 ? d.getFullYear() + 544 : d.getFullYear() + 543;
}

function inRound(iso) {
  const d = String(iso || '').slice(0, 10);
  return d >= range.value.from && d <= range.value.to;
}

/* ---------- โหลดข้อมูล ---------- */
onMounted(load);
watch(() => [props.kind, props.year, props.round], load);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    if (props.kind === 'leave-stats') await loadLeaveStats();
    else if (props.kind === 'vac-stats') await loadVacStats();
    else await loadMyStats();
  } catch (e) {
    error.value = e.message;
    rows.value = [];
    vacRows.value = [];
    mine.value = null;
  } finally {
    loading.value = false;
  }
}

/** สถิติลาป่วย ลากิจ ลาคลอด — นับเฉพาะรายการที่อนุมัติแล้ว */
async function loadLeaveStats() {
  const data = await api.get('/leaves?group=general&status=approved');
  const list = (data.requests || []).filter((r) => inRound(r.date_from));
  const map = {};
  for (const r of list) {
    if (!map[r.user_id]) {
      map[r.user_id] = { name: UI.personName(r), position: r.position || '-', sick: 0, personal: 0, maternity: 0, total: 0 };
    }
    const u = map[r.user_id];
    const d = Number(r.days) || 0;
    u.total += d;
    if (r.leave_type === 'ลาป่วย') u.sick += d;
    else if (r.leave_type === 'ลากิจ') u.personal += d;
    else if (r.leave_type === 'ลาคลอดบุตร') u.maternity += d;
  }
  rows.value = Object.values(map).sort((a, b) => b.total - a.total);
}

/** สถิติลาพักผ่อน — สิทธิ์เทียบกับที่ใช้ไปจริง */
async function loadVacStats() {
  const year = props.year || String(currentFY());
  const [balData, lvData] = await Promise.all([
    api.get('/leave-balances?year=' + year),
    api.get('/leaves?group=vacation&status=approved'),
  ]);
  const usedByUser = {};
  for (const r of (lvData.requests || []).filter((x) => inRound(x.date_from))) {
    if (!usedByUser[r.user_id]) usedByUser[r.user_id] = { times: 0, days: 0 };
    usedByUser[r.user_id].times += 1;
    usedByUser[r.user_id].days += Number(r.days) || 0;
  }
  vacRows.value = (balData.balances || [])
    .filter((b) => b.user_group !== 'school')
    .map((b) => {
      const u = usedByUser[b.id] || { times: 0, days: 0 };
      return { ...b, used: u.days, usedTimes: u.times, remaining: Math.max(0, (Number(b.total) || 0) - u.days) };
    })
    .sort((a, b) => (a.seq || 9999) - (b.seq || 9999));
}

/** สถิติการลาของฉัน — รวมลาพักผ่อน + ลาป่วย/กิจ/คลอด */
async function loadMyStats() {
  const u = Auth.user || {};
  const year = props.year || String(currentFY());
  const data = await api.get('/leaves?status=approved&year=' + year);
  const list = (data.requests || []).filter((r) => r.user_id === u.id && inRound(r.date_from));

  let sick = 0, personal = 0, maternity = 0, vacDays = 0, vacTimes = 0;
  for (const r of list) {
    const d = Number(r.days) || 0;
    if (r.leave_type === 'ลาพักผ่อน') { vacDays += d; vacTimes += 1; }
    else if (r.leave_type === 'ลาป่วย') sick += d;
    else if (r.leave_type === 'ลากิจ') personal += d;
    else if (r.leave_type === 'ลาคลอดบุตร') maternity += d;
  }

  let accumulated = 0, annual = 0;
  try {
    const bal = await api.get('/my-leave-balance?year=' + year);
    accumulated = Number(bal.accumulated) || 0;
    annual = Number(bal.annual) || 0;
  } catch {
    /* สิทธิ์ยังไม่ถูกตั้งค่า → ใช้ 0 */
  }

  const vacTotal = accumulated + annual;
  mine.value = {
    name: UI.personName(u),
    position: u.position || '',
    accumulated, annual, vacTotal, vacTimes, vacDays,
    vacRemain: Math.max(0, vacTotal - vacDays),
    sick, personal, maternity,
    grand: sick + personal + maternity + vacDays,
    generalTotal: sick + personal + maternity,
  };
}

/** สีตัวเลข: มีค่า → สีตามประเภท, ไม่มีค่า → จาง */
const COLORS = { sick: '#dc2626', personal: '#d97706', maternity: '#2563eb' };

const thStyle = {
  padding: '8px 12px',
  border: '1px solid #d1d5db',
  textAlign: 'center',
  fontWeight: 700,
  fontSize: '13px',
  whiteSpace: 'nowrap',
};
const tdStyle = { padding: '6px 12px', border: '1px solid #d1d5db', fontSize: '13px' };

/** แถวของตารางสถิติการลาของฉัน (ลาพักผ่อน + ลาอื่น ๆ) */
const myGeneral = computed(() =>
  mine.value
    ? [
        { label: 'ลาป่วย', v: mine.value.sick },
        { label: 'ลากิจ', v: mine.value.personal },
        { label: 'ลาคลอดบุตร', v: mine.value.maternity },
      ]
    : [],
);
</script>

<template>
  <div>
    <!-- ---------- ปุ่มส่งออก ---------- -->
    <div class="card-title" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap">
      <span v-if="kind === 'leave-stats'">
        📊 สถิติลาป่วย ลากิจ ลาคลอด อนุมัติแล้ว — {{ range.label }} ({{ rows.length }} คน)
      </span>
      <span v-else-if="kind === 'vac-stats'">
        📊 สถิติลาพักผ่อน — {{ range.label }} ({{ vacRows.length }} คน)
      </span>
      <span v-else>📊 สถิติการลาของฉัน — {{ range.label }}</span>

      <button
        v-if="kind !== 'my-stats'"
        class="btn btn-outline"
        style="margin-bottom: 0"
        @click="exportOpen = true"
      >
        📥 ส่งออกข้อมูล (Excel)
      </button>
    </div>

    <div v-if="loading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
    <div v-else-if="error" class="empty-state"><span class="em">⚠️</span>{{ error }}</div>

    <!-- ---------- สถิติลาป่วย ลากิจ ลาคลอด ---------- -->
    <div v-else-if="kind === 'leave-stats'">
      <div v-if="rows.length === 0" class="empty-state">
        <span class="em">📊</span>ยังไม่มีรายการที่อนุมัติแล้ว
      </div>
      <div v-else class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th :style="{ ...thStyle, textAlign: 'left' }">ลำดับ</th>
              <th :style="{ ...thStyle, textAlign: 'left' }">ชื่อบุคลากร</th>
              <th :style="{ ...thStyle, textAlign: 'left' }">ตำแหน่ง</th>
              <th :style="thStyle">ลาป่วย (วัน)</th>
              <th :style="thStyle">ลากิจ (วัน)</th>
              <th :style="thStyle">ลาคลอด (วัน)</th>
              <th :style="{ ...thStyle, fontWeight: 800 }">รวม (วัน)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(u, i) in rows" :key="i">
              <td :style="{ ...tdStyle, textAlign: 'center' }">{{ i + 1 }}</td>
              <td :style="{ ...tdStyle, fontWeight: 600 }">{{ u.name }}</td>
              <td :style="{ ...tdStyle, color: '#6b7280', fontSize: '12px' }">{{ u.position }}</td>
              <td :style="{ ...tdStyle, textAlign: 'center', color: u.sick ? COLORS.sick : '#d1d5db', fontWeight: u.sick ? 600 : 400 }">
                {{ u.sick }}
              </td>
              <td :style="{ ...tdStyle, textAlign: 'center', color: u.personal ? COLORS.personal : '#d1d5db', fontWeight: u.personal ? 600 : 400 }">
                {{ u.personal }}
              </td>
              <td :style="{ ...tdStyle, textAlign: 'center', color: u.maternity ? COLORS.maternity : '#d1d5db', fontWeight: u.maternity ? 600 : 400 }">
                {{ u.maternity }}
              </td>
              <td :style="{ ...tdStyle, textAlign: 'center', fontWeight: 700 }">{{ u.total }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ---------- สถิติลาพักผ่อน ---------- -->
    <div v-else-if="kind === 'vac-stats'">
      <div v-if="vacRows.length === 0" class="empty-state">
        <span class="em">📊</span>ยังไม่มีข้อมูลบุคลากร
      </div>
      <div v-else class="table-wrap">
        <table class="tbl vac-stats-grid">
          <thead>
            <tr>
              <th class="num">ที่</th>
              <th>ชื่อบุคลากร</th>
              <th>สังกัด/กลุ่มงาน</th>
              <th class="num">สะสม</th>
              <th class="num">ประจำปี</th>
              <th class="num">สิทธิ์รวม</th>
              <th class="num">ใช้ไป — ครั้ง</th>
              <th class="num">ใช้ไป — วัน</th>
              <th class="num">คงเหลือ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in vacRows" :key="r.id">
              <td class="num" style="font-weight: 400; color: #475569">{{ r.seq || i + 1 }}</td>
              <td style="font-weight: 400">
                <div>{{ UI.personName(r) }}</div>
                <div class="hint" style="font-weight: 400">{{ r.position || '' }}</div>
              </td>
              <td style="font-weight: 400">{{ r.workplace || '-' }}</td>
              <td class="num" style="font-weight: 400; color: #2563eb">{{ r.accumulated || 0 }} วัน</td>
              <td class="num" style="font-weight: 400; color: #7c3aed">{{ r.annual || 0 }} วัน</td>
              <td class="num" style="font-weight: 400">{{ r.total || 0 }} วัน</td>
              <td class="num" style="font-weight: 400; color: r.usedTimes ? '#b45309' : '#9ca3af'">
                {{ r.usedTimes || 0 }} ครั้ง
              </td>
              <td class="num" style="font-weight: 400; color: r.used ? '#dc2626' : '#9ca3af'">{{ r.used }} วัน</td>
              <td class="num" style="font-weight: 400; color: r.remaining <= 3 ? '#dc2626' : '#059669'">
                {{ r.remaining }} วัน
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ---------- สถิติการลาของฉัน ---------- -->
    <div v-else-if="mine">
      <div style="margin-bottom: 10px; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap">
        <span style="font-weight: 700; font-size: 15px">{{ mine.name }}</span>
        <span class="hint">{{ mine.position }}</span>
      </div>

      <div class="table-wrap">
        <table class="tbl my-stats-table">
          <thead>
            <tr>
              <th rowspan="2" :style="{ ...thStyle, textAlign: 'left', background: '#2563eb', color: '#fff' }">ประเภท</th>
              <th colspan="3" :style="{ ...thStyle, background: '#2563eb', color: '#fff' }">วันลาพักผ่อนประจำปี</th>
              <th colspan="2" :style="{ ...thStyle, background: '#2563eb', color: '#fff' }">สถิติการลา</th>
              <th rowspan="2" :style="{ ...thStyle, background: '#2563eb', color: '#fff' }">เหลือ</th>
            </tr>
            <tr>
              <th v-for="h in ['สะสม', 'ปีนี้', 'รวม', 'ครั้ง', 'วัน']" :key="h" :style="{ ...thStyle, background: '#3b82f6', color: '#fff' }">
                {{ h }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr style="background: #fffbeb">
              <td :style="{ ...tdStyle, padding: '7px 12px', fontWeight: 700 }">ลาพักผ่อน</td>
              <td :style="{ ...tdStyle, padding: '7px 12px', textAlign: 'center', fontWeight: 600, color: '#2563eb' }">{{ mine.accumulated }}</td>
              <td :style="{ ...tdStyle, padding: '7px 12px', textAlign: 'center', fontWeight: 600, color: '#7c3aed' }">{{ mine.annual }}</td>
              <td :style="{ ...tdStyle, padding: '7px 12px', textAlign: 'center', fontWeight: 700, background: '#fef3c7' }">{{ mine.vacTotal }}</td>
              <td :style="{ ...tdStyle, padding: '7px 12px', textAlign: 'center', fontWeight: 600 }">{{ mine.vacTimes }}</td>
              <td :style="{ ...tdStyle, padding: '7px 12px', textAlign: 'center', fontWeight: 600 }">{{ mine.vacDays }}</td>
              <td :style="{ ...tdStyle, padding: '7px 12px', textAlign: 'center', fontWeight: 700, background: '#fef3c7' }">{{ mine.vacRemain }}</td>
            </tr>
            <tr v-for="g in myGeneral" :key="g.label">
              <td :style="{ ...tdStyle, padding: '7px 12px', fontWeight: 700 }">{{ g.label }}</td>
              <td colspan="3" :style="{ ...tdStyle, padding: '7px 12px' }"></td>
              <td :style="{ ...tdStyle, padding: '7px 12px', textAlign: 'center', fontWeight: 600 }">{{ g.v }}</td>
              <td :style="{ ...tdStyle, padding: '7px 12px', textAlign: 'center', fontWeight: 600 }">{{ g.v }}</td>
              <td :style="{ ...tdStyle, padding: '7px 12px', textAlign: 'center' }">{{ g.v }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="hint" style="margin-top: 8px">
        รวมทั้งหมด {{ mine.grand }} วัน (ลาป่วย/กิจ/คลอด {{ mine.generalTotal }} วัน + ลาพักผ่อน
        {{ mine.vacDays }} วัน) — นับเฉพาะคำขอที่อนุมัติแล้ว
      </div>
    </div>

    <!-- ---------- หน้าต่างส่งออก ---------- -->
    <LeaveStatsExport
      v-if="exportOpen"
      :sheet-label="exportSheet"
      :kind="kind"
      @close="exportOpen = false"
      @exported="emit('changed')"
    />
  </div>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
