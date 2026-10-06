<script setup>
/**
 * DocumentsPage — เมนู 10: หนังสือราชการ
 *
 * ย้าย "โครงหน้า" จาก src/views/DocumentsView.js เป็น Vue SFC
 *   ได้แท็บ + ตัวกรองปี/กลุ่มงาน/ค้นหา + เข้าหน้า (25/หน้า) + ตารางที่ปรับคอลัมน์ตามแท็บ + ปุ่มจัดการ
 *
 * dialog ที่ย้ายมาเป็น Vue แล้วทั้งหมด (src/components/documents/)
 *   DocumentsDetailModal            รายละเอียดหนังสือ (แทน openView)
 *   DocumentsCertA4Modal            แบบฟอร์มหนังสือรับรอง A4 (แทน showCertificateFormA4)
 *   DocumentsExportModal            ดาวน์โหลด Excel (แทน openExportDialog)
 *   DocumentsStaffSettingsModal     กำหนดเจ้าหน้าที่หนังสือราชการ (แทน openStaffSettings)
 *   DocumentsCertStaffModal         กำหนดเจ้าหน้าที่หนังสือรับรอง (แทน openCertStaffSettings)
 *   DocumentsDocStaffSettingsModal  กำหนดเจ้าหน้าที่สารบัญเขต/สถานศึกษา (แทน openDocStaffSettings)
 *   DocumentsSchoolPrefixModal      กำหนดเลขหนังสือสถานศึกษา (แทน openSetSchoolDocPrefix)
 *   DocumentsStampEditor            ตัวปั้มตรา/ลายเซ็นบน PDF (แทน _stampOverlay)
 *   DocumentsFormModal              ฟอร์ม order / certificate / honor (แทนส่วนแรกของ openForm)
 *   DocumentsIncomingFormModal      ฟอร์มลงทะเบียนรับหนังสือ (แทนส่วนที่สองของ openForm + saveForm)
 *   DocumentsOutgoingFormModal      ฟอร์มลงทะเบียนเลขหนังสือส่ง (แทนส่วนที่สามของ openForm)
 *
 * ฟังก์ชันล้วนที่ไม่มี DOM ถูกแยกไว้ใน src/lib/documents.js และ src/lib/documents-form.js
 * (docTypeMeta, ค่าคงที่เดือน/คอลัมน์, วาดเกียรติบัตรลง canvas, พิมพ์เกียรติบัตร ฯลฯ)
 *
 * ส่วนที่ยังเป็นโมดุลเดิม — สองฟอร์มนี้สร้าง PDF ด้วย PDFLib แล้วเปิดหน้าต่างพิมพ์
 *   DocumentsView.openSendForm()   ส่งหนังสือไปหน่วยงานอื่น
 *   DocumentsView.openPostalForm() ส่งไปรษณีย์ภายในเขต
 */
import { ref, computed, watch, onMounted } from 'vue';
import api from '../api/client.js';
import { UI } from '../ui/ui.js';
import { Auth } from '../stores/auth.js';
import { DocumentsView } from '../views/DocumentsView.js';
import { docTypeMeta, parseFiles } from '../lib/documents.js';
import { printHonorFile } from '../lib/documents-form.js';
import AppModal from '../components/ui/AppModal.vue';
import DocumentsDetailModal from '../components/documents/DocumentsDetailModal.vue';
import DocumentsCertA4Modal from '../components/documents/DocumentsCertA4Modal.vue';
import DocumentsExportModal from '../components/documents/DocumentsExportModal.vue';
import DocumentsStaffSettingsModal from '../components/documents/DocumentsStaffSettingsModal.vue';
import DocumentsCertStaffModal from '../components/documents/DocumentsCertStaffModal.vue';
import DocumentsDocStaffSettingsModal from '../components/documents/DocumentsDocStaffSettingsModal.vue';
import DocumentsSchoolPrefixModal from '../components/documents/DocumentsSchoolPrefixModal.vue';
import DocumentsFormModal from '../components/documents/DocumentsFormModal.vue';
import DocumentsIncomingFormModal from '../components/documents/DocumentsIncomingFormModal.vue';
import DocumentsOutgoingFormModal from '../components/documents/DocumentsOutgoingFormModal.vue';

/* ---------- ประเภททะเบียน ---------- */
const TYPES = [
  { value: 'incoming', label: '▼ หนังสือรับ' },
  { value: 'outgoing', label: '▲ หนังสือส่ง' },
  { value: 'incoming_reg', label: '▭ ทะเบียนหนังสือรับ' },
  { value: 'outgoing_reg', label: '▭ ทะเบียนหนังสือส่ง' },
  { value: 'order', label: '▭ ทะเบียนคำสั่ง' },
  { value: 'certificate', label: '▭ ทะเบียนหนังสือรับรอง' },
  { value: 'honor', label: '▭ ทะเบียนเกียรติบัตร' },
];

const isSchoolUser = computed(() => Auth.user && Auth.user.user_group === 'school');
const isAdmin = computed(() => Auth.isAdmin());

const isOfficeDocStaff = ref(false);
const isSchoolDocStaff = ref(false);
const isCertStaff = ref(false);

/** แท็บที่ผู้ใช้เห็น — ฝั่งสถานศึกษาตัดแท็บที่ไม่เกี่ยวออก */
const tabs = computed(() => {
  const out = [TYPES[0], TYPES[1]];
  if (isOfficeDocStaff.value || isAdmin.value) out.push(TYPES[2]);
  out.push(TYPES[3]);
  if (!isSchoolUser.value) out.push(TYPES[4], TYPES[5], TYPES[6]);
  return out;
});

