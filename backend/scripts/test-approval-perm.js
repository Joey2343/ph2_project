/**
 * ตรวจว่าการอนุมัติทุกระบบ "ตรวจสิทธิ์จริง" ไม่ใช่ปล่อยผ่านทุกคน
 *
 * ทำไมต้องมี
 * ──────────
 * lib/approvals.js approveRequest() / rejectRequest() รับ callback มาตรวจสิทธิ์
 * แต่เดิมไม่ await กลางทาง ทำให้:
 *
 *   canApproveFn → Promise ซึ่ง truthy เสมอ
 *                 → if (!check(...)) ไม่เคยทำงาน
 *                 → ใครก็กดอนุมัติได้ ไม่ต้องเป็นผู้ที่ได้รับแต่งตั้ง
 *
 *   allowFn      → getUserSystemLevels(...).length
 *                 Promise.length = undefined → undefined > 0 = false
 *                 → if (!ok) เสมอ → ปฏิเสธไม่ได้เลย แม้แต่ admin
 *
 *   requiredFn   → เทียบเลขกับ Promise = NaN
 *                 → คำขอที่อนุมัติครบทุกขั้นแล้วยังค้างสถานะ pending
 *
 *   levelLabelFn → ข้อความ error เป็น "[object Promise]"
 *
 * ที่ผ่านจริงแล้ว: ยานพาหนะ · ห้องประชุม · ไปราชการ · การลา · บันทึกข้อความ
 *
 * ใช้: node scripts/test-approval-perm.js
 */
const path = require('path');

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
}

const approvals = require(path.join(__dirname, '..', 'lib', 'approvals.js'));
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

/**
 * สร้างตารางจำลอง + stub db เพื่อทดสอบ approveRequest/rejectRequest โดยไม่ต้องมี API
 *
 * @param {object} opts { required, status, approvalData }
 */
function harness(opts = {}) {
  const calls = [];
  const row = {
    id: opts.id || 1,
    status: opts.status || 'pending',
    approval_data: opts.approvalData || '[]',
    approval_level: 0,
  };
  const fakeDb = {
    prepare(sql) {
      return {
        async get() { calls.push(['get', sql]); return sql.startsWith('UPDATE') ? {} : row; },
        async all() { calls.push(['all', sql]); return []; },
        async run(...a) { calls.push(['run', sql, a]); return { changes: 1 }; },
      };
    },
  };
  // แทนที่ db ในโมดูล approvals (ต้องทำก่อนเรียก)
  const realPrepare = require(path.join(__dirname, '..', 'db.js'));
  return { calls, row, fakeDb, realPrepare };
}

