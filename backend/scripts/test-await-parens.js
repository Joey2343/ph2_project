'use strict';
/**
 * ทดสอบ check-await-parens กับกรณีตัวอย่าง
 * ใช้: node scripts/test-await-parens.js
 */
const { findIn } = require('./check-await-parens');

// ชื่อฟังก์ชันที่ "สมมติว่าเป็น async" ในการทดสอบ
const ASYNC = new Set([
  'getTimeEditorIds',   // lib/auth
  'publicUser',         // lib/auth
  'getSessionUser',     // lib/auth
  'requiredLevels',     // lib/approvals
  'travelRequiredLevels',
]);

const CASES = [
  // ── ต้องแก้ ────────────────────────────────────────────────
  ['const a = await db.prepare(s).get(x).c;', 1],
  ['const b = await ins.run(id).changes;', 1],
  ['const c = await db.prepare(s).all(a).map(fn);', 1],
  ['if (await db.prepare(s).run(a).changes) n++;', 1],
  ['const d = await db.prepare(s).get(x).y.z;', 1],
  ['const e = await getTimeEditorIds().includes(id);', 1],
  ['const f = await requiredLevels(u).length;', 1],
  ['const g = await db.prepare(s).get(x).c + await db.prepare(s).get(y).d;', 2],
  ['const h = await travelRequiredLevels(id).map(f);', 1],

  // ── ไม่ต้องแก้ ──────────────────────────────────────────────
  ['const i = await db.prepare(s).all();', 0],
  ['const j = await db.prepare(s).get(x);', 0],
  ['const k = (await db.prepare(s).get(x)).c;', 0],
  ['const l = (await db.prepare(s).all(a)).map(f);', 0],
  ['const m = await obj.field;', 0],
  ['const n = JSON.stringify(x.get(y));', 0],           // ไม่มี await
  ['const o = await JSON.stringify(x.get(y));', 0],     // JSON คืนค่าตรง
  ['const p = await auth.publicUser(await db.prepare(s).get(id));', 0], // await ซ้อน
  ['const q = await Promise.all(a.map(async (x) => { return await db.prepare(s).get(x); }));', 0],
  ['const r = await db.prepare(s).get(x);', 0],
];

let pass = 0;
let fail = 0;
for (const [snippet, expected] of CASES) {
  const code = `(async function t() {\n  ${snippet}\n})`;
  let got;
  try {
    got = findIn(code, ASYNC).length;
  } catch (e) {
    console.log(`✖ parse ไม่ผ่าน: ${snippet}\n   ${e.message}`);
    fail += 1;
    continue;
  }
  if (got === expected) {
    pass += 1;
    console.log(`✔ ${snippet}  (${got})`);
  } else {
    fail += 1;
    console.log(`✖ ${snippet}\n     คาดว่า ${expected} แต่ได้ ${got}`);
  }
}
console.log(`\nผ่าน ${pass} · ไม่ผ่าน ${fail}`);
process.exit(fail === 0 ? 0 : 1);
