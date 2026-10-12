/**
 * ตรวจว่า driver ฐานข้อมูลมีเมธอด prepare() ครบ
 *
 * ทำไมต้องมี
 * ──────────
 * db/index.js เขียนเอกสารไว้ว่าใช้ได้ทั้งสองแบบ:
 *   db.prepare('SELECT ...')                ← บน api facade (มีอยู่แล้ว)
 *   db.transaction(async (tx) => tx.prepare(...))   ← ต้องมีที่ driver ด้วย
 *
 * กลไกใน db.transaction():
 *   if (txDriver && typeof txDriver.prepare === 'function') {
 *     const txApi = makeTxFacade(txDriver);   // ส่ง facade (มี prepare)
 *     return fn(txApi, ...args);
 *   }
 *   return fn(d, ...args);                     // ส่ง driver ดิบ (ไม่มี prepare)
 *
 * ถ้า ScopedMysqlDriver ไม่มี prepare() → เงื่อนไขเป็น false
 * → ส่ง driver ดิบเข้า callback → tx.prepare is not a function
 *
 * เจอจริง: หน้า "ข้อมูลพื้นฐาน สพป.แพร่ เขต 2" กดบันทึกแล้วได้
 *   TypeError: tx.prepare is not a function  (routes/content.js)
 *
 * ใช้: node scripts/test-db-transaction.js
 */
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
}

const ROOT = path.join(__dirname, '..');
console.log('');

/* ── 1. ตัว driver ต้องมี prepare ────────────────────────────────────── */
console.log('driver ฐานข้อมูล (ต้องมี prepare เหมือนกันทั้งสองตัว):');

const drvPath = path.join(ROOT, 'db', 'driver-mysql.js');
const drv = fs.readFileSync(drvPath, 'utf8');

/** ดึง body ของ class ที่ชื่อ className */
function classBody(src, className) {
  const i = src.indexOf('class ' + className);
  if (i === -1) return '';
  const open = src.indexOf('{', i);
  let depth = 0;
  for (let k = open; k < src.length; k += 1) {
    if (src[k] === '{') depth += 1;
    else if (src[k] === '}') { depth -= 1; if (depth === 0) return src.slice(open, k + 1); }
  }
  return '';
}

const base = classBody(drv, 'MysqlDriver');
const scoped = classBody(drv, 'ScopedMysqlDriver');

check(!!base, 'พบ class MysqlDriver');
check(!!scoped, 'พบ class ScopedMysqlDriver');

/** มีเมธอดชื่อ m ใน class body ไหม (รองรับทั้ง `foo(` และ `async foo(`) */
const hasMethod = (body, m) =>
  new RegExp('\\n  (?:async\\s+)?' + m + '\\s*\\(').test('\n' + body.replace(/\r\n/g, '\n'));

for (const [name, body] of [['MysqlDriver', base], ['ScopedMysqlDriver', scoped]]) {
  if (!body) continue;
  check(hasMethod(body, 'prepare'),
    name + ' มีเมธอด prepare()',
    'db.transaction() ใช้ prepare เป็นเงื่อนไขตัดสินว่าจะส่ง facade หรือ driver ดิบ');
  const p = body.replace(/\r\n/g, '\n');
  const ok = /\n  prepare\s*\(sql\)\s*\{\s*return\s*\{/.test(p)
    && /get:\s*\(\.\.\./.test(p) && /all:\s*\(\.\.\./.test(p) && /run:\s*\(\.\.\./.test(p);
  check(ok, name + '.prepare() คืน { get, all, run } ที่ผูกกับ driver ตัวเอง');
}

/* ── 2. เมธอดอื่นที่ต้องมีตาม interface ─────────────────────────────── */
console.log('');
console.log('driver ต้องมีเมธอดครบตามที่ db/index.js เรียกใช้:');
for (const [cls, body] of [['MysqlDriver', base], ['ScopedMysqlDriver', scoped]]) {
  if (!body) continue;
  for (const m of ['exec', 'all', 'get', 'run', 'columns', 'tables', 'transaction']) {
    check(hasMethod(body, m), cls + '.' + m + '()');
  }
}

/* ── 3. จำลองกลไกของ db.transaction ────────────────────────────────────── */
console.log('');
console.log('กลไกการเลือก facade ของ db.transaction():');
const idx = fs.readFileSync(path.join(ROOT, 'db', 'index.js'), 'utf8');
check(/typeof\s+txDriver\.prepare\s*===\s*['"]function['"]/.test(idx),
  'เงื่อนไขตรวจ prepare ยังอยู่',
  'ถ้าเงื่อนไขนี้ถูกลบ driver ที่ไม่มี prepare จะถูกส่งเข้า callback เงียบ ๆ');

/* ── 4. โค้ดที่เรียก tx.prepare ต้องไม่มีเมธอด driver ที่ขาด ──────────── */
console.log('');
console.log('จุดที่เรียก tx.prepare:');
const routeDir = path.join(ROOT, 'routes');
let callers = 0;
let bad = 0;
for (const f of fs.readdirSync(routeDir)) {
  if (!f.endsWith('.js')) continue;
  const src = fs.readFileSync(path.join(routeDir, f), 'utf8');
  const re = /\btx\.prepare\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    callers += 1;
    const line = src.slice(0, m.index).split('\n').length;
    if (!scoped || !hasMethod(scoped, 'prepare')) {
      bad += 1;
      console.log(`      routes/${f}:${line} → จะพัง เพราะ ScopedMysqlDriver ไม่มี prepare()`);
    }
  }
}
check(callers > 0, `พบจุดที่เรียก tx.prepare (${callers} จุด)`);
check(bad === 0, 'ทุกจุดที่เรียก tx.prepare มี prepare() รองรับแล้ว');

console.log('');
console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);