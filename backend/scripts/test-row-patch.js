/**
 * ทดสอบว่า endpoint ที่เปลี่ยนสถานะ คืนค่าจริงของแถวกลับมาให้หน้าเว็บ
 *
 * ทำไมต้องมี
 * ──────────
 * ผู้ใช้แจ้งว่า "กดอนุมัติ/กดอ่านหนังสือ แล้วสถานะไม่เปลี่ยน ต้องรีเฟรชเอง"
 *
 * สาเหตุมี 2 ชั้น
 *   ① ปุ่ม "อ่านหนังสือ" — backend บันทึก is_read เรียบร้อย แต่ response เดิมคืนแค่
 *      { ok: true } หน้าเว็บจึงไม่มีอะไรมาอัปเดตแถว และโค้ดเดิมก็ไม่ reload
 *      → ต้องรีเฟรชเองถึงเห็น "อ่านแล้ว"
 *   ② ปุ่มอนุมัติ/ตรวจสอบ — หน้าเว็บ reload ทั้งตารางอยู่ ตารางหายไปเหลือ
 *      "กำลังโหลดข้อมูล..." ทุกครั้ง
 *
 * ทางแก้: backend คืน `row` = สถานะจริงหลังบันทึก ให้หน้าเว็บอัปเดตเฉพาะแถวได้
 *   เทสต์นี้ตรวจว่า `row` นั้น **ตรงกับฐานข้อมูลจริง** ไม่ใช่แค่มี key ครบ
 *
 * ⚠️ จุดที่เคยพลาดและต้องเช็กทุกครั้ง
 *   UI.approvalDone() เลือก approvals.length ก่อน approval_level
 *   ถ้าคืนแค่ approval_level แต่ไม่คืน approvals ป้าย "อนุมัติแล้ว x/y ขั้น" จะเพี้ยน
 *   → เทสต์นี้ยืนยันว่า approvals.length ตรงกับ approval_level หลังอนุมัติจริง
 *
 * ใช้: node scripts/test-row-patch.js
 */
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const path = require('path');
const ADMIN_USER = process.env.TEST_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.TEST_ADMIN_PASS || 'Joey2343**';

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
}

async function login() {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

const jget = async (p, cookie) => (await fetch(BASE + p, { headers: { Cookie: cookie } })).json();
const jput = async (p, cookie, body) =>
  (await fetch(BASE + p, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body || {}),
  })).json();

/** ตรวจว่า row ที่ endpoint คืน ตรงกับสิ่งที่บันทึกจริงในฐาน */
function checkRowShape(row, wantStatus, label) {
  check(!!row && typeof row === 'object', `${label}: คืน row กลับมา`,
    'ถ้าไม่มี row หน้าเว็บจะอัปเดตไม่ได้ แล้วต้องรอผู้ใช้รีเฟรชเอง');
  if (!row || typeof row !== 'object') return;
  check(row.status === wantStatus, `${label}: status = "${wantStatus}" (ได้ "${row.status}")`);
  if (wantStatus !== 'approved') return;
  check(typeof row.approval_level === 'number' && row.approval_level >= 1,
    `${label}: approval_level เป็นตัวเลข ≥ 1 (ได้ ${row.approval_level})`);
  check(Array.isArray(row.approvals) && row.approvals.length > 0,
    `${label}: คืน approvals เป็น array ที่ไม่ว่าง`,
    '⚠️ ถ้าไม่คืน approvals ป้าย "อนุมัติแล้ว x/y ขั้น" จะเพี้ยน\n'
    + '      เพราะ UI.approvalDone() ใช้ approvals.length ก่อน approval_level');
  if (Array.isArray(row.approvals) && row.approvals.length && typeof row.approval_level === 'number') {
    check(row.approvals.length === row.approval_level,
      `${label}: approvals.length (${row.approvals.length}) ตรงกับ approval_level (${row.approval_level})`);
  }
  check(typeof row.required_levels === 'number' && row.required_levels >= 1,
    `${label}: คืน required_levels (ได้ ${row.required_levels}) — ป้ายต้องรู้ว่า x/y คืออะไร`);
}

