<script setup>
/**
 * MemoForm — แบบฟอร์มเขียน / แก้ไขบันทึกข้อความ
 *
 * ย้ายจาก MemosView.openForm() (166 บรรทัด)
 *
 * ปุ่ม 3 แบบ (ตามสถานะของรายการ):
 *   ฉบับร่าง/ส่งแล้ว → "บันทึกฉบับร่าง" + "ส่ง"
 *   อนุมัติ/ไม่อนุมัติแล้ว → "บันทึก" (คงสถานะเดิม)
 *
 * หลังกด "ส่ง" สำเร็จ → เปิดแบบฟอร์มทางการให้พิมพ์ทันที (ของเดิมทำเช่นนี้)
 */
import { ref, computed, onMounted } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import { Auth } from '../../stores/auth.js';
import { CONSTANTS } from '../../constants/index.js';
import { MEMO_LEVEL_NAMES, MEMO_SETTLED } from '../../lib/memo.js';
import AppModal from './AppModal.vue';
import ThaiDateField from './ThaiDateField.vue';
import MemoRichEditor from './MemoRichEditor.vue';
import MemoFileGroup from './MemoFileGroup.vue';
import MemoDoc from './MemoDoc.vue';

const props = defineProps({
  /** record ที่กำลังแก้ไข — null = เขียนใหม่ */
  memo: { type: Object, default: null },
});

const emit = defineEmits(['close', 'saved']);

const m = computed(() => props.memo || {});
const isNew = computed(() => !m.value.id);
const busy = ref(false);

/* ---------- ค่าเริ่มต้น ---------- */
const office = ref('');
const docNo = ref('');
const urgency = ref('ปกติ');
const date = ref(m.value.date || UI.today());
const title = ref(m.value.title || '');
const toText = ref(m.value.to_text || 'ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2');
const content = ref(m.value.content || '');

/** ผู้รับ (ส่งบันทึกข้อความถึง) — มาจากลำดับขั้นที่ admin กำหนด */
const sendTo = ref([]);

/** ตัวเลือกที่เลือกอยู่ (เก็บเป็น id ของเจ้าหน้าที่ 1 คน) */
const sendToId = ref('');

/** ข้อมูลที่โหลดจาก /memo/approvers */
const staff = ref([]);
const approvers = ref({ 1: [], 2: [], 3: [] });
const perPerson = ref({ 1: {}, 2: {}, 3: {} });

const refFiles = ref(null);
const encFiles = ref(null);
const draftFiles = ref(null);

/** แบบฟอร์มทางการที่เปิดหลังกด "ส่ง" สำเร็จ */
const showFormDoc = ref(null);

const URGENCIES = ['ปกติ', 'ด่วน', 'ด่วนที่สุด'];

/** ตัวเลือกส่วนราชการ: สังกัดของผู้ใช้ + กลุ่มงานทั้งหมด */
const officeOptions = computed(() => {
  const my = (Auth.user && Auth.user.workplace) || '';
  return [...new Set([my, ...CONSTANTS.WORKPLACES].filter(Boolean))];
});

/** ปุ่มตามสถานะ: แก้ไขแล้วจบแล้ว → บันทึกอย่างเดียว */
const isSettled = computed(() => MEMO_SETTLED.includes(m.value.status));

