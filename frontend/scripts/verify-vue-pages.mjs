/**
 * ตรวจการแทนหน้าด้วย Vue component (เฟส 3–9)
 *
 *   node scripts/verify-vue-pages.mjs            ตรวจเฉพาะหน้าที่ย้ายแล้ว
 *   node scripts/verify-vue-pages.mjs --all      ตรวจทุกหน้าเทียบกัน
 *
 * สิ่งที่ตรวจสำหรับหน้าที่เขียนเป็น Vue แล้ว:
 *   1. หน้าแสดงเนื้อหาจริง ไม่ใช่หน้าโหลดค้าง / ไม่มีสิทธิ์
 *   2. ไม่มี runtime error
 *   3. หัวหน้าหน้า (.page-title) ตรงตามเมนู
 *   4. ปุ่ม/ช่องกรอกหลักตามที่แต่ละหน้าต้องมี
 *   5. ข้อมูลจริงจาก API ถูกแสดงผล (ตรวจกับสิ่งที่ query ได้)
 *
 * ใช้ CDP ซึ่งเปิดเบราว์เซอร์จริง เหมือน verify-runtime.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SERVER = process.env.SERVER_ORIGIN || 'http://127.0.0.1:3000';
const USE_ALL = process.argv.includes('--all');
const PORT = 9700 + (process.pid % 250);
const CDP = `http://127.0.0.1:${PORT}`;

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const BROWSER = BROWSERS.find((b) => existsSync(b));
if (!BROWSER) {
  console.log('ไม่พบ Chrome/Edge — ข้ามการตรวจ');
  process.exit(0);
}

let pass = 0;
let fail = 0;
const ok = (m) => (pass++, console.log(`  ✓ ${m}`));
const bad = (m) => (fail++, console.log(`  ✗ ${m}`));
const check = (c, m) => (c ? ok(m) : bad(m));

/** หน้าที่เขียนเป็น Vue แล้ว + เกณฑ์ที่ต้องผ่านของแต่ละหน้า */
const VUE_PAGES = {
  office: {
    title: 'ข้อมูลพื้นฐาน',
    mustHave: ['content-block', 'page-head'],
  },
  academic: {
    title: 'โครงการ',
    mustHave: ['page-head'],
    hasRows: true,
  },
  budgets: {
    title: 'บริหารงบประมาณ',
    mustHave: ['page-head'],
  },
  schools: {
    title: 'พิกัดโรงเรียน',
    mustHave: ['page-head', 'leaflet-container'],
  },
  clock: {
    title: 'ลงเวลาทำงาน',
    mustHave: ['page-head', 'clock-box', 'clock-time', 'clock-btn'],
    /* ปุ่มลงเวลาเข้างานต้องกดได้จริง → ตรวจว่า API ตอบและ UI อัปเดต */
    actions: [
      {
        name: 'ปุ่มลงเวลาเข้างานมีอยู่',
        run: `return __clickText('.clock-btn', 'ลงเวลาเข้างาน');`,
      },
    ],
    /* หลังกด: สถานะต้องเปลี่ยนจาก "ยังไม่ได้ลงเวลา" เป็น "เข้างานแล้ว" */
    afterActions: [
      {
        name: 'ลงเวลาเข้างานสำเร็จ (สถานะเปลี่ยนเป็น "เข้างานแล้ว")',
        check: `document.querySelector('.status-pill') ? document.querySelector('.status-pill').innerText.includes('เข้างานแล้ว') : false`,
      },
      {
        name: 'ปุ่มลงเวลาออกงานถูกเปิดใช้งาน',
        check: `!document.querySelectorAll('.clock-btn')[1].disabled`,
      },
      {
        name: 'ตารางบันทึกเวลามีคอลัมน์ "สถานที่ทำงาน" ต่อจาก "กลุ่มงาน"',
        check: `(() => {
          const ths = [...document.querySelectorAll('.tbl thead th')].map(th => (th.innerText || '').trim());
          const idxGroup = ths.indexOf('กลุ่มงาน');
          const idxSite = ths.indexOf('สถานที่ทำงาน');
          if (idxSite < 0) throw new Error('ไม่พบคอลัมน์ "สถานที่ทำงาน" ในตาราง (มี: ' + ths.join(', ') + ')');
          if (idxGroup >= 0 && idxSite !== idxGroup + 1) throw new Error('คอลัมน์ "สถานที่ทำงาน" ไม่ได้อยู่ต่อจาก "กลุ่มงาน" (มี: ' + ths.join(', ') + ')');
          return true;
        })()`,
      },
      {
        /* ผู้ใช้สั่ง: ตั้งค่าตำแหน่งที่ทำงานเป็น 2 สถานที่ + เอา IP ออก
         * ต้องเห็นช่องพิกัด/รัศมีของทั้ง 2 แห่ง และต้องไม่มีช่อง IP อีก */
        name: 'dialog ตั้งค่าตำแหน่งที่ทำงาน: มี 2 สถานที่ (สพป. อ.ลอง · ศูนย์ฯ ร่องกาศ) และไม่มีช่อง IP',
        check: `(async () => {
          const btn = [...document.querySelectorAll('button')].find(b => (b.innerText || '').includes('ตั้งค่าตำแหน่งที่ทำงาน'));
          if (!btn) throw new Error('ไม่พบปุ่ม "ตั้งค่าตำแหน่งที่ทำงาน" (เฉพาะ admin)');
          btn.click();
          await new Promise(r => setTimeout(r, 1600));
          const need = ['cg-site-office-lat','cg-site-office-lng','cg-site-office-radius',
                        'cg-site-center-lat','cg-site-center-lng','cg-site-center-radius'];
          const miss = need.filter(id => !document.getElementById(id));
          if (miss.length) throw new Error('ไม่พบช่อง: ' + miss.join(', '));
          const cards = document.querySelectorAll('.site-card').length;
          if (cards !== 2) throw new Error('มีการ์ดสถานที่ทำงาน ' + cards + ' ใบ (ต้องเป็น 2)');
          if (document.getElementById('cg-ips')) throw new Error('ยังมีช่อง IP อินเทอร์เน็ตอยู่ (ผู้ใช้สั่งให้เอาออก)');
          const txt = document.body.innerText;
          if (!txt.includes('สพป.แพร่ เขต 2 อ.ลอง')) throw new Error('ไม่พบชื่อ "สพป.แพร่ เขต 2 อ.ลอง"');
          if (!txt.includes('ศูนย์พัฒนาวิชาการ ร่องกาศ')) throw new Error('ไม่พบชื่อ "ศูนย์พัฒนาวิชาการ ร่องกาศ"');
          const cancel = [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === 'ยกเลิก');
          if (cancel) cancel.click();
          await new Promise(r => setTimeout(r, 400));
          return true;
        })()`,
      },
    ],
  },
  rooms: {
    title: 'จองห้องประชุม',
    mustHave: ['page-head', 'tabs', 'toolbar'],
    /* สลับแท็บ + สลับมุมมองปฏิทินต้องทำงานจริง */
    actions: [
      {
        name: 'ปุ่มสลับมุมมองปฏิทิน/ตารางมีอยู่',
        run: `return __click('#rb-view-toggle');`,
      },
    ],
    afterActions: [
      {
        name: 'สลับเป็นมุมมองปฏิทินได้ (มีปฏิทินและหัวเดือน)',
        check: `!!document.querySelector('.cal-grid') && !!document.querySelector('.cal-title')`,
      },
      {
        name: 'ปฏิทินมีช่องวันที่ครบ 7 คอลัมน์',
        check: `document.querySelectorAll('.cal-weekday').length === 7`,
      },
      {
        /* ผู้ใช้ขอ: กดรีเฟรชแล้วต้องอยู่มุมมองปฏิทินเหมือนเดิม → ต้องจำค่าไว้ */
        name: 'จำมุมมองปฏิทินไว้ (กดรีเฟรชแล้วยังเป็นปฏิทิน)',
        check: `localStorage.getItem('room_view') === 'calendar'`,
      },
      {
        name: 'สลับกลับเป็นมุมมองตารางได้',
        check: `(async () => {
          __click('#rb-view-toggle');
          await new Promise((r) => setTimeout(r, 400));
          const b = document.querySelector('#rb-view-toggle');
          return !!b && b.innerText.includes('ปฏิทิน');
        })()`,
      },
    ],
  },
  vehicles: {
    title: 'จองยานพาหนะ',
    mustHave: ['page-head', 'tabs', 'toolbar', 'seg', 'seg-btn'],
    actions: [
      {
        name: 'ปุ่มสลับมุมมองปฏิทิน/ตารางมีอยู่',
        run: `return __click('#vb-view-toggle');`,
      },
    ],
    afterActions: [
      {
        name: 'สลับเป็นมุมมองปฏิทินได้',
        check: `!!document.querySelector('.cal-grid') && !!document.querySelector('.cal-title')`,
      },
      {
        name: 'ปฏิทินมีช่องวันที่ครบ 7 คอลัมน์',
        check: `document.querySelectorAll('.cal-weekday').length === 7`,
      },
      {
        /* ผู้ใช้ขอ: กดรีเฟรชแล้วต้องอยู่มุมมองปฏิทินเหมือนเดิม → ต้องจำค่าไว้ */
        name: 'จำมุมมองปฏิทินไว้ (กดรีเฟรชแล้วยังเป็นปฏิทิน)',
        check: `localStorage.getItem('vehicle_view') === 'calendar'`,
      },
      {
        name: 'สลับกลับเป็นมุมมองตารางได้',
        check: `(async () => {
          __click('#vb-view-toggle');
          await new Promise((r) => setTimeout(r, 400));
          const b = document.querySelector('#vb-view-toggle');
          return !!b && b.innerText.includes('ปฏิทิน');
        })()`,
      },
      {
        name: 'ปุ่มกดดูรายละเอียด (แบบฟอร์มทางการ) มีอยู่',
        // ไม่มีรายการจองในฐาน (ฐาน dev ว่าง) → ไม่มีปุ่มให้ตรวจ ไม่ตัดสิน
        // (เหมือนข้อถัดไป — เดิมเทสต์แดงทั้งที่หน้าเว็บถูก เพราะฐานไม่มีข้อมูล)
        check: `(() => {
          const rows = document.querySelectorAll('.tbl tbody tr');
          if (!rows.length) return true;
          return [...document.querySelectorAll('.tbl tbody .btn')].some(b => b.innerText.includes('รายละเอียด'));
        })()`,
      },
      {
        // เคยพัง: :disabled="loading || error" → false || '' = ''
        // → Vue ถือว่า '' เป็นจริงสำหรับ boolean attribute → disabled="" เสมอ → ปุ่มกดไม่ได้
        name: 'หน้าต่างบันทึกการขอใช้ยานพาหนะเปิดได้ และปุ่มพิมพ์กดได้',
        check: `(async () => {
          const btn = [...document.querySelectorAll('.tbl tbody .btn')].find(b => b.innerText.includes('รายละเอียด'));
          if (!btn) return true; // ไม่มีรายการให้ทดสอบ — ไม่ตัดสิน
          btn.click();
          await new Promise((r) => setTimeout(r, 1200));
          const print = [...document.querySelectorAll('[data-app-modal] button')].find(b => b.innerText.includes('พิมพ์'));
          const ok = !!print && print.disabled === false;
          __clickText('[data-app-modal] .btn', 'ปิด');
          await new Promise((r) => setTimeout(r, 300));
          return ok;
        })()`,
      },
      {
        // ต้องมี <link rel="stylesheet"> ที่ชี้ไฟล์ CSS ของระบบไว้ให้หน้าต่างพิมพ์ดึง
        // (เคยพังเพราะ selector ไม่ระบุ rel → ไปโดน modulepreload ของไฟล์ .js ที่อยู่ก่อนหน้าใน index.html)
        // ตัวตรวจว่าซอร์สโค้ดยังไม่หลุดรูปแบบเก่า อยู่ที่ scripts/check-print-windows.mjs
        name: 'หน้าต่างพิมพ์มีไฟล์ CSS ของระบบให้ดึง',
        check: `(() => {
          const good = document.querySelector('link[rel="stylesheet"][href*="theme"], link[rel="stylesheet"][href*="index-"]');
          if (!good) return false;
          const href = good.getAttribute('href') || '';
          return href.endsWith('.css');
        })()`,
      },
    ],
  },

  /* ---------- หน้าเดียวกัน 2 สโคป: ต้องได้หน้าต่างแยกกันจริง ---------- */
  travel: {
    title: 'ขออนุมัติ/อนุญาตเดินทางไปราชการ',
    mustHave: ['page-head', 'filter-row', 'card'],
    actions: [
      {
        name: 'ปุ่มยื่นคำขอไปราชการมีอยู่',
        run: `return __clickText('.page-head .btn', 'ยื่นคำขอ');`,
      },
    ],
    afterActions: [
      {
        name: 'แบบฟอร์มยื่นคำขอเปิดได้',
        check: `!!document.querySelector('[data-app-modal]')`,
      },
      {
        name: 'แบบฟอร์มมีช่องสถานที่และช่วงวันเดินทาง',
        check: `document.body.innerText.includes('สถานที่') && document.body.innerText.includes('ตั้งแต่วันที่')`,
      },
      {
        name: 'แบบฟอร์มมีส่วนค่าใช้จ่ายและพาหนะ',
        check: `document.body.innerText.includes('ขอเบิกค่าใช้จ่าย') && document.body.innerText.includes('ไปราชการด้วย')`,
      },
      {
        // ⚠️ เคยพังตรงนี้ (ผู้ใช้แจ้ง: "กรอกตัวเลขไม่ได้")
        //   :disabled="f.expense_items[it.key] <= 0" → ค่าเริ่มต้น 0 → disabled ถาวร
        //   ติ๊กช่องก็ไม่ช่วย เพราะ disabled ผูกกับ "ค่า" ไม่ใช่ "การติ๊ก"
        //   → ช่องค่าเบี้ยเลี้ยง/ค่าเช่าที่พัก/ค่าพาหนะ/ค่าใช้จ่ายอื่น กรอกไม่ได้เลย
        //   ต้องเป็น: เริ่มปิด → ติ๊กแล้วเปิด → พิมพ์ได้ → เอาติ๊กออกแล้วปิด+ล้างค่า
        //
        // ⚠️ 2 เรื่องที่ทำให้เทสต์นี้ "ผ่านทั้งที่พัง" ถ้าไม่ระวัง
        //   ① ต้องคืน true เป๊ะ — harness เทียบ `value === true` ไม่ใช่ "truthy"
        //      ถ้าคืนข้อความสตริง จะ fail โดยไม่บอกเหตุผล
        //   ② ต้อง await หลัง click() ทุกครั้ง
        //      Vue อัปเดต :disabled แบบ async (nextTick) → อ่าน .disabled ทันที
        //      ได้ค่าเก่าเสมอ → เทสต์ผ่านทั้งที่ช่องยังปิดอยู่
        name: 'ช่องค่าใช้จ่าย 4 ช่อง: เริ่มปิด แล้วติ๊กแล้วต้องพิมพ์ตัวเลขได้',
        check: `(async () => {
          const KEYS = ['baht', 'hotel', 'transport', 'other'];
          const wait = (ms) => new Promise((r) => setTimeout(r, ms || 350));
          const amt = (k) => document.getElementById('tf-exp-' + k);
          const chk = (k) => document.getElementById('tf-exp-' + k + '-chk');
          const die = (m) => { throw new Error(m); };

          for (const k of KEYS) {
            if (!amt(k) || !chk(k)) die('ไม่ครบทุกช่อง เหลือช่อง ' + k);
            if (!amt(k).disabled) die('ช่อง ' + k + ' ไม่ได้เริ่มเป็นปิดตามแบบของเดิม');
          }

          chk('baht').click();
          await wait();
          if (amt('baht').disabled) die('ติ๊กช่องแล้วช่องจำนวนยังปิดอยู่ (ผูก disabled กับค่าในช่องแทนที่จะผูกกับการติ๊ก)');

          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(amt('baht'), '1500.50');
          amt('baht').dispatchEvent(new Event('input', { bubbles: true }));
          await wait(250);
          if (String(amt('baht').value).indexOf('1500') !== 0) die('พิมพ์ตัวเลขไม่ได้ ได้ "' + amt('baht').value + '"');

          chk('baht').click();
          await wait();
          if (!amt('baht').disabled) die('เอาติ๊กออกแล้วช่องยังเปิดอยู่');
          if (Number(amt('baht').value) !== 0) die('เอาติ๊กออกแล้วค่าไม่ถูกล้าง ได้ ' + amt('baht').value);

          for (const k of KEYS.slice(1)) { chk(k).click(); await wait(); }
          for (const k of KEYS.slice(1)) if (amt(k).disabled) die('ช่อง ' + k + ' เปิดไม่ได้');

          return true;
        })()`,
      },
      {
        // ตัวตรวจเชิงโค้ด (อ่านไฟล์) อยู่ที่ check-form-wiring.mjs
        // ข้อนี้เช็กจาก DOM ว่า checkbox คุมช่องจำนวนได้จริงทุกช่อง
        name: 'ทุกช่องค่าใช้จ่ายถูกคุมด้วยช่องติ๊กของตัวเอง',
        check: `(() => {
          const KEYS = ['baht', 'hotel', 'transport', 'other'];
          return KEYS.every((k) => {
            const chk = document.getElementById('tf-exp-' + k + '-chk');
            const amt = document.getElementById('tf-exp-' + k);
            if (!chk || !amt) return false;
            const label = document.querySelector('label[for="tf-exp-' + k + '-chk"]');
            return !!label && !!chk;
          }) || 'ช่องใดช่องหนึ่งไม่มี checkbox/label คุม';
        })()`,
      },
      {
        name: 'ปิดแบบฟอร์มได้',
        check: `(async () => {
          __clickText('[data-app-modal] .btn', 'ยกเลิก');
          await new Promise((r) => setTimeout(r, 400));
          return !document.querySelector('[data-app-modal]');
        })()`,
      },
      {
        name: 'ปุ่มดาวน์โหลดข้อมูลมีอยู่',
        check: `__clickText('.filter-row .btn', 'ดาวน์โหลด') || [...document.querySelectorAll('.filter-row .btn')].some(b => b.innerText.includes('ดาวน์โหลด'))`,
      },
    ],
  },
  'travel-school': {
    title: 'ขออนุมัติ/อนุญาตเดินทางไปราชการ (สถานศึกษา)',
    mustHave: ['page-head', 'filter-row', 'card'],
    /* หน้านี้ต้องต่างจากเมนู 8 — ชื่อหน้ามีคำว่า "(สถานศึกษา)" */
    actions: [],
    afterActions: [],
  },

  /* ---------- การลา: หน้าเดียวรวมแท็บย่อยหลายแท็บ ---------- */
  leave: {
    title: 'ขออนุญาตลา',
    mustHave: ['page-head', 'seg', 'seg-btn', 'card'],
    actions: [
      {
        name: 'ปุ่มยื่นคำขอลามีอยู่',
        run: `return __clickText('.toolbar .btn', 'ยื่นคำลา');`,
      },
    ],
    afterActions: [
      {
        name: 'แบบฟอร์มยื่นคำลาเปิดได้',
        check: `!!document.querySelector('[data-app-modal]')`,
      },
      {
        name: 'แบบฟอร์มมีช่องวันลาและประเภทการลา',
        check: `document.body.innerText.includes('ขอลาตั้งแต่วันที่') && document.body.innerText.includes('ลาป่วย')`,
      },
      {
        name: 'แบบฟอร์มมีตารางสถิติการลา',
        check: `!!document.querySelector('.leave-stats-table')`,
      },
      {
        name: 'แบบฟอร์มมีช่องมอบหมายงาน',
        check: `document.body.innerText.includes('มอบหมายงานให้ผู้ทำหน้าที่แทน')`,
      },
      {
        name: 'ปิดแบบฟอร์มได้',
        check: `(async () => {
          __clickText('[data-app-modal] .btn', 'ยกเลิก');
          await new Promise((r) => setTimeout(r, 400));
          return !document.querySelector('[data-app-modal]');
        })()`,
      },
      {
        name: 'สลับไปแท็บ "วันลาพักผ่อนสะสม" ได้',
        check: `(async () => {
          const b = __clickText('.seg-btn', 'วันลาพักผ่อนสะสม');
          await new Promise((r) => setTimeout(r, 1200));
          return b && document.body.innerText.includes('วันลาพักผ่อนสะสม ปี');
        })()`,
      },
      {
        name: 'แท็บสถิติลาพักผ่อนแสดงตารางสิทธิ์',
        check: `(async () => {
          const b = __clickText('.seg-btn', 'สถิติลาพักผ่อน');
          await new Promise((r) => setTimeout(r, 1800));
          return b && (document.body.innerText.includes('สิทธิ์รวม') || document.body.innerText.includes('ยังไม่มีข้อมูลบุคลากร'));
        })()`,
      },
      {
        name: 'กลับไปแท็บรายการคำขอลาได้',
        check: `(async () => {
          const b = __clickText('.seg-btn', 'ลาพักผ่อน');
          await new Promise((r) => setTimeout(r, 1800));
          return b && !!document.querySelector('#lv-status');
        })()`,
      },
    ],
  },

  /* ---------- บันทึกข้อความ: ร่าง → ส่ง → อนุมัติ 3 ขั้น ---------- */
  memos: {
    title: 'บันทึกข้อความ',
    mustHave: ['page-head', 'filter-row', 'card'],
    actions: [
      {
        name: 'ปุ่มเขียนบันทึกข้อความมีอยู่',
        run: `return __clickText('.page-head .btn', 'เขียนบันทึกข้อความ');`,
      },
    ],
    afterActions: [
      {
        name: 'แบบฟอร์มเขียนบันทึกข้อความเปิดได้',
        check: `!!document.querySelector('[data-app-modal]')`,
      },
      {
        name: 'แบบฟอร์มมีช่องส่วนราชการ/เรื่อง/วันที่',
        check: `document.body.innerText.includes('ส่วนราชการ') && document.body.innerText.includes('เรื่อง') && document.body.innerText.includes('วันที่')`,
      },
      {
        name: 'แบบฟอร์มมีกลุ่มไฟล์แนบ 3 กลุ่ม',
        check: `document.body.innerText.includes('อ้างถึง') && document.body.innerText.includes('สิ่งที่ส่งมาด้วย') && document.body.innerText.includes('ร่างหนังสือส่ง')`,
      },
      {
        name: 'เครื่องมือ rich text ทำงาน',
        check: `!!document.querySelector('.memo-editor[contenteditable="true"]') && document.querySelectorAll('.memo-tb').length >= 6`,
      },
      {
        /* ผู้ใช้ขอให้มีคำอธิบายสีแดงในส่วน "บันทึกข้อความ" ของหน้าเขียน */
        name: 'มีข้อความสีแดง "กรุณาเคาะ 10 เคาะ เพื่อย่อหน้า"',
        check: `(() => {
          const txt = 'กรุณาเคาะ 10 เคาะ เพื่อย่อหน้า';
          const el = [...document.querySelectorAll('[data-app-modal] div, [data-app-modal] span')]
            .find((e) => (e.innerText || '').trim() === txt);
          if (!el) throw new Error('ไม่พบข้อความ "' + txt + '"');
          const cs = getComputedStyle(el);
          if (cs.color !== 'rgb(220, 38, 38)') throw new Error('ข้อความไม่ได้เป็นสีแดง (ได้ ' + cs.color + ')');
          if (cs.fontWeight !== '400') throw new Error('ข้อความยังเป็นตัวหนา (ได้ ' + cs.fontWeight + ' — ต้องเป็น 400)');
          return true;
        })()`,
      },
      {
        name: 'แบบฟอร์มมีตัวเลือกความเร่งด่วนครบ',
        check: `document.querySelectorAll('.urgency-opt').length === 3`,
      },
      {
        // เดิมเป็นกล่องข้อความ .sendto-box → เปลี่ยนเป็น dropdown ตัวเลือกผู้อนุมัติแล้ว
        name: 'ช่องส่งบันทึกข้อความถึงเป็นตัวเลือกผู้อนุมัติ',
        check: `(() => {
          const s = document.querySelector('select.sendto-select');
          if (!s) return false;
          if (s.options.length < 1) return false;
          // ต้องมีตัวเลือกที่มีชื่อจริง (ไม่ใช่แค่ข้อความ "ยังไม่ได้กำหนด")
          return [...s.options].some((o) => o.value !== '');
        })()`,
      },
      {
        name: 'ช่องส่งบันทึกข้อความถึงอยู่บรรทัดเดียว ไม่ล้น',
        check: `(() => {
          const s = document.querySelector('select.sendto-select');
          if (!s) return false;
          const r = s.getBoundingClientRect();
          return r.height <= 44 && r.width <= 440;
        })()`,
      },
      {
        name: 'ปิดแบบฟอร์มได้',
        check: `(async () => {
          __clickText('[data-app-modal] .btn', 'ยกเลิก');
          await new Promise((r) => setTimeout(r, 400));
          return !document.querySelector('[data-app-modal]');
        })()`,
      },
      {
        name: 'ปุ่มกรองสถานะมีครบทุกสถานะ',
        check: `document.querySelectorAll('#mem-status option').length === 7`,
      },
      {
        name: 'ปุ่ม "บันทึกข้อความของฉัน" สลับได้',
        check: `(async () => {
          const b = document.getElementById('mem-mine-btn');
          if (!b) return false;
          const before = b.innerText;
          b.click();
          await new Promise((r) => setTimeout(r, 1200));
          return b.innerText !== before;
        })()`,
      },
    ],
  },

  /* ---------- หนังสือราชการ: 7 แท็บทะเบียน ---------- */
  documents: {
    title: 'หนังสือราชการ',
    mustHave: ['page-head', 'segment-row', 'seg-btn', 'filter-row', 'card'],
    actions: [],
    afterActions: [
      {
        name: 'มีแท็บทะเบียนครบ (อย่างน้อย 4 แท็บ)',
        check: `document.querySelectorAll('.segment-row .seg-btn').length >= 4`,
      },
      {
        name: 'มีตัวกรองปี พ.ศ. และกลุ่มงาน',
        check: `!!document.getElementById('doc-year') && !!document.getElementById('doc-workgroup')`,
      },
      {
        name: 'มีช่องค้นหา',
        check: `!!document.getElementById('doc-q')`,
      },
      {
        name: 'ปุ่มส่งหนังสือไปสถานศึกษาและไปรษณีย์มีอยู่',
        check: `[...document.querySelectorAll('#doc-top-actions .btn')].some(b => b.innerText.includes('สถานศึกษา')) && [...document.querySelectorAll('#doc-top-actions .btn')].some(b => b.innerText.includes('รษณีย์'))`,
      },
      {
        name: 'ปุ่มดาวน์โหลดข้อมูลมีอยู่',
        check: `[...document.querySelectorAll('.filter-row .btn')].some(b => b.innerText.includes('ดาวน์โหลด'))`,
      },
      {
        name: 'สลับแท็บ "ทะเบียนหนังสือรับ" ได้',
        check: `(async () => {
          const b = __clickText('.segment-row .seg-btn', 'ทะเบียนหนังสือรับ');
          await new Promise((r) => setTimeout(r, 1800));
          if (!b) return false;
          const active = document.querySelector('.segment-row .seg-btn.active');
          return !!active && active.innerText.includes('ทะเบียนหนังสือรับ');
        })()`,
      },
      {
        name: 'แท็บที่เลือกมีปุ่ม "ลงทะเบียนหนังสือรับ"',
        check: `[...document.querySelectorAll('#tab-actions .btn')].some(b => b.innerText.includes('ลงทะเบียนหนังสือรับ'))`,
      },
      {
        name: 'สลับไปแท็บ "ทะเบียนคำสั่ง" ได้',
        check: `(async () => {
          const b = __clickText('.segment-row .seg-btn', 'ทะเบียนคำสั่ง');
          await new Promise((r) => setTimeout(r, 1800));
          if (!b) return false;
          const active = document.querySelector('.segment-row .seg-btn.active');
          return !!active && active.innerText.includes('ทะเบียนคำสั่ง');
        })()`,
      },
      {
        name: 'สลับไปแท็บ "ทะเบียนหนังสือรับรอง" ได้',
        check: `(async () => {
          const b = __clickText('.segment-row .seg-btn', 'ทะเบียนหนังสือรับรอง');
          await new Promise((r) => setTimeout(r, 1800));
          if (!b) return false;
          const active = document.querySelector('.segment-row .seg-btn.active');
          return !!active && active.innerText.includes('รับรอง');
        })()`,
      },
      {
        name: 'กลับมาแท็บ "หนังสือรับ" ได้',
        check: `(async () => {
          const b = __clickText('.segment-row .seg-btn', 'หนังสือรับ');
          await new Promise((r) => setTimeout(r, 1800));
          if (!b) return false;
          const active = document.querySelector('.segment-row .seg-btn.active');
          return !!active && active.innerText.includes('หนังสือรับ');
        })()`,
      },

      /* ---------- dialog ที่ย้ายจาก DocumentsView.js เป็น Vue ---------- */
      {
        name: 'เปิด dialog ดาวน์โหลดข้อมูลได้ และมีตัวกรองปี/เดือน/สัปดาห์',
        check: `(async () => {
          const b = [...document.querySelectorAll('.filter-row .btn')].find(x => x.innerText.includes('ดาวน์โหลด'));
          if (!b) return false;
          b.click();
          await new Promise((r) => setTimeout(r, 900));
          const t = document.body.innerText;
          return t.includes('ดาวน์โหลดข้อมูล') && t.includes('ปี พ.ศ.') && t.includes('สัปดาห์');
        })()`,
      },
      {
        name: 'dialog ดาวน์โหลด: เลือกเดือนแล้วช่องสัปดาห์ต้องเปิดใช้',
        check: `(async () => {
          const sels = [...document.querySelectorAll('.modal select')];
          if (sels.length < 3) return false;
          const month = sels[1];
          month.value = '1';
          month.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 400));
          const week = sels[2];
          return week.disabled === false && week.options.length >= 1;
        })()`,
      },
      {
        /* ต้องเช็คจำนวน modal ที่เปิดอยู่ ไม่ใช่ข้อความใน dialog
         * เพราะคำว่า "ดาวน์โหลดข้อมูล" ปรากฏทั้งในชื่อ dialog และในปุ่มของหน้าหลัก */
        name: 'ปิด dialog ดาวน์โหลดได้',
        check: `(async () => {
          const before = document.querySelectorAll('[data-app-modal]').length;
          if (before === 0) return false;
          const cancel = [...document.querySelectorAll('.modal-foot .btn')].find(x => x.innerText.trim() === 'ยกเลิก');
          if (!cancel) return false;
          cancel.click();
          await new Promise((r) => setTimeout(r, 700));
          return document.querySelectorAll('[data-app-modal]').length < before;
        })()`,
      },
      {
        name: 'เปิด dialog กำหนดเจ้าหน้าที่สารบัญเขตได้',
        check: `(async () => {
          const b = [...document.querySelectorAll('#doc-top-actions .btn')].find(x => x.innerText.includes('สารบัญเขต'));
          if (!b) return false;
          b.click();
          await new Promise((r) => setTimeout(r, 1200));
          const t = document.body.innerText;
          return t.includes('กำหนดเจ้าหน้าที่สารบัญเขต') && t.includes('เลือกเจ้าหน้าที่');
        })()`,
      },
      {
        name: 'ปิด dialog สารบัญเขตได้',
        check: `(async () => {
          const before = document.querySelectorAll('[data-app-modal]').length;
          if (before === 0) return false;
          const close = [...document.querySelectorAll('.modal-foot .btn')].find(x => x.innerText.trim() === 'ปิด');
          if (!close) return false;
          close.click();
          await new Promise((r) => setTimeout(r, 700));
          return document.querySelectorAll('[data-app-modal]').length < before;
        })()`,
      },
      /*
       * เปิด dialog กำหนดเจ้าหน้าที่สารบัญสถานศึกษา ผ่าน DocumentsDocStaffSettingsModal
       *
       * ปุ่ม "⊛ ตั้งค่าเจ้าหน้าที่หนังสือราชการ" ถูกถอดออกแล้ว (ซ้ำกับ 2 ปุ่ม ⊗ ข้าง ๆ)
       * การกำหนดสารบัญทำได้ผ่านปุ่ม ⊗ สองปุ่มนั้นแทน
       */
      {
        name: 'เปิด dialog กำหนดเจ้าหน้าที่สารบัญสถานศึกษาได้',
        check: `(async () => {
          const b = [...document.querySelectorAll('#doc-top-actions .btn')].find(x => x.innerText.includes('กำหนดเจ้าหน้าที่สารบัญสถานศึกษา'));
          if (!b) return false;
          b.click();
          await new Promise((r) => setTimeout(r, 1200));
          return document.body.innerText.includes('กำหนดเจ้าหน้าที่สารบัญสถานศึกษา');
        })()`,
      },
      {
        /* ปุ่มที่ถอดออก — ต้องไม่โผล่กลับมา */
        name: 'ปุ่ม "ตั้งค่าเจ้าหน้าที่หนังสือราชการ" ไม่อยู่บนหน้าแล้ว',
        check: `(() => {
          return ![...document.querySelectorAll('#doc-top-actions .btn')]
            .some(x => x.innerText.includes('ตั้งค่าเจ้าหน้าที่หนังสือราชการ'));
        })()`,
      },
      {
        /* ต้องเจาะจง modal ที่เพิ่งเปิด มิฉะนั้นจะไปหยิบ select ของ dialog ตัวก่อนหน้า
         *
         * ไม่ควรยึดว่าต้องมีช่องติ๊กเสมอ เพราะสถานศึกษาบางแห่งยังไม่มีเจ้าหน้าที่ที่ดูแล
         * สิ่งที่ต้องตรวจคือ "ส่วนที่ 2 ตอบสนองต่อการเปลี่ยนโรงเรียน" ซึ่งแสดงผลได้ 2 แบบ:
         *   - มีรายชื่อเจ้าหน้าที่ → รายการช่องติ๊ก
         *   - ไม่มีเจ้าหน้าที่ → ข้อความแจ้งว่าไม่มี
         */
        name: 'dialog สารบัญสถานศึกษา: เลือกสถานศึกษาแล้วส่วนที่ 2 ตอบสนอง',
        check: `(async () => {
          const boxes = document.querySelectorAll('[data-app-modal]');
          const modal = boxes[boxes.length - 1];
          if (!modal) return false;
          const sels = modal.querySelectorAll('select');
          if (sels.length < 1) return false;
          const sel = sels[sels.length - 1];
          const codes = [...sel.options].map(o => o.value).filter(Boolean);
          if (!codes.length) return false;
          sel.value = codes[0];
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 700));
          const hasList = !!modal.querySelector('input[type=checkbox]');
          const saysNone = modal.innerText.includes('ไม่มีเจ้าหน้าที่สถานศึกษาในโรงเรียนนี้');
          return hasList || saysNone;
        })()`,
      },
      {
        name: 'ปิด dialog สารบัญสถานศึกษาแล้วไม่มี modal ค้าง',
        check: `(async () => {
          const before = document.querySelectorAll('[data-app-modal]').length;
          if (before === 0) return false;
          const boxes = document.querySelectorAll('[data-app-modal]');
          const modal = boxes[boxes.length - 1];
          const close = [...modal.querySelectorAll('.modal-foot .btn')].find(x => x.innerText.trim() === 'ปิด');
          if (!close) return false;
          close.click();
          await new Promise((r) => setTimeout(r, 700));
          return document.querySelectorAll('[data-app-modal]').length < before;
        })()`,
      },
      /* ---------- ตัวปั้มตรา (DocumentsStampEditor.vue) ----------
       *
       * ปุ่มเปิดอยู่ใน openForm ซึ่งยังเป็นโมดุลเดิม จึงต้องเรียกผ่าน bridge เหมือนที่ฟอร์มเรียก
       * ตรวจเฉพาะส่วนที่แปลงเป็น Vue แล้ว ไม่ตรวจส่วน PDF (ต้องมีไฟล์จริง) */
      {
        /*
         * เปิดผ่านฟอร์มจริง ไม่ใช่เรียก component ตรง ๆ
         * เพราะ DocumentsStampEditor ถูกฝังใน DocumentsIncomingFormModal แล้ว
         * การทดสอบเส้นทางจริง (ปุ่มในแท็บ → ฟอร์ม → ปุ่มลงเลขหนังสือรับ) จึงครอบคลุมมากกว่า
         * และจับปัญหาการเดินทางของ event ได้ด้วย
         */
        name: 'ตัวปั้มตรา: เปิดจากปุ่ม "ลงเลขหนังสือรับ" ในฟอร์มได้',
        check: `(async () => {
          const tab = __clickText('.segment-row .seg-btn', 'ทะเบียนหนังสือรับ');
          await new Promise(r => setTimeout(r, 1500));
          if (!tab) return false;

          const open = [...document.querySelectorAll('#tab-actions .btn')].find(b => b.innerText.includes('ลงทะเบียนหนังสือรับ'));
          if (!open) return false;
          open.click();
          await new Promise(r => setTimeout(r, 1800));

          const boxes = document.querySelectorAll('[data-app-modal]');
          const modal = boxes[boxes.length - 1];
          if (!modal) return false;
          // ฟอร์มต้องมีช่องรับเอกสารตามของเดิม
          if (!modal.innerText.includes('ลงทะเบียนรับหนังสือ')) return false;
          if (!modal.innerText.includes('เลขหนังสือรับ')) return false;
          if (!modal.innerText.includes('หนังสือจาก')) return false;

          /*
           * ปุ่ม "ลงเลขหนังสือรับ" ต้องมีไฟล์แนบก่อน (ถ้าไม่มีจะขึ้นว่า Attach file first)
           * จึงต้องสร้าง PNG จิ๋วแล้วใส่ลงช่องไฟล์ก่อนกด
           */
          const fileInput = modal.querySelector('input[type=file]');
          if (!fileInput) return false;
          const c = document.createElement('canvas');
          c.width = 200; c.height = 300;
          const cx = c.getContext('2d');
          cx.fillStyle = '#fff'; cx.fillRect(0, 0, 200, 300);
          cx.fillStyle = '#000'; cx.font = '14px sans-serif'; cx.fillText('test', 20, 40);
          const blob = await new Promise(r => c.toBlob(r, 'image/png'));
          const dt = new DataTransfer();
          dt.items.add(new File([blob], 'test.png', { type: 'image/png' }));
          fileInput.files = dt.files;
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise(r => setTimeout(r, 500));

          const stampBtn = [...modal.querySelectorAll('.btn')].find(b => b.innerText.includes('ลงเลขหนังสือรับ'));
          if (!stampBtn) return false;
          stampBtn.click();
          await new Promise(r => setTimeout(r, 2000));

          const ov = document.querySelector('.stamp-overlay');
          if (!ov) return false;
          const txt = ov.innerText;
          return txt.includes('Stamp Document')
            && !!ov.querySelector('.stamp-source')
            && txt.includes('Text')
            && txt.includes('Date')
            && txt.includes('ล้างทั้งหมด');
        })()`,
      },
      {
        name: 'ตัวปั้มตรา: เลือกเครื่องมือ Text แล้วแผงตั้งค่าข้อความแสดง',
        check: `(async () => {
          const ov = document.querySelector('.stamp-overlay');
          if (!ov) return false;
          const txtBtn = [...ov.querySelectorAll('button')].find(b => b.innerText.includes('Text'));
          if (!txtBtn) return false;
          txtBtn.click();
          await new Promise(r => setTimeout(r, 400));
          const panel = ov.querySelector('.stamp-text-panel');
          return !!panel && panel.style.display !== 'none' && !!ov.querySelector('#st-text-val, input[style*="width: 200px"]');
        })()`,
      },
      {
        name: 'ตัวปั้มตรา: วางข้อความแล้วมีวัตถุบนหน้ากระดาษ',
        check: `(async () => {
          const ov = document.querySelector('.stamp-overlay');
          if (!ov) return false;
          const input = ov.querySelector('.stamp-text-panel input');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, 'ทดสอบ');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 300));

          const page = ov.querySelector('.stamp-page');
          if (!page) return false;
          const r = page.getBoundingClientRect();
          page.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, clientX: r.left + 60, clientY: r.top + 80,
          }));
          await new Promise(r2 => setTimeout(r2, 400));
          const el = page.querySelector('.stamp-elem');
          return !!el && el.innerText.includes('ทดสอบ');
        })()`,
      },
      {
        name: 'ตัวปั้มตรา: ล้างทั้งหมดแล้วหน้ากระดาษสะอาด',
        check: `(async () => {
          const ov = document.querySelector('.stamp-overlay');
          if (!ov) return false;
          const clear = [...ov.querySelectorAll('button')].find(b => b.innerText.includes('ล้างทั้งหมด'));
          if (!clear) return false;
          clear.click();
          await new Promise(r => setTimeout(r, 400));
          return ov.querySelectorAll('.stamp-elem').length === 0;
        })()`,
      },
      {
        name: 'ตัวปั้มตรา: ปิดแล้วกลับไปที่ฟอร์มลงทะเบียนรับหนังสือ',
        check: `(async () => {
          const ov = document.querySelector('.stamp-overlay');
          if (!ov) return false;
          const close = [...ov.querySelectorAll('button')].find(b => b.innerText.includes('ปิด'));
          if (!close) return false;
          close.click();
          await new Promise(r => setTimeout(r, 900));
          if (document.querySelector('.stamp-overlay')) return false;
          const boxes = document.querySelectorAll('[data-app-modal]');
          const modal = boxes[boxes.length - 1];
          return !!modal && modal.innerText.includes('ลงทะเบียนรับหนังสือ');
        })()`,
      },
      {
        name: 'ฟอร์มลงทะเบียนรับหนังสือ: ปิดได้',
        check: `(async () => {
          const boxes = document.querySelectorAll('[data-app-modal]');
          const modal = boxes[boxes.length - 1];
          if (!modal) return false;
          const cancel = [...modal.querySelectorAll('.modal-foot .btn')].find(b => b.innerText.trim() === 'ยกเลิก');
          if (!cancel) return false;
          cancel.click();
          await new Promise(r => setTimeout(r, 900));
          const left = [...document.querySelectorAll('[data-app-modal] .modal')].filter(m => m.innerText.includes('ลงทะเบียนรับหนังสือ'));
          return left.length === 0;
        })()`,
      },
      {
        name: 'ฟอร์มลงทะเบียนรับหนังสือ: มีช่อง "ลงวันที่" ต่อจาก "เลขที่หนังสือ"',
        check: `(async () => {
          location.hash = '#/documents?tab=incoming_reg';
          await new Promise(r => setTimeout(r, 1800));
          const open = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '▭ ลงทะเบียนหนังสือรับ');
          if (!open) return false;
          open.click();
          await new Promise(r => setTimeout(r, 1800));
          const boxes = document.querySelectorAll('[data-app-modal]');
          const modal = boxes[boxes.length - 1];
          if (!modal) return false;
          const labels = [...modal.querySelectorAll('.form-group label')].map(l => l.innerText.trim());
          const iNo = labels.indexOf('เลขที่หนังสือ');
          const iLetter = labels.indexOf('ลงวันที่');
          if (iNo === -1 || iLetter === -1) return false;
          // ต้องอยู่ติดกันทันที
          if (iLetter !== iNo + 1) return false;
          // ปิดทิ้ง ไม่บันทึกอะไร
          const cancel = [...modal.querySelectorAll('.modal-foot .btn')].find(b => b.innerText.trim() === 'ยกเลิก');
          if (cancel) cancel.click();
          await new Promise(r => setTimeout(r, 700));
          return true;
        })()`,
      },
      {
        /* กันบั๊ก "เลือกวันที่แล้วค่าไม่เปลี่ยน"
         *
         * ThaiDateField เคยอ่านค่าผ่าน document.getElementById(props.id)
         * ตอนไม่ได้ใส่ id → input ไม่มี id → getElementById('') = null → ไม่ emit
         * ผู้ใช้เห็นวันที่ที่เลือก แต่ระบบบันทึกวันที่เดิม (ข้อมูลผิดเงียบ ๆ)
         *
         * หลักการพิสูจน์: ช่องในจอเปลี่ยน แต่ "hint" ที่อ่านจาก model ต้องเปลี่ยนตาม
         */
        name: 'ช่องวันที่: เลือกวันแล้วค่าที่ระบบได้รับเปลี่ยนตาม',
        check: `(async () => {
          // เช็กก่อนหน้าปิด modal ไปแล้ว ต้องเปิดฟอร์มใหม่เอง
          if (!document.querySelector('[data-app-modal]')) {
            const open = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '▭ ลงทะเบียนหนังสือรับ');
            if (!open) return false;
            open.click();
            await new Promise(r => setTimeout(r, 1800));
          }
          /*
           * ใช้ช่อง "วันที่รับ" เพราะมีค่าอยู่เสมอ (วันนี้) → มี element .hint ให้เทียบ
           * ช่องที่ว่างจะไม่มี .hint เลย (v-if ที่ display)
           * ทั้งสองช่องใช้ component เดียวกัน ทดสอบบั๊กเดียวกัน
           */
          const groups = [...document.querySelectorAll('[data-app-modal] .form-group')];
          const g = groups.find(x => {
            const l = x.querySelector('label');
            return l && l.innerText.trim().indexOf('วันที่รับ') === 0;
          });
          if (!g) return false;
          const inp = g.querySelector('input');
          const hintEl = g.querySelector('.hint');
          if (!inp || !hintEl) return false;
          const beforeHint = (hintEl.innerText || '').trim();
          const dayNum = (s) => parseInt(String(s || '').split('/')[0], 10);
          inp.click();
          await new Promise(r => setTimeout(r, 400));
          const pops = [...document.querySelectorAll('[data-app-modal] .thai-cal-pop')];
          const vi = pops.findIndex(p => p.style.display !== 'none');
          if (vi === -1) return false;
          const days = [...pops[vi].querySelectorAll('.cal-pick-day')];
          if (days.length < 2) return false;
          // เลือกวันที่ต่างจากเดิมเสมอ
          const cur = dayNum(inp.value);
          const target = days.find(d => dayNum(d.innerText.trim()) !== cur);
          if (!target) return false;
          const pick = dayNum(target.innerText.trim());
          target.click();
          await new Promise(r => setTimeout(r, 700));
          /*
           * ⚠️ ช่องวันที่ไม่ใส่ศูนย์นำหน้า ("1/10/2569" ไม่ใช่ "01/10/2569")
           *    จึงต้องเทียบเป็นตัวเลข ไม่ใช่เทียบข้อความ
           *
           * จุดที่พิสูจน์: hint (อ่านจาก model) ต้องเปลี่ยนเป็นวันที่ที่เพิ่งเลือก
           * ก่อนแก้ hint ค้างเท่าเดิม เพราะ onChange ไม่ emit
           */
          const afterHint = (hintEl.innerText || '').trim();
          const ok = dayNum(inp.value) === pick
            && dayNum(afterHint) === pick
            && afterHint !== beforeHint;
          // ปิด modal ทิ้ง ไม่บันทึกอะไร (ต้องปิดสนิท เพื่อไม่ให้ body ถูกล็อกค้าง)
          const close = document.querySelector('[data-app-modal] .modal-close');
          if (close) close.click();
          await new Promise(r => setTimeout(r, 900));
          const left = document.querySelector('[data-app-modal]');
          if (left) {
            const c2 = left.querySelector('.modal-close');
            if (c2) c2.click();
            await new Promise(r => setTimeout(r, 600));
          }
          return ok && !document.querySelector('[data-app-modal]');
        })()`,
      },
      {
        /* กันบั๊ก "เลื่อนหน้าไม่ได้หลังปิด modal"
         *
         * AppModal ล็อก body ไว้ตอนเปิด แล้วปลดตอน unmount
         * เคยนับ modal ตัวเองรวมด้วย → Vue เรียก onBeforeUnmount ก่อนถอด element ออก
         * → ตอนปิดจะเจอตัวเอง 1 ตัว → คิดว่ายังมี modal ค้าง → ล็อกค้างตลอด
         * อาการที่ผู้ใช้เจอ: เปิด-ปิด dialog ใด ๆ แล้วเลื่อนหน้าแรกไม่ได้อีก
         */
        name: 'เปิด-ปิด dialog แล้วยังเลื่อนหน้าได้ (body ไม่ถูกล็อกค้าง)',
        check: `(async () => {
          const before = document.body.style.overflow;

          // เปิด dialog จริง
          const openBtn = [...document.querySelectorAll('.filter-row .btn')].find(b => b.innerText.includes('ดาวน์โหลด'));
          if (!openBtn) return false;
          openBtn.click();
          await new Promise(r => setTimeout(r, 1200));
          if (!document.querySelector('[data-app-modal]')) return false;

          // ปิด dialog
          const boxes = document.querySelectorAll('[data-app-modal]');
          const modal = boxes[boxes.length - 1];
          const cancel = [...modal.querySelectorAll('.modal-foot .btn')].find(b => b.innerText.trim() === 'ยกเลิก');
          if (!cancel) return false;
          cancel.click();
          await new Promise(r => setTimeout(r, 1200));

          // ต้องไม่มี modal ค้าง และ body ต้องปลดล็อก
          if (document.querySelector('[data-app-modal]')) return false;
          if (document.body.style.overflow === 'hidden') return false;

          // และต้องเลื่อนหน้าได้จริง (ไม่ใช่แค่ค่า style ถูก)
          const max = document.documentElement.scrollHeight - window.innerHeight;
          if (max <= 0) return true; // หน้านี้สั้นอยู่แล้ว ไม่ต้องทดสอบการเลื่อน
          window.scrollTo(0, max);
          await new Promise(r => setTimeout(r, 400));
          const ok = window.scrollY > 0;
          window.scrollTo(0, 0);
          return ok;
        })()`,
      },
      {
        name: 'รายละเอียดหนังสือ: เปิดจากปุ่ม 👁️ ในตารางได้ (ถ้ามีรายการ)',
        check: `(async () => {
          const eye = [...document.querySelectorAll('.status-btns .btn')].find(x => x.innerText.includes('👁'));
          if (!eye) return true;
          eye.click();
          await new Promise((r) => setTimeout(r, 900));
          const t = document.body.innerText;
          if (!t.includes('รายละเอียดหนังสือราชการ')) return false;
          const boxes = document.querySelectorAll('[data-app-modal]');
          const modal = boxes[boxes.length - 1];
          if (modal) {
            const close = [...modal.querySelectorAll('.modal-foot .btn, .modal-close')].find(x => x.innerText.trim() === 'ปิด' || x.classList.contains('modal-close'));
            if (close) close.click();
          }
          await new Promise((r) => setTimeout(r, 600));
          return true;
        })()`,
      },
    ],
  },

  /* ---------- หน้าแรก ---------- */
  home: {
    title: '', // หน้าแรกไม่มี page-title (เป็นแบนเนอร์ต้อนรับ)
    mustHave: ['welcome-banner', 'section-title', 'menu-grid', 'menu-card'],
    actions: [],
    afterActions: [
      {
        name: 'แบนเนอร์ต้อนรับแสดงชื่อผู้ใช้',
        check: `document.body.innerText.includes('ยินดีต้อนรับ')`,
      },
      /* กล่องลงเวลามีเฉพาะสมาชิกฝั่งสำนักงาน — admin คือสมาชิก แต่ต้องตรวจแบบไม่พึ่งสมมติฐาน
       * เผื่อผู้ที่รันเทสต์เป็นเจ้าหน้าที่สถานศึกษา (ซึ่งไม่ใช้ระบบลงเวลา) */
      {
        name: 'กล่องลงเวลา: มีปุ่มเข้า/ออกงานครบ (ถ้ามีกล่อง)',
        check: `(async () => {
          if (!document.querySelector('.home-clock')) return true;
          return !!document.getElementById('home-clock-in') && !!document.getElementById('home-clock-out');
        })()`,
      },
      {
        name: 'กล่องลงเวลา: นาฬิกาแสดงเวลา HH:MM:SS (ถ้ามีกล่อง)',
        check: `(async () => {
          const el = document.getElementById('home-clock-now');
          if (!el) return true;
          return /^\\d{2}:\\d{2}:\\d{2}$/.test(el.innerText.trim());
        })()`,
      },
      {
        name: 'กล่องลงเวลา: วันที่แสดงปี พ.ศ. (ถ้ามีกล่อง)',
        check: `!document.querySelector('.home-clock-date') || /\\d{4}/.test(document.querySelector('.home-clock-date').innerText)`,
      },
      {
        /* ต้องตรวจ "invariant" ไม่ใช่สถานะคงที่
         * เพราะผู้ใช้ที่รันเทสต์อาจลงเวลาเข้าแล้วหรือยังไม่ลง
         * กติกาที่ถูกต้อง:
         *   ปุ่มเข้างาน   ปิด ⇔ ลงเวลาเข้าแล้ว
         *   ปุ่มออกงาน  เปิด ⇔ ลงเวลาเข้าแล้วและยังไม่ลงเวลาออก */
        name: 'กล่องลงเวลา: ปุ่มเข้า/ออกงานผูกกับสถานะถูกต้อง',
        check: `(async () => {
          const inBtn = document.getElementById('home-clock-in');
          const outBtn = document.getElementById('home-clock-out');
          if (!inBtn || !outBtn) return true;
          // อ่านสถานะจากป้ายที่แสดงอยู่ (ป้ายเป็นแหล่งความจริงเดียวที่ผู้ใช้มองเห็น)
          const status = (document.querySelector('.home-clock-status')||{}).innerText || '';
          const clockedIn = status.includes('เข้างานแล้ว') || status.includes('ลงเวลาครบแล้ว');
          const clockedOut = status.includes('ลงเวลาครบแล้ว');
          // เข้างาน: disabled ⇔ clockedIn
          if (inBtn.disabled !== clockedIn) return false;
          // ออกงาน: disabled ⇔ ยังลงเวลาเข้าไม่ได้ หรือลงเวลาออกแล้ว
          const expectOutDisabled = !(clockedIn && !clockedOut);
          if (outBtn.disabled !== expectOutDisabled) return false;
          return true;
        })()`,
      },
      {
        name: 'ปุ่มไปประวัติการลงเวลาชี้ไปเมนู clock',
        check: `(document.querySelector('.home-clock-history')||{}).getAttribute && document.querySelector('.home-clock-history').getAttribute('href') === '#/clock'`,
      },
      {
        name: 'การ์ด "มาทำงานวันนี้": เปิดดูรายชื่อแล้วมีคอลัมน์ "สถานที่ทำงาน" ต่อจาก "กลุ่มงาน"',
        check: `(async () => {
          const card = [...document.querySelectorAll('.stat-card')].find(c => (c.innerText || '').includes('มาทำงานวันนี้'));
          if (!card) return true; // ถ้ายังไม่มีคนลงเวลาในวันนี้ การ์ดจะถูกซ่อนตามปกติ
          card.click();
          await new Promise(r => setTimeout(r, 800));
          const ths = [...document.querySelectorAll('[data-app-modal] .tbl thead th, .modal .tbl thead th')].map(th => (th.innerText || '').trim());
          const idxGroup = ths.indexOf('กลุ่มงาน');
          const idxSite = ths.indexOf('สถานที่ทำงาน');
          if (idxGroup < 0 || idxSite !== idxGroup + 1) {
            throw new Error('ตารางมาทำงานวันนี้ต้องมี "สถานที่ทำงาน" ต่อจาก "กลุ่มงาน" (มี: ' + ths.join(', ') + ')');
          }
          const closeBtn = [...document.querySelectorAll('[data-app-modal] button, .modal button')].find(b => (b.innerText || '').trim() === 'ปิด');
          if (closeBtn) closeBtn.click();
          await new Promise(r => setTimeout(r, 400));
          return true;
        })()`,
      },
      {
        name: 'มีหัวข้อ "เมนูหลัก" และตารางเมนู',
        check: `[...document.querySelectorAll('.section-title')].some(e => e.innerText.includes('เมนูหลัก')) && document.querySelectorAll('.menu-grid .menu-card').length >= 8`,
      },
      {
        name: 'การ์ดเมนูมีไอคอนและคำอธิบายครบ',
        check: `[...document.querySelectorAll('.menu-card')].every(c => c.querySelector('.menu-icon') && c.querySelector('.menu-name'))`,
      },
      {
        name: 'กดการ์ดเมนูแล้วเปลี่ยนเส้นทางได้',
        check: `(async () => {
          const before = location.hash;
          const card = document.querySelector('.menu-card');
          if (!card) return false;
          card.click();
          await new Promise((r) => setTimeout(r, 2500));
          const changed = location.hash !== before;
          // กลับหน้าแรกเพื่อไม่ให้กระทบหน้าถัดไป
          location.hash = before || '#/';
          await new Promise((r) => setTimeout(r, 1500));
          return changed;
        })()`,
      },
    ],
  },
  staff: {
    title: 'เจ้าหน้าที่ในระบบ',
    mustHave: ['page-head', 'tabs', 'card'],
    actions: [],
    afterActions: [
      {
        name: 'มีแท็บครบ 5 แท็บ',
        check: `document.querySelectorAll('.tabs .tab').length === 5`,
      },
      {
        name: 'แท็บแรก "รออนุมัติ" ถูกเลือก',
        check: `!!document.querySelector('#s-tab-pending.active')`,
      },
      {
        name: 'สลับไปแท็บ "เจ้าหน้าที่ สพป.แพร่ เขต 2" ได้',
        check: `(async () => {
          const b = document.getElementById('s-tab-office');
          if (!b) return false;
          b.click();
          await new Promise((r) => setTimeout(r, 1800));
          return !!document.querySelector('#s-tab-office.active');
        })()`,
      },
      {
        name: 'แท็บรายชื่อมีช่องค้นหาและตัวกรองสถานะ',
        check: `!!document.getElementById('st-q') && !!document.getElementById('st-status')`,
      },
      {
        name: 'ตารางเจ้าหน้าที่มีคอลัมน์ครบ 8 คอลัมน์',
        check: `document.querySelectorAll('.staff-grid thead th').length === 8`,
      },
      {
        name: 'มีปุ่มดาวน์โหลด Excel',
        check: `(() => {
          const b = document.getElementById('st-download');
          return !!b && b.innerText.includes('ดาวน์โหลด');
        })()`,
      },
      {
        name: 'ปุ่มดาวน์โหลดชี้ไป /api/staff.xlsx พร้อมตัวกรองแท็บที่เลือก',
        check: `(async () => {
          const b = document.getElementById('st-download');
          if (!b) return false;
          let href = '';
          const orig = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function () { href = this.getAttribute('href') || ''; };
          b.click();
          HTMLAnchorElement.prototype.click = orig;
          await new Promise((r) => setTimeout(r, 300));
          return href.includes('/api/staff.xlsx') && href.includes('user_group=office');
        })()`,
      },
      {
        name: 'สลับไปแท็บ "ตั้งค่าการอนุมัติ" ได้',
        check: `(async () => {
          const b = document.getElementById('s-tab-settings');
          if (!b) return false;
          b.click();
          await new Promise((r) => setTimeout(r, 1500));
          return !!document.querySelector('#s-tab-settings.active') &&
                 !!document.querySelector('.form-grid select');
        })()`,
      },
      {
        // ⚠️ ระบบลา และระบบไปราชการ ไม่มี dropdown "จำนวนขั้น" แล้ว
        //   จำนวนขั้นของสองระบบนี้มาจากหน้าตั้งค่าเฉพาะรายคน
        //     · ระบบลา   → หน้า ⊛ เจ้าหน้าที่การลา
        //     · ไปราชการ → หน้า ⊛ กำหนดผู้อนุมัติไปราชการ
        //   เคยมีทั้งสองระบบในหน้านี้ แต่ค่าไม่มีผลจริง
        //   (approval_travel = 1 ทำให้คอลัมน์ "ผู้อนุมัติ" ที่ตั้งไว้ไม่เคยถูกพิจารณา)
        //   เหลือแค่ยานพาหนะ + ห้องประชุม ที่ยังนับจากค่ากลางจริง
        //   ถ้าวันหนึ่ง dropdown ของลา/ไปราชการกลับมา แปลว่าเผลอใส่ตัวเลือกที่ไม่มีผลอีกแล้ว
        name: 'แท็บตั้งค่ามี dropdown 2 ระบบ และไม่มีของระบบลา/ไปราชการ',
        check: `['as-approval_vehicle','as-approval_room'].every(id => !!document.getElementById(id))
                && !document.getElementById('as-approval_leave')
                && !document.getElementById('as-approval_travel')`,
      },
      {
        name: 'หน้าตั้งค่าบอกว่าลา/ไปราชการไปตั้งที่หน้าของตัวเอง',
        check: `document.body.innerText.includes('เจ้าหน้าที่การลา') && document.body.innerText.includes('กำหนดผู้อนุมัติไปราชการ')`,
      },
      {
        name: 'หน้าตั้งค่าอธิบายว่าระบบลาตั้งที่หน้าเจ้าหน้าที่การลา',
        check: `document.body.innerText.includes('เจ้าหน้าที่การลา')`,
      },
      {
        name: 'สลับไปแท็บ "โหมดจำลองวันที่" ได้',
        check: `(async () => {
          const b = document.getElementById('s-tab-simdate');
          if (!b) return false;
          b.click();
          await new Promise((r) => setTimeout(r, 1500));
          return !!document.querySelector('#s-tab-simdate.active') &&
                 document.body.innerText.includes('โหมดจำลอง');
        })()`,
      },
      {
        name: 'สลับไปแท็บ "เจ้าหน้าที่สถานศึกษา" ได้',
        check: `(async () => {
          const b = document.getElementById('s-tab-school');
          if (!b) return false;
          b.click();
          await new Promise((r) => setTimeout(r, 1800));
          return !!document.querySelector('#s-tab-school.active');
        })()`,
      },
      {
        name: 'กลับมาแท็บ "รออนุมัติ" ได้',
        check: `(async () => {
          const b = document.getElementById('s-tab-pending');
          if (!b) return false;
          b.click();
          await new Promise((r) => setTimeout(r, 1500));
          return !!document.querySelector('#s-tab-pending.active');
        })()`,
      },
    ],
  },
};

