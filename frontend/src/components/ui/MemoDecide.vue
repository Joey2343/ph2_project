<script setup>
/**
 * MemoDecide — หน้าต่างอนุมัติ / ไม่อนุมัติ / ส่งกลับเพื่อแก้ไข บันทึกข้อความ
 *
 * ย้ายจาก MemosView.openDecide() (263 บรรทัด)
 *
 * โครงสร้างต่างกันทุกขั้น — ต้องได้ขั้นก่อน
 *   ขั้นที่ 1 (ผู้อนุมัติขั้นต้น)
 *     · ความเห็น: เพื่อโปรดพิจารณา / เพื่อโปรดทราบ  (ติ๊กได้ 1 ช่อง)
 *     · เรียนเสนอ: เลือกผู้อนุมัติขั้นที่ 2
 *   ขั้นที่ 2 (ผู้อนุมัติขั้นกลาง)
 *     · เลือกขั้นตอน: ผ่านเรื่อง (ส่งต่อขั้นที่ 3) หรือ ปฏิบัติราชการ/รักษาราชการแทน (จบที่ขั้นนี้)
 *     · ผ่านเรื่อง: ความเห็น + ความเห็นเพิ่มเติม + เลือกผู้อนุมัติขั้นที่ 3
 *     · ปฏิบัติราชการฯ: ติ๊กได้หลายช่อง + ความเห็นเพิ่มเติม + ปุ่มลงนามในร่างเอกสาร
 *   ขั้นที่ 3 (สุดท้าย) — บันทึกสั่งการ
 *     · ติ๊กได้หลายช่อง + ความเห็นเพิ่มเติม + ปุ่มลงนามในร่างเอกสาร
 *
 * ทุกขั้นมีส่วน "ส่งกลับ/คืนเรื่องเพื่อแก้ไข"
 *   ขั้นที่ 1 ใช้คำว่า "ส่งกลับเพื่อให้แก้ไข" ขั้นที่ 2 ขึ้นไปใช้ "คืนเรื่องเพื่อแก้ไข"
 *   (เมื่อผู้อนุมัติขั้นที่ 2 คืนเรื่อง ผู้บันทึกแก้แล้วส่งใหม่ เรื่องจะกลับมาที่ขั้นที่ 2 ทันที)
 */
import { ref, computed, onMounted } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import { Auth } from '../../stores/auth.js';
import { MEMO_LEVEL_NAMES, MEMO_ACT_CHOICES } from '../../lib/memo.js';
import AppModal from './AppModal.vue';
import MemoDoc from './MemoDoc.vue';
import ApprovalSteps from './ApprovalSteps.vue';

const ACT_CHOICES = MEMO_ACT_CHOICES;

const props = defineProps({
  memo: { type: Object, required: true },
  /** 'approve' | 'reject' */
  action: { type: String, required: true },
});

const emit = defineEmits(['close', 'done']);

const m = computed(() => props.memo);
const isApprove = computed(() => props.action === 'approve');
const required = computed(() => m.value.required_levels || 1);
const next = computed(() => UI.approvalDone(m.value) + 1);

const isFirst = computed(() => next.value === 1);
const isSecond = computed(() => next.value === 2);
const isThird = computed(() => next.value === 3);

/* ---------- ฟอร์ม ---------- */
const busy = ref(false);
const note = ref('');
const decide = ref('');
const nextApprover = ref('');
const mode = ref('');
const decide2 = ref('');
const comment = ref('');
const level3 = ref('');
const actSet = ref([]);
const orderSet = ref([]);
const revisionNote = ref('');

/** ตัวเลือกผู้อนุมัติขั้นถัดไป — ดึงจาก chain snapshot ณ เวลาส่ง ถ้าไม่มีใช้ config ปัจจุบัน */
const nextOptions = ref([]);
const level3Options = ref([]);

async function loadApproverOptions(level) {
  try {
    const d = await api.get('/memo/approvers');
    const staff = d.staff || [];
    let ids = [];
    try {
      const chain = JSON.parse(m.value.approval_chain || '[]');
      if (Array.isArray(chain)) {
        const lv = chain.find((x) => Number(x.level) === level);
        if (lv && Array.isArray(lv.ids) && lv.ids.length) ids = lv.ids.map(Number);
      }
    } catch {
      /* chain ไม่อ่านได้ → ใช้ config ปัจจุบัน */
    }
    if (!ids.length) ids = ((d.approvers || {})[level] || []).map(Number);
    const byId = {};
    for (const u of staff) byId[u.id] = u;
    return ids.map((id) => byId[id]).filter(Boolean);
  } catch {
    return [];
  }
}

