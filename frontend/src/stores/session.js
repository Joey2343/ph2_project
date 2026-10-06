/**
 * สถานะผู้ใช้ที่ "คงที่" (session) — ใช้ร่วมกันระหว่าง UI kit กับ Pinia store
 *
 * ทำเป็นโมดูลเล็ก ๆ แยกออกมา เพราะ UI kit (ui/ui.js) ต้องอ่านข้อมูลผู้ใช้
 * ในขณะที่ store (stores/auth.js) ต้องเรียก UI เพื่อแสดง toast
 * ถ้าให้สองฝั่ง import กันตรง ๆ จะเกิด circular dependency
 * การแยก state ออกมาตรงนี้จึงทำให้ทั้งสองฝั่ง import ได้โดยไม่ต้องวนกัน
 */
import { reactive, computed } from 'vue';

export const session = reactive({
  user: null,
  loggedIn: false,
  initDone: false,
  simDate: '',
});

/** ผู้ใช้ปัจจุบัน (null = ยังไม่ล็อกอิน) */
export function currentUser() {
  return session.user;
}

export function isLoggedIn() {
  return !!session.loggedIn && !!session.user;
}

export function isAdmin() {
  return isLoggedIn() && session.user.role === 'admin';
}

/** ผู้ใช้ที่มีสิทธิ์อนุมัติ (ได้รับสิทธิ์จากระบบ และมีบทบาทที่อนุมัติได้) */
export function isApproverRole() {
  if (!isLoggedIn()) return false;
  if (isAdmin()) return true;
  return !!session.user.can_approve && !!{ group_head: 1, deputy: 2, director: 3 }[session.user.role];
}

/** เขียนผู้ใช้ลง session (ใช้จาก store เท่านั้น) */
export function setUser(user) {
  session.user = user || null;
  session.loggedIn = !!user;
}

/** callback ที่ store จะลงทะเบียนไว้ เพื่อให้ api layer เรียกได้โดยไม่ต้อง import store */
let sessionExpiredHandler = null;
export function onSessionExpired(fn) {
  sessionExpiredHandler = fn;
}
export function fireSessionExpired() {
  if (sessionExpiredHandler) sessionExpiredHandler();
}

/** ประตูทางเข้าสู่ระบบ — ตั้งค่าครั้งเดียวจาก App.vue */
export const loginGate = { open: null };
export function openLogin() {
  if (loginGate.open) loginGate.open();
}

export const isLoggedInComputed = computed(() => session.loggedIn);
