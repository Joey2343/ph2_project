<script setup>
/**
 * LeaveDoc — ใบลา A4 (ฉบับสำเร็จ) พร้อมลายเซ็น สถิติการลา และความเห็นผู้อนุมัติ
 *
 * ย้ายจาก openView() ใน LeaveView.js
 *
 * ต่างจาก TravelDoc.vue: ต้องโหลดข้อมูลเพิ่ม 3 ชุด (ผู้ขอ, สถิติ, ลายเซ็นผู้อนุมัติแต่ละขั้น)
 * และมีตารางสถิติการลา 2 รูปแบบ (ลาพักผ่อน / ลาป่วย-กิจ-คลอด)
 */
import { ref, computed, onMounted } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import AppModal from './AppModal.vue';
import StatusBadge from './StatusBadge.vue';
import ApprovalSteps from './ApprovalSteps.vue';

const props = defineProps({
  record: { type: Object, required: true },
});

const emit = defineEmits(['close']);

const loading = ref(true);
const error = ref('');
const userData = ref({});
const statsData = ref([]);

/** ลายเซ็น/ชื่อ/ตำแหน่งของผู้อนุมัติแต่ละขั้น (โหลดตามขั้นที่มีจริง) */
const signerL1 = ref(null);
const signerL2 = ref(null);
const signerL3 = ref(null);
const delegateName = ref('');
const vacBalance = ref(null);

const r = computed(() => props.record);
const approvals = computed(() => props.record.approvals || []);

function approvalAt(level) {
  return approvals.value.find((a) => a.level === level) || null;
}

/** สถิติที่ใช้แสดง: ถ้าผู้ตรวจสอบแก้ไขไว้ให้ใช้ค่านั้นแทน (ตรงกับของเดิม) */
const finalStats = computed(() => {
  try {
    const rs = props.record.reviewed_stats;
    const parsed = typeof rs === 'string' ? JSON.parse(rs) : rs;
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    /* ข้อมูลเสียรูปแบบ → ใช้ค่าจาก API */
  }
  return statsData.value;
});

function usedOf(type) {
  return (finalStats.value.find((s) => s.leave_type === type) || {}).used || 0;
}

/** ชื่อ/ตำแหน่งประจำตัวผู้ยื่น */
const nameReq = computed(() => {
  const u = userData.value;
  const x = r.value;
  const first = [
    (x.title || u.title || '') + (x.first_name || u.first_name || x.full_name || u.full_name || ''),
    x.last_name || u.last_name || '',
  ]
    .filter(Boolean)
    .join(' ');
  return first || '-';
});
const posReq = computed(() => r.value.position || userData.value.position || '-');
const workReq = computed(() => r.value.workplace || userData.value.workplace || '-');

const headerTitle = computed(() =>
  r.value.leave_type === 'ลาพักผ่อน' ? 'แบบใบลาพักผ่อน' : 'แบบใบลาป่วย ลาคลอดบุตร ลากิจส่วนตัว',
);

const isVacation = computed(() => r.value.leave_type === 'ลาพักผ่อน');
const showReasonInDoc = computed(() => (r.value.leave_type === 'ลากิจ' || r.value.leave_type === 'ลาป่วย') && r.value.reason);

/** ชื่อผู้ตรวจสอบ = ชื่อจริงจาก staff-public ถ้ามี ไม่งั้นใช้ชื่อที่บันทึกไว้ใน approval */
function signerLabel(s, fallbackName) {
  if (!s) return null;
  const first = [(s.title || '') + (s.first_name || fallbackName || ''), s.last_name || '']
    .filter(Boolean)
    .join(' ');
  return first || fallbackName || '-';
}

/** ตัวช่วยโหลดข้อมูลผู้ใช้จาก staff-public */
async function staffPublic(id) {
  if (!id) return null;
  try {
    const d = await api.get('/staff-public/' + id);
    return d.user || d;
  } catch {
    return null;
  }
}

