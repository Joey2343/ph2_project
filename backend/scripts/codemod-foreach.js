'use strict';
/**
 * Codemod: แปลง forEach ที่มี await ให้เป็น for...of
 *
 * เหตุผลที่ต้องแก้: forEach ไม่รอ promise — ถ้า callback เป็น async แล้ว
 *   arr.forEach(async (x) => { await db...run(x); })
 * โค้ดหลัง forEach จะทำงานต่อทันทีขณะที่ insert ยังไม่เสร็จ ทำให้ข้อมูลผิด
 *   (เช่น นับจำนวนผู้รับหนังสือก่อน insert ครบ)
 *
 * และ map(async ...) ต้องห่อด้วย Promise.all ไม่งั้นได้ array ของ promise
 *
 * ใช้: node scripts/codemod-foreach.js [--dry]
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const DRY = process.argv.includes('--dry');

function containsAwait(fn) {
  let found = false;
  walk.simple(fn, {
    AwaitExpression() {
      found = true;
    },
    FunctionDeclaration() {},
    FunctionExpression() {},
  });
  return found;
}

function parse(code) {
  return acorn.parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    allowAwaitOutsideFunction: true,
  });
}

function lineStart(code, index) {
  return code.lastIndexOf('\n', index) + 1;
}

function indentOf(code, index) {
  const ls = lineStart(code, index);
  const m = /^[ \t]*/.exec(code.slice(ls));
  return m ? m[0] : '';
}

/** ดึงชื่อพารามิเตอร์ของ callback */
function paramName(fn) {
  const p = fn.params[0];
  if (!p) return null;
  if (p.type === 'Identifier') return p.name;
  if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') return p.left.name;
  return null;
}

function transform(code) {
  let forEachCount = 0;
  let mapCount = 0;
  let out = code;

  // ทำทีละจุดพร้อม re-parse ทุกครั้ง
  // เหตุผล: forEach ที่ซ้อนกัน (เช่น schoolCodesS.forEach → clerks.forEach ข้างใน)
  // ถ้าแก้หลายจุดในรอบเดียว offset ของจุดที่อยู่นอกจะเพี้ยน ทำให้ไฟล์เสีย
  for (let guard = 0; guard < 500; guard += 1) {
    const step = findOne(out);
    if (!step) break;
    out = step.text;
    if (step.kind === 'forEach') forEachCount += 1;
    else mapCount += 1;
  }

  // ใส่ await ให้ Promise.all แล้วลบเครื่องหมายกันซ้ำ
  // (Promise.all คืน promise — ถ้าไม่ await ผลจะเป็น promise ไม่ใช่ array)
  out = out.replace(/Promise\.all\(/g, '__PROMISE_ALL__(');
  out = out.replace(/await __PROMISE_ALL__\(/g, 'Promise.all(');
  out = out.replace(/__PROMISE_ALL__\(/g, 'await Promise.all(');
  out = out.replace(/ \/\* __promiseall__ \*\//g, '');

  return { code: out, forEachCount, mapCount };
}

/** หา forEach/map ที่มี await จุดแรกที่พบ (เรียงจากในสุดออกมา) แล้วแปลงเฉพาะจุดนั้น */
function findOne(code) {
  const ast = parse(code);
  let best = null;

  walk.ancestor(ast, {
    CallExpression(node, ancestors) {
      const callee = node.callee;
      if (callee.type !== 'MemberExpression') return;
      const method = callee.property.name;
      if (method !== 'forEach' && method !== 'map') return;

      const last = node.arguments[node.arguments.length - 1];
      if (!last) return;
      const isFn =
        last.type === 'ArrowFunctionExpression' || last.type === 'FunctionExpression';
      if (!isFn) return;
      if (last.type === 'FunctionExpression' && last.id) return;
      if (last.async !== true && !containsAwait(last)) return;

      // ข้ามถ้าถูกห่อด้วย Promise.all ไปแล้ว — ไม่งั้นจะวนไม่จบ
      // ตรวจจากข้อความที่ต่อท้าย call แทนการไล่ ancestors
      // (ancestors ของ acorn-walk ไม่ตรงตามที่คาดในกรณี callee เป็น MemberExpression)
      if (method === 'map') {
        const after = code.slice(node.end, node.end + 40);
        if (/^\s*\)\s*\/\*\s*__promiseall__\s*\*\//.test(after)) return;
      }

      // เลือกจุดที่ "ลึกที่สุด" (start มากที่สุด) เพื่อไม่ให้ edit ซ้อนกัน
      if (!best || node.start > best.node.start) best = { node, callee, last, method };
    },
  });

  if (!best) return null;
  const { node, callee, last, method } = best;

  // ── map(async) → await Promise.all(map(async)) ───────────────────
  if (method === 'map') {
    const inner = code.slice(node.start, node.end);
    // ทำเครื่องหมายกันซ้ำด้วยคอมเมนต์ แล้วลบออกตอนสรุป
    return {
      kind: 'map',
      text:
        code.slice(0, node.start) +
        `Promise.all(${inner}) /* __promiseall__ */` +
        code.slice(node.end),
    };
  }

  // ── forEach(async) → for...of ────────────────────────────────────
  const name = paramName(last);
  if (!name) return null;
  const arrText = code.slice(callee.object.start, callee.object.end);

  let bodyText;
  if (last.body.type === 'BlockStatement') {
    bodyText = code.slice(last.body.start, last.body.end);
  } else {
    bodyText = `{ ${code.slice(last.body.start, last.body.end)}; }`;
  }

  const baseIndent = indentOf(code, node.start);
  const replacement = `for (const ${name} of ${arrText}) ${reindent(bodyText, baseIndent)}`;

  return {
    kind: 'forEach',
    text:
      code.slice(0, node.start) +
      replacement +
      code.slice(node.end),
  };
}

/** ปรับเยื้องบล็อกให้ตรงกับระดับที่ forEach เดิมอยู่ */
function reindent(blockText, baseIndent) {
  const lines = blockText.split('\n');
  if (lines.length <= 1) return blockText;
  const out = [lines[0]];
  for (let i = 1; i < lines.length; i += 1) {
    // ลดเยื้องเดิมลง 2 ช่อง (เพราะ callback เคยซ้อนอยู่ใน forEach)
    out.push(lines[i].replace(/^ {2}/, ''));
  }
  return out.join('\n');
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

  for (const file of targets) {
    const code = fs.readFileSync(file, 'utf8');
    let res;
    try {
      res = transform(code);
    } catch (err) {
      console.error(`✖ ${file}: ${err.message}`);
      continue;
    }
    const rel = path.relative(path.join(__dirname, '..'), file);
    if (!res.forEachCount && !res.mapCount) continue;
    if (!DRY) fs.writeFileSync(file, res.code, 'utf8');
    console.log(
      `${DRY ? '?' : '✔'} ${rel}: forEach→for-of ${res.forEachCount} · map→Promise.all ${res.mapCount}`
    );
  }
}

/** รัน transform กับทุกไฟล์ใน routes/ และ lib/ (ใช้โดย port-to-async.js) */
function transformAll() {
  const out = [];
  for (const root of ['routes', 'lib']) {
    const dir = path.join(__dirname, '..', root);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.js')) continue;
      const p = path.join(dir, f);
      const code = fs.readFileSync(p, 'utf8');
      const r = transform(code);
      if (r.code !== code) fs.writeFileSync(p, r.code, 'utf8');
      out.push({
        name: `${root}/${f}`,
        forEachCount: r.forEachCount,
        mapCount: r.mapCount,
      });
    }
  }
  return out;
}

if (require.main === module) main();

module.exports = { transform, transformAll };
