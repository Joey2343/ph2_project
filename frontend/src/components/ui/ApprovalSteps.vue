<script setup>
/**
 * ApprovalSteps — แสดงความคืบหน้าการอนุมัติหลายขั้น
 *
 * ย้ายจาก UI.approvalDetail() ใน ui/ui.js มาเป็น Vue component
 * รองรับทั้งแบบเรียงบนบรรทัดเดียว (inline) และแบบเป็นตารางแนวตั้ง
 * พร้อม prop levelNames เพื่อเปลี่ยนป้ายของแต่ละระบบ
 */
import { UI } from '../../ui/ui.js';

const props = defineProps({
  /** ข้อมูลรายการที่มี approvals / required_levels */
  record: { type: Object, required: true },
  /** ป้ายของแต่ละขั้น เช่น { 1: 'อนุมัติขั้นต้น', 2: 'อนุมัติขั้นสุดท้าย' } */
  levelNames: { type: Object, default: null },
  /** true = รวมทุกขั้นไว้บรรทัดเดียว */
  inline: { type: Boolean, default: false },
});

/** จำนวนขั้นที่ดำเนินการแล้ว (รวมตรวจสอบ + อนุมัติ) — ตรรกะเดียวกับ UI.approvalDone */
const done = () => (props.record.approvals && props.record.approvals.length) || props.record.approval_level || 0;

const required = () => props.record.required_levels || 1;

/** รายการขั้นที่ต้องแสดง */
const steps = () => {
  const out = [];
  const d = done();
  // ระดับ 1 ใน approval_data ของระบบลา = ตรวจสอบ (ไม่ใช่ "อนุมัติขั้นที่ 1")
  const isLeave = props.record.leave_type && !props.levelNames;
  if (isLeave) {
    out.push({ i: 1, a: (props.record.approvals || []).find((x) => x.level === 1), label: 'ตรวจสอบ', isReview: true });
    for (let i = 2; i <= required(); i++) out.push({ i, a: (props.record.approvals || []).find((x) => x.level === i) });
  } else {
    for (let i = 1; i <= required(); i++) out.push({ i, a: (props.record.approvals || []).find((x) => x.level === i) });
  }
  return out;
};

function nameOf(i) {
  return (props.levelNames && props.levelNames[i]) || `ขั้นที่ ${i}`;
}

function labelOf(s) {
  return s.isReview ? s.label || 'ตรวจสอบ' : nameOf(s.i);
}

/** สีพื้น/ตัวอักษรตามสถานะของแต่ละขั้น */
function tone(s) {
  const d = done();
  if (s.a) return { bg: '#dcfce7', clr: '#15803d' };
  if (s.isReview && !s.a && props.record.status === 'pending' && !props.record.reviewed) {
    return { bg: '#fef3c7', clr: '#92400e' };
  }
  if (!s.a && s.i === d + 1) return { bg: '#fef3c7', clr: '#92400e' };
  return { bg: '#f1f5f9', clr: '#64748b' };
}

function waitText(s) {
  return s.isReview && !s.a ? '— รอตรวจสอบ —' : '— รออนุมัติ —';
}

function isCurrent(s) {
  return props.record.status === 'pending' && s.i === done() + 1;
}
</script>

<template>
  <!-- ---------- แบบเรียงบรรทัดเดียว ---------- -->
  <div v-if="inline" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 8px">
    <template v-for="(s, idx) in steps()" :key="s.i">
      <span style="display: inline-flex; align-items: center; gap: 8px">
        <span
          style="display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; white-space: nowrap"
          :style="{ background: tone(s).bg, color: tone(s).clr }"
        >
          {{ labelOf(s) }}
          {{ s.a ? `✅ ${s.a.name}` : waitText(s) }}
        </span>
        <span v-if="idx < steps().length - 1" style="color: #94a3b8">→</span>
      </span>
    </template>
  </div>

  <!-- ---------- แบบตารางแนวตั้ง ---------- -->
  <div v-else style="margin-top: 8px">
    <div
      v-for="s in steps()"
      :key="s.i"
      style="display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px"
    >
      <span style="font-weight: 600">{{ isCurrent(s) ? '👉 ' : '' }}{{ labelOf(s) }}</span>
      <span v-if="s.a" style="color: #15803d">
        ✅ {{ s.a.name }}{{ s.a.at ? ' (' + UI.date(s.a.at) + ')' : '' }}
      </span>
      <span v-else class="hint">{{ waitText(s) }}</span>
    </div>
  </div>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
