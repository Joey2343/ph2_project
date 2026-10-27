<script setup>
/**
 * MemosPage — เมนู 7: บันทึกข้อความ
 *
 * ย้ายจาก src/views/MemosView.js (1,127 บรรทัด) เป็น Vue SFC
 *
 * แต่ละส่วนแยกเป็น component:
 *   MemoForm.vue        — ฟอร์มเขียน/แก้ไข + rich editor + กลุ่มไฟล์
 *   MemoDecide.vue      — หน้าต่างอนุมัติ/ไม่อนุมัติ/ส่งกลับ 3 ขั้น
 *   MemoDoc.vue         — แบบฟอร์มทางการ (form_bunteugkokeam) พร้อมพิมพ์
 *   MemoApprovers.vue   — admin กำหนดลำดับขั้นผู้อนุมัติ
 *
 * หมายเหตุ: ชื่อขั้นและตัวเลือกบันทึกสั่งการอยู่ใน src/lib/memo.js
 * เพราะ <script setup> ของ Vue ไม่อนุญาตให้ export
 */
import { ref, computed, onMounted } from 'vue';
import api from '../api/client.js';
import { UI } from '../ui/ui.js';
import { Auth } from '../stores/auth.js';
import { MEMO_LEVEL_NAMES } from '../lib/memo.js';
import { applyRow, removeRow } from '../lib/row-update.js';
import StatusBadge from '../components/ui/StatusBadge.vue';
import ApprovalSteps from '../components/ui/ApprovalSteps.vue';
import MemoForm from '../components/ui/MemoForm.vue';
import MemoDecide from '../components/ui/MemoDecide.vue';
import MemoReturnModal from '../components/ui/MemoReturnModal.vue';
import MemoDoc from '../components/ui/MemoDoc.vue';
import MemoView from '../components/ui/MemoView.vue';
import MemoApprovers from '../components/ui/MemoApprovers.vue';
import AppModal from '../components/ui/AppModal.vue';
import Pagination from '../components/ui/Pagination.vue';

/* ---------- สิทธิ์เจ้าหน้าที่อนุมัติ ---------- */
const myLevels = ref([]);

onMounted(async () => {
  try {
    const d = await api.get('/memo/approvers');
    const ap = d.approvers || {};
    myLevels.value = Auth.isAdmin() ? [1, 2, 3] : [1, 2, 3].filter((l) => (ap[l] || []).includes(Auth.user.id));
  } catch {
    /* โหลดไม่ได้ = ไม่มีสิทธิ์อนุมัติ */
  }
  await loadLatest();
});

/* ---------- ตัวกรอง ---------- */
const q = ref('');
const status = ref('');
const curYear = new Date().getFullYear() + 543;
const year = ref(String(curYear));
const mineOnly = ref(false);

const rows = ref([]);
const loading = ref(false);
const loadError = ref('');

/*
 * แบ่งหน้า: หน้าละ 25 รายการ
 *   backend ส่งมาเรียงใหม่ → เก่า (ORDER BY id DESC) → หน้า 1 = ล่าสุด
 *   เปลี่ยนคำค้น/สถานะ/ปี/ของฉัน → กลับไปหน้า 1
 */
const PER_PAGE = 25;
const page = ref(1);
const pageCount = computed(() => Math.max(1, Math.ceil(rows.value.length / PER_PAGE)));
const curPage = computed(() => Math.min(page.value, pageCount.value));
const pagedRows = computed(() => {
  const start = (curPage.value - 1) * PER_PAGE;
  return rows.value.slice(start, start + PER_PAGE);
});

const mineBtnLabel = computed(() =>
  mineOnly.value ? '▭ บันทึกข้อความทั้งหมด' : '✎ บันทึกข้อความของฉัน',
);

