<script setup>
/**
 * LeaveForm — แบบฟอร์มยื่นคำขอลา / แก้ไขคำขอลา
 *
 * ย้ายจาก openLeaveForm() และ openVacationForm() ใน LeaveView.js
 *
 * หน้าเดียวรองรับ 2 ประเภท (เลือกตาม prop `mode`):
 *   'general'   — ลาป่วย / ลากิจ / ลาคลอดบุตร (มีช่อง "เนื่องจาก" และ "ลาครั้งสุดท้าย")
 *   'vacation'  — ลาพักผ่อน (มีสิทธิ์วันลาแสดงก่อนช่องวันลา)
 *
 * ส่งเป็น multipart/form-data เสมอ เพราะรองรับไฟล์แนบ
 */
import { ref, computed, onMounted, watch } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import { Auth } from '../../stores/auth.js';
import AppModal from './AppModal.vue';
import ThaiDateField from './ThaiDateField.vue';

const props = defineProps({
  /** 'general' | 'vacation' */
  mode: { type: String, default: 'general' },
  /** record ที่กำลังแก้ไข — null = สร้างใหม่ */
  record: { type: Object, default: null },
});

const emit = defineEmits(['close', 'saved']);

const u = computed(() => Auth.user || {});
const isEdit = computed(() => !!props.record);
const isVacation = computed(() => props.mode === 'vacation');

const busy = ref(false);
const statsData = ref([]);
const coUsers = ref([]);
const balance = ref({ accumulated: 0, annual: 10, total: 10 });

/* ---------- วันนี้แบบไทยเต็ม (ข้อความตายตัวในแบบฟอร์มราชการ) ---------- */
const DAYS_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const MONTHS_TH = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const todayThai = computed(() => {
  const n = new Date();
  return `วัน${DAYS_TH[n.getDay()]}ที่ ${n.getDate()} เดือน${MONTHS_TH[n.getMonth()]} พ.ศ. ${n.getFullYear() + 543}`;
});

/* ---------- ชื่อ/ตำแหน่งผู้ยื่น ---------- */
const uName = computed(() => {
  const r = props.record;
  const x = u.value;
  return r
    ? `${r.title || x.title || ''} ${r.first_name || r.full_name || x.full_name || ''} ${r.last_name || x.last_name || ''}`.trim()
    : `${x.title || ''} ${x.first_name || x.full_name || ''} ${x.last_name || ''}`.trim();
});
const uPos = computed(() => {
  const r = props.record;
  return r ? r.position || u.value.position || '' : u.value.position || '';
});

/* ---------- ค่าเริ่มต้นของฟอร์ม ---------- */
const f = ref(blank());

function blank() {
  const r = props.record;
  return {
    leave_type: isVacation.value
      ? 'ลาพักผ่อน'
      : r
        ? String(r.leave_type || 'ลาป่วย')
        : 'ลาป่วย',
    date_from: r ? r.date_from || '' : '',
    date_to: r ? r.date_to || '' : '',
    days: r ? r.days || 1 : 1,
    writing_at: r && r.writing_at ? r.writing_at : 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2',
    address: r ? r.address || '' : '',
    phone: r ? r.phone || '' : '',
    reason: r ? r.reason || '' : '',
    last_leave_from: r ? r.last_leave_from || '' : '',
    last_leave_to: r ? r.last_leave_to || '' : '',
    last_leave_days: r && r.last_leave_days ? r.last_leave_days : '',
    delegate_to: r && r.delegate_to ? String(r.delegate_to) : '',
  };
}

const attachment = ref(null);
const attachmentName = ref('');

/* ---------- โหลดข้อมูลประกอบ ---------- */
onMounted(async () => {
  const jobs = [
    // สถิติการลา — แก้ไขตอนไม่นับรายการที่กำลังแก้
    api
      .get('/leave-stats' + (props.record ? '?excludeId=' + props.record.id : ''))
      .then((d) => (statsData.value = d.stats || []))
      .catch(() => {}),
    api
      .get('/leave-users')
      .then((d) => (coUsers.value = d.users || []))
      .catch(() => {}),
  ];
  if (isVacation.value) {
    jobs.push(
      api
        .get('/my-leave-balance')
        .then((d) => (balance.value = d))
        .catch(() => {}),
    );
  }
  await Promise.all(jobs);

  // เติม "ลาครั้งสุดท้าย" จากประวัติ เฉพาะตอนสร้างใหม่
  if (!isEdit.value && !isVacation.value) {
    try {
      const d = await api.get('/leave-last');
      const last = d.last;
      if (last && last.date_from) {
        f.value.last_leave_from = last.date_from;
        f.value.last_leave_to = last.date_to;
        f.value.last_leave_days = last.days || '';
      }
    } catch {
      /* ไม่มีประวัติ — ปล่อยว่าง */
    }
  }
});

// เปลี่ยน record/mode แล้วต้องล้างค่าเก่า
watch(() => [props.record, props.mode], () => {
  f.value = blank();
  attachment.value = null;
  attachmentName.value = '';
});

/* ---------- ตารางสถิติการลาในแบบฟอร์ม ---------- */
const statRows = computed(() => {
  if (isVacation.value) {
    const usedBefore = usedOf('ลาพักผ่อน');
    return [{ label: 'ลาพักผ่อน', before: usedBefore, now: num(f.value.days) }];
  }
  const thisDays = num(f.value.days);
  const is = f.value.leave_type;
  return [
    { label: 'ป่วย', before: usedOf('ลาป่วย'), now: is === 'ลาป่วย' ? thisDays : 0 },
    { label: 'กิจส่วนตัว', before: usedOf('ลากิจ'), now: is === 'ลากิจ' ? thisDays : 0 },
    { label: 'คลอดบุตร', before: usedOf('ลาคลอดบุตร'), now: is === 'ลาคลอดบุตร' ? thisDays : 0 },
  ];
});

function usedOf(type) {
  return (statsData.value.find((s) => s.leave_type === type) || {}).used || 0;
}

function num(v) {
  return parseInt(v, 10) || 0;
}

/** แสดงช่อง "เนื่องจาก" เฉพาะลากิจและลาป่วย */
const showReason = computed(() => f.value.leave_type === 'ลากิจ' || f.value.leave_type === 'ลาป่วย');

