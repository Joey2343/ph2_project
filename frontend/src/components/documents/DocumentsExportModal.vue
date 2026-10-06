<script setup>
/**
 * DocumentsExportModal — ดาวน์โหลดข้อมูลหนังสือราชการเป็น Excel
 *
 * ย้ายจาก DocumentsView.openExportDialog() (125 บรรทัด)
 *
 * ตัวกรองปี → เดือน → สัปดาห์ เรียงลำดับกัน และเลือกได้เฉพาะบางช่อง
 * เว้นไว้ทั้งหมด = ดาวน์โหลดทุกรายการของแท็บปัจจุบัน
 *
 * สัปดาห์ยึดวันจันทร์–อาทิตย์ และตัดให้เหลือเฉพาะช่วงที่ตกในเดือนที่เลือก
 */
import { ref, computed, watch, onMounted } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import { docTypeMeta, exportColsFor, listUrlFor, fileNamesText, TH_MONTHS, TH_M_ABBR, pad2 } from '../../lib/documents.js';
import AppModal from '../ui/AppModal.vue';

const props = defineProps({
  /** แท็บที่กำลังดูอยู่ (incoming / outgoing / ...) */
  currentType: { type: String, default: 'incoming' },
  /** ปี พ.ศ. ที่เลือกไว้ในหน้าหลัก — ใช้เป็นค่าเริ่มต้น */
  currentYear: { type: [String, Number], default: '' },
});

const emit = defineEmits(['close']);

const meta = computed(() => docTypeMeta(props.currentType));

/* ---------- ตัวกรอง ---------- */
const years = ref([]);
const year = ref('');
const month = ref('');
const week = ref('');

const weekDisabled = computed(() => !year.value || !month.value);

/**
 * ตัวเลือกสัปดาห์ของเดือนที่เลือก
 *
 * คืนค่าเป็น { value, label } — value เป็น "YYYY-MM-DD|YYYY-MM-DD" เพื่อให้เทียบกับ r.date ได้ตรง ๆ
 */
const weekOptions = computed(() => {
  if (weekDisabled.value) return [];
  const yBE = parseInt(year.value, 10);
  const m = parseInt(month.value, 10);
  if (!yBE || !m) return [];

  const yCE = yBE - 543;
  const monthStart = new Date(yCE, m - 1, 1);
  const monthEnd = new Date(yCE, m - 1, new Date(yCE, m, 0).getDate());

  // ถอยไปวันจันทร์ของสัปดาห์แรกที่ครอบคลุม 1 เดือนนี้
  const start = new Date(monthStart);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));

  const out = [];
  const cur = new Date(start);
  for (let i = 0; i < 6; i++) {
    const end = new Date(cur);
    end.setDate(end.getDate() + 6);
    if (end < monthStart) {
      cur.setDate(cur.getDate() + 7);
      continue;
    }
    if (cur > monthEnd) break;
    const s = new Date(Math.max(cur.getTime(), monthStart.getTime()));
    const e = new Date(Math.min(end.getTime(), monthEnd.getTime()));
    const fmt = (x) => x.getDate() + ' ' + TH_M_ABBR[x.getMonth()];
    const n = out.length + 1;
    out.push({
      value: `${s.getFullYear()}-${pad2(s.getMonth() + 1)}-${pad2(s.getDate())}|${e.getFullYear()}-${pad2(e.getMonth() + 1)}-${pad2(e.getDate())}`,
      label: `สัปดาห์ที่ ${n} (${fmt(s)} - ${fmt(e)} ${s.getFullYear() + 543})`,
    });
    cur.setDate(cur.getDate() + 7);
  }
  return out;
});

// เปลี่ยนเดือนแล้วสัปดาห์เดิมอาจไม่มีอยู่ → ล้างค่า
watch([year, month], () => {
  week.value = '';
});

/* ---------- ส่งออก ---------- */
const busy = ref(false);

