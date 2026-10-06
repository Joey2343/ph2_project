/**
 * ดู DOM จริงของหน้าที่ระบุ พร้อมสถานะ route
 *
 *   node scripts/dump-page.mjs #/office
 *   node scripts/dump-page.mjs #/academic
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SERVER = process.env.SERVER_ORIGIN || 'http://127.0.0.1:3000';
const HASH = process.argv[2] || '#/office';
const PORT = 9900 + (process.pid % 90);
const CDP = `http://127.0.0.1:${PORT}`;

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const BROWSER = BROWSERS.find((b) => existsSync(b));
const profile = mkdtempSync(join(tmpdir(), 'p2dump-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  BROWSER,
  ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: 'ignore' },
);

let ver = null;
for (let i = 0; i < 60 && !ver; i++) {
  try {
    ver = await (await fetch(CDP + '/json/version')).json();
  } catch {
    await sleep(300);
  }
}
const target = await (await fetch(`${CDP}/json/new?url=about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
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

await send('Page.enable');
await send('Runtime.enable');

// ล็อกอินผ่าน API แล้วใส่ cookie
const lr = await fetch(SERVER + '/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'Joey2343**' }),
});
const sid = (lr.headers.getSetCookie() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('sid='));
if (sid) await send('Network.enable'), await send('Network.setCookie', { name: 'sid', value: decodeURIComponent(sid.slice(4)), domain: '127.0.0.1', path: '/' });

await send('Page.navigate', { url: SERVER + '/' + HASH });
await sleep(6000);

const r = await send('Runtime.evaluate', {
  expression: `(() => {
    const app = document.querySelector('#app');
    const r = window.__P2_ROUTER__ ? window.__P2_ROUTER__.currentRoute.value : null;
    return JSON.stringify({
      route: r ? r.fullPath : '?',
      param: r ? String(r.params.viewKey) : '?',
      appChildren: app ? [...app.children].map(c => c.tagName + '.' + (c.className||'')).slice(0,6) : [],
      hasPageHead: !!document.querySelector('.page-head'),
      pageTitle: (document.querySelector('.page-title')||{}).innerText || '',
      centerLoad: !!document.querySelector('.center-load'),
      centerLoadParents: [...document.querySelectorAll('.center-load')].map(e => {
        const p = e.parentElement;
        return (p ? p.tagName + '.' + (p.className||'(ไม่มี class)') : '?');
      }),
      appHtmlTail: app ? app.innerHTML.slice(-500) : '',
    }, null, 1);
  })()`,
  returnByValue: true,
});

console.log('URL:', SERVER + '/' + HASH);
console.log(r.result.result.value);

ws.close();
try {
  chrome.kill();
} catch {}
await sleep(400);
try {
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch {}
try {
  const d = globalThis[Symbol.for('undici.globalDispatcher.1')];
  if (d && typeof d.close === 'function') d.close();
} catch {}
setTimeout(() => process.exit(0), 50);
