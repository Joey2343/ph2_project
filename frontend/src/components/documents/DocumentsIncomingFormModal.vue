<script setup>
/**
 * DocumentsIncomingFormModal — ฟอร์มลงทะเบียนรับหนังสือ
 *
 * ย้ายจาก DocumentsView.openForm() สาขา incoming + saveForm('incoming')
 * (ย้าย saveForm จาก DocumentsView.js ที่ถูกตัดทิ้งไปแล้วมาไว้ที่นี่ พร้อมแก้ช่องที่อ่านจาก DOM เป็น state)
 *
 * จุดที่ต่างจากของเดิม
 *   - บันทึกเสร็จแล้ว emit('saved') แทน location.reload()
 *   - ไฟล์ที่แนบส่งต่อให้หน้าหลักผ่าน event 'open-postal' (แทนที่จะเรียก openPostalForm เอง)
 *     เพราะ openPostalForm ยังเป็นโมดุลเดิม — ให้หน้าหลักเป็นคนเรียก
 */
import { ref, computed, onMounted } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import { Auth } from '../../stores/auth.js';
import { fetchNextRegNo, fetchWorkplaceGroups, fetchSchools } from '../../lib/documents-form.js';
import ThaiDateField from '../ui/ThaiDateField.vue';
import DocumentsStampEditor from './DocumentsStampEditor.vue';
import AppModal from '../ui/AppModal.vue';

const props = defineProps({
  /** record ที่กำลังลงทะเบียน/แก้ไข (null = สร้างใหม่) */
  doc: { type: Object, default: null },
});

const emit = defineEmits(['close', 'saved', 'open-postal']);

const d = computed(() => props.doc || {});

/* ---------- ค่าในฟอร์ม ---------- */
const regNo = ref('');
const docNo = ref('');
/** วันที่ออกเลขหนังสือของหน่วยงานต้นเรื่อง (ISO) — แยกจาก dateTH ซึ่งคือวันที่รับ */
const letterDate = ref('');
const dateTH = ref(UI.today());
const title = ref('');
const workgroup = ref('');
const note = ref('');

/* ---------- ตัวเลือก ---------- */
const workgroups = ref([]);
const schools = ref([]);

/* ---------- หนังสือจาก: ค้นหา + เลือก/ยกเลิก ----------
 * fromInput เป็นค่าเดียวที่ใช้ทั้งแสดงผล ตรวจ และบันทึก
 *
 * ⚠️ เคยเป็นบั๊ก: มี 2 ตัวแปร (fromOrg กับ fromInput) แต่ไม่เคยเชื่อมกัน
 *    ช่องกรอกเขียนลง fromInput ส่วนตอนตรวจ/บันทึกอ่าน fromOrg ที่ว่างตลอด
 *    → กรอกครบแล้วกดบันทึก ก็ขึ้น "กรุณาเลือกหน่วยงานต้นเรื่อง" และไม่ยิง request เลย
 *    ของเดิมอ่านจาก input ตัวเดียวกัน (document.getElementById('df-from').value)
 */
const fromInput = ref('');
const fromListOpen = ref(false);
const fromFilter = ref('');
/** ยืนยันแล้ว = ล็อกช่อง ซ่อนปุ่ม "เลือก" แสดงปุ่ม "ยกเลิก" */
const fromLocked = ref(false);

const schoolOptions = computed(() => {
  const all = schools.value.map((s) => ({ code: s.code, name: s.name }));
  // เพิ่ม "หนังสือจากหน่วยงานอื่น" ให้กรอกเองได้
  all.push({ code: 'อื่นๆ', name: 'อื่นๆ (กรอกเอง)' });

  const f = fromFilter.value.toLowerCase().trim();
  const list = all.filter((s) => !f || (s.code + ' - ' + s.name).toLowerCase().includes(f));
  return list.map((s) => s.code + ' - ' + s.name);
});

function pickFrom(v) {
  fromInput.value = v;
  fromListOpen.value = false;
}

function onFromFocus() {
  fromFilter.value = fromInput.value;
  fromListOpen.value = true;
}

function onFromInput() {
  fromFilter.value = fromInput.value;
  fromListOpen.value = true;
}

function confirmFrom() {
  if (!fromInput.value.trim()) return;
  fromLocked.value = true;
  fromListOpen.value = false;
}

function cancelFrom() {
  fromLocked.value = false;
  fromInput.value = '';
}

/* ---------- ไฟล์แนบ ---------- */
const fileRows = ref([]);
let seq = 1;

const MAX_FILES = 7;

function addFileRow(preset = null, presetName = '') {
  if (fileRows.value.length >= MAX_FILES) {
    UI.toast('แนบไฟล์ได้สูงสุด 7 ไฟล์', 'error');
    return;
  }
  fileRows.value.push({ key: seq++, file: preset, name: presetName });
}

function removeFileRow(key) {
  fileRows.value = fileRows.value.filter((r) => r.key !== key);
}

/** ไฟล์เดิมที่แนบไว้แล้ว */
const oldFiles = computed(() => {
  if (!d.value.file) return [];
  try {
    const arr = JSON.parse(d.value.file);
    return Array.isArray(arr) ? arr : [d.value.file];
  } catch {
    return [d.value.file];
  }
});

/** ชื่อไฟล์ที่ตั้งไว้เดิม — JSON array เรียงตามลำดับ index ของ file */
function parseFileNames(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map((x) => String(x || '')) : [];
  } catch {
    return [];
  }
}

/** ไฟล์เดิม + ชื่อที่ตั้งไว้ (คู่กันตาม index) — ใช้แสดงช่องตั้งชื่อและตอนบันทึก */
const oldFileRows = computed(() => {
  const names = parseFileNames(d.value.file_names);
  return oldFiles.value.map((path, i) => ({ key: 'old-' + i, path, name: names[i] || '' }));
});

/* ---------- ตัวปั้มตรา ---------- */
const stampFile = ref(null);
/** ไฟล์ที่ปั้มแล้ว (ถ้าทำให้ช่องไฟล์แรกยังไม่ได้เลือกไฟล์) */
const stampedFile = ref(null);

/**
 * ไฟล์ต้นฉบับสำหรับปั้ม: ไฟล์ที่เพิ่งเลือก ถ้าไม่มีใช้ไฟล์เดิมของรายการ
 */
const stampSource = computed(() => fileRows.value.find((r) => r.file)?.file || null);

const existingFirstFile = computed(() => (oldFiles.value.length ? oldFiles.value[0] : null));

function openStamp() {
  const src = stampSource.value;
  if (src) {
    stampFile.value = src;
    return;
  }
  if (existingFirstFile.value) {
    // โหลดไฟล์เดิมจากเซิร์ฟเวอร์เพื่อปั้มต่อ
    fetch('/uploads/' + UI.encodePath(existingFirstFile.value))
      .then((r) => {
        if (!r.ok) throw new Error('โหลดไฟล์ไม่สำเร็จ');
        return r.blob();
      })
      .then((blob) => {
        const name = String(existingFirstFile.value).split('/').pop();
        const type = blob.type || (/\.png$/i.test(name) ? 'image/png' : 'application/pdf');
        stampFile.value = new File([blob], name, { type });
      })
      .catch((e) => UI.toast(e.message || 'โหลดไฟล์ไม่สำเร็จ', 'error'));
    return;
  }
  UI.toast('Attach file first', 'error');
}

/**
 * ได้ไฟล์ที่ปั้มแล้ว
 *
 * ถ้ายังไม่ได้เลือกไฟล์ในช่องแรก → ใส่ลงช่องนั้นเลย (เหมือนของเดิม)
 * ถ้าเลือกไฟล์ไว้แล้ว → เก็บแยกไว้ แล้วค่อยแทนที่ตอนกดบันทึก
 */
function onStamped(f) {
  stampFile.value = null;
  const first = fileRows.value[0];
  if (first && !first.file) {
    first.file = f;
    UI.toast('ปั้มรับเรียบร้อย: ' + f.name + ' — กดบันทึกเพื่อบันทึกทับไฟล์เดิม');
  } else {
    stampedFile.value = f;
    UI.toast('ปั้มรับเรียบร้อย: ' + f.name);
  }
}

