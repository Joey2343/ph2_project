/**
 * ทะเบียนหน้าทั้งหมด (route key → หน้า)
 *
 * รองรับการย้ายทีละหน้าโดยไม่ให้ระบบพัง
 * ─────────────────────────────────────────────────
 *  - kind: 'vue' → เขียนเป็น Vue component แล้ว (src/pages/*.vue)
 *  - kind: 'legacy' → ยังเป็นโค้ดเดิมที่ port เป็น ES module (src/views/*.js)
 *
 * ทั้งสองแบบทำงานผ่าน ViewHost เหมือนกัน ต่างแค่ว่า
 *   vue   → ViewHost ให้ Vue วาด component
 *   legacy→ ViewHost เรียก view.render(el, scope) ให้โค้ดเดิมวาดเอง
 *
 * ตอนย้ายหน้าใดหน้าหนึ่งเสร็จ ให้เปลี่ยน kind ของ key นั้นเป็น 'vue'
 * และชี้ component ไปที่ไฟล์ใน src/pages/ — ไม่ต้องแตะไฟล์อื่นเลย
 *
 * ตารางนี้ตรงกับ MENUS ใน router/menus.js ทุกตัว (13 เมนู + หน้าแรก)
 *
 * scope คือพารามิเตอร์ที่ส่งให้ view:
 *   TravelView ใช้หน้าเดียวกัน 2 สโคป
 *     'travel'        → 'office' (เจ้าหน้าที่ สพป.แพร่ เขต 2)
 *     'travel-school' → 'school' (เจ้าหน้าที่สถานศึกษา)
 *
 * ⚠ ห้ามประกาศ key ซ้ำใน object นี้เด็ดขาด
 *   JS ให้ "ตัวหลัง" ทับ "ตัวแรก" แบบเงียบ ๆ โดยไม่เตือน
 *   เคยเกิดแล้ว: ประกาศ kind:'vue' ไว้บน แล้วลืมลบบรรทัด kind:'legacy' ที่อยู่ล่าง
 *   → หน้าทั้งหลายกลับไปวาดด้วยโค้ดเดิมเงียบ ๆ เทสต์ก็ยังผ่านเพราะ DOM คล้ายกัน
 *   เช็กด้วย `node scripts/check-registry.mjs`
 */

/** key → { kind, component?, loader?, export?, scope? } */
export const VIEW_REGISTRY = {
  /* ---------- หน้าที่เขียนใหม่เป็น Vue แล้ว ---------- */
  office: { kind: 'vue', component: () => import('../pages/OfficePage.vue') },
  academic: { kind: 'vue', component: () => import('../pages/AcademicPage.vue') },
  budgets: { kind: 'vue', component: () => import('../pages/BudgetsPage.vue') },
  schools: { kind: 'vue', component: () => import('../pages/SchoolsPage.vue') },
  clock: { kind: 'vue', component: () => import('../pages/ClockPage.vue') },
  rooms: { kind: 'vue', component: () => import('../pages/RoomsPage.vue') },
  vehicles: { kind: 'vue', component: () => import('../pages/VehiclesPage.vue') },
  // หน้าเดียวกัน 2 สโคป — scope ถูกส่งเข้าเป็น prop ของ TravelPage
  travel: { kind: 'vue', component: () => import('../pages/TravelPage.vue'), scope: 'office' },
  'travel-school': { kind: 'vue', component: () => import('../pages/TravelPage.vue'), scope: 'school' },
  leave: { kind: 'vue', component: () => import('../pages/LeavePage.vue') },
  memos: { kind: 'vue', component: () => import('../pages/MemosPage.vue') },
  // Documents: ย้ายเฉพาะโครงหน้า (แท็บ/ตัวกรอง/ตาราง/เข้าหน้า) เป็น Vue
  // หน้าต่างลงทะเบียน/ส่งหนังสือ/ปั้ม PDF ยังเรียกจากโมดูล DocumentsView.js เดิม
  documents: { kind: 'vue', component: () => import('../pages/DocumentsPage.vue') },
  staff: { kind: 'vue', component: () => import('../pages/StaffPage.vue') },

  /* ---------- หน้าที่ยังเป็นโค้ดเดิม (ค่อย ๆ ย้าย) ----------
   * เวลาย้ายหน้าใดเสร็จ ให้ "ลบ" บรรทัด legacy ของ key นั้นออกให้หมด
   * อย่าลบ Vue entry แล้วปล่อย legacy ค้างไว้
   */
  home: { kind: 'vue', component: () => import('../pages/HomePage.vue') },
};

/**
 * โหลดหน้าตาม key
 * @returns {Promise<{kind: string, view: object|null, component: object|null, scope: string|undefined}>}
 */
export async function loadView(key) {
  const entry = VIEW_REGISTRY[key];
  if (!entry) return { kind: 'none', view: null, component: null, scope: undefined };

  if (entry.kind === 'vue') {
    const mod = await entry.component();
    // ส่ง scope ให้ component ด้วย — TravelPage ใช้แยกสาย สพป. / สถานศึกษา
    // (legacy เคยได้ scope เป็น argument ของ render() ต้องไม่ตกหล่น)
    return { kind: 'vue', view: null, component: mod.default, scope: entry.scope };
  }

  const mod = await entry.loader();
  return { kind: 'legacy', view: mod[entry.export] || null, component: null, scope: entry.scope };
}

/** หน้าไหนย้ายเป็น Vue แล้วบ้าง — ใช้แสดงสถานะในหน้าแรกของนักพัฒนา */
export function migrationStatus() {
  const out = { vue: [], legacy: [] };
  for (const [key, v] of Object.entries(VIEW_REGISTRY)) (v.kind === 'vue' ? out.vue : out.legacy).push(key);
  return out;
}
