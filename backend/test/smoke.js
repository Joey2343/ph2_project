'use strict';
/**
 * ทดสอบ endpoint ทั้งหมดอัตโนมัติ โดยดึงรายการ route จากซอร์สจริง (ไม่ต้องดูแลคงไว้)
 *
 * วิธีทำงาน
 *   1. คัดลอกฐานข้อมูลไปไฟล์ชั่วคราว (ไม่แตะข้อมูลจริง)
 *   2. สตาร์ทเซิร์ฟเวอร์ด้วย SQLITE_FILE ที่ชี้ไฟล์สำเนา
 *   3. ยิงทุก GET endpoint (มี session ของ admin) แล้วรายงานผล
 *   4. ปิดเซิร์ฟเวอร์ ลบไฟล์สำเนา
 *
 * ตั้งค่า:
 *   PORT=3111 node test/smoke.js
 *   node test/smoke.js --verbose     แสดงทุก endpoint
 *   node test/smoke.js --only=leave  ทดสอบเฉพาะเส้นทางที่มีคำนี้
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const BACKEND = path.join(__dirname, '..');
const VERBOSE = process.argv.includes('--verbose');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';

// mount prefix ของแต่ละไฟล์ route (ต้องตรงกับ server.js)
const MOUNTS = {
  'auth.js': '/api/auth',
  'content.js': '/api',
  'ops.js': '/api',
  'requests.js': '/api',
  'admin.js': '/api',
};

const SKIP_GET = new Set([
  // คืนไฟล์ (ไม่ใช่ JSON) — ทดสอบแยก
  '/api/time/report.xlsx',
  // ต้องพารามิเตอร์/ไฟล์ — ทดสอบแยก
  '/api/vehicle-bookings/:id/document',
  '/api/fonts',
]);

function extractRoutes() {
  const out = [];
  const routesDir = path.join(BACKEND, 'routes');
  for (const file of fs.readdirSync(routesDir)) {
    if (!file.endsWith('.js')) continue;
    const mount = MOUNTS[file];
    if (!mount) continue;
    const code = fs.readFileSync(path.join(routesDir, file), 'utf8');
    const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script' });

    walk.simple(ast, {
      CallExpression(node) {
        const c = node.callee;
        if (c.type !== 'MemberExpression') return;
        if (c.object.type !== 'Identifier' || c.object.name !== 'router') return;
        const method = c.property.name.toUpperCase();
        if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) return;
        const p = node.arguments[0];
        if (!p || p.type !== 'Literal' || typeof p.value !== 'string') return;
        out.push({
          method,
          path: mount + p.value,
          file,
          // มี :param หรือไม่
          dynamic: p.value.includes(':'),
        });
      },
    });
  }
  return out;
}

/** แทนที่ :param ด้วยค่าที่ใช้ได้จริง */
function resolvePath(p) {
  return p.replace(/:([A-Za-z_]+)/g, (_m, name) => {
    switch (name) {
      case 'id':
        return '1';
      case 'docId':
        return '1';
      case 'userId':
        return '1';
      case 'school_code':
      case 'schoolCode':
        return '54020000';
      default:
        return '1';
    }
  });
}

