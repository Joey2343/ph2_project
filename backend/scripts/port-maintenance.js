'use strict';
/**
 * Port สคริปต์บำรุงรักษาของเดิม (6 ไฟล์) ให้ใช้ DB adapter ตัวเดียวกับโค้ดหลัก
 *
 * ทำไมต้องทำ
 *   สคริปต์เหล่านี้เขียนไว้ตอน backend ยังเป็น synchronous และเรียก better-sqlite3
 *   ซึ่งถูกถอดออกไปแล้ว (เปลี่ยนเป็น node:sqlite + async adapter)
 *   ถ้าไม่แก้ สคริปต์จะพังทันทีที่รัน
 *
 * สิ่งที่สคริปต์นี้ทำ
 *   1. เติม await ที่จุดเรียก SQL
 *   2. forEach(async) → for...of
 *   3. ทำให้ฟังก์ชันที่มี await เป็น async
 *   4. await ที่จุดเรียกฟังก์ชัน async
 *   5. แก้ (await fn()).prop
 *   6. ห่อโค้ดระดับบนสุดเป็น async main() + เปิด/ปิดการเชื่อมต่อ
 *
 * ใช้: node scripts/port-maintenance.js [--dry]
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const DRY = process.argv.includes('--dry');
const HERE = __dirname;

/** สคริปต์ของเดิมที่ต้อง port */
const TARGETS = [
  'import_schools.js',
  'migrate-uploads.js',
  'update-db-paths.js',
  'update-memo-sigs.js',
  'check-leave-sigs.js',
  'check-memo-sigs.js',
];

function main() {
  const files = TARGETS.map((f) => path.join(HERE, f));
  const existing = files.filter((f) => fs.existsSync(f));
  if (existing.length !== TARGETS.length) {
    console.log(`พบ ${existing.length}/${TARGETS.length} ไฟล์`);
  }

  console.log('[1] codemod-async (เติม await / async / backtick)');
  {
    const { transform } = require('./codemod-async');
    let total = 0;
    for (const f of existing) {
      const code = fs.readFileSync(f, 'utf8');
      const r = transform(code, f);
      if (r.out !== code) {
        total += r.awaitCount;
        if (!DRY) fs.writeFileSync(f, r.out, 'utf8');
      }
    }
    console.log(`    await +${total}`);
  }

  console.log('[2] codemod-foreach (forEach(async) → for...of)');
  {
    const { transform } = require('./codemod-foreach');
    let n = 0;
    for (const f of existing) {
      const code = fs.readFileSync(f, 'utf8');
      const r = transform(code);
      if (r.code !== code) {
        n += r.forEachCount;
        if (!DRY) fs.writeFileSync(f, r.code, 'utf8');
      }
    }
    console.log(`    แก้ ${n} จุด`);
  }

  console.log('[3] codemod-async-propagate');
  {
    const { transformAll } = require('./codemod-async-propagate');
    let n = 0;
    for (const r of transformAll(existing)) n += r.propagated || 0;
    console.log(`    async +${n}`);
  }

  console.log('[4] codemod-await-lib');
  {
    const mod = require('./codemod-await-lib');
    const names = mod.collectAsyncNames(existing);
    let n = 0;
    for (const f of existing) {
      const code = fs.readFileSync(f, 'utf8');
      const r = mod.transform(code, names);
      if (r.count) {
        n += r.count;
        if (!DRY) fs.writeFileSync(f, r.code, 'utf8');
      }
    }
    console.log(`    await +${n}`);
  }

  console.log('[5] check-await-parens');
  {
    const mod = require('./check-await-parens');
    const res = mod.run({ fix: !DRY, files: existing });
    console.log(`    แก้ ${res.total} จุด`);
  }

  console.log('[6] ห่อโค้ดระดับบนสุดเป็น main()');
  for (const f of existing) {
    const r = wrapTopLevel(f);
    console.log(`    ${DRY ? '?' : '✔'} ${path.basename(f)} — ${r.message}`);
  }

  console.log('\nตรวจ syntax');
  let bad = 0;
  for (const f of existing) {
    try {
      acorn.parse(fs.readFileSync(f, 'utf8'), {
        ecmaVersion: 'latest',
        sourceType: 'script',
        allowAwaitOutsideFunction: true,
      });
    } catch (e) {
      console.log(`  ✖ ${path.basename(f)}: ${e.message}`);
      bad += 1;
    }
  }
  console.log(bad === 0 ? '  ✔ ทุกไฟล์ถูกต้อง' : `  ✖ ${bad} ไฟล์`);
}

