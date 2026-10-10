<script setup>
/**
 * DocumentsFormModal — ฟอร์มลงทะเบียนคำสั่ง / หนังสือรับรอง / เกียรติบัตร
 *
 * ย้ายจาก DocumentsView.openForm() (ฟอร์มง่าย ~570 บรรทัด)
 *
 * ครอบคลุม 3 ประเภท:
 *   order       เลขที่คำสั่ง(รันอัตโนมัติ) · สั่ง ณ วันที่ · เรื่อง · เจ้าของคำสั่ง · ผู้ลงทะเบียน
 *   certificate เลขที่(รันอัตโนมัติ) · วันที่ · เรื่อง · ข้อความ · ผู้ขอ · ตำแหน่ง · เจ้าหน้าที่ · ไฟล์
 *   honor       ที่เกียรติบัตร · ชื่อ-นามสกุล · เรื่อง · ข้อความ · วันที่ · ผู้ลงนาม · แบบพิมพ์ + ตัวเครื่องมือ
 *
 * หลังบันทึกสำเร็จ ปล่อย event 'saved' ให้หน้าหลักโหลดตารางใหม่
 * (หนังสือรับรองจะเปิดแบบฟอร์ม A4 ให้ดู/พิมพ์ทันที ผ่าน event 'cert-saved')
 */
import { ref, computed, watch, onMounted } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import { CONSTANTS } from '../../constants/index.js';
import { docTypeMeta } from '../../lib/documents.js';
import ThaiDateField from '../ui/ThaiDateField.vue';
import AppModal from '../ui/AppModal.vue';
import {
  fetchNextDocNo,
  fetchPersonSuggestions,
  fetchOfficeStaff,
  attachHonorTitle,
  canSignHonor,
  staffLabel,
  saveHonorCertificate,
  printHonor,
} from '../../lib/documents-form.js';

const props = defineProps({
  /** record ที่กำลังแก้ไข (null = สร้างใหม่) */
  doc: { type: Object, default: null },
  /** 'order' | 'certificate' | 'honor' */
  presetType: { type: String, default: 'order' },
});

const emit = defineEmits(['close', 'saved', 'cert-saved']);

const d = computed(() => props.doc || {});
const formType = computed(() => props.presetType || d.value.doc_type);

const isOrder = computed(() => formType.value === 'order');
const isCert = computed(() => formType.value === 'certificate');
const isHonor = computed(() => formType.value === 'honor');

/** เลขที่ระบบรันให้ → ล็อกอ่านไม่ได้ */
const autoDocNo = computed(() => isOrder.value || isCert.value || isHonor.value);

const meta = computed(() => docTypeMeta(formType.value));

const modalTitle = computed(
  () => (d.value.id ? '✎ แก้ไข' : '▭ ลงทะเบียน') + meta.value.label.replace('▭ ', '').replace(/^ทะเบียน/, ''),
);

/* ---------- ค่าในฟอร์ม ---------- */
const docNo = ref('');
const dateTH = ref(UI.today());
const title = ref('');
const note = ref('');
const bodyText = ref('');

// certificate
const requester = ref('');
const certPosition = ref('');
const officer = ref('');

// order
const ownerGroup = ref('');
const orderRegistrar = ref('');

// honor
const personName = ref('');
const signer = ref('');
const honorTemplate = ref('');
const honorSavedPath = ref('');

const saving = ref(false);

/* ---------- รายการเลือก ---------- */
const officeStaff = ref([]);
const honorSigners = ref([]); // เฉพาะผู้มีสิทธิ์ลงนามเกียรติบัตร

const officeStaffOptions = computed(() => officeStaff.value.map((s) => ({ value: staffLabel(s), label: staffLabel(s) })));

const honorSignerOptions = computed(() =>
  honorSigners.value.map((s) => ({ value: String(s.id), label: staffLabel(s) })),
);

/** เจ้าของคำสั่ง = สังกัด/กลุ่มงานจากค่าคงที่ (ไม่ใช่ API) */
const workgroupOptions = computed(() => (CONSTANTS.WORKPLACES || []).map((w) => ({ value: w, label: w })));

