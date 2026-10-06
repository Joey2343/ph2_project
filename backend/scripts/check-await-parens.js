'use strict';
/**
 * ตรวจจับและแก้ "การเรียกเมธอดบน promise" ซึ่งเกิดจากลำดับความสำคัญของ await
 *
 * ปัญหา
 *   await มีลำดับต่างต่ำกว่าการเข้าถึงสมาชิก/เรียกเมธอด
 *   ดังนั้น  await f().includes(x)   ตีความเป็น  await (f().includes(x))
 *
 *   ก่อนแปลงเป็น async  f() คืนค่าตรง ๆ  → .includes() ทำงาน
 *   หลังแปลง            f() คืน Promise    → .includes is not a function  ← crash
 *
 *   แก้เป็น  (await f()).includes(x)
 *
 * ทำไมต้องระบุชื่อฟังก์ชัน async
 *   เพราะไม่ใช่ทุกฟังก์ชันคืน Promise — JSON.stringify คืนค่าตรงเสมอ
 *   ถ้า flag ทุกการเรียกจะแก้ผิดจำนวนมาก จึงตรวจเฉพาะ:
 *     - เมธอด terminal ของ adapter: .get() / .all() / .run()
 *     - ฟังก์ชันที่ประกาศเป็น async ในโปรเจกต์นี้
 *
 * วิธีตรวจ: ไล่ตาม "แกน" ของ expression (ผ่าน .object / .callee เท่านั้น)
 *   ไม่ไล่เข้าไปในอาร์กิวเมนต์ เพราะเป็นคนละเรื่องกัน
 *
 *   await db.prepare(s).all(a).map(f)   → เจอ .all() ไม่ใช่ตัวสุดท้าย → ต้องแก้
 *   await JSON.stringify(x.get(y))      → แกนจบที่ JSON → ไม่แตะ (เป็นบั๊กคนละชนิด)
 *   await auth.publicUser(await db...)  → แกนจบที่ auth → ไม่แตะ (await ข้างในเป็นของตัวเอง)
 *   await db.prepare(s).get(x)          → terminal คือตัวสุดท้าย → ปลอดภัย
 *
 * ใช้: node scripts/check-await-parens.js [--fix]
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const FIX = process.argv.includes('--dry') ? false : process.argv.includes('--fix');

/** เมธอด terminal ของ adapter ที่คืน Promise */
const TERMINALS = new Set(['get', 'all', 'run']);

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

/** ชื่อฟังก์ชันที่ถูกเรียก (Identifier หรือ ชื่อเมธอดหลังจุด) */
function calleeNameOf(call) {
  const c = call.callee;
  if (!c) return null;
  if (c.type === 'Identifier') return c.name;
  if (c.type === 'MemberExpression' && c.property.type === 'Identifier') return c.property.name;
  return null;
}

/**
 * ไล่ตามแกนของ expression แล้วคืนรายการ call ที่ "คืน promise"
 * และไม่ได้เป็นผลลัพธ์สุดท้ายของ await (จึงถูกเอาไปเข้าถึงสมาชิกต่อ)
 *
 * @param {object} arg  argument ของ AwaitExpression
 * @param {Set<string>} asyncNames  ชื่อฟังก์ชัน async ทั้งโปรเจกต์
 */
function promiseCallsOnSpine(arg, asyncNames) {
  const out = [];
  let cur = arg;

  while (cur && typeof cur.type === 'string') {
    if (cur.type === 'MemberExpression') {
      cur = cur.object;
      continue;
    }
    if (cur.type === 'AwaitExpression') {
      // await ซ้อน → เจ้าของค่าคือ await ข้างใน ไม่ต้องไล่ต่อ
      break;
    }
    if (cur.type === 'CallExpression') {
      const name = calleeNameOf(cur);
      const returnsPromise = TERMINALS.has(name) || (name && asyncNames.has(name));
      if (returnsPromise && cur !== arg) out.push(cur);
      const c = cur.callee;
      if (!c || c.type === 'Identifier') break; // เรียกฟังก์ชันตรง → จบแกน
      cur = c.object; // ลงต่อที่ object ของเมธอด
      continue;
    }
    break;
  }
  return out;
}

function findIn(code, asyncNames = new Set()) {
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script' });
  const hits = [];
  const seen = new Set();

  walk.simple(ast, {
    AwaitExpression(node) {
      const arg = node.argument;
      if (!arg) return;
      for (const call of promiseCallsOnSpine(arg, asyncNames)) {
        const key = `${node.start}:${call.end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({
          awaitNode: node,
          // ใส่ "(" ก่อนคำว่า await (await ต้องอยู่ภายในวงเล็บ)
          insertOpen: node.start,
          closeAt: call.end,
          text: code.slice(node.start, call.end),
          line: code.slice(0, node.start).split('\n').length,
        });
      }
    },
  });

  return hits;
}

function projectFiles(args) {
  const out = [];
  if (args && args.length) {
    for (const a of args) if (a.endsWith('.js')) out.push(path.resolve(a));
    return out;
  }
  for (const root of ['routes', 'lib']) {
    const dir = path.join(__dirname, '..', root);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.js')) out.push(path.join(dir, f));
    }
  }
  return out;
}

function run({ fix = false, files: fileArgs = null } = {}) {
  const files = projectFiles(fileArgs);
  const asyncNames = require('./codemod-await-lib.js').collectAsyncNames(files);
  let total = 0;
  const details = [];

  for (const p of files) {
    let code = fs.readFileSync(p, 'utf8');
    let hits;
    try {
      hits = findIn(code, asyncNames);
    } catch (e) {
      console.log(`✖ ${path.relative(path.join(__dirname, '..'), p)}: parse error ${e.message}`);
      continue;
    }
    if (!hits.length) continue;
    total += hits.length;
    details.push({ file: path.relative(path.join(__dirname, '..'), p), hits, code });

    if (fix) {
      for (const h of hits.sort((a, b) => b.closeAt - a.closeAt)) {
        code = code.slice(0, h.closeAt) + ')' + code.slice(h.closeAt);
        code = code.slice(0, h.insertOpen) + '(' + code.slice(h.insertOpen);
      }
      fs.writeFileSync(p, code, 'utf8');
    }
  }
  return { total, details, asyncNames };
}

function main() {
  const res = run({ fix: FIX, files: process.argv.slice(2).filter(a=>!a.startsWith('--')) });
  for (const d of res.details) {
    console.log(`\n${d.file}: ${d.hits.length} จุด`);
    for (const h of d.hits) {
      console.log(`  [บรรทัด ${h.line}] …${h.text.slice(0, 110)}`);
    }
  }
  console.log(
    res.total === 0
      ? '\n✔ ไม่พบ pattern ที่พัง'
      : `\nรวม ${res.total} จุด (ฟังก์ชัน async ที่รู้จัก ${res.asyncNames.size} ตัว)`
  );
  if (FIX && res.total) console.log('→ แก้แล้ว');
}

if (require.main === module) main();

module.exports = { run, findIn, promiseCallsOnSpine };
