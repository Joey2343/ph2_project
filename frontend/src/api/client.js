/**
 * Wrapper สำหรับเรียก API backend พร้อมจัดการ session และ error
 *
 * port จาก public/js/api.js ของระบบเดิม โดยเปลี่ยนเรียก UI/Auth ให้เข้าผ่าน
 * stores/session.js (ดูคำอธิบายที่ไฟล์นั้นว่าทำไมต้องแยก)
 */
import { fireSessionExpired } from '../stores/session.js';

/** ให้ UI kit ลงทะเบียนฟังก์ชัน toast ไว้ (stores/ui.js จะเป็นคนติดตั้ง) */
let toastFn = null;
export function setToast(fn) {
  toastFn = fn;
}

const api = {
  async request(method, url, body, isForm) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      if (isForm) opts.body = body;
      else {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
    }
    let res;
    try {
      res = await fetch('/api' + url, opts);
    } catch (e) {
      throw new Error('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ');
    }
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* ignore */
    }

    if (res.status === 401) {
      // session หมดอายุหรือยังไม่ได้เข้าสู่ระบบ
      if (!url.startsWith('/auth/')) {
        if (toastFn) toastFn(data && data.error ? data.error : 'กรุณาเข้าสู่ระบบก่อนใช้งาน', 'error');
        fireSessionExpired();
      }
      const err = new Error((data && data.error) || 'unauthorized');
      err.status = 401;
      throw err;
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'เกิดข้อผิดพลาดในการประมวลผล');
      err.status = res.status;
      throw err;
    }
    return data;
  },

  get: (url) => api.request('GET', url),
  post: (url, body) => api.request('POST', url, body || {}),
  postForm: (url, formData) => api.request('POST', url, formData, true),
  put: (url, body) => api.request('PUT', url, body || {}),
  putForm: (url, formData) => api.request('PUT', url, formData, true),
  del: (url) => api.request('DELETE', url),
};

export default api;
