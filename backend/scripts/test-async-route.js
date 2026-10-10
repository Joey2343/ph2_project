'use strict';
/**
 * ทดสอบว่า error ใน async route ไม่ทำให้ทั้งเซิร์ฟเวอร์ล่ม
 *
 * บั๊กที่เคยเจอจริง
 * ─────────────────
 * 1) ใช้ SQL ที่ MariaDB ไม่รู้จัก (GLOB เป็นของ SQLite) ใน /my-incoming
 * 2) route handler เป็น async ที่ throw — Express 4 ไม่ catch promise ให้
 * 3) error หลุดเป็น unhandled rejection → Node ปิดทั้ง process
 * 4) ผลคือผู้ใช้ทุกคนหลุดจากระบบพร้อมกัน จากบั๊กของหน้าเดียว
 *
 * เทสต์นี้จะทำให้แน่ใจว่า
 *   - error handler ได้รับ error (คืน 500 + JSON ไม่ค้าง)
 *   - route ที่ลงทะเบียน "ก่อน" เรียก wrapRouter() ก็ถูกห่อด้วย
 *   - route ปกติยังทำงานเหมือนเดิม
 *   - process ไม่ตาย
 *
 * ใช้: node scripts/test-async-route.js
 */
const http = require('http');
const express = require('express');
const { wrapRouter } = require('../lib/async-route');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log('  ✔ ' + m); };
const bad = (m) => { fail += 1; console.log('  ✗ ' + m); };
const check = (c, m) => (c ? ok(m) : bad(m));

/** เปิดเซิร์ฟเวอร์ชั่วคราว ยิง 1 ครั้ง แล้วปิด */
function request(app, path) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const req = http.get({ host: '127.0.0.1', port, path, timeout: 8000 }, (res) => {
        let b = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { b += d; });
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: b }); });
      });
      req.on('error', () => { server.close(); resolve({ status: 0, body: '' }); });
      req.on('timeout', () => { req.destroy(); server.close(); resolve({ status: 0, body: '' }); });
    });
  });
}

/* error middleware แบบ 4 พารามิเตอร์ — เช่น uploadErrorHandler
   Express ข้ามมันในเส้นทางปกติ (ดู Layer.handle_request: if (fn.length > 3) next())
   ถ้า wrapper ทำให้ length เป็น 0 มันจะถูกเรียกผิดแบบ → พัง */
function uploadErrorHandler(err, req, res, next) {
  if (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'ไฟล์ใหญ่เกินไป' });
    }
    return res.status(400).json({ error: err.message || 'อัปโหลดล้มเหลว' });
  }
  next();
}

/** POST JSON ไปหาเซิร์ฟเวอร์ชั่วคราว */
function postJson(app, path, obj) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    const body = JSON.stringify(obj || {});
    server.listen(0, () => {
      const port = server.address().port;
      const req = http.request(
        { host: '127.0.0.1', port, path, method: 'POST', timeout: 8000,
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        (res) => {
          let b = '';
          res.setEncoding('utf8');
          res.on('data', (d) => { b += d; });
          res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: b }); });
        }
      );
      req.on('error', () => { server.close(); resolve({ status: 0, body: '' }); });
      req.on('timeout', () => { req.destroy(); server.close(); resolve({ status: 0, body: '' }); });
      req.write(body);
      req.end();
    });
  });
}

