'use strict';
/**
 * เทียบผลลัพธ์ของ endpoint ทุกตัว ระหว่าง SQLite กับ MySQL
 *
 * ทำไมต้องเทียบ: โค้ดเดิมเขียน SQL แบบ SQLite แล้วให้ adapter แปลงเป็น MySQL
 * ถ้าการแปลงผิดจุด (ชนิดข้อมูล, NULL, ตัวเลขทศนิยม, การเรียงลำดับ)
 * จะพบว่าผลลัพธ์ต่างกัน — ตัวตรวจนี้จับได้ทั้งระบบ
 *
 * วิธีทำ
 *   1. สตาร์ทเซิร์ฟเวอร์ 2 ตัว (port ต่างกัน) ตัวหนึ่ง SQLite อีกตัว MySQL
 *   2. ยิง GET ทุกเส้นทางเหมือนกันทั้งสองตัว
 *   3. เทียบ JSON แบบลึก (ระบุคีย์ที่ต่างกัน)
 *
 * ต้องมี MySQL ทำงานอยู่ (docker compose up -d)
 *
 * ใช้:
 *   DATABASE_URL=mysql://... node test/parity.js
 *   node test/parity.js --verbose
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const BACKEND = path.join(__dirname, '..');
const VERBOSE = process.argv.includes('--verbose');

const MOUNTS = {
  'auth.js': '/api/auth',
  'content.js': '/api',
  'ops.js': '/api',
  'requests.js': '/api',
  'admin.js': '/api',
};

/** เส้นทางที่ผลขึ้นกับเวลาจริง/สุ่ม หรือคืนไฟล์ไม่ใช่ JSON — ข้ามเพื่อไม่ให้เทียบผิด */
const SKIP = new Set([
  '/api/time/today',        // ขึ้นกับวันที่เข้า/ออกงาน
  '/api/time/report',       // มี timestamp
  '/api/sim-date',          // ขึ้นกับ settings.sim_today
  '/api/time/report.xlsx',  // คืนไฟล์ XLSX (binary) ไม่ใช่ JSON
  '/api/fonts',             // รายการฟอนต์ ขึ้นกับไฟล์ในเครื่อง
]);

function extractRoutes() {
  const out = [];
  const dir = path.join(BACKEND, 'routes');
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.js')) continue;
    const mount = MOUNTS[file];
    if (!mount) continue;
    const code = fs.readFileSync(path.join(dir, file), 'utf8');
    const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script' });
    walk.simple(ast, {
      CallExpression(node) {
        const c = node.callee;
        if (c.type !== 'MemberExpression') return;
        if (c.object.type !== 'Identifier' || c.object.name !== 'router') return;
        const method = c.property.name.toUpperCase();
        if (method !== 'GET') return;
        const p = node.arguments[0];
        if (!p || p.type !== 'Literal' || typeof p.value !== 'string') return;
        if (p.value.includes(':')) return;
        out.push(mount + p.value);
      },
    });
  }
  return [...new Set(out)].filter((p) => !SKIP.has(p)).sort();
}

async function waitFor(port) {
  for (let i = 0; i < 60; i += 1) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/office`);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return false;
}

function start(port, env) {
  return spawn(process.execPath, ['server.js'], {
    cwd: BACKEND,
    env: { ...process.env, PORT: String(port), NODE_NO_WARNINGS: '1', ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

/** เทียบสองค่าแบบลึก คืนรายการความต่าง */
function diff(a, b, pathStr = '', out = [], limit = 12) {
  if (out.length >= limit) return out;
  if (a === b) return out;

  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;

  if (ta !== tb) {
    out.push(`${pathStr}: ชนิดต่างกัน (${ta} vs ${tb})`);
    return out;
  }
  if (ta === 'array') {
    if (a.length !== b.length) {
      out.push(`${pathStr}: จำนวนสมาชิกต่างกัน (${a.length} vs ${b.length})`);
      return out;
    }
    for (let i = 0; i < a.length && out.length < limit; i += 1) {
      diff(a[i], b[i], `${pathStr}[${i}]`, out, limit);
    }
    return out;
  }
  if (ta === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (out.length >= limit) break;
      if (!(k in a) || !(k in b)) {
        out.push(`${pathStr}.${k}: มีในฝั่งเดียว`);
        continue;
      }
      diff(a[k], b[k], `${pathStr}.${k}`, out, limit);
    }
    return out;
  }

  // ตัวเลข: 1 กับ 1.0 ถือว่าเท่ากัน
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > 1e-9) out.push(`${pathStr}: ${a} vs ${b}`);
    return out;
  }
  // ค่าคงที่ที่ต่างกันเสมอระหว่างสอง dialect
  if (/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(String(a)) && /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(String(b))) {
    return out;
  }
  out.push(`${pathStr}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  return out;
}

