/**
 * ตรวจการทำงานจริงของทุกหน้าในเบราว์เซอร์ (Chrome DevTools Protocol)
 *
 *   node scripts/verify-runtime.mjs            ตรวจหน้าแรก (ยังไม่ล็อกอิน)
 *   node scripts/verify-runtime.mjs --login    ตรวจหลังล็อกอินด้วย admin
 *   node scripts/verify-runtime.mjs --all      ตรวจทุกเมนู (13) + หน้าแรก
 *
 * ต่างจาก verify-build.mjs ตรงที่ script นี้เปิดเบราว์เซอร์จริงแล้วฟัง
 * Runtime.exceptionThrown / Log.entryAdded เพื่อจับ runtime error
 * ซึ่ง build สำเร็จแต่หน้าจะว่างไม่ได้
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SERVER = process.env.SERVER_ORIGIN || 'http://127.0.0.1:3000';
const USE_ALL = process.argv.includes('--all');
const USE_LOGIN = process.argv.includes('--login') || process.argv.includes('--auth') || USE_ALL;
const USE_AUTH = process.argv.includes('--auth');
const PORT = 9333 + (process.pid % 200);
const CDP = `http://127.0.0.1:${PORT}`;

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const BROWSER = BROWSERS.find((b) => existsSync(b));
if (!BROWSER) {
  console.log('ไม่พบ Chrome/Edge — ข้ามการตรวจ runtime');
  process.exit(0);
}

let pass = 0;
let fail = 0;
const ok = (m) => (pass++, console.log(`  ✓ ${m}`));
const bad = (m) => (fail++, console.log(`  ✗ ${m}`));
const check = (c, m) => (c ? ok(m) : bad(m));

const profile = mkdtempSync(join(tmpdir(), 'p2cdp-'));
let chrome;
let ws;
let msgId = 0;
const pending = new Map();
const listeners = [];

/* ---------------- CDP client ---------------- */
function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
function on(evt, fn) {
  listeners.push({ evt, fn });
}

