<script setup>
/**
 * AcademicPage — เมนู 12: บริหารงานวิชาการ
 *
 * Phase 3: เขียนใหม่เป็น Vue component
 * (เดิมเป็น src/views/AcademicsView.js แบบ UI.h())
 *
 * ฟีเจอร์เท่าเดิม:
 *   - ตัวกรองสถานะ (ทุกสถานะ / วางแผน / ดำเนินการ / เสร็จสิ้น)
 *   - ตารางโครงการ-กิจกรรม (admin เท่านั้นที่เห็นปุ่มจัดการ)
 *   - ดูรายละเอียด / เพิ่ม / แก้ไข / ลบ
 *   - ปฏิทินไทย (พ.ศ.) และจำนวนเงินคงเดิม
 */
import { ref, onMounted, watch } from 'vue';
import api from '../api/client.js';
import { UI } from '../ui/ui.js';
import { Auth } from '../stores/auth.js';
import AppModal from '../components/ui/AppModal.vue';
import ThaiDateField from '../components/ui/ThaiDateField.vue';
import StatusBadge from '../components/ui/StatusBadge.vue';

const loading = ref(true);
const error = ref('');
const projects = ref([]);
const statusFilter = ref('');

/* ---------- หน้าต่าง ---------- */
const formOpen = ref(false);
const viewOpen = ref(false);
const viewing = ref(null);
const saving = ref(false);

/** ฟอร์มเพิ่ม/แก้ไข (แยกจากรายการจริง) */
const f = ref({
  id: null,
  kind: 'project',
  status: 'planned',
  name: '',
  detail: '',
  date_from: '',
  date_to: '',
  responsible: '',
  budget: 0,
  result: '',
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const url = '/academic' + (statusFilter.value ? '?status=' + encodeURIComponent(statusFilter.value) : '');
    const data = await api.get(url);
    projects.value = data.projects || [];
  } catch (e) {
    error.value = e.message;
    projects.value = [];
  } finally {
    loading.value = false;
  }
}

watch(statusFilter, load);

function openView(p) {
  viewing.value = p;
  viewOpen.value = true;
}

function openCreate() {
  f.value = {
    id: null,
    kind: 'project',
    status: 'planned',
    name: '',
    detail: '',
    date_from: '',
    date_to: '',
    responsible: '',
    budget: 0,
    result: '',
  };
  formOpen.value = true;
}

function openEdit(p) {
  f.value = {
    id: p.id,
    kind: p.kind || 'project',
    status: p.status || 'planned',
    name: p.name || '',
    detail: p.detail || '',
    date_from: p.date_from || '',
    date_to: p.date_to || '',
    responsible: p.responsible || '',
    budget: p.budget || 0,
    result: p.result || '',
  };
  formOpen.value = true;
}

async function save() {
  if (!f.value.name.trim()) {
    return UI.toast('กรุณากรอกชื่อโครงการ/กิจกรรม', 'error');
  }
  const data = {
    name: f.value.name.trim(),
    kind: f.value.kind,
    detail: f.value.detail.trim(),
    date_from: f.value.date_from,
    date_to: f.value.date_to,
    responsible: f.value.responsible.trim(),
    budget: parseFloat(f.value.budget) || 0,
    status: f.value.status,
    result: f.value.result.trim(),
  };
  saving.value = true;
  try {
    const res = f.value.id
      ? await api.put('/academic/' + f.value.id, data)
      : await api.post('/academic', data);
    UI.toast(res.message);
    formOpen.value = false;
    await load();
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    saving.value = false;
  }
}

