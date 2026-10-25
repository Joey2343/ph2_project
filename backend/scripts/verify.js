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

const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..');
const PROJECT = path.join(BACKEND, '..');
const DATABASE_URL = process.env.DATABASE_URL || '';

/**
 * ชุดทดสอบต้องยิงเข้าที่ "เซิร์ฟเวอร์ทดสอบ" ที่ไฟล์นี้เปิดขึ้นเองเท่านั้น
 *
 * ทำไม — บนเครื่อง dev ฐานข้อมูลมี telegram_token/chat_id จริงของผู้ใช้
 * ถ้าเทสต์ไปกดอนุมัติที่เซิร์ฟเวอร์ dev (พอร์ต 3000) ระบบจะส่งข้อความ Telegram
 * จริงออกไป แล้วเทสต์ลบรายการทิ้ง → ผู้ใช้ได้ข้อความอนุมัติของ "รายการที่ไม่มีอยู่"
 * (เจอจริง 25 ต.ค. 2569 · มาจาก test-leave-chain / test-travel-chain)
 *
 * → เซิร์ฟเวอร์ทดสอบถูกเปิดด้วย TELEGRAM_DISABLED=1 เสมอ และใช้พอร์ตสุ่ม
 *   เพื่อไม่ให้ไปชน/ไปต่อกับเซิร์ฟเวอร์ dev ที่ผู้พัฒนากำลังเปิดอยู่
 */
const TEST_PORT = Number(process.env.TEST_SERVER_PORT || (3301 + Math.floor(Math.random() * 200)));
const TEST_BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

