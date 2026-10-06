'use strict';
/**
 * เทียบ "ค่า string ทั้งหมด" ในไฟล์ใหม่ กับต้นฉบับ โดยเทียบที่ระดับ AST
 *
 * ข้อความไทยใน seed / ข้อความแจ้งเตือน คือข้อมูลที่ refactor อัตโนมัติแก้ไม่ได้
 * การเทียบระดับ AST จึงแม่นกว่าการเทียบข้อความในไฟล์ (ซึ่งเปราะต่อการจัดรูปแบบ)
 *
 * ใช้: node scripts/check-strings.js [ไฟล์ใหม่] [ไฟล์ต้นฉบับ] [--all]
 *   --all  แสดง string ทั้งหมด (ค่าเริ่มต้น: เฉพาะตัวที่มีภาษาไทย)
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const showAll = process.argv.includes('--all');
const NEW = argv[0] || path.join(__dirname, '..', 'db.js');
const OLD = argv[1] || path.join(__dirname, '..', '..', 'docs', 'legacy', 'source-v1', 'db.js');

const THAI = /[฀-๿]/;

function collect(file) {
  const code = fs.readFileSync(file, 'utf8');
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script' });
  const out = new Map();

  walk.simple(ast, {
    Literal(node) {
      if (typeof node.value !== 'string') return;
      const v = node.value;
      if (!showAll && !THAI.test(v)) return;
      if (v.length < 3) return;
      out.set(v, (out.get(v) || 0) + 1);
    },
    TemplateLiteral(node) {
      // รวมเฉพาะ template ที่ไม่มี ${} — ค่าเป็นข้อความคงที่
      if (node.expressions.length > 0) return;
      const v = node.quasis.map((q) => q.value.cooked ?? q.value.raw).join('');
      if (!showAll && !THAI.test(v)) return;
      if (v.length < 3) return;
      out.set(v, (out.get(v) || 0) + 1);
    },
  });
  return out;
}

if (!fs.existsSync(OLD)) {
  console.log(`ไม่พบไฟล์ต้นฉบับ: ${OLD}`);
  process.exit(0);
}

const n = collect(NEW);
const o = collect(OLD);

const lost = [];
const changed = [];
for (const [val, count] of o) {
  if (!n.has(val)) {
    // หาค่าใกล้เคียงในไฟล์ใหม่เพื่อบอกว่าต่างตรงไหน
    let near = null;
    for (const nv of n.keys()) {
      if (similar(nv, val)) {
        near = nv;
        break;
      }
    }
    if (near) changed.push({ from: val, to: near, at: firstDiff(val, near) });
    else lost.push({ val, count });
  }
}

console.log(`ต้นฉบับ ${o.size} ค่า · ใหม่ ${n.size} ค่า\n`);

if (changed.length) {
  console.log(`=== ต่างจากต้นฉบับ (${changed.length}) ===`);
  for (const c of changed) {
    console.log(`  ต้นฉบับ: ${JSON.stringify(c.from)}`);
    console.log(`  ใหม่    : ${JSON.stringify(c.to)}`);
    if (c.at) {
      const cp = (ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
      console.log(`  ผิดที่  : index ${c.at[2]} · ต้นฉบับ=${c.at[0]} (${cp(c.at[0])}) · ใหม่=${c.at[1]} (${cp(c.at[1])})`);
    }
    console.log('');
  }
}

if (lost.length) {
  console.log(`=== หายไปจริง (${lost.length}) ===`);
  for (const l of lost) console.log(`  - ${JSON.stringify(l.val)}  ×${l.count}`);
}

if (!changed.length && !lost.length) {
  console.log('✔ ข้อความภาษาไทยทุกชิ้นตรงกับต้นฉบับ');
}

function similar(a, b) {
  if (Math.abs(a.length - b.length) > 8) return false;
  let same = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] === b[i]) same += 1;
  return same / Math.min(a.length, b.length) > 0.9;
}

function firstDiff(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return [a[i] || '(จบ)', b[i] || '(จบ)', i];
  }
  return null;
}
