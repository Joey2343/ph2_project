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
/* ทุกอย่างมาจาก styles/theme.css (style.css ของระบบเดิม)
   ยกเว้นความกว้างแถบบนด้านล่างซึ่ง override ไว้ที่นี่ */

/* ---- ให้แถบบนกว้างเท่าเนื้อหา ----
 *
 * theme.css กำหนด .topbar-inner = 1200px แต่ .app = 1400px
 * แถบบนจึงกว้างแคบกว่าเนื้อหา 200px ทำให้โลโก้ชิดขวากว่ากล่องนาฬิกา
 * และปุ่มฝั่งขวาชิดซ้ายกว่าขอบเนื้อหา ดูไม่เข้ากัน
 *
 * ค่า 1200px เป็นค่าของระบบเดิม (docs/legacy/source-v1/css/style.css:46)
 * แต่ theme.css ห้ามแก้ เพราะ verify-build เทียบ SHA256 กับไฟล์นั้น
 * จึงต้อง override ที่นี่แทน
 *
 * ⚠️ ต้องเขียนเป็น ".topbar .topbar-inner" ไม่ใช่ ".topbar-inner" เดี่ยว ๆ
 * เพราะ theme.css กับไฟล์นี้มี specificity เท่ากัน (0,1,0)
 * ถ้าใช้ชื่อเดียว ผลจะขึ้นกับว่า CSS ไหนโหลดทีหลัง และมันต่างกันระหว่างสองโหมด
 *   dev  : Vite inject ตามลำดับ import ใน main.js
 *          App.vue อยู่บรรทัด 15 แต่ theme.css อยู่บรรทัด 25
 *          → theme.css ทับกลับ ได้ 1200px
 *   build: แยกเป็นไฟล์ CSS คนละไฟล์ <link> theme มาก่อน main
 *          → 1400px ชนะ
 * การเขียน selector 2 ชั้นทำให้ชนะเสมอไม่ว่าโหมดไหน
 * (0,2,0) > (0,1,0)
 */
.topbar .topbar-inner { max-width: 1400px; }

/* จอแคบ: .app ลด padding จาก 20px เหลือ 12px (theme.css:714)
   ต้องลดขอบแถบบนตามด้วย ไม่งั้นแถบบนจะเว้นขอบมากกว่าเนื้อหา 8px ทั้งสองด้าน */
@media (max-width: 640px) {
  .topbar .topbar-inner { padding: 10px 12px; }
}
</style>
