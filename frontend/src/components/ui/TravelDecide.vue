<script setup>
/**
 * TravelDecide — หน้าต่างตัดสินใจคำขอไปราชการ
 *
 * ย้ายจาก UI.confirm(...) ที่สร้าง DOM เองใน TravelView.decide()
 * มาเป็น Vue component ที่ผูก state ตรง ๆ
 *
 * มี 3 รูปแบบตามขั้นของสายอนุมัติ
 * ─────────────────────────────
 * 1) forward  — สายสถานศึกษา ขั้นที่ 1 (ผู้ตรวจสอบ)
 *              ปุ่มเดียว "เสนอเรื่อง" ไม่บันทึกความเห็นลงในเอกสาร
 * 2) level1   — สาย สพป. ขั้นที่ 1 (ผู้บังคับบัญชาขั้นต้น)
 *              ติ๊กเลือก: ควรอนุญาต / ไม่ควรอนุญาต (ใส่เหตุผลเมื่อไม่ควรอนุญาต)
 * 3) final    — ขั้นสุดท้าย (สพป. ขั้น 2 / สถานศึกษา ขั้น 3)
 *              ติ๊กเลือก: อนุญาต / ไม่อนุญาต (ใส่เหตุผลเมื่อไม่อนุญาต) + เลือกตำแหน่ง
 *
 * ทั้ง 3 แบบส่ง note เป็น JSON: { choices: [...], reasonMap: {...} }
 * และขั้น final ส่ง position ของผู้อนุมัติไปด้วย
 */
import { ref, computed, watch } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import { Auth } from '../../stores/auth.js';
import { approvePositionOptions } from '../../lib/approve-position.js';
import AppModal from './AppModal.vue';

const props = defineProps({
  /** record ที่กำลังพิจารณา */
  record: { type: Object, default: null },
  /** 'forward' | 'level1' | 'final' */
  mode: { type: String, default: 'level1' },
  /** ชื่อขั้น เช่น "อนุมัติขั้นต้น" (สายสถานศึกษา ขั้น 2) */
  stepTitle: { type: String, default: '' },
  /** 'office' = สาย สพป. · 'school' = สายสถานศึกษา (ของสถานศึกษาคงเดิม) */
  scope: { type: String, default: 'office' },
});

const emit = defineEmits(['close', 'confirm']);

/* ---------- ตัวเลือกของแต่ละขั้น ---------- */
/*
 * ผู้ใช้กำหนด (5 พ.ย. 2569)
 *   สาย สพป. — เลือกได้หลายข้อ (checkbox)
 *     · ผู้อนุมัติขั้นต้น: ควรอนุญาต · ไม่ควรอนุญาต · ควรอนุมัติ · ไม่ควรอนุมัติ
 *     · ผู้อนุมัติ (ขั้นสุดท้าย): อนุญาต · ไม่อนุญาต · อนุมัติ · ไม่อนุญาต
 *   สายสถานศึกษา — คงเดิม (เลือกครั้งละ 1 ข้อ 2 ตัวเลือก)
 */
const isSchool = computed(() => props.scope === 'school');

const OPTIONS_OFFICE = {
  level1: [
    { key: 'ควรอนุญาต', reason: false },
    { key: 'ไม่ควรอนุญาต', reason: true },
    { key: 'ควรอนุมัติ', reason: false },
    { key: 'ไม่ควรอนุมัติ', reason: true },
  ],
  final: [
    { key: 'อนุญาต', reason: false },
    { key: 'ไม่อนุญาต', reason: true },
    { key: 'อนุมัติ', reason: false },
    { key: 'ไม่อนุมัติ', reason: true },
  ],
};

const OPTIONS_SCHOOL = {
  level1: [
    { key: 'ควรอนุญาต', reason: false },
    { key: 'ไม่ควรอนุญาต', reason: true },
  ],
  final: [
    { key: 'อนุญาต', reason: false },
    { key: 'ไม่อนุญาต', reason: true },
  ],
};

const options = computed(() => {
  const table = isSchool.value ? OPTIONS_SCHOOL : OPTIONS_OFFICE;
  return table[props.mode] || table.level1;
});

/** ปุ่มยืนยันตามขั้น */
const okText = computed(() => (props.mode === 'forward' ? 'ยืนยัน' : 'ยืนยัน'));

/** หัวหน้าต่าง — ใช้ชื่อขั้นที่ส่งมา (เช่น "อนุมัติขั้นต้น") ถ้ามี */
const title = computed(() => {
  if (props.mode === 'forward') return '⊙ เสนอเรื่องคำขออนุญาตเดินทางไปราชการ';
  if (props.stepTitle) return '● ' + props.stepTitle;
  return '● พิจารณาคำขอไปราชการ';
});