/* ---------- คำนวณจำนวนวัน ---------- */
function span(from, to) {
  if (!from || !to) return 0;
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function calcDays() {
  f.value.days = span(f.value.date_from, f.value.date_to) || f.value.days;
}

function calcLastDays() {
  const d = span(f.value.last_leave_from, f.value.last_leave_to);
  if (d) f.value.last_leave_days = d;
}

function onFile(e) {
  const file = e.target.files && e.target.files[0];
  attachment.value = file || null;
  attachmentName.value = file ? file.name : '';
}

/* ---------- บันทึก ---------- */
async function save() {
  const v = f.value;
  if (!v.date_from || !v.date_to) return UI.toast('กรุณาระบุวันลา', 'error');

  const fd = new FormData();
  fd.append('leave_type', v.leave_type);
  fd.append('date_from', v.date_from);
  fd.append('date_to', v.date_to);
  fd.append('days', num(v.days) || 1);
  fd.append('writing_at', v.writing_at.trim());
  fd.append('address', v.address.trim());
  fd.append('phone', v.phone.trim());
  if (v.last_leave_from) fd.append('last_leave_from', v.last_leave_from);
  if (v.last_leave_to) fd.append('last_leave_to', v.last_leave_to);
  if (v.last_leave_days) fd.append('last_leave_days', num(v.last_leave_days));
  if (v.delegate_to) fd.append('delegate_to', v.delegate_to);
  // เหตุผลมีเฉพาะลากิจ/ลาป่วย
  if (showReason.value && v.reason.trim()) fd.append('reason', v.reason.trim());
  if (attachment.value) fd.append('attachment', attachment.value);

  busy.value = true;
  try {
    const res = props.record
      ? await api.putForm('/leaves/' + props.record.id, fd)
      : await api.postForm('/leaves', fd);
    UI.toast(res.message || (props.record ? 'แก้ไขคำขอลาเรียบร้อย' : 'ส่งคำขอเรียบร้อย'));
    emit('saved');
    emit('close');
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}

const TYPES = ['ลาป่วย', 'ลากิจ', 'ลาคลอดบุตร'];
const TITLE = computed(
  () =>
    (props.record ? '✎ แก้ไขคำขอลา — ' + (props.record.leave_no || '') : '') ||
    (isVacation.value ? '🏖️ ยื่นคำลาพักผ่อน' : '🤒 ยื่นคำลาป่วย ลากิจ ลาคลอด'),
);
const inputStyle = { width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '8px' };
</script>

<template>
  <AppModal :title="TITLE" size="lg" footer @close="emit('close')">
    <div class="form-grid" style="font-size: 15px">
      <!-- ---------- วันที่ยื่น ---------- -->
      <div class="form-group full">
        <label style="font-weight: 700">วันที่</label>
        <div style="padding: 6px 0; font-size: 15px">{{ todayThai }}</div>
      </div>

      <div class="form-group full">
        <label style="font-weight: 700">เขียนที่</label>
        <input v-model="f.writing_at" :style="inputStyle" />
      </div>

      <!-- ---------- เรื่อง ---------- -->
      <div class="form-group full">
        <label style="font-weight: 700">เรื่อง<span v-if="!isVacation" class="req"> *</span></label>
        <div v-if="isVacation" style="padding: 6px 0; font-size: 15px">ขอลาพักผ่อน</div>
        <select v-else v-model="f.leave_type" :style="{ ...inputStyle, width: '100%' }">
          <option v-for="t in TYPES" :key="t" :value="t">{{ t }}</option>
        </select>
      </div>

      <!-- ---------- เนื่องจาก (เฉพาะลากิจ/ลาป่วย) ---------- -->
      <div v-if="!isVacation && showReason" class="form-group full">
        <label style="font-weight: 700">เนื่องจาก</label>
        <textarea
          v-model="f.reason"
          rows="3"
          placeholder="กรอกเหตุผลการลา"
          :style="{ ...inputStyle, resize: 'vertical' }"
        ></textarea>
      </div>

      <!-- ---------- เรียน ---------- -->
      <div class="form-group full">
        <label style="font-weight: 700">เรียน</label>
        <div style="padding: 6px 0; font-size: 15px; font-weight: 600">
          ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2
        </div>
      </div>

      <!-- ---------- ข้าพเจ้า ---------- -->
      <div class="form-group full">
        <label style="font-weight: 700">ข้าพเจ้า</label>
        <div style="padding: 6px 0; font-size: 15px">{{ uName }} {{ uPos }}</div>
      </div>

      <!-- ---------- สิทธิ์วันลาพักผ่อน (เฉพาะแบบลาพักผ่อน) ---------- -->
      <div v-if="isVacation" class="form-group full">
        <div style="font-size: 14px; line-height: 1.8">
          <span>มีวันลาพักผ่อนสะสม {{ balance.accumulated || 0 }} วันทำการ</span>
          <br />
          <span>มีสิทธิ์ลาพักผ่อนประจำปีนี้อีก {{ balance.annual || 10 }} วันทำการ</span>
          <br />
          <span style="font-weight: 700">
            รวมเป็น {{ balance.total || (balance.accumulated + balance.annual) || 10 }} วันทำการ
          </span>
        </div>
      </div>

      <!-- ---------- ช่วงวันลา ---------- -->
      <div class="form-group">
        <label style="font-weight: 700">
          {{ isVacation ? 'ขอลาพักผ่อนตั้งแต่วันที่' : 'ขอลาตั้งแต่วันที่' }}<span class="req"> *</span>
        </label>
        <ThaiDateField id="lf-from" v-model="f.date_from" @update:model-value="calcDays" />
      </div>

      <div class="form-group">
        <label style="font-weight: 700">ถึงวันที่<span class="req"> *</span></label>
        <ThaiDateField id="lf-to" v-model="f.date_to" @update:model-value="calcDays" />
      </div>

      <div class="form-group">
        <label style="font-weight: 700">มีกำหนด</label>
        <div style="display: flex; align-items: center; gap: 8px">
          <input v-model.number="f.days" type="number" min="1" style="width: 80px; padding: 8px; border: 1px solid #d1d5db; border-radius: 8px" />
          <span>วัน</span>
        </div>
      </div>

      <!-- ---------- ลาครั้งสุดท้าย (เฉพาะลาป่วย/กิจ/คลอด) ---------- -->
      <template v-if="!isVacation">
        <div class="form-group full" style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed #e5e7eb">
          <label style="font-weight: 700; color: #6b7280">ลาครั้งสุดท้าย</label>
        </div>
        <div class="form-group">
          <label>ตั้งแต่วันที่</label>
          <ThaiDateField id="lf-last-from" v-model="f.last_leave_from" />
        </div>
        <div class="form-group">
          <label>ถึงวันที่</label>
          <ThaiDateField id="lf-last-to" v-model="f.last_leave_to" @update:model-value="calcLastDays" />
        </div>
        <div class="form-group">
          <label>มีกำหนด</label>
          <div style="display: flex; align-items: center; gap: 8px">
            <input v-model.number="f.last_leave_days" type="number" min="0" style="width: 80px; padding: 8px; border: 1px solid #d1d5db; border-radius: 8px" />
            <span>วัน</span>
          </div>
        </div>
      </template>

      <!-- ---------- ติดต่อระหว่างลา ---------- -->
      <div class="form-group">
        <label style="font-weight: 700">ระหว่างลาติดต่อได้ที่</label>
        <input
          v-model="f.address"
          placeholder="เช่น 123/45 ต.เด่นชัย อ.เด่นชัย จ.แพร่"
          :style="inputStyle"
        />
      </div>

      <div class="form-group">
        <label style="font-weight: 700">เบอร์โทรศัพท์</label>
        <input v-model="f.phone" placeholder="เช่น 081-2345678" :style="inputStyle" />
      </div>

      <!-- ---------- สถิติการลาปีงบประมาณนี้ ---------- -->
      <div class="form-group full">
        <label style="font-weight: 700; margin-bottom: 6px; display: block">
          สถิติการลาในปีงบประมาณนี้
        </label>
        <table class="leave-stats-table">
          <thead>
            <tr>
              <th>ประเภทการลา</th>
              <th>ลามาแล้ว</th>
              <th>ลาครั้งนี้</th>
              <th style="font-weight: 700">รวมเป็น</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in statRows" :key="s.label">
              <td style="text-align: left">{{ s.label }}</td>
              <td>{{ s.before }}</td>
              <td>{{ s.now }}</td>
              <td style="font-weight: 700; color: #059669">{{ s.before + s.now }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ---------- เอกสารแนบ ---------- -->
      <div class="form-group full">
        <label style="font-weight: 700">เอกสาร (ถ้ามี)</label>
        <input type="file" style="padding: 6px 0" @change="onFile" />
        <span v-if="attachmentName" class="hint"> เลือกแล้ว: {{ attachmentName }}</span>
      </div>

      <!-- ---------- มอบหมายงาน ---------- -->
      <div class="form-group full">
        <label style="font-weight: 700">มอบหมายงานให้ผู้ทำหน้าที่แทน</label>
        <select v-model="f.delegate_to" :style="inputStyle">
          <option value="">-- ไม่มี --</option>
          <option v-for="c in coUsers" :key="c.id" :value="String(c.id)">
            {{ UI.personName(c) }} ({{ c.position || '' }})
          </option>
        </select>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-outline" :disabled="busy" @click="emit('close')">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="busy" @click="save">
        {{ busy ? 'กำลังบันทึก…' : isEdit ? '💾 บันทึกการแก้ไข' : '📨 ส่งคำขอ' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