async function boot() {
  chrome = spawn(
    BROWSER,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--disable-extensions',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );

  // รอให้ DevTools พร้อม
  let version = null;
  for (let i = 0; i < 60; i++) {
    try {
      version = await (await fetch(CDP + '/json/version')).json();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  if (!version) throw new Error('เชื่อมต่อ DevTools ไม่ได้');

  // เปิดแท็บใหม่
  const target = await (
    await fetch(`${CDP}/json/new?url=about:blank`, { method: 'PUT' })
  ).json();

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      return;
    }
    for (const l of listeners) if (l.evt === m.method) l.fn(m.params);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
}

/* ---------------- เก็บ error ระหว่างเปิดหน้า ---------------- */
let errors = [];
on('Runtime.exceptionThrown', (p) => {
  const d = p.exceptionDetails;
  errors.push('JS error: ' + (d.exception?.description || d.text || 'unknown').split('\n')[0]);
});
on('Runtime.consoleAPICalled', (p) => {
  if (p.type === 'error') {
    errors.push('console.error: ' + p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 160));
  }
});
on('Log.entryAdded', (p) => {
  if (p.entry.level === 'error') {
    const t = p.entry.text || '';
    // ไม่นับ error ที่มาจากการโหลดฟอนต์/ทรัพยากรภายนอก (ไม่มีผลกับหน้าตา)
    if (!/fonts\.googleapis|favicon|ERR_(NAME|INTERNET|CONNECTION)/i.test(t)) {
      errors.push('log: ' + t.slice(0, 160));
    }
  }
});

/* ---------------- ล็อกอินเพื่อเอา cookie มาใส่เบราว์เซอร์ ---------------- */
async function login() {
  const r = await fetch(SERVER + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Joey2343**' }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const setCookies = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  const sid = setCookies.map((c) => c.split(';')[0]).find((c) => c.startsWith('sid='));
  if (!sid) throw new Error('ไม่พบ cookie sid ในคำตอบจาก /api/auth/login');
  return decodeURIComponent(sid.slice(4));
}

/* ---------------- เปิดหน้าแล้วอ่านผล ---------------- */

/** รอให้เนื้อหาใน #app นิ่งสนิท (ไม่เปลี่ยนอีก) หรือครบเวลาที่กำหนด */
async function waitSettled(maxMs = 8000) {
  const started = Date.now();
  let last = null;
  let stable = 0;
  while (Date.now() - started < maxMs) {
    const r = await send('Runtime.evaluate', {
      expression: `(document.querySelector('#app')||{}).innerText || ''`,
      returnByValue: true,
    });
    const now = r.result.value;
    if (now === last && now.length > 0) {
      if (++stable >= 2) return;
    } else {
      stable = 0;
      last = now;
    }
    await new Promise((r2) => setTimeout(r2, 400));
  }
}

async function visit(hash, cookie) {
  errors = [];
  if (cookie) {
    await send('Network.setCookie', { name: 'sid', value: cookie, domain: '127.0.0.1', path: '/' });
  }

  // เปลี่ยน hash ในหน้าเว็บเลย (ไม่ใช้ Page.navigate)
  // เพราะการเปลี่ยนแค่ hash ไม่ทำให้หน้าโหลดใหม่ vue-router จัดการเอง
  // และถ้าใช้ Page.navigate จะต้องรอ load event ที่ไม่มีวันมา
  const first = hash === '';
  if (first) {
    await send('Page.navigate', { url: SERVER + '/#/' });
    await new Promise((r) => setTimeout(r, 3500));
  } else {
    await send('Runtime.evaluate', { expression: `location.hash = '#/${hash}'` });
    await new Promise((r) => setTimeout(r, 400));
  }
  await waitSettled();

  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector('#app');
      const rt = document.querySelector('.page-title');
      return JSON.stringify({
        html: el ? el.innerHTML : '',
        text: el ? el.innerText : '',
        route: window.__P2_ROUTER__ ? window.__P2_ROUTER__.currentRoute.value.fullPath : '?',
        routeParam: window.__P2_ROUTER__ ? String(window.__P2_ROUTER__.currentRoute.value.params.viewKey) : '?',
        pageTitle: rt ? rt.innerText.replace(/\\s+/g,' ').trim() : '',
        hasPageHead: !!document.querySelector('.page-head'),
        welcome: !!document.querySelector('.welcome-banner'),
        cards: document.querySelectorAll('.menu-card').length,
        denied: document.body.innerText.includes('ไม่สามารถเข้าถึงเมนู'),
        loggedIn: document.body.innerText.includes('ออกจากระบบ'),
        rows: document.querySelectorAll('.tbl tbody tr').length,
      });
    })()`,
    returnByValue: true,
  });
  return JSON.parse(r.result.value);
}

/* ---------------- ช่วยทดสอบฟอร์ม ---------------- */

/** ตั้งค่า input แบบที่ Vue v-model รับรู้ (ต้องใช้ native setter + dispatch 'input') */
const SET_VAL = `
function __setVal(el, v) {
  if (el instanceof HTMLSelectElement) {
    // select ใช้ value ปกติ แต่ต้องเลือก option ที่มีอยู่จริงก่อน
    const found = [...el.options].some(o => o.value === v);
    if (!found) return false;
    el.value = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}
function __click(sel) { const e = document.querySelector(sel); if (!e) return false; e.click(); return true; }
function __clickText(sel, text) {
  const list = [...document.querySelectorAll(sel)];
  const e = list.find(x => (x.innerText || '').includes(text));
  if (!e) return false; e.click(); return true;
}
true;`;

/** เตรียมฟังก์ชันช่วยในหน้าเว็บ */
async function installHelpers() {
  await send('Runtime.evaluate', { expression: SET_VAL });
}

/**
 * ประกอบนิพจน์ที่ต้องการ helper เสมอ
 *
 * ต้องฝังทุกครั้ง เพราะการเปลี่ยน URL (เช่น เติม ?guest=1) ทำให้หน้าโหลดใหม่
 * ตัวแปรบน window จึงหายไปต้องประกาศใหม่ทุกครั้งที่ evaluate
 */
function E(expr) {
  return `${SET_VAL}\n(() => { ${expr} })()`;
}

async function fill(selector, value) {
  const r = await send('Runtime.evaluate', {
    expression: E(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'no-el';
      __setVal(el, ${JSON.stringify(value)});
      return 'ok';
    `),
    returnByValue: true,
  });
  return r.result.value;
}

