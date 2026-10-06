/**
 * แปลงโค้ด frontend รุ่นเดิม (vanilla JS + global) เป็น ES module สำหรับ Vue 3
 *
 * วิธีนี้เลือกใช้การแปลงแบบสคริปต์ (regex replace) แทนการพิมพ์โค้ดใหม่ เพราะ:
 *   - รับประกันว่าข้อความไทย ชื่อ class และ markup ตรงกับต้นฉบับทุกตัวอักษร
 *   - ไม่มีความเสี่ยงที่จะตกฟีเจอร์หรือเงื่อนไขบางอย่างระหว่างพิมพ์ใหม่
 *
 * รัน:  node scripts/port-frontend.mjs
 * อ่าน: docs/legacy/source-v1/js/**
 * เขียน: frontend/src/**
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// โค้ดนี้อยู่ที่ <project>/frontend/scripts/ → รากโปรเจกต์คือขึ้นไป 2 ชั้น
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'docs', 'legacy', 'source-v1', 'js');
const OUT = join(ROOT, 'frontend', 'src');

// ปลายทางของโค้ดหน้าที่ port จากระบบเดิม
//
// ทุกหน้าถูกย้ายเป็น Vue SFC แล้ว (src/pages/*.vue) ยกเว้น DocumentsView.js ที่ยังถูกเรียกใช้
// ส่วนตัวเอง จึงเขียนผลลัพธ์ไว้ใน docs/legacy/ported-views/ เพื่อเก็บไว้เทียบอ้างอิง
// ถ้าเขียนลง src/views/ ตามเดิม การรัน port อีกครั้งจะสร้างไฟล์ที่ไม่มีใคร import กลับมา
const PORTED_VIEWS = join(ROOT, 'docs', 'legacy', 'ported-views');

/** ไฟล์ต้นฉบับ → ชื่อไฟล์ปลายทาง */
const VIEW_MAP = {
  'home.js': 'HomeView.js',
  'office.js': 'OfficeView.js',
  'schools.js': 'SchoolsView.js',
  'clock.js': 'ClockView.js',
  'vehicles.js': 'VehiclesView.js',
  'rooms.js': 'RoomsView.js',
  'memos.js': 'MemosView.js',
  'travel.js': 'TravelView.js',
  'leaves.js': 'LeaveView.js',
  'documents.js': 'DocumentsView.js',
  'budgets.js': 'BudgetsView.js',
  'academics.js': 'AcademicsView.js',
  'staff.js': 'StaffView.js',
};