/* ---------- แท็บปัจจุบัน ---------- */
const currentType = ref(
  tabs.value.some((t) => t.value === (localStorage.getItem('doc_tab') || 'incoming'))
    ? localStorage.getItem('doc_tab') || 'incoming'
    : 'incoming',
);

function setTab(v) {
  currentType.value = v;
  localStorage.setItem('doc_tab', v);
  // เปิดแท็บใหม่ = เริ่มที่หน้าที่เคยค้างไว้ของแท็บนั้น (ไม่มี = หน้า 1)
  currentPage.value = parseInt(localStorage.getItem('doc_page_' + v), 10) || 1;
}

const meta = computed(() => docTypeMeta(currentType.value));

/* ---------- ตัวกรอง ---------- */
const q = ref('');
const year = ref('');
const workgroup = ref('');
const workgroupOptions = ref([]);

let searchTimer = null;
function onSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 350);
}

async function loadYears() {
  let years = [];
  try {
    const d = await api.get('/document-years');
    years = d.years || [];
  } catch {
    years = [new Date().getFullYear() + 543];
  }
  yearOptions.value = years;
  // ค่าเริ่มต้น = ปีปัจจุบัน (ตัวเลือกแรก) — ขึ้นปีใหม่ 1 ม.ค. เลขที่ทุกเมนูเริ่มรัน 1 ใหม่เอง
  year.value = years.length ? String(years[0]) : '';
}

const yearOptions = ref([]);

async function loadWorkgroups() {
  try {
    const wg = await api.get('/workplace-groups');
    workgroupOptions.value = (wg.groups || []).map((g) => String(g || '').trim()).filter(Boolean);
  } catch {
    /* โหลดไม่ได้ → จะเติมจากข้อมูลเอกสารแทน */
  }
}

/** เติมกลุ่มงานจากข้อมูลจริงของแท็บปัจจุบัน (สะสม ไม่ล้างตัวเลือกเดิม) */
function addWorkgroupsFromData(docs) {
  const have = new Set(workgroupOptions.value);
  for (const d of docs) {
    const w = (d.workgroup || '').trim();
    if (w && !have.has(w)) {
      have.add(w);
      workgroupOptions.value.push(w);
    }
  }
}

/* ---------- ตาราง ---------- */
const PAGE_SIZE = 25;
const currentPage = ref(1);
const docs = ref([]);
const loading = ref(false);
const loadError = ref('');
/** จำนวนผู้รับหนังสือส่ง — โหลดล่วงหน้าเพื่อไม่ต้องยิง API ทีละแถว */
const recipientCounts = ref({});

const totalPages = computed(() => Math.max(1, Math.ceil(docs.value.length / PAGE_SIZE)));
const slice = computed(() =>
  docs.value.slice((currentPage.value - 1) * PAGE_SIZE, currentPage.value * PAGE_SIZE),
);

/** ตัวเลือกหน้า: หน้าปัจจุบันอยู่กลางช่วง 10 หน้าที่แสดง */
const pageOptions = computed(() => {
  const tp = totalPages.value;
  if (tp <= 1) return [];
  const maxShow = 10;
  let start = 1;
  let end = tp;
  if (tp > maxShow) {
    start = Math.max(1, currentPage.value - 5);
    end = Math.min(tp, start + maxShow - 1);
    if (end - start < maxShow - 1) start = Math.max(1, end - maxShow + 1);
  }
  const out = [];
  if (currentPage.value > 1) out.push({ value: currentPage.value - 1, label: '◀' });
  for (let p = start; p <= end; p++) out.push({ value: p, label: String(p) });
  if (currentPage.value < tp) out.push({ value: currentPage.value + 1, label: '▶' });
  return out;
});

/** endpoint ของแต่ละแท็บ — แต่ละแท็บใช้มุมมองของตัวเอง */
const ENDPOINTS = {
  incoming: '/my-incoming',
  incoming_reg: '/my-incoming-registered',
  outgoing_reg: '/my-outgoing-registered',
  order: '/my-orders',
  certificate: '/my-certificates',
  honor: '/my-honors',
};

async function load() {
  loading.value = true;
  loadError.value = '';
  const qs = [];
  if (q.value.trim()) qs.push('q=' + encodeURIComponent(q.value.trim()));
  if (year.value) qs.push('year=' + encodeURIComponent(year.value));
  if (workgroup.value) qs.push('workgroup=' + encodeURIComponent(workgroup.value));

  const ep = ENDPOINTS[currentType.value];
  const url = ep ? ep + (qs.length ? '?' + qs.join('&') : '')
    : '/documents?' + (qs.length ? qs.join('&') + '&' : '') + 'doc_type=' + encodeURIComponent(currentType.value);

  try {
    const data = await api.get(url);
    docs.value = data.documents || [];
    addWorkgroupsFromData(docs.value);

    // นับผู้รับหนังสือส่ง (โหลดล่วงหน้า)
    recipientCounts.value = {};
    if (currentType.value === 'outgoing' && docs.value.length) {
      const results = await Promise.all(
        docs.value.map((d) =>
          api
            .get('/document-recipients/' + d.id)
            .then((r) => ({ id: d.id, count: (r.recipients || []).length }))
            .catch(() => ({ id: d.id, count: 0 })),
        ),
      );
      for (const r of results) recipientCounts.value[r.id] = r.count;
    }

    currentPage.value = parseInt(localStorage.getItem('doc_page_' + currentType.value), 10) || 1;
  } catch (e) {
    docs.value = [];
    loadError.value = e.message;
  } finally {
    loading.value = false;
  }
}

watch(currentPage, () => {
  // จำหน้าล่าสุดของแท็บนี้ไว้ (เปิดแท็บใหม่กลับมาที่หน้าเดิม)
  try {
    localStorage.setItem('doc_page_' + currentType.value, String(currentPage.value));
  } catch {
    /* localStorage ใช้ไม่ได้ (โหมดส่วนตัว) — ข้าม */
  }
});