/* ---------- สถานะฟอร์ม ---------- */
const forward = ref(true);
const picked = ref([]);
const reasons = ref({});
const position = ref('');

/* ---------- เลือกผู้อนุมัติ (ผู้ใช้สั่ง 26 พ.ย. 2569) ----------
 *
 * ขั้นผู้บังคับบัญชาขั้นต้นของสาย สพป. → เลือกได้ว่าจะให้ใครเป็น "ผู้อนุมัติ" ของคำขอใบนี้
 *   รายชื่อดึงจากหน้า ⊛ กำหนดผู้อนุมัติไปราชการ (คอลัมน์ "ผู้อนุมัติ")
 *   คนที่เลือกจะกลายเป็นผู้อนุมัติขั้นสุดท้ายของรายการนั้น (บันทึกที่ travel_requests.final_approver_id)
 */
const finalApprovers = ref([]);
const finalApproverId = ref('');
const finalApproverError = ref('');

/** แสดงตัวเลือกผู้อนุมัติหรือไม่ = ขั้นผู้บังคับบัญชาขั้นต้นของสาย สพป. เท่านั้น */
const showFinalApprover = computed(() => props.mode === 'level1' && !isSchool.value);

async function loadFinalApprovers() {
  if (!showFinalApprover.value) return;
  finalApproverError.value = '';
  try {
    const d = await api.get('/travel/final-approvers');
    finalApprovers.value = d.approvers || [];
  } catch (e) {
    finalApproverError.value = e.message || 'โหลดรายชื่อผู้อนุมัติไม่สำเร็จ';
  }
}

loadFinalApprovers();

/* ---------- เลือกผู้บังคับบัญชาขั้นต้น (ผู้ใช้สั่ง 26 พ.ย. 2569) ----------
 *
 * ขั้นผู้ตรวจสอบของสายสถานศึกษา (mode='forward') → เลือก "เสนอเรื่องถึง" ได้
 *   รายชื่อดึงจากหน้า ⊛ กำหนดผู้อนุมัติไปราชการ (คอลัมน์ "ผู้บังคับบัญชาขั้นต้น")
 *   คนที่เลือกจะกลายเป็นผู้บังคับบัญชาขั้นต้น (ขั้นที่ 2) ของคำขอใบนั้น
 *   (บันทึกที่ travel_requests.chosen_supervisor_id)
 */
const supervisors = ref([]);
const supervisorId = ref('');
const supervisorError = ref('');

/** แสดงตัวเลือก "เสนอเรื่องถึง" = ขั้นผู้ตรวจสอบของสายสถานศึกษาเท่านั้น */
const showSupervisorPicker = computed(() => props.mode === 'forward' && isSchool.value);

async function loadSupervisors() {
  if (!showSupervisorPicker.value) return;
  supervisorError.value = '';
  try {
    const d = await api.get('/travel/supervisor-candidates');
    supervisors.value = d.supervisors || [];
  } catch (e) {
    supervisorError.value = e.message || 'โหลดรายชื่อผู้บังคับบัญชาไม่สำเร็จ';
  }
}

loadSupervisors();

/**
 * ตำแหน่งที่ให้เลือกตอนอนุมัติ
 *
 * ใช้ตัวช่วยกลาง `approvePositionOptions()` (เหมือนหน้าอนุมัติลา)
 *   · รอง ผอ.สพป. → 3 ตัวเลือก (ตำแหน่งจริง / รักษาราชการแทน / ปฏิบัติราชการแทน)
 *   · ผอ.สพป.     → ตำแหน่งจริง + ปฏิบัติหน้าที่ราชการแทนเลขาธิการ กพฐ.
 *   · อื่น ๆ       → ตำแหน่งจริง + 3 ตัวเลือกของรอง ผอ.สพป. (ผู้ใช้สั่ง 12 พ.ย. 2569)
 */
const posOptions = computed(() => approvePositionOptions(Auth.user?.position));

const requesterName = computed(() => {
  const r = props.record;
  if (!r) return '';
  const first = [(r.user_title || '') + (r.first_name || ''), r.last_name || '']
    .filter(Boolean)
    .join(' ');
  return first || r.full_name || '';
});

/** เปิดใหม่ทุกครั้งที่เปลี่ยน record/mode — ไม่งั้นค่าค้างจากครั้งก่อน */
watch(
  () => [props.record, props.mode],
  () => {
    forward.value = true;
    picked.value = [];
    reasons.value = {};
    position.value = posOptions.value[0] || '';
    finalApproverId.value = '';
    supervisorId.value = '';
    loadFinalApprovers();
    loadSupervisors();
  },
  { immediate: true },
);

