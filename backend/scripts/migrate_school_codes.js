'use strict';
/**
 * เปลี่ยนรหัสโรงเรียน จาก 10 หลัก (รหัสกระทรวง) เป็น 8 หลัก
 *
 * ทำไมต้องเปลี่ยน
 * --------------
 * รหัสเดิมคือรหัสกระทรวง 10 หลัก (เช่น 1054390223) ซึ่งขึ้นต้นด้วย 10 = กรมส่งเสริม
 * และ 54 = จังหวัดแพร่ ทำให้ยาวและอ่านยาก
 * ระบบนี้ต้องการรหัส 8 หลักตามรูปแบบเดียวกับ 54020000 เดิม
 *   54020001, 54020002, ... เรียงจากน้อยไปมากตามลำดับเดิมของข้อมูล
 *
 * แถวไหนได้เรียงใหม่
 * -------------------
 * เรียงตาม id เดิม ซึ่งตรงกับลำดับแถวใน Definition.csv
 * บ้านน้ำริน (แถวแรกของ CSV) จึงได้ 54020001
 *
 * ข้อมูลที่ถูกลบออก
 * ----------------
 * "สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2" ไม่ใช่โรงเรียน
 * แต่ติดมากับ Definition.csv แถวสุดท้าย (รหัส 54020000)
 * จึงถอดออกจากตาราง ไม่ให้แสดงเป็นโรงเรียนหนึ่งแห่งบนแผนที่
 * (ระบุด้วย notes IS NULL เพราะเฉพาะแถวนี้ที่ไม่มีประเภทโรงเรียน)
 *
 * การใช้
 * ------
 *   node scripts/migrate_school_codes.js            # ดูแผน (ยังไม่ทำอะไร)
 *   node scripts/migrate_school_codes.js --apply    # ทำจริง
 *
 * ⚠️ สคริปต์นี้เขียนข้อมูลจริง ควรสำรองฐานก่อนเสมอ
 *    แต่การเปลี่ยนครั้งนี้เป็น UPDATE เฉพาะคอลัมน์ code (ไม่ลบตาราง)
 *    และเก็บสำรองไว้ที่ pikud/schools_backup_before_code_migration.json
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');

/** หน้าต่างรหัสที่ใช้ */
const CODE_PREFIX = '5402';

/** ข้อมูลจริงก่อนเปลี่ยน */
const BACKUP = path.join(__dirname, '..', 'pikud', 'schools_backup_before_code_migration.json');

/** จัดรูปแบบ 54020001 */
function formatCode(n) {
  return CODE_PREFIX + String(n).padStart(4, '0');
}

