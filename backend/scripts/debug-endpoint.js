'use strict';
/**
 * รันเซิร์ฟเวอร์บนฐานข้อมูลสำเนา ยิง endpoint ตามที่ระบุ แล้วแสดง error จากเซิร์ฟเวอร์
 *
 * ใช้: node scripts/debug-endpoint.js /api/office-staff /api/staff ...
 *       node scripts/debug-endpoint.js --all      (ยิงทุก GET)
 *       node scripts/debug-endpoint.js --login user  (ล็อกอินด้วยบัญชีอื่น)
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BACKEND = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3123;
const BASE = `http://127.0.0.1:${PORT}`;

const argv = process.argv.slice(2);
const asUser = argv.includes('--login') ? argv[argv.indexOf('--login') + 1] : 'admin';
const passwd = argv.includes('--pass') ? argv[argv.indexOf('--pass') + 1] : 'Joey2343**';
const targets = argv.filter((a) => a.startsWith('/'));

async function main() {
  const tmp = path.join(os.tmpdir(), `ph2-dbg-${Date.now()}.db`);
  fs.copyFileSync(path.join(BACKEND, 'data.db'), tmp);

  const child = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND,
    env: { ...process.env, PORT: String(PORT), SQLITE_FILE: tmp, NODE_NO_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  child.stdout.on('data', (d) => {
    log += d;
  });
  child.stderr.on('data', (d) => {
    log += d;
  });
  const onExit = () => {
    console.log('\n===== เซิร์ฟเวอร์หยุดทำงาน / crash =====');
    console.log(log.split('\n').slice(-45).join('\n'));
  };
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) onExit();
  });

  // รอให้พร้อม
  let ready = false;
  for (let i = 0; i < 40 && !ready; i += 1) {
    try {
      await fetch(`${BASE}/api/office`);
      ready = true;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  if (!ready) {
    console.log('เซิร์ฟเวอร์ไม่พร้อม\n' + log);
    child.kill();
    process.exit(1);
  }
  console.log('เซิร์ฟเวอร์พร้อม');

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: asUser, password: passwd }),
  });
  const cookie = (loginRes.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  console.log(`login ${asUser}: ${loginRes.status}`);

  for (const t of targets) {
    log = '';
    try {
      const r = await fetch(BASE + t, { headers: { Cookie: cookie } });
      const body = await r.text();
      console.log(`\n--- ${t} → ${r.status}`);
      console.log('    ' + body.slice(0, 400).replace(/\n/g, '\n    '));
    } catch (e) {
      console.log(`\n--- ${t} → ${e.message} (เซิร์ฟเวอร์น่าจะ crash)`);
      console.log(log.split('\n').slice(-30).join('\n'));
      break;
    }
  }

  child.kill();
  await new Promise((r) => setTimeout(r, 200));
  for (const s of ['', '-wal', '-shm']) {
    if (fs.existsSync(tmp + s)) fs.unlinkSync(tmp + s);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
