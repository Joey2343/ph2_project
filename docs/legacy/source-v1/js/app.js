'use strict';
/* Router + เมนูหลัก + สิทธิ์การเข้าถึง */

const MENUS = [
  { key: 'office', icon: '⊞', title: 'ข้อมูลพื้นฐาน สพป.แพร่ เขต 2', desc: 'ประวัติ วิสัยทัศน์ โครงสร้าง และการติดต่อ', grad: 'linear-gradient(135deg,#0f766e,#14b8a6)', pub: true },
  { key: 'schools', icon: '⊙', title: 'พิกัดโรงเรียนในสังกัด', desc: 'แผนที่และข้อมูลโรงเรียนในสังกัด', grad: 'linear-gradient(135deg,#1d4ed8,#3b82f6)', pub: true },
  { key: 'documents', icon: '✉', title: 'หนังสือราชการ', desc: 'ทะเบียนหนังสือราชการรับ-ส่ง', grad: 'linear-gradient(135deg,#92400e,#d97706)', member: true },
  { key: 'clock', icon: '◷', title: 'ลงเวลาทำงาน', desc: 'ลงเวลาเข้างาน-ออกงานประจำวัน', grad: 'linear-gradient(135deg,#b45309,#f59e0b)', member: true, hideFromGrid: true },
  { key: 'vehicles', icon: '🚐', title: 'จองยานพาหนะ', desc: 'ขอใช้ยานพาหนะของทางราชการ', grad: 'linear-gradient(135deg,#15803d,#22c55e)', member: true },
  { key: 'rooms', icon: '⌂', title: 'จองห้องประชุม', desc: 'จองห้องประชุมสำหรับการประชุมและอบรม', grad: 'linear-gradient(135deg,#7c3aed,#a78bfa)', member: true },
  { key: 'memos', icon: '✎', title: 'บันทึกข้อความ', desc: 'จัดทำและส่งบันทึกข้อความภายในหน่วยงาน', grad: 'linear-gradient(135deg,#475569,#94a3b8)', member: true },
  { key: 'travel', icon: '✈', title: 'ขออนุญาตไปราชการ', desc: 'ยื่นคำขอเดินทางไปราชการ (เจ้าหน้าที่ สพป.แพร่ เขต 2)', grad: 'linear-gradient(135deg,#be123c,#f43f5e)', member: true },
  { key: 'travel-school', icon: '✈', title: 'ขออนุญาตไปราชการ (สถานศึกษา)', desc: 'ยื่นคำขอเดินทางไปราชการ (เจ้าหน้าที่สถานศึกษา)', grad: 'linear-gradient(135deg,#9f1239,#fb7185)', member: true },
  { key: 'leave', icon: '☀', title: 'ขออนุญาตลา', desc: 'ยื่นคำขอลาประเภทต่าง ๆ', grad: 'linear-gradient(135deg,#ea580c,#fb923c)', member: true },
  { key: 'budgets', icon: '฿', title: 'บริหารงบประมาณ', desc: 'แผนงบประมาณและการใช้จ่าย', grad: 'linear-gradient(135deg,#047857,#10b981)', member: true },
  { key: 'academic', icon: '📖', title: 'บริหารงานวิชาการ', desc: 'โครงการและกิจกรรมทางวิชาการ', grad: 'linear-gradient(135deg,#4338ca,#6366f1)', member: true },
  { key: 'staff', icon: '☺', title: 'เจ้าหน้าที่ในระบบ', desc: 'จัดการสมาชิกและอนุมัติการสมัคร', grad: 'linear-gradient(135deg,#0891b2,#06b6d4)', member: true, adminOnly: true },
];

const ROUTES = {
  home: HomeView,
  office: OfficeView,
  schools: SchoolsView,
  clock: ClockView,
  vehicles: VehiclesView,
  rooms: RoomsView,
  memos: MemosView,
  travel: TravelView,
  'travel-school': TravelView,
  leave: LeaveView,
  documents: DocumentsView,
  budgets: BudgetsView,
  academic: AcademicsView,
  staff: StaffView,
};

function getMenu(key) {
  return MENUS.find((m) => m.key === key);
}

/* เมนูที่เจ้าหน้าที่สถานศึกษาเข้าถึงได้ (นอกเหนือจาก pub) */
const SCHOOL_ALLOWED = ['documents'];
const SCHOOL_DIRECTOR_ALLOWED = ['travel', 'travel-school', 'leave'];