async function doExport() {
  if (busy.value) return;
  busy.value = true;
  try {
    const yBE = year.value;
    const m = parseInt(month.value, 10) || 0;
    const wk = (week.value || '').split('|');

    const qs = [];
    if (yBE) qs.push('year=' + encodeURIComponent(yBE));

    // endpoint ต้องตรงกับที่หน้าหลักใช้โหลดตาราง จึงดึงข้อมูลได้เหมือนกัน
    const url = listUrlFor(props.currentType, qs);
    UI.toast('กำลังเตรียมข้อมูล...', 'success', 1500);

    const data = await api.get(url);
    let docs = data.documents || [];

    // กรองเดือน/สัปดาห์จากวันที่เอกสาร (r.date = YYYY-MM-DD)
    if (m) docs = docs.filter((r) => r.date && parseInt(String(r.date).slice(5, 7), 10) === m);
    if (wk.length === 2 && wk[0]) docs = docs.filter((r) => r.date && String(r.date) >= wk[0] && String(r.date) <= wk[1]);

    // จำนวนผู้รับ (เฉพาะแท็บหนังสือส่ง) — ไม่มีใน payload รายการ ต้องดึงเพิ่ม
    const recCounts = {};
    if (props.currentType === 'outgoing' && docs.length) {
      const counts = await Promise.all(
        docs.map((d) =>
          api
            .get('/document-recipients/' + d.id)
            .then((r) => ({ id: d.id, count: (r.recipients || []).length }))
            .catch(() => ({ id: d.id, count: 0 })),
        ),
      );
      counts.forEach((c) => {
        recCounts[c.id] = c.count;
      });
    }

    const colDefs = exportColsFor(props.currentType);

    /** แปลงค่า field เป็นข้อความสำหรับ Excel — มี field พิเศษที่ต้องคำนวณ */
    const cell = (key, r) => {
      if (key === 'is_read') return r.is_read === undefined ? '' : r.is_read ? 'อ่านแล้ว' : 'ใหม่';
      if (key === 'date') return r.date ? UI.date(r.date) : '';
      if (key === 'recipients') return recCounts[r.id] != null ? String(recCounts[r.id]) : '';
      if (key === 'person') return (r.person_name || '-') + (r.person_school ? ' | ' + r.person_school : '');
      if (key === 'file') return fileNamesText(r.file);
      const v = r[key];
      return v === null || v === undefined ? '' : String(v);
    };

    const headers = colDefs.map((c) => c[1]);
    const rows = docs.map((r) => colDefs.map((c) => cell(c[0], r)));

    // ชื่อไฟล์ประกอบตัวกรองที่เลือก
    const tabLabel = meta.value.label.replace('▭ ', '');
    const filt = [];
    if (yBE) filt.push('ปี ' + yBE);
    if (m) filt.push(TH_MONTHS[m - 1]);
    const wkOpt = weekOptions.value.find((w) => w.value === week.value);
    if (wkOpt) filt.push(wkOpt.label);

    const fname = ('หนังสือราชการ_' + tabLabel.replace(/\s+/g, '') + (filt.length ? '_' + filt.join('_') : '')).replace(
      /[\\/:*?"<>|]/g,
      '',
    );
    UI.exportExcel(fname, tabLabel + (filt.length ? ' (' + filt.join(' | ') + ')' : ''), headers, rows);
    UI.toast(`ดาวน์โหลดแล้ว ${docs.length} รายการ`, 'success');
    emit('close');
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}

/* ---------- โหลดปีที่มีข้อมูลจริง ---------- */
onMounted(async () => {
  try {
    const d = await api.get('/document-years');
    years.value = d.years || [];
  } catch {
    years.value = [new Date().getFullYear() + 543];
  }
  // เริ่มต้นที่ปีของหน้าหลัก ถ้าไม่มีใช้ปีล่าสุดที่มีข้อมูล
  year.value = String(props.currentYear || (years.value[0] ? years.value[0] : ''));
});
</script>

<template>
  <AppModal title="⬇ ดาวน์โหลดข้อมูล" size="md" footer @close="emit('close')">
    <div style="padding: 4px 2px">
      <div style="margin-bottom: 12px; font-weight: 700; font-size: 13.5px; color: #0f766e">
        แท็บ: {{ meta.label.replace('▭ ', '') }}
      </div>

      <div style="display: flex; flex-direction: column; gap: 10px">
        <div style="display: flex; align-items: center; gap: 12px">
          <div style="width: 90px; font-weight: 600; font-size: 13.5px; color: #334155">ปี พ.ศ.</div>
          <select v-model="year" style="min-width: 170px">
            <option value="">ทุกปี (พ.ศ.)</option>
            <option v-for="y in years" :key="y" :value="String(y)">ปี พ.ศ. {{ y }}</option>
          </select>
        </div>

        <div style="display: flex; align-items: center; gap: 12px">
          <div style="width: 90px; font-weight: 600; font-size: 13.5px; color: #334155">เดือน</div>
          <select v-model="month" style="min-width: 160px">
            <option value="">ทุกเดือน</option>
            <option v-for="(m, i) in TH_MONTHS" :key="i" :value="String(i + 1)">{{ m }}</option>
          </select>
        </div>

        <div style="display: flex; align-items: center; gap: 12px">
          <div style="width: 90px; font-weight: 600; font-size: 13.5px; color: #334155">สัปดาห์</div>
          <select v-model="week" :disabled="weekDisabled" style="min-width: 230px">
            <option value="">ทุกสัปดาห์</option>
            <option v-for="w in weekOptions" :key="w.value" :value="w.value">{{ w.label }}</option>
          </select>
        </div>

        <div class="hint" style="margin-top: 4px">
          เลือกได้ทั้ง 3 ช่องหรือเฉพาะบางช่อง — เว้นไว้หมด = ดาวน์โหลดทุกรายการของแท็บนี้
        </div>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-outline" @click="emit('close')">ยกเลิก</button>
      <button class="btn btn-primary" style="background: #059669" :disabled="busy" @click="doExport">
        {{ busy ? 'กำลังดาวน์โหลด...' : '⬇ ดาวน์โหลด Excel' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
/* select/button ทั้งหมดใช้สไตล์จาก theme.css */
</style>