async function click(selector) {
  const r = await send('Runtime.evaluate', {
    expression: E(`return __click(${JSON.stringify(selector)});`),
    returnByValue: true,
  });
  return r.result.value === true;
}

async function clickText(selector, text) {
  const r = await send('Runtime.evaluate', {
    expression: E(`return __clickText(${JSON.stringify(selector)}, ${JSON.stringify(text)});`),
    returnByValue: true,
  });
  return r.result.value === true;
}

/** เลือกค่าใน <select> แบบที่ Vue v-model รับรู้ */
async function setSelect(selector, value) {
  const r = await send('Runtime.evaluate', {
    expression: E(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'no-el';
      __setVal(el, ${JSON.stringify(value)});
      return 'ok';
    `),
    returnByValue: true,
  });
  return r.result.value;
}

/**
 * สร้างเลขบัตรประชาชน 13 หลักที่ checksum ถูกต้อง
 * (สูตรเดียวกับที่ระบบใช้: ผล check digit = (11 - sum%11) % 10)
 */
function validCitizenId(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(first12[i], 10) * (13 - i);
  return first12 + String((11 - (sum % 11)) % 10);
}

/** เลือกตัวเลือกแรกที่ไม่ว่างใน <select> แล้วคืนค่าที่เลือก (ไม่ต้อง hardcode ค่าในสคริปต์) */
async function pickFirstOption(selector) {
  const r = await send('Runtime.evaluate', {
    expression: E(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'no-el';
      const opt = [...el.options].find(o => o.value !== '');
      if (!opt) return 'no-option';
      __setVal(el, opt.value);
      return 'ok:' + opt.value;
    `),
    returnByValue: true,
  });
  return r.result.value;
}

/** อ่าน innerText ของ element ตาม selector (null → '') */
async function textOf(selector) {
  const r = await send('Runtime.evaluate', {
    expression: E(`
      const el = document.querySelector(${JSON.stringify(selector)});
      return el ? (el.innerText || '') : '';
    `),
    returnByValue: true,
  });
  return r.result.value || '';
}

/** อ่านข้อความในหน้าต่างที่เปิดอยู่ + ชื่อ title
 *  ต้องดูทั้ง modal ของ Vue ([data-app-modal]) และ modal ของ UI kit (#modal-root)
 *  เพราะกล่องยืนยันยังเป็นโค้ดเดิมอยู่ */
async function modalState() {
  const r = await send('Runtime.evaluate', {
    expression: E(`
      const m = document.querySelector('[data-app-modal]') || document.querySelector('#modal-root .modal');
      const t = (document.querySelector('[data-app-modal] .modal-title') || document.querySelector('#modal-root .modal-title'));
      const toast = [...document.querySelectorAll('#toast-root .toast')].map(x => x.innerText).join(' | ');
      return JSON.stringify({
        open: !!m,
        title: t ? t.innerText.trim() : '',
        body: m ? m.innerText : '',
        bodyLen: m ? m.innerText.length : 0,
        fields: m ? m.querySelectorAll('input,select,textarea').length : 0,
        toast,
      });
    `),
    returnByValue: true,
  });
  return JSON.parse(r.result.value);
}

/** ปิดหน้าต่างที่เปิดอยู่ (ปุ่ม ✕ ของ modal) */
async function closeModal() {
  await click('[data-app-modal] .modal-close');
  await new Promise((r) => setTimeout(r, 400));
}

/* ---------------- เริ่มตรวจ ---------------- */
console.log(`ตรวจการทำงานจริง (${BROWSER.split('\\').pop()} · CDP)\n`);