function canAccess(key) {
  const menu = getMenu(key);
  if (!menu) return false;
  if (menu.pub) return true;
  if (!Auth.isLoggedIn()) return false;
  if (menu.adminOnly && !Auth.isAdmin()) return false;
  // เจ้าหน้าที่สถานศึกษา: เข้าได้เฉพาะ pub + SCHOOL_ALLOWED
  // ผู้อำนวยการสถานศึกษา: เข้าได้เพิ่ม travel, leave
  if (Auth.user && Auth.user.user_group === 'school') {
    if (menu.pub) return true;
    // หน้าของ สพป. — เจ้าหน้าที่สถานศึกษาใช้หน้า travel-school แทน
    if (key === 'travel') return false;
    if (SCHOOL_ALLOWED.includes(key)) return true;
    // ผู้อำนวยการสถานศึกษา: เข้า travel-school, leave ได้
    var pos = Auth.user.position || '';
    if (SCHOOL_DIRECTOR_ALLOWED.includes(key) && pos.indexOf('ผู้อำนวยการสถานศึกษา') !== -1) return true;
    return false;
  }
  // หน้าของสถานศึกษา (travel-school) — เจ้าหน้าที่สถานศึกษา, admin และผู้ตรวจสอบ (ขั้นที่ 1) สายสถานศึกษาเท่านั้น (เจ้าหน้าที่ สพป. ทั่วไปเข้าไม่ได้)
  if (key === 'travel-school' && Auth.user.role !== 'admin' && !Auth.user.is_school_travel_approver) return false;
  return true;
}

function accessDenied(key) {
  const menu = getMenu(key) || { icon: '☀', title: 'หน้านี้' };
  const body = UI.h('div', { style: { textAlign: 'center', padding: '50px 20px' } },
    UI.h('div', { style: { fontSize: '56px', marginBottom: '10px' } }, '🔒'),
    UI.h('h2', { style: { marginBottom: '6px' } }, `ไม่สามารถเข้าถึงเมนู "${menu.title}" ได้`),
    UI.h('p', { style: { color: 'var(--muted)', marginBottom: '20px' } },
      Auth.isLoggedIn()
        ? 'เมนูนี้สงวนไว้สำหรับผู้ดูแลระบบเท่านั้น'
        : 'เมนูนี้สำหรับสมาชิกของระบบเท่านั้น กรุณาเข้าสู่ระบบก่อนใช้งาน'),
    !Auth.isLoggedIn() && UI.h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' } },
      UI.h('button', { className: 'btn btn-primary', onclick: () => Auth.openLogin() }, '🔑 เข้าสู่ระบบ'),
      UI.h('button', { className: 'btn btn-outline', onclick: () => (location.hash = '#/') }, '← กลับหน้าแรก')),
  );
  return UI.h('div', { className: 'card' }, body);
}

async function render() {
  const app = document.getElementById('app');
  const raw = location.hash.replace(/^#\/?/, '') || 'home';
  const key = raw.split('?')[0];

  if (key === 'home') {
    app.innerHTML = '';
    await HomeView.render(app);
    window.scrollTo(0, 0);
    return;
  }
  const view = ROUTES[key];
  app.innerHTML = '';
  if (!view || !canAccess(key)) {
    app.append(accessDenied(key));
    window.scrollTo(0, 0);
    return;
  }
  // TravelView ใช้หน้าเดียวกัน 2 สโคป: travel = สพป. (office), travel-school = สถานศึกษา (school)
  await view.render(app, key === 'travel' ? 'office' : (key === 'travel-school' ? 'school' : undefined));
  window.scrollTo(0, 0);
}

function go(key) {
  location.hash = '#/' + key;
}

document.getElementById('brand-link').addEventListener('click', () => (location.hash = '#/'));
window.addEventListener('hashchange', render);

/**
 * โหลดฟอนต์จากโฟล์เดอร์ font/ — สร้าง @font-face ให้ทุกไฟล์ + เก็บรายชื่อฟอนต์
 * ไว้ใน window.APP_FONT_LABELS เพื่อใช้ในเครื่องมือเลือกฟอนต์ (เช่น บันทึกข้อความ)
 */
async function ensureAppFonts() {
  if (window.APP_FONTS_LOADED) return;
  window.APP_FONTS_LOADED = true;
  try {
    const d = await API.get('/fonts');
    const fonts = d.fonts || [];
    const css = fonts.flatMap((f) =>
      f.files.map((fl) => `@font-face{font-family:'${f.family}';src:url('/fonts/${encodeURIComponent(fl.file)}');font-weight:${fl.weight};font-style:${fl.style};}`)).join('\n');
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

// Boot
(async function boot() {
  await Auth.init();
  ensureAppFonts(); // โหลดฟอนต์พื้นหลัง (ไม่บล็อกหน้าแรก)
  await render();
})();