watch([year, workgroup], load);
onMounted(async () => {
  // สิทธิ์เจ้าหน้าที่สารบัญ — ต้องได้ก่อนสร้างแท็บ
  try {
    const ds = await api.get('/document-staff/me');
    isOfficeDocStaff.value = !!ds.isOfficeDocStaff;
    isSchoolDocStaff.value = !!ds.schoolCode;
  } catch {
    isOfficeDocStaff.value = false;
    isSchoolDocStaff.value = false;
  }
  try {
    const cs = await api.get('/cert-staff/me');
    isCertStaff.value = !!cs.isCertStaff;
  } catch {
    isCertStaff.value = false;
  }
  /*
   * ค่าที่ยังต้องส่งให้โมดุลเดิม: เลขหนังสือสถานศึกษาเท่านั้น
   * (openForm ใช้ตอนสร้างเลขหนังสือใหม่)
   *
   * สิทธิ์เจ้าหน้าที่ที่เคยส่งให้ (_isOfficeDocStaff, _isSchoolDocStaff, _isCertStaff, _currentType)
   * ถูกถอดออกแล้ว เพราะ dialog ที่ยังเป็นโมดุลเดิมไม่ได้อ่านค่าเหล่านั้นอีก
   * ส่วน UI ที่ต้องใช้สิทธิ์อยู่ในหน้านี้แล้ว (แท็บ · ปุ่ม · เมนูแถว)
   */
  if (isSchoolDocStaff.value) {
    try {
      const px = await api.get('/document-staff/school-prefix');
      schoolDocPrefix.value = px.doc_prefix || '';
      DocumentsView._schoolDocPrefix = schoolDocPrefix.value;
    } catch {
      schoolDocPrefix.value = '';
      DocumentsView._schoolDocPrefix = '';
    }
  }

  // แท็บที่บันทึกไว้อาจไม่มีสิทธิ์เข้า
  if (!tabs.value.some((t) => t.value === currentType.value)) setTab('incoming');

  await Promise.all([loadYears(), loadWorkgroups()]);
  await load();
});

/* ---------- ปุ่มด้านบน ---------- */
const canEditRows = (r) => isAdmin.value || isOfficeDocStaff.value || r.created_by === Auth.user?.id;
const canCert = (r) => isAdmin.value || isCertStaff.value;

/* ---------- dialog ที่ย้ายเป็น Vue ---------- */
/** หนังสือที่กำลังดูรายละเอียด */
const detailDoc = ref(null);
/** หนังสือรับรองที่กำลังพิมพ์ */
const certA4Doc = ref(null);
const exportOpen = ref(false);
const staffSettingsOpen = ref(false);
const certStaffOpen = ref(false);
/** 'office' | 'school' */
const docStaffType = ref('office');
const docStaffOpen = ref(false);
const prefixOpen = ref(false);

/** เลขหนังสือสถานศึกษาปัจจุบัน — dialog เก็บค่าไว้ใน DocumentsView */
const schoolDocPrefix = ref('');

/** เปิดรายละเอียดหนังสือ */
function openDetail(r) {
  detailDoc.value = r;
}

/** เปิดแบบฟอร์มหนังสือรับรอง A4 */
function openCertA4(r) {
  certA4Doc.value = r;
}

/** พิมพ์จากไฟล์เกียรติบัตรที่บันทึกไว้ — ย้ายไปอยู่ใน lib/documents-form.js แล้ว */

/** ทำเครื่องหมายหนังสือรับรองว่าดำเนินการเสร็จแล้ว */
async function markCertDone(r) {
  try {
    await api.post('/cert-status/' + r.id, {});
    UI.toast('ดำเนินการเสร็จแล้ว', 'success');
    load();
  } catch (e) {
    UI.toast(e.message || 'ไม่สำเร็จ', 'error');
  }
}