async function load() {
  loading.value = true;
  loadError.value = '';
  const p = [];
  if (q.value.trim()) p.push('q=' + UI.encodePath(q.value.trim()));
  if (status.value) p.push('status=' + UI.encodePath(status.value));
  if (year.value) p.push('year=' + year.value);
  if (mineOnly.value) p.push('mine=1');
  try {
    const data = await api.get('/memos?' + p.join('&'));
    // เรียงจากเก่า → ใหม่ (backend ส่งมาใหม่ → เก่า) → หน้า 1 = รายการแรก
    rows.value = (data.memos || []).slice().reverse();
  } catch (e) {
    rows.value = [];
    loadError.value = e.message;
  } finally {
    loading.value = false;
  }
}

function toggleMine() {
  mineOnly.value = !mineOnly.value;
  loadLatest();
}

/** โหลดแล้วไปหน้าสุดท้าย (รายการล่าสุด) — ใช้เมื่อเปลี่ยนตัวกรอง/คำค้น */
async function loadLatest() {
  await load();
  page.value = pageCount.value;
}

let searchTimer = null;
function onSearch() {
  // ค้นหาทุกคีย์ = ยิง API ถี่เกินไป → หน่วงเวลาเล็กน้อย
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadLatest, 350);
}

/* ---------- ตัวช่วยแสดงผล ---------- */
function maker(m) {
  return { title: m.maker_title, full_name: m.full_name, first_name: m.first_name, last_name: m.last_name };
}

/** แปลง JSON send_to → รายการชื่อ */
function sendToNames(json) {
  try {
    const arr = JSON.parse(json || '[]');
    if (!Array.isArray(arr)) return '';
    return arr.map((p) => `${p.title || ''}${p.first_name || p.name || ''}  ${p.last_name || ''}`.trim()).join(', ');
  } catch {
    return '';
  }
}

/** ร่างหนังสือส่ง — รองรับทั้ง JSON array และ object เดียว */
function draftList(m) {
  try {
    const d = JSON.parse(m.draft_file || 'null');
    if (Array.isArray(d)) return d;
    if (d && d.file) return [d];
  } catch {
    /* ไม่มีร่าง */
  }
  return [];
}

/** จำนวนขั้นที่ต้องอนุมัติจริง — ขั้นที่ 2 ใช้ "ปฏิบัติราชการฯ" จบที่ขั้นที่ 2 */
function requiredLevels(m) {
  const l2 = (m.approvals || []).find((a) => Number(a.level) === 2);
  if (l2 && l2.mode === 'act') return 2;
  return m.required_levels || 1;
}

/* ---------- สิทธิ์กดปุ่ม ---------- */
const canEditRow = (m) => Auth.isAdmin() || m.user_id === Auth.user?.id;
const canDecideRow = (m) => m.status === 'submitted' && myLevels.value.includes(UI.approvalDone(m) + 1);

/* ---------- หน้าต่าง ---------- */
const detail = ref(null);
const formDoc = ref(null);
const formOpen = ref(false);
const editTarget = ref(null);
const decideTarget = ref(null);
const decideAction = ref('approve');
const approversOpen = ref(false);

function openView(m) { detail.value = m; }
function openForm(m) { editTarget.value = m || null; formOpen.value = true; }
function openDecide(m, action) {
  decideTarget.value = m;
  decideAction.value = action;
}

/* ---------- คืนเรื่องเพื่อแก้ไข (ปุ่มในแถวรายการ) ---------- */
const returnTarget = ref(null);
function openReturn(m) {
  returnTarget.value = m;
}

/**
 * หลังมีการเปลี่ยนแปลง
 *
 * @param {object|null} payload  { id, row } จาก dialog ตัดสินใจ → อัปเดตเฉพาะแถวนั้น
 *                                ถ้าไม่มี (เช่น บันทึกฟอร์ม) → โหลดใหม่ทั้งตาราง
 */
async function afterChange(payload) {
  const id = payload && payload.id;
  const row = payload && payload.row;
  if (id && row && applyRow(rows.value, id, { row }, null)) return;
  await load();
}

