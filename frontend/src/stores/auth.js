/**
 * Auth — Pinia store ของระบบ (Phase 2: แทนโค้ดเดิมที่สร้าง DOM เอง)
 *
 * โครงสร้างแบ่งเป็น 2 ชั้น:
 *   1. stores/session.js  — สถานะผู้ใช้ (reactive ล้วน ไม่มี logic)
 *      แยกไว้ชั้นเพราะ ui/ui.js ต้องอ่านสถานะนี้ แต่ store นี้ต้องเรียก UI
 *      ถ้าให้สองฝั่ง import กันตรง ๆ จะเกิด circular dependency
 *   2. stores/auth.js (ไฟล์นี้) — logic ทั้งหมด + สถานะว่าหน้าต่างไหนเปิดอยู่
 *
 * คง public API ชื่อเดิมไว้ทั้งหมด (Auth.user, Auth.isLoggedIn(), Auth.openLogin() …)
 * เพื่อให้หน้าอื่นทั้ง 13 หน้า (818 KB ที่ port มา) เรียกใช้ได้โดยไม่ต้องแก้แม้แต่บรรทัดเดียว
 */
import { defineStore } from 'pinia';
import api from '../api/client.js';
import { UI } from '../ui/ui.js';
import { session, setUser, onSessionExpired } from './session.js';

/** ตั้ง callback ให้ api layer เรียกเมื่อ session หมดอายุ */
onSessionExpired(() => {
  Auth.user = null;
  setTimeout(() => Auth.openLogin(), 250);
});