onMounted(async () => {
  loading.value = true;
  error.value = '';
  try {
    const jobs = [
      staffPublic(r.value.user_id).then((d) => (userData.value = d || {})),
      api
        .get('/leave-stats?userId=' + r.value.user_id + '&excludeId=' + (r.value.id || 0))
        .then((d) => (statsData.value = d.stats || []))
        .catch(() => {}),
    ];

    // ลายเซ็นผู้ตรวจสอบ (ขั้น 1) / ผู้อนุมัติขั้นต้น (ขั้น 2) / ผู้อนุมัติ (ขั้น 3)
    const l1 = approvalAt(1);
    const l2 = approvalAt(2);
    const l3 = approvalAt(3);
    if (l1 && l1.by) jobs.push(staffPublic(l1.by).then((d) => (signerL1.value = { ...l1, user: d || {} })));
    if (l2 && l2.by) jobs.push(staffPublic(l2.by).then((d) => (signerL2.value = { ...l2, user: d || {} })));
    if (l3 && l3.by) jobs.push(staffPublic(l3.by).then((d) => (signerL3.value = { ...l3, user: d || {} })));

    if (r.value.delegate_to) {
      jobs.push(staffPublic(r.value.delegate_to).then((d) => (delegateName.value = d ? UI.personName(d) : '-')));
    }
    if (isVacation.value) {
      jobs.push(api.get('/my-leave-balance').then((d) => (vacBalance.value = d)).catch(() => {}));
    }

    await Promise.all(jobs);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});

/* ---------- วันที่ไทยเต็ม ---------- */
const MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
function thaiFull(d) {
  if (!d) return '-';
  const p = String(d).slice(0, 10).split('-');
  if (p.length !== 3) return String(d);
  return `วันที่ ${parseInt(p[2], 10)} ${MONTHS[parseInt(p[1], 10) - 1]} พ.ศ.${parseInt(p[0], 10) + 543}`;
}

const requesterSig = computed(() =>
  userData.value.signature ? '/uploads/' + UI.encodePath(userData.value.signature) : '',
);

function sigOf(s) {
  return s && s.user && s.user.signature ? '/uploads/' + UI.encodePath(s.user.signature) : '';
}

/* ---------- พิมพ์ ---------- */
function printDoc() {
  const el = document.getElementById('leave-doc-print');
  if (!el) return;
  const css = document.querySelector('link[href*="theme"], link[href*="index-"]');
  const styleTag = css ? `<link rel="stylesheet" href="${css.href}">` : '';
  const w = window.open('', '_blank', 'width=900,height=1200');
  if (!w) return UI.toast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต pop-up', 'error');
  w.document.write(
    `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">` +
      `<title>ใบ${r.value.leave_type} ${r.value.leave_no || ''}</title>${styleTag}` +
      `<style>@page{size:A4;margin:1.5cm}body{background:#f0f2f5;padding:24px;margin:0}` +
      `@media print{body{background:#fff;padding:0}}</style>` +
      `</head><body>${el.outerHTML}</body></html>`,
  );
  w.document.close();
  setTimeout(() => {
    w.focus();
    w.print();
  }, 400);
}

const P = { textIndent: '80px', margin: '0 0 10px 0', fontSize: '20px' };
const SPAN = { marginRight: '40px' };
</script>

<template>
  <AppModal
    :title="'▭ ใบ' + r.leave_type + ' ' + (r.leave_no || '')"
    size="lg"
    footer
    @close="emit('close')"
  >
    <div v-if="loading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
    <div v-else-if="error" class="empty-state"><span class="em">⚠️</span>{{ error }}</div>

    <div
      v-else
      id="leave-doc-print"
      style="max-width: 900px; margin: 0 auto; padding: 21px 5px 0 35px; font-family: 'THSarabunIT๙', 'TH Sarabun', 'THSarabun', sans-serif; font-size: 20px; line-height: 1.55; color: #1f2937; background: #fff; position: relative"
    >
      <!-- ---------- ส่วนหัว ---------- -->
      <div style="text-align: center; margin-bottom: 15px">
        <div style="font-size: 26px; font-weight: bold; text-decoration: underline; margin-bottom: 15px">
          {{ headerTitle }}
        </div>
      </div>

      <div style="text-align: right; margin-bottom: 10px; font-size: 20px">
        <div>เขียนที่ {{ r.writing_at || 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2' }}</div>
        <div>{{ r.created_at ? thaiFull(r.created_at) : '-' }}</div>
      </div>

      <div style="margin-bottom: 8px; font-size: 20px">
        <span style="font-weight: bold">เรื่อง&nbsp;&nbsp;</span>{{ r.leave_type || '-' }}
      </div>

      <div style="margin-bottom: 15px; font-size: 20px">
        <span style="font-weight: bold">เรียน&nbsp;&nbsp;</span>ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2
      </div>

      <!-- ---------- เนื้อหา ---------- -->
      <div style="font-size: 20px; line-height: 1.8; text-align: justify; margin-top: 10px">
        <p :style="{ ...P, textIndent: '80px' }">
          <span :style="SPAN">ข้าพเจ้า</span>{{ nameReq }}
          <span :style="{ ...SPAN, marginLeft: '40px' }">ตำแหน่ง</span>{{ posReq }}
        </p>

        <p :style="P">
          <span :style="SPAN">สังกัด</span>{{ workReq }} สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2
        </p>

        <!-- สิทธิ์วันลาพักผ่อน (เฉพาะใบลาพักผ่อน) -->
        <p v-if="isVacation && vacBalance" :style="P">
          มีวันลาพักผ่อนสะสม {{ vacBalance.accumulated || 0 }} วันทำการ, มีสิทธิ์ลาพักผ่อนประจำปีนี้อีก
          {{ vacBalance.annual || 10 }} วันทำการ, รวมเป็น
          {{ vacBalance.total || (vacBalance.accumulated + vacBalance.annual) || 10 }} วันทำการ
        </p>

        <p v-if="isVacation" :style="P"><span :style="SPAN">ขอลาพักผ่อน</span></p>
        <p v-else :style="P">
          <span :style="SPAN">ขอลา</span>{{ r.leave_type }}
          <template v-if="showReasonInDoc">
            <span :style="SPAN">เนื่องจาก</span>{{ r.reason }}
          </template>
        </p>

        <p :style="P">
          <span :style="SPAN">ตั้งแต่วันที่</span>
          <span :style="SPAN">{{ UI.thaiDate(r.date_from) }}</span>
          <span :style="SPAN">ถึง</span>
          <span :style="SPAN">{{ UI.thaiDate(r.date_to) }}</span>
          <span style="margin-right: 5px">มีกำหนด</span> {{ r.days }} วัน
        </p>

        <p v-if="r.last_leave_from || r.last_leave_to" :style="P">
          <span :style="SPAN">ลาครั้งสุดท้ายเมื่อ</span>
          <span :style="SPAN">{{ UI.thaiDate(r.last_leave_from) }}</span>
          <span :style="SPAN">ถึง</span>
          <span :style="SPAN">{{ UI.thaiDate(r.last_leave_to) }}</span>
          <template v-if="r.last_leave_days">
            <span style="margin-right: 5px">มีกำหนด</span> {{ r.last_leave_days }} วัน
          </template>
        </p>

        <p :style="P">
          <span :style="SPAN">ระหว่างลาติดต่อข้าพเจ้าได้ที่</span>
          <span :style="SPAN">{{ r.address || '-' }}</span>
          <span :style="SPAN">เบอร์โทรศัพท์</span>{{ r.phone || '-' }}
        </p>

        <p v-if="r.attachment" :style="{ ...P, textIndent: '40px' }">เอกสารแนบ {{ r.attachment }}</p>

        <p v-if="r.delegate_to" :style="P">
          <span :style="SPAN">มอบหมายงานให้</span>{{ delegateName || '-' }}
          <span :style="{ ...SPAN, marginLeft: '40px' }">ทำหน้าที่แทน</span>
        </p>
      </div>

      <!-- ---------- ลงชื่อผู้ยื่น ---------- -->
      <div style="text-align: center; margin-top: 30px; margin-bottom: 15px">
        <div style="margin-bottom: 20px; font-size: 20px">ขอแสดงความนับถือ</div>
        <img
          v-if="requesterSig"
          :src="requesterSig"
          style="max-height: 60px; display: block; margin: 0 auto 5px auto"
          alt="ลายเซ็น"
        />
        <div>({{ nameReq }})</div>
        <div>{{ posReq }}</div>
      </div>

      <!-- ---------- สถิติการลา + ความเห็นผู้อนุมัติ ---------- -->
      <div style="display: flex; align-items: flex-start; margin-top: 15px; margin-bottom: 10px">
        <!-- ซ้าย: สถิติการลา + ผู้ตรวจสอบ -->
        <div style="flex: 1; font-size: 14px; text-align: left">
          <div style="font-weight: bold; margin-bottom: 5px; font-size: 16px">
            สถิติการลาในปีงบประมาณนี้
          </div>

          <!-- ลาพักผ่อน: 3 คอลัมน์ -->
          <table v-if="isVacation" style="border-collapse: collapse; font-size: 13px; width: auto">
            <thead>
              <tr style="background: #f1f5f9">
                <th style="padding: 4px 12px; border: 1px solid #d1d5db; text-align: center">
                  ลามาแล้ว<br />(วันทำการ)
                </th>
                <th style="padding: 4px 12px; border: 1px solid #d1d5db; text-align: center">
                  ลาครั้งนี้<br />(วันทำการ)
                </th>
                <th style="padding: 4px 12px; border: 1px solid #d1d5db; text-align: center; font-weight: 700">
                  รวมเป็น<br />(วันทำการ)
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding: 4px 12px; border: 1px solid #d1d5db; text-align: center">
                  {{ usedOf('ลาพักผ่อน') }}
                </td>
                <td style="padding: 4px 12px; border: 1px solid #d1d5db; text-align: center">{{ r.days || 1 }}</td>
                <td style="padding: 4px 12px; border: 1px solid #d1d5db; text-align: center; font-weight: 700; color: #059669">
                  {{ usedOf('ลาพักผ่อน') + (r.days || 1) }}
                </td>
              </tr>
            </tbody>
          </table>

          <!-- ลาป่วย/กิจ/คลอด: ตารางเต็ม -->
          <table v-else class="leave-stats-table">
            <thead>
              <tr>
                <th>ประเภทการลา</th>
                <th>ลามาแล้ว</th>
                <th>ลาครั้งนี้</th>
                <th style="font-weight: 700">รวมเป็น</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="text-align: left">ป่วย</td>
                <td>{{ usedOf('ลาป่วย') }}</td>
                <td>{{ r.leave_type === 'ลาป่วย' ? r.days || 1 : 0 }}</td>
                <td style="font-weight: 700; color: #059669">
                  {{ usedOf('ลาป่วย') + (r.leave_type === 'ลาป่วย' ? r.days || 1 : 0) }}
                </td>
              </tr>
              <tr>
                <td style="text-align: left">กิจส่วนตัว</td>
                <td>{{ usedOf('ลากิจ') }}</td>
                <td>{{ r.leave_type === 'ลากิจ' ? r.days || 1 : 0 }}</td>
                <td style="font-weight: 700; color: #059669">
                  {{ usedOf('ลากิจ') + (r.leave_type === 'ลากิจ' ? r.days || 1 : 0) }}
                </td>
              </tr>
              <tr>
                <td style="text-align: left">คลอดบุตร</td>
                <td>{{ usedOf('ลาคลอดบุตร') }}</td>
                <td>{{ r.leave_type === 'ลาคลอดบุตร' ? r.days || 1 : 0 }}</td>
                <td style="font-weight: 700; color: #059669">
                  {{ usedOf('ลาคลอดบุตร') + (r.leave_type === 'ลาคลอดบุตร' ? r.days || 1 : 0) }}
                </td>
              </tr>
            </tbody>
          </table>

          <!-- ผู้ตรวจสอบ -->
          <div style="margin-top: 8px; font-size: 20px; font-weight: bold; text-decoration: underline; text-align: left">
            ผู้ตรวจสอบ
          </div>
          <div v-if="r.reviewed && signerL1" style="margin-top: 10px; text-align: center; width: fit-content; font-size: 20px">
            <img
              v-if="sigOf(signerL1)"
              :src="sigOf(signerL1)"
              style="max-height: 50px; display: block; margin: 0 auto 3px auto"
              alt="ลายเซ็น"
            />
            <div>({{ signerLabel(signerL1, signerL1.name) }})</div>
            <div>{{ (signerL1.user && signerL1.user.position) || 'ผู้ตรวจสอบ' }}</div>
            <div v-if="signerL1.at" style="margin-top: 3px">{{ thaiFull(signerL1.at) }}</div>
          </div>
        </div>

        <!-- ขวา: ความเห็นผู้บังคับบัญชา + คำสั่ง -->
        <div style="flex: 1; font-size: 20px; text-align: center; padding-left: 20px; width: fit-content; margin: 0 auto">
          <template v-if="signerL2">
            <div style="font-weight: bold; margin-bottom: 5px; font-size: 20px; text-align: left; text-decoration: underline">
              ความเห็นผู้บังคับบัญชา
            </div>
            <div v-if="signerL2.note" style="margin-bottom: 10px; font-size: 20px; text-align: center">
              {{ signerL2.note }}
            </div>
            <img
              v-if="sigOf(signerL2)"
              :src="sigOf(signerL2)"
              style="max-height: 50px; display: block; margin: 0 auto 3px auto"
              alt="ลายเซ็น"
            />
            <div>({{ signerLabel(signerL2, signerL2.name) }})</div>
            <div>{{ (signerL2.user && signerL2.user.position) || 'ผู้อนุมัติขั้นต้น' }}</div>
            <div v-if="signerL2.at" style="margin-top: 3px">{{ thaiFull(signerL2.at) }}</div>
          </template>

          <template v-if="signerL3">
            <div style="margin-top: 20px; border-top: 1px solid #d1d5db; padding-top: 10px"></div>
            <div style="font-weight: bold; margin-bottom: 5px; font-size: 20px; text-align: left; text-decoration: underline">
              คำสั่ง
            </div>
            <div style="font-size: 20px; text-align: center; margin-bottom: 10px; line-height: 1.8">
              <span style="margin-right: 15px">☑&nbsp; อนุญาต</span>
              <span>☐&nbsp; ไม่อนุญาต</span>
            </div>
            <img
              v-if="sigOf(signerL3)"
              :src="sigOf(signerL3)"
              style="max-height: 50px; display: block; margin: 0 auto 3px auto"
              alt="ลายเซ็น"
            />
            <div>({{ signerLabel(signerL3, signerL3.name) }})</div>
            <div>{{ (signerL3.user && signerL3.user.position) || 'ผู้อนุมัติ' }}</div>
            <div v-if="signerL3.at" style="margin-top: 3px">{{ thaiFull(signerL3.at) }}</div>
          </template>
        </div>
      </div>
    </div>

    <template #footer>
      <div style="display: flex; gap: 10px; justify-content: flex-end; width: 100%">
        <div style="flex: 1; text-align: left">
          <div style="display: flex; align-items: center; gap: 10px; font-size: 14px">
            <span>สถานะ:</span>
            <StatusBadge :status="r.status" />
          </div>
          <ApprovalSteps :record="r" inline />
        </div>
        <button
          class="btn btn-primary"
          style="font-size: 14px; padding: 8px 24px"
          :disabled="loading"
          @click="printDoc"
        >
          ⬢ พิมพ์
        </button>
        <button class="btn btn-outline" @click="emit('close')">ปิด</button>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
