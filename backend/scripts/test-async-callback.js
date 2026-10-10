/**
 * ตรวจว่า callback ที่ส่งให้ approveRequest ถูก await ก่อนใช้
 *
 * ทำไมต้องมี
 * ──────────
 * approveRequest({ onFinal }) เรียก onFinal(row) เพื่อเช็กเงื่อนไขก่อนอนุมัติขั้นสุดท้าย
 * ถ้า callback เป็น async แต่เรียกโดยไม่ await:
 *
 *   const err = onFinal(row);   // err เป็น Promise → truthy เสมอ
 *   if (err) return err;         // ผ่านเสมอ → return ออกจากฟังก์ชันก่อนถึงบรรทัด UPDATE
 *
 * ผลคือ การอนุมัติขั้นสุดท้ายไม่เคยถูกบันทึก และผู้ใช้ได้ HTTP 500
 * เจอจริง: หน้าจองยานพาหนะ + ห้องประชุม ขั้น "อนุมัติขั้นสุดท้าย" กดยืนยันไม่ได้
 *
 * ใช้: node scripts/test-async-callback.js
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

/** ── 1. พฤติกรรม: await vs ไม่ await ─────────────────────────────── */
async function behaviourTests() {
  console.log('');
  console.log('พฤติกรรมของ callback แบบ async:');

  const onFinal = async (row) => null; // ไม่มี error
  const payload = { id: 7 };

  // รูปแบบเดิม (ไม่ await) — จำลองบั๊ก
  async function broken(onFinal, row) {
    const err = onFinal(row);
    if (err) return err;
    return { ok: true, saved: true };
  }
  // รูปแบบที่แก้แล้ว
  async function fixed(onFinal, row) {
    const err = await onFinal(row);
    if (err) return err;
    return { ok: true, saved: true };
  }

  const b = await broken(onFinal, payload);
  check(b === null, 'ไม่ await → คืนค่า Promise (null) ไม่ใช่ผลลัพธ์',
    'ได้ ' + JSON.stringify(b));
  check(b === null || b.ok !== true, 'ไม่ await → ข้อมูลไม่ถูกบันทึกและพังต่อที่ result.error');

  const f = await fixed(onFinal, payload);
  check(f && f.ok === true && f.saved === true, 'await → อนุมัติและบันทึกสำเร็จ',
    JSON.stringify(f));

  // callback ที่คืน error ต้องหยุดการอนุมัติ
  const onFinalErr = async () => ({ error: 'ช่วงเวลาซ้อนทับ', code: 409 });
  const f2 = await fixed(onFinalErr, payload);
  check(f2 && f2.code === 409 && f2.error === 'ช่วงเวลาซ้อนทับ',
    'await → callback ที่คืน error ยังหยุดการอนุมัติเหมือนเดิม',
    JSON.stringify(f2));
}

async function main() {
  console.log('=== ตรวจ callback ของ approveRequest ว่าถูก await ===');

  // ── 2. สแกนซอร์สจริง ───────────────────────────────────────────
  const approvalsSrc = fs.readFileSync(path.join(ROOT, 'lib', 'approvals.js'), 'utf8');
  const line = (re) => {
    const m = approvalsSrc.match(re);
    return m ? m[0].trim() : '';
  };

  check(
    /await\s+onFinal\s*\(/.test(approvalsSrc),
    'lib/approvals.js เรียก onFinal ด้วย await',
    line(/.*onFinal\s*\(.*/g) || '(ไม่พบ)',
  );

  // ไม่มีการเรียก onFinal แบบไม่ await เหลือ
  const bare = [...approvalsSrc.matchAll(/^[^\n]*[^t]\bonFinal\s*\(/gm)]
    .map((m) => m[0].trim())
    .filter((l) => !/await/.test(l) && !/\/\//.test(l) && !/opts\.onFinal/.test(l));
  check(bare.length === 0, 'ไม่มีการเรียก onFinal ที่ไม่ใส่ await เหลือ',
    bare.join('\n      '));

  // ทุกจุดที่ส่ง onFinal เข้ามาต้องประกาศเป็น async (เพราะ lib จะ await)
  const opsSrc = fs.readFileSync(path.join(ROOT, 'routes', 'ops.js'), 'utf8');
  const sites = [...opsSrc.matchAll(/onFinal:\s*(async\s*)?\(/g)];
  const isAsync = sites.map((m) => String(m[1] || '').trim() === 'async');
  check(sites.length > 0, 'พบจุดที่ส่ง onFinal เข้ามา ' + sites.length + ' แห่ง');
  check(isAsync.every(Boolean),
    'ทุก onFinal ที่ส่งเข้ามาประกาศเป็น async',
    sites.map((m, i) => 'จุดที่ ' + (i + 1) + ': ' + (isAsync[i] ? 'async (ถูกต้อง)' : 'ไม่ใส่ async')).join('\n      '));

  await behaviourTests();

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  console.log('');
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});