async function main() {
  const apply = process.argv.includes('--apply');

  await db.init();
  await db.bootstrap();

  // เรียงตาม id เดิม = ลำดับแถวใน CSV
  const rows = (await db.prepare('SELECT id, code, name, notes FROM schools ORDER BY id').all());

  // แยกหน่วยงานที่ไม่ใช่โรงเรียนออก (notes IS NULL = ไม่มีประเภทโรงเรียน)
  const offices = rows.filter((r) => r.notes == null);
  const schools = rows.filter((r) => r.notes != null);

  console.log(`[ตรวจ] schools ทั้งหมด ${rows.length} แถว`);
  console.log(`[ตรวจ] โรงเรียน ${schools.length} แห่ง · หน่วยงานที่ไม่ใช่โรงเรียน ${offices.length} แห่ง`);
  if (offices.length) {
    for (const o of offices) console.log(`        - ถอดออก: ${o.code} ${o.name}`);
  }

  const nextCodes = schools.map((_, i) => formatCode(i + 1));

  // ตรวจก่อนว่าเปลี่ยนไปแล้วหรือยัง
  // ถ้าตรงกับลำดับที่จะตั้งอยู่ครบทุกแถว แปลว่างานเสร็จไปแล้ว
  // (ต้องเช็กก่อนการตรวจชน เพราะรหัสใหม่จะชนกับตัวเองทั้งหมด)
  const alreadyDone = schools.length > 0 && schools.every((s, i) => s.code === nextCodes[i]);
  if (alreadyDone) {
    console.log(`[ตรวจ] รหัสเรียง 8 หลักครบแล้ว (${nextCodes[0]} - ${nextCodes[nextCodes.length - 1]})`);
    if (offices.length === 0) {
      console.log('[ข้าม] ไม่ต้องทำอะไร');
      return;
    }
    // เหลือแค่ถอดหน่วยงานที่ไม่ใช่โรงเรียนออก ไม่ต้องแตะรหัส
    if (!apply) {
      console.log('');
      console.log('เหลือเพียงถอดหน่วยงานที่ไม่ใช่โรงเรียนออก ถ้าจะทำจริงใช้คำสั่ง:');
      console.log('  node scripts/migrate_school_codes.js --apply');
      return;
    }
    fs.writeFileSync(BACKUP, JSON.stringify(rows, null, 2), 'utf8');
    console.log(`[สำรอง] บันทึกข้อมูลเดิม ${rows.length} แถว ไปที่ ${path.basename(BACKUP)}`);
    for (const o of offices) {
      await db.prepare('DELETE FROM schools WHERE id = ?').run(o.id);
      console.log(`[ลบ] ${o.code} ${o.name}`);
    }
    const left = (await db.prepare('SELECT COUNT(*) c FROM schools').get()).c;
    console.log(`[เสร็จ] ถอดหน่วยงานออกแล้ว · โรงเรียนเหลือ ${left} แห่ง (รหัสไม่เปลี่ยน)`);
    return;
  }

  // ตรวจว่ารหัสใหม่ชนกับของเดิมหรือไม่
  const clash = nextCodes.filter((c) => rows.some((r) => r.code === c));
  if (clash.length) {
    throw new Error(`รหัสใหม่ชนกับข้อมูลเดิม: ${clash.slice(0, 5).join(', ')}`);
  }
  if (new Set(nextCodes).size !== nextCodes.length) {
    throw new Error('รหัสใหม่ไม่ unique');
  }

  console.log(`[แผน] รหัสใหม่จะเริ่มที่ ${nextCodes[0]} ถึง ${nextCodes[nextCodes.length - 1]}`);
  console.log('[แผน] ตัวอย่าง 5 แถวแรก');
  schools.slice(0, 5).forEach((s, i) => {
    console.log(`        ${s.code}  ->  ${nextCodes[i]}   ${s.name}`);
  });

  if (!apply) {
    console.log('');
    console.log('ยังไม่ได้ทำอะไร (โหมดแสดงแผน) — ถ้าจะทำจริงใช้คำสั่ง:');
    console.log('  node scripts/migrate_school_codes.js --apply');
    return;
  }

  // สำรองข้อมูลก่อน
  fs.writeFileSync(BACKUP, JSON.stringify(rows, null, 2), 'utf8');
  console.log(`\n[สำรอง] บันทึกข้อมูลเดิม ${rows.length} แถว ไปที่ ${path.basename(BACKUP)}`);

  // ถอดหน่วยงานที่ไม่ใช่โรงเรียนออกก่อน เพื่อไม่ให้รหัสชน
  for (const o of offices) {
    await db.prepare('DELETE FROM schools WHERE id = ?').run(o.id);
    console.log(`[ลบ] ${o.code} ${o.name}`);
  }

  // เปลี่ยนรหัสทีละแถว
  const upd = db.prepare('UPDATE schools SET code = ? WHERE id = ?');
  for (let i = 0; i < schools.length; i++) {
    await upd.run(nextCodes[i], schools[i].id);
  }

  const total = (await db.prepare('SELECT COUNT(*) c FROM schools').get()).c;
  const first = (await db.prepare('SELECT code FROM schools ORDER BY id LIMIT 1').get()).code;
  const last = (await db.prepare('SELECT code FROM schools ORDER BY id DESC LIMIT 1').get()).code;
  console.log(`[เสร็จ] schools เหลือ ${total} แห่ง · รหัส ${first} ถึง ${last}`);

  // ยืนยันว่าไม่มีรหัสซ้ำและความยาวถูกต้อง
  const dup = await db.prepare(
    'SELECT code, COUNT(*) c FROM schools GROUP BY code HAVING c > 1',
  ).all();
  if (dup.length) throw new Error(`พบรหัสซ้ำ ${dup.length} กลุ่ม — ตรวจสอบสำรองที่ ${path.basename(BACKUP)}`);

  const badLen = await db.prepare('SELECT COUNT(*) c FROM schools WHERE LENGTH(code) <> 8').get();
  console.log(`[ตรวจ] รหัสที่ไม่ใช่ 8 หลัก: ${badLen.c} รายการ`);
  console.log('[ตรวจ] ไม่มีรหัสซ้ำ');
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