onMounted(async () => {
  if (isApprove.value && isFirst.value) nextOptions.value = await loadApproverOptions(2);
  if (isApprove.value && isSecond.value) level3Options.value = await loadApproverOptions(3);
});

function toggle(list, v) {
  const i = list.indexOf(v);
  if (i >= 0) list.splice(i, 1);
  else list.push(v);
}

const heading = computed(() => {
  if (!isApprove.value) return '✕ ยืนยันการไม่อนุมัติ — จะแจ้งเตือนผู้จัดทำทันที';
  if (isThird.value) return '● ยืนยันการอนุมัติ (ขั้นที่ 3) — เลือก บันทึกสั่งการ ด้านล่าง';
  if (next.value >= required.value) return '● ยืนยันการอนุมัติ — เมื่ออนุมัติแล้วถือเป็นสิ้นสุดการพิจารณา';
  if (isSecond.value) return '● ยืนยันการอนุมัติ (ขั้นที่ 2) — เลือก ผ่านเรื่อง หรือ ปฏิบัติราชการ/รักษาราชการแทน ด้านล่าง';
  return `● ยืนยันการอนุมัติ (${MEMO_LEVEL_NAMES[next.value] || 'ขั้นที่ ' + next.value}) — ระบบจะส่งเรื่องต่อไปยังขั้นถัดไป`;
});

/** จำนวนขั้นที่ต้องอนุมัติจริง — ขั้นที่ 2 ใช้ "ปฏิบัติราชการฯ" จบที่ขั้นที่ 2 */
const effectiveLevels = computed(() => {
  const l2 = (m.value.approvals || []).find((a) => Number(a.level) === 2);
  if (l2 && l2.mode === 'act') return 2;
  return required.value;
});

const returnTitle = computed(() => (isFirst.value ? 'ส่งกลับเพื่อให้แก้ไข' : 'คืนเรื่องเพื่อแก้ไข'));
const returnBtnText = computed(() =>
  isFirst.value ? '↩ ส่งกลับเพื่อให้แก้ไข' : '↩ คืนเรื่องเพื่อแก้ไข',
);

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

/** ไฟล์แนบทั้งหมด ไว้ด้านบนของหน้าอนุมัติ ให้ผู้อนุมัติเปิดตรวจก่อนตัดสินใจ */
const fileGroups = computed(() => {
  const parse = (json) => {
    try {
      const d = JSON.parse(json || 'null');
      if (Array.isArray(d)) return d;
      if (d && d.file) return [d];
    } catch {
      /* ข้อมูลเสียรูปแบบ → ถือว่าไม่มีไฟล์ */
    }
    return [];
  };
  return [
    { label: 'อ้างถึง', files: parse(m.value.ref_files) },
    { label: 'สิ่งที่ส่งมาด้วย', files: parse(m.value.enc_files) },
    { label: 'ร่างหนังสือส่ง', files: parse(m.value.draft_file) },
  ].filter((g) => g.files.length);
});

const radioStyle = { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 400, whiteSpace: 'nowrap' };

