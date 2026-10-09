'use strict';
/**
 * ตั้งรหัสโรงเรียนตามทะเบียนจริง (backend/pikud/school_codes.csv)
 *
 * ทำไมต้องมี
 * -----------
 * รหัสเดิมคือรหัสกระทรวง 10 หลัก (เช่น 1054390223) ซึ่งขึ้นต้นด้วย 10 = กรมส่งเสริม
 * และ 54 = จังหวัดแพร่ ยาวและอ่านยาก ระบบนี้ต้องการรหัส 8 หลัก
 *
 * รหัสใหม่มาจากไหน
 * ----------------
 * ไม่ได้เรียงเอง แต่อ่านจาก pikud/school_codes.csv ซึ่งเป็นทะเบียนที่ได้รับมา
 * ตัวเลขจึงเว้นตรงที่ทะเบียนไม่มี (เช่น ไม่มี 54020004, 54020009, 54020016)
 * ห้ามสร้างเลขที่ทะเบียนไม่มี — จะทำให้รหัสไม่ตรงกับเอกสารราชการ
 *
 * ทะเบียนมี 3 คอลั่ม
 * ----------------
 *   รหัสโรงเรียน,ชื่อโรงเรียน,กลุ่มโรงเรียน
 *
 *   - รหัส   เขียนทับเสมอถ้าต่างจากทะเบียน
 *   - กลุ่ม   เขียนทับเสมอถ้าต่างจากทะเบียน (ใช้ในหนังสือราชการ
 *              ส่งถึงโรงเรียนเป็นกลุ่ม) ถ้าแอดมินแก้เองจะถูกทับตอน deploy
 *              ให้แก้ CSV แล้วรันซ้ำแทน
 *   - ชื่อ   ไม่เขียนทับ เพราะชื่อในฐานมีรายละเอียดกว่าทะเบียน
 *              (เช่น ทะเบียนเขียน "บ้านน้ำโค้ง" แต่ฐานมี "(นนทราษฎร์รัฐบำรุง)")
 *
 * ถ้าทะเบียนเปลี่ยน ให้แก้ CSV แล้วรันสคริปต์นี้ซ้ำ ห้ามแก้ฐานตรง ๆ
 *
 * จับคู่โรงเรียนด้วยชื่อ ไม่ใช่ด้วยรหัสเดิม
 * ------------------------------------
 * เพราะรหัสเดิมกับรหัสใหม่ไม่มีความสัมพันธ์กันเลย
 * จับคู่ 2 รอบเพื่อให้ครอบคลุมชื่อที่เขียนต่างกันเล็กน้อย:
 *   รอบ 1 ชื่อเต็มตรงกัน (ตัดช่องว่างทิ้ง)
 *         แยกกรณีชื่อซ้ำ เช่น "บ้านเหล่า" มี 2 แห่ง ต่างกันที่วงเล็บท้าย
 *   รอบ 2 ชื่อส่วนต้น (ก่อนวงเล็บ) ตรงกัน
 *         ครอบคลุมกรณีทะเบียนเขียนชื่อสั้นกว่า
 * ถ้ายังจับไม่ได้ ให้หยุดทันที ไม่เดา
 *
 * หน่วยงานที่ไม่ใช่โรงเรียน
 * -----------------------
 * "สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2" ไม่ใช่โรงเรียน
 * แต่ติดมากับ Definition.csv แถวสุดท้าย จึงถอดออกจากตาราง
 * (ระบุด้วย notes IS NULL เพราะเฉพาะแถวนี้ที่ไม่มีประเภทโรงเรียน)
 *
 * การใช้
 * ------
 *   node scripts/migrate_school_codes.js           # ดูแผน (ยังไม่ทำอะไร)
 *   node scripts/migrate_school_codes.js --apply   # ทำจริง
 *
 * ⚠️ สคริปต์นี้เขียนข้อมูลจริง สำรองไว้ที่ pikud/schools_backup_before_code_migration.json
 *    และซ้ำได้อย่างปลอดภัย (ถ้ารหัสตรงทะเบียนแล้วจะข้าม)
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');

/** ทะเบียนรหัสโรงเรียนที่ได้รับมา */
const REGISTRY = path.join(__dirname, '..', 'pikud', 'school_codes.csv');

/** ข้อมูลจริงก่อนเปลี่ยน */
const BACKUP = path.join(__dirname, '..', 'pikud', 'schools_backup_before_code_migration.json');

