/**
 * pdf.js (pdfjs-dist) พร้อม worker ที่ Vite bundle ให้
 *
 * ระบบเดิมโหลด pdf.min.js + pdf.worker.min.js จากโฟลเดอร์ vendor/ บน server
 * รุ่นนี้ย้ายมาเป็น dependency ของ npm และให้ Vite จัดการ worker ให้
 * ผลลัพธ์เหมือนเดิมทุกประการ แต่ไม่ต้องพึ่งไฟล์ static ฝั่ง server อีกต่อไป
 */
import * as pdfjsLib from 'pdfjs-dist';
// ?url = ให้ Vite copy ไฟล์นี้ออกมาเป็น asset แล้วคืน URL ที่ถูกต้องทั้ง dev และ build
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export { pdfjsLib, pdfWorkerUrl };