/** ลบหนังสือ */
async function removeDoc(r) {
  const ok = await UI.confirm(`ต้องการลบหนังสือ "${r.title}" ใช่หรือไม่?`, { danger: true, okText: 'ลบ' });
  if (!ok) return;
  try {
    const res = await api.del('/documents/' + r.id);
    UI.toast(res.message);
    load();
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

/**
 * นำออกจากทะเบียนหนังสือรับ
 *
 * ไม่ลบหนังสือ แค่ตั้ง is_registered=0
 * หนังสือยังอยู่ในรายการหนังสือรับและหนังสือส่งของสถานศึกษา
 */
async function unregister(r) {
  const ok = await UI.confirm(
    `นำหนังสือ "${r.title}" ออกจากทะเบียนหนังสือรับใช่หรือไม่?\n\n(หนังสือจะยังอยู่ในรายการหนังสือรับและหนังสือส่งของสถานศึกษา)`,
    { danger: true, okText: 'นำออก' },
  );
  if (!ok) return;
  try {
    const fd = new FormData();
    fd.append('is_registered', '0');
    await api.putForm('/documents/' + r.id, fd);
    UI.toast('นำออกจากทะเบียนเรียบร้อย');
    load();
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

/**
 * ฟอร์มลงทะเบียน/แก้ไขหนังสือ
 *
 * kind: 'simple'    order / certificate / honor  → DocumentsFormModal
 *        'incoming' ลงทะเบียนรับหนังสือ            → DocumentsIncomingFormModal
 *        'outgoing' ลงทะเบียนเลขหนังสือส่ง        → DocumentsOutgoingFormModal
 */
const formKind = ref(null); // null | 'simple' | 'incoming' | 'outgoing'
const formDoc = ref(null);
const formPresetType = ref('order');

/** เปิดฟอร์ม order / certificate / honor */
function openSimpleForm(presetType, row = null) {
  formPresetType.value = presetType;
  formDoc.value = row;
  formKind.value = 'simple';
}

/** เปิดฟอร์มลงทะเบียนรับหนังสือ */
function openIncomingForm(row = null) {
  formDoc.value = row;
  formKind.value = 'incoming';
}

/** เปิดฟอร์มลงทะเบียนเลขหนังสือส่ง */
function openOutgoingForm(row = null) {
  formDoc.value = row;
  formKind.value = 'outgoing';
}

/**
 * เปิดฟอร์มแก้ไขหนังสือจากปุ่ม ✎ ในตาราง
 *
 * เลือกฟอร์มตาม doc_type ของรายการ:
 *   order / certificate / honor → simple
 *   incoming                    → incoming
 *   outgoing                    → outgoing
 */
function openEditForm(row) {
  const t = row.doc_type;
  if (t === 'order' || t === 'certificate' || t === 'honor') {
    openSimpleForm(t, row);
    return;
  }
  if (t === 'outgoing') {
    openOutgoingForm(row);
    return;
  }
  openIncomingForm(row);
}

/**
 * ปุ่ม "ลงทะเบียนรับ" ในแท็บหนังสือรับ
 *
 * เติมข้อมูลจากรายการหนังสือรับที่เลือกมากรอกให้อัตโนมัติ (เหมือนของเดิม)
 */
function openIncomingRegister(row) {
  openIncomingForm({
    id: row.id,
    doc_type: 'incoming',
    from_org: row.from_org || '',
    doc_no: row.doc_no || '',
    title: row.title || '',
    date: row.date || '',
    note: row.note || '',
    reg_no: row.reg_no || '',
    workgroup: row.workgroup || '',
    file: row.file || '',
  });
}

function closeForm() {
  formKind.value = null;
  formDoc.value = null;
}

/** บันทึกสำเร็จ → ปิดฟอร์มแล้วโหลดตารางใหม่ */
function onFormSaved() {
  closeForm();
  load();
}

/**
 * ลงทะเบียนรับหนังสือสำเร็จ → เปิดหน้าส่งไปรษณีย์ภายในเขตต่อทันที
 *
 * openPostalForm ยังเป็นโมดุลเดิม จึงต้องเรียกจากตรงนี้ (หน้าหลักเป็นคนถือ component)
 */
function onIncomingSavedForPostal({ files, prefill }) {
  closeForm();
  load();
  DocumentsView.openPostalForm(files || [], prefill || {});
}

/** หนังสือรับรองบันทึกแล้ว → เปิดแบบฟอร์ม A4 ให้ดู/พิมพ์ทันที (แทนการรีโหลดหน้า) */
function onCertSaved(formData) {
  closeForm();
  load();
  certA4Doc.value = formData;
}

/** เปิดฟอร์มกำหนดเจ้าหน้าที่สารบัญ */
function openDocStaffSettings(type) {
  docStaffType.value = type;
  docStaffOpen.value = true;
}

/* ---------- ปุ่มรายแท็บ ---------- */
const TAB_ACTIONS = computed(() => {
  const office = [
    { label: '▭ ลงทะเบียนหนังสือรับ', bg: '#0f766e', show: isAdmin.value || isOfficeDocStaff.value, run: () => openIncomingForm() },
  ];
  if (isSchoolUser.value) {
    return {
      incoming: [],
      outgoing: [],
      incoming_reg: office,
      outgoing_reg: [
        { label: '▭ ลงทะเบียนหนังสือส่ง', bg: '#1d4ed8', show: true, run: () => openOutgoingForm() },
        { label: '🔢 กำหนดเลขหนังสือสถานศึกษา', bg: '#7c3aed', show: isSchoolDocStaff.value, run: () => (prefixOpen = true) },
      ],
      order: [],
      certificate: [],
      honor: [],
    };
  }
  return {
    incoming: [],
    outgoing: [],
    incoming_reg: office,
    outgoing_reg: [
      { label: '▲ ลงทะเบียนหนังสือส่ง (สพป.แพร่ เขต 2)', bg: '#2563eb', show: true, run: () => openOutgoingForm() },
    ],
    order: [{ label: '▭ ลงทะเบียนคำสั่ง', bg: '#b45309', show: true, run: () => openSimpleForm('order') }],
    certificate: [
      { label: '▭ ลงทะเบียนหนังสือรับรอง', bg: '#be185d', show: canCert({}), run: () => openSimpleForm('certificate') },
      { label: '⊗ กำหนดเจ้าหน้าที่หนังสือรับรอง', bg: '#0f766e', show: isAdmin.value, run: () => (certStaffOpen = true) },
    ],
    honor: [{ label: '▭ ลงทะเบียนเกียรติบัตร', bg: '#a16207', show: true, run: () => openSimpleForm('honor') }],
  };
});

const tabActions = computed(() =>
  (TAB_ACTIONS.value[currentType.value] || []).filter((a) => a.show),
);

/* ---------- ช่องไฟล์ ---------- */
function filesOf(r) {
  return parseFiles(r.file);
}

/**
 * ไฟล์ที่แสดงในคอลัมน์ "ไฟล์" ต่างกันตามแท็บ
 *   หนังสือรับ          → ไฟล์แนบต้นฉบับจากผู้ส่ง (ไฟล์แรก)
 *   ทะเบียนหนังสือรับ   → ไฟล์ที่สารบัญเขตปั้มรับ (ไฟล์ท้ายสุด)
 *   หนังสือส่ง(ลงทะเบียนแล้ว) → ไฟล์ต้นฉบับ ไม่แสดงไฟล์ปั้ม
 *   อื่น ๆ             → ทุกไฟล์
 */
function displayFile(r) {
  const files = filesOf(r);
  if (!files.length) return '';
  if (currentType.value === 'incoming_reg') return files[files.length - 1];
  if (currentType.value === 'incoming') return files[0];
  if (currentType.value === 'outgoing' && r.is_registered) return files[0];
  return r.file;
}

function fileUrl(f) {
  if (!f) return '';
  try {
    const arr = JSON.parse(f);
    const one = Array.isArray(arr) ? arr[0] : arr;
    return '/uploads/' + UI.encodePath(one.file || one);
  } catch {
    return '/uploads/' + UI.encodePath(f);
  }
}

/* ---------- คอลัมน์ตามแท็บ ---------- */
const COLORS = {
  incoming: { background: '#dbeafe', color: '#1d4ed8' },
  outgoing: { background: '#dcfce7', color: '#15803d' },
  order: { background: '#fef3c7', color: '#b45309' },
  certificate: { background: '#fce7f3', color: '#be185d' },
  honor: { background: '#fef9c3', color: '#a16207' },
};

const columns = computed(() => {
  const t = currentType.value;
  const cols = [];

  // คอลัมน์ประเภท (ตัดออกในแท็บหนังสือรับ/ส่ง เพราะซ้ำกับชื่อแท็บ)
  if (!['incoming', 'incoming_reg', 'outgoing', 'outgoing_reg'].includes(t)) {
    cols.push({
      key: 'doc_type',
      label: 'ประเภท',
      cell: (r) => {
        const c = COLORS[r.doc_type] || { background: '#f1f5f9', color: '#334155' };
        return {
          pill: true,
          text: docTypeMeta(r.doc_type).short,
          background: c.background,
          color: c.color,
        };
      },
    });
  }

  // สถานะอ่าน/ไม่อ่าน (หนังสือรับ)
  if (t === 'incoming') {
    cols.unshift({
      key: 'is_read',
      label: 'สถานะ',
      cell: (r) =>
        r.is_read === undefined
          ? { text: '-', color: '#94a3b8' }
          : r.is_read
            ? { text: '● อ่านแล้ว', color: '#10b981', bold: true }
            : { text: '🆕 ใหม่', color: '#f59e0b', bold: true },
    });
  }

  // สถานะการดำเนินการ (หนังสือรับรอง)
  if (t === 'certificate') {
    cols.unshift({ key: 'cert_status', label: 'สถานะ', cell: (r) => ({ cert: r.cert_status || 'กำลังดำเนินการ' }) });
  }

  // เลขหนังสือรับ (ทะเบียนหนังสือรับ)
  if (t === 'incoming_reg') cols.unshift({ key: 'reg_no', label: 'เลขหนังสือรับ' });

  // ชื่อ-นามสกุล (เกียรติบัตร)
  if (t === 'honor') {
    cols.splice(1, 0, {
      key: 'person_name',
      label: 'ชื่อ-นามสกุล, โรงเรียน ฯลฯ',
      cell: (r) => ({ text: (r.person_name || '-') + (r.person_school ? ' | ' + r.person_school : '') }),
    });
  }

  cols.push({ key: 'doc_no', label: t === 'order' ? 'เลขที่คำสั่ง' : t === 'honor' ? 'เลขเกียรติบัตร' : 'เลขที่หนังสือ' });

  // วันที่ — หนังสือคำสั่งย้ายไปต่อจากเลขที่คำสั่ง, หนังสือรับรองย้ายไปต่อจากเลขที่
  if (t === 'order' || t === 'certificate') {
    cols.push({ key: 'date', label: t === 'order' ? 'สั่ง ณ วันที่' : 'วันที่', cell: (r) => ({ text: UI.date(r.date) }) });
  } else {
    cols.push({ key: 'date', label: 'วันที่', cell: (r) => ({ text: UI.date(r.date) }) });
  }

  cols.push({ key: 'title', label: 'เรื่อง' });

  if (t === 'honor') {
    cols.push({ key: 'honor_signer', label: 'ผู้ลงนาม', cell: (r) => ({ text: r.signer_name || '-' }) });
    cols.push({ key: 'honor_saved_file', label: 'พิมพ์', kind: 'printHonor', field: 'honor_saved_file' });
  }

  if (t === 'order') {
    cols.push({ key: 'owner_group', label: 'เจ้าของคำสั่ง', cell: (r) => ({ text: r.owner_group || '-' }) });
    cols.push({ key: 'order_registrar', label: 'ผู้ลงทะเบียน', cell: (r) => ({ text: r.order_registrar || '-' }) });
  }

  if (t === 'certificate') {
    cols.push({ key: 'requester', label: 'ผู้ขอ', cell: (r) => ({ text: r.requester || '-' }) });
    cols.push({ key: 'cert_position', label: 'ตำแหน่ง', cell: (r) => ({ text: r.cert_position || '-' }) });
    cols.push({ key: 'officer', label: 'เจ้าหน้าที่(ผู้ปฏิบัติ)', cell: (r) => ({ text: r.officer || '-' }) });
    cols.push({ key: 'cert_print', label: 'พิมพ์', kind: 'certPrint' });
  }

  if (!['honor', 'order', 'certificate'].includes(t)) {
    cols.push({ key: 'from_org', label: 'จาก' });
    cols.push({ key: 'to_org', label: t === 'incoming_reg' ? 'กลุ่มปฏิบัติ' : 'ถึง' });
  }

  if (t === 'incoming_reg' || t === 'outgoing_reg') {
    cols.push({ key: 'workgroup', label: 'กลุ่มปฏิบัติ' });
  }

  if (!['incoming', 'incoming_reg', 'outgoing', 'outgoing_reg', 'honor', 'order', 'certificate'].includes(t)) {
    cols.push({ key: 'category', label: 'หมวดหมู่' });
  }

  // ผู้รับ (หนังสือส่ง)
  if (t === 'outgoing') {
    cols.unshift({ key: 'recipients', label: 'ผู้รับ', kind: 'recipients' });
  }

  cols.push({ key: 'file', label: 'ไฟล์', kind: 'file' });
  return cols;
});

/* ---------- จำนวนรายการใหม่ ---------- */
const unreadCount = computed(() =>
  ['incoming', 'incoming_reg'].includes(currentType.value)
    ? docs.value.filter((d) => d.is_read !== undefined && !d.is_read).length
    : 0,
);

/* ---------- รายชื่อผู้รับหนังสือส่ง ---------- */
const recipsOpen = ref(false);
const recipsOf = ref(null);
const recipsRows = ref([]);
const recipsLoading = ref(false);

async function showRecipients(r) {
  recipsOf.value = r;
  recipsRows.value = [];
  recipsOpen.value = true;
  recipsLoading.value = true;
  try {
    const d = await api.get('/document-recipients/' + r.id);
    recipsRows.value = d.recipients || [];
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    recipsLoading.value = false;
  }
}

const recipsReadCount = computed(() => recipsRows.value.filter((x) => x.is_read).length);

/** เมื่อกรองปีอยู่แต่ไม่มีข้อมูล → เดาว่าอาจมีในปีก่อน */
function showAllYears() {
  year.value = '';
  load();
}
</script>

<template>
  <div class="page-head">
    <div><div class="page-title">หนังสือราชการ</div></div>
  </div>

  <!-- ---------- ปุ่มด้านบน (ฝั่ง สพป. / สถานศึกษา) ---------- -->
  <div v-if="!isSchoolUser" id="doc-top-actions" class="toolbar" style="gap: 8px; flex-wrap: wrap; margin-bottom: 10px">
    <button class="btn btn-primary" style="background: #7c3aed" @click="DocumentsView.openSendForm('office')">
      ▲ ส่งหนังสือไปสถานศึกษา
    </button>
    <button class="btn btn-primary" style="background: #7c3aed" @click="DocumentsView.openPostalForm()">
      ✉ ส่งไปรษณีย์ภายในเขต
    </button>
    <button v-if="isAdmin" class="btn btn-primary" style="background: #059669" @click="openDocStaffSettings('office')">
      ⊗ กำหนดเจ้าหน้าที่สารบัญเขต
    </button>
    <button v-if="isAdmin" class="btn btn-primary" style="background: #0891b2" @click="openDocStaffSettings('school')">
      ⊗ กำหนดเจ้าหน้าที่สารบัญสถานศึกษา
    </button>
    <button v-if="isAdmin" class="btn btn-primary" style="background: #0f766e" @click="staffSettingsOpen = true">
      ⊛ ตั้งค่าเจ้าหน้าที่หนังสือราชการ
    </button>
  </div>

  <div v-else id="doc-top-actions" class="toolbar" style="gap: 8px; flex-wrap: wrap; margin-bottom: 10px">
    <button class="btn btn-primary" style="background: #2563eb" @click="DocumentsView.openSendForm('school')">
      ▲ ส่งหนังสือไป สพป.แพร่ เขต 2
    </button>
    <button class="btn btn-primary" style="background: #0891b2" @click="DocumentsView.openSendForm('school_to_school')">
      ▲ ส่งหนังสือไปสถานศึกษาในสังกัด
    </button>
  </div>

  <!-- ---------- แท็บ ---------- -->
  <div class="segment-row">
    <button
      v-for="t in tabs"
      :key="t.value"
      class="seg-btn"
      :class="{ active: currentType === t.value }"
      @click="setTab(t.value)"
    >
      {{ t.label }}
    </button>
  </div>

  <!-- ---------- ปุ่มรายแท็บ ---------- -->
  <div v-if="tabActions.length" id="tab-actions" class="toolbar" style="gap: 8px; flex-wrap: wrap; margin-bottom: 10px">
    <button
      v-for="a in tabActions"
      :key="a.label"
      class="btn btn-primary"
      :style="{ background: a.bg }"
      @click="a.run()"
    >
      {{ a.label }}
    </button>
  </div>

  <!-- ---------- ตัวกรอง ---------- -->
  <div class="filter-row" style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap">
    <input
      id="doc-q"
      v-model="q"
      type="search"
      placeholder="ค้นหาเรื่อง/เลขที่/หน่วยงาน..."
      style="min-width: 240px"
      @input="onSearch"
    />

    <select id="doc-year" v-model="year" style="min-width: 150px">
      <option value="">ทุกปี (พ.ศ.)</option>
      <option v-for="y in yearOptions" :key="y" :value="String(y)">ปี พ.ศ. {{ y }}</option>
    </select>

    <select id="doc-workgroup" v-model="workgroup" style="min-width: 210px">
      <option value="">ทุกกลุ่มงาน</option>
      <option v-for="w in workgroupOptions" :key="w" :value="w">{{ w }}</option>
    </select>

    <div style="margin-left: auto">
      <button
        class="btn btn-primary"
        style="background: #059669"
        title="ดาวน์โหลดข้อมูลเป็นไฟล์ Excel ตามตัวกรอง"
        @click="exportOpen = true"
      >
        ⬇ ดาวน์โหลดข้อมูล
      </button>
    </div>

    <!-- ---------- เข้าหน้า ---------- -->
    <select
      v-if="totalPages > 1"
      id="doc-page"
      :value="String(currentPage)"
      style="min-width: 110px"
      @change="currentPage = Number($event.target.value)"
    >
      <option v-for="p in pageOptions" :key="p.value" :value="String(p.value)">{{ p.label }}</option>
    </select>
  </div>

  <!-- ---------- ตาราง ---------- -->
  <div class="card">
    <div class="card-title">
      ▭ {{ meta.label }} ({{ docs.length }} รายการ)<template v-if="unreadCount > 0"> ({{ unreadCount }} รายการใหม่)</template>
    </div>

    <div v-if="loading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
    <div v-else-if="loadError" class="empty-state"><span class="em">⚠️</span>{{ loadError }}</div>

    <!-- ว่าง: ถ้ากรองปีอยู่ ให้บอกว่าอาจมีรายการในปีก่อน -->
    <div v-else-if="docs.length === 0" class="empty-state">
      <template v-if="year">
        <div style="font-size: 34px">▭</div>
        <div style="margin-top: 6px">ไม่มีรายการในปี พ.ศ. {{ year }} ของทะเบียนนี้</div>
        <div class="hint" style="margin-top: 4px">อาจมีรายการอยู่ในปีก่อนหน้า — ตัวกรองปีเริ่มที่ปีปัจจุบันเสมอ</div>
        <button class="btn btn-outline btn-sm" style="margin-top: 10px" @click="showAllYears">📋 ดูทุกปี</button>
      </template>
      <template v-else><span class="em">▭</span>ยังไม่มีข้อมูลในทะเบียนนี้</template>
    </div>

    <div v-else class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th v-for="c in columns" :key="c.key" :class="{ num: c.key === 'days' }">{{ c.label }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in slice" :key="r.id">
            <td v-for="c in columns" :key="c.key">
              <!-- ---------- ป้ายประเภท ---------- -->
              <span
                v-if="c.cell && c.cell(r).pill"
                class="status-pill"
                :style="{
                  background: c.cell(r).background,
                  color: c.cell(r).color,
                  padding: '3px 10px',
                  borderRadius: '999px',
                  fontWeight: 700,
                  fontSize: '12.5px',
                  whiteSpace: 'nowrap',
                  minWidth: '120px',
                  display: 'inline-block',
                  textAlign: 'center',
                }"
                >{{ c.cell(r).text }}</span
              >

              <!-- ---------- สถานะหนังสือรับรอง ---------- -->
              <span
                v-else-if="c.cell && c.cell(r).cert !== undefined"
                class="cert-status"
                :class="r.cert_status === 'เสร็จแล้ว' ? 'done' : 'processing'"
                >{{ c.cell(r).cert }}</span
              >

              <!-- ---------- ตัวเลขผู้รับ (คลิกดูรายชื่อ) ---------- -->
              <span
                v-else-if="c.kind === 'recipients'"
                :style="{
                  color: (recipientCounts[r.id] || 0) > 0 ? '#10b981' : '#94a3b8',
                  fontWeight: 600,
                  cursor: (recipientCounts[r.id] || 0) > 0 ? 'pointer' : 'default',
                  textDecoration: (recipientCounts[r.id] || 0) > 0 ? 'underline dotted' : 'none',
                }"
                @click="(recipientCounts[r.id] || 0) > 0 && showRecipients(r)"
                >{{ recipientCounts[r.id] || 0 }} คน</span
              >

              <!-- ---------- พิมพ์เกียรติบัตร ---------- -->
              <template v-else-if="c.kind === 'printHonor'">
                <button
                  v-if="r[c.field]"
                  class="btn btn-outline"
                  style="font-size: 12.5px; padding: 4px 10px; border-color: #7c3aed; color: #7c3aed"
                  title="พิมพ์จากไฟล์เกียรติบัตรที่บันทึกไว้"
                  @click="printHonorFile(r[c.field])"
                >
                  🖨 พิมพ์
                </button>
                <span v-else style="color: #94a3b8; font-size: 12.5px">—</span>
              </template>

              <!-- ---------- พิมพ์หนังสือรับรอง (A4) ---------- -->
              <button
                v-else-if="c.kind === 'certPrint'"
                class="btn btn-outline"
                style="font-size: 12.5px; padding: 4px 10px; border-color: #0f766e; color: #0f766e; white-space: nowrap"
                title="แสดงแบบฟอร์ม A4 เพื่อพิมพ์"
                @click="openCertA4(r)"
              >
                🖨 พิมพ์
              </button>

              <!-- ---------- ลิงก์ไฟล์ ---------- -->
              <template v-else-if="c.kind === 'file'">
                <a
                  v-if="displayFile(r)"
                  :href="fileUrl(displayFile(r))"
                  target="_blank"
                  style="color: #2563eb; text-decoration: underline"
                  >✎ เปิดไฟล์</a
                >
                <span v-else class="hint">-</span>
              </template>

              <!-- ---------- ข้อความธรรมดา ---------- -->
              <span
                v-else-if="c.cell"
                :style="{ color: c.cell(r).color, fontWeight: c.cell(r).bold ? 600 : '' }"
                >{{ c.cell(r).text }}</span
              >
              <template v-else>{{ r[c.key] }}</template>
            </td>

            <!-- ---------- ปุ่มจัดการ ---------- -->
            <td>
              <div class="status-btns">
                <button class="btn btn-xs btn-outline" @click="openDetail(r)">👁️</button>

                <!-- หนังสือรับรอง: ทำเครื่องหมายว่าเสร็จ -->
                <button
                  v-if="currentType === 'certificate' && r.cert_status !== 'เสร็จแล้ว' && canCert(r)"
                  class="btn btn-xs btn-outline cert-done-btn"
                  style="font-size: 12.5px; padding: 4px 10px; border-color: #16a34a; color: #16a34a"
                  title="ดำเนินการเสร็จแล้ว"
                  @click="markCertDone(r)"
                >
                  ✓
                </button>

                <!-- หนังสือรับ: ลงทะเบียนรับ -->
                <button
                  v-if="currentType === 'incoming' && (isAdmin || isOfficeDocStaff)"
                  class="btn btn-xs btn-outline"
                  @click="openIncomingRegister(r)"
                >
                  ▼ ลงทะเบียน
                </button>

                <!-- แก้ไข (หนังสือรับรองผู้ไม่มีสิทธิ์แก้) -->
                <button
                  v-if="!(currentType === 'certificate' && !canCert(r)) && canEditRows(r)"
                  class="btn btn-xs btn-outline"
                  title="แก้ไข"
                  @click="openEditForm(r)"
                >
                  ✎
                </button>

                <!-- ทะเบียนหนังสือรับ: นำออกจากทะเบียน (หนังสือไม่ถูกลบ) -->
                <button
                  v-if="currentType === 'incoming_reg'"
                  class="btn btn-xs btn-outline danger-btn"
                  title="นำออกจากทะเบียน"
                  @click="unregister(r)"
                >
                  ✕
                </button>
                <button
                  v-else-if="!(currentType === 'certificate' && !canCert(r)) && canEditRows(r)"
                  class="btn btn-xs btn-outline danger-btn"
                  title="ลบ"
                  @click="removeDoc(r)"
                >
                  ✕
                </button>

                <!-- ซองจดหมาย (เฉพาะแท็บทะเบียนหนังสือรับ) -->
                <button
                  v-if="currentType === 'incoming_reg'"
                  class="btn btn-xs btn-outline"
                  title="ส่งไปรษณีย์ภายในเขต"
                  @click="DocumentsView.openPostalFromRegistry(r)"
                >
                  ✉️
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- ---------- รายชื่อผู้รับหนังสือส่ง ---------- -->
  <AppModal
    v-if="recipsOpen"
    :title="'▭ รายชื่อผู้รับหนังสือส่ง — ' + (recipsOf ? recipsOf.title : '')"
    size="lg"
    footer
    @close="recipsOpen = false"
  >
    <div v-if="recipsLoading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
    <div v-else style="padding: 4px; max-height: 60vh; overflow-y: auto">
      <div style="margin-bottom: 10px; font-size: 13px; color: #64748b">
        อ่านแล้ว <b style="color: #16a34a">{{ recipsReadCount }}</b> / {{ recipsRows.length }} คน
      </div>
      <table class="tbl">
        <thead>
          <tr>
            <th style="text-align: center; width: 40px">ลำดับ</th>
            <th>ชื่อ-สกุล</th>
            <th>ตำแหน่ง</th>
            <th>สังกัด/กลุ่มงาน</th>
            <th style="text-align: center">สถานะ</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(rp, i) in recipsRows" :key="i">
            <td style="text-align: center">{{ i + 1 }}</td>
            <td>{{ (rp.title || '') + ' ' + (rp.full_name || '-') }}</td>
            <td>{{ rp.position || '-' }}</td>
            <!-- รับในฐานะสารบัญสถานศึกษา → แสดงโรงเรียนที่รับ ไม่ใช่ workplace ของ user -->
            <td>{{ rp.as_school_label || rp.workplace || '-' }}</td>
            <td style="text-align: center">
              <span v-if="rp.is_read" style="color: #16a34a; font-weight: 600">● อ่านแล้ว</span>
              <span v-else style="color: #ea580c; font-weight: 600">● ยังไม่อ่าน</span>
              <br v-if="rp.read_at" />
              <span v-if="rp.read_at" style="color: #94a3b8; font-size: 11px">{{ rp.read_at }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <template #footer>
      <button class="btn btn-outline" @click="recipsOpen = false">ปิด</button>
    </template>
  </AppModal>

  <!-- ---------- dialog ที่ย้ายมาเป็น Vue ---------- -->
  <DocumentsDetailModal :doc="detailDoc" @close="detailDoc = null" />

  <DocumentsCertA4Modal :doc="certA4Doc" @close="certA4Doc = null" />

  <DocumentsExportModal
    v-if="exportOpen"
    :current-type="currentType"
    :current-year="year"
    @close="exportOpen = false"
  />

  <DocumentsStaffSettingsModal v-if="staffSettingsOpen" @close="staffSettingsOpen = false" />

  <DocumentsCertStaffModal v-if="certStaffOpen" @close="certStaffOpen = false" />

  <DocumentsDocStaffSettingsModal
    v-if="docStaffOpen"
    :type="docStaffType"
    @close="docStaffOpen = false"
  />

  <DocumentsSchoolPrefixModal
    v-if="prefixOpen"
    :current-prefix="schoolDocPrefix"
    @close="prefixOpen = false"
    @saved="
      (val) => {
        schoolDocPrefix = val;
        DocumentsView._schoolDocPrefix = val;
      }
    "
  />

  <!-- ---------- ฟอร์มลงทะเบียน / แก้ไข ---------- -->
  <DocumentsFormModal
    v-if="formKind === 'simple'"
    :doc="formDoc"
    :preset-type="formPresetType"
    @close="closeForm"
    @saved="onFormSaved"
    @cert-saved="onCertSaved"
  />

  <DocumentsIncomingFormModal
    v-if="formKind === 'incoming'"
    :doc="formDoc"
    @close="closeForm"
    @saved="onFormSaved"
    @open-postal="onIncomingSavedForPostal"
  />

  <DocumentsOutgoingFormModal v-if="formKind === 'outgoing'" :doc="formDoc" @close="closeForm" @saved="onFormSaved" />
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
