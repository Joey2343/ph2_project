<script setup>
/**
 * App — โครงหน้าเว็บทั้งหน้า
 *
 * โครงสร้าง DOM ตรงกับ public/index.html ของระบบเดิมทุกส่วน:
 *   header.topbar > .topbar-inner > .brand + .topbar-right
 *   main#app.app
 *   footer.footer
 *   #modal-root  #toast-root
 *
 * ต่างเพียงว่าส่วนที่ต้อง reactive (สิทธิ์ผู้ใช้, เส้นทาง) ย้ายมาอยู่ใน Vue
 * ส่วนเนื้อหาของแต่ละหน้ายังคงเป็นโค้ดเดิมที่ ViewHost เป็นคนเรียก
 */
import { RouterView } from 'vue-router';
import TopBar from './components/TopBar.vue';
import AuthModals from './components/auth/AuthModals.vue';

/** โลโก้เสิร์ฟโดย backend (เดิมอ้างเป็น "logo.png" ใน index.html) */
const logoSrc = '/logo.png';
</script>

<template>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand" title="กลับหน้าแรก" @click="$router.push('/')">
        <!-- ผูกแบบ dynamic เพื่อไม่ให้ Vite พยายาม bundle ไฟล์นี้
             (logo.png เสิร์ฟโดย backend ที่ /logo.png เหมือนระบบเดิม) -->
        <img class="brand-logo" :src="logoSrc" alt="P2-SMART" />
        <div class="brand-text">
          <div class="brand-title">P2-SMART</div>
          <div class="brand-sub">Online Management System</div>
        </div>
      </div>
      <div class="topbar-right">
        <TopBar />
      </div>
    </div>
  </header>

  <main id="app" class="app">
    <RouterView />
  </main>

  <footer class="footer">
    สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2 &nbsp;•&nbsp; ระบบศูนย์กลางการบริหารจัดการภายในสำนักงาน
  </footer>

  <!-- จุดวาง modal และ toast ของ UI kit (เหมือนระบบเดิม) -->
  <div id="modal-root"></div>
  <div id="toast-root"></div>

  <!-- หน้าต่างเข้าสู่ระบบ: เข้าสู่ระบบ · ลงทะเบียน · โปรไฟล์ · เลือกสถานศึกษา -->
  <AuthModals />
</template>

<style>
/* ไม่เพิ่มสไตล์ใด ๆ — ทุกอย่างมาจาก styles/theme.css (style.css ของระบบเดิม) */
</style>
