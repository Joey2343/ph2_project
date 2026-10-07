'use strict';
/**
 * ตรวจความถูกต้องทั้งระบบด้วยคำสั่งเดียว
 *
 * ระบบใช้ MariaDB 11.4 ตัวเดียว จึงไม่มีการเทียบระหว่าง dialect แล้ว
 *
 * ตัวแปรที่ต้องตั้ง:
 *   DATABASE_URL         ฐานข้อมูลจริง (ใช้ตรวจ schema)   เช่น .../admin_ph2
 *   SMOKE_DATABASE_URL   ฐานทดสอบ (ชื่อต้องลงท้าย _test)   เช่น .../admin_ph2_test
 *
 * ใช้: node scripts/verify.js
 */

require('dotenv').config();

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..');
const PROJECT = path.join(BACKEND, '..');
const DATABASE_URL = process.env.DATABASE_URL || '';

function run(label, args, opts = {}) {
  process.stdout.write(`  ${label} … `);
  const r = spawnSync(process.execPath, args, {
    cwd: opts.cwd || BACKEND,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1', ...opts.env },
  });
  const ok = r.status === 0;
  process.stdout.write(ok ? 'ผ่าน\n' : 'ไม่ผ่าน\n');
  if (!ok && r.stdout) {
    const lines = r.stdout.split('\n').filter((l) => l.trim()).slice(-12);
    lines.forEach((l) => console.log(`      ${l}`));
  }
  if (!ok && r.stderr) {
    const lines = r.stderr.split('\n').filter((l) => l.trim()).slice(-8);
    lines.forEach((l) => console.log(`      ${l}`));
  }
  return ok;
}

function nodeVersionOk() {
  const major = Number(process.versions.node.split('.')[0]);
  return { ok: major >= 22, major, text: `${process.versions.node}` };
}

function main() {
  console.log('\nตรวจความถูกต้องระบบ P2-SMART\n');
  const results = [];

  console.log('[สภาพแวดล้อม]');
  const v = nodeVersionOk();
  console.log(`  Node.js ${v.text} ${v.ok ? '✔ (ต้อง >= 22)' : '✖ (ต้อง >= 22)'}`);
  results.push(v.ok);

  console.log('\n[โครงสร้างโปรเจกต์]');
  for (const f of [
    'backend/server.js',
    'backend/db.js',
    'backend/db/index.js',
    'backend/db/driver-mysql.js',
    'backend/lib/async-route.js',
    'backend/routes/admin.js',
    'docker-compose.yml',
    '.npmrc',
  ]) {
    const ok = fs.existsSync(path.join(PROJECT, f));
    console.log(`  ${ok ? '✔' : '✖'} ${f}`);
    results.push(ok);
  }

  console.log('\n[ฐานข้อมูล]');
  const envPath = path.join(BACKEND, '.env');
  if (fs.existsSync(envPath)) {
    console.log('  ✔ มี .env');
  } else {
    console.log('  – ไม่มี .env → จะใช้ค่าจาก DATABASE_URL ในสภาพแวดล้อม');
    console.log('      คัดลอก .env.example เป็น .env ได้ถ้ายังไม่ได้ตั้งค่า');
  }
  console.log(`  ${DATABASE_URL ? '✔' : '✖'} DATABASE_URL ถูกตั้งค่า`);
  results.push(Boolean(DATABASE_URL));

  console.log('\n[ตรวจ syntax ทุกไฟล์]');
  results.push(
    run('acorn parse', [path.join(__dirname, 'check-syntax.js')])
  );

  console.log('\n[ตรวจ SQL เทียบ schema จริง]');
  results.push(run('check-sql-schema', [path.join(__dirname, 'check-sql-schema.js')]));

  console.log('\n[ทดสอบ await precedence]');
  results.push(run('test-await-parens', [path.join(__dirname, 'test-await-parens.js')]));

  console.log('\n[ทดสอบ endpoint บน MariaDB]');
  const smokeUrl = process.env.SMOKE_DATABASE_URL || '';
  if (!smokeUrl) {
    console.log('  – ข้าม: ต้องตั้ง SMOKE_DATABASE_URL (ฐานทดสอบที่ลงท้าย _test)');
  } else {
    const port = 3301 + Math.floor(Math.random() * 200);
    results.push(
      run('smoke', [path.join(BACKEND, 'test', 'smoke.js')], {
        env: { PORT: String(port), SMOKE_DATABASE_URL: smokeUrl, DATABASE_URL: smokeUrl },
      })
    );
  }

  const pass = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n${'='.repeat(50)}`);
  console.log(`ผ่าน ${pass}/${total}`);
  console.log('='.repeat(50) + '\n');

  process.exit(pass === total ? 0 : 1);
}

main();