/**
 * ไฟล์ที่จะส่งจริง + ชื่อที่ตั้งไว้ (เรียงคู่กัน 1:1)
 *
 * ถ้ามีไฟล์ที่ปั้มแล้วแต่ยังไม่ได้ใส่ช่อง ให้ใส่ช่องว่างแรก
 * คืนเป็นคู่เพื่อกันชื่อกับไฟล์หลุดจากกัน (ต้องเรียงตรงกับลำดับที่ backend เก็บ)
 */
function collectEntries() {
  const out = [];
  let stampedPlaced = false;
  for (const r of fileRows.value) {
    if (stampedFile.value && !stampedPlaced && !r.file) {
      out.push({ file: stampedFile.value, name: '' });
      stampedPlaced = true;
      continue;
    }
    if (r.file) out.push({ file: r.file, name: String(r.name || '').trim() });
  }
  if (stampedFile.value && !stampedPlaced) out.push({ file: stampedFile.value, name: '' });
  return out;
}

/** ไฟล์ที่จะส่งจริง */
function collectFiles() {
  return collectEntries().map((e) => e.file);
}

/* ---------- โหลดข้อมูล ---------- */
const saving = ref(false);

onMounted(async () => {
  // ค่าจาก record (ตอนแก้ไข)
  fromInput.value = d.value.from_org || '';
  docNo.value = d.value.doc_no || '';
  letterDate.value = d.value.letter_date || '';
  dateTH.value = d.value.date || UI.today();
  title.value = d.value.title || '';
  workgroup.value = d.value.workgroup || '';
  note.value = d.value.note || '';
  regNo.value = d.value.reg_no || '';

  // เลขหนังสือรับถัดไป — เฉพาะตอนสร้างใหม่ (กันรันทับเลขเดิมตอนแก้ไข/ลงทะเบียนซ้ำ)
  if (!regNo.value) regNo.value = await fetchNextRegNo();

  workgroups.value = await fetchWorkplaceGroups();
  schools.value = await fetchSchools();

  addFileRow();
});