/** คอลัมน์ที่เก็บรหัสโรงเรียนไว้ — ต้องแก้ตามเมื่อรหัสเปลี่ยน */
const REFS = [
  ['users', 'school_code'],
  ['users', 'current_school'],
  ['documents', 'school_code'],
  ['document_staff', 'school_code'],
  ['document_recipients', 'as_school'],
];

/** ตัดช่องว่างออก เพื่อให้เทียบชื่อได้แม้เขียนต่างกัน */
const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, '');

/** ชื่อส่วนต้นก่อนวงเล็บ เช่น "บ้านน้ำโค้ง(นนทราษฎร์รัฐบำรุง)" -> "บ้านน้ำโค้ง" */
const baseName = (s) => norm(String(s == null ? '' : s).split('(')[0]);

/**
 * อ่านทะเบียนจาก CSV
 * คอลั่ม: รหัสโรงเรียน,ชื่อโรงเรียน,กลุ่มโรงเรียน
 * คอลั่มที่ 3 อาจไม่มีในไฟล์รุ่นเก่า ถ้าไม่มีจะได้ค่าว่าง (ไม่ทับของเดิมในฐาน)
 */
function readRegistry() {
  const raw = fs.readFileSync(REGISTRY, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const out = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(',');
    const code = (parts[0] || '').trim();
    const name = (parts[1] || '').trim();
    const group = (parts[2] || '').trim();
    if (!code) continue;
    out.push({ code, name, group });
  }
  return out;
}

/** จับคู่ทะเบียนกับโรงเรียนในฐานข้อมูล */
function matchRegistry(registry, schools) {
  const used = new Set();
  const pairs = [];
  const rest = [];

  const byFull = new Map();
  for (const s of schools) {
    const k = norm(s.name);
    if (!byFull.has(k)) byFull.set(k, []);
    byFull.get(k).push(s);
  }
  for (const r of registry) {
    const cands = byFull.get(norm(r.name)) || [];
    if (cands.length === 1 && !used.has(cands[0].id)) {
      pairs.push({ reg: r, school: cands[0], how: 'ชื่อเต็ม' });
      used.add(cands[0].id);
    } else {
      rest.push(r);
    }
  }

  const byBase = new Map();
  for (const s of schools) {
    if (used.has(s.id)) continue;
    const k = baseName(s.name);
    if (!byBase.has(k)) byBase.set(k, []);
    byBase.get(k).push(s);
  }
  const failed = [];
  for (const r of rest) {
    const cands = (byBase.get(baseName(r.name)) || []).filter((s) => !used.has(s.id));
    if (cands.length === 1) {
      pairs.push({ reg: r, school: cands[0], how: 'ชื่อส่วนต้น' });
      used.add(cands[0].id);
    } else {
      failed.push({ reg: r, cands });
    }
  }

  const orphans = schools.filter((s) => !used.has(s.id));
  return { pairs, failed, orphans };
}