/** ปุ่มพิมพ์ในหน้าดู — เปิดแบบฟอร์มทางการ (ต้องมีเลขที่หนังสือแล้ว) */
function showForm(m) {
  detail.value = null;
  formDoc.value = m;
}

/** พิมพ์แบบฟอร์มทางการในหน้าต่าง */
function printFormDoc() {
  const el = document.getElementById('memo-doc-print');
  if (!el) return;
  const css = document.querySelector('link[rel="stylesheet"][href*="theme"], link[rel="stylesheet"][href*="index-"]');
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

async function remove(m) {
  const ok = await UI.confirm(`ต้องการลบบันทึกข้อความ "${m.title}" ใช่หรือไม่?`, { danger: true, okText: 'ลบ' });
  if (!ok) return;
  try {
    const res = await api.del('/memos/' + m.id);
    UI.toast(res.message);
    if (!removeRow(rows.value, m.id)) load();
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}
</script>

<template>
  <div class="page-head">
    <div>
      <div class="page-title"><span class="pi">✎</span>บันทึกข้อความ</div>
      <div class="page-desc">จัดทำและส่งบันทึกข้อความภายในหน่วยงาน</div>
    </div>
    <div class="toolbar" style="justify-content: flex-end">
      <button v-if="Auth.isAdmin()" class="btn btn-outline" @click="approversOpen = true">
        + เพิ่มเจ้าหน้าที่ (ลำดับขั้น)
      </button>
      <button class="btn btn-primary" @click="openForm()">✎ เขียนบันทึกข้อความ</button>
    </div>
  </div>

  <!-- ---------- ตัวกรอง ---------- -->
  <div class="filter-row">
    <input id="mem-q" v-model="q" type="search" placeholder="⊕ ค้นหาเรื่อง..." @input="onSearch" />
    <select id="mem-status" v-model="status" @change="loadLatest">
      <option value="">ทุกสถานะ</option>
      <option value="draft">ฉบับร่าง</option>
      <option value="submitted">ส่งแล้ว / รออนุมัติ</option>
      <option value="approved">อนุมัติแล้ว</option>
      <option value="rejected">ไม่อนุมัติ</option>
      <option value="returned">↻ ส่งกลับเพื่อแก้ไข</option>
      <option value="myapprove">◷ รอการอนุมัติของฉัน</option>
    </select>
    <select id="mem-year" v-model="year" @change="loadLatest">
      <option :value="String(curYear)">{{ curYear }}</option>
      <option :value="String(curYear - 1)">{{ curYear - 1 }}</option>
      <option value="">ทุกปี</option>
    </select>
    <button id="mem-mine-btn" class="btn btn-sm" :class="mineOnly ? 'btn-primary' : 'btn-outline'" @click="toggleMine">
      {{ mineBtnLabel }}
    </button>
  </div>

  <!-- ---------- รายการ ---------- -->
  <div class="card">
    <div class="card-title">▭ รายการบันทึกข้อความ ({{ rows.length }} รายการ)</div>

    <!-- เลขหน้า (ด้านบนขวา · หน้าละ 25 รายการ · หน้า 1 = รายการแรก · หน้าสุดท้าย = ล่าสุด) -->
    <Pagination :total="rows.length" :per-page="PER_PAGE" :page="curPage" @update:page="page = $event" />

    <div v-if="loading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
    <div v-else-if="loadError" class="empty-state"><span class="em">⚠️</span>{{ loadError }}</div>
    <div v-else-if="rows.length === 0" class="empty-state"><span class="em">✎</span>ยังไม่มีบันทึกข้อความ</div>

    <div v-else class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>ที่</th>
            <th>เรื่อง</th>
            <th>วันที่</th>
            <th>สถานะ</th>
            <th>ความคืบหน้า</th>
            <th>ส่งถึง</th>
            <th>ร่างหนังสือ</th>
            <th v-if="Auth.isAdmin()">ผู้จัดทำ</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in pagedRows" :key="m.id">
            <td>{{ m.doc_no || '-' }}</td>
            <td>{{ m.title }}</td>
            <td>{{ UI.date(m.date) }}</td>
            <td><StatusBadge :status="m.status" /></td>
            <td>
              <ApprovalSteps
                v-if="m.status === 'submitted' || m.status === 'approved'"
                :record="{ ...m, required_levels: requiredLevels(m) }"
                :level-names="MEMO_LEVEL_NAMES"
                inline
              />
              <span v-else class="hint">-</span>
            </td>
            <td>
              <span class="hint">{{ sendToNames(m.send_to) || '-' }}</span>
            </td>
            <td>
              <div v-if="draftList(m).length" style="display: flex; gap: 8px">
                <a
                  v-for="f in draftList(m)"
                  :key="f.file"
                  :href="'/uploads/' + UI.encodePath(f.file)"
                  target="_blank"
                  title="เปิดร่างหนังสือส่ง"
                  class="memo-draft-link"
                >
                  <svg width="17" height="21" viewBox="0 0 18 22" aria-hidden="true">
                    <path d="M1 1h10l6 6v14H1z" fill="#FDE68A" stroke="#D97706" stroke-width="1.2" />
                    <path d="M11 1v6h6" fill="#FEF9C3" stroke="#D97706" stroke-width="1.2" />
                  </svg>
                </a>
              </div>
              <span v-else class="hint">-</span>
            </td>
            <td v-if="Auth.isAdmin()">
              <div>{{ UI.personName(maker(m)) }}</div>
              <div class="hint">{{ m.username }}</div>
            </td>
            <td>
              <div class="status-btns">
                <button class="btn btn-xs btn-outline" @click="openView(m)">👁️</button>
                <button v-if="canEditRow(m)" class="btn btn-xs btn-outline" title="แก้ไข" @click="openForm(m)">✎</button>
                <button v-if="canEditRow(m)" class="btn btn-xs btn-outline danger-btn" title="ลบ" @click="remove(m)">
                  ✕
                </button>
                <template v-if="canDecideRow(m)">
                  <button class="btn btn-xs btn-primary" @click="openDecide(m, 'approve')">● อนุมัติ</button>
                  <button class="btn btn-xs btn-outline danger-btn" @click="openDecide(m, 'reject')">✕ ไม่อนุมัติ</button>
                  <button
                    class="btn btn-xs btn-outline"
                    title="คืนเรื่องเพื่อแก้ไข (แจ้งสิ่งที่ต้องแก้ให้เจ้าของเรื่อง)"
                    @click="openReturn(m)"
                  >
                    ↩ คืนเรื่องเพื่อแก้ไข
                  </button>
                </template>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- ---------- หน้าต่างย่อย ---------- -->
  <MemoForm
    v-if="formOpen"
    :memo="editTarget"
    @close="formOpen = false"
    @saved="afterChange"
  />

  <MemoDecide
    v-if="decideTarget"
    :memo="decideTarget"
    :action="decideAction"
    @close="decideTarget = null"
    @done="afterChange"
  />

  <MemoReturnModal
    v-if="returnTarget"
    :memo="returnTarget"
    @close="returnTarget = null"
    @returned="afterChange"
  />

  <MemoApprovers v-if="approversOpen" @close="approversOpen = false" @saved="afterChange" />

  <!-- ดูบันทึกข้อความ -->
  <MemoView
    v-if="detail"
    :memo="detail"
    @close="detail = null"
    @print="showForm"
    @edit="openForm"
  />

  <!-- แบบฟอร์มทางการ (พิมพ์) -->
  <AppModal v-if="formDoc" title="▭ บันทึกข้อความ" size="lg" footer @close="formDoc = null">
    <MemoDoc :memo="formDoc" />
    <template #footer>
      <button class="btn btn-outline" @click="formDoc = null">ปิด</button>
      <button class="btn btn-primary" @click="printFormDoc">⬢ พิมพ์</button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