/** สร้างบล็อก import ตามสิ่งที่แต่ละไฟล์ใช้จริง (ไม่ import ของที่ไม่ได้ใช้ เพื่อลด bundle) */
function buildImports(code, label) {
  const imp = [];
  imp.push(`import { UI } from '../ui/ui.js';`);
  imp.push(`import api from '../api/client.js';`);
  imp.push(`import { Auth } from '../stores/auth.js';`);
  imp.push(`import { CONSTANTS } from '../constants/index.js';`);
  // app.js ของระบบเดิมประกาศ MENUS / canAccess ไว้ในระดับ global
  if (/(?<![\w.])MENUS\b/.test(code) || /(?<![\w.])canAccess\(/.test(code)) {
    imp.push(`import { MENUS, canAccess } from '../router/menus.js';`);
  }
  if (/\bExportFilterDialog\b/.test(code)) imp.push(`import { ExportFilterDialog } from '../ui/ExportFilter.js';`);
  if (/\bL\.[a-zA-Z]/.test(code)) {
    imp.push(`import L from 'leaflet';`);
    imp.push(`import 'leaflet.markercluster';`);
  }
  if (/\bpdfjsLib\b|\bpdfWorkerUrl\b/.test(code)) imp.push(`import { pdfjsLib, pdfWorkerUrl } from '../lib/pdfjs.js';`);
  if (/\bPDFLib\b/.test(code)) imp.push(`import * as PDFLib from 'pdf-lib';`);
  return imp.join('\n');
}

function portView(name) {
  const code = readFileSync(join(SRC, 'views', name), 'utf8');

  const imports = buildImports(code, name);
  const header = [
    '/**',
    ` * ${label(name)}`,
    ' *',
    ' * port จาก public/js/views/' + name + ' ของระบบเดิมด้วย scripts/port-frontend.mjs',
    ' * (แปลงแบบสคริปต์ ไม่ได้พิมพ์ใหม่ → ข้อความไทย/class/markup ตรงต้นฉบับทุกตัวอักษร)',
    ' *',
    ' * เปลี่ยนเฉพาะการเชื่อมต่อเข้ากับระบบใหม่:',
    ' *   API  → api   (โมดูลแทน global)',
    ' *   go(key) → window.__P2_GO__(key)      (vue-router แทน hash แบบเดิม)',
    ' *   render() → window.__P2_RERENDER__() (ให้ ViewHost วาดหน้าใหม่)',
    ' *   Leaflet / PDFLib / pdfjs-dist → import จาก node_modules (ไม่พึ่ง CDN เหมือนเดิม)',
    ' */',
    imports,
  ].join('\n');

  let out = code.replace(/^'use strict';/, header);

  // global → module
  out = out.replace(/\bAPI\./g, 'api.');
  out = out.replace(/=\s*window\.__SIM_DATE\b/g, '= window.__SIM_DATE');
  out = out.replace(/=>\s*go\(/g, '=> window.__P2_GO__(');
  out = out.replace(/(?<![\w.])render\(\);/g, 'window.__P2_RERENDER__();');

  // ประกาศเป็น export
  out = out.replace(/^const (\w+View)\s*=\s*\{/m, 'export const $1 = {');

  // worker ของ pdf.js — ให้ Vite bundle มาให้ ไม่ต้องอาศัย /vendor/ บน server
  out = out.replace(/"\/vendor\/pdfjs\/pdf\.worker\.min\.js"/g, 'pdfWorkerUrl');

  const dest = join(PORTED_VIEWS, VIEW_MAP[name]);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, out, 'utf8');
  return { file: VIEW_MAP[name], bytes: Buffer.byteLength(out) };
}

function label(name) {
  return (
    {
      'home.js': 'หน้าแรก: การ์ดเมนูทั้งหมด + วิดเจ็ตลงเวลา',
      'office.js': 'เมนู 1: ข้อมูลพื้นฐาน สพป.แพร่ เขต 2',
      'schools.js': 'เมนู 2: พิกัดโรงเรียนในสังกัด (Leaflet)',
      'clock.js': 'เมนู 4: ลงเวลาทำงาน',
      'vehicles.js': 'เมนู 5: จองยานพาหนะ',
      'rooms.js': 'เมนู 6: จองห้องประชุม',
      'memos.js': 'เมนู 7: บันทึกข้อความ',
      'travel.js': 'เมนู 8/9: ขออนุญาตไปราชการ (สพป. + สถานศึกษา)',
      'leaves.js': 'เมนู 10: ขออนุญาตลา',
      'documents.js': 'เมนู 3: หนังสือราชการ (pdf.js + pdf-lib + ประทับตรา)',
      'budgets.js': 'เมนู 11: บริหารงบประมาณ',
      'academics.js': 'เมนู 12: บริหารงานวิชาการ',
      'staff.js': 'เมนู 13: เจ้าหน้าที่ในระบบ (ผู้ดูแลระบบ)',
    }[name] || name
  );
}

// ---- รัน ----
console.log('port views ->');
let total = 0;
for (const name of Object.keys(VIEW_MAP)) {
  const r = portView(name);
  total += r.bytes;
  console.log(`  ${r.file.padEnd(20)} ${String(r.bytes).padStart(8)} bytes`);
}
console.log(`  ${'รวม'.padEnd(18)} ${String(total).padStart(8)} bytes`);

// ---- sign-editor (หน้า popup สำหรับลงนามในร่างเอกสาร) ----
function portSignEditor() {
  // --- HTML ---
  let html = readFileSync(join(SRC, '..', 'sign-editor.html'), 'utf8');
  html = html.replace(
    '<link rel="stylesheet" href="css/style.css">',
    '<!-- style.css ถูก import ใน main.js ให้ Vite จัดการ (ไม่ต้องลิงก์ด้วยมือ) -->',
  );
  html = html.replace(/\s*<script src="vendor\/pdfjs\/pdf\.min\.js"><\/script>/, '');
  html = html.replace(
    '<script src="js/sign-editor.js?v=1"></script>',
    '<script type="module" src="/src/sign-editor/main.js"></script>',
  );
  const htmlDest = join(ROOT, 'frontend', 'sign-editor.html');
  writeFileSync(htmlDest, html, 'utf8');

  // --- JS ---
  const code = readFileSync(join(SRC, 'sign-editor.js'), 'utf8');
  let out = code.replace(
    /^'use strict';/,
    [
      '/**',
      ' * เครื่องมือลงนามในร่างเอกสาร (หน้าต่างแยก /sign-editor.html)',
      ' *',
      ' * port จาก public/js/sign-editor.js ของระบบเดิมด้วย scripts/port-frontend.mjs',
      ' * (ตรงต้นฉบับทุกตัวอักษร — เปลี่ยนเฉพาะวิธีโหลด pdf.js)',
      ' *',
      ' * ระบบเดิมโหลด pdf.min.js + worker จากโฟลเดอร์ vendor/ บน server',
      ' * รุ่นนี้ใช้ pdfjs-dist จาก node_modules ซึ่งตั้ง workerSrc ให้แล้วใน src/lib/pdfjs.js',
      ' */',
      "import { pdfjsLib } from '../lib/pdfjs.js';",
      '',
      "import '../styles/theme.css';",
    ].join('\n'),
  );
  // ตังค่า worker ใหม่อยู่ในโมดูลแล้ว
  out = out.replace(/^\s*pdfjsLib\.GlobalWorkerOptions\.workerSrc\s*=.*$/m, '  // workerSrc ตั้งไว้ใน src/lib/pdfjs.js แล้ว');

  const jsDest = join(OUT, 'sign-editor', 'main.js');
  mkdirSync(dirname(jsDest), { recursive: true });
  writeFileSync(jsDest, out, 'utf8');
  return {
    html: Buffer.byteLength(html),
    js: Buffer.byteLength(out),
  };
}

const se = portSignEditor();
console.log(`  sign-editor.html      ${String(se.html).padStart(8)} bytes`);
console.log(`  sign-editor/main.js   ${String(se.js).padStart(8)} bytes`);

// สำเนาไฟล์ที่ยังไม่ได้แปลงไว้ให้เป็นต้นฉบับอ้างอิง
if (!existsSync(join(OUT, 'constants', 'v1-source.js'))) {
  copyFileSync(join(SRC, 'constants.js'), join(OUT, 'constants', 'v1-source.js'));
}
console.log('done.');
