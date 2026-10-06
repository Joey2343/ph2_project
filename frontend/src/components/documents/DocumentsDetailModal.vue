<script setup>
/**
 * DocumentsDetailModal — หน้าต่างรายละเอียดหนังสือราชการ (อ่านอย่างเดียว)
 *
 * ย้ายจาก DocumentsView.openView() (46 บรรทัด) เป็น Vue SFC
 *
 * ข้อมูลในฟอร์มแสดงผลตามประเภทหนังสือ:
 *   - order       เพิ่ม "เจ้าของคำสั่ง" / "ผู้ลงทะเบียน"
 *   - honor       เพิ่ม "ชื่อ-นามสกุล, โรงเรียน" / "ผู้ลงนาม"
 *   - certificate เพิ่ม "ผู้ขอ" / "ตำแหน่ง" / "เจ้าหน้าที่(ผู้ปฏิบัติ)"
 *
 * เรียก mark-as-read ให้อัตโนมัติถ้าผู้ใช้เป็นผู้รับและยังไม่ได้อ่าน (เหมือนของเดิม)
 */
import { ref, computed, watch } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import { docTypeMeta, parseFiles } from '../../lib/documents.js';
import AppModal from '../ui/AppModal.vue';

const props = defineProps({
  /** record หนังสือจากตาราง */
  doc: { type: Object, default: null },
});

const emit = defineEmits(['close']);

/* ---------- ชื่อผู้ลงนามเกียรติบัตร ---------- */
/**
 * honor_signer เก็บเป็น staff id — ต้องแปลงเป็นชื่อเต็มก่อนแสดง
 * (ของเดิมโหลดหลังเปิด modal เพราะต้องรอ DOM แต่ Vue ทำได้ใน watch ตรง ๆ)
 */
const signerText = ref('-');

async function loadSigner(doc) {
  if (!doc || doc.doc_type !== 'honor') return;
  if (!doc.honor_signer) {
    signerText.value = '-';
    return;
  }
  signerText.value = 'กำลังโหลด...';
  try {
    const res = await api.get('/office-staff');
    const s = (res.staff || []).find((x) => String(x.id) === String(doc.honor_signer));
    if (!s) {
      signerText.value = '-';
      return;
    }
    signerText.value =
      (((s.title ? s.title + ' ' : '') + s.full_name).trim() + (s.position ? ' (' + s.position + ')' : '')) || '-';
  } catch {
    signerText.value = '-';
  }
}

watch(
  () => props.doc,
  (d) => {
    if (!d) return;
    loadSigner(d);
    // ถ้าเป็นผู้รับและยังไม่ได้อ่าน → ทำเครื่องหมายว่าอ่านแล้ว (ไม่รอผลลัพธ์ เหมือนของเดิม)
    if (d.is_read !== undefined && !d.is_read) {
      api.put('/document-recipients/' + d.id + '/read').catch(() => {});
    }
  },
  { immediate: true },
);

/* ---------- ข้อมูลที่ใช้แสดง ---------- */
const d = computed(() => props.doc || {});
const meta = computed(() => docTypeMeta(d.value.doc_type));
const isOrder = computed(() => d.value.doc_type === 'order');
const isHonor = computed(() => d.value.doc_type === 'honor');
const isCert = computed(() => d.value.doc_type === 'certificate');

/** ไฟล์แนบ — คอลัมน์ file เป็น JSON array หรือ path เดี่ยว */
const files = computed(() => parseFiles(d.value.file));

/**
 * ลิงก์ไฟล์แนบ
 *
 * ตรงกับ UI.fileLink(): encodeURIComponent เส้นทางก่อนเสมอ
 * และใช้ emoji ต่างกันระหว่างรูปภาพกับไฟล์อื่น
 */
const isImage = (p) => /\.(png|jpe?g|gif|webp)$/i.test(String(p));
const fileName = (p) => String(p).split('/').pop();
const fileHref = (p) => '/uploads/' + encodeURIComponent(p);

/** ชื่อ-นามสกุล + โรงเรียน ของเกียรติบัตร */
const personText = computed(() => {
  const p = d.value.person_name || '-';
  return p + (d.value.person_school ? ' | ' + d.value.person_school : '');
});

/** ข้อความเนื้อหา — ใช้ white-space: pre-wrap เพื่อคงการขึ้นบรรทัด */
const bodyText = computed(() => d.value.body_text || '-');

