/**
 * จุดเริ่มต้นของแอป Vue 3
 *
 * ลำดับการบูต:
 *   1. สร้าง Pinia (เก็บ session ของผู้ใช้)
 *   2. ลงทะเบียน style.css ของระบบเดิม (ไม่แก้แม้แต่บรรทัดเดียว)
 *   3. ติดตั้ง global เดิมไว้บน window เผื่อโค้ดส่วนที่ port มาเรียกใช้
 *   4. ดึงข้อมูลผู้ใช้จาก /api/auth/me ก่อน mount (เหมือน boot() ของระบบเดิม)
 *   5. โหลดฟอนต์จาก /api/fonts เบื้องหลัง
 *   6. mount แอป
 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';

import App from './App.vue';
import router, { installLegacyRouterHooks } from './router/index.js';
import simDate from './composables/simDate.js';

import { UI } from './ui/ui.js';
import api, { setToast } from './api/client.js';
import { Auth, useAuthStore, bindAuthStore } from './stores/auth.js';
import { CONSTANTS } from './constants/index.js';
import { ExportFilterDialog } from './ui/ExportFilter.js';

import './styles/theme.css';
// CSS ของ Leaflet — ระบบเดิมโหลดจาก CDN ใน <head>
// ย้ายมาเป็น dependency ของ npm เพื่อไม่ต้องพึ่งอินเทอร์เน็ตภายนอก
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

// ---- global เดิม (สำหรับโค้ดที่ port มาและสคริปต์ที่ยังอ้างถึงชื่อแบบเดิม) ----
window.UI = UI;
window.API = api;
window.Auth = Auth;
window.CONSTANTS = CONSTANTS;
window.ExportFilterDialog = ExportFilterDialog;
window.__SIM_DATE = simDate;


// api layer ใช้ toast ของ UI เมื่อ session หมดอายุ
setToast((msg, type) => UI.toast(msg, type));

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

// ผูก store เข้ากับตัวแทน Auth เดิม เพื่อให้โค้ดหน้าทั้ง 13 หน้าเรียก Auth.openLogin()
// หรือ Auth.logout() ได้เหมือนเดิม แต่สถานะถูกคุมด้วย Vue/Pinia จริง ๆ
const auth = useAuthStore(pinia);
bindAuthStore(auth);

// โค้ดรุ่นเดิมเรียก go() / render() — ผูกให้เป็น vue-router
installLegacyRouterHooks((path) => router.push(path));

// เปิดให้ตรวจสอบสถานะเส้นทางจากคอนโซล/สคริปต์ทดสอบได้
window.__P2_ROUTER__ = router;

/**
 * โหลดฟอนต์จากโฟลเดอร์ font/ — สร้าง @font-face ให้ทุกไฟล์ + เก็บรายชื่อฟอนต์
 * ไว้ใน window.APP_FONT_LABELS เพื่อใช้ในเครื่องมือเลือกฟอนต์ (เช่น บันทึกข้อความ)
 */
async function ensureAppFonts() {
  if (window.APP_FONTS_LOADED) return;
  window.APP_FONTS_LOADED = true;
  try {
    const d = await api.get('/fonts');
    const fonts = d.fonts || [];
    const css = fonts
      .flatMap((f) =>
        f.files.map(
          (fl) =>
            `@font-face{font-family:'${f.family}';src:url('/fonts/${encodeURIComponent(fl.file)}');font-weight:${fl.weight};font-style:${fl.style};}`,
        ),
      )
      .join('\n');
    if (css) {
      const st = document.createElement('style');
      st.id = 'app-fonts-css';
      st.textContent = css;
      document.head.append(st);
    }
    window.APP_FONT_LABELS = fonts.map((f) => f.family);
  } catch (e) {
    window.APP_FONT_LABELS = window.APP_FONT_LABELS || [];
  }
}

/** ดึงข้อมูลผู้ใช้ก่อน mount (เหมือน boot() ของระบบเดิม) แล้วจึงแสดงแถบบนให้ถูกต้อง */
async function boot() {
  await auth.init();
  simDate.refresh(); // โหลดฟอนต์พื้นหลัง (ไม่บล็อกหน้าแรก)
  ensureAppFonts();
  app.mount('#app');
  simDate.refresh();

  // เปิดระบบมาแล้วยังไม่ได้ล็อกอิน → ให้หน้าต่างเข้าสู่ระบบแสดงขึ้นทันที
  // ต้องเช็คหลัง init() เสร็จ ไม่งั้นจะเปิดทั้งที่ยังมี session อยู่
  // ผู้ที่ยังไม่ล็อกอินยังกด ✕ / ยกเลิก เพื่อดูหน้าสาธารณะ (#/office, #/schools) ได้ตามปกติ
  if (!auth.loggedIn) auth.openLogin();
}

boot();
