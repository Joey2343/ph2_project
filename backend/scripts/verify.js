'use strict';
/**
 * ตรวจความถูกต้องทั้งระบบด้วยคำสั่งเดียว
 *
 * รวมเครื่องมือตรวจทั้งหมดที่สร้างไว้ระหว่างการย้ายระบบมา async + รองรับ MySQL
 * เพื่อให้ตรวจซ้ำได้บ่อย ๆ โดยไม่ต้องจำคำสั่งยาว ๆ
 *
 * ใช้: node scripts/verify.js
 *   node scripts/verify.js --with-mysql   ตรวจ MySQL ด้วย (ต้องมี Docker ทำงาน)
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BACKEND = path.join(__dirname, '..');
const PROJECT = path.join(BACKEND, '..');
const WITH_MYSQL = process.argv.includes('--with-mysql');

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
    'backend/db/sql.js',
    'backend/lib/async-route.js',
    'backend/routes/admin.js',
    'docker-compose.yml',
    '.npmrc',
  ]) {
    const ok = fs.existsSync(path.join(PROJECT, f));
    console.log(`  ${ok ? '✔' : '✖'} ${f}`);
    results.push(ok);
  }

  console.log('\n[ไฟล์ .env]');
  const envPath = path.join(BACKEND, '.env');
  if (fs.existsSync(envPath)) {
    console.log('  ✔ มี .env (จะใช้ค่าจากไฟล์นี้)');
  } else {
    console.log('  – ไม่มี .env → จะใช้ SQLite (ค่าเริ่มต้น)');
    console.log('      คัดลอก .env.example เป็น .env ได้ถ้าจะใช้ MySQL');
  }

  console.log('\n[ตรวจ syntax ทุกไฟล์]');
  results.push(
    run('acorn parse', [path.join(__dirname, 'check-syntax.js')])
  );

  console.log('\n[ตรวจ SQL เทียบ schema จริง]');
  results.push(run('check-sql-schema', [path.join(__dirname, 'check-sql-schema.js')]));

  console.log('\n[ทดสอบ await precedence]');
  results.push(run('test-await-parens', [path.join(__dirname, 'test-await-parens.js')]));

  console.log('\n[ทดสอบ endpoint บน SQLite]');
  const port = 3301 + Math.floor(Math.random() * 200);
  results.push(
    run('smoke (SQLite)', [path.join(BACKEND, 'test', 'smoke.js')], {
      env: { PORT: String(port), DATABASE_URL: '', SQLITE_FILE: '' },
    })
  );

  if (WITH_MYSQL) {
    console.log('\n[ทดสอบ endpoint บน MySQL]');
    if (!process.env.DATABASE_URL) {
      console.log('  – ข้าม: ต้องตั้ง DATABASE_URL ก่อน');
    } else {
      results.push(
        run('smoke (MySQL)', [path.join(BACKEND, 'test', 'smoke.js')], {
          env: { PORT: String(port + 1), SQLITE_FILE: '' },
        })
      );
      results.push(
        run('parity (SQLite ↔ MySQL)', [path.join(BACKEND, 'test', 'parity.js')])
      );
    }
  } else {
    console.log('\n[ทดสอบ MySQL]');
    console.log('  – ข้าม (ใช้ --with-mysql และตั้ง DATABASE_URL เพื่อทดสอบ)');
  }

  const pass = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n${'='.repeat(50)}`);
  console.log(`ผ่าน ${pass}/${total}`);
  console.log('='.repeat(50) + '\n');

  process.exit(pass === total ? 0 : 1);
}

void os;
main();
