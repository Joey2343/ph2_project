'use strict';
/**
 * ตรวจว่าไม่มี `return` ที่หลุดออกมาถึงฟังก์ชันรอบนอกผ่านทางลูป
 *
 * ทำไมต้องตรวจ (บั๊กที่เคยเจอจริงในระบบนี้)
 * ---------------------------------------------------------------------------
 * โค้ดแบบนี้ดูเหมือนจะทำงานถูก แต่พังเงียบ:
 *
 *     for (const s of clerks) { return await insertRecip.run(docId, s) };
 *
 * `return` ในลูปจะออกจาก **ฟังก์ชันที่อยู่รอบลูปทั้งกลับ** ไม่ใช่ออกจากลูป
 * ถ้าฟังก์ชันนั้นคือ route handler ของ Express บรรทัด `res.json(...)` ที่อยู่ถัดไป
 * จะไม่เคยถูกเรียก → เบราว์เซอร์รอจน timeout ผู้ใช้ไม่เห็นข้อความสำเร็จ
 * แถวที่เหลือในลูป (เช่น insert คนที่ 2, 3) ก็ไม่ถูกทำด้วย
 *
 * ต้องเขียนเป็น:
 *     for (const s of clerks) { await insertRecip.run(docId, s) };
 *
 * ข้อยกเว้นที่ถูกต้อง: `return` ที่อยู่ใน callback (function/arrow) ที่ประกาศไว้
 * ข้างในลูป เพราะ return ของ callback ไม่กระทบ handler — เครื่องมือนี้จะข้ามให้
 *
 * ใช้: node scripts/check-returns.js
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const BACKEND = path.join(__dirname, '..');
const PROJECT = path.join(BACKEND, '..');

/** โฟลเดอร์ที่ไม่ต้องสแกน (node_modules · ผลลัพธ์ build · ซอร์สระบบเก่า) */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'uploads', 'legacy', 'ported-views']);

/**
 * สแกนเฉพาะโค้ดที่รันตอนให้บริการจริง
 * (ไม่สแกน backend/scripts · backend/test · frontend/scripts เพราะเป็นเครื่องมือทดสอบ
 *  ซึ่ง return ในลูปไม่ทำให้ผู้ใช้ค้าง)
 */
const TARGETS = [
  { root: path.join(BACKEND, 'routes'), exts: ['.js'] },
  { root: path.join(BACKEND, 'lib'), exts: ['.js'] },
  { root: BACKEND, exts: ['.js'], maxDepth: 0, only: ['server.js', 'db.js'] },
  { root: path.join(PROJECT, 'frontend', 'src'), exts: ['.js', '.vue'] },
];

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);
const LOOP_TYPES = /^(ForStatement|ForOfStatement|ForInStatement|WhileStatement|DoWhileStatement)$/;

const findings = [];
let parsed = 0;
let unreadable = 0;

function walk(dir, exts, depth, maxDepth, only) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < maxDepth) out.push(...walk(full, exts, depth + 1, maxDepth, null));
    } else if (only) {
      if (only.includes(e.name)) out.push(full);
    } else if (exts.includes(path.extname(e.name))) {
      out.push(full);
    }
  }
  return out;
}

function collect() {
  const files = [];
  for (const t of TARGETS) {
    if (!fs.existsSync(t.root)) continue;
    files.push(...walk(t.root, t.exts, 0, t.maxDepth === undefined ? 99 : t.maxDepth, t.only || null));
  }
  // กันไว้กรณีมีการกำหนด TARGETS ซ้ำ — ไม่ให้สแกนซ้ำแล้วรายงานเบิ้ล
  return [...new Set(files)];
}

/** ไล่ AST เพื่อหา return ที่อยู่ในลูป แต่ไม่ได้อยู่ใน callback ซ้อน */
function scan(node, src, label, lineOffset, fnDepth, loopDepth) {
  if (!node || typeof node.type !== 'string') return;

  let nextFn = fnDepth;
  let nextLoop = loopDepth;

  if (FUNCTION_TYPES.has(node.type)) {
    // เข้าฟังก์ชันใหม่ → return ข้างในไม่หลุดออกมาถึง handler
    nextFn = fnDepth + 1;
    nextLoop = 0;
  } else if (LOOP_TYPES.test(node.type)) {
    nextLoop = loopDepth + 1;
  } else if (node.type === 'ReturnStatement' && loopDepth > 0) {
    // ข้ามไปก่อน ถ้าบรรทัดนั้นมีเครื่องหมายยืนยันว่าตั้งใจออกจากลูปจริง ๆ
    // เช่น "ค้นหาค่าแรกที่เจอแล้วเลิก" — เขียนไว้ท้ายบรรทัดว่า  // loop-exit
    const tail = src.slice(node.end);
    const nl = tail.indexOf('\n');
    const sameLine = nl === -1 ? tail : tail.slice(0, nl);
    if (!/\/\/\s*loop-exit\b/.test(sameLine)) {
      findings.push({
        label,
        line: lineOffset + node.loc.start.line,
        code: src.slice(node.start, node.end).replace(/\s+/g, ' ').slice(0, 100),
      });
    }
  }

  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const child of v) {
        if (child && typeof child === 'object' && child.type) scan(child, src, label, lineOffset, nextFn, nextLoop);
      }
    } else if (v && typeof v === 'object' && v.type) {
      scan(v, src, label, lineOffset, nextFn, nextLoop);
    }
  }
}

function parseCode(code, label, lineOffset) {
  const opts = {
    ecmaVersion: 'latest',
    locations: true,
    allowReturnOutsideFunction: true,
  };
  // backend เป็น CommonJS · frontend เป็น ESM — ลองทั้งสองแบบ
  for (const sourceType of ['script', 'module']) {
    try {
      const ast = acorn.parse(code, { ...opts, sourceType });
      parsed += 1;
      scan(ast, code, label, lineOffset, 0, 0);
      return true;
    } catch (e) {
      /* ลองแบบถัดไป */
    }
  }
  unreadable += 1;
  return false;
}

function checkFile(file) {
  const full = fs.readFileSync(file, 'utf8');
  const label = path.relative(PROJECT, file).split(path.sep).join('/');

  if (path.extname(file) !== '.vue') {
    parseCode(full, label, 0);
    return;
  }

  // .vue → ดึงเฉพาะบล็อก <script> แล้วนับบรรทัดให้ตรงกับไฟล์จริง
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(full)) !== null) {
    const lineOffset = full.slice(0, m.index).split('\n').length - 1;
    parseCode(m[1], label, lineOffset);
  }
}

function main() {
  const files = collect();
  for (const f of files) checkFile(f);

  if (findings.length === 0) {
    console.log(`✔ ไม่พบ return ที่หลุดออกจากลูป (${files.length} ไฟล์ · parse ผ่าน ${parsed} ส่วน)`);
    return 0;
  }

  console.log(`✖ พบ ${findings.length} จุดที่ return หลุดออกจากลูป (จะทำให้ Express ไม่ตอบกลับ):\n`);
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.label)) byFile.set(f.label, []);
    byFile.get(f.label).push(f);
  }
  for (const [label, list] of byFile) {
    console.log(`  ${label}`);
    for (const f of list) console.log(`    บรรทัด ${f.line}: ${f.code}`);
    console.log('');
  }
  console.log('  แก้โดยเปลี่ยน `return` เป็น `continue` (หรือเอาออกถ้าไม่จำเป็น)');
  console.log('  เพราะ return ในลูปจะออกจากฟังก์ชันรอบนอกทั้งกลับ ไม่ใช่ออกจากลูป');
  return 1;
}

process.exit(main());