/** เปิดเซิร์ฟเวอร์ทดสอบ (ปิด Telegram) แล้วรอจน /api/office ตอบ 200 */
async function startTestServer() {
  console.log('\n[เซิร์ฟเวอร์ทดสอบ]');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND,
    env: { ...process.env, PORT: String(TEST_PORT), TELEGRAM_DISABLED: '1', NODE_NO_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const collect = (d) => { out = (out + d.toString()).slice(-8000); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  let dead = false;
  child.on('exit', () => { dead = true; });
  // กันโปรเซสผี: ไม่ว่าจบทางไหน (process.exit / throw / Ctrl+C) ต้องปิดเซิร์ฟเวอร์ทดสอบ
  process.on('exit', () => { try { child.kill(); } catch (e) { /* ignore */ } });

  for (let i = 0; i < 60; i += 1) {
    if (dead) break;
    try {
      const r = await fetch(`${TEST_BASE_URL}/api/office`, { signal: AbortSignal.timeout(2000) });
      if (r.status === 200) {
        console.log(`  ✔ ${TEST_BASE_URL} พร้อม (TELEGRAM_DISABLED=1 → ไม่ส่งข้อความจริง)`);
        return child;
      }
    } catch (e) { /* ยังไม่พร้อม — รอต่อ */ }
    await new Promise((r) => setTimeout(r, 500));
  }

  try { child.kill(); } catch (e) { /* ignore */ }
  console.log('  ✖ เปิดเซิร์ฟเวอร์ทดสอบไม่สำเร็จ (พอร์ต ' + TEST_PORT + ')');
  out.split('\n').filter((l) => l.trim()).slice(-12).forEach((l) => console.log('      ' + l));
  return null;
}

function run(label, args, opts = {}) {
  process.stdout.write(`  ${label} … `);
  const r = spawnSync(process.execPath, args, {
    cwd: opts.cwd || BACKEND,
    encoding: 'utf8',
    // TELEGRAM_DISABLED=1 ให้ทุกโปรเซสลูก — กันเทสต์ที่เรียก lib/telegram.js ตรง ๆ
    env: { ...process.env, NODE_NO_WARNINGS: '1', TELEGRAM_DISABLED: '1', ...opts.env },
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

async function main() {
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

  // เซิร์ฟเวอร์ทดสอบของชุดทดสอบเอง (ปิด Telegram) — ต้องมีก่อนเทสต์ที่ยิง HTTP
  const testServer = await startTestServer();
  results.push(Boolean(testServer));

  console.log('\n[ตรวจ syntax ทุกไฟล์]');
  results.push(
    run('acorn parse', [path.join(__dirname, 'check-syntax.js')])
  );

  console.log('\n[ตรวจ return ที่หลุดออกจากลูป]');
  results.push(run('check-returns', [path.join(__dirname, 'check-returns.js')]));

  console.log('\n[ตรวจ Promise หลุดเข้าไปในคำสั่ง SQL — ทำให้ API ตอบ 500]');
  results.push(run('check-await-in-sql', [path.join(__dirname, 'check-await-in-sql.js')]));

  console.log('\n[ตรวจ SQL เทียบ schema จริง]');
  results.push(run('check-sql-schema', [path.join(__dirname, 'check-sql-schema.js')]));

  console.log('\n[ทดสอบ await precedence]');
  results.push(run('test-await-parens', [path.join(__dirname, 'test-await-parens.js')]));

  console.log('\n[ทดสอบ async route error ไม่ทำให้เซิร์ฟเวอร์ล่ม]');
  results.push(run('test-async-route', [path.join(__dirname, 'test-async-route.js')]));

  console.log('\n[ทดสอบ array ที่หลุด Promise — ทำให้ API คืน [{}]]');
  results.push(run('test-async-map', [path.join(__dirname, 'test-async-map.js')]));

  console.log('\n[ทดสอบ callback ของ approveRequest ถูก await — กันอนุมัติขั้นสุดท้ายพัง]');
  results.push(run('test-async-callback', [path.join(__dirname, 'test-async-callback.js')]));

  console.log('\n[ทดสอบสิทธิ์หน้าวันลาพักผ่อนสะสม — GET/PUT ต้องตรงกัน]');
  results.push(run('test-leave-balance-perm', [path.join(__dirname, 'test-leave-balance-perm.js')]));

  console.log('\n[ทดสอบชื่อไฟล์แนบ — ต้องตรงลำดับไฟล์เสมอ]');
  results.push(run('test-file-names', [path.join(__dirname, 'test-file-names.js')], {
    env: { TEST_BASE_URL },
  }));

  console.log('\n[ทดสอบลบหนังสือแล้วไฟล์แนบต้องหายจากดิสก์ — ไม่ใช่ค้างทุกครั้ง]');
  results.push(run('test-upload-cleanup', [path.join(__dirname, 'test-upload-cleanup.js')], {
    env: { TEST_BASE_URL },
  }));

  console.log('\n[ทดสอบ endpoint เปลี่ยนสถานะต้องคืนค่าจริงของแถว — ให้หน้าเว็บอัปเดตทันที]');
  results.push(run('test-row-patch', [path.join(__dirname, 'test-row-patch.js')], {
    env: { TEST_BASE_URL },
  }));

  console.log('\n[ทดสอบส่งกลับหนังสือจากสถานศึกษาให้ไปแก้ไข + ตัวเลขการ์ดหน้าแรกต้องเป็นตัวเลขจริง]');
  results.push(run('test-doc-return', [path.join(__dirname, 'test-doc-return.js')], {
    env: { TEST_BASE_URL },
  }));

  console.log('\n[ทดสอบ driver ฐานข้อมูล — tx.prepare ต้องมีจริง]');
  results.push(run('test-db-transaction', [path.join(__dirname, 'test-db-transaction.js')]));

  console.log('\n[ทดสอบดาวน์โหลดรายชื่อเจ้าหน้าที่เป็น Excel]');
  results.push(run('test-staff-export', [path.join(__dirname, 'test-staff-export.js')], {
    env: { TEST_BASE_URL },
  }));

  console.log('\n[ทดสอบบทบาทฝั่งสถานศึกษา แยกจากฝั่ง สพป.]');
  results.push(run('test-school-roles', [path.join(__dirname, 'test-school-roles.js')], {
    env: { TEST_BASE_URL },
  }));

  console.log('\n[ทดสอบลำดับรายชื่อเจ้าหน้าที่ทุกจุดที่ให้เลือก]');
  results.push(run('test-staff-list-order', [path.join(__dirname, 'test-staff-list-order.js')]));

  console.log('\n[ทดสอบวงจรชีวิต session — ไม่บล็อก event loop · ไม่รั่ว · หมดอายุเมื่อไม่ใช้งาน 1 ชม.]');
  results.push(run('test-session-lifecycle', [path.join(__dirname, 'test-session-lifecycle.js')]));

  console.log('\n[ทดสอบ Telegram แจ้งผู้ได้รับมอบหมายงานให้ทำหน้าที่แทน]');
  results.push(run('test-telegram-delegate', [path.join(__dirname, 'test-telegram-delegate.js')]));

  console.log('\n[ทดสอบว่าชุดทดสอบส่ง Telegram จริงไม่ได้ — TELEGRAM_DISABLED ต้องปิดการส่ง]');
  results.push(run('test-telegram-guard', [path.join(__dirname, 'test-telegram-guard.js')]));

  console.log('\n[ทดสอบสิทธิ์อนุมัติ — callback ต้องถูก await ทุกตัว]');
  results.push(run('test-approval-perm', [path.join(__dirname, 'test-approval-perm.js')]));

  console.log('\n[ทดสอบยื่นลา + สายอนุมัติการลา ตั้งแต่ต้นจนจบ]');
  results.push(run('test-leave-flow', [path.join(__dirname, 'test-leave-flow.js')], {
    env: { TEST_BASE_URL },
  }));

  // คนละเรื่องกับ test-leave-flow: ตัวนั้นจบที่ "ผู้ตรวจสอบกดตรวจสอบได้"
  // ยังไม่เคยกดอนุมัติต่อ — พอดีกับจุดที่พังจริง
  console.log('\n[ทดสอบสายอนุมัติการลา: จำนวนขั้นต้องมาจากที่ตั้งรายคน]');
  results.push(run('test-leave-chain', [path.join(__dirname, 'test-leave-chain.js')], {
    env: { TEST_BASE_URL },
  }));

  // บั๊กชนิดเดียวกัน: approval_travel เป็นค่ากลาง ทำให้คอลัมน์ "ผู้อนุมัติ" ที่ตั้งไว้ไม่เคยถูกใช้
  console.log('\n[ทดสอบสายอนุมัติไปราชการ: จำนวนขั้นต้องมาจากคอลัมน์ที่ตั้งรายคน]');
  results.push(run('test-travel-chain', [path.join(__dirname, 'test-travel-chain.js')], {
    env: { TEST_BASE_URL },
  }));

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

  // ปิดเซิร์ฟเวอร์ทดสอบก่อนสรุปผล (ไม่ให้ค้างเป็นโปรเซสผี)
  if (testServer) {
    try { testServer.kill(); } catch (e) { /* ignore */ }
  }

  const pass = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n${'='.repeat(50)}`);
  console.log(`ผ่าน ${pass}/${total}`);
  console.log('='.repeat(50) + '\n');

  process.exit(pass === total ? 0 : 1);
}

main().catch((e) => {
  console.error('\nตรวจไม่สำเร็จ:', e && e.message ? e.message : e);
  process.exit(1);
});