(async () => {
  const db = require(path.join(__dirname, '..', 'db.js'));
  await db.init();
  await db.bootstrap();

  /* เตรียมข้อมูล: ตารางจองรถ 1 รายการ ของ user ที่ 1 */
  const admin = await db.prepare("SELECT id FROM users WHERE username='admin'").get();
  const other = await db.prepare(
    "SELECT id, username FROM users WHERE status='active' AND user_group<>'school' AND id != ? ORDER BY id LIMIT 1",
  ).get(admin.id);

  const veh = await db.prepare('SELECT id FROM vehicles ORDER BY id LIMIT 1').get();
  if (!veh) { console.log('  – ข้าม: ไม่มียานพาหนะในฐาน'); process.exit(0); }

  const booking = await db.prepare(`INSERT INTO vehicle_bookings
    (user_id, vehicle_id, date, start_time, end_time, purpose, status, approval_data)
    VALUES (?,?,'2026-12-01','09:00','10:00','ทดสอบสิทธิ์อนุมัติ','pending','[]')`).run(admin.id, veh.id);
  const bId = booking.lastInsertRowid;

  /* ── ① canApproveFn คืน false → ต้อง 403 ─────────────────────────────── */
  console.log('');
  console.log('① ผู้ไม่มีสิทธิ์ต้องถูกปฏิเสธ (canApproveFn → false)');

  const r1 = await approvals.approveRequest({
    table: 'vehicle_bookings', system: 'vehicle', id: bId, user: { id: 999999, full_name: 'ไม่มีตัวตน' },
    canApproveFn: async () => false,
    levelLabelFn: async (l) => (l <= 1 ? 'ขั้นต้น' : 'ขั้นสุดท้าย'),
  });
  check(r1.error && r1.code === 403, 'ได้ 403', 'ได้ ' + JSON.stringify(r1).slice(0, 130));
  check(!/Promise/.test(String(r1.error || '')),
    'ข้อความ error ไม่มี "[object Promise]"',
    'ได้ ' + r1.error);
  check(String(r1.error || '').indexOf('ขั้น') !== -1,
    'ข้อความ error มีชื่อขั้นจริง (levelLabelFn ถูก await)',
    'ได้ ' + r1.error);

  const stillPending = await db.prepare('SELECT status, approval_data FROM vehicle_bookings WHERE id = ?').get(bId);
  check(stillPending.status === 'pending', 'ไม่ได้บันทึกอะไรลงฐาน (สิทธิ์ไม่ผ่าน)');

  /* ── ② canApproveFn คืน true → อนุมัติได้ ────────────────────────────── */
  console.log('');
  console.log('② ผู้มีสิทธิ์ต้องอนุมัติได้ (canApproveFn → true)');

  const r2 = await approvals.approveRequest({
    table: 'vehicle_bookings', system: 'vehicle', id: bId, user: { id: admin.id, full_name: 'admin', role: 'admin' },
    canApproveFn: async () => true,
    levelLabelFn: async (l) => (l <= 1 ? 'ขั้นต้น' : 'ขั้นสุดท้าย'),
  });
  check(r2.ok === true, 'คืน ok', JSON.stringify(r2).slice(0, 130));
  const afterApprove = await db.prepare('SELECT status, approval_level, approval_data FROM vehicle_bookings WHERE id = ?').get(bId);
  check(afterApprove.status !== 'pending' || Number(afterApprove.approval_level) >= 1,
    'บันทึกขั้นที่อนุมัติจริง',
    `status=${afterApprove.status} level=${afterApprove.approval_level}`);

  /* ── ③ requiredFn คืนเลข → นับขั้นถูกต้อง ────────────────────────────── */
  console.log('');
  console.log('③ requiredFn ต้องเป็นตัวเลขจริง (ไม่ใช่ Promise)');

  const fresh = await db.prepare(`INSERT INTO vehicle_bookings
    (user_id, vehicle_id, date, start_time, end_time, purpose, status, approval_data)
    VALUES (?,?,'2026-12-02','09:00','10:00','ทดสอบขั้น','pending','[]')`).run(admin.id, veh.id);
  const fId = fresh.lastInsertRowid;

  // ตั้ง required = 1 แล้วอนุมัติ 1 ครั้ง → ต้อง approved ทันที (ไม่ค้าง pending)
  const savedVeh = await db.prepare("SELECT value FROM settings WHERE `key`='approval_vehicle'").get();
  await db.prepare("INSERT INTO settings (`key`,value) VALUES ('approval_vehicle','1') ON DUPLICATE KEY UPDATE value='1'").run();

  const r3 = await approvals.approveRequest({
    table: 'vehicle_bookings', system: 'vehicle', id: fId, user: { id: admin.id, full_name: 'admin', role: 'admin' },
    canApproveFn: async () => true,
  });
  check(r3.approved === true, 'อนุมัติครบขั้นเดียว → approved = true', JSON.stringify(r3).slice(0, 130));
  const fRow = await db.prepare('SELECT status FROM vehicle_bookings WHERE id = ?').get(fId);
  check(fRow.status === 'approved',
    'สถานะในฐานเป็น approved ไม่ค้าง pending',
    'ได้ ' + fRow.status + ' (ขั้นเดียวที่ตั้งไว้ ถ้า required เป็น Promise จะได้ pending)');

  if (savedVeh) await db.prepare("UPDATE settings SET value=? WHERE `key`='approval_vehicle'").run(savedVeh.value);
  else await db.prepare("DELETE FROM settings WHERE `key`='approval_vehicle'").run();

  // แบบ async ที่ฝั่งไปราชการส่งมาจริง: requiredFn: (r) => approvals.travelRequiredLevels(r.user_id)
  // ถ้าไม่ await → required เป็น Promise → nextLevel >= required = false
  // → คำขอที่อนุมัติครบแล้วยังค้างสถานะ pending
  const nf = await db.prepare(`INSERT INTO vehicle_bookings
    (user_id, vehicle_id, date, start_time, end_time, purpose, status, approval_data)
    VALUES (?,?,'2026-12-04','09:00','10:00','ทดสอบ requiredFn','pending','[]')`).run(admin.id, veh.id);
  const nId = nf.lastInsertRowid;
  const rn = await approvals.approveRequest({
    table: 'vehicle_bookings', system: 'vehicle', id: nId, user: { id: admin.id, full_name: 'admin', role: 'admin' },
    requiredFn: async () => 1,
    canApproveFn: async () => true,
  });
  check(rn.approved === true, 'requiredFn แบบ async → อนุมัติครบขั้นเดียวเป็น approved', JSON.stringify(rn).slice(0, 120));
  const nRow = await db.prepare('SELECT status FROM vehicle_bookings WHERE id = ?').get(nId);
  check(nRow.status === 'approved',
    'สถานะ approved (ถ้า requiredFn ไม่ถูก await จะค้าง pending)',
    'ได้ ' + nRow.status);
  await db.prepare('DELETE FROM vehicle_bookings WHERE id = ?').run(nId);

  /* ── ④ อนุมัติครบแล้ว ต้องไม่ให้อนุมัติซ้ำ ──────────────────────────────── */
  console.log('');
  console.log('④ อนุมัติครบทุกขั้นแล้ว ต้องปฏิเสธการอนุมัติซ้ำ');

  const r4 = await approvals.approveRequest({
    table: 'vehicle_bookings', system: 'vehicle', id: fId, user: { id: admin.id, full_name: 'admin', role: 'admin' },
    canApproveFn: async () => true,
  });
  check(!!r4.error, 'ได้ error (ไม่ใช่อนุมัติซ้ำ)', JSON.stringify(r4).slice(0, 130));

  /* ── ⑤ rejectRequest: allowFn ต้องถูก await ──────────────────────────── */
  console.log('');
  console.log('⑤ rejectRequest — allowFn ที่เป็น async ต้องทำงานถูก');

  const rej = await db.prepare(`INSERT INTO vehicle_bookings
    (user_id, vehicle_id, date, start_time, end_time, purpose, status, approval_data)
    VALUES (?,?,'2026-12-03','09:00','10:00','ทดสอบปฏิเสธ','pending','[]')`).run(admin.id, veh.id);
  const rId = rej.lastInsertRowid;

  const j1 = await approvals.rejectRequest({
    table: 'vehicle_bookings', id: rId, user: { id: 999999, full_name: 'ไม่มีตัวตน' },
    allowFn: async () => false,
  });
  check(j1.error && j1.code === 403, 'allowFn → false ได้ 403', JSON.stringify(j1).slice(0, 120));

  const j2 = await approvals.rejectRequest({
    table: 'vehicle_bookings', id: rId, user: { id: admin.id, full_name: 'admin', role: 'admin' },
    allowFn: async () => true,
  });
  check(j2.ok === true, 'allowFn → true ปฏิเสธได้', JSON.stringify(j2).slice(0, 120));
  const jRow = await db.prepare('SELECT status FROM vehicle_bookings WHERE id = ?').get(rId);
  check(jRow.status === 'rejected', 'สถานะเป็น rejected', 'ได้ ' + jRow.status);

  /* ── เก็บกวาด ────────────────────────────────────────────────────────── */
  await db.prepare('DELETE FROM vehicle_bookings WHERE id IN (?,?,?)').run(bId, fId, rId);
  await db.close();

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  void harness; void auth; void other;
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ทดสอบล้มเหลว:', e);
  process.exit(1);
});