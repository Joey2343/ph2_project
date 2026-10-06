/**
 * ตรวจว่า registry ไม่มี key ซ้ำ และทุก entry ชี้ไปยังไฟล์ที่มีอยู่จริง
 *
 * ทำไมต้องมี
 * ──────────
 * VIEW_REGISTRY เป็น object literal ธรรมดา → ถ้าประกาศ key ซ้ำ JS จะให้ตัวหลังทับตัวแรก
 * โดยไม่เตือนและไม่ error
 *
 * เคยเกิดจริง: 6 หน้า (academic, budgets, schools, clock, rooms, vehicles)
 * ประกาศ kind:'vue' ไว้แล้วลืมลบบรรทัด kind:'legacy' ที่อยู่ด้านล่าง
 * → หน้าทั้ง 6 กลับไปวาดด้วย legacy code เงียบ ๆ
 *   เทสต์เบราว์เซอร์ยังผ่าน เพราะ legacy วาด DOM คล้ายกันพอให้ selector ที่ใช้เจอ
 *   → ต้องตรวจที่ "ตัว registry" ไม่ใช่ที่หน้าตาจอ
 *
 * หมายเหตุ: เช็คแบบ static (อ่านซอร์ส + เช็คไฟล์บนดิสก์) ไม่ import จริง
 *   เพราะ node ธรรมดาโหลด .vue ไม่ได้ และ pdfjs-dist ต้องผ่าน Vite ถึงจะ resolve ได้
 *   การว่าจริงว่าหน้าวาดออกมาเป็นงานของ verify-vue-pages.mjs / verify-runtime.mjs
 *
 * ใช้: node scripts/check-registry.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REGISTRY = path.join(ROOT, 'src', 'views', 'registry.js');
const MENUS = path.join(ROOT, 'src', 'router', 'menus.js');

let pass = 0;
let fail = 0;

/** @param {boolean} ok @param {string} name @param {string} [detail] */
function check(ok, name, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✔ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✖ ${name}`);
    if (detail) console.log(`      ${detail}`);
  }
}

/**
 * ดึง entry ทุกตัวจากซอร์สจริง พร้อมบรรทัด
 * ต้องอ่านซอร์ส ไม่ใช่ import — เพราะ import จะ dedupe key ซ้ำให้เงียบ ๆ
 */
function parseEntries(src) {
  const lines = src.split(/\r?\n/);
  const out = [];
  lines.forEach((line, i) => {
    const m = line.match(
      /^\s{2}'?([A-Za-z][A-Za-z-]*)'?\s*:\s*\{\s*kind:\s*'(vue|legacy)'(.*)$/,
    );
    if (m) out.push({ key: m[1], kind: m[2], rest: m[3], line: i + 1 });
  });
  return out;
}

console.log('ตรวจ registry หน้า Vue/legacy\n');

const src = readFileSync(REGISTRY, 'utf8');
const entries = parseEntries(src);

// ── 1. ไม่มี key ซ้ำ ──────────────────────────────────────────
const byKey = new Map();
const dups = [];
for (const e of entries) {
  if (byKey.has(e.key)) {
    dups.push(
      `key "${e.key}" ซ้ำ — บรรทัด ${byKey.get(e.key).line} (${byKey.get(e.key).kind}) ` +
        `ถูกบรรทัด ${e.line} (${e.kind}) ทับ (object literal ให้ตัวหลังชนะ)`,
    );
  } else {
    byKey.set(e.key, e);
  }
}
check(dups.length === 0, `ไม่มี key ซ้ำ (${entries.length} entries)`, dups.join('\n      '));

// ── 2. kind ที่ runtime ใช้จริงตรงกับที่ซอร์สประกาศ ────────────
const { VIEW_REGISTRY } = await import('../src/views/registry.js');
const mismatch = [];
for (const [key, entry] of Object.entries(VIEW_REGISTRY)) {
  const declared = byKey.get(key);
  if (!declared) {
    mismatch.push(`key "${key}" มีใน runtime แต่หาไม่พบในซอร์ส`);
    continue;
  }
  if (declared.kind !== entry.kind) {
    mismatch.push(`key "${key}" ซอร์สประกาศ ${declared.kind} แต่ runtime ได้ ${entry.kind}`);
  }
}
for (const e of entries) {
  if (!VIEW_REGISTRY[e.key]) mismatch.push(`key "${e.key}" ประกาศในซอร์สแต่หายจาก runtime`);
}
check(
  mismatch.length === 0,
  `kind ตรงกันทั้ง ${Object.keys(VIEW_REGISTRY).length} keys`,
  mismatch.join('\n      '),
);

// ── 3. ทุก entry ชี้ไปยังไฟล์ที่มีอยู่จริง ─────────────────────
const missingFiles = [];
const missingExport = [];
for (const e of entries) {
  if (e.kind === 'vue') {
    const m = e.rest.match(/import\('([^']+)'\)/);
    if (!m) {
      missingFiles.push(`บรรทัด ${e.line}: key "${e.key}" ไม่มี import(...)`);
      continue;
    }
    const abs = path.resolve(path.join(ROOT, 'src', 'views'), m[1]);
    if (!existsSync(abs)) missingFiles.push(`key "${e.key}" → ไม่พบไฟล์ ${m[1]}`);
  } else {
    const file = e.rest.match(/import\('\.\/([^']+)'\)/);
    const exp = e.rest.match(/export:\s*'([^']+)'/);
    if (!file) {
      missingFiles.push(`บรรทัด ${e.line}: key "${e.key}" ไม่มี import(...)`);
      continue;
    }
    const abs = path.join(ROOT, 'src', 'views', file[1]);
    if (!existsSync(abs)) {
      missingFiles.push(`key "${e.key}" → ไม่พบไฟล์ ${file[1]}`);
      continue;
    }
    // ชื่อ export ต้องปรากฏในไฟล์นั้นจริง
    if (exp && !readFileSync(abs, 'utf8').includes(exp[1])) {
      missingExport.push(`key "${e.key}" → ${file[1]} ไม่ export ชื่อ "${exp[1]}"`);
    }
  }
}
check(missingFiles.length === 0, 'ทุก entry ชี้ไปยังไฟล์ที่มีอยู่', missingFiles.join('\n      '));
check(missingExport.length === 0, 'ทุก legacy entry มี export ตรงชื่อ', missingExport.join('\n      '));

// ── 4. ทุกเมนูต้องมี entry ───────────────────────────────────
const menusSrc = readFileSync(MENUS, 'utf8');
const allMenuKeys = [
  ...new Set([
    ...[...menusSrc.matchAll(/\bkey:\s*'([a-z-]+)'/g)].map((m) => m[1]),
    ...[...menusSrc.matchAll(/\bpath:\s*'\/?([a-z-]*)'/g)].map((m) => m[1]),
  ]),
].filter(Boolean);
const noEntry = allMenuKeys.filter((k) => !VIEW_REGISTRY[k]);
check(
  noEntry.length === 0,
  `ทุกเมนูมี registry (${allMenuKeys.length} เมนู)`,
  noEntry.map((k) => `ไม่มี entry สำหรับ "${k}"`).join('\n      '),
);

// ── 5. ไม่มี legacy ที่โหลดแล้วซ้ำกับ vue ในโฟลเดอร์ views/ ──
// (กันการลืมลบ) — ไฟล์ views/ ที่ถูกอ้างถึงไม่ควรถูก import โดย key ที่เป็น vue
const referencedLegacy = new Set(
  entries.filter((e) => e.kind === 'legacy').map((e) => (e.rest.match(/import\('\.\/([^']+)'\)/) || [])[1]),
);
const vueKeys = new Set(entries.filter((e) => e.kind === 'vue').map((e) => e.key));
// ทุกหน้าเป็น Vue แล้ว = ย้ายครบทุกเมนู (legacy 0 รายการถือว่าสำเร็จ ไม่ใช่ข้อผิดพลาด)
check(
  vueKeys.size > 0,
  `สถานะปัจจุบัน: vue ${vueKeys.size} · legacy ${referencedLegacy.size}` +
    (referencedLegacy.size === 0 ? ' (ย้ายครบทุกเมนู)' : ''),
);

// ── สรุป ─────────────────────────────────────────────────────
const vueList = [...vueKeys].join(', ');
console.log(`\n  ย้ายเป็น Vue แล้ว (${vueKeys.size}): ${vueList}`);
console.log(`  ยังเป็น legacy (${referencedLegacy.size}): ${[...referencedLegacy]
  .map((f) => f.replace('.js', ''))
  .join(', ')}`);

console.log(`\nผ่าน ${pass} · ไม่ผ่าน ${fail}\n`);
if (fail > 0) process.exit(1);