(async () => {
  console.log('');
  console.log('เชื่อมต่อเซิร์ฟเวอร์');
  let cookie = '';
  try {
    cookie = await login();
  } catch (e) {
    console.log(`  – ข้าม: ติดต่อ ${BASE} ไม่ได้ (${e.message})`);
    console.log('');
    console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    process.exit(fail ? 1 : 0);
  }
  if (!cookie) {
    console.log('  – ข้าม: ล็อกอินไม่สำเร็จ');
    console.log('');
    console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    process.exit(fail ? 1 : 0);
  }

  /* ── ① ปุ่ม "อ่านหนังสือ" — ต้นเหตุที่ผู้ใช้เจอ ───────────────────────── */
  console.log('');
  console.log('① ปุ่มอ่านหนังสือ (เดิมไม่อัปเดตจนกว่าจะรีเฟรช)');
  const inc = await jget('/api/my-incoming', cookie);
  const anyDoc = (inc.documents || [])[0];
  if (!anyDoc) {
    console.log('  – ข้าม: ไม่มีหนังสือให้ทดสอบ (สร้างหนังสือสักฉบับก่อน)');
  } else {
    const r = await jput(`/api/document-recipients/${anyDoc.id}/read`, cookie);
    check(!!r.row, 'คืน row กลับมา', `ได้ ${JSON.stringify(r).slice(0, 120)}`);
    check(r.row && r.row.is_read === 1, 'row.is_read = 1 (หน้าเว็บเอาไปทับแถวได้เลย)',
      'ถ้าไม่มีค่านี้ หน้าเว็บจะยังโชว์ "🆕 ใหม่" จนกว่าจะรีเฟรช');
    check(r.row && r.row.id === Number(anyDoc.id), 'row.id ตรงกับหนังสือที่ส่งเข้ามา',
      'หน้าเว็บใช้ id นี้หาแถวที่จะอัปเดต');
    // ยืนยันกับฐานจริง
    const after = await jget('/api/my-incoming', cookie);
    const rowAfter = (after.documents || []).find((d) => Number(d.id) === Number(anyDoc.id));
    check(rowAfter && Number(rowAfter.is_read) === 1,
      'ฐานข้อมูลบันทึก is_read=1 จริง (ไม่ใช่แค่ตอบว่า ok)');
  }

  /* ── ② หนังสือรับรอง: เปลี่ยนสถานะเป็น "เสร็จแล้ว" ─────────────────────── */
  console.log('');
  console.log('② ปุ่ม "ดำเนินการเสร็จแล้ว" (หนังสือรับรอง)');
  const certs = await jget('/api/my-certificates', cookie);
  const cert = (certs.documents || []).find((d) => String(d.cert_status || '').indexOf('เสร็จแล้ว') === -1);
  if (!cert) {
    console.log('  – ข้าม: ไม่มีหนังสือรับรองที่ยังไม่เสร็จ');
  } else {
    const res2 = await fetch(`${BASE}/api/cert-status/${cert.id}`, { method: 'POST', headers: { Cookie: cookie } });
    const r2 = await res2.json();
    check(!!r2.row, 'คืน row กลับมา', `ได้ ${JSON.stringify(r2).slice(0, 120)}`);
    check(r2.row && r2.row.cert_status === 'เสร็จแล้ว',
      'row.cert_status = "เสร็จแล้ว" (ตรงกับที่ backend บันทึก)',
      `ได้ "${r2.row && r2.row.cert_status}"`);
  }

  /* ── ③ ยานพาหนะ: อนุมัติ → ต้องคืนยานพาหนะ/พนักงานขับรถที่เลือก ─────────── */
  console.log('');
  console.log('③ อนุมัติการจองยานพาหนะ');
  const vb = await jget('/api/vehicle-bookings', cookie);
  const pendingV = (vb.bookings || []).find((b) => b.status === 'pending');
  if (!pendingV) {
    console.log('  – ข้าม: ไม่มีรายการจองยานพาหนะที่รออนุมัติ');
  } else {
    const r3 = await jput(`/api/vehicle-bookings/${pendingV.id}/approve`, cookie, {});
    check(!!r3.row, 'คืน row กลับมา', `ได้ ${JSON.stringify(r3).slice(0, 140)}`);
    checkRowShape(r3.row, r3.approved ? 'approved' : 'pending', 'อนุมัติยานพาหนะ');
    check(r3.row && 'vehicle_id' in r3.row && 'driver_name' in r3.row && 'vehicle_name' in r3.row,
      'คืน vehicle_id / driver_name / vehicle_name กลับมา',
      '⚠️ ขั้นตอนก่อนหน้านี้แก้ยานพาหนะ+พนักงานขับรถในฐานแต่ไม่คืนค่า\n'
      + '      → ถ้าหน้าเว็บอัปเดตเฉพาะแถว คอลัมน์ "ยานพาหนะ" จะยังโชว์ค่าเก่า');
  }

  /* ── ④ บันทึกข้อความ: ไม่อนุมัติ → ต้องคืนสถานะ rejected ──────────────── */
  console.log('');
  console.log('④ ไม่อนุมัติบันทึกข้อความ');
  const memos = await jget('/api/memos', cookie);
  const memo = (memos.memos || []).find((m) => m.status === 'submitted');
  if (!memo) {
    console.log('  – ข้าม: ไม่มีบันทึกข้อความที่รออนุมัติ');
  } else {
    const r4 = await jput(`/api/memos/${memo.id}/reject`, cookie, { note: 'ทดสอบระบบอัปเดตสถานะ' });
    check(!!r4.row, 'คืน row กลับมา', `ได้ ${JSON.stringify(r4).slice(0, 140)}`);
    checkRowShape(r4.row, 'rejected', 'ไม่อนุมัติบันทึกข้อความ');
    check(r4.row && r4.row.note === 'ทดสอบระบบอัปเดตสถานะ',
      'คืน note ที่บันทึกจริง (ไม่ใช่ค่าที่ส่งเข้ามาก่อน trim)');
  }

  /* ── ⑤ ขอยกเลิกวันลา → ต้องคืน cancel_status ─────────────────────────── */
  console.log('');
  console.log('⑤ ขอยกเลิกวันลา');
  const leaves = await jget('/api/leaves', cookie);
  const approvedLeave = (leaves.leaves || []).find((l) => l.status === 'approved' && l.cancel_status !== 'cancel_requested');
  if (!approvedLeave) {
    console.log('  – ข้าม: ไม่มีคำขอลาที่อนุมัติแล้วและยังไม่ได้ขอยกเลิก');
  } else {
    const r5 = await fetch(`${BASE}/api/leaves/${approvedLeave.id}/cancel-request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}',
    });
    const j5 = await r5.json();
    check(!!j5.row, 'คืน row กลับมา', `ได้ ${JSON.stringify(j5).slice(0, 140)}`);
    check(j5.row && j5.row.cancel_status === 'cancel_requested',
      'row.cancel_status = "cancel_requested"', `ได้ "${j5.row && j5.row.cancel_status}"`);
  }

  /* ── ⑥ ตรวจตัวช่วยอนุมัติตรง ๆ ให้ครบทุกเส้นทาง ─────────────────────────── */
  // ข้างบนต้องพึ่งข้อมูลที่มีอยู่จริงในระบบ ซึ่งบางเส้นทางอาจไม่มีข้อมูลให้ทดสอบ
  //   โดยเฉพาะเส้นทาง status='approved' (ต้องอนุมัติครบทุกขั้น) ซึ่งสำคัญที่สุด
  //   เพราะถ้า approvals ไม่ครบ ป้าย "อนุมัติครบ x/y ขั้น" จะเพี้ยน
  console.log('');
  console.log('⑥ ตัวช่วยอนุมัติ — ทดสอบตรง ๆ ให้ครบทุกเส้นทาง (รวมอนุมัติครบขั้น)');
  const db = require(path.join(__dirname, '..', 'db.js'));
  const approvals = require(path.join(__dirname, '..', 'lib', 'approvals.js'));
  await db.init();
  const uid = await db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  const admin = await db.prepare('SELECT * FROM users WHERE id = ?').get(uid.id);
  const madeIds = [];

  const mkBooking = async (status) => {
    const veh = await db.prepare('SELECT vehicle_id FROM vehicle_bookings ORDER BY id DESC LIMIT 1').get();
    const r = await db.prepare(`INSERT INTO vehicle_bookings
      (vehicle_id, user_id, date, start_time, end_time, purpose, status, created_at)
      VALUES (?, ?, '2026-12-31', '09:00', '10:00', 'ทดสอบ row patch', ?, '2026-10-16 09:00:00')`)
      .run(veh ? veh.vehicle_id : 1, uid.id, status);
    madeIds.push(Number(r.insertId));
    return Number(r.insertId);
  };

  try {
    // 6a — ข้ามไฟล์เดียว → อนุมัติครบขั้นเดียว → status ต้องเป็น approved
    const idA = await mkBooking('pending');
    const rA = await approvals.approveRequest({
      table: 'vehicle_bookings', system: 'vehicle', id: idA, user: admin, note: 'ทดสอบ',
      requiredFn: async () => 1,
      canApproveFn: async () => true,
    });
    check(rA.approved === true, 'ข้ามไฟล์เดียว → approved = true', `ได้ ${rA.approved}`);
    checkRowShape(rA.row, 'approved', 'ข้ามไฟล์เดียว');
    check(rA.row && rA.row.approvals && rA.row.approvals[0]
      && rA.row.approvals[0].at === rA.row.decided_at,
      'at ใน approvals ตรงกับ decided_at (ใช้ค่าเดียวกัน)',
      `approvals[0].at=${rA.row && rA.row.approvals && rA.row.approvals[0] && rA.row.approvals[0].at} `
      + `decided_at=${rA.row && rA.row.decided_at}`);
    // ยืนยันกับฐานจริงว่าสถานะตรงกัน
    const dbA = await db.prepare('SELECT status, approval_level, approval_data FROM vehicle_bookings WHERE id = ?').get(idA);
    check(dbA && dbA.status === 'approved', 'ฐานข้อมูลเป็น approved จริง', `ได้ ${dbA && dbA.status}`);
    check(dbA && Number(dbA.approval_level) === (rA.row && rA.row.approval_level),
      'approval_level ในฐานตรงกับที่คืนให้หน้าเว็บ',
      `ฐาน=${dbA && dbA.approval_level} · คืน=${rA.row && rA.row.approval_level}`);

    // 6b — สองขั้น → ขั้นแรกยัง pending แต่ป้ายต้องขึ้น 1/2
    const idB = await mkBooking('pending');
    const rB = await approvals.approveRequest({
      table: 'vehicle_bookings', system: 'vehicle', id: idB, user: admin, note: 'ทดสอบ',
      requiredFn: async () => 2,
      canApproveFn: async () => true,
    });
    check(rB.approved === false, 'สองขั้น → ขั้นแรกยังไม่ approved', `ได้ ${rB.approved}`);
    check(rB.row && rB.row.status === 'pending', 'status ยัง pending ระหว่างสาย');
    check(rB.row && rB.row.approval_level === 1 && rB.row.approvals.length === 1,
      'ป้ายจะขึ้น "อนุมัติแล้ว 1/2 ขั้น" (approval_level=1, approvals=1 รายการ)',
      `level=${rB.row && rB.row.approval_level} approvals=${rB.row && rB.row.approvals && rB.row.approvals.length}`);
    check(rB.row && rB.row.required_levels === 2, 'คืน required_levels = 2 (ป้ายต้องรู้ว่า 1/2)');

    // 6c — ไม่อนุมัติ → ต้องคืน status=rejected พร้อม approvals เดิม (ไม่ทิ้ง)
    const rC = await approvals.rejectRequest({
      table: 'vehicle_bookings', id: idB, user: admin, note: 'ไม่ผ่าน',
    });
    checkRowShape(rC.row, 'rejected', 'ไม่อนุมัติ');
    check(rC.row && Array.isArray(rC.row.approvals) && rC.row.approvals.length === 1,
      'คืน approvals เดิมที่อนุมัติไปแล้ว 1 ขั้น (ไม่ทิ้ง ป้ายจะได้ถูก)',
      `ได้ ${rC.row && rC.row.approvals && rC.row.approvals.length}`);
    const dbC = await db.prepare('SELECT status, note FROM vehicle_bookings WHERE id = ?').get(idB);
    check(dbC && dbC.status === 'rejected' && String(dbC.note || '') === 'ไม่ผ่าน',
      'ฐานข้อมูลเป็น rejected พร้อมหมายเหตุที่บันทึกจริง', `ได้ ${JSON.stringify(dbC)}`);
  } finally {
    for (const id of madeIds) {
      try { await db.prepare('DELETE FROM vehicle_bookings WHERE id = ?').run(id); } catch (e) { /* ignore */ }
    }
    const left = await db.prepare(`SELECT COUNT(*) c FROM vehicle_bookings WHERE purpose = 'ทดสอบ row patch'`).get();
    check(Number(left && left.c) === 0, 'ลบข้อมูลทดสอบครบ ไม่ทิ้งของทดสอบไว้ในระบบ',
      `ยังเหลือ ${left && left.c} แถว`);
    await db.close();
  }

  console.log('');
  console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('  ✖ ทดสอบล้มเหลว:', e.message); process.exit(1); });