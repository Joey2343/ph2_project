<script setup>
/**
 * LeaveBalance — แท็บ "วันลาพักผ่อนสะสม"
 *
 * ย้ายจาก loadBalance() + editBalance() ใน LeaveView.js
 *
 * เห็นได้เฉพาะ admin และผู้ตรวจสอบ (ขั้นที่ 1) เท่านั้น
 */
import { ref, computed, onMounted } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import AppModal from './AppModal.vue';

const props = defineProps({
  /** true = ผู้ใช้มีสิทธิ์แก้ไข (admin หรือผู้ตรวจสอบ) */
  canEdit: { type: Boolean, default: false },
});

const emit = defineEmits(['changed']);

const loading = ref(true);
const error = ref('');
const year = ref('');
const balances = ref([]);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await api.get('/leave-balances');
    year.value = data.year;
    balances.value = data.balances || [];
  } catch (e) {
    error.value = e.message;
    balances.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(load);

/* ---------- แก้ไข ---------- */
const editOpen = ref(false);
const editSaving = ref(false);
const editRow = ref(null);
const editForm = ref({ accumulated: 0, annual: 0 });

function openEdit(r) {
  editRow.value = r;
  editForm.value = { accumulated: Number(r.accumulated) || 0, annual: Number(r.annual) || 0 };
  editOpen.value = true;
}

async function save() {
  editSaving.value = true;
  try {
    const res = await api.put(`/leave-balances/${editRow.value.id}`, {
      year,
      vacation_accumulated: editForm.value.accumulated,
      vacation_annual: editForm.value.annual,
    });
    UI.toast(res.message);
    editOpen.value = false;
    await load();
    emit('changed');
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    editSaving.value = false;
  }
}

/** สีของจำนวนวันคงเหลือ: เหลือน้อยเตือน, ไม่เหลือเตือนแดง */
function remainColor(v) {
  if (v <= 0) return '#dc2626';
  if (v <= 3) return '#f59e0b';
  return '#059669';
}
</script>

<template>
  <div>
    <div class="card-title">◷ วันลาพักผ่อนสะสม ปี {{ year }} ({{ balances.length }} คน)</div>

    <div v-if="loading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
    <div v-else-if="error" class="empty-state"><span class="em">⚠️</span>{{ error }}</div>
    <div v-else-if="balances.length === 0" class="empty-state">
      <span class="em">👤</span>ยังไม่มีข้อมูลบุคลากร
    </div>

    <div v-else class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>ชื่อบุคลากร</th>
            <th>สังกัด/กลุ่มงาน</th>
            <th class="num">วันลาพักผ่อนสะสม</th>
            <th class="num">วันลาพักผ่อนประจำปี</th>
            <th class="num">รวมวันลาปีนี้</th>
            <th class="num">ลาปีนี้</th>
            <th class="num">เหลือวันลา</th>
            <th v-if="canEdit"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in balances" :key="r.id">
            <td>
              <div>{{ UI.personName(r) }}</div>
              <div class="hint">{{ r.position || '' }}</div>
            </td>
            <td>{{ r.workplace || '-' }}</td>
            <td class="num">
              <span style="font-weight: 700; color: #2563eb">{{ r.accumulated }} วัน</span>
            </td>
            <td class="num">
              <span style="font-weight: 700; color: #7c3aed">{{ r.annual }} วัน</span>
            </td>
            <td class="num">
              <span style="font-weight: 800; color: #059669">{{ r.total }} วัน</span>
            </td>
            <td class="num">
              <span style="font-weight: 700; color: #dc2626">{{ r.used }} วัน</span>
            </td>
            <td class="num">
              <span :style="{ fontWeight: 800, color: remainColor(r.remaining), fontSize: '14px' }">
                {{ r.remaining }} วัน
              </span>
            </td>
            <td v-if="canEdit">
              <button class="btn btn-xs btn-outline" @click="openEdit(r)">✎</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ---------- แก้ไขสิทธิ์วันลา ---------- -->
    <AppModal
      v-if="editOpen"
      :title="'✎ แก้ไขวันลาพักผ่อนสะสม — ปีงบประมาณ ' + year"
      footer
      @close="editOpen = false"
    >
      <div class="form-grid">
        <div class="form-group full">
          <label>บุคลากร</label>
          <div style="font-weight: 700">
            {{ UI.personName(editRow) }} — {{ editRow.position || '' }}
            ({{ editRow.workplace || '-' }})
          </div>
        </div>
        <div class="form-group">
          <label>วันลาพักผ่อนสะสม (วัน)<span class="req"> *</span></label>
          <input v-model.number="editForm.accumulated" type="number" min="0" />
        </div>
        <div class="form-group">
          <label>วันลาพักผ่อนประจำปี (วัน)<span class="req"> *</span></label>
          <input v-model.number="editForm.annual" type="number" min="0" />
        </div>
        <div class="form-group full" style="margin-top: -6px">
          <div class="hint">
            ข้อมูลแยกเก็บเป็นรายปีงบประมาณ — การบันทึกจะเป็นของปีงบประมาณ {{ year }} เท่านั้น
            ไม่กระทบข้อมูลของปีงบประมาณอื่น
          </div>
        </div>
      </div>

      <template #footer>
        <button class="btn btn-outline" :disabled="editSaving" @click="editOpen = false">ยกเลิก</button>
        <button class="btn btn-primary" :disabled="editSaving" @click="save">
          {{ editSaving ? 'กำลังบันทึก…' : '▽ บันทึก' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