async function main() {
  const apply = process.argv.includes('--apply');

  await db.init();
  await db.bootstrap();

  const registry = readRegistry();
  console.log(`[ทะเบียน] ${path.basename(REGISTRY)} — ${registry.length} แถว`);
  const regCodes = registry.map((r) => r.code);
  if (new Set(regCodes).size !== regCodes.length) {
    throw new Error('ทะเบียนมีรหัสซ้ำ — ตรวจสอบไฟล์ CSV ก่อน');
  }

  const rows = await db.prepare('SELECT id, code, name, group_name, notes FROM schools ORDER BY id').all();
  const offices = rows.filter((r) => r.notes == null);
  const schools = rows.filter((r) => r.notes != null);
  console.log(`[ตรวจ] schools ทั้งหมด ${rows.length} แถว · โรงเรียน ${schools.length} แห่ง · ไม่ใช่โรงเรียน ${offices.length} แห่ง`);
  for (const o of offices) console.log(`        - ${o.code} ${o.name}`);

  const { pairs, failed, orphans } = matchRegistry(registry, schools);

  if (failed.length) {
    console.error(`\n[หยุด] จับคู่โรงเรียนไม่ครบ ${failed.length} แห่ง — ไม่เดา ขอข้อมูลเพิ่ม:`);
    for (const f of failed) {
      console.error(`  ทะเบียน ${f.reg.code} ${f.reg.name}`);
      console.error(`    ผู้สมัคร: ${f.cands.map((c) => c.code + ' ' + c.name).join(' / ') || 'ไม่มี'}`);
    }
    throw new Error('จับคู่ไม่ครบ');
  }
  if (orphans.length) {
    console.error(`\n[หยุด] ในฐานข้อมูลมีโรงเรียนที่ไม่อยู่ในทะเบียน ${orphans.length} แห่ง — ไม่เดา:`);
    for (const s of orphans) console.error(`  ${s.code} ${s.name}`);
    throw new Error('ทะเบียนไม่ครอบคลุมฐานข้อมูล');
  }

  console.log(`[จับคู่] ครบ ${pairs.length} / ${registry.length} แห่ง`);
  console.log(`         ชื่อเต็มตรง ${pairs.filter((p) => p.how === 'ชื่อเต็ม').length} · ชื่อส่วนต้นตรง ${pairs.filter((p) => p.how === 'ชื่อส่วนต้น').length}`);

  const changed = pairs.filter((p) => p.reg.code !== p.school.code);
  const renames = pairs.filter((p) => p.reg.name.trim() !== p.school.name.trim());

  /*
   * กลุ่มโรงเรียน — เขียนทับเสมอเมื่อทะเบียนมีค่า
   *
   * ทะเบียนคือข้อมูลทางการ ถ้าค่าในไฟล์เปลี่ยน ฐานข้อมูลต้องตามให้เหมือนกัน
   * ต่างจาก "ชื่อโรงเรียน" ที่เราเลือกไม่ทับ เพราะชื่อในฐานมีรายละเอียดกว่า
   * (เช่น บ้านน้ำโค้ง(นนทราษฎร์รัฐบำรุง) ที่ทะเบียนเขียนสั้นกว่า)
   * แต่กลุ่มโรงเรียนไม่มีข้อมูลอื่นให้เลือก มีแต่ค่าที่ถูกต้องค่าเดียว
   *
   * ⚠️ ถ้าแอดมินแก้กลุ่มเองในหน้าเว็บ ค่านั้นจะถูกทับตอน deploy ครั้งถัดไป
   *    ให้แก้ที่ pikud/school_codes.csv แล้วรันสคริปต์นี้ซ้ำจะถูกกว่า
   */
  const groupChanged = pairs.filter((p) => p.reg.group && p.reg.group !== (p.school.group_name || ''));
  const groupKept = pairs.filter((p) => !p.reg.group && (p.school.group_name || '') !== '');

  if (renames.length) {
    console.log(`\n[ชื่อต่างกัน] ${renames.length} แห่ง (สคริปต์นี้ไม่แก้ชื่อ ใช้ชื่อที่มีรายละเอียดในฐานข้อมูลไว้)`);
    for (const p of renames) {
      console.log(`  ทะเบียน "${p.reg.name}"`);
      console.log(`  ฐานข้อมูล "${p.school.name}"  (${p.how})`);
    }
  }

  if (groupKept.length) {
    console.log(`\n[เตือน] มีโรงเรียน ${groupKept.length} แห่งที่มีกลุ่มในฐานข้อมูล แต่ทะเบียนไม่มีคอลั่มกลุ่ม`);
    console.log('         สคริปต์นี้จะไม่แตะค่าเหล่านั้น');
    for (const p of groupKept.slice(0, 8)) console.log(`  ${p.school.code}  ${p.school.group_name}`);
  }

  const registryGroups = [...new Set(registry.map((r) => r.group).filter(Boolean))];
  console.log(`\n[กลุ่มโรงเรียน] ทะเบียนมี ${registryGroups.length} กลุ่ม`);
  for (const g of registryGroups) {
    const n = registry.filter((r) => r.group === g).length;
    console.log(`  ${g} — ${n} แห่ง`);
  }
  console.log(`[กลุ่มโรงเรียน] ต้องอัปเดต ${groupChanged.length} แห่ง`);
  for (const p of groupChanged.slice(0, 6)) {
    console.log(`  ${p.school.code}  "${p.school.group_name || '(ว่าง)'}" -> "${p.reg.group}"  ${p.school.name}`);
  }
  if (groupChanged.length > 6) console.log(`  ... อีก ${groupChanged.length - 6} แห่ง`);

  if (!changed.length && !groupChanged.length && offices.length === 0) {
    console.log('\n[ข้าม] รหัสและกลุ่มตรงทะเบียนครบแล้ว ไม่ต้องทำอะไร');
    return;
  }

  console.log(`\n[แผน] เปลี่ยนรหัส ${changed.length} แห่ง · เปลี่ยนกลุ่ม ${groupChanged.length} แห่ง · ถอดหน่วยงานที่ไม่ใช่โรงเรียน ${offices.length} แห่ง`);
  for (const p of changed.slice(0, 8)) {
    console.log(`  ${p.school.code} -> ${p.reg.code}   ${p.school.name}`);
  }
  if (changed.length > 8) console.log(`  ... อีก ${changed.length - 8} แห่ง`);

  if (!apply) {
    console.log('\nยังไม่ได้ทำอะไร (โหมดแสดงแผน) — ถ้าจะทำจริงใช้คำสั่ง:');
    console.log('  node scripts/migrate_school_codes.js --apply');
    return;
  }

  fs.writeFileSync(BACKUP, JSON.stringify(rows, null, 2), 'utf8');
  console.log(`\n[สำรอง] ${path.basename(BACKUP)} — ${rows.length} แถว`);

  for (const o of offices) {
    await db.prepare('DELETE FROM schools WHERE id = ?').run(o.id);
    console.log(`[ลบ] ${o.code} ${o.name}`);
  }

  // แก้คอลัมน์ที่อ้างรหัสโรงเรียนก่อน เพื่อไม่ให้ค่าเก่าค้างหลัง schools ถูกเขียนทับ
  const oldToNew = new Map();
  for (const p of pairs) {
    if (p.school.code !== p.reg.code) oldToNew.set(p.school.code, p.reg.code);
  }
  if (oldToNew.size) {
    for (const [table, column] of REFS) {
      let touched = 0;
      for (const [from, to] of oldToNew) {
        try {
          const res = await db
            .prepare(`UPDATE \`${table}\` SET \`${column}\` = ? WHERE \`${column}\` = ?`)
            .run(to, from);
          touched += res.changedRows || 0;
        } catch {
          // ตาราง/คอลัมน์นี้ไม่มีในสคีมาปัจจุบัน — ข้ามไป
        }
      }
      if (touched) console.log(`[อ้างอิง] ${table}.${column} แก้ ${touched} แถว`);
    }
  }

  const upd = db.prepare('UPDATE schools SET code = ? WHERE id = ?');
  for (const p of changed) await upd.run(p.reg.code, p.school.id);
  if (changed.length) console.log(`[รหัส] อัปเดต ${changed.length} แห่ง`);

  const updGroup = db.prepare('UPDATE schools SET group_name = ? WHERE id = ?');
  for (const p of groupChanged) await updGroup.run(p.reg.group, p.school.id);
  if (groupChanged.length) console.log(`[กลุ่ม] อัปเดต ${groupChanged.length} แห่ง`);

  const total = (await db.prepare('SELECT COUNT(*) c FROM schools').get()).c;
  const codes = (await db.prepare('SELECT code FROM schools ORDER BY code').all()).map((r) => r.code);
  console.log(`[เสร็จ] schools เหลือ ${total} แห่ง · รหัส ${codes[0]} ถึง ${codes[codes.length - 1]}`);

  const dup = await db.prepare('SELECT code, COUNT(*) c FROM schools GROUP BY code HAVING c > 1').all();
  if (dup.length) throw new Error(`พบรหัสซ้ำ ${dup.length} กลุ่ม — ดูสำรองที่ ${path.basename(BACKUP)}`);

  const badLen = (await db.prepare('SELECT COUNT(*) c FROM schools WHERE LENGTH(code) <> 8').get()).c;
  const missReg = registry.filter((r) => !codes.includes(r.code));
  console.log(`[ตรวจ] รหัสไม่ใช่ 8 หลัก: ${badLen} · รหัสซ้ำ: 0 · ทะเบียนที่ยังไม่มีในฐานข้อมูล: ${missReg.length}`);

  // ตรวจว่ากลุ่มในฐานตรงกับทะเบียนทุกแห่ง
  const after = await db.prepare('SELECT code, group_name FROM schools').all();
  const byCode = new Map(after.map((r) => [r.code, r.group_name || '']));
  const groupOff = registry.filter((r) => byCode.get(r.code) !== r.group);
  console.log(`[ตรวจ] กลุ่มตรงทะเบียน: ${registry.length - groupOff.length} / ${registry.length}`);
  if (groupOff.length) {
    for (const r of groupOff.slice(0, 8)) {
      console.log(`  ${r.code} ทะเบียน "${r.group}" แต่ฐาน "${byCode.get(r.code)}"`);
    }
    throw new Error('กลุ่มโรงเรียนยังไม่ตรงทะเบียน');
  }
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