onMounted(async () => {
  const myWorkplace = (Auth.user && Auth.user.workplace) || '';
  office.value = isNew.value ? myWorkplace : m.value.office || myWorkplace;

  // ผู้รับ: ตอนแก้ไขเก็บของเดิม / ตอนเขียนใหม่ใช้ "ผู้อนุมัติขั้นที่ 1 ของผู้จัดทำ" (รายบุคคล)
  try {
    const d = await api.get('/memo/approvers');
    approvers.value = d.approvers || approvers.value;
    perPerson.value = d.perPerson || perPerson.value;
    staff.value = d.staff || [];
  } catch {
    /* โหลดไม่ได้ = ไม่มีผู้รับ ให้ผู้ใช้ติดต่อผู้ดูแลระบบ */
  }

  let list = [];
  try {
    const parsed = JSON.parse(m.value.send_to || '[]');
    if (Array.isArray(parsed) && parsed.length) list = parsed;
  } catch {
    /* ข้อมูลเสียรูปแบบ → ถือว่ายังไม่มีผู้รับ */
  }
  if (!list.length) {
    const myId = String((Auth.user && Auth.user.id) || '');
    const myL1 = Number((perPerson.value['1'] || {})[myId]) || 0;
    const ids = myL1 ? [myL1] : (approvers.value['1'] || []).map(Number);
    for (const uid of ids) {
      const u = (staff.value || []).find((x) => Number(x.id) === Number(uid));
      if (u) {
        list.push({
          id: u.id,
          title: u.title,
          first_name: u.first_name,
          last_name: u.last_name,
          name: u.full_name,
          position: u.position,
          level: 1,
        });
      }
    }
  }
  sendTo.value = list;
  sendToId.value = list.length ? String(list[0].id) : '';

  // เลขที่อัตโนมัติ (แสดงอย่างเดียว แก้ไขไม่ได้)
  if (isNew.value) {
    try {
      const d = await api.get('/memos/next-no');
      if (!docNo.value) docNo.value = d.next || '';
    } catch {
      /* ให้เว้าว่าง */
    }
  }
});

function personText(p) {
  return `${p.title || ''}${p.first_name || p.name || ''}  ${p.last_name || ''}`.trim();
}

/**
 * ตัวเลือกผู้รับ = ผู้อนุมัติที่ admin ตั้งไว้เท่านั้น (ไม่ใช่เจ้าหน้าที่ทุกคน)
 *
 * ดึงจาก 2 ที่ของ /memo/approvers
 *   approvers[lv]            = ลำดับรวม (fallback เดิม)
 *   Object.values(perPerson[lv]) = ลำดับรายบุคคล (ที่ตั้งค่าในแท็บตั้งค่าการอนุมัติ)
 * คนเดียวกันที่ถูกตั้งหลายขั้นจะรวมเป็นรายการเดียว แสดงขั้นทั้งหมดที่ตั้งไว้
 */
const approverOptions = computed(() => {
  const byId = new Map(staff.value.map((u) => [Number(u.id), u]));
  const levelsOf = new Map();

  const mark = (id, lv) => {
    const n = Number(id);
    // ข้ามถ้าไม่ใช่เจ้าหน้าที่ฝั่งสำนักงานเขตที่ยัง active
    if (!n || !byId.has(n)) return;
    if (!levelsOf.has(n)) levelsOf.set(n, new Set());
    levelsOf.get(n).add(Number(lv));
  };
  for (const lv of ['1', '2', '3']) {
    for (const id of approvers.value[lv] || []) mark(id, lv);
    for (const id of Object.values(perPerson.value[lv] || {})) mark(id, lv);
  }

  const opts = [...levelsOf.entries()].map(([id, lvs]) => {
    const u = byId.get(id);
    const arr = [...lvs].sort((a, b) => a - b);
    return {
      id,
      name: personText(u),
      position: u.position || '',
      // เก็บข้อมูลชื่อจริงไว้ด้วย — ตอนบันทึก send_to ต้องมีรูปแบบเดียวกับของเดิม
      // คนอื่นอ่านค่านี้ต่อ (MemoView แสดงชื่อ, หน้าอนุมัติเช็กชื่อผู้อนุมัติ)
      staff: {
        title: u.title || '',
        first_name: u.first_name || '',
        last_name: u.last_name || '',
        full_name: u.full_name || '',
      },
      minLevel: arr[0],
      // ใน dropdown ใช้แค่เลขขั้น ชื่อเต็มไปอยู่ในบรรทัดคำอธิบายล่างแทน
      // (ถ้าใส่ชื่อเต็ม 3 ขั้น ช่องจะกว้างจนล้นบรรทัด)
      levelLabel: `ขั้นที่ ${arr.join(', ')}`,
      levelFull: arr.map((lv) => MEMO_LEVEL_NAMES[lv] || `ขั้นที่ ${lv}`).join(' → '),
      stale: false,
    };
  });
  opts.sort((a, b) => a.minLevel - b.minLevel || a.name.localeCompare(b.name, 'th'));

  // ผู้รับเดิมของบันทึกที่กำลังแก้ไข อาจไม่อยู่ในรายชื่อผู้อนุมัติแล้ว
  // → ต้องยังแสดงให้เลือกได้ ไม่งั้นการบันทึกจะเปลี่ยนผู้รับเงียบ ๆ
  for (const p of sendTo.value) {
    const id = Number(p.id);
    if (!id || opts.some((o) => o.id === id)) continue;
    opts.unshift({
      id,
      name: personText(p),
      position: p.position || '',
      staff: {
        title: p.title || '',
        first_name: p.first_name || '',
        last_name: p.last_name || '',
        full_name: p.name || '',
      },
      minLevel: Number(p.level) || 9,
      levelLabel: `ขั้นที่ ${Number(p.level) || '-'} (ผู้รับเดิม)`,
      levelFull: `${MEMO_LEVEL_NAMES[Number(p.level)] || 'ผู้รับเดิม'} — ไม่อยู่ในรายชื่อผู้อนุมัติที่ตั้งไว้`,
      stale: true,
    });
  }
  return opts;
});

