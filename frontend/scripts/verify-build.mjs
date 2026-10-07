/**
 * ตรวจสอบผล build ของ frontend
 *
 *   node scripts/verify-build.mjs            ตรวจไฟล์ใน dist/ อย่างเดียว
 *   node scripts/verify-build.mjs --server   ตรวจด้วยว่า server ที่รันอยู่เสิร์ฟได้จริง
 *
 * รายการที่ตรวจ
 *   1. dist/index.html มีครบ และอ้าง asset ที่มีอยู่จริง
 *   2. chunk ของทุกหน้า (13 เมนู + หน้าแรก) ถูกสร้างครบ
 *   3. ไฟล์ CSS ของ Leaflet ถูกรวมเข้าไปแล้ว
 *   4. theme.css ยังตรงกับ style.css ของระบบเดิมทุกไบต์ (กันไม่ให้แก้ CSS พลาด)
 *   5. worker ของ pdf.js ถูก bundle มาแล้ว
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, '..');
const ROOT = join(FRONTEND, '..');
const DIST = join(FRONTEND, 'dist');
const LEGACY_CSS = join(ROOT, 'docs', 'legacy', 'source-v1', 'css', 'style.css');

const USE_SERVER = process.argv.includes('--server');
const SERVER = process.env.SERVER_ORIGIN || 'http://127.0.0.1:3000';

let pass = 0;
let fail = 0;

function ok(msg) {
  pass++;
  console.log(`  ✓ ${msg}`);
}
function bad(msg) {
  fail++;
  console.log(`  ✗ ${msg}`);
}
function check(cond, msg) {
  cond ? ok(msg) : bad(msg);
}

console.log('ตรวจผล build ของ frontend\n');

// ---- 1. index.html ----
const indexPath = join(DIST, 'index.html');
if (!existsSync(indexPath)) {
  console.log('  ✗ ไม่พบ dist/index.html — ต้องรัน `npm run build` ก่อน');
  process.exit(1);
}
const html = readFileSync(indexPath, 'utf8');
ok('dist/index.html มีอยู่');
check(html.includes('<div id="app">'), 'มี #app สำหรับ Vue mount');
check(html.includes('P2-SMART - Online Management System'), 'มี <title> ตามระบบเดิม');
check(html.includes('Noto+Sans+Thai'), 'มีลิงก์ฟอนต์ Noto Sans Thai');

// ---- 2. asset ที่อ้างใน index.html ----
const assetRefs = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map((m) => m[1]);
check(assetRefs.length > 0, `index.html อ้าง asset ${assetRefs.length} รายการ`);
for (const ref of assetRefs) {
  // ห้ามแปลง "/" เป็น "\\" เอง — บน Linux เส้นทางจะกลายเป็นชื่อไฟล์เดียวที่มี backslash
  // path.join จัดการ separator ให้ถูกทั้ง Windows และ POSIX อยู่แล้ว
  const p = join(DIST, ref);
  check(existsSync(p), `มีไฟล์ ${ref} (${existsSync(p) ? Math.round(statSync(p).size / 1024) + ' KB' : 'ไม่พบ'})`);
}

// ---- 3. ทุกหน้าต้องมี chunk ----
//
// หน้าที่เขียนเป็น Vue แล้ว (Phase 3–9) จะถูก Vite ตั้งชื่อ chunk ตามชื่อไฟล์ .vue
// เช่น OfficePage.vue → OfficePage-xxxx.js ส่วนหน้าที่ยังเป็นโค้ดเดิมจะเป็น OfficeView-xxxx.js
// ตัวตรวจนี้จึงต้องอ่านรายการจาก registry จริง ไม่ใช่เดาชื่อตายตัว
const assetsDir = join(DIST, 'assets');
const chunks = readdirSync(assetsDir);

/** ชื่อไฟล์ที่แต่ละ key ควรผลิตเป็น chunk (เลือกอย่างใดอย่างหนึ่งที่มีจริง) */
const EXPECTED_CHUNKS = {
  home: ['HomeView', 'HomePage'],
  office: ['OfficeView', 'OfficePage'],
  schools: ['SchoolsView', 'SchoolsPage'],
  clock: ['ClockView', 'ClockPage'],
  vehicles: ['VehiclesView', 'VehiclesPage'],
  rooms: ['RoomsView', 'RoomsPage'],
  memos: ['MemosView', 'MemosPage'],
  travel: ['TravelView', 'TravelPage'],
  'travel-school': ['TravelView', 'TravelPage'], // ใช้หน้าเดียวกับ travel
  leave: ['LeaveView', 'LeavePage'],
  documents: ['DocumentsView', 'DocumentsPage'],
  budgets: ['BudgetsView', 'BudgetsPage'],
  academic: ['AcademicsView', 'AcademicPage'],
  staff: ['StaffView', 'StaffPage'],
};

for (const [key, names] of Object.entries(EXPECTED_CHUNKS)) {
  const hit = names.map((n) => chunks.find((c) => c.startsWith(n + '-'))).find(Boolean);
  check(!!hit, `chunk ของ ${key}${hit ? ` (${hit.replace(/-\w+\.js$/, '')}, ${Math.round(statSync(join(assetsDir, hit)).size / 1024)} KB)` : ' — ไม่พบ (' + names.join(' หรือ ') + ')'}`);
}