export const useAuthStore = defineStore('auth', {
  state: () => ({
    /** หน้าต่างไหนเปิดอยู่ — App.vue ใช้ค่านี้เป็น v-if */
    loginOpen: false,
    registerOpen: false,
    /** 'select' = เลือกประเภท · 'office' | 'school' = ฟอร์มสมัคร */
    registerStep: 'select',
    profileOpen: false,
    schoolSelectOpen: false,
    schoolSelectList: [],

    /** รายชื่อสถานศึกษา (โหลดครั้งเดียว ใช้ทั้งฟอร์มสมัครและโปรไฟล์) */
    schools: [],
    schoolsLoaded: false,

    /** ปุ่มกำลังทำงาน */
    submitting: false,
    label: '',
  }),

  getters: {
    user: () => session.user,
    loggedIn: () => !!session.user && session.user.status === 'active',
    isAdmin: () => !!session.user && session.user.role === 'admin',
    /** รายชื่อสถานศึกษาที่จับคู่กับ code (label = "code name") */
    schoolOptions: (s) => s.schools.map((x) => (x.code ? x.code + ' ' + x.name : x.name)),
  },

  actions: {
    /* ---------------- session ---------------- */

    /** ดึงข้อมูลผู้ใช้ปัจจุบันตอนบูตแอป */
    async init() {
      try {
        const data = await api.get('/auth/me');
        setUser(data.user);
      } catch (e) {
        /* ยังไม่เข้าสู่ระบบ */
      }
    },

    /**
     * เข้าสู่ระบบ
     * @returns {Promise<'ok'|'need-school'|'fail'>} 'need-school' = เจ้าหน้าที่สถานศึกษาที่มีหลายแห่ง ต้องเลือกก่อน
     */
    async login(username, password) {
      const user = String(username || '').trim();
      const pass = password || '';
      if (!user || !pass) {
        UI.toast('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน', 'error');
        return 'fail';
      }
      const data = await api.post('/auth/login', { username: user, password: pass });
      setUser(data.user);

      // เจ้าหน้าที่สถานศึกษาที่ปฏิบัติงานหลายแห่ง → ให้เลือกสถานศึกษาก่อนเข้าใช้งาน
      if (data.user.user_group === 'school') {
        const all = collectSchools(data.user);
        if (all.length > 1) {
          this.schoolSelectList = all;
          this.schoolSelectOpen = true;
          return 'need-school';
        }
        if (all.length === 1) {
          session.user.current_school = all[0];
          session.user.school_code = (all[0].split(' ')[0] || '').trim();
        }
      }

      afterAuthSuccess(data.user);
      return 'ok';
    },

    /** เลือกสถานศึกษาที่จะใช้ (สำหรับผู้ที่ปฏิบัติงานหลายแห่ง) */
    async selectSchool(school) {
      session.user.current_school = school;
      session.user.school_code = (school.split(' ')[0] || '').trim();
      try {
        await api.post('/auth/select-school', { school });
      } catch (e) {
        /* ignore */
      }
      this.schoolSelectOpen = false;
      this.schoolSelectList = [];
      afterAuthSuccess(session.user);
      UI.toast(`ยินดีต้อนรับคุณ ${session.user.full_name} — ${school}`);
    },

    async logout() {
      const ok = await UI.confirm('ต้องการออกจากระบบ ใช่หรือไม่?', { okText: 'ออกจากระบบ', danger: true });
      if (!ok) return;
      try {
        await api.post('/auth/logout');
      } catch (e) {
        /* ignore */
      }
      setUser(null);
      // ออกจากระบบแล้วไม่ต้อง patch วันที่จำลองต่อ
      if (window.__SIM_DATE) window.__SIM_DATE.refresh();
      goHome();
      UI.toast('ออกจากระบบเรียบร้อย');
    },

    /* ---------------- หน้าต่าง ---------------- */

    openLogin() {
      this.loginOpen = true;
    },
    closeLogin() {
      this.loginOpen = false;
    },
    openRegister() {
      this.registerStep = 'select';
      this.registerOpen = true;
    },
    closeRegister() {
      this.registerOpen = false;
      this.registerStep = 'select';
    },
    openProfile() {
      this.profileOpen = true;
      this.loadSchools();
    },
    closeProfile() {
      this.profileOpen = false;
    },
    openSwitchSchool() {
      const all = collectSchools(session.user);
      if (all.length <= 1) {
        UI.toast('คุณมีสถานศึกษาแห่งเดียว ไม่ต้องสลับ');
        return;
      }
      this.schoolSelectList = all;
      this.schoolSelectOpen = true;
    },
    closeSchoolSelect() {
      this.schoolSelectOpen = false;
      this.schoolSelectList = [];
    },

    /* ---------------- ข้อมูลประกอบฟอร์ม ---------------- */

    /** โหลดรายชื่อสถานศึกษา (เรียกครั้งเดียว แล้วจำไว้) */
    async loadSchools(force) {
      if (this.schoolsLoaded && !force) return this.schoolOptions;
      try {
        const data = await api.get('/schools');
        this.schools = (data.schools || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        this.schoolsLoaded = true;
      } catch (e) {
        this.schools = [];
      }
      return this.schoolOptions;
    },

    /* ---------------- สมัครสมาชิก ---------------- */

    /**
     * ส่งใบสมัคร
     * @param {FormData} form
     */
    async register(form) {
      this.submitting = true;
      try {
        const res = await api.postForm('/auth/register', form);
        this.closeRegister();
        this.loginOpen = true;
        return res;
      } finally {
        this.submitting = false;
      }
    },

    /* ---------------- โปรไฟล์ ---------------- */

    async saveProfile(form) {
      const res = await api.putForm('/auth/profile', form);
      setUser(res.user);
      return res;
    },

    async changePassword(oldPassword, newPassword) {
      return api.post('/auth/change-password', { old_password: oldPassword, new_password: newPassword });
    },

    async testTelegram(token, chatId) {
      return api.post('/auth/profile/test-telegram', { telegram_token: token, telegram_chat_id: chatId });
    },

    /** รายชื่อสถานศึกษาที่ผู้ใช้ปฏิบัติงาน (แห่งหลัก + แห่งรอง) */
    allSchoolsOf(u) {
      return collectSchools(u || session.user);
    },
  },
});

/* ---------------- ฟังก์ชันช่วยเหลือ ---------------- */

/** รวมสถานศึกษาที่ user ปฏิบัติงานทั้งหมด (แห่งหลัก + จาก workplace_secondary) */
function collectSchools(u) {
  if (!u) return [];
  const all = [];
  if (u.workplace) all.push(u.workplace);
  try {
    const extra = JSON.parse(u.workplace_secondary || '[]');
    all.push(...extra);
  } catch (e) {
    /* ไม่ใช่ JSON → ไม่มีสถานศึกษารอง */
  }
  return all.filter((s) => s && String(s).trim());
}

/** หลังเข้าสู่ระบบสำเร็จ — กลับหน้าแรก + ดึงวันที่จำลอง + ข้อความต้อนรับ */
function afterAuthSuccess(user) {
  goHome();
  // ดึงวันที่จำลอง (ถ้าเปิดใช้) มาใช้กับฟอร์ม/ปฏิทินทันที
  if (window.__SIM_DATE) window.__SIM_DATE.refresh();
  UI.toast(`ยินดีต้อนรับคุณ ${user.full_name}`);
}

/** ถ้าอยู่หน้าแรกอยู่แล้ว hash จะไม่เปลี่ยน จึงต้องสั่งวาดหน้าใหม่เอง */
function goHome() {
  const h = window.location.hash;
  if (h === '' || h === '#/' || h === '#') {
    if (window.__P2_NAV_HOME__) window.__P2_NAV_HOME__();
    // vue-router จะไม่วาดใหม่ถ้า route เหมือนเดิม (duplicate navigation ถูกยกเลิก)
    // แต่ระบบเดิมเรียก render() ทุกครั้ง → ต้องสั่งวาดใหม่เอง ไม่งั้นหน้าแรก
    // จะยังคงแสดงเมนูของผู้ที่ยังไม่ล็อกอินอยู่
    if (window.__P2_RERENDER__) window.__P2_RERENDER__();
  } else {
    window.location.hash = '#/';
  }
}

/* ---------------- Facade สำหรับโค้ดเดิม ---------------- */

let _store = null;
/** ดึง store ได้แม้นอกนอก component (หลัง pinia ถูกติดตั้งแล้ว) */
export function authStore() {
  return _store;
}
export function bindAuthStore(store) {
  _store = store;
}

/**
 * Auth — ตัวแทนเดิมที่หน้าอื่นเรียกใช้
 *
 * คงชื่อเมธอดและพฤติกรรมเท่าระบบเดิมทุกตัว เพื่อให้ 13 หน้าที่ port มา
 * เรียกใช้ได้โดยไม่ต้องแก้โค้ด
 */
export const Auth = {
  get user() {
    return session.user;
  },
  set user(v) {
    setUser(v);
  },

  isLoggedIn() {
    return !!session.user && session.user.status === 'active';
  },
  isAdmin() {
    return Auth.isLoggedIn() && session.user.role === 'admin';
  },

  /** รูปโปรไฟล์หรืออักษรย่อ (ใช้โดย TopBar และหน้าที่แสดงรายชื่อ) */
  avatar(user) {
    const u = user || session.user;
    if (!u) return null;
    if (u.photo) {
      return UI.h('img', { className: 'user-avatar', src: '/uploads/' + UI.encodePath(u.photo), alt: u.full_name });
    }
    const initial = (u.full_name || u.username || '?').trim().charAt(0);
    return UI.h('div', { className: 'user-avatar' }, initial);
  },

  /** topbar เป็น Vue component แล้ว อัปเดตเองจาก session.user */
  renderTopbar() {
    /* ดู TopBar.vue */
  },

  onSessionExpired() {
    setUser(null);
    setTimeout(() => Auth.openLogin(), 250);
  },

  isMultiSchool() {
    return collectSchools(session.user).length > 1;
  },

  /* ---- หน้าต่าง (เดิมเปิด modal ด้วย DOM ตอนนี้ Vue คุม state แทน) ---- */
  openLogin() {
    if (_store) _store.openLogin();
  },
  closeLogin() {
    if (_store) _store.closeLogin();
  },
  openRegister() {
    if (_store) _store.openRegister();
  },
  closeRegister() {
    if (_store) _store.closeRegister();
  },
  openProfile() {
    if (_store) _store.openProfile();
  },
  closeProfile() {
    if (_store) _store.closeProfile();
  },
  openSwitchSchool() {
    if (_store) _store.openSwitchSchool();
  },
  showSchoolSelect(schools) {
    if (!_store) return;
    _store.schoolSelectList = schools;
    _store.schoolSelectOpen = true;
  },

  async logout() {
    if (_store) await _store.logout();
  },
};