/* ---------- ยืนยัน ---------- */
async function submit() {
  const p = {};
  p.note = note.value;

  if (isApprove.value && isFirst.value) {
    if (!decide.value) {
      return UI.toast('กรุณาเลือกความเห็นในส่วนอนุมัติขั้นต้น (เพื่อโปรดพิจารณา / เพื่อโปรดทราบ)', 'error');
    }
    if (nextOptions.value.length && !nextApprover.value) {
      return UI.toast('กรุณาเลือกผู้อนุมัติขั้นที่ 2 (เรียนเสนอ) ก่อนยืนยันอนุมัติ', 'error');
    }
    p.decide = decide.value;
    p.next_approver_id = nextApprover.value ? Number(nextApprover.value) : undefined;
  }

  if (isApprove.value && isSecond.value) {
    if (!mode.value) return UI.toast('กรุณาเลือก ผ่านเรื่อง หรือ ปฏิบัติราชการ/รักษาราชการแทน', 'error');
    p.mode = mode.value;
    p.comment = comment.value.trim() || undefined;
    if (mode.value === 'pass') {
      if (!decide2.value) {
        return UI.toast('กรุณาเลือกความเห็นในส่วน ผ่านเรื่อง/เสนอต่อ (เพื่อโปรดทราบ / เพื่อโปรดพิจารณา)', 'error');
      }
      if (level3Options.value.length && !level3.value) {
        return UI.toast('กรุณาเลือกผู้อนุมัติขั้นที่ 3 (สุดท้าย)', 'error');
      }
      p.decide = decide2.value;
      p.next_approver_id = level3.value ? Number(level3.value) : undefined;
    } else {
      if (actSet.value.length === 0) {
        return UI.toast('กรุณาเลือกอย่างน้อย 1 รายการในส่วน ปฏิบัติราชการ/รักษาราชการแทน', 'error');
      }
      p.act_choices = [...actSet.value];
    }
  }

  if (isApprove.value && isThird.value) {
    if (orderSet.value.length === 0) return UI.toast('กรุณาเลือกอย่างน้อย 1 รายการในส่วน บันทึกสั่งการ', 'error');
    p.act_choices = [...orderSet.value];
    p.comment = comment.value.trim() || undefined;
  }

  busy.value = true;
  try {
    const res = await api.put(`/memos/${m.value.id}/${isApprove.value ? 'approve' : 'reject'}`, p);
    UI.toast(res.message);
    emit('done');
    emit('close');
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}

/** ส่งกลับ/คืนเรื่องเพื่อแก้ไข */
async function sendBack() {
  const t = revisionNote.value.trim();
  if (!t) return UI.toast('กรุณากรอกสิ่งที่ให้แก้ไขก่อนส่งกลับ', 'error');
  busy.value = true;
  try {
    const res = await api.put(`/memos/${m.value.id}/return`, { note: t });
    UI.toast(res.message);
    emit('done');
    emit('close');
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}

/** ลงนามในร่างเอกสาร (เปิดหน้าต่าง sign-editor) */
function openSignEditor() {
  let draft = null;
  try {
    const d = JSON.parse(m.value.draft_file || 'null');
    if (Array.isArray(d)) draft = d[0];
    else if (d && d.file) draft = d;
  } catch {
    /* ไม่มีร่างหนังสือส่ง */
  }
  if (!draft || !draft.file) return UI.toast('บันทึกข้อความนี้ไม่มีไฟล์ร่างหนังสือส่ง', 'error');
  if (!Auth.user || !Auth.user.signature) {
    return UI.toast('คุณยังไม่มีลายเซ็นในระบบ — กรุณาอัปโหลดลายเซ็นก่อนลงนามในร่างเอกสาร', 'error');
  }
  const w = window.open(`/sign-editor.html?id=${m.value.id}`, '_blank', 'width=1080,height=900');
  if (!w) return UI.toast('เบราว์เซอร์บล็อกหน้าต่างลงนาม กรุณาอนุญาต pop-up', 'error');
  w.focus();
}

const APPROVAL_RECORD = computed(() => ({
  ...m.value,
  approvals: m.value.approvals || [],
  required_levels: effectiveLevels.value,
}));
</script>

<template>
  <AppModal
    :title="isApprove ? '● อนุมัติบันทึกข้อความ' : '✕ ไม่อนุมัติบันทึกข้อความ'"
    size="lg"
    footer
    @close="emit('close')"
  >
    <div class="form-group full" style="margin-bottom: 10px; font-weight: 600">{{ heading }}</div>

    <!-- ---------- ที่แนบเอกสาร ---------- -->
    <div
      v-if="fileGroups.length"
      class="form-group full"
      style="margin-top: 12px; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 10px; padding: 12px"
    >
      <label>△ ที่แนบเอกสาร</label>
      <div v-for="g in fileGroups" :key="g.label" style="margin-top: 4px">
        <span style="font-weight: 600">{{ g.label }}: </span>
        <a
          v-for="f in g.files"
          :key="f.file"
          :href="'/uploads/' + UI.encodePath(f.file)"
          target="_blank"
          style="margin-right: 10px"
          >△ {{ f.name || f.file }}</a
        >
      </div>
    </div>

    <!-- ---------- แบบฟอร์มทางการ ---------- -->
    <MemoDoc :memo="m" />

    <!-- ---------- ความคืบหน้า ---------- -->
    <div class="form-group full" style="margin-top: 12px">
      <label>ความคืบหน้าการอนุมัติ</label>
      <ApprovalSteps :record="APPROVAL_RECORD" :level-names="MEMO_LEVEL_NAMES" inline />
      <div v-if="nextApproverLine" class="hint" style="margin-top: 6px; color: #0369a1; font-weight: 600">
        {{ nextApproverLine }}
      </div>
    </div>

    <!-- ---------- หมายเหตุ ---------- -->
    <div class="form-group full" style="margin-top: 12px">
      <label>หมายเหตุ</label>
      <textarea v-model="note" rows="2" placeholder="หมายเหตุ (ไม่บังคับ)" style="width: 100%"></textarea>
    </div>

    <!-- ---------- ขั้นที่ 1: ความเห็น + เรียนเสนอ ---------- -->
    <template v-if="isApprove && isFirst">
      <div class="form-group full" style="margin-top: 12px">
        <label>อนุมัติขั้นต้น<span class="req"> *</span></label>
        <div style="display: flex; gap: 18px; flex-wrap: nowrap; margin-top: 6px">
          <label v-for="o in ['เพื่อโปรดพิจารณา', 'เพื่อโปรดทราบ']" :key="o" :style="radioStyle">
            <input v-model="decide" type="radio" name="memo-decide" :value="o" />{{ o }}
          </label>
        </div>
      </div>

      <div v-if="nextOptions.length" class="form-group full" style="margin-top: 12px">
        <label>เรียนเสนอ<span class="req"> *</span></label>
        <select v-model="nextApprover" style="width: 100%">
          <option value="">— กรุณาเลือกผู้อนุมัติขั้นที่ 2 —</option>
          <option v-for="u in nextOptions" :key="u.id" :value="u.id">
            {{ UI.personName(u) }}{{ u.position ? ' (' + u.position + ')' : '' }}
          </option>
        </select>
      </div>
    </template>

    <!-- ---------- ขั้นที่ 2: ขั้นตอนการพิจารณา ---------- -->
    <template v-if="isApprove && isSecond">
      <div class="form-group full" style="margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 14px">
        <label>ขั้นตอนการพิจารณา<span class="req"> *</span></label>
        <div style="display: flex; gap: 24px; flex-wrap: wrap; margin-top: 6px">
          <label v-if="level3Options.length" :style="radioStyle">
            <input v-model="mode" type="radio" name="memo-mode2" value="pass" />ผ่านเรื่อง
          </label>
          <label :style="radioStyle">
            <input v-model="mode" type="radio" name="memo-mode2" value="act" />ปฏิบัติราชการ/รักษาราชการแทน
          </label>
        </div>
      </div>

      <!-- ผ่านเรื่อง/เสนอต่อ -->
      <div v-if="mode === 'pass'" style="display: block">
        <div class="form-group full" style="margin-top: 12px">
          <label>ผ่านเรื่อง/เสนอต่อ<span class="req"> *</span></label>
          <div style="display: flex; gap: 18px; flex-wrap: nowrap; margin-top: 6px">
            <label v-for="o in ['เพื่อโปรดพิจารณา', 'เพื่อโปรดทราบ']" :key="o" :style="radioStyle">
              <input v-model="decide2" type="radio" name="memo-decide2" :value="o" />{{ o }}
            </label>
          </div>
        </div>

        <div class="form-group full" style="margin-top: 12px">
          <label>ความเห็นเพิ่มเติม</label>
          <textarea v-model="comment" rows="2" placeholder="ความเห็นเพิ่มเติม (ไม่บังคับ)" style="width: 100%"></textarea>
        </div>

        <div v-if="level3Options.length" class="form-group full" style="margin-top: 12px">
          <label>เลือกผู้อนุมัติขั้นที่ 3 (สุดท้าย)<span class="req"> *</span></label>
          <select v-model="level3" style="width: 100%">
            <option value="">— กรุณาเลือกผู้อนุมัติขั้นที่ 3 (สุดท้าย) —</option>
            <option v-for="u in level3Options" :key="u.id" :value="u.id">
              {{ UI.personName(u) }}{{ u.position ? ' (' + u.position + ')' : '' }}
            </option>
          </select>
        </div>
      </div>

      <!-- ปฏิบัติราชการ/รักษาราชการแทน -->
      <div v-else-if="mode === 'act'" style="display: block">
        <div class="form-group full" style="margin-top: 12px">
          <label>ปฏิบัติราชการ/รักษาราชการแทน<span class="req"> *</span></label>
          <div style="display: flex; gap: 14px; flex-wrap: wrap; margin-top: 6px">
            <label v-for="c in ACT_CHOICES" :key="c" :style="radioStyle">
              <input type="checkbox" :checked="actSet.includes(c)" @change="toggle(actSet, c)" />{{ c }}
            </label>
          </div>
        </div>

        <div class="form-group full" style="margin-top: 12px">
          <label>ความเห็นเพิ่มเติม</label>
          <textarea v-model="comment" rows="2" placeholder="ความเห็นเพิ่มเติม (ไม่บังคับ)" style="width: 100%"></textarea>
        </div>

        <div class="form-group full" style="margin-top: 16px; border-top: 1px dashed var(--border); padding-top: 14px">
          <label><span style="color: #2563eb">✎</span> ลงนามในร่างเอกสาร</label>
          <div class="hint" style="margin-top: 4px">
            เปิดร่างหนังสือส่งเพื่อวางลายเซ็นของคุณลงในเอกสาร แล้วบันทึกทับไฟล์เดิม
          </div>
          <button class="btn btn-blue btn-sm" style="margin-top: 8px" @click="openSignEditor">
            ✎ ลงนามในร่างเอกสาร
          </button>
        </div>
      </div>
    </template>

    <!-- ---------- ขั้นที่ 3: บันทึกสั่งการ ---------- -->
    <template v-if="isApprove && isThird">
      <div class="form-group full" style="margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 14px">
        <label>บันทึกสั่งการ<span class="req"> *</span></label>
        <div style="display: flex; gap: 14px; flex-wrap: wrap; margin-top: 6px">
          <label v-for="c in ACT_CHOICES" :key="c" :style="radioStyle">
            <input type="checkbox" :checked="orderSet.includes(c)" @change="toggle(orderSet, c)" />{{ c }}
          </label>
        </div>
      </div>

      <div class="form-group full" style="margin-top: 12px">
        <label>ความเห็นเพิ่มเติม</label>
        <textarea v-model="comment" rows="2" placeholder="ความเห็นเพิ่มเติม (ไม่บังคับ)" style="width: 100%"></textarea>
      </div>

      <div class="form-group full" style="margin-top: 16px; border-top: 1px dashed var(--border); padding-top: 14px">
        <label><span style="color: #2563eb">✎</span> ลงนามในร่างเอกสาร</label>
        <div class="hint" style="margin-top: 4px">
          เปิดร่างหนังสือส่งเพื่อวางลายเซ็นของคุณลงในเอกสาร แล้วบันทึกทับไฟล์เดิม
        </div>
        <button class="btn btn-blue btn-sm" style="margin-top: 8px" @click="openSignEditor">
          ✎ ลงนามในร่างเอกสาร
        </button>
      </div>
    </template>

    <!-- ---------- ส่งกลับ/คืนเรื่องเพื่อแก้ไข ---------- -->
    <div
      v-if="isApprove"
      class="form-group full"
      style="margin-top: 16px; border-top: 1px dashed var(--border); padding-top: 14px"
    >
      <label><span style="color: #ea580c">↩</span> {{ returnTitle }}</label>
      <textarea
        v-model="revisionNote"
        rows="2"
        placeholder="สิ่งที่ให้แก้ไข (ผู้บันทึกข้อความจะเห็นข้อความนี้และแก้ไขตามที่ระบุ)"
        style="width: 100%"
      ></textarea>
      <button class="btn btn-sendback" style="margin-top: 8px" :disabled="busy" @click="sendBack">
        {{ returnBtnText }}
      </button>
    </div>

    <template #footer>
      <button class="btn btn-outline" :disabled="busy" @click="emit('close')">ยกเลิก</button>
      <button
        class="btn"
        :class="isApprove ? 'btn-success' : 'btn-danger'"
        :disabled="busy"
        @click="submit"
      >
        {{ isApprove ? '● ยืนยันอนุมัติ' : '✕ ยืนยันไม่อนุมัติ' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