// ---- 4. CSS ของ Leaflet รวมเข้าไปแล้ว ----
const cssFiles = chunks.filter((c) => c.endsWith('.css'));
const cssText = cssFiles.map((c) => readFileSync(join(assetsDir, c), 'utf8')).join('\n');
check(/\.leaflet-container/.test(cssText), 'รวม CSS ของ Leaflet แล้ว');
check(/\.marker-cluster/.test(cssText), 'รวม CSS ของ Leaflet.markercluster แล้ว');
// CSS ถูก minify จึงเช็คแบบ regex (เผื่อมีช่องว่างหลัง colon)
check(/--primary:\s*#0f766e/.test(cssText), 'รวม theme.css (design tokens ของระบบเดิม) แล้ว');
check(/\.topbar\s*\{/.test(cssText) && /\.footer\s*\{/.test(cssText), 'รวมสไตล์แถบบนและท้ายเว็บของระบบเดิมแล้ว');

// ---- 5. theme.css ตรงกับต้นฉบับทุกไบต์ ----
const legacy = readFileSync(LEGACY_CSS);
const themePath = join(FRONTEND, 'src', 'styles', 'theme.css');
const sha = (b) => createHash('sha256').update(b).digest('hex');
check(
  sha(readFileSync(themePath)) === sha(legacy),
  `src/styles/theme.css ตรงกับ style.css ของระบบเดิม (${sha(legacy).slice(0, 16)}…)`,
);

// ---- 6. worker ของ pdf.js ----
const worker = chunks.find((c) => c.startsWith('pdf.worker.min-'));
check(!!worker, `pdf.js worker ถูก bundle มาแล้ว${worker ? ` (${Math.round(statSync(join(assetsDir, worker)).size / 1024)} KB)` : ' — ไม่พบ'}`);

// ---- 7. server เสิร์ฟได้จริง (ถ้าเปิด --server) ----
if (USE_SERVER) {
  console.log('');
  async function head(url) {
    const r = await fetch(url, { redirect: 'manual' });
    return r;
  }
  try {
    const r = await head(SERVER + '/');
    check(r.status === 200, `GET / → ${r.status}`);
    const body = await r.text();
    check(body.includes('<div id="app">'), 'หน้าแรกมี #app');

    for (const ref of assetRefs.slice(0, 4)) {
      const a = await head(SERVER + '/' + ref);
      check(a.status === 200, `GET /${ref} → ${a.status}`);
    }

    // API ต้องตอบว่ายังไม่ล็อกอิน (401) — แปลว่าเส้นทาง /api ยังทำงาน
    const api = await fetch(SERVER + '/api/auth/me');
    check(api.status === 401, `GET /api/auth/me → ${api.status} (ยังไม่ล็อกอิน = ถูกต้อง)`);

    // static ที่ระบบเดิมใช้
    for (const p of ['/logo.png', '/uploads/']) {
      const s = await head(SERVER + p);
      check(s.status === 200 || s.status === 404, `GET ${p} → ${s.status}`);
    }
    const logo = await head(SERVER + '/logo.png');
    check(logo.status === 200, 'GET /logo.png → 200 (โลโก้บนแถบบน)');
  } catch (e) {
    bad(`เชื่อมต่อ server ไม่ได้ (${SERVER}): ${e.message}`);
  }
}

console.log(`\nผ่าน ${pass} · ไม่ผ่าน ${fail}`);

/**
 * ปิด keep-alive socket ของ fetch ก่อนออกจากโปรแกรม
 *
 * ถ้าไม่ปิด Node จะพยายามยกเลิก handle ที่ยังเปิดอยู่ตอน exit
 * บน Windows จะได้ "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"
 * และ exit code กลายเป็น 0xC0000409 ทั้งที่ผลทดสอบผ่านหมด
 *
 * ⚠ ต้อง await close() ให้จบก่อนออก
 *   เดิมใช้ setTimeout(50) แล้ว process.exit() ทัน → ออกกลางที่ handle กำลังปิด
 *   ทำให้ crash แบบสุ่ม (ไม่เกิดทุกครั้ง) และทำให้ chain "&&" ใน verify:all พังเป็นครั้งคราว
 *
 *   close() คืน promise → await ให้เรียบร้อย
 *   ถ้าค้างจริง (socket ถูกปิดไปแล้ว) ให้ watchdog บังคับจบแทน
 */
async function shutdown(code) {
  process.exitCode = code;
  try {
    const dispatcher = globalThis[Symbol.for('undici.globalDispatcher.1')];
    if (dispatcher && typeof dispatcher.close === 'function') {
      // ปิดแบบมีเวลาจำกัด เผื่อ connection ค้าง
      await Promise.race([
        dispatcher.close(),
        new Promise((r) => setTimeout(r, 2000).unref?.() ?? setTimeout(r, 0)),
      ]);
    }
  } catch {
    /* ไม่มี undici dispatcher หรือปิดไม่สำเร็จ — ปล่อยให้ watchdog จัดการ */
  }
  // watchdog: ถ้ายังมี handle ค้าง Node จะไม่ออกเอง ให้บังคับ
  setTimeout(() => process.exit(code), 500);
}

await shutdown(fail ? 1 : 0);
