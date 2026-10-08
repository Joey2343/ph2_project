import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

/**
 * การตั้งค่า Vite
 *
 * ในโหมด dev จะใช้ Vite server (พอร์ต 5173) แล้ว proxy คำขอ /api และ /uploads
 * ไปที่ backend (พอร์ต 3000) ทำให้พัฒนาได้เร็วโดยไม่ต้อง build ทุกครั้ง
 *
 * ในโหมด production จะ build ออกมาเป็นโฟลเดอร์ dist/ แล้วให้เว็บเซิร์ฟเวอร์
 * (Apache บน DirectAdmin หรือ Express) เป็นคนเสิร์ฟไฟล์ static แทน
 *
 * /logo.png, /form/* และ /fonts/* ไม่ต้อง proxy เพราะอยู่ใน public/ แล้ว
 * Vite จะ copy ไฟล์พวกนั้นไปที่ dist/ แบบไม่ตัดชื่อ ทำให้ URL เดิมใช้ได้
 * ทั้งตอน dev และ production (ถ้ายัง proxy ไป backend จะได้ 404 เพราะไฟล์ย้ายแล้ว)
 *
 * /uploads ยังต้อง proxy เพราะเป็นไฟล์ที่ผู้ใช้อัปโหลดระหว่างใช้งาน
 * อยู่ที่ backend/public/uploads/ ซึ่งไม่ได้อยู่ใน git
 */
const BACKEND = process.env.VITE_BACKEND_ORIGIN || 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [vue()],

  // โฟลเดอร์ไฟล์ static ที่ต้องการแสดงผลตามชื่อเดิม (ไม่มี hash)
  // ค่า default ของ Vite คือ 'public' — เขียนไว้ชัดเพื่อไม่ให้สับสน
  publicDir: 'public',

  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      // API ทั้งหมด
      '/api': { target: BACKEND, changeOrigin: true },
      // ไฟล์ที่ผู้ใช้อัปโหลด
      '/uploads': { target: BACKEND, changeOrigin: true },
    },
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // หน้าเว็บ 2 หน้า: หน้าหลัก + หน้าลงนามในร่างเอกสาร (เปิดเป็น popup)
      input: {
        main: resolve(__dirname, 'index.html'),
        'sign-editor': resolve(__dirname, 'sign-editor.html'),
      },
      output: {
        manualChunks: {
          'vendor-pdf': ['pdfjs-dist', 'pdf-lib'],
          'vendor-map': ['leaflet', 'leaflet.markercluster'],
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
        },
      },
    },
    chunkSizeWarningLimit: 1500,
  },
});
