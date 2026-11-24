'use strict';
/**
 * ทดสอบ "ลงเวลาทำงานล่วงเวลา" (OT) — ผู้ใช้สั่ง 24 พ.ย. 2569
 *
 *   · กดเข้า/ออกได้ทุกเวลาของ "วันทำการ"
 *   · เสาร์–อาทิตย์ → 400
 *   · บันทึกลง time_records (ot_in / ot_out) → ไปแสดงในรายการ + การ์ดทำงานล่วงเวลา
 *
 * ⚠️ ใช้โหมดจำลองวันที่ (settings.sim_today) เพื่อให้เทสต์ได้ผลเท่ากันทุกวัน
 *    (ถ้ารันวันเสาร์–อาทิตย์จริง จะทดสอบ "วันทำการ" ไม่ได้)
 *
 * ใช้: node scripts/test-overtime-clock.js
 */
const path = require('path');
const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const WORKDAY = '2026-11-25'; // พุธ
const WEEKEND = '2026-11-28'; // เสาร์

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
  let backupSim = null;

  const mkUser = async (tag) => {
    const hash = await auth.hashPassword('Test1234**');
    const info = await db.prepare(`INSERT INTO users
      (username, password_hash, title, full_name, first_name, last_name, position, workplace,
       role, status, user_group, created_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`).run(
      `zzot_${tag}_${Date.now()}`, hash, 'นาย', `ทดสอบ OT ${tag}`, `ทดสอบ${tag}`, 'OT',
      'เจ้าหน้าที่', 'กลุ่มงานทดสอบ', 'staff', 'active', 'office'
    );
    const id = Number(info.insertId);
    madeUsers.push(id);
    return id;
  };

  const jpost = async (p, cookie, body) => {
    const res = await fetch(BASE + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body || {}),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const jput = async (p, cookie, body) => {
    const res = await fetch(BASE + p, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body || {}),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const jget = async (p, cookie) => {
    const res = await fetch(BASE + p, { headers: { Cookie: cookie } });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const setSetting = (key, value) => db
    .prepare('INSERT INTO settings (`key`, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
    .run(key, value);

  /**
   * พิกัดของสถานที่ทำงานจากหน้าตั้งค่า (ถ้าตั้งไว้)
   *   ลงเวลาเข้าล่วงเวลาต้องใช้ GPS เหมือนลงเวลาเข้างาน (ผู้ใช้สั่ง 24 พ.ย. 2569)
   */
  const geoPayload = async () => {
    try {
      const sitesRow = await db.prepare("SELECT value FROM settings WHERE `key` = 'clock_sites'").get();
      let sites = [];
      try { sites = JSON.parse(sitesRow ? sitesRow.value : '[]'); } catch (e) { sites = []; }
      const s = Array.isArray(sites)
        ? sites.find((x) => x && Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lng)))
        : null;
      if (s) return { lat: Number(s.lat), lng: Number(s.lng) };
      const latRow = await db.prepare("SELECT value FROM settings WHERE `key` = 'clock_lat'").get();
      const lngRow = await db.prepare("SELECT value FROM settings WHERE `key` = 'clock_lng'").get();
      const la = Number(latRow ? latRow.value : '');
      const lo = Number(lngRow ? lngRow.value : '');
      if (Number.isFinite(la) && Number.isFinite(lo) && String(latRow.value || '') !== '' && String(lngRow.value || '') !== '') {
        return { lat: la, lng: lo };
      }
    } catch (e) { /* ignore */ }
    return {};
  };

  try {
    const adminCookie = 'sid=' + (await auth.newSession(1));

    // เก็บค่าจำลองเดิม แล้วตั้งเป็นวันทำการ (พุธ)
    const before = await jget('/api/sim-date', adminCookie);
    backupSim = before.body && before.body.sim_today ? before.body.sim_today : '';
    const setSim = await jput('/api/sim-date', adminCookie, { date: WORKDAY });
    check(setSim.status === 200, `ตั้งวันจำลองเป็น ${WORKDAY} → 200 (ได้ ${setSim.status})`,
      JSON.stringify(setSim.body));

    const user = await mkUser('user');
    const cookie = 'sid=' + (await auth.newSession(user));

    console.log('① วันทำการ: ลงเวลาเข้าล่วงเวลา → บันทึก ot_in (ใช้พิกัด GPS ถ้าตั้งไว้)');
    const geo = await geoPayload();
    const otIn = await jpost('/api/time/overtime', cookie, { type: 'in', ...geo });
    check(otIn.status === 200, `POST /time/overtime (in) → 200 (ได้ ${otIn.status})`, JSON.stringify(otIn.body));
    check(!!otIn.body.ot_in, 'คืน ot_in', JSON.stringify(otIn.body));
    const row1 = await db.prepare('SELECT ot_in, ot_out, ot_in_src FROM time_records WHERE user_id = ? AND date = ?').get(user, WORKDAY);
    check(row1 && !!row1.ot_in, 'บันทึก ot_in ลงฐาน', JSON.stringify(row1));
    if (geo.lat !== undefined) {
      check(row1 && String(row1.ot_in_src || '').includes('GPS'), 'บันทึกพิกัดที่ตรวจ (ot_in_src)',
        JSON.stringify(row1 && row1.ot_in_src));
    }

    console.log('');
    console.log('①.๑ ถ้าตั้งพิกัดไว้: ลงเวลาเข้าล่วงเวลา "ไม่มี GPS" ต้องถูกปฏิเสธ');
    if (geo.lat !== undefined) {
      const user2 = await mkUser('nogeo');
      const cookie2 = 'sid=' + (await auth.newSession(user2));
      const noGeo = await jpost('/api/time/overtime', cookie2, { type: 'in' });
      check(noGeo.status === 400, `POST (in ไม่มี GPS) → 400 (ได้ ${noGeo.status})`, JSON.stringify(noGeo.body));
      check(String(noGeo.body.error || '').includes('GPS'), 'ข้อความแจ้งเรื่องตำแหน่ง',
        JSON.stringify(noGeo.body.error));
    } else {
      check(true, 'ยังไม่ได้ตั้งพิกัด → ไม่ต้องส่ง lat/lng (เหมือนลงเวลาเข้าปกติ)');
    }

    console.log('');
    console.log('①.๒ ตั้งพิกัดที่ทำงานแล้ว: OT ต้องตรวจ GPS เหมือนลงเวลาเข้างาน');
    {
      const keys = ['clock_geo_enabled', 'clock_sites', 'clock_lat', 'clock_lng', 'clock_radius'];
      const backupGeo = {};
      for (const k of keys) {
        const r = await db.prepare('SELECT value FROM settings WHERE `key` = ?').get(k);
        backupGeo[k] = r ? r.value : null;
      }
      const LAT = 18.08346;
      const LNG = 99.84805;
      await setSetting('clock_geo_enabled', '1');
      await setSetting('clock_sites', JSON.stringify([{ key: 'office', lat: LAT, lng: LNG, radius: 200 }]));
      try {
        const u3 = await mkUser('gps');
        const c3 = 'sid=' + (await auth.newSession(u3));

        const noGps = await jpost('/api/time/overtime', c3, { type: 'in' });
        check(noGps.status === 400 && /GPS/.test(String(noGps.body.error || '')),
          'ไม่มี GPS → 400 (บอกให้อนุญาตตำแหน่ง)', JSON.stringify(noGps.body));

        const far = await jpost('/api/time/overtime', c3, { type: 'in', lat: 0, lng: 0 });
        check(far.status === 403, `อยู่นอกรัศมี → 403 (ได้ ${far.status})`, JSON.stringify(far.body));

        const okGeo = await jpost('/api/time/overtime', c3, { type: 'in', lat: LAT, lng: LNG });
        check(okGeo.status === 200, `อยู่ในรัศมี → 200 (ได้ ${okGeo.status})`, JSON.stringify(okGeo.body));

        const rowG = await db.prepare('SELECT ot_in_src FROM time_records WHERE user_id = ? AND date = ?').get(u3, WORKDAY);
        check(rowG && /GPS/.test(String(rowG.ot_in_src || '')), 'บันทึกพิกัดที่ตรวจลง ot_in_src',
          JSON.stringify(rowG && rowG.ot_in_src));
      } finally {
        for (const k of keys) {
          if (backupGeo[k] === null || backupGeo[k] === undefined) {
            await db.prepare('DELETE FROM settings WHERE `key` = ?').run(k);
          } else {
            await setSetting(k, backupGeo[k]);
          }
        }
      }
    }

    console.log('');
    console.log('② มีแถว OT อยู่แล้ว ยังลงเวลาเข้างานปกติได้ (ไม่ติด "ลงเวลาแล้ว")');
    const normalIn = await jpost('/api/time/check', cookie, { type: 'in' });
    const blockedAlready = normalIn.status === 400 && String(normalIn.body.error || '').includes('ได้ลงเวลาเข้างานแล้ว');
    check(!blockedAlready, 'ไม่ตอบ 400 ว่า "ลงเวลาเข้างานแล้ว" ทั้งที่ยังไม่ได้ลง',
      JSON.stringify(normalIn.body));

    console.log('');
    console.log('③ ลงเข้าล่วงเวลาซ้ำ → 400');
    const dup = await jpost('/api/time/overtime', cookie, { type: 'in', ...geo });
    check(dup.status === 400, `POST (in ซ้ำ) → 400 (ได้ ${dup.status})`, JSON.stringify(dup.body));

    console.log('');
    console.log('④ ลงเวลาออกล่วงเวลา → บันทึก ot_out (ไม่ต้องมี GPS)');
    const otOut = await jpost('/api/time/overtime', cookie, { type: 'out' });
    check(otOut.status === 200, `POST (out) → 200 (ได้ ${otOut.status})`, JSON.stringify(otOut.body));
    const row2 = await db.prepare('SELECT ot_in, ot_out FROM time_records WHERE user_id = ? AND date = ?').get(user, WORKDAY);
    check(row2 && !!row2.ot_in && !!row2.ot_out, 'มีทั้ง ot_in และ ot_out', JSON.stringify(row2));

    console.log('');
    console.log('⑤ รายการบันทึกเวลาของวันนั้นมีแถว OT');
    const list = await jget('/api/time/all?date=' + WORKDAY, adminCookie);
    const found = (list.body.records || []).find((r) => Number(r.user_id) === user);
    check(!!found, 'มีแถวของผู้ใช้ในรายการ', JSON.stringify((list.body.records || []).length));
    check(found && !!found.ot_in && !!found.ot_out, 'แถวนั้นมี ot_in/ot_out',
      JSON.stringify(found && { in: found.ot_in, out: found.ot_out }));

    console.log('');
    console.log('⑥ การ์ด "ทำงานล่วงเวลา" ใน /time/stats มีรายชื่อ');
    const stats = await jget('/api/time/stats', adminCookie);
    check(stats.status === 200, `GET /time/stats → 200 (ได้ ${stats.status})`);
    const otRows = stats.body.overtime || [];
    check(otRows.some((r) => Number(r.user_id) === user), 'มีชื่อผู้ใช้ในการ์ด',
      JSON.stringify(otRows.map((r) => r.user_id).slice(0, 10)));
    check(Number(stats.body.overtimeCount) === otRows.length, 'overtimeCount ตรงกับจำนวนรายชื่อ',
      JSON.stringify({ count: stats.body.overtimeCount, rows: otRows.length }));

    console.log('');
    console.log('⑦ การ์ด "ทำงานล่วงเวลา" บนหน้าแรก (/today-summary)');
    const sum = await jget('/api/today-summary', adminCookie);
    const sumOt = sum.body.overtime || [];
    check(sumOt.some((r) => Number(r.user_id) === user), '/today-summary มีรายชื่อ OT',
      JSON.stringify(sumOt.map((r) => r.user_id).slice(0, 10)));

    console.log('');
    console.log('⑧ วันเสาร์–อาทิตย์ → 400 (กดไม่ได้)');
    await jput('/api/sim-date', adminCookie, { date: WEEKEND });
    const weekend = await jpost('/api/time/overtime', cookie, { type: 'in' });
    check(weekend.status === 400, `POST (เสาร์) → 400 (ได้ ${weekend.status})`, JSON.stringify(weekend.body));
    check(String(weekend.body.error || '').includes('เสาร์'), 'ข้อความแจ้งว่าเป็นวันหยุด',
      JSON.stringify(weekend.body.error));
  } catch (e) {
    check(false, 'ทดสอบไม่จบ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
  } finally {
    try {
      // คืนค่าวันจำลองเดิม
      const adminCookie = 'sid=' + (await auth.newSession(1));
      await jput('/api/sim-date', adminCookie, { date: backupSim || '' });
      for (const id of madeUsers) {
        try { await db.prepare('DELETE FROM time_records WHERE user_id = ?').run(id); } catch (e) { /* ignore */ }
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