async function login(port) {
  const r = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Joey2343**' }),
  });
  if (!r.ok) throw new Error(`login port ${port} ล้มเหลว: ${r.status}`);
  return (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('✖ ต้องตั้ง DATABASE_URL ของ MySQL');
    console.error('  เช่น DATABASE_URL=mysql://ph2:ph2pass@127.0.0.1:3307/ph2');
    process.exit(1);
  }

  const sqliteFile = path.join(os.tmpdir(), `ph2-parity-${Date.now()}.db`);
  fs.copyFileSync(path.join(BACKEND, 'data.db'), sqliteFile);

  const PORT_SQLITE = 3211;
  const PORT_MYSQL = 3212;

  const p1 = start(PORT_SQLITE, { SQLITE_FILE: sqliteFile, DATABASE_URL: '' });
  const p2 = start(PORT_MYSQL, { DATABASE_URL: process.env.DATABASE_URL });

  const okA = await waitFor(PORT_SQLITE);
  const okB = await waitFor(PORT_MYSQL);
  if (!okA || !okB) {
    console.error(`✖ เซิร์ฟเวอร์ไม่พร้อม (sqlite=${okA} mysql=${okB})`);
    p1.kill();
    p2.kill();
    process.exit(1);
  }

  const cookieA = await login(PORT_SQLITE);
  const cookieB = await login(PORT_MYSQL);

  const routes = extractRoutes();
  console.log(`เทียบ ${routes.length} เส้นทาง ระหว่าง SQLite ↔ MySQL\n`);

  let same = 0;
  let different = 0;
  let failed = 0;
  const problems = [];

  for (const route of routes) {
    let ra;
    let rb;
    try {
      const [a, b] = await Promise.all([
        fetch(`http://127.0.0.1:${PORT_SQLITE}${route}`, { headers: { Cookie: cookieA } }),
        fetch(`http://127.0.0.1:${PORT_MYSQL}${route}`, { headers: { Cookie: cookieB } }),
      ]);
      if (a.status !== b.status) {
        different += 1;
        problems.push({ route, kind: 'status', detail: `${a.status} vs ${b.status}` });
        console.log(`✖ ${route}  → สถานะต่างกัน: ${a.status} vs ${b.status}`);
        continue;
      }
      if (a.status >= 400) {
        failed += 1;
        continue;
      }
      ra = await a.json();
      rb = await b.json();
    } catch (err) {
      failed += 1;
      problems.push({ route, kind: 'error', detail: err.message });
      console.log(`✖ ${route}  → ${err.message}`);
      continue;
    }

    const d = diff(ra, rb);
    if (d.length === 0) {
      same += 1;
      if (VERBOSE) console.log(`✔ ${route}`);
    } else {
      different += 1;
      console.log(`✖ ${route}`);
      for (const line of d.slice(0, 6)) console.log(`     ${line}`);
      problems.push({ route, kind: 'value', detail: d.join(' | ') });
    }
  }

  console.log(`\nผลลัพธ์: ตรงกัน ${same} · ต่างกัน ${different} · ข้าม ${failed}`);

  p1.kill();
  p2.kill();
  await new Promise((r) => setTimeout(r, 300));
  for (const s of ['', '-wal', '-shm']) {
    if (fs.existsSync(sqliteFile + s)) fs.unlinkSync(sqliteFile + s);
  }

  if (problems.length) {
    console.log('\nรายการที่ต่างกัน:');
    for (const p of problems) console.log(`  ${p.kind}  ${p.route}  ${p.detail}`);
  }

  process.exit(different === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