/** ป้ายกำกับของเลขที่ — คำสั่งใช้คำว่า "เลขที่คำสั่ง" */
const noLabel = computed(() => (isOrder.value ? 'เลขที่คำสั่ง' : 'เลขที่หนังสือ'));
const dateLabel = computed(() => (isOrder.value ? 'สั่ง ณ วันที่' : 'วันที่'));

/** ข้อความตัวเล็กใต้ป้ายกำกับของฟิลด์ข้อความยาว */
const MSG_STYLE = {
  whiteSpace: 'pre-wrap',
  padding: '8px',
  background: '#f8fafc',
  borderRadius: '6px',
  fontSize: '14px',
  lineHeight: '1.6',
  border: '1px solid #e2e8f0',
};
</script>

<template>
  <AppModal v-if="doc" title="👁️ รายละเอียดหนังสือราชการ" size="lg" @close="emit('close')" footer>
    <div class="form-grid">
      <div class="form-group">
        <label>ประเภท</label>
        <div>{{ meta.label }}</div>
      </div>

      <div class="form-group">
        <label>{{ noLabel }}</label>
        <div>{{ d.doc_no || '-' }}</div>
      </div>

      <template v-if="isOrder">
        <div class="form-group">
          <label>เจ้าของคำสั่ง</label>
          <div>{{ d.owner_group || '-' }}</div>
        </div>
        <div class="form-group">
          <label>ผู้ลงทะเบียน</label>
          <div>{{ d.order_registrar || '-' }}</div>
        </div>
      </template>

      <template v-if="isHonor">
        <div class="form-group full">
          <label>ชื่อ-นามสกุล, โรงเรียน ฯลฯ</label>
          <div>{{ personText }}</div>
        </div>
        <div v-if="d.body_text" class="form-group full">
          <label>ข้อความ</label>
          <div :style="MSG_STYLE">{{ d.body_text }}</div>
        </div>
        <div class="form-group">
          <label>ผู้ลงนาม</label>
          <div>{{ signerText }}</div>
        </div>
      </template>

      <div class="form-group full">
        <label>เรื่อง</label>
        <div>{{ d.title }}</div>
      </div>

      <template v-if="isCert">
        <div v-if="d.requester" class="form-group">
          <label>ผู้ขอ</label>
          <div>{{ d.requester }}</div>
        </div>
        <div v-if="d.cert_position" class="form-group">
          <label>ตำแหน่ง</label>
          <div>{{ d.cert_position }}</div>
        </div>
        <div v-if="d.officer" class="form-group">
          <label>เจ้าหน้าที่(ผู้ปฏิบัติ)</label>
          <div>{{ d.officer }}</div>
        </div>
      </template>

      <div class="form-group">
        <label>จาก</label>
        <div>{{ d.from_org || '-' }}</div>
      </div>

      <div class="form-group">
        <label>ถึง</label>
        <div>{{ d.to_org || '-' }}</div>
      </div>

      <div class="form-group">
        <label>{{ dateLabel }}</label>
        <div>{{ UI.thaiDate(d.date) }}</div>
      </div>

      <div class="form-group">
        <label>หมวดหมู่</label>
        <div>{{ d.category || '-' }}</div>
      </div>

      <div class="form-group full">
        <label>ข้อความ</label>
        <div :style="MSG_STYLE">{{ bodyText }}</div>
      </div>

      <div class="form-group">
        <label>ไฟล์แนบ</label>
        <div v-if="!files.length" class="hint">-</div>
        <div v-else style="display: flex; flex-direction: column; gap: 2px">
          <a
            v-for="(f, i) in files"
            :key="i"
            :href="fileHref(f)"
            target="_blank"
            :title="fileName(f)"
            style="font-size: 12px"
            >{{ (isImage(f) ? '🖼️ ' : '📎 ') + fileName(f) }}</a
          >
        </div>
      </div>

      <div class="form-group full">
        <label>หมายเหตุ</label>
        <div>{{ d.note || '-' }}</div>
      </div>

      <div class="form-group full">
        <label>ลงทะเบียนโดย</label>
        <div>{{ d.creator_name || '-' }}</div>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-outline" @click="emit('close')">ปิด</button>
    </template>
  </AppModal>
</template>

<style scoped>
/* คลาส form-grid / form-group / req มาจาก styles/theme.css ของระบบเดิม */
</style>
