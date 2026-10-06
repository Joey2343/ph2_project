<script setup>
/**
 * SchoolSelectModal — เลือกสถานศึกษาที่ต้องการเข้าใช้งาน
 *
 * ย้ายจาก Auth.showSchoolSelect() ใน auth-legacy.js
 * แสดงเมื่อเจ้าหน้าที่สถานศึกษาที่ปฏิบัติงานหลายแห่งเข้าสู่ระบบ
 * หรือกดปุ่ม "สลับสถานศึกษา" ในแถบบน
 */
import { computed } from 'vue';
import AppModal from '../ui/AppModal.vue';
import { useAuthStore } from '../../stores/auth.js';

const store = useAuthStore();
const open = computed(() => store.schoolSelectOpen);
const list = computed(() => store.schoolSelectList);

function choose(school) {
  store.selectSchool(school);
}
</script>

<template>
  <AppModal v-if="open" title="⊕ เลือกสถานศึกษา" size="sm" @close="store.closeSchoolSelect()">
    <div style="text-align: center; padding: 10px 0">
      <div style="font-size: 16px; margin-bottom: 15px; color: #374151">
        ⊕ กรุณาเลือกสถานศึกษาที่ต้องการเข้าใช้งาน
      </div>
      <button
        v-for="(s, idx) in list"
        :key="s"
        class="btn btn-primary"
        style="width: 100%; margin-bottom: 10px; text-align: left; padding: 12px 16px; font-size: 15px"
        @click="choose(s)"
      >
        {{ idx + 1 }}. {{ s }}
      </button>
    </div>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
