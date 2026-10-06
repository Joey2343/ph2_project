<script setup>
/**
 * StaffDetailModal — ดูข้อมูลเจ้าหน้าที่แบบเต็ม
 *
 * ย้ายจาก StaffView.openDetail()
 *
 * ดึงข้อมูลเต็มจาก /staff/:id เพราะรายการในตารางไม่มีทุกฟิลด์
 * (เช่น เลขบัตรประชาชน, วุฒิการศึกษา, telegram)
 */
import { ref, computed, onMounted } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import { CONSTANTS } from '../../constants/index.js';
import AppModal from './AppModal.vue';
import StatusBadge from './StatusBadge.vue';

const props = defineProps({
  staff: { type: Object, required: true },
});

const emit = defineEmits(['close']);

const loading = ref(true);
const error = ref('');
const full = ref(null);

onMounted(async () => {
  try {
    full.value = (await api.get('/staff/' + props.staff.id)).user;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});

/** รายการข้อมูลที่แสดงเป็นช่อง ๆ ตามฟอร์มเดิม */
const FIELDS = computed(() => {
  const u = full.value;
  if (!u) return [];
  return [
    { label: 'เลขบัตรประชาชน', value: u.citizen_id || '-' },
    { label: 'ลำดับเจ้าหน้าที่', value: u.staff_no || '-' },
    { label: 'ชื่อเล่น', value: u.nickname || '-' },
    { label: 'กรุ๊ปเลือด', value: u.blood_type || '-' },
    { label: 'ตำแหน่ง', value: u.position || '-' },
    { label: 'วิทยฐานะ/ระดับ', value: u.academic_rank || '-' },
    { label: 'กลุ่มงาน', value: u.workplace || '-' },
    { label: 'วุฒิการศึกษาสูงสุด', value: u.highest_education || '-' },
    {
      label: 'วัน/เดือน/ปี เกิด',
      value: u.birth_date
        ? UI.thaiDate(u.birth_date) + (UI.ageFromBirth(u.birth_date) ? ' (อายุ ' + UI.ageFromBirth(u.birth_date) + ' ปี)' : '')
        : '-',
    },
    { label: 'โทรศัพท์', value: u.phone || '-' },
    { label: 'อีเมล', value: u.email || '-' },
    { label: 'Telegram Chat ID', value: u.telegram_chat_id ? '@' + u.telegram_chat_id : '-' },
    { label: 'สมัครเมื่อ', value: UI.date(u.created_at) },
    { label: 'อนุมัติเมื่อ', value: u.approved_at ? UI.date(u.approved_at) : '-' },
  ];
});
</script>

<template>
  <AppModal title="👁️ ข้อมูลเจ้าหน้าที่" size="lg" footer @close="emit('close')">
    <div v-if="loading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
    <div v-else-if="error" class="empty-state"><span class="em">⚠️</span>{{ error }}</div>

    <template v-else-if="full">
      <!-- ---------- หัวข้อ ---------- -->
      <div style="display: flex; gap: 16px; align-items: center; margin-bottom: 14px; flex-wrap: wrap">
        <img
          v-if="full.photo"
          class="profile-photo"
          :src="'/uploads/' + UI.encodePath(full.photo)"
          alt=""
        />
        <div
          v-else
          class="profile-photo"
          style="display: grid; place-items: center; font-size: 32px; background: var(--primary-light); color: var(--primary-deep)"
        >
          {{ (full.first_name || full.full_name || '?').charAt(0) }}
        </div>
        <div>
          <div style="font-size: 18px; font-weight: 800">{{ UI.personName(full) }}</div>
          <div class="hint">@{{ full.username }} • {{ CONSTANTS.roleLabel(full.role) }}</div>
          <div style="margin-top: 4px; display: flex; gap: 6px; flex-wrap: wrap">
            <StatusBadge :status="full.status" />
            <span v-if="full.can_approve" class="badge badge-active">● มีสิทธิ์อนุมัติ</span>
          </div>
        </div>
      </div>

      <!-- ---------- ข้อมูล ---------- -->
      <div class="form-grid">
        <div v-for="f in FIELDS" :key="f.label" class="form-group">
          <label>{{ f.label }}</label>
          <div>{{ f.value }}</div>
        </div>

        <div class="form-group full">
          <label>ลายเซ็น</label>
          <img
            v-if="full.signature"
            class="signature-img"
            :src="'/uploads/' + UI.encodePath(full.signature)"
            alt="ลายเซ็น"
          />
          <span v-else class="hint">-</span>
        </div>
      </div>
    </template>

    <template #footer>
      <button class="btn btn-outline" @click="emit('close')">ปิด</button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