/**
 * ห่อโค้ดระดับบนสุดของสคริปต์เป็น async main()
 *
 * สคริปต์ของเดิมเขียนโค้ดไว้ที่ระดับ module (บางส่วนเรียก db.prepare ตรง ๆ)
 * พอ SQL ต้อง await โค้ดระดับบนสุดจึงใช้ไม่ได้ → ต้องห่อเป็นฟังก์ชัน
 *
 * ต้องแยกให้ถูก 3 ส่วน
 *   1. directive prologue  ('use strict';)      → นอก main()
 *   2. require ที่อยู่ต้นไฟล์                  → นอก main()
 *   3. โค้ดที่เหลือ (เรียก db จริง)               → อยู่ใน main()
 * ถ้าปนกันจะได้ require ซ้ำ และ 'use strict' ผิดตำแหน่ง
 */
function wrapTopLevel(file) {
  const code = fs.readFileSync(file, 'utf8');
  if (code.includes('async function main()')) return { message: 'ห่อไว้แล้ว' };

  const ast = acorn.parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    allowAwaitOutsideFunction: true,
  });

  const directives = [];
  const requires = [];
  let bodyStart = null;
  let bodyEnd = 0;

  for (const node of ast.body) {
    // 'use strict';  → directive prologue
    if (
      bodyStart === null &&
      node.type === 'ExpressionStatement' &&
      node.expression.type === 'Literal' &&
      typeof node.expression.value === 'string' &&
      !node.expression.raw.startsWith('"')
    ) {
      directives.push(code.slice(node.start, node.end));
      continue;
    }

    // const x = require('...')  (ต้องอยู่ต้นไฟล์ต่อเนื่องกัน)
    const isRequire =
      bodyStart === null &&
      node.type === 'VariableDeclaration' &&
      node.declarations.every(
        (d) =>
          d.init &&
          d.init.type === 'CallExpression' &&
          d.init.callee.type === 'Identifier' &&
          d.init.callee.name === 'require'
      );
    if (isRequire) {
      requires.push(code.slice(node.start, node.end));
      continue;
    }

    if (bodyStart === null) bodyStart = node.start;
    bodyEnd = node.end;
  }

  if (bodyStart === null) return { message: 'ไม่มีโค้ดระดับบนสุด' };

  const body = code.slice(bodyStart, bodyEnd);
  const indented = body
    .split(/\r?\n/)
    .map((l) => (l.trim() ? '  ' + l : l))
    .join('\n');
  const writes = /INSERT|UPDATE|DELETE/i.test(body);

  const lines = [
    ...directives,
    ...(directives.length && requires.length ? [''] : []),
    ...requires,
    ...(requires.length ? [''] : []),
    '/**',
    ' * คำสั่งบำรุงรักษาฐานข้อมูล — port มาใช้ DB adapter แบบ async แล้ว',
    ' *',
    ' * ใช้: node scripts/' + path.basename(file),
    ...(writes ? [' *', ' * ⚠ สคริปต์นี้เขียน/ลบข้อมูลจริง ควรรันกับสำเนาฐานข้อมูลก่อนเสมอ'] : []),
    ' */',
    '',
    'async function main() {',
    '  await db.init();',
    '  await db.bootstrap();',
    '',
    indented,
    '}',
    '',
    'main()',
    '  .then(async () => {',
    '    await db.close();',
    '  })',
    '  .catch(async (err) => {',
    '    console.error(err);',
    '    try {',
    '      await db.close();',
    '    } catch {',
    '      /* ปิดการเชื่อมต่อไม่สำเร็จ — ไม่เป็นไร */',
    '    }',
    '    process.exit(1);',
    '  });',
    '',
  ];

  if (!DRY) fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return { message: 'ห่อเป็น main() แล้ว' };
}

if (require.main === module) main();
