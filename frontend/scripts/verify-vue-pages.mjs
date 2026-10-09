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
    title: 'บริหารงานวิชาการ',
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
        check: `[...document.querySelectorAll('.tbl tbody .btn')].some(b => b.innerText.includes('รายละเอียด'))`,
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
        name: 'แบบฟอร์มมีตัวเลือกความเร่งด่วนครบ',
        check: `document.querySelectorAll('.urgency-opt').length === 3`,
      },
      {
        name: 'ช่องส่งบันทึกข้อความถึงแสดงผู้รับ',
        check: `!!document.querySelector('.sendto-box')`,
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
        name: 'แท็บตั้งค่ามี dropdown ครบ 4 ระบบ',
        check: `['as-approval_vehicle','as-approval_room','as-approval_travel','as-approval_leave'].every(id => !!document.getElementById(id))`,
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
