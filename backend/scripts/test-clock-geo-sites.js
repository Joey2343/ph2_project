'use strict';
/**
 * ทดสอบ "ตั้งค่าตำแหน่งที่ทำงาน" แบบ 2 สถานที่ + ลงเวลาด้วย GPS เท่านั้น
 *
 * ทำไมต้องมี
 * ──────────
 * ผู้ใช้แจ้งว่าการลงเวลาต้องใช้ GPS ของอุปกรณ์เทียบกับพิกัดที่ทำงาน
 * และที่ทำงานมี 2 แห่ง คือ
 *   ① สพป.แพร่ เขต 2 อ.ลอง
 *   ② ศูนย์พัฒนาวิชาการ ร่องกาศ
 * แต่ละแห่งตั้ง ละติจูด · ลองติจูด · รัศมี ได้เอง และ **ไม่ใช้ IP อีกต่อไป**
 *
 * บั๊กที่ต้องกันไม่ให้กลับมา
 *   ① ตั้งพิกัดได้ชุดเดียว → ลงเวลาได้แค่ที่เดียว อีกที่ขึ้น "อยู่นอกพื้นที่"
 *   ② ยังเหลือการตรวจ IP อยู่ (ผู้ใช้สั่งเอาออก) → คอมพิวเตอร์ลงเวลาไม่ได้
 *   ③ `PUT /time/location-settings` เดิมไม่ await การเขียน settings
 *      → ตอบ 200 แต่ค่าไม่ถูกบันทึก (หรือบันทึกไม่ครบ)
 *   ④ ถ้าไม่มีพิกัดเลยแล้วปฏิเสธการลงเวลา → smoke.js พัง
 *      (smoke.js ยิง /api/time/check โดยไม่ส่ง lat/lng) ต้อง "เตือนแต่ยอมให้ลง"
 *
 * สิ่งที่ต้องผ่าน
 *   ① บันทึก 2 สถานที่ แล้ว GET คืนมาครบทั้งคู่ พร้อมชื่อ/พิกัด/รัศมี
 *   ② GET ต้องไม่มี `ips` แล้ว (เอาออกตามที่ผู้ใช้สั่ง)
 *   ③ อยู่ในรัศมีสถานที่ 1 → ลงเวลาเข้าได้ + src บอกชื่อสถานที่นั้น
 *   ④ อยู่นอกรัศมีทุกสถานที่ → 403
 *   ⑤ อยู่ในรัศมีสถานที่ 2 → ลงเวลาออกได้ + src บอกชื่อสถานที่นั้น
 *   ⑥ ไม่ส่ง lat/lng มา → 400 (ต้องใช้ GPS)
 *   ⑦ ปิดการตรวจสอบ → ลงเวลาได้โดยไม่ต้องมี GPS
 *   ⑧ ยังไม่ตั้งพิกัดเลย → เตือนแต่ยอมให้ลง (smoke.js ต้องผ่าน)
 *   ⑨ ค่าที่ผิด (lat ไม่มี lng · key ไม่รู้จัก · รัศมี ≤ 0) → 400 และค่าเดิมไม่เสีย
 *
 * ใช้: node scripts/test-clock-geo-sites.js
 * ⚠️ ต้องรันผ่าน `npm run verify` (เซิร์ฟเวอร์ทดสอบปิด Telegram) เท่านั้น
 *    เทสต์นี้แก้ `settings` และสร้าง `time_records` ของผู้ใช้ชั่วคราว
 *    แล้ว **คืนค่าเดิมทั้งหมด** ในบล็อก finally
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const ADMIN_USER = process.env.TEST_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.TEST_ADMIN_PASS || 'Joey2343**';

/** ชื่อสถานที่ต้องตรงกับ CLOCK_SITES ใน routes/ops.js (ผู้ใช้กำหนดไว้ตายตัว) */
const NAME_OFFICE = 'สพป.แพร่ เขต 2 อ.ลอง';
const NAME_CENTER = 'ศูนย์พัฒนาวิชาการ ร่องกาศ';

