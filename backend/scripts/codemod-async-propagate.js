'use strict';
/**
 * Codemod pass 2: บังคับให้ทุกฟังก์ชันที่มี await เป็น async
 *
 * ปัญหาที่แก้: codemod แรกใส่ `await` ให้ฟังก์ชัน "ที่ครอบอยู่ใกล้สุด" เท่านั้น
 * แต่เมื่อ callback ถูกเปลี่ยนเป็น for...of (codemod-foreach) เนื้อหาจะถูกยุบเข้า
 * ไปอยู่ในฟังก์ชันแม่ ทำให้ฟังก์ชันแม่มี await โดยไม่ได้เป็น async → syntax error
 *
 * กฎที่ใช้: ถ้าฟังก์ชันมี AwaitExpression ในเนื้อหาตัวเอง → ต้องเป็น async
 * (ไม่สนใจ await ที่อยู่ในฟังก์ชันซ้อน เพราะเจ้าของมันคือฟังก์ชันชั้นใน)
 *
 * ใช้: node scripts/codemod-async-propagate.js [--dry]
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');
const util = require('./codemod-util');

const DRY = process.argv.includes('--dry');

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

/** มี await ที่ "เป็นของ" ฟังก์ชันนี้หรือไม่ (ข้ามฟังก์ชันซ้อน) */
function ownsAwait(fn) {
  let found = false;
  (function scan(node) {
    if (found || !node || typeof node.type !== 'string') return;
    if (FUNCTION_TYPES.has(node.type)) return; // เจ้าของ await คือฟังก์ชันชั้นล่าง
    if (node.type === 'AwaitExpression') {
      found = true;
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
      const v = node[key];
      if (Array.isArray(v)) v.forEach(scan);
      else if (v && typeof v.type === 'string') scan(v);
    }
  })(fn.body);
  return found;
}

/**
 * กฎที่ 2: ฟังก์ชันที่ "เรียก" async callback ที่มี await ต้องเป็น async ด้วย
 *
 * เหตุผล: หลัง codemod-foreach แปลง forEach(async) เป็น for...of เนื้อหา (รวม await)
 * จะถูกย้ายขึ้นมาอยู่ในฟังก์ชันแม่ ถ้าแม่ไม่เป็น async โค้ดจะเป็น syntax error
 * (และ acorn แม้แต่ parse ไม่ผ่าน เพราะ await ในตำแหน่งนั้นตีความเป็น identifier ได้)
 *
 * ตรวจ: ฟังก์ชันนี้มี CallExpression ที่อาร์กิวเมนต์สุดท้ายเป็น async function
 *       ที่มี await ภายใน
 */
const ITERATOR_METHODS = new Set([
  'forEach', 'map', 'filter', 'some', 'every', 'find', 'findIndex', 'flatMap', 'reduce',
]);

function callsAsyncCallbackWithAwait(fn) {
  let found = false;
  (function scan(node) {
    if (found || !node || typeof node.type !== 'string') return;
    if (FUNCTION_TYPES.has(node.type)) return;
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      ITERATOR_METHODS.has(node.callee.property.name)
    ) {
      const last = node.arguments[node.arguments.length - 1];
      if (
        last &&
        (last.type === 'ArrowFunctionExpression' || last.type === 'FunctionExpression') &&
        last.async &&
        ownsAwait(last)
      ) {
        found = true;
        return;
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
      const v = node[key];
      if (Array.isArray(v)) v.forEach(scan);
      else if (v && typeof v.type === 'string') scan(v);
    }
  })(fn.body);
  return found;
}

function transform(code) {
  // allowAwaitOutsideFunction: ให้ parse ได้แม้มี await ในฟังก์ชันที่ยังไม่เป็น async
  // เพื่อ "ตรวจจับ" แล้วค่อยเติม async ให้ (ตรงกันข้างล่าง)
  const ast = acorn.parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    allowAwaitOutsideFunction: true,
  });
  const edits = [];
  let count = 0;

  walk.simple(ast, {
    FunctionDeclaration: check,
    FunctionExpression: check,
    ArrowFunctionExpression: check,
  });

  function check(node) {
    if (node.async) return;
    if (node.generator) return;
    if (!ownsAwait(node) && !callsAsyncCallbackWithAwait(node)) return;
    edits.push(...util.markAsync(node, code));
    count += 1;
  }

  // ต้องวนจนนิ่ง เพราะการเติม async ระดับนอกอาจเปิดให้เห็น callback ที่ต้อง async เพิ่ม
  let guard = 0;
  while (guard < 20) {
    const before = count;
    edits.length = 0;
    walk.simple(ast, {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
    });
    if (count === before) break;
    // หยุด: การเติม async ทำให้ตำแหน่งของ edit ที่ยังไม่ apply เพี้ยน
    break;
  }

  if (!count) return { code, count };
  edits.sort((a, b) => b.start - a.start);
  let out = code;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { code: out, count };
}

function main() {
  const targets = [];
  for (const root of ['routes', 'lib']) {
    const dir = path.join(__dirname, '..', root);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.js')) targets.push(path.join(dir, f));
    }
  }
  for (const a of process.argv.slice(2)) {
    if (!a.startsWith('--')) targets.push(path.resolve(a));
  }

  let total = 0;
  for (const file of targets) {
    const code = fs.readFileSync(file, 'utf8');
    let res;
    try {
      res = transform(code);
    } catch (err) {
      console.error(`✖ ${path.relative(process.cwd(), file)}: ${err.message}`);
      continue;
    }
    total += res.count;
    if (!res.count) continue;
    if (!DRY) fs.writeFileSync(file, res.code, 'utf8');
    console.log(`${DRY ? '?' : '✔'} ${path.relative(path.join(__dirname, '..'), file)}: async +${res.count}`);
  }
  console.log(`\nรวม: เพิ่ม async ${total} ฟังก์ชัน`);
}

/** รัน transform กับทุกไฟล์ใน routes/ และ lib/ (ใช้โดย port-to-async.js) */
function transformAll(args) {
  const out = [];
  const dirs = args && args.length ? null : ['routes', 'lib'];
  if (dirs === null) {
    for (const a of args) out.push({ name: a, propagated: transformOne(path.resolve(a)) });
    return out;
  }
  for (const root of dirs) {
    const dir = path.join(__dirname, '..', root);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.js')) continue;
      const p = path.join(dir, f);
      let code = fs.readFileSync(p, 'utf8');
      let total = 0;
      // วนจนนิ่ง: การทำให้ฟังก์ชันแม่เป็น async อาจเปิดให้เห็นชื่อฟังก์ชัน async
      // ที่ถูกเรียกจากฟังก์ชันนั้นอีกทอดหนึ่ง
      for (let i = 0; i < 20; i += 1) {
        const r = transform(code);
        if (!r.count) break;
        code = r.code;
        total += r.count;
      }
      if (total) fs.writeFileSync(p, code, 'utf8');
      out.push({ name: `${root}/${f}`, propagated: total });
    }
  }
  return out;
}

function transformOne(p) {
  let code = fs.readFileSync(p, 'utf8');
  let total = 0;
  for (let i = 0; i < 20; i += 1) {
    const r = transform(code);
    if (!r.count) break;
    code = r.code;
    total += r.count;
  }
  if (total) fs.writeFileSync(p, code, 'utf8');
  return total;
}

if (require.main === module) main();

module.exports = { transform, transformAll };