/**
 * เลือก/ยกเลิกตัวเลือก (checkbox)
 *   สาย สพป. เลือกได้หลายข้อ · สายสถานศึกษาเลือกได้ครั้งละ 1 ข้อ (เหมือนเดิม)
 */
function pick(key) {
  const i = picked.value.indexOf(key);
  if (i >= 0) {
    picked.value.splice(i, 1);
    delete reasons.value[key];
    return;
  }
  if (isSchool.value) {
    // สายสถานศึกษา: คงพฤติกรรมเดิม (เลือกได้ครั้งละ 1)
    picked.value = [key];
    for (const k of Object.keys(reasons.value)) {
      if (k !== key) delete reasons.value[k];
    }
    return;
  }
  picked.value.push(key);
}

const isRejectPicked = computed(() => picked.value.some((k) => k.startsWith('ไม่')));

/**
 * แสดงตัวเลือกตำแหน่งหรือไม่
 *
 * ผู้ใช้สั่ง 12 พ.ย. 2569: สายสถานศึกษา ขั้น "อนุมัติขั้นต้น" (mode = level1)
 *   ต้องมีตัวเลือกตำแหน่งต่อจากส่วน "กรุณาเลือกการพิจารณา"
 *   (ขั้นสุดท้ายมีอยู่แล้ว — สาย สพป. ขั้นต้นยังไม่ต้องมี)
 */
const showPosition = computed(
  () => props.mode === 'final' || (props.mode === 'level1' && isSchool.value),
);

function confirm() {
  if (props.mode === 'forward') {
    // ผู้ตรวจสอบ: ต้องเลือก "เสนอเรื่องถึง" (ถ้ามีรายชื่อให้เลือก)
    if (showSupervisorPicker.value && supervisors.value.length && !supervisorId.value) {
      return UI.toast('กรุณาเลือกผู้บังคับบัญชาขั้นต้น (เสนอเรื่องถึง)', 'error');
    }
    emit('confirm', {
      forward: forward.value,
      // คนที่เลือกจะเป็นผู้บังคับบัญชาขั้นต้น (ขั้นที่ 2) ของคำขอใบนี้
      chosen_supervisor_id: showSupervisorPicker.value ? Number(supervisorId.value) || 0 : 0,
    });
    return;
  }
  // ขั้นผู้บังคับบัญชาขั้นต้น: ต้องเลือกผู้อนุมัติ (ถ้ามีรายชื่อให้เลือก)
  if (showFinalApprover.value && finalApprovers.value.length && !finalApproverId.value) {
    return UI.toast('กรุณาเลือกผู้อนุมัติของคำขอนี้', 'error');
  }
  const reasonMap = {};
  for (const o of options.value) {
    if (o.reason && reasons.value[o.key]) reasonMap[o.key] = reasons.value[o.key];
  }
  emit('confirm', {
    choices: [...picked.value],
    reasonMap,
    isReject: isRejectPicked.value,
    position: showPosition.value ? position.value : '',
    // คนที่เลือกจะเป็นผู้อนุมัติขั้นสุดท้ายของคำขอใบนี้
    final_approver_id: showFinalApprover.value ? Number(finalApproverId.value) || 0 : 0,
  });
}
</script>

