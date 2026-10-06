<script setup>
/**
 * VehicleDoc — แบบฟอร์มทางการ "บันทึกการขอใช้ยานพาหนะ" พร้อมปุ่มพิมพ์
 *
 * Phase 5: เขียนใหม่เป็น Vue component
 * (เดิมเป็น showVehicleDocument() + printDocument() ใน VehiclesView.js)
 *
 * class ทั้งหมดมาจาก theme.css ของระบบเดิม:
 *   .doc .doc-title .doc-row .doc-label .doc-line .doc-sub .doc-close
 *   .doc-sigs .doc-sig-block .doc-sig-label .doc-sig .doc-sig-empty
 *   .doc-sig-name .doc-sig-pos .doc-rec .doc-rec-check
 */
import { ref, computed, onMounted } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import AppModal from './AppModal.vue';

const props = defineProps({
  /** id ของรายการจอง */
  bookingId: { type: Number, required: true },
  /** ชื่อยานพาหนะ/ทะเบียนจากรายการ (ใช้แสดงในเนื้อหา) */
  vehicleName: { type: String, default: '' },
  plate: { type: String, default: '' },
});

const emit = defineEmits(['close']);

const loading = ref(true);
const error = ref('');
const d = ref(null);

const row = computed(() => (d.value ? d.value.row : null));
const fuelText = computed(() => (row.value && row.value.fuel_choice) || '-');

