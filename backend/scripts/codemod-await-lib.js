'use strict';
/**
 * Codemod: เติม await ให้ทุกจุดที่เรียกฟังก์ชันที่กลายเป็น async
 *
 * ปัญหาที่แก้: เมื่อโค้ดใน lib/ กลายเป็น async จุดเรียกใน routes/ จะต้อง await ด้วย
 * มิฉะนั้นจะได้ Promise แทนค่าจริง (เช่น req.user เป็น Promise → 401 ทุก endpoint)
 * ตัวอย่างที่เจอจริง: auth.attachUser เรียก getSessionUser() โดยไม่ await
 *
 * วิธีทำ
 *   1. สแกนทุกไฟล์ รวบรวมชื่อฟังก์ชันที่เป็น async (FunctionDeclaration)
 *   2. สำหรับทุก CallExpression ที่เรียกชื่อนั้น (ทั้งแบบตรงและแบบ module.fn)
 *      ใส่ await ถ้ายังไม่มี
 *
 * ข้อจำกัดที่ตั้งใจยอมรับ
 *   - ถ้าชื่อฟังก์ชันถูก shadow ด้วยตัวแปร local จะใส่ await เกินมา
 *     (await บนค่าปกติไม่เป็นอันตราย แต่อาจทำให้ฟังก์ชันต้องเป็น async)
 *   - callback ที่ส่งเป็น "ค่า" ไม่ใช่การเรียก (เช่น .map(auth.publicUser))
 *     ไม่ได้แตะ เพราะไม่ใช่ CallExpression
 *
 * ใช้: node scripts/codemod-await-lib.js [--dry]
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');
const util = require('./codemod-util');

const DRY = process.argv.includes('--dry');
const BACKEND = path.join(__dirname, '..');
const DIRS = ['routes', 'lib'];

function files(args) {
  const out = [];
  if (args && args.length) {
    for (const a of args) if (a.endsWith('.js')) out.push(path.resolve(a));
    return out;
  }
  for (const d of DIRS) {
    const dir = path.join(BACKEND, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.js')) out.push(path.join(dir, f));
    }
  }
  return out;
}

function parse(code) {
  return acorn.parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    allowAwaitOutsideFunction: true,
  });
}

/** ชื่อฟังก์ชัน async ทั้งโปรเจกต์ */
function collectAsyncNames(list) {
  const names = new Set();
  for (const p of list) {
    const ast = parse(fs.readFileSync(p, 'utf8'));
    walk.simple(ast, {
      FunctionDeclaration(node) {
        if (node.async && node.id) names.add(node.id.name);
      },
    });
  }
  return names;
}

function alreadyAwaited(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const n = ancestors[i];
    if (n.type === 'AwaitExpression') return true;
    if (
      n.type === 'ExpressionStatement' ||
      n.type === 'VariableDeclaration' ||
      n.type === 'ReturnStatement'
    ) {
      return false;
    }
  }
  return false;
}

function calleeName(node) {
  const c = node.callee;
  if (c.type === 'Identifier') return c.name;
  if (
    c.type === 'MemberExpression' &&
    c.object.type === 'Identifier' &&
    c.property.type === 'Identifier'
  ) {
    // module.fn — ตรวจเฉพาะชื่อฟังก์ชัน
    return c.property.name;
  }
  return null;
}

function transform(code, asyncNames) {
  const ast = parse(code);
  const edits = [];
  const needAsync = new Set();
  let count = 0;

  walk.ancestor(ast, {
    CallExpression(node, ancestors) {
      const name = calleeName(node);
      if (!name) return;
      if (!asyncNames.has(name)) return;
      if (alreadyAwaited(ancestors)) return;
      edits.push({ start: node.start, end: node.start, text: 'await ' });
      count += 1;

      // ฟังก์ชันที่ครอบ await ต้องเป็น async ด้วย
      // (ทำใน pass เดียวกัน เพราะถ้าเขียนไฟล์ก่อนแล้วค่อยมาเติม async
      //  ระหว่างนั้นไฟล์จะ parse ไม่ผ่าน เพราะ await ตีความเป็น identifier ได้)
      for (let i = ancestors.length - 1; i >= 0; i -= 1) {
        const n = ancestors[i];
        if (
          n.type === 'FunctionDeclaration' ||
          n.type === 'FunctionExpression' ||
          n.type === 'ArrowFunctionExpression'
        ) {
          needAsync.add(n);
          break;
        }
      }
    },
  });

  for (const fn of needAsync) {
    if (fn.async) continue;
    edits.push(...util.markAsync(fn, code));
  }

  if (!edits.length) return { code, count, asyncAdded: 0 };
  edits.sort((a, b) => b.start - a.start);
  let out = code;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { code: out, count, asyncAdded: needAsync.size };
}

function main() {
  const list = files(process.argv.slice(2).filter(a=>!a.startsWith('--')));
  const asyncNames = collectAsyncNames(list);
  console.log(`พบฟังก์ชัน async ${asyncNames.size} ตัว`);

  let total = 0;
  for (const p of list) {
    const code = fs.readFileSync(p, 'utf8');
    const r = transform(code, asyncNames);
    if (!r.count) continue;
    total += r.count;
    if (!DRY) fs.writeFileSync(p, r.code, 'utf8');
    console.log(
      `${DRY ? '?' : '✔'} ${path.relative(BACKEND, p)}: await +${r.count}`
    );
  }
  console.log(`\nรวม await ที่เพิ่ม: ${total}`);
}

if (require.main === module) main();

module.exports = { transform, collectAsyncNames };
