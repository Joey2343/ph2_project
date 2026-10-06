'use strict';
/**
 * ระบบศูนย์กลางการบริหารจัดการ สพป.แพร่ เขต 2 — จุดเริ่มต้นเซิร์ฟเวอร์
 *
 * รองรับ SQLite (ค่าเริ่มต้น) และ MySQL 8.0+/MariaDB 10.4+
 * เลือก dialect ตอน deploy-time จาก DATABASE_URL (ดู db/config.js)
 *
 * การเปลี่ยนแปลงจากรุ่นเดิม:
 *   1. เชื่อมต่อฐานข้อมูก่อนเปิดพอร์ต (เดิมทำงานตอน require)
 *   2. ห่อ async route handler ให้ error เข้า error handler
 *   3. เสิร์ฟ frontend ที่ build แล้วจาก ../frontend/dist (ถ้ามี)
 *   4. ย้ายไปใช้ mysql2 แทน better-sqlite3, และ node:sqlite แทน driver ของ SQLite
 */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const db = require('./db');
const auth = require('./lib/auth');
const { wrapHandler } = require('./lib/async-route');

require('./lib/simdate').install(); // นาฬิกาจำลอง (settings: sim_today) — ต้องมาก่อนโค้ดที่ใช้ Date

const app = express();
// ใช้ PORT จาก environment ถ้าเป็นตัวเลขที่ถูกต้องเท่านั้น (ค่าเริ่มต้น 3000)
const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3000;

// ── ไฟล์สถานะ ────────────────────────────────────────────────────────────────
// โฟลเดอร์ public/ ของ backend (uploads, logo, ฟอนต์, แบบฟอร์ม)
const BACKEND_PUBLIC = path.join(__dirname, 'public');
// ผลลัพธ์ build ของ frontend (npm run build ในโฟลเดอร์ frontend)
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');
const FRONTEND_EXISTS = fs.existsSync(path.join(FRONTEND_DIST, 'index.html'));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ผูกผู้ใช้จาก session cookie
app.use(wrapHandler(auth.attachUser));

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/content'));
app.use('/api', require('./routes/ops'));
app.use('/api', require('./routes/requests'));
app.use('/api', require('./routes/admin'));

// ฟอนต์สำหรับเครื่องมือจัดการข้อความ (โฟลเดอร์ font/)
app.use('/fonts', express.static(path.join(__dirname, 'font')));

// แบบฟอร์มเอกสาร (โฟลเดอร์ form/ เช่น ครุฑ, ฟอร์มต้นฉบับ)
app.use('/form', express.static(path.join(__dirname, 'form')));

// ไฟล์จาก frontend ที่ build แล้ว (มี hash ชื่อไฟล์ จึง cache ได้ยาว)
if (FRONTEND_EXISTS) {
  app.use(
    express.static(FRONTEND_DIST, {
      setHeaders: (res, filePath) => {
        // index.html ต้องไม่ cache เพื่อให้เห็น build ใหม่ทันที
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      },
    })
  );
}

// uploads, logo.png และไฟล์อื่นใน backend/public (cache ได้)
app.use(
  express.static(BACKEND_PUBLIC, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  })
);

// Fallback — SPA: ส่ง index.html ของ frontend (ถ้ายังไม่ได้ build จะแนะนำให้ build)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (!FRONTEND_EXISTS) {
    return res
      .status(503)
      .type('html')
      .send(
        '<meta charset="utf-8">' +
          '<body style="font-family:sans-serif;padding:40px;line-height:1.7">' +
          '<h2>ยังไม่ได้ build หน้าเว็บ</h2>' +
          '<p>รันคำสั่งนี้เพื่อสร้าง frontend:</p>' +
          '<pre style="background:#f1f5f9;padding:12px;border-radius:8px">cd frontend\nnpm install\nnpm run build</pre>' +
          '<p>ระหว่างพัฒนาใช้ <code>npm run dev</code> ในโฟลเดอร์ frontend แทน ' +
          '(Vite proxy จะยิง API มาที่พอร์ตนี้)</p>' +
          '</body>'
      );
  }
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่' });
});

/** เปิดการเชื่อมต่อ + สร้าง schema แล้วจึงเริ่มฟังพอร์ต */
async function start() {
  await db.init();
  await db.bootstrap();

  app.listen(PORT, () => {
    console.log('==============================================');
    console.log('  ระบบศูนย์กลางการบริหารจัดการ สพป.แพร่ เขต 2');
    console.log(`  เข้าถึงระบบได้ที่: http://localhost:${PORT}`);
    console.log(`  ฐานข้อมูล: ${db.connectionInfo}`);
    console.log(
      `  หน้าเว็บ: ${FRONTEND_EXISTS ? FRONTEND_DIST : '(ยังไม่ได้ build — ใช้ frontend dev server)'}`
    );
    console.log('  ผู้ดูแลระบบ: admin');
    console.log('==============================================');
  });
}

start().catch((err) => {
  console.error('เริ่มระบบไม่สำเร็จ:', err);
  process.exit(1);
});

module.exports = app;
