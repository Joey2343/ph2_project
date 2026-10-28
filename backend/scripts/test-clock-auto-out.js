'use strict';
/**
 * ทดสอบ "ลงเวลาออกงานอัตโนมัติ 17:00 น."
 *
 * ความต้องการ (ผู้ใช้):
 *   เมื่อถึงเวลา 17.00 น. คนที่ลงเวลาเข้างานแล้วแต่ยังไม่ได้ลงเวลาออกงาน
 *   ให้ระบบลงเวลาออกงานให้อัตโนมัติ
 *
 * สิ่งที่ต้องผ่าน
 *   ① แถวที่มีเวลาเข้าแต่ยังไม่มีเวลาออก → ถูกปิดด้วย 17:00:00
 *      และ clock_out_src บอกว่าเป็นเวลาอัตโนมัติ
 *   ② แถวที่ลงเวลาออกไปแล้ว (ด้วยตัวเอง) → ต้องไม่ถูกเขียนทับ
 *   ③ วันที่อื่น → ต้องไม่ถูกแตะ
 *
 * ใช้: node scripts/test-clock-auto-out.js
 * ⚠️ สร้างผู้ใช้/บันทึกเวลาชั่วคราวแล้วลบออกทุกครั้ง (จำกัดด้วย userId)
 */
const path = require('path');
const db = require(path.join(__dirname, '..', 'db.js'));
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));
const simdate = require(path.join(__dirname, '..', 'lib', 'simdate.js'));
const { autoClockOut } = require(path.join(__dirname, '..', 'lib', 'clock-autoout.js'));

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
}

(async () => {
  console.log('');
  await db.init();

  const hash = await auth.hashPassword('Test1234**');
  const mkUser = async (tag) => {
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, position, workplace, role, status,
       user_group, school_code, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `zzautoout_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ ออกอัตโนมัติ ${tag}`,
      'เจ้าหน้าที่', 'สพป.แพร่ เขต 2', 'staff', 'active', 'office', '',
      '2026-10-28 09:00:00', '2026-10-28 09:00:00'
    );
    return Number(info.insertId);
  };

  const ids = [];
  const today = simdate.todayISO();
  const yesterday = (() => {
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  try {
    const u1 = await mkUser('open');   // เข้างานแล้ว ยังไม่ออก → ต้องถูกปิด
    const u2 = await mkUser('closed'); // เข้างาน+ออกงานแล้ว → ต้องไม่เปลี่ยน
    ids.push(u1, u2);

    await db.prepare('INSERT INTO time_records (user_id, date, clock_in, clock_in_src) VALUES (?,?,?,?)')
      .run(u1, today, '08:30:00', 'GPS (18.1, 100.1) · ทดสอบ');
    await db.prepare('INSERT INTO time_records (user_id, date, clock_in, clock_out, clock_out_src) VALUES (?,?,?,?,?)')
      .run(u2, today, '08:00:00', '16:10:00', 'ไม่ตรวจตำแหน่ง (ลงเวลาออกงาน)');
    // แถวของเมื่อวานที่ยังไม่ออก — ต้องไม่ถูกแตะ (ฟังก์ชันจำกัดวันที่)
    await db.prepare('INSERT INTO time_records (user_id, date, clock_in) VALUES (?,?,?)')
      .run(u1, yesterday, '08:30:00');

    console.log('');
    console.log('① ปิดเวลาออกงานให้คนที่ยังไม่ออก');
    // จำกัดเฉพาะผู้ใช้ทดสอบ (ไม่ให้ไปปิดของคนอื่นในฐาน)
    await autoClockOut({ userId: u1 });
    const r1 = await db.prepare('SELECT clock_out, clock_out_src FROM time_records WHERE user_id = ? AND date = ?').get(u1, today);
    check(!!r1 && r1.clock_out === '17:00:00', 'clock_out = 17:00:00', `ได้ ${r1 && r1.clock_out}`);
    check(!!r1 && String(r1.clock_out_src || '').includes('อัตโนมัติ'), 'clock_out_src บอกว่าเป็นเวลาอัตโนมัติ',
      `ได้ "${r1 && r1.clock_out_src}"`);

    console.log('');
    console.log('② ไม่เขียนทับคนที่ลงเวลาออกไปแล้ว');
    const r2 = await db.prepare('SELECT clock_out, clock_out_src FROM time_records WHERE user_id = ? AND date = ?').get(u2, today);
    check(r2 && r2.clock_out === '16:10:00', 'เวลาออกเดิม 16:10:00 ยังอยู่', `ได้ ${r2 && r2.clock_out}`);
    check(!String(r2 && r2.clock_out_src).includes('อัตโนมัติ'), 'ที่มาเดิมไม่ถูกเปลี่ยน');

    console.log('');
    console.log('③ ไม่แตะข้อมูลของวันอื่น');
    const r3 = await db.prepare('SELECT clock_out FROM time_records WHERE user_id = ? AND date = ?').get(u1, yesterday);
    check(!!r3 && !r3.clock_out, 'แถวของเมื่อวานยังไม่มีเวลาออก', `ได้ ${r3 && r3.clock_out}`);
  } finally {
    for (const id of ids) {
      try { await db.prepare('DELETE FROM time_records WHERE user_id = ?').run(id); } catch (e) { /* ignore */ }
      try { await db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch (e) { /* ignore */ }
    }
    await db.close();
  }

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ทดสอบล้มเหลว:', e);
  process.exit(1);
});
