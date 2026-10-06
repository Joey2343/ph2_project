<script setup>
/**
 * แถบบน (topbar) — ย้ายจาก Auth.renderTopbar() ในระบบเดิมมาเป็น Vue component
 *
 * markup, class name และข้อความทุกตัวอักษรตรงกับที่ระบบเดิมสร้างด้วย UI.h()
 * ต่างเพียงว่าตอนนี้ Vue คำนวณเองจาก session.user ทำให้ login/logout
 * อัปเดตทันทีโดยไม่ต้องเรียก renderTopbar() ด้วยมือ
 */
import { computed } from 'vue';
import { session } from '../stores/session.js';
import { Auth } from '../stores/auth.js';

const loggedIn = computed(() => Auth.isLoggedIn());
const u = computed(() => session.user);

/** ชีวประวัติสั้น ๆ ตามตรงกับ renderTopbar() ของระบบเดิม */
const roleLine = computed(() => {
  const x = u.value;
  if (!x) return '';
  return x.user_group === 'school'
    ? (x.current_school || x.workplace || '') + (x.position ? ' • ' + x.position : '')
    : (x.role_label || (x.role === 'admin' ? 'ผู้ดูแลระบบ' : 'สมาชิก')) + (x.position ? ' • ' + x.position : '');
});

/** รูปโปรไฟล์ หรือ อักษรย่อตัวแรก (เหมือน Auth.avatar()) */
const avatar = computed(() => {
  const x = u.value;
  if (!x) return null;
  if (x.photo) {
    return { kind: 'img', src: '/uploads/' + encodeURIComponent(x.photo), alt: x.full_name };
  }
  return { kind: 'initial', text: (x.full_name || x.username || '?').trim().charAt(0) };
});

const multiSchool = computed(() => Auth.isMultiSchool());
</script>

<template>
  <!-- ยังไม่เข้าสู่ระบบ -->
  <template v-if="!loggedIn">
    <button class="btn btn-white" @click="Auth.openLogin()">🔑 เข้าสู่ระบบ</button>
    <button class="btn btn-accent" @click="Auth.openRegister()">📝 ลงทะเบียน</button>
  </template>

  <!-- เข้าสู่ระบบแล้ว -->
  <template v-else>
    <div class="user-chip" style="cursor: pointer" @click="Auth.openProfile()">
      <img v-if="avatar.kind === 'img'" class="user-avatar" :src="avatar.src" :alt="avatar.alt" />
      <div v-else class="user-avatar">{{ avatar.text }}</div>
      <div>
        <div class="user-name">{{ u.full_name }}</div>
        <div class="user-role">{{ roleLine }}</div>
      </div>
    </div>

    <button
      v-if="multiSchool"
      class="btn btn-white btn-sm"
      title="สลับสถานศึกษา"
      style="margin-right: 6px"
      @click="Auth.openSwitchSchool()"
    >
      🔄 สลับสถานศึกษา
    </button>

    <button class="btn btn-white btn-sm" title="ออกจากระบบ" @click="Auth.logout()">⎋ ออกจากระบบ</button>
  </template>
</template>

<style scoped>
/* ไม่เพิ่มสไตล์ — ใช้ .topbar-right / .user-chip / .user-avatar / .user-name / .user-role
   จาก style.css ของระบบเดิมทั้งหมด */
</style>