onMounted(async () => {
  try {
    d.value = await api.get(`/vehicle-bookings/${props.bookingId}/document`);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});

/** แถว "ป้าย: ค่า" */
function L(label, content) {
  return { label, content };
}

/** ข้อความ "ขอพระอนุญาต..." แบบบรรทัดเต็ม */
function line(text, sub) {
  return { text, sub };
}

const rows = computed(() => {
  const r = row.value;
  if (!r) return [];
  return [
    L('วันที่', UI.thaiFullDate(r.created_at)),
    L('เรื่อง', 'ขออนุญาตใช้รถราชการ'),
    L('เรียน', 'ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2'),
    L(
      'ข้าพเจ้า',
      `${UI.personName({
        title: r.req_title,
        full_name: r.req_name,
        first_name: r.req_first_name,
        last_name: r.req_last_name,
      })}  ตำแหน่ง ${r.req_position || '-'}`,
    ),
    L('สถานที่ไปราชการ', r.destination || '-'),
    L('วัตถุประสงค์', r.purpose || '-'),
    L('ตั้งแต่วันที่', UI.thaiFullDate(r.date)),
    L('ถึงวันที่', r.date_to ? UI.thaiFullDate(r.date_to) : UI.thaiFullDate(r.date)),
  ];
});

/** บรรทัดเนื้อหาที่ต้องเรียงตามลำดับเดิม */
const lines = computed(() => {
  const r = row.value;
  if (!r) return [];
  const out = [];
  out.push(
    line(
      `ขออนุญาตใช้รถราชการ ${
        props.vehicleName
          ? `${props.vehicleName}${props.plate ? ` (ทะเบียน ${props.plate})` : ''}`
          : 'โดยมอบเจ้าหน้าที่จัดให้'
      }`,
    ),
  );
  out.push(line(`รวม ${r.total_days || 1} วัน`));
  out.push(line(`มีผู้โดยสารทั้งหมด ${r.passenger_count || 0} คน`));
  out.push(line(`ผู้ควบคุมรถคือ ${r.controller || '-'}`));
  out.push(line(`เชื้อเพลิง ${fuelText.value}`));
  if (r.fuel_project) out.push(line(`โครงการ ${r.fuel_project}`, true));
  if (r.fuel_activity) out.push(line(`กิจกรรม ${r.fuel_activity}`, true));
  if (Number(r.fuel_amount)) out.push(line(`จำนวนเงิน ${Number(r.fuel_amount).toFixed(2)} บาท`, true));
  return out;
});

/** กลุ่มลายเซ็น 3 ช่อง */
const sigs = computed(() => {
  const r = row.value;
  if (!r) return [];
  return [
    {
      label: 'ส่วนของผู้ขออนุญาตใช้ยานพาหนะ',
      person: {
        title: r.req_title,
        full_name: r.req_name,
        first_name: r.req_first_name,
        last_name: r.req_last_name,
        position: r.req_position,
        signature: r.req_signature,
      },
      pre: null,
    },
    {
      label: 'ส่วนของเจ้าหน้าที่',
      person: d.value.staff || null,
      pre: d.value.driver ? `เห็นควรให้ ${UI.personName(d.value.driver)} เป็นพนักงานขับรถในราชการนี้` : null,
    },
    {
      label: 'ส่วนของผู้อนุมัติ',
      person: d.value.finalApprover || null,
      pre: d.value.finalApprover ? 'อนุมัติ' : null,
    },
  ];
});

/** พิมพ์เอกสาร — เปิดหน้าต่างใหม่แล้วเอา CSS ของระบบไปด้วย */
function printDoc() {
  const el = document.getElementById('vehicle-doc-print');
  if (!el) return;
  const css = document.querySelector('link[href*="theme"], link[href*="index-"]');
  const styleTag = css ? `<link rel="stylesheet" href="${css.href}">` : '';
  const w = window.open('', '_blank', 'width=900,height=1200');
  if (!w) return UI.toast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต pop-up', 'error');
  w.document.write(
    `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>บันทึกการขอใช้ยานพาหนะ</title>${styleTag}` +
      `<style>body{background:#f0f2f5;padding:32px;margin:0}@media print{body{background:#fff;padding:0}}</style>` +
      `</head><body>${el.outerHTML}</body></html>`,
  );
  w.document.close();
  setTimeout(() => {
    w.focus();
    w.print();
  }, 400);
}

</script>

<template>
  <AppModal title="▭ บันทึกการขอใช้ยานพาหนะ" size="lg" footer @close="emit('close')">
    <div v-if="loading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
    <div v-else-if="error" class="empty-state"><span class="em">⚠️</span>{{ error }}</div>

    <div v-else id="vehicle-doc-print" class="doc">
      <div class="doc-title">บันทึกการขอใช้ยานพาหนะ</div>

      <div v-for="(x, i) in rows" :key="'r' + i" class="doc-row">
        <span class="doc-label">{{ x.label }}</span>
        <span>{{ x.content }}</span>
      </div>

      <div v-for="(x, i) in lines" :key="'l' + i" class="doc-line" :class="{ 'doc-sub': x.sub }">
        {{ x.text }}
      </div>

      <p class="doc-close">จึงเรียนมาเพื่อโปรดพิจารณาอนุญาต</p>

      <div class="doc-sigs">
        <div v-for="(s, i) in sigs" :key="'s' + i" class="doc-sig-block">
          <div class="doc-sig-label">{{ s.label }}</div>
          <div v-if="s.pre" class="doc-rec">
            <span class="doc-rec-check">
              <svg width="14" height="14" viewBox="0 0 14 14" style="display: block">
                <rect x="1" y="1" width="12" height="12" fill="white" stroke="#111" stroke-width="1.4" />
                <path
                  d="M3.5 7 L6 9.5 L10.5 4.5"
                  stroke="#111"
                  stroke-width="1.8"
                  fill="none"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span>{{ s.pre }}</span>
          </div>
          <img
            v-if="s.person && s.person.signature"
            class="doc-sig"
            :src="'/uploads/' + UI.encodePath(s.person.signature)"
            alt="ลายเซ็น"
          />
          <div v-else class="doc-sig-empty">(ยังไม่มีลายเซ็น)</div>
          <div class="doc-sig-name">
            {{ s.person && (s.person.full_name || s.person.first_name) ? UI.personName(s.person) : '-' }}
          </div>
          <div class="doc-sig-pos">{{ (s.person && s.person.position) || '-' }}</div>
        </div>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-outline" @click="emit('close')">ปิด</button>
      <button class="btn btn-primary" :disabled="loading || error" @click="printDoc">⬢ พิมพ์</button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