async function waitForServer(port, timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/office`);
      if (r.status > 0) return true;
    } catch {
      /* ยังไม่พร้อม */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function main() {
  // 1) สำเนาฐานข้อมูล
  const src = path.join(BACKEND, 'data.db');
  const tmp = path.join(os.tmpdir(), `ph2-smoke-${Date.now()}.db`);
  fs.copyFileSync(src, tmp);
  console.log(`ฐานข้อมูลสำเนา: ${tmp}`);

  const port = Number(process.env.PORT) || 3111;
  const base = `http://127.0.0.1:${port}`;

  // 2) สตาร์ทเซิร์ฟเวอร์
  const child = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND,
    env: {
      ...process.env,
      PORT: String(port),
      SQLITE_FILE: tmp,
      NODE_NO_WARNINGS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => {
    log += d.toString();
  });
  child.stderr.on('data', (d) => {
    log += d.toString();
  });

  const ok = await waitForServer(port);
  if (!ok) {
    console.error('เซิร์ฟเวอร์ไม่ตอบสนอง\n' + log);
    child.kill();
    process.exit(1);
  }

  // 3) login เป็น admin
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Joey2343**' }),
  });
  const cookie = (login.headers.getSetCookie?.() || [])
    .map((c) => c.split(';')[0])
    .join('; ');
  if (!login.ok) {
    console.error(`login ไม่สำเร็จ: ${login.status} ${await login.text()}`);
    console.error(log);
    child.kill();
    process.exit(1);
  }
  console.log('login: สำเร็จ (admin)');

  // 4) ทดสอบทุก GET
  const routes = extractRoutes();
  const targets = routes.filter(
    (r) =>
      r.method === 'GET' &&
      !r.dynamic &&
      !SKIP_GET.has(r.path) &&
      (!ONLY || r.path.includes(ONLY))
  );

  const results = { pass: 0, fail: 0, skipped: 0 };
  const failures = [];

  for (const r of targets) {
    const url = base + resolvePath(r.path);
    try {
      const res = await fetch(url, { headers: { Cookie: cookie } });
      const text = await res.text();
      // 200-299 ผ่าน · 401/403 ผ่าน (ต้อง login ซึ่งผ่านแล้ว → น่าสงสัย แต่ยังไม่ error)
      if (res.status >= 200 && res.status < 300) {
        results.pass += 1;
        if (VERBOSE) console.log(`  ✔ ${r.path}`);
      } else if (res.status === 401 || res.status === 403) {
        results.fail += 1;
        failures.push({ path: r.path, status: res.status, body: text.slice(0, 200) });
        console.log(`  ✖ ${r.path} → ${res.status}`);
      } else {
        results.fail += 1;
        failures.push({ path: r.path, status: res.status, body: text.slice(0, 300) });
        console.log(`  ✖ ${r.path} → ${res.status} ${text.slice(0, 160)}`);
      }
    } catch (err) {
      results.fail += 1;
      failures.push({ path: r.path, status: 'ERR', body: err.message });
      console.log(`  ✖ ${r.path} → ${err.message}`);
    }
  }

  // 4b) ทดสอบ POST ที่ "เขียนข้อมูล" — จุดที่เคยพังจน server ตายทั้ง process
  //
  // /api/time/check เคยพังเพราะ getClockGeoConfig() ไม่ได้ await (db adapter เป็น async)
  // → cfg.ips เป็น Promise → .trim() ไม่ใช่ฟังก์ชัน → uncaught → process ตาย
  // GET test จับไม่ได้เพราะไม่ยิง endpoint นี้ จึงต้องทดสอบแยก
  //
  // สำคัญ: ต้องลบบันทึกที่สร้างออกทุกครั้ง
  //   ถ้าไม่ล้าง ข้อมูลจะค้างใน MySQL จริง ทำให้ parity เทียบ SQLite ↔ MySQL ไม่ตรง
  //   (SQLite ใช้ไฟล์ชั่วคราวที่ถูกลบทิ้ง แต่ MySQL เขียนลงฐานจริงถาวร)
  if (!ONLY || '/api/time/check'.includes(ONLY)) {
    const writeTests = [
      {
        name: 'POST /api/time/check (ครั้งแรก)',
        run: () =>
          fetch(base + '/api/time/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({ type: 'in', device: 'desktop' }),
          }),
      },
      {
        name: 'POST /api/time/check (ซ้ำ — กันเข้าซ้ำ)',
        run: () =>
          fetch(base + '/api/time/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({ type: 'in', device: 'desktop' }),
          }),
      },
      // ต้องตอบได้ = server ยังไม่ตายจากคำขอก่อนหน้า
      {
        name: 'server ยังทำงานหลัง POST',
        run: () => fetch(base + '/api/time/today', { headers: { Cookie: cookie } }),
      },
    ];

    console.log('\nPOST ที่เขียนข้อมูล:');
    for (const t of writeTests) {
      try {
        const res = await t.run();
        await res.text();
        results.pass += 1;
        console.log(`  ✔ ${t.name} → ${res.status}`);
      } catch (err) {
        // fetch ล้มเหลว = ตัวเชื่อมขาด = server ตาย
        results.fail += 1;
        failures.push({ path: t.name, status: 'ERR', body: err.message });
        console.log(`  ✖ ${t.name} → ${err.message}`);
      }
    }

    // ---- ล้างข้อมูลที่สร้างจากการทดสอบ ----
    console.log('\nล้างข้อมูลที่ทดสอบสร้าง:');
    try {
      const today = await fetch(base + '/api/time/today', { headers: { Cookie: cookie } })
        .then((r) => r.json())
        .catch(() => ({}));
      if (today.record && today.record.id) {
        const del = await fetch(`${base}/api/time/${today.record.id}`, {
          method: 'DELETE',
          headers: { Cookie: cookie },
        });
        await del.text();
        if (del.status === 200) {
          results.pass += 1;
          console.log(`  ✔ ลบบันทึกลงเวลา id=${today.record.id}`);
        } else {
          results.fail += 1;
          console.log(`  ✖ ลบบันทึกลงเวลาไม่สำเร็จ → ${del.status}`);
        }
      } else {
        console.log('  – ไม่มีบันทึกให้ล้าง');
      }
    } catch (err) {
      results.fail += 1;
      failures.push({ path: 'ล้างข้อมูลทดสอบ', status: 'ERR', body: err.message });
      console.log(`  ✖ ล้างข้อมูลไม่สำเร็จ → ${err.message}`);
    }
  }

  // 5) สรุป
  console.log(`\nผลลัพธ์: ผ่าน ${results.pass} · ไม่ผ่าน ${results.fail}`);
  console.log(`ทั้งหมดที่พบ: ${routes.length} route · ที่ทดสอบได้ (GET ไม่มี :param): ${targets.length}`);

  if (failures.length) {
    console.log('\nรายละเอียดที่ไม่ผ่าน:');
    for (const f of failures) console.log(`  ${f.status}  ${f.path}\n       ${f.body}`);

    const serverErrors = log
      .split('\n')
      .filter((l) => l.includes('[error]') || l.includes('Error'))
      .slice(0, 25);
    if (serverErrors.length) {
      console.log('\nerror จากเซิร์ฟเวอร์:');
      serverErrors.forEach((l) => console.log('  ' + l));
    }
  }

  // 6) เก็บกวาด
  child.kill();
  await new Promise((r) => setTimeout(r, 300));
  for (const suffix of ['', '-wal', '-shm']) {
    const f = tmp + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  process.exit(results.fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