async function main() {
  console.log('=== ทดสอบ: async route ที่ error ต้องไม่ทำให้เซิร์ฟเวอร์ล่ม ===');
  console.log('');

  const app = express();

  /* กลุ่มที่ 1 — ลงทะเบียน "ก่อน" wrapRouter()
     นี่คือกรณีที่เคยพลาด: patch router.get ทีหลัง ไม่กระทบ route ที่ลงทะเบียนแล้ว */
  const r1r = express.Router();
  r1r.get('/before', async () => { throw new Error('boom-before'); });
  r1r.get('/before-reject', async () => { await Promise.reject(new Error('boom-before-reject')); });

  /* กลุ่มที่ 2 — ลงทะเบียน "หลัง" wrapRouter() */
  const r2r = express.Router();
  const r2wrapped = wrapRouter(r2r);
  r2r.get('/after', async () => { throw new Error('boom-after'); });
  r2wrapped.get('/after2', async () => { throw new Error('boom-after2'); });

  /* กลุ่มที่ 3 — route ปกติ ต้องยังทำงานเหมือนเดิม */
  const r3r = express.Router();
  r3r.get('/plain', (req, res) => res.json({ ok: true }));
  r3r.get('/plain-async', async (req, res) => res.json({ ok: true, kind: 'async' }));
  r3r.get('/plain-args/:id', async (req, res) => res.json({ id: req.params.id }));

  /* กลุ่มที่ 4 — endpoint ที่แนบไฟล์ (มี error middleware 4 พารามิเตอร์อยู่ในเส้นทาง)
     ถ้า wrapper ทำให้ length เป็น 0 → uploadErrorHandler จะถูกเรียกผิดแบบ
     แล้วพังทั้ง endpoint (เคยเจอจริง: "res.status is not a function") */
  const r4r = express.Router();
  r4r.post('/upload', uploadErrorHandler, async (req, res) => {
    res.json({ ok: true, file: req.file || null });
  });

  app.use('/a', wrapRouter(r1r));
  app.use('/b', r2wrapped);
  app.use('/c', wrapRouter(r3r));
  app.use('/d', wrapRouter(r4r));

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    res.status(500).json({ error: err.message });
  });

  console.log('route ที่ลงทะเบียนก่อน wrapRouter() — เคยหลุดเป็น unhandled rejection:');
  const a1 = await request(app, '/a/before');
  check(a1.status === 500, 'throw ใน async handler → 500 (ได้ ' + a1.status + ')');
  check(/boom-before/.test(a1.body), 'ส่งข้อความ error กลับมา ไม่ค้าง');
  const a2 = await request(app, '/a/before-reject');
  check(a2.status === 500, 'Promise.reject → 500 (ได้ ' + a2.status + ')');

  console.log('');
  console.log('route ที่ลงทะเบียนหลัง wrapRouter():');
  const b1 = await request(app, '/b/after');
  check(b1.status === 500, '500 (ได้ ' + b1.status + ')');
  const b2 = await request(app, '/b/after2');
  check(b2.status === 500, '500 (ได้ ' + b2.status + ')');

  console.log('');
  console.log('route ปกติต้องยังทำงาน:');
  const c1 = await request(app, '/c/plain');
  check(c1.status === 200 && /"ok":true/.test(c1.body), 'sync handler');
  const c2 = await request(app, '/c/plain-async');
  check(c2.status === 200 && /"kind":"async"/.test(c2.body), 'async handler');
  const c3 = await request(app, '/c/plain-args/42');
  check(c3.status === 200 && /"id":"42"/.test(c3.body), 'async handler ที่มี params');

  console.log('');
  console.log('error middleware 4 พารามิเตอร์ ต้องถูกข้ามในเส้นทางปกติ:');
  const d1 = await postJson(app, '/d/upload', { title: 'ทดสอบแนบไฟล์' });
  check(d1.status === 200 && /"ok":true/.test(d1.body), 'POST ที่มี uploadErrorHandler ยังทำงาน (ได้ ' + d1.status + ')');

  console.log('');
  console.log('process ยังไม่ตาย — ยิงซ้ำหลัง error:');
  const a3 = await request(app, '/a/before');
  check(a3.status === 500, 'ยังตอบ 500 ได้');
  const c4 = await request(app, '/c/plain');
  check(c4.status === 200, 'route ปกติยังใช้ได้');

  console.log('');
  console.log('ผ่าน ' + pass + ' · ไม่ผ่าน ' + fail);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => {
  console.error('ทดสอบล้มเหลว:', e);
  process.exitCode = 1;
});