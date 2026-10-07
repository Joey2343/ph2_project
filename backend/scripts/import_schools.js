'use strict';
const fs = require('fs');
const path = require('path');
const db = require('../db');

/**
 * คำสั่งบำรุงรักษาฐานข้อมูล — port มาใช้ DB adapter แบบ async แล้ว
 *
 * ใช้: node scripts/import_schools.js
 *
 * ⚠ สคริปต์นี้เขียน/ลบข้อมูลจริง ควรรันกับสำเนาฐานข้อมูลก่อนเสมอ
 */

async function main() {
  await db.init();
  await db.bootstrap();

  /**
   * นำข้อมูลโรงเรียนจาก pikud/Definition.csv มาเป็นฐานข้อมูลในหน้า "พิกัดโรงเรียนในสังกัด"
   * - สำรองข้อมูลเดิมในตาราง schools ไปที่ pikud/schools_backup_before_import.json
   * - ล้างตารางเดิม แล้ว import ใหม่จาก CSV (รหัสกระทรวง 10 หลักเป็นคีย์)
   */

  const CSV = path.join(__dirname, '..', 'pikud', 'Definition.csv');
  const BACKUP = path.join(__dirname, '..', 'pikud', 'schools_backup_before_import.json');

  // 1) สำรองข้อมูลเดิม
  const existing = await db.prepare('SELECT * FROM schools ORDER BY id').all();
  fs.writeFileSync(BACKUP, JSON.stringify(existing, null, 2), 'utf8');
  console.log(`[backup] บันทึกข้อมูลเดิม ${existing.length} แห่ง ไปที่ ${path.basename(BACKUP)}`);

  // 2) อ่าน CSV
  const lines = fs.readFileSync(CSV, 'utf8').trim().split(/\r?\n/);
  const hdr = lines[0].split(',');
  const I = (name) => hdr.indexOf(name);
  const col = {
    code: I('รหัสกระทรวง (10 หลัก)'),
    name: I('ชื่อโรงเรียน'),
    principal: I('ชื่อผู้อำนวยการ'),
    address: I('ที่อยู่'),
    village: I('หมู่'),
    road: I('ถนน'),
    tambon: I('ตำบล'),
    district: I('อำเภอ'),
    province: I('จังหวัด'),
    zip: I('รหัสไปรษณีย์'),
    phone: I('หมายเลขโทรศัพท์ 1'),
    lat: I('ละติจูด'),
    lng: I('ลองจิจูด'),
    levelMin: I('ชั้นเรียนต่ำสุดที่เปิดสอน'),
    levelMax: I('ชั้นเรียนสูงสุดที่เปิดสอน'),
    image: I('รูป'),
    type: I('ประเภทโรงเรียน'),
    group: I('กลุ่มโรงเรียน'),
    disaster: I('ภัยธรรมชาติ'),
  };
  for (const [k, v] of Object.entries(col)) {
    if (v < 0) throw new Error(`ไม่พบคอลัมน์: ${k}`);
  }

  function num(s) {
    const n = parseFloat(String(s).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  // 3) ล้างตารางเดิม
  await db.prepare('DELETE FROM schools').run();
  const ins = db.prepare(`INSERT INTO schools (code, name, district, address, principal, phone, level, lat, lng, image, notes, disaster)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);

  let ok = 0, noLat = 0;
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const c = line.split(',');
    if (c.length !== hdr.length) { console.warn(`[skip] แถวคอลัมน์ไม่ครบ: ${c[col.name]}`); continue; }
    const address = [c[col.address], c[col.village] ? `หมู่ ${c[col.village]}` : '', c[col.road] ? `ถนน${c[col.road]}` : '', c[col.tambon] ? `ต.${c[col.tambon]}` : '', c[col.district] ? `อ.${c[col.district]}` : '', c[col.province] ? `จ.${c[col.province]}` : '', c[col.zip] ? c[col.zip] : ''].filter(Boolean).join(' ');
    const level = c[col.levelMin] && c[col.levelMax] ? `${c[col.levelMin]} - ${c[col.levelMax]}` : (c[col.levelMin] || c[col.levelMax] || '');
    const notes = [c[col.type] ? `ประเภท: ${c[col.type]}` : '', c[col.group] ? `กลุ่ม: ${c[col.group]}` : ''].filter(Boolean).join(' | ');
    await ins.run(
      (c[col.code] || '').trim(),
      (c[col.name] || '').trim(),
      (c[col.district] || '').trim(),
      address,
      (c[col.principal] || '').trim(),
      (c[col.phone] || '').trim(),
      level,
      num(c[col.lat]), num(c[col.lng]),
      (c[col.image] || '').trim() || null,
      notes || null,
      (c[col.disaster] || '').trim() || null,
    );
    if (num(c[col.lat]) == null || num(c[col.lng]) == null) noLat++;
    ok++;
  }

  const total = await db.prepare('SELECT COUNT(*) c FROM schools').get().c;
  console.log(`[import] นำเข้า ${ok} แห่ง (ไม่มีพิกัด ${noLat} แห่ง) — ตาราง schools ตอนนี้มี ${total} แห่ง`);
  const districts = await db.prepare('SELECT district, COUNT(*) c FROM schools GROUP BY district ORDER BY c DESC').all();
  console.log('[districts]', districts.map((d) => `${d.district}=${d.c}`).join(', '));
}

main()
  .then(async () => {
    await db.close();
  })
  .catch(async (err) => {
    console.error(err);
    try {
      await db.close();
    } catch {
      /* ปิดการเชื่อมต่อไม่สำเร็จ — ไม่เป็นไร */
    }
    process.exit(1);
  });
