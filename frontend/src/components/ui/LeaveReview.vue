<script setup>
/**
 * LeaveReview — หน้าต่างผู้ตรวจสอบคำขอลา (ขั้นที่ 1)
 *
 * ย้ายจาก openReview() ใน LeaveView.js
 *
 * จุดสำคัญของขั้นนี้: ผู้ตรวจสอบ "แก้ไขได้เฉพาะคอลัมน์ลามาแล้ว"
 * ค่าที่แก้จะถูกส่งไปเก็บที่ reviewed_stats แล้วถูกใช้แสดงแทนค่าจาก API
 * (เพราะตอนตรวจสอบอาจไม่ครบทุกประเภท — ดู LeaveDoc.vue)
 */
import { ref, computed, onMounted } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import AppModal from './AppModal.vue';
import ApprovalSteps from './ApprovalSteps.vue';

const props = defineProps({
  record: { type: Object, required: true },
});

const emit = defineEmits(['close', 'done']);

const busy = ref(false);
const statsData = ref([]);

const r = computed(() => props.record);
const isVacation = computed(() => r.value.leave_type === 'ลาพักผ่อน');

const reviewTitle = computed(() =>
  isVacation.value ? 'ตรวจสอบคำขอลาพักผ่อน' : 'ตรวจสอบคำขอลาป่วย ลากิจ ลาคลอด',
);

const statusLabel = computed(() => {
  if (r.value.status === 'pending' && !r.value.reviewed) return '◷ รอตรวจสอบ';
  if (r.value.status === 'pending' && r.value.reviewed) return '◷ รออนุมัติ';
  if (r.value.status === 'approved') return '● อนุมัติแล้ว';
  if (r.value.status === 'rejected') return '✕ ไม่อนุมัติ';
  return r.value.status;
});

/* ---------- ตารางสถิติที่แก้ได้ ---------- */
const TYPES = computed(() =>
  isVacation.value ? ['ลาพักผ่อน'] : ['ลาป่วย', 'ลากิจ', 'ลาคลอดบุตร'],
);

const usedMap = ref({});

onMounted(async () => {
  try {
    const sd = await api.get('/leave-stats?userId=' + r.value.user_id + '&excludeId=' + (r.value.id || 0));
    statsData.value = sd.stats || [];
  } catch {
    /* ไม่มีสถิติ → เริ่มที่ 0 */
  }
  const m = {};
  for (const t of TYPES.value) {
    m[t] = (statsData.value.find((s) => s.leave_type === t) || {}).used || 0;
  }
  usedMap.value = m;
});

/** รวมคอลัมน์ทั้งหมด — ของเดิมรวมทุกช่อง จึงต้องเปลี่ยนเมื่อกดแก้ */
const total = computed(() => TYPES.value.reduce((s, t) => s + (Number(usedMap.value[t]) || 0), 0));

const inputStyle = 'width: 60px; text-align: center; border: 1px solid #d1d5db; border-radius: 4px; padding: 2px 4px; font-size: 13px;';

const tdStyle = 'padding: 4px 12px; border: 1px solid #d1d5db; text-align: center;';
const thStyle = 'padding: 4px 12px; border: 1px solid #d1d5db; text-align: center;';

const HEAD = { sick: 'ป่วย', personal: 'กิจ', maternity: 'คลอดบุตร', vacation: 'ลาพักผ่อน' };
function headOf(t) {
  if (t === 'ลาป่วย') return HEAD.sick;
  if (t === 'ลากิจ') return HEAD.personal;
  if (t === 'ลาคลอดบุตร') return HEAD.maternity;
  return HEAD.vacation;
}

