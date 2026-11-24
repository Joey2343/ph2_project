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

        <!-- ผู้ใช้สั่ง 24 พ.ย. 2569: โลโก้ สพป.แพร่ เขต 2 + ลิงก์เว็บไซต์หลัก
             อยู่ในกลุ่มเดียวกับโลโก้ P2-SMART · กดแล้วเปิดแท็บใหม่ -->
        <a
          id="brand-main-site"
          class="brand-ext"
          href="https://www.phrae2.go.th/"
          target="_blank"
          rel="noopener noreferrer"
          title="เว็บไซต์หลัก สพป.แพร่ เขต 2"
          @click.stop
        >
          <img class="brand-ext-logo" src="/phrae2-logo.png" alt="สพป.แพร่ เขต 2" />
          <span class="brand-ext-text">
            <span class="brand-ext-domain">phrae2.go.th</span>
            <span class="brand-ext-sub">เว็บไซต์หลัก สพป.แพร่ เขต 2</span>
          </span>
        </a>
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
    สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2 &nbsp;•&nbsp; ระบบริหารจัดการสำนักงานออนไลน์
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

/*
 * โลโก้ สพป.แพร่ เขต 2 + ลิงก์เว็บไซต์หลัก (ผู้ใช้สั่ง 24 พ.ย. 2569)
 *   อยู่ในกลุ่มเดียวกับโลโก้ P2-SMART (หลังข้อความ P2-SMART) มีเส้นคั่นบาง ๆ
 *   กดแล้วเปิดแท็บใหม่ไปที่ https://www.phrae2.go.th/
 */
.brand-ext {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 4px;
  padding-left: 14px;
  border-left: 1px solid rgba(255, 255, 255, 0.45);
  text-decoration: none;
  color: #fff;
  cursor: pointer;
}
.brand-ext:hover .brand-ext-domain { text-decoration: underline; }
.brand-ext-logo {
  width: 44px;
  height: 44px;
  object-fit: contain;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.45);
  border-radius: 12px;
  padding: 3px;
  display: block;
}
.brand-ext-text { display: flex; flex-direction: column; line-height: 1.2; }
.brand-ext-domain { font-size: 15px; font-weight: 800; letter-spacing: 0.2px; }
.brand-ext-sub { font-size: 12px; opacity: 0.9; }

/* จอแคบ: ซ่อนบรรทัดรอง เหลือชื่อเว็บไซต์ + โลโก้ */
@media (max-width: 860px) {
  .brand-ext-sub { display: none; }
  .brand-ext-logo { width: 36px; height: 36px; }
  .brand-ext { padding-left: 10px; }
}
@media (max-width: 520px) {
  .brand-ext-text { display: none; }
}

/* จอแคบ: .app ลด padding จาก 20px เหลือ 12px (theme.css:714)
   ต้องลดขอบแถบบนตามด้วย ไม่งั้นแถบบนจะเว้นขอบมากกว่าเนื้อหา 8px ทั้งสองด้าน */
@media (max-width: 640px) {
  .topbar .topbar-inner { padding: 10px 12px; }
}
</style>
