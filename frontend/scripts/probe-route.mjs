/**
 * เครื่องมือ debug: เปิดหน้าที่ระบุในเบราว์เซอร์จริง แล้วพิมพ์สถานะการ route
 *
 *   node scripts/probe-route.mjs #/office
 *   node scripts/probe-route.mjs #/schools
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SERVER = process.env.SERVER_ORIGIN || 'http://127.0.0.1:3000';
const HASH = process.argv[2] || '#/office';
const PORT = 9500 + (process.pid % 300);
const CDP = `http://127.0.0.1:${PORT}`;

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const BROWSER = BROWSERS.find((b) => existsSync(b));
const profile = mkdtempSync(join(tmpdir(), 'p2probe-'));

const chrome = spawn(
  BROWSER,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    SERVER + '/' + HASH,
  ],
  { stdio: 'ignore', detached: false },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ver = null;
for (let i = 0; i < 60 && !ver; i++) {
  try {
    ver = await (await fetch(CDP + '/json/version')).json();
  } catch {
    await sleep(300);
  }
}
if (!ver) {
  console.log('เชื่อม DevTools ไม่ได้');
  process.exit(1);
}

const tabs = await (await fetch(`${CDP}/json/list`)).json();
const page = tabs.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let id = 0;
const pend = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    pend.get(m.id)(m);
    pend.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pend.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

await send('Runtime.enable');
await sleep(4000);

const expr = `JSON.stringify({
  href: location.href,
  hash: location.hash,
  routeFullPath: (window.__P2_ROUTER__ ? window.__P2_ROUTER__.currentRoute.value.fullPath : 'no-router'),
  routeName: (window.__P2_ROUTER__ ? window.__P2_ROUTER__.currentRoute.value.name : 'no-router'),
  routeParam: (window.__P2_ROUTER__ ? String(window.__P2_ROUTER__.currentRoute.value.params.key) : 'no-router'),
  matched: (window.__P2_ROUTER__ ? window.__P2_ROUTER__.currentRoute.value.matched.map(m => m.name || m.path) : []),
  historyLoc: (window.__P2_ROUTER__ ? window.__P2_ROUTER__.options.history.location : 'no-router'),
  viewLog: (window.__P2_LOG__ || []),
  appText: (document.querySelector('#app') ? document.querySelector('#app').innerText : '').slice(0, 100),
  hasWelcome: !!document.querySelector('.welcome-banner'),
  hasPageHead: !!document.querySelector('.page-head'),
  cardCount: document.querySelectorAll('.menu-card').length,
}, null, 1)`;

const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
console.log('URL ที่ขอ:', SERVER + '/' + HASH);
console.log(r.result?.result?.value || JSON.stringify(r));

ws.close();
try {
  chrome.kill();
} catch {}
await sleep(500);
try {
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch {
  /* chrome ยังล็อกไฟล์ไว้ — ปล่อยให้ OS ล้างตอนปิดเครื่อง */
}
process.exit(0);
