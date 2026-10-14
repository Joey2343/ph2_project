/**
 * หาไฟล์ใน backend/public/uploads ที่ไม่มีอะไรอ้างถึงในฐานข้อมูล (orphan)
 *
 * วิธี: ดึงชื่อไฟล์ทั้งหมด แล้วไล่ทุกคอลัมน์ข้อความในทุกตาราง
 *       ว่ามีค่าไหนที่ "มีชื่อไฟล์นั้นอยู่"
 *
 * ใช้: node scripts/find-orphan-uploads.js            (รายงานอย่างเดียว)
 *      node scripts/find-orphan-uploads.js --delete   (ลบหลังสำรอง)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UPLOAD_DIR = path.join(ROOT, 'public', 'uploads');
const DELETE = process.argv.includes('--delete');
const BACKUP_DIR = path.join(ROOT, 'public', 'uploads', '_backup_orphan');

/** ไฟล์ทั้งหมดใน uploads (ไม่รวมโฟลเดอร์สำรอง) */
function listFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '_backup_orphan') continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(f, out);
    else out.push(f);
  }
  return out;
}

(async () => {
  const db = require(path.join(ROOT, 'db.js'));
  await db.init();
  await db.bootstrap();

  const files = listFiles(UPLOAD_DIR);
  const byName = new Map();
  for (const f of files) byName.set(path.basename(f), f);
  console.log(`ไฟล์ใน uploads ทั้งหมด: ${files.length} ไฟล์`);
  console.log(`ชื่อไฟล์ไม่ซ้ำ: ${byName.size}`);

  /*
   * ⚠️ ต้องเตรียมรายการนามสกุลไฟล์มาก่อน
   *
   *   เคยใช้ WHERE col LIKE '%uploads/%' → ได้ 0 แถวทุกคอลัมน์
   *   เพราะในฐานเก็บแค่ "ชื่อไฟล์" เช่น 3540300144598_photo.jpg
   *   ไม่ได้เก็บพาธเต็มว่า uploads/staff/3540300144598_photo.jpg
   *   ผลคือรูปโปรไฟล์และลายเซ็นของเจ้าหน้าที่ถูกมองว่า "ไม่มีใครอ้างถึง"
   *   แล้วจะถูกลบทิ้ง — อันตรายมาก
   *
   *   ทางแก้: กรองด้วยนามสกุลไฟล์ที่มีจริงใน uploads แทน
   */
  const exts = [...new Set([...byName.keys()].map((n) => {
    const i = n.lastIndexOf('.');
    return i === -1 ? '' : n.slice(i);
  }).filter(Boolean))];
  console.log(`นามสกุลที่พบ: ${exts.join(' ')}\n`);

  /* ── ไล่ทุกคอลัมน์ข้อความในทุกตาราง ─────────────────────────────────── */
  const tables = await db.prepare(
    "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type='BASE TABLE'",
  ).all();
  const referenced = new Map(); // filename -> [table.column]
  let scanned = 0;
  let rowsScanned = 0;

  for (const { t } of tables) {
    const cols = await db.prepare(
      `SELECT column_name AS c, data_type AS d FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ?`,
    ).all(t);
    const textCols = cols.filter((c) => /char|text|blob|binary/i.test(c.d));
    for (const { c } of textCols) {
      let rows;
      try {
        // eslint-disable-next-line no-await-in-loop
        rows = await db.prepare(
          `SELECT \`${c}\` AS v FROM \`${t}\` WHERE ${exts.map((e) => `\`${c}\` LIKE ?`).join(' OR ')}`,
        ).all(...exts.map((e) => `%${e}%`));
      } catch (e) { continue; }
      scanned += 1;
      rowsScanned += rows.length;
      for (const r of rows) {
        const val = String(r.v || '');
        if (!val) continue;
        for (const name of byName.keys()) {
          if (val.includes(name)) {
            if (!referenced.has(name)) referenced.set(name, []);
            const tag = `${t}.${c}`;
            if (!referenced.get(name).includes(tag)) referenced.get(name).push(tag);
          }
        }
      }
    }
  }
  console.log(`สแกน ${tables.length} ตาราง · ${scanned} คอลัมน์ · ${rowsScanned} แถวที่มีนามสกุลไฟล์\n`);

  /* ── สรุป ─────────────────────────────────────────────────────────────── */
  const orphan = [];
  const kept = [];
  for (const [name, file] of byName) {
    (referenced.has(name) ? kept : orphan).push({ name, file, size: fs.statSync(file).size });
  }

  console.log('=== ยังถูกอ้างถึง (ต้องเก็บไว้) ===');
  for (const k of kept) console.log(`  ${k.name}  ← ${referenced.get(k.name).join(', ')}`);
  console.log(`  รวม ${kept.length} ไฟล์\n`);

  const totalBytes = orphan.reduce((s, o) => s + o.size, 0);
  console.log('=== ไม่มีอะไรอ้างถึง (ก้าวค้าง) ===');
  const byFolder = {};
  for (const o of orphan) {
    const rel = path.relative(UPLOAD_DIR, o.file).replace(/\\/g, '/');
    (byFolder[rel.split('/')[0]] = byFolder[rel.split('/')[0]] || []).push(rel);
  }
  for (const [folder, list] of Object.entries(byFolder)) {
    console.log(`  ${folder}/ : ${list.length} ไฟล์`);
    list.forEach((n) => console.log(`      ${n}`));
  }
  console.log(`  รวม ${orphan.length} ไฟล์ · ${(totalBytes / 1024).toFixed(1)} KB\n`);

  if (!DELETE) {
    console.log('ยังไม่ได้ลบ (ใส่ --delete เพื่อลบ ระบบจะสำรองไว้ใน uploads/_backup_orphan ก่อน)');
    await db.close();
    return;
  }

  if (!orphan.length) {
    console.log('ไม่มีไฟล์ก้าวค้าง');
    await db.close();
    return;
  }

  /* ── สำรองก่อนลบ ─────────────────────────────────────────────────────── */
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  for (const o of orphan) {
    const rel = path.relative(UPLOAD_DIR, o.file);
    const dest = path.join(BACKUP_DIR, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(o.file, dest);
  }
  console.log(`สำรองไว้ที่ ${path.relative(ROOT, BACKUP_DIR)}/ (${orphan.length} ไฟล์)`);

  for (const o of orphan) fs.unlinkSync(o.file);
  console.log(`ลบแล้ว ${orphan.length} ไฟล์ · ประหยัด ${(totalBytes / 1024).toFixed(1)} KB`);

  const left = listFiles(UPLOAD_DIR).length;
  console.log(`เหลือใน uploads: ${left} ไฟล์`);

  await db.close();
})().catch((e) => { console.error(e); process.exit(1); });