/* ---------- autocomplete ---------- */
/** @type {Array<{text:string, sub:string}>} */
const suggestions = ref([]);
const suggestionOpen = ref(false);
const suggestFilter = ref('');

const filteredSuggestions = computed(() => {
  const f = suggestFilter.value.toLowerCase().trim();
  if (!f) return suggestions.value.slice(0, 50);
  return suggestions.value
    .filter((it) => it.text.toLowerCase().includes(f) || String(it.sub || '').toLowerCase().includes(f))
    .slice(0, 50);
});

/**
 * เลือกรายการจาก autocomplete
 *
 * ถ้าเป็นสถานศึกษา → เติมคำว่า "โรงเรียน" นำหน้า (ถ้ายังไม่มี)
 */
function pickSuggestion(it) {
  const field = suggestField.value;
  if (field === 'personName' && it.sub === 'สถานศึกษา' && !String(personName.value).startsWith('โรงเรียน')) {
    personName.value = 'โรงเรียน' + it.text;
  } else if (field === 'personName') {
    personName.value = it.text;
  } else {
    requester.value = it.text;
  }
  suggestionOpen.value = false;
}

const suggestField = ref('requester');

function openSuggest(field) {
  suggestField.value = field;
  suggestFilter.value = field === 'personName' ? personName.value : requester.value;
  suggestionOpen.value = true;
}

function onSuggestInput() {
  suggestFilter.value = suggestField.value === 'personName' ? personName.value : requester.value;
  suggestionOpen.value = true;
}

// คลิกที่อื่น → ปิดรายการ (ใช้ @focusout ด้วย timeout เพื่อให้กดรายการได้ก่อนปิด)
function closeSuggestSoon() {
  setTimeout(() => {
    suggestionOpen.value = false;
  }, 200);
}

/* ---------- ไฟล์แนบ ---------- */
/** [{ key, file }] — key ใช้เป็น key ของ v-for เพราะ File ไม่ reactive */
const fileRows = ref([]);
let fileSeq = 1;

const MAX_FILES = 7;

function addFileRow(presetFile = null) {
  if (fileRows.value.length >= MAX_FILES) {
    UI.toast('แนบไฟล์ได้สูงสุด 7 ไฟล์', 'error');
    return;
  }
  fileRows.value.push({ key: fileSeq++, file: presetFile });
}

function removeFileRow(key) {
  fileRows.value = fileRows.value.filter((r) => r.key !== key);
}

/** ไฟล์เดิมที่แนบไว้แล้ว (ตอนแก้ไข) */
const oldFiles = computed(() => {
  if (!d.value.file) return [];
  try {
    const arr = JSON.parse(d.value.file);
    return Array.isArray(arr) ? arr : [d.value.file];
  } catch {
    return [d.value.file];
  }
});

/* ---------- ตัวเลือกแบบเกียรติบัตร ---------- */
const TEMPLATES = [
  { value: '1', src: '/form/certificate/1.png' },
  { value: '2', src: '/form/certificate/2.png' },
];

/** เลือก "ไม่พิมพ์เกียรติบัตร" → ซ่อนตัวเครื่องมือพิมพ์ */
const isNoneTemplate = computed(() => honorTemplate.value === 'none');

const showHonorActions = computed(() => !isNoneTemplate.value);

/* ---------- โหลดข้อมูลตั้งต้น ---------- */
async function load() {
  // ค่าจาก record (ตอนแก้ไข)
  docNo.value = d.value.doc_no || '';
  dateTH.value = d.value.date || UI.today();
  title.value = d.value.title || '';
  note.value = d.value.note || '';
  bodyText.value = d.value.body_text || '';
  requester.value = d.value.requester || '';
  certPosition.value = d.value.cert_position || '';
  officer.value = d.value.officer || '';
  ownerGroup.value = d.value.owner_group || '';
  orderRegistrar.value = d.value.order_registrar || '';
  personName.value = d.value.person_name || '';
  signer.value = d.value.honor_signer ? String(d.value.honor_signer) : '';
  honorSavedPath.value = d.value.honor_saved_file || '';

  if (isHonor.value) {
    // แบบเกียรติบัตร: ค่าเดิม หรือแบบ 1 ถ้าสร้างใหม่
    honorTemplate.value = d.value.id ? String(d.value.honor_template || '1') : String(d.value.honor_template || '1');
  }

  // รายชื่อบุคลากร (ใช้ทั้ง order / certificate / honor)
  officeStaff.value = await fetchOfficeStaff();
  honorSigners.value = officeStaff.value.filter(canSignHonor);

  // เลขที่ระบบรันให้ (เฉพาะตอนสร้างใหม่)
  if (!d.value.id && autoDocNo.value) {
    docNo.value = await fetchNextDocNo(formType.value);
  }

  // autocomplete
  if (isHonor.value) suggestions.value = await fetchPersonSuggestions('honor');
  else if (isCert.value) suggestions.value = await fetchPersonSuggestions('certificate');
}