/** คำอธิบายผู้รับที่เลือก: ตำแหน่ง + ชื่อขั้นเต็ม (บรรทัดเดียว ตัดท้ายด้วย …) */
const sendToHint = computed(() => {
  const o = approverOptions.value.find((x) => String(x.id) === sendToId.value);
  if (!o) return '';
  return [o.position, o.levelFull].filter(Boolean).join(' · ');
});

/** เลือกผู้รับใหม่ → เขียนกลับลง sendTo (เก็บคนเดียวตามที่เลือก) */
function pickSendTo() {
  const id = Number(sendToId.value);
  const o = approverOptions.value.find((x) => x.id === id);
  if (!o) {
    sendTo.value = [];
    return;
  }
  sendTo.value = [{
    id: o.id,
    title: o.staff.title,
    first_name: o.staff.first_name,
    last_name: o.staff.last_name,
    name: o.staff.full_name,
    position: o.position,
    level: o.minLevel,
  }];
}

/* ---------- ส่งข้อมูล ---------- */
async function save(mode) {
  const t = title.value.trim();
  const off = office.value.trim();
  if (!t) return UI.toast('กรุณากรอกเรื่อง (หัวข้อ) ของบันทึกข้อความ', 'error');
  if (!off) return UI.toast('กรุณากรอกส่วนราชการ', 'error');

  // ตรวจขนาดไฟล์แนบก่อน (ทั้ง 3 กลุ่ม)
  for (const g of [refFiles.value, encFiles.value, draftFiles.value]) {
    const big = g && g.tooLarge;
    if (big) return UI.toast(big, 'error'); // loop-exit — เตือนกลุ่มแรกที่มีไฟล์ใหญ่ แล้วหยุด
  }

  const isSubmit = mode === 'submit';
  // ส่งต้องมีผู้รับ ไม่งั้นส่งต่อไม่ได้
  if (isSubmit && !sendTo.value.length) {
    return UI.toast('กรุณากำหนดผู้รับในช่อง ส่งบันทึกข้อความถึง ก่อนส่ง', 'error');
  }

  const fd = new FormData();
  fd.append('doc_no', docNo.value.trim());
  fd.append('date', date.value);
  fd.append('office', off);
  fd.append('urgency', urgency.value);
  fd.append('title', t);
  fd.append('to_text', toText.value.trim());
  fd.append('content', content.value || '');
  // ฉบับร่าง = draft / กดส่ง = submitted / บันทึกแก้ไข = คงสถานะเดิม
  fd.append(
    'status',
    isSubmit ? 'submitted' : mode === 'keep' ? m.value.status || 'draft' : 'draft',
  );
  fd.append('send_to', JSON.stringify(sendTo.value));

  // ไฟล์แนบ: ref_files / enc_files / draft_file + ชื่อที่ตั้ง
  const FIELD = { refFiles: 'ref_files', encFiles: 'enc_files', draftFiles: 'draft_file' };
  for (const [key, field] of Object.entries(FIELD)) {
    const g = { refFiles: refFiles.value, encFiles: encFiles.value, draftFiles: draftFiles.value }[key];
    const payload = g ? g.toPayload() : { files: [], names: [] };
    for (const file of payload.files) fd.append(field, file);
    fd.append(key.replace('Files', '') + '_names', JSON.stringify(payload.names));
  }

  // ค่าสำหรับสร้างแบบฟอร์มทางการทันที (ต้องอ่านก่อนปิดฟอร์ม เพราะหลังปิด DOM จะถูกลบ)
  const formDoc = isSubmit
    ? {
        doc_no: docNo.value.trim(),
        date: date.value,
        office: off,
        title: t,
        to_text: toText.value.trim(),
        content: content.value || '',
        maker_title: (Auth.user && Auth.user.title) || '',
        full_name: (Auth.user && Auth.user.full_name) || '',
        first_name: (Auth.user && Auth.user.first_name) || '',
        last_name: (Auth.user && Auth.user.last_name) || '',
        maker_position: (Auth.user && Auth.user.position) || '',
        maker_signature: (Auth.user && Auth.user.signature) || '',
      }
    : null;

  busy.value = true;
  try {
    const res = m.value.id
      ? await api.putForm('/memos/' + m.value.id, fd)
      : await api.postForm('/memos', fd);
    UI.toast(res.message);
    emit('saved');
    emit('close');
    // กด "ส่ง" แล้ว → เปิดแบบฟอร์มบันทึกข้อความให้พิมพ์ทันที
    if (formDoc) showFormDoc.value = formDoc;
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}

/** พิมพ์แบบฟอร์มทางการที่เพิ่งสร้าง (เปิดหน้าต่างใหม่) */
function printNewForm() {
  const el = document.getElementById('memo-doc-print');
  if (!el) return;
  const css = document.querySelector('link[href*="theme"], link[href*="index-"]');
  const styleTag = css ? `<link rel="stylesheet" href="${css.href}">` : '';
  const w = window.open('', '_blank', 'width=900,height=1200');
  if (!w) return UI.toast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต pop-up', 'error');
  w.document.write(
    `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>บันทึกข้อความ</title>${styleTag}` +
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
  <div>
    <AppModal
      :title="m.id ? '✎ แก้ไขบันทึกข้อความ' : '✎ เขียนบันทึกข้อความ'"
      size="lg"
      footer
      flat-head
      @close="emit('close')"
    >
      <div class="form-grid memo-form">
        <!-- สิ่งที่ให้แก้ไข (เมื่อถูกส่งกลับ) -->
        <div
          v-if="m.status === 'returned' && m.revision_note"
          class="form-group full"
          style="background: #fffbeb; border: 1px solid #fcd34d; border-radius: 10px; padding: 12px; color: #92400e; font-weight: 600"
        >
          ↻ ส่งกลับเพื่อแก้ไข — {{ m.revision_note }}
        </div>

        <div class="form-group full">
          <label>ส่วนราชการ<span class="req"> *</span></label>
          <input
            v-model="office"
            list="mf-office-list"
            placeholder="เลือกหรือพิมพ์ส่วนราชการ"
          />
          <datalist id="mf-office-list">
            <option v-for="o in officeOptions" :key="o" :value="o"></option>
          </datalist>
        </div>

        <div class="form-group">
          <label>ที่</label>
          <input v-model="docNo" readonly placeholder="ระบบออกเลขให้อัตโนมัติ" />
        </div>

        <div class="form-group">
          <label>ความเร่งด่วน</label>
          <div class="urgency-row">
            <label
              v-for="u in URGENCIES"
              :key="u"
              class="urgency-opt"
              :class="'urgency-' + u"
              :for="'mf-urgency-' + u"
            >
              <input
                :id="'mf-urgency-' + u"
                v-model="urgency"
                type="radio"
                name="mf-urgency"
                :value="u"
              />
              {{ u }}
            </label>
          </div>
        </div>

        <div class="form-group">
          <label>วันที่<span class="req"> *</span></label>
          <ThaiDateField id="mf-date" v-model="date" />
        </div>

        <div class="form-group full">
          <label>เรื่อง<span class="req"> *</span></label>
          <input v-model="title" placeholder="เช่น ขออนุมัติจัดซื้อวัสดุสำนักงาน" />
        </div>

        <div class="form-group full">
          <label>เรียน</label>
          <input v-model="toText" readonly />
        </div>

        <MemoFileGroup
          ref="refFiles"
          kind="ref"
          label="อ้างถึง"
          :existing-json="m.ref_files || ''"
        />
        <MemoFileGroup
          ref="encFiles"
          kind="enc"
          label="สิ่งที่ส่งมาด้วย"
          :existing-json="m.enc_files || ''"
        />
        <MemoFileGroup
          ref="draftFiles"
          kind="draft"
          label="ร่างหนังสือส่ง"
          :existing-json="m.draft_file || ''"
          single
        />

        <div class="form-group full">
          <label>บันทึกข้อความ</label>
          <MemoRichEditor v-model="content" />
        </div>

        <div class="form-group full">
          <label>ส่งบันทึกข้อความถึง</label>
          <select
            v-model="sendToId"
            class="sendto-select"
            :disabled="!approverOptions.length"
            @change="pickSendTo"
          >
            <option v-if="!approverOptions.length" value="">
              ยังไม่ได้กำหนด — ติดต่อผู้ดูแลระบบ
            </option>
            <option v-for="o in approverOptions" :key="o.id" :value="String(o.id)">
              {{ o.name }} — {{ o.levelLabel }}
            </option>
          </select>
          <div v-if="sendToHint" class="hint sendto-hint">{{ sendToHint }}</div>
        </div>

        <div class="form-group">
          <label>บันทึกโดย</label>
          <input :value="UI.personName(Auth.user) || (Auth.user && Auth.user.full_name) || ''" readonly />
        </div>

        <div class="form-group">
          <label>ตำแหน่ง</label>
          <input :value="(Auth.user && Auth.user.position) || ''" readonly />
        </div>
      </div>

      <template #footer>
        <button class="btn btn-outline" :disabled="busy" @click="emit('close')">ยกเลิก</button>
        <button v-if="isSettled" class="btn btn-primary" :disabled="busy" @click="save('keep')">
          {{ busy ? 'กำลังบันทึก…' : '▽ บันทึก' }}
        </button>
        <template v-else>
          <button class="btn btn-outline" :disabled="busy" @click="save('draft')">▽ บันทึกฉบับร่าง</button>
          <button class="btn btn-primary" :disabled="busy" @click="save('submit')">
            {{ busy ? 'กำลังส่ง…' : '▲ ส่ง' }}
          </button>
        </template>
      </template>
    </AppModal>

    <!-- แบบฟอร์มทางการที่เปิดหลังกดส่งสำเร็จ -->
    <AppModal v-if="showFormDoc" title="▭ บันทึกข้อความ" size="lg" footer @close="showFormDoc = null">
      <MemoDoc :memo="showFormDoc" />
      <template #footer>
        <button class="btn btn-outline" @click="showFormDoc = null">ปิด</button>
        <button class="btn btn-primary" @click="printNewForm">⬢ พิมพ์</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */

/*
 * ช่อง "ส่งบันทึกข้อความถึง" — dropdown ขนาดพอดี ไม่กินเต็มบรรทัด
 * และไม่ตัดคำ: theme.css ตั้ง select { width: 100% } ไว้ทั้งระบบ
 * จึงต้อง override เฉพาะที่นี่ (theme.css แก้ไม่ได้)
 */
.sendto-select {
  width: auto;
  max-width: 420px;            /* กันไม่ให้กว้างล้นบรรทัดเมื่อมีชื่อยาว */
  min-width: 240px;
  height: 40px;                /* ล็อกความสูง = ช่อง input ปกติ → บรรทัดเดียว ไม่ตัดสองบรรทัด */
  padding: 0 34px 0 12px;
  line-height: 38px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: #f1f5f9;          /* พื้นเทาอ่อน ตามกล่องเดิม */
  color: #334155;
  cursor: pointer;
}
.sendto-select:disabled { cursor: not-allowed; opacity: .7; }

/* ตำแหน่งของผู้รับที่เลือก */
.sendto-hint {
  margin-top: -2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