let cookie = null;
try {
  await boot();
  ok('เปิดเบราว์เซอร์และเชื่อม DevTools สำเร็จ');
} catch (e) {
  bad('เปิดเบราว์เซอร์ไม่สำเร็จ: ' + e.message);
}

if (USE_LOGIN) {
  try {
    cookie = await login();
    ok('ล็อกอินผ่าน API ได้ (admin)');
  } catch (e) {
    bad('ล็อกอินไม่สำเร็จ: ' + e.message);
  }
}

if (ws) {
  // ---- 1. หน้าแรก ----
  const home = await visit('', cookie);
  check(home.route === '/', `หน้าแรก: route = ${home.route}`);
  check(home.welcome, 'หน้าแรก: เห็น banner "ยินดีต้อนรับ"');
  check(home.text.includes('P2-SMART'), 'หน้าแรก: เห็นชื่อระบบ');
  if (USE_LOGIN) {
    check(home.loggedIn, 'หลังล็อกอิน: แถบบนเปลี่ยนเป็นปุ่ม "ออกจากระบบ"');
    check(home.cards > 0, `หลังล็อกอิน: วาดการ์ดเมนู ${home.cards} ใบ`);
  } else {
    check(home.text.includes('เข้าสู่ระบบ'), 'ยังไม่ล็อกอิน: เห็นปุ่ม "เข้าสู่ระบบ"');
  }
  check(errors.length === 0, 'หน้าแรก: ไม่มี runtime error' + (errors.length ? ' → ' + errors.slice(0, 2).join(' | ') : ''));

  // ---- 2. ทุกเมนู ----
  if (USE_ALL) {
    const KEYS = [
      'office', 'schools', 'documents', 'clock', 'vehicles', 'rooms', 'memos',
      'travel', 'travel-school', 'leave', 'budgets', 'academic', 'staff',
    ];
    console.log('');
    for (const key of KEYS) {
      const v = await visit(key, cookie);
      const threw = v.text.includes('เกิดข้อผิดพลาดในการแสดงผลหน้านี้');
      const empty = v.html.trim() === '';
      if (errors.length) bad(`#/${key}: runtime error → ${errors[0].slice(0, 110)}`);
      else if (threw) bad(`#/${key}: view โยน error → ${v.text.slice(0, 110)}`);
      else if (empty) bad(`#/${key}: หน้าว่างเปล่า`);
      else if (v.denied) bad(`#/${key}: ถูกปฏิเสธสิทธิ์ (admin ควรเข้าได้)`);
      else if (v.routeParam !== key) bad(`#/${key}: route param ไม่ตรง (ได้ "${v.routeParam}")`);
      else if (!v.pageTitle) bad(`#/${key}: ไม่พบหัวหน้าหน้า (.page-title)`);
      else if (v.welcome) bad(`#/${key}: ยังแสดงหน้าแรกอยู่ — เส้นทางไม่เปลี่ยน`);
      else ok(`#/${key}: ${v.pageTitle}${v.rows ? ` · ${v.rows} แถว` : ''}`);
    }
  }
  // ---- 3. Auth UI (Phase 2: LoginModal / RegisterModal / ProfileModal / AccessDenied) ----
  if (USE_AUTH) {
    console.log('');
    console.log('— ทดสอบหน้าต่างเข้าสู่ระบบ (ยังไม่ล็อกอิน) —');

    // ล้าง cookie แล้วบังคับให้หน้าโหลดใหม่จริง ๆ
    // (การเปลี่ยนแค่ hash ไม่ทำให้แอปรีโหลด → state ใน memory ของ Vue ยังคงเดิม)
    await send('Network.clearBrowserCookies');
    await send('Page.navigate', { url: SERVER + '/?guest=1#/' });
    await new Promise((r) => setTimeout(r, 4000));

    const homeGuest = await visit('', null);
    check(homeGuest.loggedIn === false, 'เริ่มต้น: ยังไม่ล็อกอิน (ไม่มีปุ่ม "ออกจากระบบ")');
    check(homeGuest.text.includes('เข้าสู่ระบบ'), 'แถบบน: เห็นปุ่ม "เข้าสู่ระบบ"');

    // --- เปิดหน้าต่างเข้าสู่ระบบ ---
    await clickText('.topbar-right .btn', 'เข้าสู่ระบบ');
    await new Promise((r) => setTimeout(r, 700));
    let m = await modalState();
    check(m.open && m.title.includes('เข้าสู่ระบบ'), `หน้าต่างเข้าสู่ระบบเปิดได้ (${m.title || 'ไม่มีหัวเรื่อง'})`);
    check((await fill('#login-user', 'admin')) === 'ok', 'มีช่องชื่อผู้ใช้ #login-user');
    check((await fill('#login-pass', 'Joey2343**')) === 'ok', 'มีช่องรหัสผ่าน #login-pass');
    ok('พิมพ์ใส่ค่าในช่องได้');

    // --- รหัสผิดต้องต้องแสดง error ---
    await fill('#login-user', 'admin');
    await fill('#login-pass', 'ผิดแน่นอน');
    await click('#login-submit');
    await new Promise((r) => setTimeout(r, 1500));
    m = await modalState();
    check(m.open, 'รหัสผิด: หน้าต่างยังเปิดอยู่ (ไม่ได้เข้าสู่ระบบ)');
    check(m.toast.length > 0, `รหัสผิด: แสดงข้อความแจ้ง error (${m.toast.slice(0, 50)})`);

    // --- ช่องว่าง ---
    await fill('#login-user', '');
    await fill('#login-pass', '');
    await click('#login-submit');
    await new Promise((r) => setTimeout(r, 800));
    m = await modalState();
    check(m.toast.includes('กรุณากรอกชื่อผู้ใช้'), 'กรอกไม่ครบ: แจ้งให้กรอกชื่อผู้ใช้และรหัสผ่าน');

    // --- รหัสถูกต้อง ---
    await fill('#login-user', 'admin');
    await fill('#login-pass', 'Joey2343**');
    await click('#login-submit');
    await new Promise((r) => setTimeout(r, 2500));
    m = await modalState();
    const after = await visit('', null);
    check(!m.open, 'รหัสถูก: หน้าต่างเข้าสู่ระบบปิดอัตโนมัติ');
    check(after.loggedIn === true, 'รหัสถูก: แถบบนเปลี่ยนเป็น "ออกจากระบบ" (Pinia อัปเดตเอง)');
    check(after.cards > 0, `รหัสถูก: กลับหน้าแรกและเห็นการ์ดเมนู ${after.cards} ใบ`);
    check(errors.length === 0, 'ล็อกอิน: ไม่มี runtime error' + (errors.length ? ' → ' + errors[0].slice(0, 90) : ''));

    // --- โปรไฟล์ ---
    await click('.user-chip');
    await new Promise((r) => setTimeout(r, 1200));
    m = await modalState();
    check(m.open && m.title.includes('โปรไฟล์'), `คลิกชื่อผู้ใช้แล้วเปิดหน้าโปรไฟล์ (${m.title})`);
    check(m.fields > 15, `หน้าโปรไฟล์มีช่องกรอกครบ (${m.fields} ช่อง)`);
    check(m.body.includes('เปลี่ยนรหัสผ่าน'), 'หน้าโปรไฟล์มีส่วนเปลี่ยนรหัสผ่าน');
    check(m.body.includes('ผู้ดูแลระบบ'), 'หน้าโปรไฟล์แสดง badge ผู้ดูแลระบบ');
    check((await fill('#pf-nick', 'ทดสอบ')) === 'ok', 'กรอกช่องชื่อเล่นในหน้าโปรไฟล์ได้ (#pf-nick)');
    check((await fill('#pf-phone', '081-2345678')) === 'ok', 'กรอกช่องเบอร์โทรศัพท์ได้ (#pf-phone)');
    await closeModal();
    m = await modalState();
    check(!m.open, 'ปิดหน้าโปรไฟล์ได้');

    // --- ออกจากระบบ ---
    await clickText('.btn', 'ออกจากระบบ');
    await new Promise((r) => setTimeout(r, 900));
    const conf = await modalState();
    check(conf.open && conf.title.includes('ยืนยัน'), `กดออกจากระบบแล้วขึ้นกล่องยืนยัน (${conf.title})`);
    await clickText('#modal-root .btn', 'ออกจากระบบ');
    await new Promise((r) => setTimeout(r, 2000));
    const out = await visit('', null);
    check(out.loggedIn === false, 'ออกจากระบบสำเร็จ (แถบบนกลับเป็นปุ่มเข้าสู่ระบบ)');

    // --- หน้าถูกปฏิเสธสิทธิ์ (AccessDenied component) ---
    await visit('memos', null);
    await new Promise((r) => setTimeout(r, 800));
    const denied = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        hasLock: document.body.innerText.includes('ไม่สามารถเข้าถึงเมนู'),
        hasLoginBtn: !!document.querySelector('#app .btn-primary'),
        isVue: !!document.querySelector('#app .card > div[style]'),
      })`,
      returnByValue: true,
    });
    const d = JSON.parse(denied.result.value);
    check(d.hasLock, 'ยังไม่ล็อกอินแล้วเปิดเมนูสมาชิก: แสดงหน้า 🔒 ไม่มีสิทธิ์');
    check(d.hasLoginBtn, 'หน้าไม่มีสิทธิ์: มีปุ่ม "เข้าสู่ระบบ" ให้กด');

    // --- ลงทะเบียน: ขั้นที่ 1 เลือกประเภท ---
    await clickText('#app .btn', 'เข้าสู่ระบบ');
    await new Promise((r) => setTimeout(r, 700));
    await clickText('.modal-body a', 'ลงทะเบียนสมาชิก');
    await new Promise((r) => setTimeout(r, 800));
    m = await modalState();
    check(m.open && m.title.includes('ลงทะเบียนสมาชิกใหม่'), `จากหน้าเข้าสู่ระบบไปหน้าลงทะเบียนได้ (${m.title})`);
    check(m.body.includes('เลือกประเภทการลงทะเบียน'), 'ขั้นที่ 1: ให้เลือกประเภทการลงทะเบียน');
    check(m.body.includes('สพป.แพร่ เขต 2'), 'ขั้นที่ 1: มีตัวเลือกเจ้าหน้าที่ สพป.');
    check(m.body.includes('เจ้าหน้าที่สถานศึกษา'), 'ขั้นที่ 1: มีตัวเลือกเจ้าหน้าที่สถานศึกษา');

    // --- ขั้นที่ 2 ฟอร์มสมัคร (สพป.) ---
    await clickText('.modal-body .btn', 'ลงทะเบียนเจ้าหน้าที่ สพป.แพร่ เขต 2');
    await new Promise((r) => setTimeout(r, 900));
    m = await modalState();
    check(m.title.includes('ลงทะเบียนสมาชิกใหม่'), `ขั้นที่ 2: เปิดฟอร์มสมัครได้ (${m.title})`);
    check(m.body.includes('📇 ข้อมูลส่วนตัว'), 'ฟอร์มสมัคร: มีส่วนข้อมูลส่วนตัว');
    check(m.body.includes('🤖 การแจ้งเตือนผ่าน Telegram Bot'), 'ฟอร์มสมัคร: มีส่วน Telegram');
    check(m.body.includes('🔐 บัญชีผู้ใช้'), 'ฟอร์มสมัคร: มีส่วนบัญชีผู้ใช้');
    check(m.body.includes('🖼️ รูปถ่ายและลายเซ็น'), 'ฟอร์มสมัคร: มีส่วนรูปถ่ายและลายเซ็น');
    check(m.body.includes('สังกัด / กลุ่มงาน'), 'ฟอร์มสมัคร (สพป.): ป้ายช่องคือ "สังกัด / กลุ่มงาน"');
    check(m.body.includes('ปฏิบัติงานหลายแห่ง') === false, 'ฟอร์มสมัคร (สพป.): ไม่มีตัวเลือกปฏิบัติงานหลายแห่ง');
    check(m.fields >= 18, `ฟอร์มสมัคร: มีช่องกรอก ${m.fields} ช่อง`);

    // กรองเฉพาะตัวเลข: พิมพ์ค่าที่มีตัวอักษรปนมา ต้องเหลือแต่ตัวเลข
    await fill('#reg-cid', '157990012345x6');
    await new Promise((r) => setTimeout(r, 300));
    const cidValue = await send('Runtime.evaluate', {
      expression: E(`return (document.querySelector('#reg-cid')||{}).value || '';`),
      returnByValue: true,
    });
    check(
      /^\d*$/.test(cidValue.result.value) && cidValue.result.value.length === 13,
      `ช่องเลขบัตรประชาชน: ตัดตัวอักษรทิ้ง เหลือ "${cidValue.result.value}" (13 หลัก)`,
    );

    // ตรวจเลขบัตรประชาชนถูกต้องแบบ realtime
    await fill('#reg-cid', '1579900123456');
    await new Promise((r) => setTimeout(r, 300));
    const cidHint = await textOf('#reg-cid-hint');
    check(
      cidHint.includes('✅') || cidHint.includes('❌'),
      `ช่องเลขบัตรประชาชน: ตรวจ checksum แบบ realtime ("${cidHint.slice(0, 30)}")`,
    );

    // ตรวจความแข็งแรงรหัสผ่านแบบ realtime
    await fill('#reg-pass', 'abc');
    await new Promise((r) => setTimeout(r, 300));
    let hint = await textOf('#reg-pass-hint');
    check(hint.includes('ยังขาด'), `ช่องรหัสผ่าน: แจ้งว่าอะไรขาด ("${hint.slice(0, 40)}")`);

    await fill('#reg-pass', 'Joey2343**');
    await new Promise((r) => setTimeout(r, 300));
    hint = await textOf('#reg-pass-hint');
    check(hint.includes('✅'), `ช่องรหัสผ่าน: แจ้งผ่านเกณฑ์เมื่อครบ ("${hint.slice(0, 30)}")`);

    // ส่งฟอร์มที่ไม่ครบ → ต้องเตือน ไม่ใช่ crash
    await click('#reg-submit');
    await new Promise((r) => setTimeout(r, 900));
    m = await modalState();
    check(m.toast.includes('กรุณากรอกข้อมูลที่จำเป็น'), 'สมัครข้อมูลไม่ครบ: แจ้งเตือนรายการที่ต้องกรอก');

    // กรอกข้อมูลจำเป็นครบ แล้วให้รหัสยืนยันไม่ตรง → ต้องเตือนเรื่องรหัสผ่าน
    // (ลำดับการตรวจของจริง: ข้อมูลจำเป็น → เลขบัตรประชาชน → ยืนยันรหัสผ่าน
    //  ต้องใช้เลขบัตรที่ checksum ถูกต้อง ไม่งั้นจะหยุดที่ขั้นตรวจเลขบัตร)
    const goodCid = validCitizenId('157990012345');
    check(goodCid.length === 13, `สร้างเลขบัตรประชาชนที่ checksum ถูกต้องได้ (${goodCid})`);
    await fill('#reg-cid', goodCid);
    await new Promise((r) => setTimeout(r, 300));
    const goodHint = await textOf('#reg-cid-hint');
    check(goodHint.includes('✅'), `เลขบัตรที่สร้างมา: ผ่าน checksum ("${goodHint.slice(0, 30)}")`);

    await fill('[name="first_name"]', 'สมชาย');
    await fill('[name="last_name"]', 'ใจดี');
    const pos = await pickFirstOption('#reg-position');
    const work = await pickFirstOption('#reg-workplace');
    check(pos.startsWith('ok:'), `เลือกตำแหน่งได้ (${pos.slice(0, 40)})`);
    check(work.startsWith('ok:'), `เลือกกลุ่มงานได้ (${work.slice(0, 40)})`);
    await fill('[name="username"]', 'testuser01');
    await fill('#reg-pass', 'Joey2343**');
    await fill('#reg-pass2', 'ไม่ตรงกัน');
    await click('#reg-submit');
    await new Promise((r) => setTimeout(r, 900));
    m = await modalState();
    check(
      m.toast.includes('ยืนยันรหัสผ่านไม่ตรงกัน'),
      `ยืนยันรหัสผ่านไม่ตรง: แจ้งเตือนถูกต้อง (toast = "${m.toast.replace(/\n/g, ' ').slice(0, 70)}")`,
    );

    // เลขบัตรประชาชนไม่ผ่าน checksum → ต้องเตือน
    await fill('#reg-cid', goodCid.slice(0, 12) + ((parseInt(goodCid[12], 10) + 5) % 10));
    await fill('#reg-pass2', 'Joey2343**');
    await new Promise((r) => setTimeout(r, 300));
    await click('#reg-submit');
    await new Promise((r) => setTimeout(r, 900));
    m = await modalState();
    check(
      m.toast.includes('เลขบัตรประชาชนไม่ถูกต้อง'),
      `เลขบัตรประชาชนไม่ถูกต้อง: แจ้งเตือนถูกต้อง (toast = "${m.toast.replace(/\n/g, ' ').slice(0, 70)}")`,
    );

    // --- ฟอร์มสมัครเจ้าหน้าที่สถานศึกษา ---
    await closeModal();
    await clickText('.topbar-right .btn', 'ลงทะเบียน');
    await new Promise((r) => setTimeout(r, 800));
    await clickText('.modal-body .btn', 'ลงทะเบียนเจ้าหน้าที่สถานศึกษา');
    await new Promise((r) => setTimeout(r, 1500));
    m = await modalState();
    check(m.title.includes('เจ้าหน้าที่สถานศึกษา'), `เลือกสมัครเป็นเจ้าหน้าที่สถานศึกษาได้ (${m.title})`);
    check(m.body.includes('สถานศึกษา'), 'ฟอร์มสมัคร (สถานศึกษา): ป้ายช่องเป็น "สถานศึกษา"');
    check(m.body.includes('ปฏิบัติงานหลายแห่ง'), 'ฟอร์มสมัคร (สถานศึกษา): มีตัวเลือกปฏิบัติงานหลายแห่ง');
    check(errors.length === 0, 'หน้าลงทะเบียน: ไม่มี runtime error' + (errors.length ? ' → ' + errors[0].slice(0, 90) : ''));
    await closeModal();
  }
}

/* ---------------- ปิด ---------------- */
try {
  ws?.close();
} catch {}
try {
  chrome?.kill();
} catch {}
try {
  rmSync(profile, { recursive: true, force: true });
} catch {}

console.log(`\nผ่าน ${pass} · ไม่ผ่าน ${fail}`);

/**
 * ปิด keep-alive socket ของ fetch ก่อนออก (กัน assertion error ตอน exit บน Windows)
 *
 * ⚠ ต้อง await close() ให้จบก่อนออก
 *   เดิมใช้ setTimeout(50) แล้ว process.exit() ทัน → ออกกลางที่ handle กำลังปิด
 *   ทำให้ crash แบบสุ่ม (0xC0000409) ทั้งที่ผลทดสอบผ่านหมด
 *   และทำให้ chain "&&" ใน verify:all พังเป็นครั้งคราว
 */
async function shutdown(code) {
  process.exitCode = code;
  try {
    const dispatcher = globalThis[Symbol.for('undici.globalDispatcher.1')];
    if (dispatcher && typeof dispatcher.close === 'function') {
      await Promise.race([
        dispatcher.close(),
        new Promise((r) => setTimeout(r, 2000).unref?.() ?? setTimeout(r, 0)),
      ]);
    }
  } catch {
    /* ไม่มี undici dispatcher หรือปิดไม่สำเร็จ — ปล่อยให้ watchdog จัดการ */
  }
  // watchdog: ถ้ายังมี handle ค้าง Node จะไม่ออกเอง ให้บังคับ
  setTimeout(() => process.exit(code), 500);
}

await shutdown(fail ? 1 : 0);