async function remove(p) {
  const yes = await UI.confirm(`ต้องการลบ "${p.name}" ใช่หรือไม่?`, { danger: true, okText: 'ลบ' });
  if (!yes) return;
  try {
    const res = await api.del('/academic/' + p.id);
    UI.toast(res.message);
    await load();
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

onMounted(load);
</script>

<template>
  <div class="page-head">
    <div>
      <div class="page-title"><span class="pi">📚</span>บริหารงานวิชาการ</div>
      <div class="page-desc">โครงการและกิจกรรมทางวิชาการของหน่วยงาน</div>
    </div>
    <button v-if="Auth.isAdmin()" class="btn btn-primary" @click="openCreate">+ เพิ่มโครงการ/กิจกรรม</button>
  </div>

  <div class="filter-row">
    <select id="ac-status" v-model="statusFilter">
      <option value="">ทุกสถานะ</option>
      <option value="planned">วางแผน</option>
      <option value="ongoing">ดำเนินการ</option>
      <option value="done">เสร็จสิ้น</option>
    </select>
  </div>

  <div class="card">
    <div v-if="loading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
    <div v-else-if="error" class="empty-state"><span class="em">⚠️</span>{{ error }}</div>
    <div v-else-if="projects.length === 0" class="empty-state">
      <span class="em">📚</span>ยังไม่มีโครงการ/กิจกรรม
    </div>

    <template v-else>
      <div class="card-title">▭ โครงการ/กิจกรรม ({{ projects.length }} รายการ)</div>
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>ประเภท</th>
              <th>ชื่อโครงการ/กิจกรรม</th>
              <th>ช่วงเวลา</th>
              <th>ผู้รับผิดชอบ</th>
              <th class="num">งบประมาณ</th>
              <th>สถานะ</th>
              <th v-if="Auth.isAdmin()"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in projects" :key="p.id">
              <td>
                <span
                  class="status-pill"
                  :style="p.kind === 'project'
                    ? { background: '#ede9fe', color: '#6d28d9', padding: '3px 10px', borderRadius: '999px', fontWeight: 700, fontSize: '12.5px' }
                    : { background: '#cffafe', color: '#0e7490', padding: '3px 10px', borderRadius: '999px', fontWeight: 700, fontSize: '12.5px' }"
                >
                  {{ p.kind === 'project' ? '▭ โครงการ' : '🎯 กิจกรรม' }}
                </span>
              </td>
              <td>{{ p.name }}</td>
              <td>
                {{ p.date_from ? `${UI.date(p.date_from)}${p.date_to ? ' ถึง ' + UI.date(p.date_to) : ''}` : '-' }}
              </td>
              <td>{{ p.responsible }}</td>
              <td class="num">{{ UI.money(p.budget) }} บาท</td>
              <td><StatusBadge :status="p.status" /></td>
              <td v-if="Auth.isAdmin()">
                <div class="status-btns">
                  <button class="btn btn-xs btn-outline" @click="openView(p)">👁️</button>
                  <button class="btn btn-xs btn-outline" @click="openEdit(p)">✎</button>
                  <button class="btn btn-xs btn-outline danger-btn" @click="remove(p)">✕</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>

  <!-- ---------- ดูรายละเอียด ---------- -->
  <AppModal v-if="viewOpen" title="👁️ รายละเอียดโครงการ/กิจกรรม" size="lg" @close="viewOpen = false">
    <div v-if="viewing" class="form-grid">
      <div class="form-group">
        <label>ประเภท</label>
        <div>{{ viewing.kind === 'project' ? '▭ โครงการ' : '🎯 กิจกรรม' }}</div>
      </div>
      <div class="form-group">
        <label>สถานะ</label>
        <div><StatusBadge :status="viewing.status" /></div>
      </div>
      <div class="form-group full">
        <label>ชื่อโครงการ/กิจกรรม</label>
        <div>{{ viewing.name }}</div>
      </div>
      <div class="form-group full">
        <label>รายละเอียด</label>
        <div style="white-space: pre-wrap">{{ viewing.detail || '-' }}</div>
      </div>
      <div class="form-group">
        <label>ช่วงเวลา</label>
        <div>
          {{ viewing.date_from ? `${UI.thaiDate(viewing.date_from)} ถึง ${UI.thaiDate(viewing.date_to)}` : '-' }}
        </div>
      </div>
      <div class="form-group">
        <label>ผู้รับผิดชอบ</label>
        <div>{{ viewing.responsible || '-' }}</div>
      </div>
      <div class="form-group">
        <label>งบประมาณ</label>
        <div><span class="money">{{ UI.money(viewing.budget) }} บาท</span></div>
      </div>
      <div class="form-group full">
        <label>ผลการดำเนินงาน</label>
        <div style="white-space: pre-wrap">{{ viewing.result || '-' }}</div>
      </div>
    </div>
  </AppModal>

  <!-- ---------- เพิ่ม / แก้ไข ---------- -->
  <AppModal
    v-if="formOpen"
    :title="f.id ? '✎ แก้ไขโครงการ/กิจกรรม' : '+ เพิ่มโครงการ/กิจกรรม'"
    size="lg"
    footer
    @close="formOpen = false"
  >
    <div class="form-grid">
      <div class="form-group">
        <label>ประเภท</label>
        <select id="af-kind" v-model="f.kind">
          <option value="project">▭ โครงการ</option>
          <option value="activity">🎯 กิจกรรม</option>
        </select>
      </div>
      <div class="form-group">
        <label>สถานะ</label>
        <select id="af-status" v-model="f.status">
          <option value="planned">วางแผน</option>
          <option value="ongoing">ดำเนินการ</option>
          <option value="done">เสร็จสิ้น</option>
        </select>
      </div>
      <div class="form-group full">
        <label>ชื่อโครงการ/กิจกรรม <span class="req"> *</span></label>
        <input id="af-name" v-model="f.name" placeholder="เช่น โครงการยกระดับผลสัมฤทธิ์ทางการเรียน" />
      </div>
      <div class="form-group full">
        <label>รายละเอียด</label>
        <textarea id="af-detail" v-model="f.detail" rows="3"></textarea>
      </div>
      <div class="form-group">
        <label>วันเริ่ม</label>
        <ThaiDateField id="af-from" v-model="f.date_from" />
      </div>
      <div class="form-group">
        <label>วันสิ้นสุด</label>
        <ThaiDateField id="af-to" v-model="f.date_to" />
      </div>
      <div class="form-group">
        <label>ผู้รับผิดชอบ</label>
        <input id="af-resp" v-model="f.responsible" placeholder="เช่น กลุ่มนิเทศ ติดตามฯ" />
      </div>
      <div class="form-group">
        <label>งบประมาณ (บาท)</label>
        <input id="af-budget" v-model.number="f.budget" type="number" min="0" step="0.01" />
      </div>
      <div class="form-group full">
        <label>ผลการดำเนินงาน</label>
        <textarea id="af-result" v-model="f.result" rows="3"></textarea>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-outline" :disabled="saving" @click="formOpen = false">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="saving" @click="save">
        {{ saving ? 'กำลังบันทึก...' : '▽ บันทึก' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของระบบเดิมทั้งหมด */
</style>
