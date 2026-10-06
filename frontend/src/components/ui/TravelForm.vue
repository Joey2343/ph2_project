<script setup>
/**
 * TravelForm — แบบฟอร์มยื่นคำขอ/อนุญาตเดินทางไปราชการ
 *
 * ย้ายจาก TravelView.openForm() ที่สร้าง DOM ผ่าน UI.h()
 * เป็น Vue component ที่ผูก v-model โดยตรง
 *
 * โครงสร้างแบบฟอร์มและข้อความตรงกับของเดิมทุกตัวอักษร เพราะเอกสารนี้ถูกส่งออกเป็น
 * หนังสือราชการ จึงห้ามเปลี่ยนถ้อยคำหรือลำดับบรรทัดใด ๆ
 *
 * ข้อมูลที่เก็บลง form_data ตรงกับ backend และ TravelDoc.vue อ่านกลับได้
 */
import { ref, computed, watch } from 'vue';
import { UI } from '../../ui/ui.js';
import { Auth } from '../../stores/auth.js';
import AppModal from './AppModal.vue';
import ThaiDateField from './ThaiDateField.vue';

const props = defineProps({
  /** true = กำลังส่ง (ปิดปุ่มไว้กันกดซ้ำ) */
  saving: { type: Boolean, default: false },
});

const emit = defineEmits(['close', 'submit']);

const todayISO = UI.today();
const buddhaYear = new Date().getFullYear() + 543;

/* ---------- ค่าเริ่มต้นของผู้ยื่น ---------- */
const user = computed(() => Auth.user || {});
const fullName = computed(() =>
  [user.value.first_name || '', user.value.last_name || ''].filter(Boolean).join(' '),
);
const titleName = computed(() => user.value.title || '');

/* ---------- ฟอร์ม ---------- */
const f = ref({
  writing_at: 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2',
  form_date: todayISO,
  companions: 0,
  travel_subject: '',
  destination: '',
  order_doc: '',
  order_date: '',
  expense_type: 'none',
  expense_budget_amount: 0,
  expense_fund_source: '',
  expense_project: '',
  expense_project_amount: 0,
  expense_items: { baht: 0, hotel: 0, transport: 0, other: 0 },
  vehicle_type: 'gov',
  plate_number: '',
  other_vehicle: '',
  date_from: todayISO,
  date_to: todayISO,
  days: 1,
});

const attachment = ref(null);
const attachmentName = ref('');

function reset() {
  f.value = {
    writing_at: 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2',
    form_date: todayISO,
    companions: 0,
    travel_subject: '',
    destination: '',
    order_doc: '',
    order_date: '',
    expense_type: 'none',
    expense_budget_amount: 0,
    expense_fund_source: '',
    expense_project: '',
    expense_project_amount: 0,
    expense_items: { baht: 0, hotel: 0, transport: 0, other: 0 },
    vehicle_type: 'gov',
    plate_number: '',
    other_vehicle: '',
    date_from: todayISO,
    date_to: todayISO,
    days: 1,
  };
  attachment.value = null;
  attachmentName.value = '';
}
watch(() => props.saving, reset);

/* ---------- จำนวนวันคำนวณจากช่วงวันที่ ---------- */
function calcDays() {
  const a = f.value.date_from;
  const b = f.value.date_to;
  if (!a || !b) return;
  const d1 = new Date(a + 'T00:00:00');
  const d2 = new Date(b + 'T00:00:00');
  f.value.days = Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
}

const EXPENSE_ITEMS = [
  { key: 'baht', label: 'ค่าเบี้ยเลี้ยง' },
  { key: 'hotel', label: 'ค่าเช่าที่พัก' },
  { key: 'transport', label: 'ค่าพาหนะ' },
  { key: 'other', label: 'ค่าใช้จ่ายอื่น' },
];

function onFile(e) {
  const file = e.target.files && e.target.files[0];
  attachment.value = file || null;
  attachmentName.value = file ? file.name : '';
}

