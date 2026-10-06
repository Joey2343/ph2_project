'use strict';
/**
 * กู้คืนสคริปต์บำรุงรักษา 6 ไฟล์ หลังจาก port-maintenance.js ห่อผิด
 *
 * บริบท
 *   port-maintenance.js รุ่นแรกสร้างไฟล์ผิด 2 จุด:
 *     1. คำว่า 'use strict' แรกหาย quote  (เขียนเป็น use strict;)
 *     2. 'use strict'; ต้นฉบับไปตกอยู่ภายใน main() ทำให้ require ซ้ำ
 *
 *   เนื้อหาโค้ดเดิมยังอยู่ครบ เพียงถูกห่อผิด → ดึง body ออกจากไฟล์ที่ห่อไว้
 *   แล้วประกอบใหม่ด้วยโครงสร้างที่ถูกต้อง
 *
 * ใช้: node scripts/restore-maintenance.js [--dry]
 */
const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const HERE = __dirname;

const TARGETS = [
  'import_schools.js',
  'migrate-uploads.js',
  'update-db-paths.js',
  'update-memo-sigs.js',
  'check-leave-sigs.js',
  'check-memo-sigs.js',
];

/** หัวไฟล์ที่ port-maintenance เขียนไว้ */
const HEADER_RE =
  /^\/\*\*\r?\n \* คำสั่งบำรุงรักษาฐานข้อมูล — port มาใช้ DB adapter แบบ async แล้ว[\s\S]*?\*\/\r?\n/;

/** ตัวคั่นระหว่างส่วนบนของ main() กับเนื้อหา */
const BODY_MARKER = '  await db.bootstrap();\r\n\r\n';
/** ตัวจบของ main() */
const MAIN_END = '\r\n}\r\n\r\nmain()';

function restore(file) {
  // ทำงานกับ LF เสมอ เพื่อไม่ให้ผิดพลาดจากเรื่องปลายบรรทัด
  const code = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

  if (!code.includes('async function main()')) {
    return { status: 'skip', message: 'ไม่ได้ถูกห่อ (ไม่ต้องกู้)' };
  }

  // ── ดึงเนื้อหาที่อยู่ใน main() ──────────────────────────────────
  const markerIdx = code.indexOf('  await db.bootstrap();\n\n');
  if (markerIdx === -1) return { status: 'error', message: 'หา body marker ไม่พบ' };
  const bodyStart = markerIdx + '  await db.bootstrap();\n\n'.length;

  const endIdx = code.indexOf('\n}\n\nmain()');
  if (endIdx === -1) return { status: 'error', message: 'หาปลาย main() ไม่พบ' };

  const rawBody = code
    .slice(bodyStart, endIdx)
    .split('\n')
    .map((l) => (l.startsWith('  ') ? l.slice(2) : l));

  // ── เก็บเฉพาะ directive และ require ที่อยู่นอก main() ─────────────
  const requires = [];
  const isDirective = (l) => /^'use strict';$/.test(l.trim());
  const isRequire = (l) => /^(const|let|var)\s+\w+\s*=\s*require\(/.test(l.trim());

  // ตัวบนของไฟล์: หยุดที่คอมเมนต์ /** แรก
  const topLines = code.split('\n');
  for (const l of topLines) {
    if (l.trim().startsWith('/**')) break;
    if (isDirective(l) || isRequire(l)) requires.push(l.trim());
  }

  // ── ตัด directive/require ที่ถูกห่อเข้าไปใน main() ออก ───────────
  let i = 0;
  while (i < rawBody.length) {
    const t = rawBody[i].trim();
    if (t === '' || isDirective(rawBody[i]) || isRequire(rawBody[i])) {
      i += 1;
      continue;
    }
    break;
  }
  const restored = rawBody.slice(i).join('\n');

  const writes = /INSERT|UPDATE|DELETE/i.test(restored);

  const out = [
    ...requires,
    '',
    '/**',
    ' * คำสั่งบำรุงรักษาฐานข้อมูล — port มาใช้ DB adapter แบบ async แล้ว',
    ' *',
    ' * ใช้: node scripts/' + path.basename(file),
    ...(writes
      ? [' *', ' * ⚠ สคริปต์นี้เขียน/ลบข้อมูลจริง ควรรันกับสำเนาฐานข้อมูลก่อนเสมอ']
      : []),
    ' */',
    '',
    'async function main() {',
    '  await db.init();',
    '  await db.bootstrap();',
    '',
    restored
      .split('\n')
      .map((l) => (l.trim() ? '  ' + l : l))
      .join('\n'),
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
  ].join('\n');

  if (!DRY) fs.writeFileSync(file, out, 'utf8');
  return { status: 'ok', message: 'กู้คืนแล้ว' };
}

function main() {
  for (const name of TARGETS) {
    const f = path.join(HERE, name);
    if (!fs.existsSync(f)) {
      console.log(`– ${name}: ไม่พบไฟล์`);
      continue;
    }
    const r = restore(f);
    console.log(`${r.status === 'ok' ? '✔' : r.status === 'skip' ? '–' : '✖'} ${name}: ${r.message}`);
  }
}

if (require.main === module) main();

module.exports = { restore };