/** พิกัดสมมติ (ไม่ใช่พิกัดจริง — กันการเผลอไปทับค่าที่ผู้ใช้ตั้งไว้) */
const OFFICE = { lat: 18.1, lng: 100.1, radius: 150 };
const CENTER = { lat: 18.2, lng: 100.2, radius: 300 };
/** อยู่ในรัศมีของแต่ละสถานที่ (ห่างราว 76 เมตร) */
const NEAR_OFFICE = { lat: 18.1005, lng: 100.1005 };
const NEAR_CENTER = { lat: 18.2005, lng: 100.2005 };
/** ไกลทั้งสองสถานที่ (หลายสิบกิโลเมตร) */
const FAR = { lat: 18.5, lng: 100.5 };

const SETTINGS_KEYS = ['clock_sites', 'clock_geo_enabled', 'clock_lat', 'clock_lng', 'clock_radius'];

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.log(`  ✖ ${name}`); if (detail) console.log(`      ${detail}`); }
}

async function login(user, pw) {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pw }),
  });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

async function call(method, p, cookie, body) {
  const opts = { method, headers: { Cookie: cookie } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + p, opts);
  return { status: res.status, body: await res.json().catch(() => null) };
}
const jget = (p, c) => call('GET', p, c);
const jput = (p, c, b) => call('PUT', p, c, b);
const jpost = (p, c, b) => call('POST', p, c, b);

/** เซสชันของผู้ใช้ชั่วคราว (ไม่ต้องรู้รหัสผ่าน) */
async function sessionOf(userId) {
  return 'sid=' + (await auth.newSession(userId));
}

(async () => {
  console.log('');
  console.log('เชื่อมต่อเซิร์ฟเวอร์');
  let admin = '';
  try {
    admin = await login(ADMIN_USER, ADMIN_PASS);
  } catch (e) {
    console.log(`  – ข้าม: ติดต่อ ${BASE} ไม่ได้ (${e.message})`);
    console.log('');
    console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    process.exit(fail ? 1 : 0);
  }
  if (!admin) {
    console.log('  – ข้าม: ล็อกอินไม่สำเร็จ');
    console.log('');
    console.log(`ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    process.exit(fail ? 1 : 0);
  }

  const db = require(path.join(__dirname, '..', 'db.js'));
  await db.init();

  /* ── สำรองค่าตั้งเดิม (คืนใน finally) ───────────────────────────────── */
  const backup = {};
  for (const k of SETTINGS_KEYS) {
    const row = await db.prepare('SELECT value FROM settings WHERE `key` = ?').get(k);
    backup[k] = row ? row.value : null;
  }
  const restoreSettings = async () => {
    for (const k of SETTINGS_KEYS) {
      if (backup[k] === null) {
        await db.prepare('DELETE FROM settings WHERE `key` = ?').run(k);
      } else {
        await db.prepare('INSERT INTO settings (`key`, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)').run(k, backup[k]);
      }
    }
  };

  const madeUsers = [];
  const madeSessions = [];
  const mkUser = async (tag) => {
    const hash = await auth.hashPassword('Test1234**');
    const username = `zzclock_${tag}_${Date.now()}`;
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, position, workplace, role, status,
       user_group, school_code, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      username, hash, 'นาย', 'ทดสอบลงเวลา ' + tag, 'เจ้าหน้าที่',
      'สพป.แพร่ เขต 2', 'staff', 'active', 'office', '',
      '2026-10-25 09:00:00', '2026-10-25 09:00:00'
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    const cookie = await sessionOf(id);
    madeSessions.push(cookie.replace(/^sid=/, ''));
    return cookie;
  };

  try {
    /* ── ① บันทึก 2 สถานที่ ───────────────────────────────────────────── */
    console.log('');
    console.log('① บันทึกตำแหน่งที่ทำงาน 2 แห่ง');

    const saved = await jput('/api/time/location-settings', admin, {
      enabled: true,
      sites: [
        { key: 'office', lat: OFFICE.lat, lng: OFFICE.lng, radius: OFFICE.radius },
        { key: 'center', lat: CENTER.lat, lng: CENTER.lng, radius: CENTER.radius },
      ],
    });
    check(saved.status === 200, 'PUT /time/location-settings → 200', `ได้ ${saved.status} ${JSON.stringify(saved.body)}`);

    const cfg = await jget('/api/time/location-settings', admin);
    const sites = (cfg.body && cfg.body.sites) || [];
    check(cfg.status === 200, 'GET /time/location-settings → 200', `ได้ ${cfg.status}`);
    check(Array.isArray(sites) && sites.length === 2, 'คืนสถานที่ทำงาน 2 แห่ง', `ได้ ${sites.length} แห่ง`);

    const off = sites.find((s) => s.key === 'office') || {};
    const cen = sites.find((s) => s.key === 'center') || {};
    check(off.name === NAME_OFFICE, `สถานที่ 1 ชื่อ "${NAME_OFFICE}"`, `ได้ "${off.name}"`);
    check(cen.name === NAME_CENTER, `สถานที่ 2 ชื่อ "${NAME_CENTER}"`, `ได้ "${cen.name}"`);
    check(Number(off.lat) === OFFICE.lat && Number(off.lng) === OFFICE.lng && Number(off.radius) === OFFICE.radius,
      'สถานที่ 1 บันทึกพิกัด/รัศมีครบ',
      `ได้ lat=${off.lat} lng=${off.lng} radius=${off.radius}`);
    check(Number(cen.lat) === CENTER.lat && Number(cen.lng) === CENTER.lng && Number(cen.radius) === CENTER.radius,
      'สถานที่ 2 บันทึกพิกัด/รัศมีครบ',
      `ได้ lat=${cen.lat} lng=${cen.lng} radius=${cen.radius}`);

    /* ── ② ไม่มี IP แล้ว ─────────────────────────────────────────────── */
    console.log('');
    console.log('② ต้องไม่มีค่าตรวจ IP อินเทอร์เน็ตอีกแล้ว');
    check(!('ips' in (cfg.body || {})), 'GET ไม่คืน `ips` แล้ว',
      'ผู้ใช้สั่งให้เอาส่วน IP ออก — ถ้ายังคืนแปลว่ายังเหลือโค้ดเดิม');
    const settingsSrc = require('fs').readFileSync(path.join(__dirname, '..', 'routes', 'ops.js'), 'utf8');
    check(!/clock_ips|ipAllowed\s*\(|clientIp\s*\(/.test(settingsSrc),
      'routes/ops.js ไม่เหลือการตรวจ IP (clock_ips / ipAllowed / clientIp)',
      'ถ้ายังเหลืออยู่ IP จะยังถูกใช้ตัดสินการลงเวลา');

    /* ── ③ ลงเวลาในรัศมีสถานที่ 1 ─────────────────────────────────────── */
    console.log('');
    console.log('③ อยู่ในรัศมี "สพป.แพร่ เขต 2 อ.ลอง" → ลงเวลาเข้าได้');
    const userA = await mkUser('a');
    const inA = await jpost('/api/time/check', userA, { type: 'in', lat: NEAR_OFFICE.lat, lng: NEAR_OFFICE.lng });
    check(inA.status === 200, 'ลงเวลาเข้า → 200', `ได้ ${inA.status} ${JSON.stringify(inA.body)}`);
    let todayA = (await jget('/api/time/today', userA)).body || {};
    let recA = todayA.record || {};
    check(!!recA.clock_in, 'มีเวลาเข้างานในบันทึกจริง');
    check(String(recA.clock_in_src || '').includes(NAME_OFFICE),
      `clock_in_src บอกสถานที่ที่ใช้ตรวจ ("${NAME_OFFICE}")`,
      `ได้ "${recA.clock_in_src}"`);
    check(/GPS/.test(String(recA.clock_in_src || '')), 'clock_in_src ระบุว่าใช้ GPS', `ได้ "${recA.clock_in_src}"`);
    check(recA.work_site === NAME_OFFICE,
      `/time/today คืน work_site = "${NAME_OFFICE}"`,
      `ได้ "${recA.work_site}"`);

    const sumA = (await jget('/api/today-summary', userA)).body || {};
    const workedA = (sumA.worked || []).find((w) => w.id === madeUsers[0]) || {};
    check(workedA.work_site === NAME_OFFICE,
      `รายการ "มาทำงานวันนี้" (/today-summary) แสดง work_site = "${NAME_OFFICE}"`,
      `ได้ "${workedA.work_site}"`);

    /* ── ④ อยู่นอกพื้นที่ ────────────────────────────────────────────── */
    console.log('');
    console.log('④ อยู่นอกรัศมีทุกสถานที่ → 403');
    const userB = await mkUser('b');
    const farB = await jpost('/api/time/check', userB, { type: 'in', lat: FAR.lat, lng: FAR.lng });
    check(farB.status === 403, 'ลงเวลานอกพื้นที่ → 403', `ได้ ${farB.status} ${JSON.stringify(farB.body)}`);
    const todayB = (await jget('/api/time/today', userB)).body || {};
    check(!todayB.record, 'ไม่มีบันทึกการลงเวลาถูกสร้างตอนถูกปฏิเสธ');

    // userB เข้างานที่สถานที่ 2 ("ศูนย์พัฒนาวิชาการ ร่องกาศ") → ต้องปรากฏในรายการมาทำงานวันนี้ด้วยชื่อสถานที่ 2
    const inB = await jpost('/api/time/check', userB, { type: 'in', lat: NEAR_CENTER.lat, lng: NEAR_CENTER.lng });
    check(inB.status === 200, `ลงเวลาเข้าที่สถานที่ 2 ("${NAME_CENTER}") → 200`, `ได้ ${inB.status}`);
    const sumB = (await jget('/api/today-summary', userB)).body || {};
    const workedB = (sumB.worked || []).find((w) => w.id === madeUsers[1]) || {};
    check(workedB.work_site === NAME_CENTER,
      `รายการ "มาทำงานวันนี้" (/today-summary) แสดง work_site = "${NAME_CENTER}"`,
      `ได้ "${workedB.work_site}"`);

    /* ── ⑤ ลงเวลาออกงานไม่ต้องอ้างอิงพิกัด ───────────────────────────── */
    console.log('');
    console.log('⑤ ลงเวลาออกงานไม่ต้องอ้างอิงพิกัด (ผู้ใช้สั่ง)');
    // อยู่นอกรัศมีทุกสถานที่ (พิกัดไกลมาก) ก็ต้องลงเวลาออกได้
    const farOut = await jpost('/api/time/check', userA, { type: 'out', lat: FAR.lat, lng: FAR.lng });
    check(farOut.status === 200, 'ลงเวลาออกงานด้วยพิกัดไกล → 200 (ไม่ตรวจตำแหน่ง)',
      `ได้ ${farOut.status} ${JSON.stringify(farOut.body)}`);
    todayA = (await jget('/api/time/today', userA)).body || {};
    recA = todayA.record || {};
    check(!!recA.clock_out, 'มีเวลาออกงานในบันทึกจริง');
    check(String(recA.clock_out_src || '').includes('ไม่ตรวจตำแหน่ง'),
      'clock_out_src บอกว่าไม่ได้ตรวจตำแหน่ง',
      `ได้ "${recA.clock_out_src}"`);

    // ออกงานซ้ำไม่ได้
    const outAgain = await jpost('/api/time/check', userA, { type: 'out' });
    check(outAgain.status === 400, 'ลงเวลาออกงานซ้ำ → 400', `ได้ ${outAgain.status}`);

    // ออกงานโดยไม่ส่ง lat/lng เลยก็ต้องได้
    const userE = await mkUser('e');
    await jpost('/api/time/check', userE, { type: 'in', lat: NEAR_OFFICE.lat, lng: NEAR_OFFICE.lng });
    const outNoGps = await jpost('/api/time/check', userE, { type: 'out' });
    check(outNoGps.status === 200, 'ลงเวลาออกงานโดยไม่ส่ง GPS → 200',
      `ได้ ${outNoGps.status} ${JSON.stringify(outNoGps.body)}`);

    /* ── ⑥ ไม่ส่ง GPS ตอนเข้างาน → 400 ──────────────────────────────── */
    console.log('');
    console.log('⑥ ไม่ส่งตำแหน่ง GPS ตอนเข้างาน → 400');
    const userC = await mkUser('c');
    const noGps = await jpost('/api/time/check', userC, { type: 'in' });
    check(noGps.status === 400, 'ไม่ส่ง lat/lng ตอนเข้างาน → 400', `ได้ ${noGps.status} ${JSON.stringify(noGps.body)}`);

    /* ── ⑦ ปิดการตรวจสอบ → ลงเวลาได้โดยไม่ต้องมี GPS ────────────────── */
    console.log('');
    console.log('⑦ ปิดการตรวจสอบตำแหน่ง → ลงเวลาได้โดยไม่ต้องมี GPS');
    await jput('/api/time/location-settings', admin, { enabled: false });
    const offCheck = await jpost('/api/time/check', userC, { type: 'in' });
    check(offCheck.status === 200, 'ปิดตรวจสอบแล้วลงเวลาเข้า → 200', `ได้ ${offCheck.status} ${JSON.stringify(offCheck.body)}`);
    const warnOff = (offCheck.body && offCheck.body.warning) || [];
    check(!(Array.isArray(warnOff) && warnOff.length), 'ไม่มีการเตือนเรื่องพิกัดตอนปิดตรวจสอบ', JSON.stringify(warnOff));

    /* ── ⑧ ยังไม่ตั้งพิกัด → เตือนแต่ยอมให้ลง (smoke.js ต้องผ่าน) ────── */
    console.log('');
    console.log('⑧ ยังไม่ได้ตั้งพิกัด → เตือนแต่ยอมให้ลงเวลา');
    await jput('/api/time/location-settings', admin, {
      enabled: true,
      sites: [
        { key: 'office', lat: null, lng: null, radius: 200 },
        { key: 'center', lat: null, lng: null, radius: 200 },
      ],
    });
    const userD = await mkUser('d');
    const noCoord = await jpost('/api/time/check', userD, { type: 'in' });
    check(noCoord.status === 200, 'ไม่มีพิกัด → ยังลงเวลาได้ (เตือน)', `ได้ ${noCoord.status} ${JSON.stringify(noCoord.body)}`);
    const warnNoCoord = (noCoord.body && noCoord.body.warning) || [];
    check(Array.isArray(warnNoCoord) && warnNoCoord.some((w) => String(w).includes('ยังไม่ได้ตั้งค่าพิกัด')),
      'มีคำเตือนว่า "ยังไม่ได้ตั้งค่าพิกัด"',
      `ได้ ${JSON.stringify(warnNoCoord)} — ถ้าไม่เตือน ผู้ใช้จะไม่รู้ว่ายังไม่ได้ตั้งค่า`);

    /* ── ⑨ ค่าที่ผิดต้องถูกปฏิเสธและไม่ทำค่าเดิมเสีย ────────────────── */
    console.log('');
    console.log('⑨ ค่าที่ผิด → 400 และค่าเดิมไม่เสียหาย');
    await jput('/api/time/location-settings', admin, {
      enabled: true,
      sites: [
        { key: 'office', lat: OFFICE.lat, lng: OFFICE.lng, radius: OFFICE.radius },
        { key: 'center', lat: CENTER.lat, lng: CENTER.lng, radius: CENTER.radius },
      ],
    });
    const badLatOnly = await jput('/api/time/location-settings', admin, {
      sites: [{ key: 'office', lat: 18.5, lng: null, radius: 100 }],
    });
    check(badLatOnly.status === 400, 'กรอกละติจูดแต่ไม่กรอกลองติจูด → 400', `ได้ ${badLatOnly.status}`);

    const badKey = await jput('/api/time/location-settings', admin, {
      sites: [{ key: 'bogus', lat: 18.5, lng: 100.5, radius: 100 }],
    });
    check(badKey.status === 400, 'สถานที่ที่ไม่รู้จัก → 400', `ได้ ${badKey.status}`);

    const badRadius = await jput('/api/time/location-settings', admin, {
      sites: [{ key: 'office', lat: OFFICE.lat, lng: OFFICE.lng, radius: 0 }],
    });
    check(badRadius.status === 400, 'รัศมี 0 → 400', `ได้ ${badRadius.status}`);

    const afterBad = (await jget('/api/time/location-settings', admin)).body || {};
    const afterSites = afterBad.sites || [];
    const offAfter = afterSites.find((s) => s.key === 'office') || {};
    check(Number(offAfter.lat) === OFFICE.lat && Number(offAfter.radius) === OFFICE.radius,
      'ค่าที่ผิดไม่ทับค่าที่บันทึกไว้',
      `ได้ lat=${offAfter.lat} radius=${offAfter.radius}`);
  } finally {
    /* ── คืนค่าเดิม + ลบข้อมูลที่สร้าง ────────────────────────────────── */
    try { await restoreSettings(); } catch (e) { console.log('  ⚠ คืนค่า settings ไม่สำเร็จ: ' + e.message); }
    for (const id of madeUsers) {
      try { await db.prepare('DELETE FROM time_records WHERE user_id = ?').run(id); } catch (e) { /* ignore */ }
      try { await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); } catch (e) { /* ignore */ }
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