/* ---------- บันทึก ---------- */
async function save() {
  if (saving.value) return;

  if (!fromInput.value.trim()) {
    UI.toast('กรุณาเลือกหน่วยงานต้นเรื่อง', 'error');
    return;
  }
  if (!title.value.trim()) {
    UI.toast('กรุณากรอกเรื่อง', 'error');
    return;
  }
  if (!dateTH.value) {
    UI.toast('กรุณาระบุวันที่', 'error');
    return;
  }

  saving.value = true;
  const editId = d.value.id || null;

  try {
    const fd = new FormData();

    /*
     * ตอนลงทะเบียนจากรายการเดิม (edit) ไม่ส่ง doc_type ทับ
     * → คงประเภทเดิมของหนังสือ (เช่น หนังสือส่งของสถานศึกษา ต้องยังเป็น outgoing ให้โรงเรียนเห็น)
     */
    if (!editId) fd.append('doc_type', 'incoming');

    /*
     * ไม่เขียน to_org ทับตอน edit
     * → คงค่าปลายทางเดิมของหนังสือ
     */
    if (!editId) fd.append('to_org', Auth.user.full_name + ' ' + Auth.user.workplace);

    fd.append('from_org', fromInput.value.trim());
    fd.append('title', title.value.trim());
    fd.append('date', dateTH.value);
    fd.append('doc_no', docNo.value.trim());
    fd.append('letter_date', letterDate.value);
    fd.append('reg_no', regNo.value.trim());
    fd.append('workgroup', workgroup.value);
    // ลงทะเบียนรับหนังสือ = ตั้งสถานะลงทะเบียนแล้ว (แสดงในแท็บทะเบียนหนังสือรับ)
    fd.append('is_registered', '1');
    fd.append('note', note.value.trim());

    const entries = collectEntries();
    const files = entries.map((e) => e.file);
    for (const f of files) fd.append('files', f);

    /*
     * ชื่อไฟล์ที่ตั้งเอง (ไม่บังคับ) — เก็บเป็น JSON array เรียงตามลำดับไฟล์
     *
     * ตอนแก้ไข (is_registered=1) backend เก็บไฟล์เดิมไว้ก่อน แล้วต่อท้ายด้วยไฟล์ใหม่
     * ช่องตั้งชื่อก็ต้องเรียงเดียวกัน ไม่งั้นชื่อจะไปตรงกับไฟล์ผิดตัว
     */
    const oldNames = editId ? oldFileRows.value.map((o) => String(o.name || '').trim()) : [];
    fd.append('file_names', JSON.stringify(oldNames.concat(entries.map((e) => e.name))));

    if (editId) await api.putForm('/documents/' + editId, fd);
    else await api.postForm('/documents', fd);

    UI.toast('บันทึกเรียบร้อย');

    /*
     * ลงทะเบียนรับหนังสือ → เปิดหน้าส่งไปรษณีย์ภายในเขตต่อทันที
     * ส่งไฟล์ที่แนบใหม่ + เรื่อง/ข้อความ/วันที่ จากการลงทะเบียน
     */
    emit('open-postal', {
      files,
      prefill: { title: title.value, message: note.value, date: dateTH.value },
    });
  } catch (e) {
    UI.toast(e.message || 'เกิดข้อผิดพลาด', 'error');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal title="▼ ลงทะเบียนรับหนังสือ" size="lg" footer @close="emit('close')">
    <div class="form-grid">
      <div class="form-group full">
        <label>เลขหนังสือรับ</label>
        <input
          v-model="regNo"
          placeholder="กำลังโหลด..."
          disabled
          style="background: #f0f0f0"
        />
      </div>

      <!-- ---------- หนังสือจาก ---------- -->
      <div class="form-group full">
        <label>หนังสือจาก<span class="req"> *</span></label>
        <div style="display: flex; gap: 8px; align-items: center; width: 100%">
          <div style="flex: 1; position: relative">
            <input
              v-model="fromInput"
              type="text"
              placeholder="พิมพ์ค้นหาชื่อสถานศึกษา..."
              autocomplete="off"
              :disabled="fromLocked"
              style="width: 100%; padding: 8px; box-sizing: border-box"
              @focus="onFromFocus"
              @input="onFromInput"
              @blur="fromListOpen = false"
            />
            <div
              v-if="fromListOpen"
              style="position: absolute; top: 100%; left: 0; right: 0; max-height: 200px; overflow-y: auto; background: #fff; border: 1px solid #ccc; border-radius: 4px; z-index: 1000"
            >
              <div
                v-for="(s, i) in schoolOptions"
                :key="i"
                style="padding: 8px; cursor: pointer; border-bottom: 1px solid #eee"
                @mousedown.prevent="pickFrom(s)"
                @mouseover="$event.target.style.background = '#f0f0f0'"
                @mouseout="$event.target.style.background = ''"
              >
                {{ s }}
              </div>
            </div>
          </div>

          <button
            v-if="!fromLocked"
            class="btn btn-primary"
            style="padding: 8px 16px; white-space: nowrap"
            @click="confirmFrom"
          >
            ✓ เลือก
          </button>
          <button
            v-else
            class="btn btn-outline"
            style="padding: 8px 16px; white-space: nowrap"
            @click="cancelFrom"
          >
            ✕ ยกเลิก
          </button>
        </div>
      </div>

      <div class="form-group full">
        <label>เลขที่หนังสือ</label>
        <input v-model="docNo" placeholder="เช่น ที่ ศธ 04114/001" />
      </div>

      <div class="form-group">
        <label>ลงวันที่</label>
        <ThaiDateField id="df-letter-date" v-model="letterDate" />
      </div>

      <div class="form-group">
        <label>วันที่รับ<span class="req"> *</span></label>
        <ThaiDateField id="df-date" v-model="dateTH" />
      </div>

      <div class="form-group full">
        <label>เรื่อง<span class="req"> *</span></label>
        <input v-model="title" placeholder="เช่น ขอความอนุเคราะห์ข้อมูลบุคลากร" />
      </div>

      <div class="form-group full">
        <label>กลุ่มปฏิบัติ</label>
        <select v-model="workgroup" style="width: 100%; padding: 8px; font-size: 14px">
          <option value="">-- เลือกกลุ่มปฏิบัติ --</option>
          <option v-for="g in workgroups" :key="g" :value="g">{{ g }}</option>
        </select>
      </div>

      <!-- ---------- แนบไฟล์ + ลงเลขหนังสือรับ ---------- -->
      <div class="form-group full">
        <label>แนบไฟล์</label>
        <div style="display: flex; flex-direction: column; gap: 4px">
          <!-- ไฟล์เดิม + ช่องตั้งชื่อ -->
          <div
            v-for="o in oldFileRows"
            :key="o.key"
            style="display: flex; align-items: center; gap: 6px; padding: 4px 0 4px 8px; background: #f0f9ff; border-radius: 4px; flex-wrap: wrap"
          >
            <a
              :href="'/uploads/' + UI.encodePath(o.path)"
              target="_blank"
              rel="noopener"
              style="color: #2563eb; text-decoration: underline; font-size: 13px"
              >{{ /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(o.path) ? '🖼️' : '📎' }}
              {{ o.name || String(o.path).split('/').pop() }}</a
            >
            <input
              v-model="o.name"
              type="text"
              placeholder="ตั้งชื่อไฟล์ (ไม่บังคับ)"
              style="flex: 1; min-width: 160px; font-size: 12px; padding: 4px 8px"
            />
          </div>

          <!-- ช่องไฟล์ใหม่ + ช่องตั้งชื่อ -->
          <div
            v-for="r in fileRows"
            :key="r.key"
            style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap"
          >
            <input
              type="file"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip"
              style="flex: 1; min-width: 180px"
              @change="
                (e) => {
                  const row = fileRows.find((x) => x.key === r.key);
                  if (row) row.file = e.target.files[0] || null;
                }
              "
            />
            <input
              v-model="r.name"
              type="text"
              placeholder="ตั้งชื่อไฟล์ (ไม่บังคับ)"
              style="flex: 1; min-width: 160px; font-size: 12px; padding: 4px 8px"
            />
            <!-- ปุ่มลงเลขหนังสือรับ = อยู่ที่แถวไฟล์แรกเสมอ
                 ⚠️ เคยเป็นบั๊ก: ปุ่มนี้เขียนเป็น v-else-if ต่อจาก v-if="fileRows.length > 1"
                 คือเงื่อนไขเดียวกัน → พอมีไฟล์ 2 ช่องขึ้นไป ปุ่มนี้จะไม่มีวันโชว์
                 เพราะทุกแถวโดน v-if ของปุ่ม ✕ ครอบไว้แล้ว
                 ของเดิม (legacy) ปุ่มนี้เป็นพี่น้องของ input ไฟล์แรก ไม่มีเงื่อนไขซ่อน -->
            <button
              v-if="r.key === fileRows[0].key"
              type="button"
              class="btn btn-primary"
              style="padding: 4px 12px; font-size: 13px; white-space: nowrap"
              title="ลงเลขหนังสือรับลงในไฟล์แนบ"
              @click="openStamp"
            >
              ✎ ลงเลขหนังสือรับ
            </button>
            <!-- ปุ่มลบแถว — โชว์เมื่อมีมากกว่า 1 แถว -->
            <button
              v-if="fileRows.length > 1"
              type="button"
              class="btn btn-outline"
              style="padding: 4px 8px; font-size: 14px; cursor: pointer; color: #ef4444; border-color: #ef4444"
              @click="removeFileRow(r.key)"
            >
              ✕
            </button>
          </div>

          <button
            type="button"
            style="align-self: flex-start; background: #2563eb; color: #fff; border: none; border-radius: 4px; cursor: pointer; padding: 4px 10px; font-size: 16px; font-weight: bold; line-height: 1"
            title="เพิ่มไฟล์"
            @click="addFileRow()"
          >
            +
          </button>

          <span v-if="stampedFile" class="hint" style="font-size: 12px">
            ✓ ไฟล์ที่ปั้มแล้วจะถูกส่งพร้อมรายการนี้ ({{ stampedFile.name }})
          </span>
        </div>
      </div>

      <div class="form-group full">
        <label>หมายเหตุ</label>
        <input v-model="note" />
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

    <!-- ---------- ตัวปั้มตรา ---------- -->
    <DocumentsStampEditor v-if="stampFile" :file="stampFile" @stamped="onStamped" @close="stampFile = null" />
  </AppModal>
</template>

<style scoped>
/* form-grid / form-group / req / hint มาจาก styles/theme.css */
</style>