onMounted(load);

watch(
  () => props.doc,
  () => {
    fileRows.value = [];
    addFileRow();
  },
  { immediate: true },
);

/* ---------- รวบรวมข้อมูลเกียรติบัตร ---------- */
const honorData = computed(() => {
  const rec = honorSigners.value.find((s) => String(s.id) === String(signer.value)) || null;
  return {
    template: honorTemplate.value,
    docNo: docNo.value,
    personName: attachHonorTitle(personName.value),
    title: title.value,
    body: bodyText.value,
    dateTH: dateTH.value ? UI.thaiDate(dateTH.value) : '',
    signer: rec ? attachHonorTitle(((rec.title || '') + rec.full_name).trim()) + (rec.position ? ' (' + rec.position + ')' : '') : '',
    signerSignature: rec && rec.signature ? '/uploads/' + UI.encodePath(rec.signature) : '',
  };
});

async function onSaveHonor() {
  const path = await saveHonorCertificate(honorData.value);
  if (path) {
    honorSavedPath.value = path;
    UI.toast('บันทึกไฟล์เกียรติบัตรแล้ว — กด "บันทึก" เพื่อผูกไฟล์กับรายการ', 'success');
  }
}

async function onPrintHonor() {
  await printHonor(honorData.value);
}

/* ---------- ตรวจก่อนบันทึก ---------- */

/**
 * @returns {string|null} ข้อความ error หรือ null ถ้าผ่าน
 */
function validate() {
  if (!isHonor.value && !isCert.value && !isOrder.value && !docNo.value.trim()) return 'กรุณากรอกเลขที่หนังสือ';
  if (!title.value.trim()) return 'กรุณากรอกเรื่อง';
  if (!dateTH.value) return 'กรุณาระบุวันที่';

  if (isCert.value) {
    if (!requester.value.trim()) return 'กรุณาระบุผู้ขอ';
    if (!certPosition.value.trim()) return 'กรุณาระบุตำแหน่ง';
    if (!officer.value) return 'กรุณาเลือกเจ้าหน้าที่(ผู้ปฏิบัติ)';
  }

  if (isOrder.value) {
    if (!ownerGroup.value) return 'กรุณาเลือกสังกัด/กลุ่มงาน';
    if (!orderRegistrar.value) return 'กรุณาเลือกผู้ลงทะเบียน';
  }

  if (isHonor.value) {
    if (!personName.value.trim()) return 'กรุณาระบุชื่อ-นามสกุล, โรงเรียน ฯลฯ';
    if (!signer.value) return 'กรุณาเลือกผู้ลงนาม';
    if (!honorTemplate.value) return 'กรุณาเลือกแบบเกียรติบัตร';
  }

  return null;
}

