<script setup>
/**
 * MemoView — หน้าต่างดูบันทึกข้อความ
 *
 * ย้ายจาก MemosView.openView()
 *
 * ปุ่มใน footer:
 *   - ปิด
 *   - ⬢ พิมพ์   แสดงเมื่อมีเลขที่หนังสือแล้ว (ก่อนนั้นยังไม่ใช่บันทึกจริง)
 *   - ✎ แก้ไข   เฉพาะเจ้าของหรือ admin
 *
 * ปุ่ม "พิมพ์" ส่ง event ออกไปให้หน้าหลักเปิดแบบฟอร์มทางการแยกอีกหน้าต่าง
 * เพราะ Modal ซ้อนกันสองชั้นทำให้อ่านยาก
 */
import { computed } from 'vue';
import { UI } from '../../ui/ui.js';
import { Auth } from '../../stores/auth.js';
import { MEMO_LEVEL_NAMES } from '../../lib/memo.js';
import AppModal from './AppModal.vue';
import MemoDoc from './MemoDoc.vue';
import ApprovalSteps from './ApprovalSteps.vue';

const props = defineProps({
  memo: { type: Object, required: true },
});

const emit = defineEmits(['close', 'print', 'edit']);

const m = computed(() => props.memo);

const canEdit = computed(() => Auth.isAdmin() || m.value.user_id === Auth.user?.id);

/** ผู้จัดทำ — คำนำหน้าชื่อแยกเป็น maker_title */
function maker() {
  return {
    title: m.value.maker_title,
    full_name: m.value.full_name,
    first_name: m.value.first_name,
    last_name: m.value.last_name,
  };
}

function sendToNames(json) {
  try {
    const arr = JSON.parse(json || '[]');
    if (!Array.isArray(arr)) return '';
    return arr.map((p) => `${p.title || ''}${p.first_name || p.name || ''}  ${p.last_name || ''}`.trim()).join(', ');
  } catch {
    return '';
  }
}

/** ไฟล์แนบแบบลิงก์ (JSON array) */
function fileList(json) {
  try {
    const arr = JSON.parse(json || '[]');
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr;
  } catch {
    return null;
  }
}

function requiredLevels() {
  const l2 = (m.value.approvals || []).find((a) => Number(a.level) === 2);
  if (l2 && l2.mode === 'act') return 2;
  return m.value.required_levels || 1;
}

const APPROVAL_RECORD = computed(() => ({
  ...m.value,
  approvals: m.value.approvals || [],
  required_levels: requiredLevels(),
}));

/** แสดงการส่งต่อเฉพาะเจาะจง: เรียนเสนอ (ขั้น 1→2) และ ผ่านเรื่อง (ขั้น 2→3) */
const nextApproverLine = computed(() => {
  const parts = [];
  const l1 = (m.value.approvals || []).find((a) => Number(a.level) === 1);
  if (l1 && l1.next_approver_name) parts.push(`📨 เรียนเสนอ: ${l1.next_approver_name}`);
  const l2 = (m.value.approvals || []).find((a) => Number(a.level) === 2);
  if (l2 && l2.mode === 'pass' && l2.next_approver_name) {
    parts.push(`📨 ผ่านเรื่อง/เสนอต่อ: ${l2.next_approver_name}`);
  }
  return parts.length ? parts.join('  •  ') : '';
});

/** ไฟล์แนบ 3 กลุ่ม */
const groups = computed(() => {
  const refL = fileList(m.value.ref_files);
  const encL = fileList(m.value.enc_files);
  const draftL = fileList(m.value.draft_file);
  return [
    { label: 'อ้างถึง', files: refL },
    { label: 'สิ่งที่ส่งมาด้วย', files: encL },
    { label: 'ร่างหนังสือส่ง', files: draftL },
  ].filter((g) => g.files);
});
</script>

<template>
  <AppModal title="👁️ ดูบันทึกข้อความ" size="lg" footer @close="emit('close')">
    <!-- ---------- ส่วนหัว ---------- -->
    <div style="text-align: center; margin-bottom: 14px">
      <div class="hint">{{ m.doc_no ? `บันทึกข้อความ ที่ ${m.doc_no}` : 'บันทึกข้อความ (ฉบับร่าง)' }}</div>
      <div style="font-size: 18px; font-weight: 800; margin: 4px 0">{{ m.title }}</div>
      <div class="hint">
        ส่วนราชการ {{ m.office || '-' }} • {{ m.urgency || 'ปกติ' }} • วันที่
        {{ UI.thaiDate(m.date) }} • ผู้จัดทำ {{ UI.personName(maker()) }}
      </div>
    </div>

    <div class="form-grid">
      <div class="form-group full">
        <label>เรียน</label>
        <div>{{ m.to_text || 'ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2' }}</div>
      </div>

      <div v-for="g in groups" :key="g.label" class="form-group full">
        <label>△ {{ g.label }}</label>
        <div v-for="f in g.files" :key="f.file" style="margin-top: 4px">
          <a :href="'/uploads/' + UI.encodePath(f.file)" target="_blank">△ {{ f.name || f.file }}</a>
        </div>
      </div>
    </div>

    <!-- ---------- เนื้อหา ---------- -->
    <div class="card" style="background: #f8fafc; margin-top: 12px">
      <div class="card-title">✎ บันทึกข้อความ</div>
      <div style="line-height: 1.7" v-html="m.content || '-'"></div>
    </div>

    <div class="form-grid" style="margin-top: 12px">
      <div class="form-group full">
        <label>ความคืบหน้าการอนุมัติ</label>
        <ApprovalSteps :record="APPROVAL_RECORD" :level-names="MEMO_LEVEL_NAMES" />
        <div v-if="nextApproverLine" class="hint" style="margin-top: 6px; color: #0369a1; font-weight: 600">
          {{ nextApproverLine }}
        </div>
      </div>
      <div class="form-group full">
        <label>ส่งบันทึกข้อความถึง</label>
        <div>{{ sendToNames(m.send_to) || '-' }}</div>
      </div>
      <div class="form-group">
        <label>บันทึกโดย</label>
        <div>{{ UI.personName(maker()) }}</div>
      </div>
      <div class="form-group">
        <label>ตำแหน่ง</label>
        <div>{{ m.maker_position || '-' }}</div>
      </div>
    </div>

    <!-- ---------- แบบฟอร์มทางการ ---------- -->
    <MemoDoc :memo="m" />

    <template #footer>
      <button class="btn btn-outline" @click="emit('close')">ปิด</button>
      <button v-if="m.doc_no" class="btn btn-primary" @click="emit('print', m)">⬢ พิมพ์</button>
      <button v-if="canEdit" class="btn btn-primary" @click="emit('edit', m)">✎ แก้ไข</button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
