'use strict';
/**
 * ไปป์ไลน์แปลง backend เดิม (sync) → async + รองรับ MySQL
 *
 * รันซ้ำได้เสมอ โดยเริ่มจากต้นฉบับที่เก็บไว้ใน docs/legacy/source-v1
 * ต้นฉบับถูกแก้เมื่อรัน แต่ไฟล์ที่ได้จะเหมือนเดิมทุกครั้ง (deterministic)
 *
 * ขั้นตอน:
 *   1. ก๊อป routes/ lib/ กลับจากต้นฉบับ
 *   2. codemod-async            เติม await + async + backtick คอลัมน์ reserved
 *   3. ตัด block ALTER TABLE ระดับ module ออกจาก routes/admin.js (ย้ายไป db.js แล้ว)
 *   4. codemod-foreach          forEach(async) → for...of, map(async) → Promise.all
 *   5. codemod-async-propagate  เติม async ให้ฟังก์ชันที่มี await
 *   6. ตรวจ syntax + ตรวจว่าไม่มี await นอก async ค้าง
 *
 * ใช้: node scripts/port-to-async.js [--keep]   (--keep = ไม่ก๊อปกลับจากต้นฉบับ)
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, '..', 'docs', 'legacy', 'source-v1');
const KEEP = process.argv.includes('--keep');

function step(n, text) {
  console.log(`\n[${n}] ${text}`);
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

function require_(mod) {
  return require(mod);
}

// 1) ก๊อปต้นฉบับกลับ
if (!KEEP) {
  step(1, 'ก๊อป routes/ lib/ กลับจากต้นฉบับ');
  // ไฟล์ที่ถูกสร้างใหม่ระหว่างงาน port (ไม่ได้มาจากต้นฉบับ) ต้องไม่ถูกลบ
  const KEEP_FILES = new Set(['async-route.js']);
  for (const d of ['routes', 'lib']) {
    const target = path.join(ROOT, d);
    const source = path.join(SRC, d);
    copyTree(source, target);
    // ลบเฉพาะไฟล์ที่ "เคยมาจากต้นฉบับ" แต่ตอนนี้ต้นฉบับไม่มีแล้ว
    for (const f of fs.readdirSync(target)) {
      if (!f.endsWith('.js')) continue;
      if (fs.existsSync(path.join(source, f))) continue;
      if (KEEP_FILES.has(f)) continue;
      fs.unlinkSync(path.join(target, f));
      console.log(`    ลบไฟล์ค้างจากรอบก่อน: ${d}/${f}`);
    }
    console.log(`    ${d}/ ← ${path.relative(ROOT, source)}`);
  }
} else {
  step(1, 'ข้าม (ใช้ไฟล์ปัจจุบัน)');
}

// 2) codemod-async
step(2, 'codemod-async: เติม await / async / backtick');
report(require_('./codemod-async.js').transformAll());

// 3) ตัด module-level ALTER TABLE
step(3, 'ตัด ALTER TABLE ระดับ module ออกจาก routes/admin.js');
const adminPath = path.join(ROOT, 'routes', 'admin.js');
const lines = fs.readFileSync(adminPath, 'utf8').split(/\r?\n/);
const startIdx = lines.findIndex((l) => /^\s*try \{ await db\.exec\('ALTER TABLE/.test(l));
if (startIdx !== -1) {
  let endIdx = startIdx;
  while (endIdx < lines.length && /^\s*try \{ await db\.exec\('ALTER TABLE/.test(lines[endIdx])) {
    endIdx += 1;
  }
  const note = [
    '// หมายเหตุ: คอลัมน์ของ documents / document_recipients ทั้งหมดถูกย้ายไปประกาศ',
    '// ใน COLUMN_MIGRATIONS ของ db.js แล้ว เพราะเดิมประกาศด้วย ALTER TABLE ระดับ module',
    '// ซึ่งทำงานไม่ได้เมื่อระบบเป็น async และไม่ portable ข้าม dialect',
  ];
  lines.splice(startIdx, endIdx - startIdx, ...note);
  fs.writeFileSync(adminPath, lines.join('\n'), 'utf8');
  console.log(`    ลบ ${endIdx - startIdx} บรรทัด`);
} else {
  console.log('    ไม่พบ (อาจรันซ้ำแล้ว)');
}

// 4) patch การใช้ db.transaction ให้ถูกต้องบน async
//
//    ปัญหา: โค้ดเดิมเขียนแบบ better-sqlite3 (sync)
//      const tx = db.transaction(fn);   → คืนฟังก์ชัน
//      tx(rows);
//    แต่ adapter คืน async function ที่รัน transaction เสร็จแล้ว
//    แถมด้วย prepared statement ที่ประกาศนอก transaction จะผูกกับ connection
//    ของ pool ไม่ใช่ connection ของ transaction → บน MySQL atomicity หาย
//
//    วิธีแก้: สร้าง statement จาก tx.prepare(...) ภายใน callback แล้วเรียกทันที
//
//    ใช้ exact-string replacement เพราะมีจุดเดียวในทั้งระบบ
//    และผลลัพธ์ของ codemod เป็น deterministic (เห็นได้จาก port-to-async.js)
step(4, 'patch การใช้ db.transaction ให้ผูกกับ connection ของ transaction');
patchTransactionUsage();
function patchTransactionUsage() {
  const p = path.join(ROOT, 'routes', 'content.js');
  let src = fs.readFileSync(p, 'utf8');

  const BEFORE = [
    '  const upsert = db.prepare(`INSERT INTO office_sections (\\`key\\`, title, content, sort)',
    '    VALUES (?,?,?,?) ON CONFLICT(\\`key\\`) DO UPDATE SET title = excluded.title, content = excluded.content, sort = excluded.sort`);',
    '  const tx = await db.transaction(async (list) => {',
    '    for (const s of list) {',
    '      if (!s.title) continue;',
    '      await upsert.run(s.key || null, String(s.title).trim(), String(s.content ?? \'\'), Number(s.sort) || 0);',
    '    }',
    '  });',
    '  tx(sections);',
  ].join('\n');

  const AFTER = [
    '  await db.transaction(async (tx) => {',
    '    const upsert = tx.prepare(',
    "      'INSERT INTO office_sections (`key`, title, content, sort)' +",
    "        ' VALUES (?,?,?,?) ON CONFLICT(`key`) DO UPDATE SET' +",
    "        ' title = excluded.title, content = excluded.content, sort = excluded.sort'",
    '    );',
    '    for (const s of sections) {',
    '      if (!s.title) continue;',
    "      await upsert.run(s.key || null, String(s.title).trim(), String(s.content ?? ''), Number(s.sort) || 0);",
    '    }',
    '  })();',
  ].join('\n');

  if (!src.includes(BEFORE)) {
    console.log('    ไม่พบรูปแบบที่คาด (อาจแก้ไปแล้ว — ตรวจด้วยตาด้วย)');
    return;
  }
  src = src.replace(BEFORE, AFTER);
  fs.writeFileSync(p, src, 'utf8');
  console.log('    ✔ แก้แล้ว: ย้าย prepared statement เข้าใน tx, เรียก transaction ทันที');
}

// 5) propagate (รอบแรก) — ต้องทำก่อน codemod-foreach
//    เพราะ forEach(async) → for...of จะย้าย await ขึ้นมาอยู่ในฟังก์ชันแม่
//    ถ้าฟังก์ชันแม่ยังไม่เป็น async โค้ดจะ parse ไม่ผ่านเลย
step(4, 'codemod-async-propagate (รอบแรก): เติม async ให้ฟังก์ชันที่มี await / เรียก async callback');
report(require_('./codemod-async-propagate.js').transformAll());

// 5) codemod-foreach
step(5, 'codemod-foreach: forEach(async) → for...of, map(async) → Promise.all');
report(require_('./codemod-foreach.js').transformAll());

// 6) propagate วนจนนิ่ง — ต้องนิ่งก่อน codemod-await-lib ไม่งั้นฟังก์ชันที่เพิ่ง
//    กลายเป็น async จะยังไม่ถูกรู้ว่าต้อง await ที่จุดเรียก
step(6, 'codemod-async-propagate (วนจนนิ่ง)');
report(require_('./codemod-async-propagate.js').transformAll());

// 7) เติม await ให้จุดเรียกฟังก์ชันที่กลายเป็น async (ข้ามไฟล์)
//    เช่น auth.attachUser เรียก getSessionUser() — ถ้าไม่ await จะได้ Promise
//    แล้ว req.user.status เป็น undefined → 401 ทุก endpoint
step(7, 'codemod-await-lib: await ที่จุดเรียกฟังก์ชัน async');
{
  // วนจนไม่มีอะไรเพิ่ม — เพราะแต่ละรอบทำให้ฟังก์ชันใหม่กลายเป็น async
  let round = 0;
  let grandTotal = 0;
  for (;;) {
    round += 1;
    if (round > 10) break;
    const list = [];
    for (const root of ['routes', 'lib']) {
      const dir = path.join(ROOT, root);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.js')) list.push(path.join(dir, f));
      }
    }
    const names = require_('./codemod-await-lib.js').collectAsyncNames(list);
    let added = 0;
    const touched = [];
    for (const p of list) {
      const code = fs.readFileSync(p, 'utf8');
      const r = require_('./codemod-await-lib.js').transform(code, names);
      if (!r.count) continue;
      fs.writeFileSync(p, r.code, 'utf8');
      added += r.count;
      touched.push(`${path.relative(ROOT, p)}+${r.count}`);
    }
    grandTotal += added;
    if (round === 1) console.log(`    ฟังก์ชัน async ที่ต้องรอ: ${names.size} ตัว`);
    if (!added) break;
    if (round === 1) console.log(`    รอบ 1: ${touched.join(' ')}`);
    // เติม async ให้ฟังก์ชันแม่ที่เพิ่งได้ await
    require_('./codemod-async-propagate.js').transformAll();
  }
  console.log(`    รวม await ที่เพิ่ม: ${grandTotal} (${round} รอบ)`);
}

// 8) propagate รอบสุดท้าย
step(8, 'codemod-async-propagate (รอบสุดท้าย)');
report(require_('./codemod-async-propagate.js').transformAll());

// 9) แก้ `await fn().prop` และ `await fn().map()` ให้เป็น `(await fn()).prop`
step(9, 'check-await-parens: (await fn()).prop / (await fn()).map()');
{
  const checker = require_('./check-await-parens.js');
  for (let i = 1; i <= 5; i += 1) {
    const res = checker.run({ fix: true });
    if (res.total === 0) {
      console.log('    ไม่พบจุดที่ต้องแก้');
      break;
    }
    console.log(`    รอบ ${i}: แก้ ${res.total} จุด`);
    require_('./codemod-async-propagate.js').transformAll();
  }
}

// 10) ห่อ router เพื่อจับ async error (Express 4 ไม่ catch promise เอง)
step(10, 'wrap-routers');
require_('./wrap-routers.js').run();

// 11) แก้บั๊กที่ค้นพบระหว่างตรวจสอบ (ดูรายละเอียดในไฟล์)
step(11, 'fix-known-bugs');
require_('./fix-known-bugs.js').main();

// 12) ตรวจ
step(12, 'ตรวจ syntax ทุกไฟล์');
let bad = 0;
for (const d of ['routes', 'lib']) {
  const dir = path.join(ROOT, d);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js')) continue;
    const p = path.join(dir, f);
    try {
      acorn.parse(fs.readFileSync(p, 'utf8'), { ecmaVersion: 'latest', sourceType: 'script' });
    } catch (err) {
      console.log(`    ✖ ${d}/${f}: ${err.message}`);
      bad += 1;
    }
  }
}
console.log(bad === 0 ? '    ✔ ทุกไฟล์ถูกต้อง' : `    ✖ มี ${bad} ไฟล์ผิด`);

function report(fn) {
  const res = typeof fn === 'function' ? fn() : fn;
  if (!res) return;
  for (const r of Array.isArray(res) ? res : [res]) {
    if (!r) continue;
    if (!r.awaitCount && !r.forEachCount && !r.mapCount && !r.propagated) continue;
    const parts = [];
    if (r.awaitCount) parts.push(`await +${r.awaitCount}`);
    if (r.backtickCount) parts.push(`backtick ${r.backtickCount}`);
    if (r.forEachCount) parts.push(`forEach→for-of ${r.forEachCount}`);
    if (r.mapCount) parts.push(`map→Promise.all ${r.mapCount}`);
    if (r.propagated) parts.push(`async +${r.propagated}`);
    console.log(`    ✔ ${r.name}: ${parts.join(' · ')}`);
  }
}

process.exit(bad === 0 ? 0 : 1);