function submit() {
  const v = f.value;
  if (!v.destination.trim()) return UI.toast('กรุณากรอกสถานที่ไปราชการ', 'error');
  if (!v.date_from || !v.date_to) return UI.toast('กรุณาระบุวันเดินทาง', 'error');

  const form_data = {
    writing_at: v.writing_at.trim(),
    form_date: v.form_date || '',
    companions: parseInt(v.companions, 10) || 0,
    travel_subject: v.travel_subject.trim(),
    order_doc: v.order_doc.trim(),
    order_date: v.order_date || '',
    expense_type: v.expense_type,
    expense_budget_amount: parseFloat(v.expense_budget_amount) || 0,
    expense_fund_source: v.expense_fund_source.trim(),
    expense_project: v.expense_project.trim(),
    expense_project_amount: parseFloat(v.expense_project_amount) || 0,
    // รายการที่ไม่ได้ติ๊กช่อง = ไม่ได้ขอเบิก
    expense_items: {
      baht: parseFloat(v.expense_items.baht) || 0,
      hotel: parseFloat(v.expense_items.hotel) || 0,
      transport: parseFloat(v.expense_items.transport) || 0,
      other: parseFloat(v.expense_items.other) || 0,
    },
    vehicle_type: v.vehicle_type,
    plate_number: v.plate_number.trim(),
    other_vehicle: v.other_vehicle.trim(),
  };

  emit('submit', {
    travel_subject: v.travel_subject.trim(),
    title: v.travel_subject.trim() || 'ขออนุมัติ/อนุญาตเดินทางไปราชการ',
    destination: v.destination.trim(),
    date_from: v.date_from,
    date_to: v.date_to,
    days: v.days || 1,
    budget: 0,
    detail: '',
    form_data,
    attachment: attachment.value,
  });
}

const lineStyle = { marginBottom: '5px' };
const indentStyle = { paddingLeft: '20px' };
const labelStyle = { marginLeft: '5px' };
const numStyle = { width: '100px', fontSize: '14px', textAlign: 'right', verticalAlign: 'middle' };
const checkboxStyle = { width: '16px', height: '16px', flexShrink: '0', verticalAlign: 'middle' };
</script>

