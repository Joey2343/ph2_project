/**
 * หา "Promise หลุดเข้าไปในคำสั่ง SQL" ทั้ง backend
 *
 * บั๊กนี้ทำให้หน้าเว็บขึ้น "เกิดข้อผิดพลาดในระบบ [POST /xxx · HTTP 500]"
 * เพราะ mysql2 จะโยน TypeError ตอนส่งค่าที่ไม่ใช่ string/number
 *
 * รูปแบบที่พบจริง (เจอครั้งแรกที่ POST /api/leaves)
 * ─────────────────────────────────────────────
 *   async function nextLeaveNo(t) { ... }        ← async
 *   .run(nextLeaveNo(b.leave_type), req.user.id)  ← ไม่มี await
 *
 *   → ส่ง Promise เข้าไปแทนคอลัมน์ leave_no
 *   → TypeError: The first argument must be of type string ...
 *      Received an instance of Promise
 *   → error handler ตอบ 500
 *
 *   ⚠️ บั๊กนี้อยู่มาตั้งแต่ commit แรก ไม่ใช่ของใหม่
 *      และทำให้ฟีเจอร์ที่เรียกใช้ใช้ไม่ได้เลย 100%
 *
 * วิธีตรวจ
 * ────────
 * ① รวบรวมชื่อฟังก์ชันที่เป็น async ทั้งไฟล์
 *      (async function NAME / const NAME = async (…) => / NAME = async function)
 * ② หาจุดที่เรียก db.prepare(…).run/all/get หรือ db.transaction(…)
 *      แล้วดูว่ามีการเรียก NAME(…) ที่ไม่มี await นำหน้าหรือไม่
 * ③ ต้องไม่มี .then( / .catch( ต่อท้าย (ถ้ามี = จัดการผลลัพธ์ถูกแล้ว)
 *
 * ใช้: node scripts/check-await-in-sql.js
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

/** ไฟล์ที่ต้องตรวจ — ทุกไฟล์ที่เรียก db.prepare */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'public'].includes(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (e.name.endsWith('.js')) out.push(f);
  }
  return out;
}

const files = walk(ROOT).filter((f) => !f.includes(`${path.sep}db${path.sep}`) || /index|driver/.test(f));

/** ถอดคอมเมนต์ออกก่อน ไม่งั้นคำที่เราอธิบายไว่จะถูกนับเป็นบั๊ก */
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');

const problems = [];

for (const file of files) {
  const raw = strip(fs.readFileSync(file, 'utf8'));
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');

  /* ── ① รวบรวมชื่อฟังก์ชัน async ────────────────────────────────────── */
  const asyncNames = new Set();
  for (const re of [
    /async\s+function\s+([A-Za-z_$][\w$]*)/g,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*async\b/g,
    /([A-Za-z_$][\w$]*)\s*:\s*async\s+function/g,
  ]) {
    let m = re.exec(raw);
    while (m) { asyncNames.add(m[1]); m = re.exec(raw); }
  }
  if (!asyncNames.size) continue;

  /* ── ② หาชื่อฟังก์ชันที่ import มาจากไฟล์อื่นแล้วเป็น async ──────────
   * ไฟล์ route มัก import helper ที่เป็น async จาก lib/
   * เช่น approvals.getMemoApproversPerPerson / purgeUser
   */
  const imported = new Set();
  for (const m of raw.matchAll(/const\s*\{([^}]*)\}\s*=\s*require\(/g)) {
    m[1].split(',').forEach((n) => {
      const name = n.split(':').pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) imported.add(name);
    });
  }
  for (const m of raw.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(/g)) imported.add(m[1]);

  /* ── ③ ตรวจทุกจุดที่เรียก db ─────────────────────────────────────── */
  // จับเฉพาะวงเล็บ run( / all( / get( / transaction( ของ db
  const callRe = /db\.(prepare\([^;]*?\)|transaction\([^()]*\))\s*\.\s*(run|all|get|transaction)\s*\(/g;
  let cm = callRe.exec(raw);
  while (cm) {
    const start = cm.index + cm[0].length;
    // หาวงเล็บปิดที่สมดุล
    let depth = 1;
    let i = start;
    while (i < raw.length && depth > 0) {
      const ch = raw[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      i += 1;
    }
    const args = raw.slice(start, i - 1);

    // มี .then( ต่อท้ายไหม = จัดการผลลัพธ์ถูกแล้ว
    const tail = raw.slice(i, i + 40);
    const handled = /\.\s*(then|catch)\s*\(/.test(tail);

    for (const name of asyncNames) {
      const use = new RegExp(`(^|[^\\w$.])${name}\\s*\\(`).exec(args);
      if (!use) continue;
      // ดูตัวหน้าทั้งซ้าย ๆ ว่ามี await หรือไม่
      const before = args.slice(Math.max(0, use.index - 12), use.index + use[1].length);
      const hasAwait = /\bawait\s*$/.test(before);
      if (hasAwait || handled) continue;

      const lineNo = raw.slice(0, cm.index).split('\n').length;
      problems.push({ rel, lineNo, name, args: args.slice(0, 90).replace(/\s+/g, ' ') });
    }
    cm = callRe.exec(raw);
  }

  void imported; // ไว้เป็นจุดต่อยอดถ้าจะขยายไปตรวจ helper ที่ import มา
}

/* ── รายงาน ───────────────────────────────────────────────────────────── */
console.log('');
console.log('① ต้องไม่มี Promise หลุดเข้าไปในคำสั่ง SQL');
if (problems.length) {
  for (const p of problems) {
    console.log(`  ✖ ${p.rel}:${p.lineNo}  เรียก ${p.name}() โดยไม่มี await`);
    console.log(`      ${p.args}`);
    console.log(`      → ส่ง Promise เข้าไปแทนค่า → mysql2 โยน TypeError → API ตอบ HTTP 500`);
    console.log(`      → แก้ด้วย: await ${p.name}(...)`);
  }
} else {
  console.log('  ✔ ไม่พบจุดที่เรียกฟังก์ชัน async โดยไม่มี await ในคำสั่ง SQL');
}

/* ── จุดที่เคยพังจริง ต้องไม่กลับมาอีก ──────────────────────────────── */
console.log('');
console.log('② จุดที่เคยพังต้องแก้แล้ว');
const req = strip(fs.readFileSync(path.join(ROOT, 'routes', 'requests.js'), 'utf8'));
check(/\.run\(\s*await\s+nextLeaveNo\(/.test(req),
  'POST /leaves → nextLeaveNo มี await',
  'ถ้าไม่มี: ยื่นลาไม่ได้เลยทุกครั้ง (HTTP 500) — เจอจริงบนระบบออนไลน์');
check(/\.run\(\s*await\s+nextDocNo\('travel_requests'/.test(req),
  'POST /travel → nextDocNo มี await',
  'ยื่นคำขอไปราชการจะพังแบบเดียวกัน');

console.log('');
console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail + problems.length}`);
process.exit(fail + problems.length ? 1 : 0);