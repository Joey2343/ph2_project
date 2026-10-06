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
 *              ตัวเลือก 4 ข้อ: ควรอนุมัติ / ไม่ควรอนุมัติ / ควรอนุญาต / ไม่ควรอนุญาต
 * 3) final    — ขั้นสุดท้าย (สพป. ขั้น 2 / สถานศึกษา ขั้น 3)
 *              ตัวเลือก 4 ข้อ: อนุมัติ / ไม่อนุมัติ / อนุญาต / ไม่อนุญาต + เลือกตำแหน่ง
 *
 * ทั้ง 3 แบบส่ง note เป็น JSON: { choices: [...], reasonMap: {...} }
 * และขั้น final ส่ง position ของผู้อนุมัติไปด้วย
 */
import { ref, computed, watch } from 'vue';
import { UI } from '../../ui/ui.js';
import { Auth } from '../../stores/auth.js';
import AppModal from './AppModal.vue';

const props = defineProps({
  /** record ที่กำลังพิจารณา */
  record: { type: Object, default: null },
  /** 'forward' | 'level1' | 'final' */
  mode: { type: String, default: 'level1' },
});

const emit = defineEmits(['close', 'confirm']);

/* ---------- ตัวเลือกของแต่ละขั้น ---------- */
const OPTIONS = {
  level1: [
    { key: 'ควรอนุมัติ', reason: false },
    { key: 'ไม่ควรอนุมัติ', reason: true },
    { key: 'ควรอนุญาต', reason: false },
    { key: 'ไม่ควรอนุญาต', reason: true },
  ],
  final: [
    { key: 'อนุมัติ', reason: false },
    { key: 'ไม่อนุมัติ', reason: true },
    { key: 'อนุญาต', reason: false },
    { key: 'ไม่อนุญาต', reason: true },
  ],
};

const options = computed(() => OPTIONS[props.mode] || OPTIONS.level1);

/** ปุ่มยืนยันตามขั้น */
const okText = computed(() => (props.mode === 'forward' ? 'ยืนยัน' : 'ยืนยัน'));

/* ---------- สถานะฟอร์ม ---------- */
const forward = ref(true);
const picked = ref([]);
const reasons = ref({});
const position = ref('');

/**
 * ตำแหน่งที่ให้เลือกตอนอนุมัติ
 *
 * กฎเดิมของระบบ: ถ้าตำแหน่งจริงมีคำว่า "ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2"
 * ให้เสนอทั้งตำแหน่งจริงและตำแหน่งที่ปฏิบัติหน้าที่แทน ให้ผู้อนุมัติเลือกเอง
 */
const posOptions = computed(() => {
  const p = (Auth.user?.position || '').trim();
  const DIRECTOR = 'ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2';
  if (p.includes(DIRECTOR) && !p.includes('รอง')) {
    return [DIRECTOR, `${DIRECTOR} ปฏิบัติหน้าที่ราชการแทนเลขาธิการ กพฐ.`];
  }
  if (p.includes(`รอง${DIRECTOR}`)) {
    return [
      `รอง${DIRECTOR}`,
      `รอง${DIRECTOR} รักษาราชการแทน ผอ.สพป.แพร่ เขต 2`,
      `รอง${DIRECTOR} ปฏิบัติราชการแทน ผอ.สพป.แพร่ เขต 2`,
    ];
  }
  return [p || 'ไม่ระบุตำแหน่ง'];
});

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
  },
  { immediate: true },
);

function toggle(key) {
  const i = picked.value.indexOf(key);
  if (i >= 0) picked.value.splice(i, 1);
  else picked.value.push(key);
}

/** เหตุผลจะถูกล้างเมื่อถอดตัวเลือกที่ต้องใส่เหตุผลออก (เหมือนของเดิม) */
function onToggle(key, opt) {
  if (opt.reason && picked.value.indexOf(key) < 0) delete reasons.value[key];
}

const isRejectPicked = computed(() => picked.value.some((k) => k.startsWith('ไม่')));

function confirm() {
  if (props.mode === 'forward') {
    emit('confirm', { forward: forward.value });
    return;
  }
  const reasonMap = {};
  for (const o of options.value) {
    if (o.reason && reasons.value[o.key]) reasonMap[o.key] = reasons.value[o.key];
  }
  emit('confirm', {
    choices: [...picked.value],
    reasonMap,
    isReject: isRejectPicked.value,
    position: props.mode === 'final' ? position.value : '',
  });
}
</script>

<template>
  <AppModal
    :title="
      mode === 'forward'
        ? '⊙ เสนอเรื่องคำขออนุญาตเดินทางไปราชการ'
        : '● พิจารณาคำขอไปราชการ'
    "
    size="lg"
    footer
    @close="emit('close')"
  >
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
      </template>

      <!-- ---------- ขั้นที่ 1 สาย สพป. / ขั้นสุดท้าย ---------- -->
      <template v-else>
        <div style="margin-bottom: 10px; font-weight: 700">กรุณาเลือกการพิจารณา</div>

        <div v-for="o in options" :key="o.key">
          <label style="display: flex; align-items: center; gap: 4px; margin-bottom: 6px; cursor: pointer">
            <input
              type="checkbox"
              :checked="picked.includes(o.key)"
              style="width: 16px; height: 16px; flex-shrink: 0; cursor: pointer"
              @change="onToggle(o.key, o); toggle(o.key)"
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

        <!-- ---------- ตำแหน่งที่จะลงนาม (เฉพาะขั้นสุดท้าย) ---------- -->
        <template v-if="mode === 'final'">
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