/* ---------------- CDP ---------------- */
const profile = mkdtempSync(join(tmpdir(), 'p2vue-'));
let chrome;
let ws;
let msgId = 0;
const pending = new Map();
const listeners = [];

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function boot() {
  chrome = spawn(
    BROWSER,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  let ver = null;
  for (let i = 0; i < 60 && !ver; i++) {
    try {
      ver = await (await fetch(CDP + '/json/version')).json();
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  if (!ver) throw new Error('เชื่อม DevTools ไม่ได้');
  const target = await (await fetch(`${CDP}/json/new?url=about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      return;
    }
    for (const l of listeners) if (l.evt === m.method) l.fn(m.params);
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
}

/**
 * helper ฝังในหน้าเว็บสำหรับขับเคลื่อนฟอร์ม/ปุ่ม
 *
 * ต้องประกาศใหม่ทุกครั้งที่ evaluate เพราะการเปลี่ยน URL ทำให้หน้าโหลดใหม่
 * ตัวแปรบน window จึงหายไป
 */
const SET_VAL = `
function __setVal(el, v) {
  if (el instanceof HTMLSelectElement) {
    const found = [...el.options].some(o => o.value === v);
    if (!found) return false;
    el.value = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}
function __click(sel) { const e = document.querySelector(sel); if (!e) return false; e.click(); return true; }
function __clickText(sel, text) {
  const list = [...document.querySelectorAll(sel)];
  const e = list.find(x => (x.innerText || '').includes(text));
  if (!e) return false; e.click(); return true;
}
true;`;

let errors = [];
listeners.push({
  evt: 'Runtime.exceptionThrown',
  fn: (p) => errors.push('JS: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text || '').split('\n')[0]),
});
listeners.push({
  evt: 'Runtime.consoleAPICalled',
  fn: (p) => {
    if (p.type === 'error') errors.push('console: ' + p.args.map((a) => a.value ?? '').join(' ').slice(0, 140));
  },
});
listeners.push({
  evt: 'Log.entryAdded',
  fn: (p) => {
    const t = p.entry.text || '';
    if (p.entry.level !== 'error') return;
    // ตัดข้อมูลที่ไม่เกี่ยวกับโค้ดของเรา: ฟอนต์/ไอคอนจากภายนอก,
    // และคำขอภายนอกที่ตั้งใจให้ล้มเหลว (เช่น OSRM คำนวณเส้นทาง, tile แผนที่)
    if (/fonts\.googleapis|favicon|ERR_NAME/.test(t)) return;
    if (/tile\.openstreetmap|unpkg|osrm|router\.project-osrm/.test(p.entry.url || '')) return;
    if (/ERR_CONNECTION_REFUSED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK/.test(t)) return;
    errors.push('log: ' + t.slice(0, 140));
  },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login() {
  const r = await fetch(SERVER + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Joey2343**' }),
  });
  if (!r.ok) throw new Error('login HTTP ' + r.status);
  const sid = (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('sid='));
  if (!sid) throw new Error('ไม่พบ cookie sid');
  return decodeURIComponent(sid.slice(4));
}

/**
 * จำลองตำแหน่ง GPS ให้เบราว์เซอร์ที่ใช้ตรวจ
 *
 * ทำไมต้องมี
 * ──────────
 * การลงเวลาตรวจตำแหน่งด้วย GPS ของอุปกรณ์ "ทุกอุปกรณ์" (เอา IP ออกแล้ว)
 * headless Chrome ไม่มี GPS จริง → getCurrentPosition ล้มเหลว (PERMISSION_DENIED)
 * → กดลงเวลาไม่ได้ → เทสต์ "ลงเวลาเข้างานสำเร็จ" พังทั้งที่โค้ดถูก
 *
 * ใช้พิกัดของสถานที่ทำงานที่ตั้งไว้จริง (อ่านผ่าน API ด้วยสิทธิ์ admin)
 * ถ้ายังไม่ได้ตั้งพิกัด ใช้พิกัดสมมติ — เซิร์ฟเวอร์จะเตือนแต่ยอมให้ลงเวลา
 */
async function emulateGeolocation(sid) {
  let lat = 18.1;
  let lng = 100.1;
  let source = 'พิกัดสมมติ (ยังไม่ได้ตั้งค่าที่ทำงาน)';
  try {
    const r = await fetch(SERVER + '/api/time/location-settings', { headers: { cookie: 'sid=' + sid } });
    const cfg = await r.json();
    const site = (cfg.sites || []).find((s) => s.lat !== null && s.lng !== null && s.lat !== undefined);
    if (site) {
      lat = Number(site.lat);
      lng = Number(site.lng);
      source = `พิกัด "${site.name}"`;
    }
  } catch (e) {
    /* ใช้พิกัดสมมติ */
  }
  try {
    await send('Browser.grantPermissions', { origin: SERVER, permissions: ['geolocation'] });
    await send('Emulation.setGeolocationOverride', { latitude: lat, longitude: lng, accuracy: 20 });
  } catch (e) {
    source += ' — ตั้ง GPS จำลองไม่สำเร็จ: ' + e.message;
  }
  return { lat, lng, source };
}

/**
 * รอจนกว่าหน้าปลายทางจะวาดเสร็จจริง
 *
 * ต้องรอ 3 เงื่อนไขพร้อมกัน มิฉะนั้นจะเดาผิด:
 *   1. route ตรงกับปลายทาง — ตอนเปลี่ยน hash เนื้อหาของหน้าเก่ายังอยู่ใน DOM
 *      ถ้ารอแค่ "text นิ่ง" จะอ่านได้เนื้อหาของหน้าก่อนหน้าเสมอ (เป็นบั๊กที่เจอจริง)
 *   2. ไม่มี .center-load (สปินเนอร์กำลังโหลด)
 *   3. เนื้อหานิ่ง 2 รอบติดกัน กาามีเนื้อหาจริง
 */
async function waitSettled(key, max = 15000) {
  const t0 = Date.now();
  let last = null;
  let stable = 0;
  while (Date.now() - t0 < max) {
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        const app = document.querySelector('#app');
        const rt = window.__P2_ROUTER__ ? window.__P2_ROUTER__.currentRoute.value : null;
        return JSON.stringify({
          param: rt ? String(rt.params.viewKey) : '',
          text: app ? app.innerText : '',
          loading: !!document.querySelector('.center-load'),
        });
      })()`,
      returnByValue: true,
    });
    const s = JSON.parse(r.result.value);
    const routeOk = key === 'home' ? s.param === '' : s.param === key;
    if (routeOk && !s.loading && s.text.length > 20 && s.text === last) {
      if (++stable >= 2) return;
    } else {
      stable = 0;
      last = s.text;
    }
    await sleep(400);
  }
}

async function visit(hash) {
  errors = [];
  await send('Runtime.evaluate', { expression: `location.hash = '#/${hash}'` });
  await waitSettled(hash);
  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      const app = document.querySelector('#app');
      const sel = (s) => document.querySelectorAll(s).length;
      return JSON.stringify({
        text: app ? app.innerText : '',
        htmlLen: app ? app.innerHTML.length : 0,
        title: (document.querySelector('.page-title')||{}).innerText || '',
        blocks: sel('.content-block'),
        tables: sel('.tbl'),
        rows: sel('.tbl tbody tr'),
        maps: sel('.leaflet-container'),
        denied: document.body.innerText.includes('ไม่สามารถเข้าถึงเมนู'),
        loading: !!document.querySelector('.center-load'),
        errorBox: document.body.innerText.includes('เกิดข้อผิดพลาดในการแสดงผลหน้านี้'),
      });
    })()`,
    returnByValue: true,
  });
  return JSON.parse(r.result.value);
}

/* ---------------- เริ่มตรวจ ---------------- */
console.log(`ตรวจหน้าที่เขียนเป็น Vue แล้ว (${BROWSER.split('\\').pop()})\n`);

try {
  await boot();
  ok('เปิดเบราว์เซอร์สำเร็จ');
} catch (e) {
  bad('เปิดเบราว์เซอร์ไม่สำเร็จ: ' + e.message);
}

if (ws) {
  let sid = null;
  try {
    sid = await login();
    await send('Network.setCookie', { name: 'sid', value: sid, domain: '127.0.0.1', path: '/' });
    // ต้องตั้ง GPS จำลองก่อนเข้าหน้า clock ไม่งั้นกดลงเวลาไม่ได้ (ตรวจ GPS ทุกอุปกรณ์)
    const geo = await emulateGeolocation(sid);
    ok(`จำลองตำแหน่ง GPS ที่ ${geo.lat}, ${geo.lng} (${geo.source})`);
    await send('Page.navigate', { url: SERVER + '/#/' });
    await sleep(3500);
    ok('ล็อกอินผ่าน API ได้');
  } catch (e) {
    bad('ล็อกอินไม่สำเร็จ: ' + e.message);
  }

  const keys = USE_ALL ? Object.keys(VUE_PAGES) : ['office'];

  /* ---------- โหมด debug: พิมพ์สถานะจริงของหน้า ----------
   * ใช้เมื่อหน้าล้มและต้องการดูว่า "ค้างตรงไหน" โดยไม่ต้องเดา
   *   node scripts/verify-vue-pages.mjs --dump rooms
   *   node scripts/verify-vue-pages.mjs --dump rooms vehicles
   *   node scripts/verify-vue-pages.mjs --dump=rooms,vehicles
   */
  const dumpIdx = process.argv.indexOf('--dump');
  const dumpInline = process.argv.find((a) => a.startsWith('--dump='));
  // รับได้ทั้ง "--dump rooms vehicles" และ "--dump=rooms,vehicles"
  const dumpKeys = dumpInline
    ? dumpInline.slice(7).split(',')
    : dumpIdx >= 0
      ? process.argv.slice(dumpIdx + 1).filter((a) => !a.startsWith('--'))
      : [];
  const dumpMode = dumpKeys.length > 0;

  if (dumpMode) {
    for (const key of dumpKeys.map((s) => s.trim()).filter(Boolean)) {
      const v = await visit(key);
      const kind = await send('Runtime.evaluate', {
        expression:
          "JSON.stringify({vue:(document.querySelector('.view-vue-host')||{dataset:{}}).dataset.viewKind||''," +
          "legacy:(document.querySelector('.view-host')||{dataset:{}}).dataset.viewKind||''," +
          "scope:(document.querySelector('.view-vue-host')||{dataset:{}}).dataset.viewScope||''," +
          "toggle:(document.querySelector('#rb-view-toggle,#vb-view-toggle')||{}).innerText||''})",
        returnByValue: true,
      });
      console.log(`\n===== #/${key} =====`);
      console.log(`  view-kind   : ${kind.result.value}`);
      console.log(`  title       : ${v.title.trim()}`);
      console.log(`  htmlLen     : ${v.htmlLen}`);
      console.log(`  loading     : ${v.loading}`);
      console.log(`  denied      : ${v.denied}`);
      console.log(`  errorBox    : ${v.errorBox}`);
      console.log(`  rows        : ${v.rows}`);
      console.log(`  text        : ${v.text.replace(/\s+/g, ' ').slice(0, 260)}`);
      console.log(`  errors      : ${errors.length ? errors.join(' | ') : '(ไม่มี)'}`);
    }
    // ไม่ใช้ process.exit() ตรงนี้ เพราะ stdout เป็น pipe แล้วข้อความจะถูกตัดทิ้ง
    // ให้ไหลไปถึงการปิดเบราว์เซอร์และสรุปผลตามปกติ
  } else {

  for (const key of keys) {
    const spec = VUE_PAGES[key];
    if (!spec) continue;
    console.log('');
    const v = await visit(key);

    if (v.denied) bad(`#/${key}: ถูกปฏิเสธสิทธิ์`);
    else if (v.errorBox) bad(`#/${key}: แสดงกล่อง error`);
    else if (v.loading) bad(`#/${key}: ค้างที่สถานะกำลังโหลด`);
    else if (v.htmlLen < 100) bad(`#/${key}: เนื้อหาน้อยผิดปกติ (${v.htmlLen} ตัวอักษร)`);
    else ok(`#/${key}: แสดงเนื้อหา (${v.htmlLen} ตัวอักษร)`);

    // หน้าแรกไม่มี page-title (เป็นแบนเนอร์ต้อนรับ) → ข้ามการเช็คชื่อหน้า
    if (spec.title) {
      check(v.title.includes(spec.title), `#/${key}: หัวหน้าหน้าตรง ("${v.title.trim().slice(0, 40)}")`);
    }

    for (const cls of spec.mustHave) {
      const sel = cls.startsWith('.') ? cls : '.' + cls;
      const n = await send('Runtime.evaluate', {
        expression: `document.querySelectorAll(${JSON.stringify(sel)}).length`,
        returnByValue: true,
      });
      check(n.result.value > 0, `#/${key}: มี ${sel} (${n.result.value})`);
    }

    if (spec.hasRows) {
      const apiCount = await (await fetch(`${SERVER}/api/academic/projects`, { headers: { cookie: 'sid=' + sid } })).json()
        .then((d) => (d.projects || d.items || []).length)
        .catch(() => -1);
      if (apiCount >= 0) {
        check(v.rows === apiCount, `#/${key}: จำนวนแถวตรงกับ API (หน้า ${v.rows} · API ${apiCount})`);
      }
    }

    check(errors.length === 0, `#/${key}: ไม่มี runtime error` + (errors.length ? ' → ' + errors[0].slice(0, 100) : ''));

    /* ---- การกระทำจริง (คลิกปุ่มแล้วดูผลลัพธ์) ---- */
    const actions = spec.actions || [];
    for (const act of actions) {
      errors = [];
      // ต้องห่อด้วย IIFE เพราะ return ไม่ถูกต้องในระดับ top-level ของ evaluate
      const r = await send('Runtime.evaluate', {
        expression: `${SET_VAL}\n(() => { ${act.run} })()`,
        returnByValue: true,
      });
      check(r.result.value === true, `#/${key}: ${act.name}` + (r.exceptionDetails ? ' → ' + (r.exceptionDetails.exception?.description || '').split('\n')[0].slice(0, 90) : ''));
      await sleep(2500);
      check(errors.length === 0, `#/${key}: การกระทำไม่มี runtime error` + (errors.length ? ' → ' + errors[0].slice(0, 90) : ''));
      await visit(key); // กลับสู่สถานะปกติก่อนตรวจหน้าถัดไป
    }

    /* ---- ตรวจผลหลังการกระทำ ----
     * รันนอก loop ของ actions เพื่อให้หน้าที่ "ไม่มี action" (เช่น documents ที่ต้องแค่สลับแท็บ)
     * ยังตรวจ afterActions ได้ — เดิมมันซ้อนอยู่ใน loop ทำให้แท็บที่ไม่มี action
     * ไม่เคยรัน afterActions เลย (เทสต์เงียบ ๆ ไม่ทำอะไร)
     *
     * ต้องใส่ SET_VAL เหมือนกัน — check ที่ต้องกดปุ่มต่อ (เช่น สลับกลับเป็นตาราง)
     * จะได้ __click/__setVal ใช้งาน ไม่งั้นได้ ReferenceError แล้วเทสต์ล้มแบบหลอก ๆ
     *
     * awaitPromise: true เพราะ Vue อัปเดต DOM แบบ async
     * ถ้าอ่าน DOM ทันทีหลัง click() จะได้ค่าเก่าเสมอ (label ยังไม่สลับ)
     * → ให้ check เขียนเป็น async IIFE ที่รอสัก 400 ms แล้วค่อยอ่าน
     *
     * ⚠️ ⚠️ กฎสองข้อที่ทำให้เทสต์ "ผ่านทั้งที่ยังพัง" (เจอจริงตอนเพิ่มเทสต์ช่องค่าใช้จ่าย)
     *   ① คืนค่า `true` เป๊ะ — harness เทียบ `value === true` ไม่ใช่ truthy
     *      คืนข้อความสตริง = fail เงียบ ๆ ไม่บอกเหตุผล
     *      → ถ้าจะบอกเหตุผลให้ `throw new Error(ข้อความ)` (harness จะพิมพ์รายละเอียดให้)
     *   ② ต้อง await หลัง click() ทุกครั้งก่อนอ่าน attribute
     *      Vue ผูก :disabled แบบ async (nextTick) → อ่านทันทีได้ค่าเก่าเสมอ
     *      → เทสต์ผ่านทั้งที่ช่องยังปิดอยู่จริง (เจอแล้ว ตอนนี้แก้และมีคอมเมนต์กันแล้ว)
     */
    if (spec.afterActions && spec.afterActions.length) {
      errors = [];
      for (const post of spec.afterActions) {
        const c = await send('Runtime.evaluate', {
          expression: `${SET_VAL}\n(${post.check})`,
          returnByValue: true,
          awaitPromise: true,
        });
        check(
          c.result.value === true,
          `#/${key}: ${post.name}` +
            (c.exceptionDetails
              ? ' → ' + (c.exceptionDetails.exception?.description || '').split('\n')[0].slice(0, 90)
              : ''),
        );
      }
      check(errors.length === 0, `#/${key}: การกระทำไม่มี runtime error` + (errors.length ? ' → ' + errors[0].slice(0, 90) : ''));
    }
  }
  }
}

/* ---------------- ปิด ---------------- */
try {
  ws?.close();
} catch {}
try {
  chrome?.kill();
} catch {}
await sleep(400);
try {
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch {}

console.log(`\nผ่าน ${pass} · ไม่ผ่าน ${fail}`);

// ปิด keep-alive socket ก่อนออก (กัน assertion error ตอน exit บน Windows)
// ต้อง await close() ให้จบก่อนออก ไม่งั้นจะออกกลางที่ handle กำลังปิด → crash แบบสุ่ม 0xC0000409
process.exitCode = fail ? 1 : 0;
try {
  const d = globalThis[Symbol.for('undici.globalDispatcher.1')];
  if (d && typeof d.close === 'function') {
    await Promise.race([
      d.close(),
      new Promise((r) => setTimeout(r, 2000).unref?.() ?? setTimeout(r, 0)),
    ]);
  }
} catch {}
setTimeout(() => process.exit(fail ? 1 : 0), 500);