<template>
  <AppModal title="✈ ยื่นคำขอไปราชการ" size="lg" footer @close="emit('close')">
    <div style="font-size: 14px; line-height: 1.8">
      <!-- ---------- หัวแบบฟอร์ม ---------- -->
      <div style="text-align: center; font-weight: bold; font-size: 16px; margin-bottom: 15px; text-decoration: underline">
        แบบขออนุมัติ/อนุญาตเดินทางไปราชการ
      </div>

      <div style="text-align: right; margin-bottom: 5px; display: flex; justify-content: flex-end; align-items: center; gap: 5px">
        <span style="white-space: nowrap">เขียนที่ </span>
        <input v-model="f.writing_at" style="width: 350px; font-size: 14px" />
      </div>

      <div style="text-align: right; margin-bottom: 10px; display: flex; justify-content: flex-end; align-items: center; gap: 5px">
        <span style="white-space: nowrap">วันที่ </span>
        <ThaiDateField id="tf-date" v-model="f.form_date" />
      </div>

      <div :style="lineStyle">
        <span style="font-weight: bold">เรื่อง </span>
        <span>ขออนุมัติ/อนุญาตเดินทางไปราชการ</span>
      </div>

      <div style="margin-bottom: 10px">
        <span style="font-weight: bold">เรียน </span>
        <span>ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2</span>
      </div>

      <div :style="lineStyle">
        <span>ข้าพเจ้า </span>
        <span style="font-weight: bold">{{ titleName }}{{ fullName }}</span>
        <span> ตำแหน่ง </span>
        <span style="font-weight: bold">{{ user.position || '-' }}</span>
      </div>

      <div :style="lineStyle">
        <span>กลุ่ม/หน่วย </span>
        <span style="font-weight: bold">{{ user.department || user.group || '-' }}</span>
      </div>

      <div style="margin-bottom: 10px">
        <span>พร้อมด้วยคณะ จำนวน </span>
        <input v-model.number="f.companions" type="number" min="0" style="width: 60px; font-size: 14px; text-align: center" />
        <span> คน</span>
      </div>

      <!-- ---------- ส่วนรายละเอียด ---------- -->
      <div style="font-weight: bold; text-decoration: underline; margin-top: 15px; margin-bottom: 5px">
        มีความประสงค์ขออนุมัติ/อนุญาตเดินทางไปราชการ
      </div>

      <div :style="{ ...lineStyle, ...indentStyle }">
        <span>เรื่อง </span>
        <input v-model="f.travel_subject" style="width: 500px; font-size: 14px" placeholder="เช่น เข้าร่วมประชุมชี้แจงนโยบาย" />
      </div>

      <div :style="{ ...lineStyle, ...indentStyle }">
        <span>สถานที่ </span>
        <input v-model="f.destination" style="width: 500px; font-size: 14px" placeholder="เช่น สำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน" />
      </div>

      <div style="margin-bottom: 5px; padding-left: 20px; display: flex; align-items: center; flex-wrap: nowrap; gap: 5px">
        <span style="white-space: nowrap">ตามหนังสือ/คำสั่งที่ </span>
        <input v-model="f.order_doc" style="width: 300px; font-size: 14px; flex-shrink: 0" placeholder="เช่น ด่วนที่สุด ที่ sb/0001" />
        <span style="white-space: nowrap">ลงวันที่ </span>
        <ThaiDateField id="tf-order-date" v-model="f.order_date" />
      </div>

      <div style="margin-bottom: 10px; padding-left: 20px; display: flex; align-items: center; flex-wrap: nowrap; gap: 5px">
        <span style="white-space: nowrap">ตั้งแต่วันที่ </span>
        <ThaiDateField id="tf-from" v-model="f.date_from" @update:model-value="calcDays" />
        <span style="white-space: nowrap">ถึงวันที่ </span>
        <ThaiDateField id="tf-to" v-model="f.date_to" @update:model-value="calcDays" />
        <span style="white-space: nowrap">รวมไปราชการครั้งนี้ </span>
        <input v-model.number="f.days" type="number" min="1" style="width: 50px; font-size: 14px; text-align: center; flex-shrink: 0" />
        <span style="white-space: nowrap">วัน</span>
      </div>

      <!-- ---------- โดยข้าพเจ้า ---------- -->
      <div style="font-weight: bold; text-decoration: underline; margin-top: 10px; margin-bottom: 5px">โดยข้าพเจ้า</div>

      <div :style="{ ...indentStyle, marginBottom: '3px' }">
        <input v-model="f.expense_type" type="radio" value="none" :style="checkboxStyle" />
        <label :style="labelStyle">ไม่ขอเบิกค่าใช้จ่าย</label>
      </div>

      <div :style="{ ...indentStyle, marginBottom: '3px' }">
        <input v-model="f.expense_type" type="radio" value="budget" :style="checkboxStyle" />
        <label :style="labelStyle">
          ขอเบิกค่าใช้จ่ายตามสิทธิจากเงินงบประมาณ ค่าใช้จ่ายบริหารจัดการเขตพื้นที่การศึกษา ของ สพป.แพร่ เขต 2
          ตามระเบียบกระทรวงการคลังว่าด้วยค่าใช้จ่ายในการเดินทางไปราชการ จำนวน
        </label>
        <input v-model.number="f.expense_budget_amount" type="number" step="0.01" min="0" :style="numStyle" />
        <span> บาท</span>
      </div>

      <div :style="{ ...indentStyle, marginBottom: '3px' }">
        <input v-model="f.expense_type" type="radio" value="project" :style="checkboxStyle" />
        <label :style="labelStyle">ขอเบิกค่าใช้จ่ายตามสิทธิจากเงินที่ได้รับจัดสรรจาก </label>
        <input v-model="f.expense_fund_source" type="text" style="width: 150px; font-size: 14px; vertical-align: middle" placeholder="แหล่งเงินทุน" />
        <span> โครงการ </span>
        <input v-model="f.expense_project" type="text" style="width: 200px; font-size: 14px; vertical-align: middle" placeholder="ชื่อโครงการ" />
        <span> ตามระเบียบกระทรวงการคลังว่าด้วยค่าใช้จ่ายในการเดินทางไปราชการ จำนวน </span>
        <input v-model.number="f.expense_project_amount" type="number" step="0.01" min="0" :style="numStyle" />
        <span> บาท</span>
      </div>

      <!-- ---------- ขอเบิกเฉพาะค่าใช้จ่าย ---------- -->
      <div style="font-weight: bold; text-decoration: underline; margin-top: 10px; margin-bottom: 5px">ขอเบิกค่าใช้จ่าย</div>

      <div v-for="it in EXPENSE_ITEMS" :key="it.key" :style="{ ...indentStyle, marginBottom: '3px' }">
        <input
          :id="'tf-exp-' + it.key + '-chk'"
          type="checkbox"
          :style="checkboxStyle"
          :checked="f.expense_items[it.key] > 0"
          @change="(e) => { if (!e.target.checked) f.expense_items[it.key] = 0 }"
        />
        <label :for="'tf-exp-' + it.key + '-chk'" :style="labelStyle">{{ it.label }} </label>
        <input
          :id="'tf-exp-' + it.key"
          v-model.number="f.expense_items[it.key]"
          type="number"
          step="0.01"
          min="0"
          :disabled="f.expense_items[it.key] <= 0"
          :style="numStyle"
        />
        <span> บาท</span>
      </div>

      <!-- ---------- ไปราชการด้วย ---------- -->
      <div style="font-weight: bold; text-decoration: underline; margin-top: 10px; margin-bottom: 5px">ไปราชการด้วย</div>

      <div :style="{ ...indentStyle, marginBottom: '3px' }">
        <input v-model="f.vehicle_type" type="radio" value="gov" :style="checkboxStyle" />
        <label :style="labelStyle">รถยนต์ราชการ</label>
      </div>

      <div :style="{ ...indentStyle, marginBottom: '3px' }">
        <input v-model="f.vehicle_type" type="radio" value="personal" :style="checkboxStyle" />
        <label :style="labelStyle">รถยนต์ส่วนตัว หมายเลขทะเบียน </label>
        <input v-model="f.plate_number" type="text" :disabled="f.vehicle_type !== 'personal'" style="width: 120px; font-size: 14px; vertical-align: middle" />
      </div>

      <div :style="{ ...indentStyle, marginBottom: '3px' }">
        <input v-model="f.vehicle_type" type="radio" value="other" :style="checkboxStyle" />
        <label :style="labelStyle">อื่นๆ ระบุ </label>
        <input v-model="f.other_vehicle" type="text" :disabled="f.vehicle_type !== 'other'" style="width: 300px; font-size: 14px; vertical-align: middle" />
      </div>

      <!-- ---------- เอกสารต้นเรื่อง ---------- -->
      <div style="font-weight: bold; text-decoration: underline; margin-top: 10px; margin-bottom: 5px">เอกสารต้นเรื่อง</div>
      <div style="padding-left: 20px; margin-bottom: 10px">
        <input id="tf-attachment" type="file" style="font-size: 13px" @change="onFile" />
        <span v-if="attachmentName" class="hint"> เลือกแล้ว: {{ attachmentName }}</span>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-outline" :disabled="saving" @click="emit('close')">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="saving" @click="submit">
        {{ saving ? 'กำลังส่ง…' : '📨 ส่งคำขอ' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
