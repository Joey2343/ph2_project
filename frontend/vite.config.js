import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

/**
 * การตั้งค่า Vite
 *
 * ในโหมด dev จะใช้ Vite server (พอร์ต 5173) แล้ว proxy ทุกคำขอ /api ไปที่
 * backend (พอร์ต 3000) ทำให้พัฒนาได้เร็วโดยไม่ต้อง build ทุกครั้ง
 *
 * ในโหมด production จะ build ออกมาเป็นโฟลเดอร์ dist/ แล้วให้ Express
 * (backend/server.js) เป็นคนเสิร์ฟไฟล์ static แทน
 */
const BACKEND = process.env.VITE_BACKEND_ORIGIN || 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [vue()],

  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      // API ทั้งหมด
      '/api': { target: BACKEND, changeOrigin: true },
      // ไฟล์ที่ผู้ใช้อัปโหลด
      '/uploads': { target: BACKEND, changeOrigin: true },
      // ฟอนต์ไทยสำหรับเครื่องมือจัดการข้อความ
      '/fonts': { target: BACKEND, changeOrigin: true },
      // รูปครุฑและแบบฟอร์มเอกสารต้นฉบับ
      '/form': { target: BACKEND, changeOrigin: true },
      // โลโก้
      '/logo.png': { target: BACKEND, changeOrigin: true },
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
