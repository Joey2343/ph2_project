/**
 * ตัวช่วยขอตำแหน่ง GPS สำหรับ "ลงเวลาทำงาน"
 *
 * ทำไมต้องแยกไฟล์
 * ──────────────
 * การลงเวลาต้องตรวจตำแหน่งด้วย GPS ของอุปกรณ์ทุกเครื่อง (ไม่ตรวจ IP แล้ว)
 * และมี 2 จุดที่ลงเวลาได้ คือหน้า #/clock และการ์ดลงเวลาหน้าแรก
 * ถ้าเขียนซ้ำ 2 ที่ วันหนึ่งแก้ที่เดียวแล้วอีกที่ลืม → หน้าแรกจะลงเวลาไม่ได้
 * (เช่น ส่ง payload ไม่มี lat/lng → เซิร์ฟเวอร์ตอบ 400)
 *
 * ⚠️ `<script setup>` export ค่าคงที่ข้าม component ไม่ได้ → ต้องอยู่ใน src/lib/
 */

/**
 * ขอตำแหน่งปัจจุบันจาก GPS ของอุปกรณ์
 *
 * ระยะเวลารอ 15 วินาที เพราะคอมพิวเตอร์ในอาคารที่ใช้ WiFi หาตำแหน่งได้ช้ากว่ามือถือ
 * maximumAge 30 วินาที — กดซ้ำเร็ว ๆ ไม่ต้องรอหาตำแหน่งใหม่
 *
 * @returns {Promise<GeolocationPosition>}
 */
export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('NO_GEO'));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000,
    });
  });
}

/** ข้อความแจ้งเตือนตามสาเหตุที่ระบุตำแหน่งไม่ได้ (ตามของเดิมทุกกรณี) */
export function geoErrorMessage(e) {
  const code = e && e.code;
  if (e && e.message === 'NO_GEO') return 'เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง GPS';
  if (code === 1) return 'คุณไม่อนุญาตให้ระบบใช้ตำแหน่ง GPS — กรุณาอนุญาตตำแหน่งในเบราว์เซอร์';
  if (code === 2) return 'ไม่สามารถระบุตำแหน่ง GPS ได้ (สัญญาณดาวเทียมไม่ดี) — กรุณาลองใหม่';
  if (code === 3) return 'การระบุตำแหน่งใช้เวลานานเกินไป — กรุณาลองใหม่';
  return 'ไม่สามารถระบุตำแหน่ง GPS ได้ — กรุณาลองใหม่';
}