/* ---------- ส่งผล ---------- */
async function doReview() {
  const ok = await UI.confirm(
    `ตรวจสอบคำขอลา ${r.value.leave_type} ของ ${UI.personName(r.value)} แล้ว ยืนยันส่งต่อผู้อนุมัติขั้นต้น?`,
    { okText: '● ตรวจสอบแล้ว' },
  );
  if (!ok) return;
  busy.value = true;
  try {
    const stats = {};
    for (const t of TYPES.value) stats[t] = { used: Number(usedMap.value[t]) || 0 };
    const res = await api.put(`/leaves/${r.value.id}/review`, { reviewed_stats: stats });
    UI.toast(res.message);
    emit('done');
    emit('close');
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}

async function doReject() {
  // ช่องเหตุผลของของเดิมใช้ prompt() ของเบราว์เซอร์ — คงไว้เพื่อไม่ให้พฤติกรรมต่าง
  const note = prompt('เหตุผลที่ไม่อนุญาติ (ไม่บังคับ):') || '';
  const ok = await UI.confirm(`ไม่อนุญาติคำขอลา ${r.value.leave_type} ของ ${UI.personName(r.value)}?`, {
    okText: '✕ ไม่อนุญาติ',
    danger: true,
  });
  if (!ok) return;
  busy.value = true;
  try {
    const res = await api.put(`/leaves/${r.value.id}/reject`, { note });
    UI.toast(res.message);
    emit('done');
    emit('close');
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppModal :title="'▭ ' + reviewTitle + ' — ' + (r.leave_no || '')" size="lg" footer @close="emit('close')">
    <div style="font-size: 14px">
      <!-- ---------- เลขที่ + สถานะ ---------- -->
      <div class="form-grid">
        <div class="form-group">
          <label style="font-weight: 700">เลขที่คำขอ</label>
          <div style="font-weight: 600">{{ r.leave_no || '-' }}</div>
        </div>
        <div class="form-group">
          <label style="font-weight: 700">สถานะ</label>
          <div>{{ statusLabel }}</div>
        </div>
      </div>

      <!-- ---------- หัวเอกสาร ---------- -->
      <div class="form-group full">
        <label style="font-weight: 700">วันที่</label>
        <div style="padding: 4px 0">{{ r.created_at ? UI.thaiDate(r.created_at.slice(0, 10)) : '-' }}</div>
      </div>
      <div class="form-group full">
        <label style="font-weight: 700">เขียนที่</label>
        <div style="padding: 4px 0">{{ r.writing_at || '-' }}</div>
      </div>
      <div class="form-group full">
        <label style="font-weight: 700">เรื่อง</label>
        <div style="padding: 4px 0; font-weight: 600">{{ r.leave_type }}</div>
      </div>
      <div class="form-group full">
        <label style="font-weight: 700">เรียน</label>
        <div style="padding: 4px 0; font-weight: 600">ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2</div>
      </div>
      <div class="form-group full">
        <label style="font-weight: 700">ข้าพเจ้า</label>
        <div style="padding: 4px 0">{{ UI.personName(r) }} {{ r.position || '' }}</div>
      </div>

      <!-- ---------- ช่วงวันลา ---------- -->
      <div class="form-grid">
        <div class="form-group">
          <label style="font-weight: 700">ขอลาตั้งแต่วันที่</label>
          <div style="padding: 4px 0">{{ UI.thaiDate(r.date_from) }}</div>
        </div>
        <div class="form-group">
          <label style="font-weight: 700">ถึงวันที่</label>
          <div style="padding: 4px 0">{{ UI.thaiDate(r.date_to) }}</div>
        </div>
        <div class="form-group">
          <label style="font-weight: 700">มีกำหนด</label>
          <div style="padding: 4px 0">{{ r.days || '-' }} วัน</div>
        </div>
      </div>

      <!-- ---------- ลาครั้งสุดท้าย ---------- -->
      <div
        v-if="r.last_leave_from || r.last_leave_to"
        class="form-group full"
        style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed #e5e7eb"
      >
        <label style="font-weight: 700; color: #6b7280">ลาครั้งสุดท้าย</label>
        <div class="form-grid">
          <div class="form-group">
            <label>ตั้งแต่วันที่</label>
            <div>{{ r.last_leave_from ? UI.thaiDate(r.last_leave_from) : '-' }}</div>
          </div>
          <div class="form-group">
            <label>ถึงวันที่</label>
            <div>{{ r.last_leave_to ? UI.thaiDate(r.last_leave_to) : '-' }}</div>
          </div>
          <div class="form-group">
            <label>มีกำหนด</label>
            <div>{{ r.last_leave_days ? r.last_leave_days + ' วัน' : '-' }}</div>
          </div>
        </div>
      </div>

      <!-- ---------- ติดต่อระหว่างลา ---------- -->
      <div class="form-grid">
        <div class="form-group">
          <label style="font-weight: 700">ระหว่างลาติดต่อได้ที่</label>
          <div style="padding: 4px 0">{{ r.address || '-' }}</div>
        </div>
        <div class="form-group">
          <label style="font-weight: 700">เบอร์โทรศัพท์</label>
          <div style="padding: 4px 0">{{ r.phone || '-' }}</div>
        </div>
      </div>

      <!-- ---------- สถิติการลา (แก้ได้) ---------- -->
      <div class="form-group full" style="margin-top: 10px; padding-top: 10px; border-top: 2px solid #e5e7eb">
        <label style="font-weight: 700; margin-bottom: 6px; display: block">
          📊 สถิติการลาในปีงบประมาณนี้ (แก้ไขได้)
        </label>
        <table style="border-collapse: collapse; font-size: 13px; width: auto">
          <thead>
            <tr style="background: #f1f5f9">
              <th v-for="t in TYPES" :key="t" :style="thStyle">{{ headOf(t) }}<br />(วันทำการ)</th>
              <th :style="thStyle + ' font-weight:700;'">รวมเป็น<br />(วันทำการ)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td v-for="t in TYPES" :key="t" :style="tdStyle">
                <input
                  v-model.number="usedMap[t]"
                  type="number"
                  min="0"
                  :style="inputStyle"
                />
              </td>
              <td :style="tdStyle + ' font-weight:700; color:#059669;'">{{ total }}</td>
            </tr>
          </tbody>
        </table>
        <div class="hint" style="margin-top: 6px">
          แก้ได้เฉพาะคอลัมน์ "ลามาแล้ว" — ค่าที่แก้จะถูกใช้แสดงในใบลาแทนค่าจากระบบ
        </div>
      </div>

      <!-- ---------- มอบหมายงาน ---------- -->
      <div v-if="r.delegate_name" class="form-group full">
        <label style="font-weight: 700">มอบหมายงานให้ผู้ทำหน้าที่แทน</label>
        <div style="padding: 4px 0">{{ r.delegate_name }} ({{ r.delegate_position || '-' }})</div>
      </div>

      <div class="form-group full">
        <label style="font-weight: 700">ผู้ยื่นคำขอ</label>
        <div style="padding: 4px 0">{{ UI.personName(r) }} ({{ r.position || '-' }})</div>
      </div>

      <div class="form-group full">
        <label style="font-weight: 700">ความคืบหน้าการอนุมัติ</label>
        <ApprovalSteps :record="r" />
      </div>
    </div>

    <template #footer>
      <button class="btn btn-outline" :disabled="busy" @click="emit('close')">ยกเลิก</button>
      <button class="btn btn-danger" :disabled="busy" @click="doReject">✕ ไม่อนุญาติ</button>
      <button class="btn btn-primary" :disabled="busy" @click="doReview">● ตรวจสอบแล้ว</button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
