'use strict';
/* Wrapper สำหรับเรียก API backend พร้อมจัดการ session และ error */

const API = {
  async request(method, url, body, isForm) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      if (isForm) opts.body = body;
      else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    }
    let res;
    try {
      res = await fetch('/api' + url, opts);
    } catch (e) {
      throw new Error('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }

    if (res.status === 401) {
      // session หมดอายุหรือยังไม่ได้เข้าสู่ระบบ
      if (!url.startsWith('/auth/')) {
        UI.toast(data && data.error ? data.error : 'กรุณาเข้าสู่ระบบก่อนใช้งาน', 'error');
        Auth.onSessionExpired();
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

  get: (url) => API.request('GET', url),
  post: (url, body) => API.request('POST', url, body || {}),
  postForm: (url, formData) => API.request('POST', url, formData, true),
  put: (url, body) => API.request('PUT', url, body || {}),
  putForm: (url, formData) => API.request('PUT', url, formData, true),
  del: (url) => API.request('DELETE', url),
};