/* ---------- บันทึก ---------- */
async function save() {
  if (saving.value) return;
  const err = validate();
  if (err) {
    UI.toast(err, 'error');
    return;
  }

  saving.value = true;
  try {
    const fd = new FormData();
    fd.append('doc_type', formType.value);    fd.append('doc_no', docNo.value.trim());
    fd.append('date', dateTH.value);
    fd.append('title', title.value.trim());
    fd.append('from_org', 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2');
    fd.append('note', note.value.trim());

    if (isCert.value) {
      fd.append('requester', requester.value.trim());
      fd.append('cert_position', certPosition.value.trim());
      fd.append('body_text', bodyText.value.trim());
      fd.append('officer', officer.value);
    }

    if (isOrder.value) {
      fd.append('owner_group', ownerGroup.value);
      fd.append('order_registrar', orderRegistrar.value);
    }

    if (isHonor.value) {
      fd.append('person_name', personName.value.trim());
      // รักษาค่าเดิม (ข้อมูลเก่า) — ช่องรวมอยู่ที่ person_name แล้ว
      fd.append('person_school', d.value.person_school || '');
      fd.append('body_text', bodyText.value.trim());
      fd.append('honor_signer', signer.value);
      fd.append('honor_template', honorTemplate.value);
      fd.append('honor_saved_file', honorSavedPath.value);
    }

    for (const r of fileRows.value) {
      if (r.file) fd.append('files', r.file);
    }

    if (d.value.id) await api.putForm('/documents/' + d.value.id, fd);
    else await api.postForm('/documents', fd);

    UI.toast(d.value.id ? 'แก้ไขเรียบร้อย' : 'บันทึกเรียบร้อย');

    /*
     * หนังสือรับรอง: เปิดแบบฟอร์ม A4 ให้ดู/พิมพ์ทันที (แทนการรีโหลดหน้า)
     * อ่านค่าจากฟอร์มก่อน emit
     */
    if (isCert.value) {
      emit('cert-saved', {
        doc_no: docNo.value,
        date: dateTH.value,
        title: title.value,
        requester: requester.value,
        officer: officer.value,
        body_text: bodyText.value,
      });
      return;
    }

    emit('saved');
  } catch (e) {
    UI.toast(e.message || 'เกิดข้อผิดพลาด', 'error');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :title="modalTitle" size="lg" footer @close="emit('close')">
    <div class="form-grid">
      <!-- ---------- เลขที่ ---------- -->
      <div class="form-group full">
        <label>
          {{ isHonor ? 'ที่เกียรติบัตร' : isCert ? 'เลขที่หนังสือ (ระบบรันอัตโนมัติ)' : isOrder ? 'เลขที่คำสั่ง (ระบบรันอัตโนมัติ)' : 'เลขที่หนังสือ' }}
          <span class="req"> *</span>
        </label>
        <input
          v-model="docNo"
          :placeholder="autoDocNo ? 'กำลังโหลดเลขอัตโนมัติ...' : 'เช่น ที่ 12/2569'"
          :readonly="autoDocNo"
          :disabled="autoDocNo"
          :style="autoDocNo ? { background: '#f0f0f0', color: '#334155' } : {}"
        />
      </div>

      <!-- ---------- เกียรติบัตร ---------- -->
      <template v-if="isHonor">
        <div class="form-group full">
          <label>ชื่อ-นามสกุล, โรงเรียน ฯลฯ<span class="req"> *</span></label>
          <div style="position: relative">
            <input
              v-model="personName"
              placeholder="พิมพ์ข้อความได้อิสระ หรือค้นหาคีย์เวิด บุคลากร / สถานศึกษา..."
              autocomplete="off"
              style="width: 100%; padding: 8px; box-sizing: border-box"
              @focus="openSuggest('personName')"
              @input="onSuggestInput"
              @blur="closeSuggestSoon"
            />
            <div
              v-if="suggestionOpen"
              style="position: absolute; top: 100%; left: 0; right: 0; max-height: 200px; overflow-y: auto; background: #fff; border: 1px solid #ccc; border-radius: 4px; z-index: 1000"
            >
              <div
                v-for="(s, i) in filteredSuggestions"
                :key="i"
                style="padding: 6px 8px; cursor: pointer; font-size: 13px; border-bottom: 1px solid #f1f5f9"
                @mousedown.prevent="pickSuggestion(s)"
                @mouseover="$event.target.style.background = '#f0f9ff'"
                @mouseout="$event.target.style.background = ''"
              >
                {{ s.text }}
                <span v-if="s.sub" style="color: #64748b"> · {{ s.sub }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="form-group full">
          <label>เรื่อง<span class="req"> *</span></label>
          <input v-model="title" placeholder="เช่น แต่งตั้งคณะกรรมการประจำสถานศึกษา" />
        </div>

        <div class="form-group full">
          <label>ข้อความ</label>
          <textarea
            v-model="bodyText"
            rows="4"
            placeholder="พิมพ์ข้อความในเกียรติบัตร..."
            style="width: 100%; padding: 8px; box-sizing: border-box; font-family: inherit; font-size: 14px"
          />
        </div>

        <div class="form-group">
          <label>วันที่ออกเกียรติบัตร<span class="req"> *</span></label>
          <ThaiDateField v-model="dateTH" />
        </div>

        <div class="form-group">
          <label>ผู้ลงนาม<span class="req"> *</span></label>
          <select v-model="signer" style="width: 100%; padding: 8px; box-sizing: border-box">
            <option value="">— เลือกผู้ลงนาม —</option>
            <option v-for="o in honorSignerOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>

        <div class="form-group full">
          <label>พิมพ์เกียรติบัตร</label>
          <div style="display: flex; gap: 14px; flex-wrap: wrap">
            <label
              v-for="t in TEMPLATES"
              :key="t.value"
              style="cursor: pointer; text-align: center"
            >
              <input
                v-model="honorTemplate"
                type="radio"
                name="honor-template"
                :value="t.value"
                style="display: block; margin: 0 auto 4px"
              />
              <img
                :src="t.src"
                :alt="'แบบเกียรติบัตร ' + t.value"
                style="width: 150px; height: auto; border: 2px solid #e2e8f0; border-radius: 6px; display: block"
              />
            </label>

            <label style="cursor: pointer; text-align: center">
              <input v-model="honorTemplate" type="radio" name="honor-template" value="none" style="display: block; margin: 0 auto 4px" />
              <div
                style="width: 150px; height: 106px; border: 2px dashed #cbd5e1; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 13px; color: #64748b; background: #f8fafc"
              >
                ✕ ไม่พิมพ์เกียรติบัตร
              </div>
            </label>
          </div>

          <div v-if="showHonorActions" style="margin-top: 10px; display: flex; gap: 8px; align-items: center">
            <button type="button" class="btn btn-outline" style="font-size: 13px" @click="onSaveHonor">
              💾 บันทึกเกียรติบัตร
            </button>
            <button
              type="button"
              class="btn btn-primary"
              style="font-size: 13px; background: #7c3aed"
              @click="onPrintHonor"
            >
              🖨 พิมพ์เกียรติบัตร
            </button>
            <span v-if="honorSavedPath" class="hint" style="font-size: 12px">✓ บันทึกไฟล์แล้ว</span>
          </div>
        </div>
      </template>

      <!-- ---------- order / certificate ---------- -->
      <template v-else>
        <div class="form-group">
          <label>{{ isOrder ? 'สั่ง ณ วันที่' : 'วันที่' }}<span class="req"> *</span></label>
          <ThaiDateField v-model="dateTH" />
        </div>

        <div class="form-group full">
          <label>เรื่อง<span class="req"> *</span></label>
          <input v-model="title" placeholder="เช่น แต่งตั้งคณะกรรมการประจำสถานศึกษา" />
        </div>

        <template v-if="isOrder">
          <div class="form-group full">
            <label>เจ้าของคำสั่ง</label>
            <select v-model="ownerGroup" style="width: 100%; padding: 8px; box-sizing: border-box">
              <option value="">— เลือกสังกัด/กลุ่มงาน —</option>
              <option v-for="o in workgroupOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
          <div class="form-group full">
            <label>ผู้ลงทะเบียน</label>
            <select v-model="orderRegistrar" style="width: 100%; padding: 8px; box-sizing: border-box">
              <option value="">— เลือกบุคลากร สพป.แพร่ เขต 2 —</option>
              <option v-for="o in officeStaffOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
        </template>

        <template v-if="isCert">
          <div class="form-group full">
            <label>ข้อความในหนังสือรับรอง</label>
            <textarea
              v-model="bodyText"
              rows="4"
              placeholder="ข้อความที่ต้องการระบุในหนังสือรับรอง..."
              style="width: 100%; padding: 8px; box-sizing: border-box; font-family: inherit; font-size: 14px"
            />
          </div>

          <div class="form-group full">
            <label>ผู้ขอ</label>
            <div style="position: relative">
              <input
                v-model="requester"
                placeholder="พิมพ์ข้อความได้อิสระ หรือค้นหาคีย์เวิด ชื่อบุคลากร / สังกัด-กลุ่มงาน..."
                autocomplete="off"
                style="width: 100%; padding: 8px; box-sizing: border-box"
                @focus="openSuggest('requester')"
                @input="onSuggestInput"
                @blur="closeSuggestSoon"
              />
              <div
                v-if="suggestionOpen"
                style="position: absolute; top: 100%; left: 0; right: 0; max-height: 200px; overflow-y: auto; background: #fff; border: 1px solid #ccc; border-radius: 4px; z-index: 1000"
              >
                <div
                  v-for="(s, i) in filteredSuggestions"
                  :key="i"
                  style="padding: 6px 8px; cursor: pointer; font-size: 13px; border-bottom: 1px solid #f1f5f9"
                  @mousedown.prevent="pickSuggestion(s)"
                  @mouseover="$event.target.style.background = '#f0f9ff'"
                  @mouseout="$event.target.style.background = ''"
                >
                  {{ s.text }}
                  <span v-if="s.sub" style="color: #64748b"> · {{ s.sub }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="form-group full">
            <label>ตำแหน่ง</label>
            <input
              v-model="certPosition"
              placeholder="เช่น ครู / ผู้อำนวยการ / นักวิชาการศึกษา"
              style="width: 100%; padding: 8px; box-sizing: border-box"
            />
          </div>

          <div class="form-group full">
            <label>เจ้าหน้าที่(ผู้ปฏิบัติ)</label>
            <select v-model="officer" style="width: 100%; padding: 8px; box-sizing: border-box">
              <option value="">— เลือกเจ้าหน้าที่ สพป.แพร่ เขต 2 —</option>
              <option v-for="o in officeStaffOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
        </template>
      </template>

      <!-- ---------- หมายเหตุ ---------- -->
      <div class="form-group full">
        <label>หมายเหตุ</label>
        <input v-model="note" />
      </div>

      <!-- ---------- แนบไฟล์ ---------- -->
      <div class="form-group full">
        <label>แนบไฟล์</label>
        <div style="display: flex; flex-direction: column; gap: 4px">
          <!-- ไฟล์เดิม -->
          <div
            v-for="(fp, i) in oldFiles"
            :key="'old-' + i"
            style="display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: #f0f9ff; border-radius: 4px"
          >
            <a
              :href="'/uploads/' + UI.encodePath(fp)"
              target="_blank"
              rel="noopener"
              style="color: #2563eb; text-decoration: underline; font-size: 13px"
              >📎 {{ String(fp).split('/').pop() }}</a
            >
          </div>

          <!-- ไฟล์ใหม่ -->
          <div
            v-for="r in fileRows"
            :key="r.key"
            style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px"
          >
            <input
              :value="r.file ? r.file.name : ''"
              type="file"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip"
              style="flex: 1; font-size: 13px"
              @change="
                (e) => {
                  const f = e.target.files[0] || null;
                  const row = fileRows.find((x) => x.key === r.key);
                  if (row) row.file = f;
                }
              "
            />
            <button
              type="button"
              style="background: #ef4444; color: #fff; border: none; border-radius: 4px; cursor: pointer; padding: 2px 6px; font-size: 12px; line-height: 1"
              title="ลบไฟล์นี้"
              @click="removeFileRow(r.key)"
            >
              ✕
            </button>
          </div>

          <button
            type="button"
            style="align-self: flex-start; background: #2563eb; color: #fff; border: none; border-radius: 4px; cursor: pointer; padding: 4px 14px; font-size: 13px; margin-top: 4px"
            @click="addFileRow()"
          >
            เพิ่มไฟล์
          </button>
        </div>
      </div>
    </div>

    <template #footer>
      <div style="display: flex; gap: 8px">
        <button class="btn btn-outline" @click="emit('close')">ยกเลิก</button>
        <button class="btn btn-primary" :disabled="saving" @click="save">
          {{ saving ? 'กำลังบันทึก...' : '▽ บันทึก' }}
        </button>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
/* form-grid / form-group / req / hint มาจาก styles/theme.css */
</style>
