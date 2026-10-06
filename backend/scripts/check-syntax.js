'use strict';
/**
 * ตรวจว่าไฟล์ JavaScript ทุกไฟล์ parse ผ่าน (ต้องเป็น CommonJS ที่ถูกต้อง)
 *
 * ใช้ acorn ตรวจ แทนที่จะรันทีละไฟล์ เพราะบางไฟล์มีผลข้างเคียงตอนรัน
 * (เช่น เขียนฐานข้อมูล) ต้องตรวจด้วยการ parse ล้วน ๆ
 *
 * ใช้: node scripts/check-syntax.js
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const BACKEND = path.join(__dirname, '..');

const DIRS = ['routes', 'lib', 'scripts', 'test', 'db'];
const FILES = ['server.js', 'db.js'];

function listTargets() {
  const out = [];
  for (const d of DIRS) {
    const dir = path.join(BACKEND, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.js')) out.push(path.join(dir, f));
    }
  }
  for (const f of FILES) {
    const p = path.join(BACKEND, f);
    if (fs.existsSync(p)) out.push(p);
  }
  return out;
}

function main() {
  const targets = listTargets();
  let bad = 0;

  for (const p of targets) {
    const rel = path.relative(BACKEND, p);
    const code = fs.readFileSync(p, 'utf8');
    // ไฟล์เครื่องมือ codemod ต้องการให้ parse ที่ยอม top-level await
    // (เพราะใช้กับโค้ดที่ยังไม่ได้แก้) — ตรวจสองแบบ
    const strict = { ecmaVersion: 'latest', sourceType: 'script' };
    const lenient = { ...strict, allowAwaitOutsideFunction: true };

    let ok = true;
    let err = null;
    try {
      acorn.parse(code, strict);
    } catch (e) {
      try {
        acorn.parse(code, lenient);
        // ผ่านแบบ lenient = ยังมี top-level await ค้างอยู่ (เครื่องมือ codemod เท่านั้นที่ยอมได้)
        if (!rel.startsWith('scripts')) {
          ok = false;
          err = `${e.message} (พบ top-level await)`;
        }
      } catch (e2) {
        ok = false;
        err = e2.message;
      }
    }

    if (!ok) {
      console.log(`✖ ${rel}: ${err}`);
      bad += 1;
    }
  }

  console.log(
    bad === 0
      ? `✔ ทุกไฟล์ parse ผ่าน (${targets.length} ไฟล์)`
      : `✖ ผิด ${bad} จาก ${targets.length} ไฟล์`
  );
  process.exit(bad === 0 ? 0 : 1);
}

main();
