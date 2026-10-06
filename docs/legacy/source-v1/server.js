'use strict';
const path = require('path');
const express = require('express');
const auth = require('./lib/auth');
require('./lib/simdate').install(); // นาฬิกาจำลอง (settings: sim_today) — ต้องมาก่อนโค้ดที่ใช้ Date

const app = express();
// ใช้ PORT จาก environment ถ้าเป็นตัวเลขที่ถูกต้องเท่านั้น (ค่าเริ่มต้น 3000)
const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ผูกผู้ใช้จาก session cookie
app.use(auth.attachUser);

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/content'));
app.use('/api', require('./routes/ops'));
app.use('/api', require('./routes/requests'));
app.use('/api', require('./routes/admin'));

// ฟอนต์สำหรับเครื่องมือจัดการข้อความ (โฟล์เดอร์ font/)
app.use('/fonts', express.static(path.join(__dirname, 'font')));

// แบบฟอร์มเอกสาร (โฟล์เดอร์ form/ เช่น ครุฑ, ฟอร์มต้นฉบับ)
app.use('/form', express.static(path.join(__dirname, 'form')));

// Static files (frontend + uploads) — ไม่ให้แคชหน้า HTML เพื่อกันผู้ใช้เห็นโค้ดเก่าค้าง (JS/CSS ยังแคชได้ แต่มีเลขเวอร์ชันกำกับ)
app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// Fallback กลับไปที่หน้าแรก
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่' });
});

app.listen(PORT, () => {
  console.log('==============================================');
  console.log('  ระบบศูนย์กลางการบริหารจัดการ สพป.แพร่ เขต 2');
  console.log(`  เข้าถึงระบบได้ที่: http://localhost:${PORT}`);
  console.log('  ผู้ดูแลระบบ: admin');
  console.log('==============================================');
});
