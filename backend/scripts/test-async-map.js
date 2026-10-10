/**
 * ตรวจว่า endpoint ที่คืน array ไม่หลุด Promise ออกมา
 * (rows.map(async ...) → JSON.stringify ได้ [{}])
 *
 * ทำไมต้องมี
 * ──────────
 *   [].map(async (x) => ({ ...x, extra: await f() }))  →  [Promise, Promise]
 *   JSON.stringify(Promise)  →  {}
 *   ผู้ใช้เห็นแถวที่ว่างเปล่า กดลบไม่ได้ เพราะไม่มี id
 *
 * เคยเกิดจริง: GET /api/memos และ GET /api/travel คืน [{}] ทั้งหมด
 */
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
}

/** หาไฟล์ .js ใต้ backend/ (ข้าม node_modules) */
function* walk(dir) {
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    if (n.name === 'node_modules') continue;
    const p = path.join(dir, n.name);
    if (n.isDirectory()) yield* walk(p);
    else if (n.name.endsWith('.js')) yield p;
  }
}

const ROOT = path.join(__dirname, '..');

/** ไล่หา `.map(async ...)` ที่ไม่ได้อยู่ใต้ Promise.all */
function findSuspects() {
  const out = [];
  for (const file of walk(ROOT)) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (rel.startsWith('scripts/')) continue;   // ตัวทดสอบเองใช้ .map(async) ได้
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!/\.map\(\s*async/.test(line)) return;
      const prev = lines[i - 1] || '';
      // อยู่ใต้ Promise.all( ... ) → ถูกต้อง
      if (/Promise\.all\s*\(\s*$/.test(prev)) return;
      if (/Promise\.all/.test(prev + line)) return;
      out.push(`${rel}:${i + 1}  ${line.trim().slice(0, 110)}`);
    });
  }
  return out;
}

async function main() {
  console.log('=== ตรวจ array ที่หลุด Promise (ทำให้ API คืน [{}]) ===');
  console.log('');

  // ── 1. สแกนโค้ดทั้ง backend ──
  const suspects = findSuspects();
  check(
    suspects.length === 0,
    'ไม่มี .map(async ...) ที่หลุด Promise ออกไปนอก Promise.all',
    suspects.join('\n      '),
  );

  // ── 2. พฤติกรรมจริงของ JSON.stringify กับ Promise ──
  const shaped = [{ id: 1, title: 'ทดสอบ' }].map(async (x) => ({ ...x, extra: await Promise.resolve(2) }));
  check(
    JSON.stringify(shaped) === '[{}]',
    'JSON.stringify([Promise]) = [{}] — ตรงกับอาการที่ผู้ใช้เจอ',
    JSON.stringify(shaped),
  );

  // ── 3. วิธีแก้ที่ถูกต้อง ──
  const awaited = await Promise.all(shaped);
  check(
    JSON.stringify(awaited) === '[{"id":1,"title":"ทดสอบ","extra":2}]',
    'ห่อด้วย await Promise.all แล้วข้อมูลกลับมาครบ',
    JSON.stringify(awaited),
  );

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  console.log('');
  // ต้อง exit ตรงนี้เท่านั้น — ถ้า exit นอก main() จะตัดก่อน await ครบ
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});