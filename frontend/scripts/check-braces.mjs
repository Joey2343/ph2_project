/**
 * นับวงเล็บปีกกาโดยข้าม comment และ string
 * ใช้ตอน node --check บอก "Unexpected end of input" แต่บอกไม่ได้ว่าบรรทัดไหน
 *
 * ใช้: node scripts/check-braces.mjs <ไฟล์>
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('ใช้: node scripts/check-braces.mjs <ไฟล์>');
  process.exit(2);
}

const src = readFileSync(path.resolve(file), 'utf8');

let depth = 0;
let line = 1;
let str = null;
let cmt = null;
const stack = [];

for (let i = 0; i < src.length; i++) {
  const c = src[i];
  const n = src[i + 1];

  if (c === '\n') {
    line++;
    continue;
  }

  if (cmt === 'line') {
    if (c === '\n') cmt = null;
    continue;
  }
  if (cmt === 'block') {
    if (c === '*' && n === '/') {
      cmt = null;
      i++;
    }
    continue;
  }
  if (str) {
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === str) str = null;
    continue;
  }

  if (c === '/' && n === '/') {
    cmt = 'line';
    i++;
    continue;
  }
  if (c === '/' && n === '*') {
    cmt = 'block';
    i++;
    continue;
  }
  if (c === "'" || c === '"' || c === '`') {
    str = c;
    continue;
  }

  if (c === '{' || c === '(' || c === '[') {
    depth++;
    stack.push({ ch: c, line });
  } else if (c === '}' || c === ')' || c === ']') {
    const want = { '}': '{', ')': '(', ']': '[' }[c];
    const top = stack.pop();
    depth--;
    if (!top) {
      console.log(`  เกิน ${c} ที่บรรทัด ${line} (ไม่มีคู่เปิด)`);
    } else if (top.ch !== want) {
      console.log(`  บรรทัด ${line}: เจอ ${c} แต่ที่เปิดไว้คือ ${top.ch} (บรรทัด ${top.line})`);
    }
  }
}

console.log(`  ${path.basename(file)}: ยอดคงเหลือ = ${depth}`);
if (stack.length) {
  console.log(`  ยังไม่ปิด ${stack.length} ตัว:`);
  for (const s of stack.slice(-6)) console.log(`    ${s.ch} ที่บรรทัด ${s.line}`);
}
process.exit(depth === 0 && stack.length === 0 ? 0 : 1);
