'use strict';
/**
 * ทดสอบ "ตำแหน่งที่เลือกตอนอนุมัติบันทึกข้อความ (ปฏิบัติราชการ/รักษาราชการแทน)"
 * ผู้ใช้สั่ง 10 พ.ย. 2569
 *
 * หน้าต่างอนุมัติบันทึกข้อความมีส่วน "กรุณาเลือกตำแหน่งที่จะลงนาม"
 * และตำแหน่งที่เลือกต้องถูกบันทึกใน approval_data เพื่อแสดงในฟอร์มดูบันทึกข้อความ
 *
 * สิ่งที่ต้องผ่าน
 *   ① ส่ง position มา (โหมด act) → approval_data ของขั้นที่ 2 เก็บตำแหน่งที่เลือก
 *   ② ไม่ส่ง position → ใช้ตำแหน่งจริงของผู้ใช้
 *
 * ใช้: node scripts/test-memo-approve-position.js
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
}

(async () => {
  console.log('');
  const db = require(path.join(__dirname, '..', 'db.js'));
  await db.init();

  const madeUsers = [];
  const madeMemos = [];

  const mkUser = async (tag) => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, position, workplace, role, status,
       user_group, school_code, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `zzmemopos_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ ตำแหน่งบันทึก ${tag}`, 'เจ้าหน้าที่',
      'สพป.แพร่ เขต 2', 'staff', 'active', 'office', '', '2026-10-01 09:00:00', '2026-10-01 09:00:00'
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  const mkMemo = async (userId) => {
    const ap = [{
      level: 1, by: 1, name: 'ผู้ดูแล ระบบ', title: 'นาย', position: 'เจ้าหน้าที่',
      signature: '', decide: 'เพื่อโปรดพิจารณา', role: 'admin', at: '2026-11-10 09:00:00', note: '',
    }];
    const info = await db.prepare(`INSERT INTO memos
      (doc_no, user_id, title, content, date, status, created_at, approval_level, approval_data)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      'ทดสอบ/ตำแหน่ง/' + Date.now(), userId, 'ทดสอบตำแหน่งบันทึกข้อความ', 'เนื้อหา', '2026-11-10',
      'submitted', '2026-11-10 08:00:00', 1, JSON.stringify(ap)
    );
    const id = Number(info.insertId);
    madeMemos.push(id);
    return id;
  };

  try {
    const requester = await mkUser('req');
    const memoA = await mkMemo(requester);
    const memoB = await mkMemo(requester);
    const adminCookie = 'sid=' + (await auth.newSession(1));
    const me = await db.prepare('SELECT position FROM users WHERE id = 1').get();

    const approve = async (id, body) => {
      const r = await fetch(BASE + '/api/memos/' + id + '/approve', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    };

    console.log('');
    console.log('① โหมดปฏิบัติราชการฯ + เลือกตำแหน่ง → บันทึกตำแหน่งที่เลือก');
    const r1 = await approve(memoA, {
      mode: 'act',
      act_choices: ['ทราบ'],
      position: 'ตำแหน่งทดสอบบันทึกข้อความ',
    });
    check(r1.status === 200, `PUT /memos/:id/approve → 200 (ได้ ${r1.status})`, JSON.stringify(r1.body));
    const row1 = await db.prepare('SELECT approval_data FROM memos WHERE id = ?').get(memoA);
    const ap1 = (() => { try { return JSON.parse(row1.approval_data || '[]'); } catch (e) { return []; } })();
    const l2a = ap1.find((a) => Number(a.level) === 2);
    check(l2a && l2a.position === 'ตำแหน่งทดสอบบันทึกข้อความ', 'ขั้นที่ 2 เก็บตำแหน่งที่เลือก',
      JSON.stringify(l2a && l2a.position));
    check(l2a && l2a.mode === 'act', 'บันทึกโหมด act', JSON.stringify(l2a && l2a.mode));

    console.log('');
    console.log('② ไม่ส่งตำแหน่ง → ใช้ตำแหน่งจริงของผู้ใช้');
    const r2 = await approve(memoB, { mode: 'act', act_choices: ['ทราบ'] });
    check(r2.status === 200, `PUT /memos/:id/approve (ไม่มี position) → 200 (ได้ ${r2.status})`);
    const row2 = await db.prepare('SELECT approval_data FROM memos WHERE id = ?').get(memoB);
    const ap2 = (() => { try { return JSON.parse(row2.approval_data || '[]'); } catch (e) { return []; } })();
    const l2b = ap2.find((a) => Number(a.level) === 2);
    check(l2b && l2b.position === (me && me.position), 'ใช้ตำแหน่งจริงของผู้ใช้',
      JSON.stringify({ got: l2b && l2b.position, want: me && me.position }));
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    try {
      for (const id of madeMemos) {
        try { await db.prepare('DELETE FROM memos WHERE id = ?').run(id); } catch (e) { /* ignore */ }
      }
      for (const id of madeUsers) {
        try { await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); } catch (e) { /* ignore */ }
        try { await db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      console.log('  – เก็บกวาดไม่สำเร็จ: ' + e.message);
    }
    await db.close();
  }

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