<template>
  <AppModal :title="title" size="lg" footer @close="emit('close')">
    <div style="font-size: 15px">
      <!-- ---------- ขั้นที่ 1 สายสถานศึกษา: ผู้ตรวจสอบ ---------- -->
      <template v-if="mode === 'forward'">
        <div style="margin-bottom: 10px">
          ต้องการเสนอคำขออนุญาตเดินทางไปราชการ ของ <b>{{ requesterName }}</b> ใช่หรือไม่?
        </div>
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 15px">
          <input v-model="forward" type="checkbox" style="width: 18px; height: 18px; cursor: pointer; flex-shrink: 0" />
          เสนอเรื่อง
        </label>
        <div class="hint" style="margin-top: 8px">
          การเสนอเรื่องจะส่งต่อให้ผู้บังคับบัญชาขั้นต้นพิจารณา โดยไม่บันทึกความเห็นลงในเอกสาร
        </div>

        <!-- ---------- เสนอเรื่องถึง (ผู้บังคับบัญชาขั้นต้น — ผู้ใช้สั่ง 26 พ.ย. 2569) ---------- -->
        <template v-if="showSupervisorPicker">
          <div style="margin-top: 14px; font-weight: 700">เสนอเรื่องถึง</div>
          <select
            id="travel-supervisor"
            v-model="supervisorId"
            style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 16px; margin-top: 8px"
          >
            <option value="">— เลือกผู้บังคับบัญชาขั้นต้น —</option>
            <option v-for="s in supervisors" :key="s.id" :value="String(s.id)">
              {{ s.name }}{{ s.position ? ' · ' + s.position : '' }}
            </option>
          </select>
          <div v-if="supervisorError" class="hint" style="color: #dc2626; margin-top: 6px">
            {{ supervisorError }}
          </div>
          <div v-else-if="!supervisors.length" class="hint" style="color: #b45309; margin-top: 6px">
            ยังไม่มีรายชื่อผู้บังคับบัญชาขั้นต้น — กำหนดได้ที่ปุ่ม "⊛ กำหนดผู้อนุมัติไปราชการ" (คอลัมน์ผู้บังคับบัญชาขั้นต้น)
          </div>
          <div v-else class="hint" style="margin-top: 6px">
            คนที่เลือกจะกลายเป็นผู้บังคับบัญชาขั้นต้น (ขั้นที่ 2) ของคำขอนี้
          </div>
        </template>
      </template>

      <!-- ---------- ขั้นที่ 1 สาย สพป. / ขั้นสุดท้าย ---------- -->
      <template v-else>
        <div style="margin-bottom: 10px; font-weight: 700">กรุณาเลือกการพิจารณา</div>

        <div v-for="o in options" :key="o.key">
          <label style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px; cursor: pointer">
            <input
              :type="isSchool ? 'radio' : 'checkbox'"
              :name="isSchool ? 'travel-decide-choice' : undefined"
              :checked="picked.includes(o.key)"
              style="width: 16px; height: 16px; flex-shrink: 0; cursor: pointer"
              @change="pick(o.key)"
            />
            {{ o.key }}
          </label>

          <!-- เหตุผล — แสดงเฉพาะตัวเลือกที่ต้องใส่เหตุผลและถูกเลือกไว้ -->
          <div v-if="o.reason && picked.includes(o.key)" style="margin-left: 20px; margin-top: 4px; margin-bottom: 8px">
            <div style="font-size: 12px; color: #64748b; margin-bottom: 4px">เนื่องจาก</div>
            <textarea
              v-model="reasons[o.key]"
              rows="3"
              placeholder="กรุณาระบุเหตุผล..."
              style="width: 100%; min-height: 50px; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; box-sizing: border-box"
            ></textarea>
          </div>
        </div>

        <!-- ---------- ผู้อนุมัติ (ขั้นผู้บังคับบัญชาขั้นต้น — ผู้ใช้สั่ง 26 พ.ย. 2569) ---------- -->
        <template v-if="showFinalApprover">
          <div style="margin-top: 14px; font-weight: 700">
            กรุณาเลือกผู้อนุมัติ <span style="font-weight: 400; font-size: 13px; color: #64748b">(ผู้อนุมัติขั้นสุดท้ายของคำขอนี้)</span>
          </div>
          <select
            id="travel-final-approver"
            v-model="finalApproverId"
            style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 16px; margin-top: 8px"
          >
            <option value="">— เลือกผู้อนุมัติ —</option>
            <option v-for="a in finalApprovers" :key="a.id" :value="String(a.id)">
              {{ a.name }}{{ a.position ? ' · ' + a.position : '' }}
            </option>
          </select>
          <div v-if="finalApproverError" class="hint" style="color: #dc2626; margin-top: 6px">
            {{ finalApproverError }}
          </div>
          <div v-else-if="!finalApprovers.length" class="hint" style="color: #b45309; margin-top: 6px">
            ยังไม่มีรายชื่อผู้อนุมัติ — กำหนดได้ที่ปุ่ม "⊛ กำหนดผู้อนุมัติไปราชการ" (คอลัมน์ผู้อนุมัติ)
          </div>
          <div v-else class="hint" style="margin-top: 6px">
            คนที่เลือกจะกลายเป็นผู้อนุมัติขั้นสุดท้ายของคำขอนี้
          </div>
        </template>

        <!-- ---------- ตำแหน่งที่จะลงนาม (ขั้นสุดท้าย + ขั้นอนุมัติขั้นต้นของสถานศึกษา) ---------- -->
        <template v-if="showPosition">
          <div style="margin-top: 10px; font-weight: 700">กรุณาเลือกตำแหน่งที่จะอนุมัติ/อนุญาต</div>
          <select
            v-model="position"
            style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 16px; margin-top: 8px"
          >
            <option v-for="p in posOptions" :key="p" :value="p">{{ p }}</option>
          </select>
        </template>
      </template>
    </div>

    <template #footer>
      <button class="btn btn-outline" @click="emit('close')">ยกเลิก</button>
      <button
        class="btn btn-primary"
        :class="{ 'danger-btn': isRejectPicked }"
        :disabled="mode !== 'forward' && picked.length === 0"
        @click="confirm"
      >
        {{ okText }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
