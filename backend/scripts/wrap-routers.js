'use strict';
/**
 * ปรับไฟล์ route ให้ห่อ router ด้วยตัวจัดการ async error
 *
 * เหตุผล: หลังแปลงทุก handler เป็น async, Express 4 จะไม่จับ promise ที่ reject
 * ทำให้ request ค้างเงียบ ต้องส่ง error ผ่าน next(err) เพื่อให้เข้า error handler
 *
 * การแก้ที่ export แบบนี้ทำให้ diff มีเพียงบรรทัดเดียวต่อไฟล์
 */
const fs = require('fs');
const path = require('path');

const ROUTER_DIR = path.join(__dirname, '..', 'routes');
const DRY = process.argv.includes('--dry');

const NEEDLE = 'module.exports = router;';
const REPLACEMENT = [
  '// ห่อ router เพื่อจับ error จาก async handler (Express 4 ไม่ catch promise เอง)',
  "const { wrapRouter } = require('../lib/async-route');",
  'module.exports = wrapRouter(router);',
].join('\n');

function run({ dry = false } = {}) {
  const changed = [];
  for (const f of fs.readdirSync(ROUTER_DIR)) {
    if (!f.endsWith('.js')) continue;
    const p = path.join(ROUTER_DIR, f);
    const src = fs.readFileSync(p, 'utf8');
    if (src.includes('wrapRouter(router)')) continue;
    if (!src.includes(NEEDLE)) {
      console.error(`✖ ${f}: ไม่พบ "module.exports = router;" — ต้องแก้ด้วยมือ`);
      process.exitCode = 1;
      continue;
    }
    if (!dry) fs.writeFileSync(p, src.replace(NEEDLE, REPLACEMENT), 'utf8');
    changed.push(f);
  }
  return changed;
}

function main() {
  const changed = run({ dry: DRY });
  for (const f of changed) console.log(`✔ ${f}: ห่อ router แล้ว`);
  if (!changed.length) console.log('– ห่อไว้ครบแล้ว');
}

if (require.main === module) main();

module.exports = { run };
