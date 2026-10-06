<script setup>
/**
 * AccessDenied — หน้าแจ้งว่าไม่มีสิทธิ์เข้าถึงเมนู
 *
 * ย้ายจาก accessDenied() ใน router/accessDenied.js มาเป็น Vue component
 * markup ตรงกับของเดิมทุกส่วน
 */
import { computed } from 'vue';
import { Auth } from '../stores/auth.js';
import { getMenu } from '../router/menus.js';

const props = defineProps({
  /** key ของเมนูที่พยายามเข้า */
  viewKey: { type: String, default: '' },
});

const menu = computed(() => getMenu(props.viewKey) || { icon: '☀', title: 'หน้านี้' });
const loggedIn = computed(() => Auth.isLoggedIn());

function goHome() {
  window.location.hash = '#/';
}
</script>

<template>
  <div class="card">
    <div style="text-align: center; padding: 50px 20px">
      <div style="font-size: 56px; margin-bottom: 10px">🔒</div>
      <h2 style="margin-bottom: 6px">ไม่สามารถเข้าถึงเมนู "{{ menu.title }}" ได้</h2>
      <p style="color: var(--muted); margin-bottom: 20px">
        {{
          loggedIn
            ? 'เมนูนี้สงวนไว้สำหรับผู้ดูแลระบบเท่านั้น'
            : 'เมนูนี้สำหรับสมาชิกของระบบเท่านั้น กรุณาเข้าสู่ระบบก่อนใช้งาน'
        }}
      </p>
      <div v-if="!loggedIn" style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap">
        <button class="btn btn-primary" @click="Auth.openLogin()">🔑 เข้าสู่ระบบ</button>
        <button class="btn btn-outline" @click="goHome">← กลับหน้าแรก</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
