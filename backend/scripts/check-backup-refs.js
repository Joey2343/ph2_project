'use strict';
/**
 * ตรวจว่าไฟล์ใน uploads/_backup_orphan มีฐานข้อมูลอ้างถึงอยู่ไหม (read-only)
 *
 * ทำไมต้องตรวจก่อนลบ
 * ────────────────
 * ไฟล์ใน _backup_orphan ถูก "ย้ายออกจากที่ใช้งาน" ไปแล้วในขั้นตอนล้าง orphan
 * ถ้ามีไฟล์ไหนที่ฐานข้อมูลยังอ้างถึง แปลว่ารูปนั้นเสียอยู่แล้วบนเซิร์ฟเวอร์
 * ทางเลือกที่ถูกคือ "กู้กลับไปที่เดิม" ไม่ใช่ลบสำรองทิ้ง
 *
 * ใช้: node scripts/check-backup-refs.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, 'public', 'uploads', '_backup_orphan');

function listFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(f, out);
    else out.push(f);
  }
  return out;
}

(async () => {
  const db = require(path.join(ROOT, 'db.js'));
  await db.init();

  const files = listFiles(BACKUP_DIR);
  const names = new Set(files.map((f) => path.basename(f)));
  console.log(`ไฟล์สำรอง: ${files.length} ไฟล์ · ชื่อไม่ซ้ำ ${names.size}\n`);
  if (!names.size) { await db.close(); return; }

  const exts = [...new Set([...names].map((n) => {
    const i = n.lastIndexOf('.');
    return i === -1 ? '' : n.slice(i);
  }).filter(Boolean))];
  console.log(`นามสกุลที่พบ: ${exts.join(' ')}\n`);

  const tables = await db.prepare(
    "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type='BASE TABLE'",
  ).all();

  const hits = [];
  let scanned = 0;
  for (const { t } of tables) {
    const cols = await db.prepare(
      `SELECT column_name AS c, data_type AS d FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ?`,
    ).all(t);
    for (const { c } of cols.filter((x) => /char|text|blob|binary/i.test(x.d))) {
      let rows;
      try {
        rows = await db.prepare(
          `SELECT \`${c}\` AS v FROM \`${t}\` WHERE ${exts.map((e) => `\`${c}\` LIKE ?`).join(' OR ')}`,
        ).all(...exts.map((e) => `%${e}%`));
      } catch (e) { continue; }
      scanned += 1;
      for (const r of rows) {
        const val = String(r.v || '');
        if (!val) continue;
        for (const name of names) {
          if (val.includes(name)) hits.push({ name, where: `${t}.${c}`, value: val.slice(0, 120) });
        }
      }
    }
  }
  console.log(`สแกน ${tables.length} ตาราง · ${scanned} คอลัมน์\n`);

  if (!hits.length) {
    console.log('✅ ไม่มีฐานข้อมูลอ้างถึงไฟล์ใน _backup_orphan เลย — ลบทิ้งได้เลย');
  } else {
    console.log(`⚠️ มี ${hits.length} จุดที่ยังอ้างถึงไฟล์ใน _backup_orphan — ยังลบไม่ได้:`);
    for (const h of hits) console.log(`  ${h.name}  ← ${h.where}  = ${h.value}`);
  }

  await db.close();
  process.exit(hits.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });