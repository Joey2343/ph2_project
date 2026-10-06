<script setup>
/**
 * AuthModals — จุดติดตั้งหน้าต่างทั้งหมดของระบบเข้าสู่ระบบ
 *
 * วางไว้ครั้งเดียวใน App.vue เพื่อให้ Pinia store ควบคุมการเปิด/ปิด
 * ทั้งที่โค้ดเดิม (หน้าต่าง 13 หน้า) เรียกผ่าน Auth.openLogin() / Auth.openProfile() ได้เหมือนเดิม
 */
import LoginModal from './LoginModal.vue';
import RegisterModal from './RegisterModal.vue';
import ProfileModal from './ProfileModal.vue';
import SchoolSelectModal from './SchoolSelectModal.vue';
</script>

<template>
  <LoginModal />
  <RegisterModal />
  <ProfileModal />
  <SchoolSelectModal />
</template>
