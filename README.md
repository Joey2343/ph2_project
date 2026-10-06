# P2-SMART — ระบบศูนย์กลางการบริหารจัดการ สพป.แพร่ เขต 2

ระบบบริหารจัดการภายในสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2
รุ่นนี้คือการย้ายระบบเดิม (vanilla JavaScript) มาเป็น **Vue 3** และเปลี่ยน backend
ให้รองรับ **MySQL** ได้ โดยคงฟีเจอร์และหน้าตาเดิมไว้ทั้งหมด

---

## โครงสร้างโปรเจกต์

```
.
├─ backend/                  Node.js + Express (โครงสร้างเดิมทั้งหมด)
│  ├─ server.js              จุดเริ่มต้นเซิร์ฟเวอร์
│  ├─ db.js                  schema · migrations · seed
│  ├─ db/                    ★ ใหม่ — ชั้นรองรับหลายฐานข้อมูล
│  │  ├─ config.js             อ่านค่าจาก .env / DATABASE_URL
│  │  ├─ sql.js                แปลง SQL จาก SQLite เป็น MySQL
│  │  ├─ driver-sqlite.js      ใช้ node:sqlite (โมดูลในตัว Node 22+)
│  │  └─ driver-mysql.js       ใช้ mysql2/promise
│  ├─ routes/               5 ไฟล์ · 162 endpoint (เหมือนเดิมทุกตัว)
│  ├─ lib/                  auth · approvals · uploads · simdate · cleanup
│  │                        · telegram · async-route
│  ├─ scripts/              เครื่องมือบำรุงรักษา + ตัวตรวจความถูกต้อง
│  ├─ test/                 smoke.js (ทดสอบ endpoint) · parity.js (เทียบ 2 dialect)
│  ├─ form/  font/  logo/   ทรัพยากรสำหรับเอกสาร/ฟอนต์/ตรา
│  ├─ public/uploads/       ไฟล์ที่ผู้ใช้อัปโหลด
│  └─ data.db               ฐานข้อมูล SQLite (ใช้เมื่อไม่ได้ตั้ง DATABASE_URL)
├─ frontend/                 ★ ใหม่ — Vue 3 + Vite + Pinia + vue-router
│  ├─ index.html             หน้าหลัก (เชื่อมหน้าเดียว)
│  ├─ sign-editor.html       หน้าลงนามในร่างเอกสาร (เปิดเป็น popup)
│  ├─ src/
│  │  ├─ main.js             จุดเริ่มต้น · ลงทะเบียน router/store/global
│  │  ├─ App.vue             โครงหน้า (topbar · #app · footer · modal/toast root)
│  │  ├─ router/             เส้นทาง (hash) · เมนู+สิทธิ์ · หน้าไม่มีสิทธิ์
│  │  ├─ views/              13 หน้า (หน้าตาดั้งเดิมทุกตัวอักษร)
│  │  ├─ ui/ui.js            UI kit (element · modal · toast · ฟอร์ม · วันที่ พ.ศ.)
│  │  ├─ styles/theme.css    = style.css ของรุ่นเดิม (SHA256 เดิม ไม่แก้แม้แต่บรรทัดเดียว)
│  │  ├─ api/ stores/        client · session · auth
│  │  └─ constants/          ตัวเลือกคงที่ (ตำแหน่ง · กลุ่มงาน · ระดับวิชาการ ฯลฯ)
│  └─ scripts/
│     ├─ port-frontend.mjs   แปลงซอร์สรุ่นเดิม → ES module (รันซ้ำได้)
│     ├─ verify-build.mjs    ตรวจผล build + ไฟล์ที่ server เสิร์ฟ
│     └─ verify-runtime.mjs  เปิดเบราว์เซอร์จริง ตรวจทุกหน้า + จับ JS error
├─ docs/
│  ├─ adr/                  บันทึกการตัดสินใจทางสถาปัตยกรรม
│  └─ legacy/               ซอร์สรุ่นเดิม + เอกสารเดิม (ไว้เทียบ/ย้อนกลับ)
│     └─ source-v1/           css/ js/ (13 views) vendor/ index.html
├─ docker-compose.yml       MySQL 8.4 + MariaDB 10.11 สำหรับ dev/test
├─ .npmrc                   บังคับใช้ npm registry มาตรฐาน
└─ README.md
```

---

## ข้อกำหนดระบบ

- **Node.js 22 ขึ้นไป** (ต้องการ `node:sqlite` ที่มากับ Node โดยตรง)
  ทดสอบแล้วกับ Node 24.12
- MySQL 8.0 ขึ้นไป หรือ MariaDB 10.4 ขึ้นไป

> **ทำไมเลิกใช้ `better-sqlite3`**
> เป็น native module ต้อง compile ให้ตรงกับเวอร์ชัน Node ที่ติดตั้ง
> เมื่อเปลี่ยนเวอร์ชัน Node ระบบจะรันไม่ได้ทันที (เคยเจอกรณีนี้จริงกับ Node 24)
> การใช้ `node:sqlite` ที่มากับ Node ตัดปัญหานี้ออกไปทั้งหมด

---

## เริ่มใช้งาน

### 1) ติดตั้งแพ็กเกจ

```bash
cd backend  && npm install
cd ../frontend && npm install
```

> ไฟล์ `.npmrc` มีอยู่ทั้งที่รากโปรเจกต์ **และ** ใน `backend/` + `frontend/`
> (npm อ่าน `.npmrc` จากโฟลเดอร์ที่มี `package.json` เท่านั้น ไม่ได้ไล่ขึ้นไปที่ราก)
> ไฟล์นี้บังคับ `registry.npmjs.org` เพราะ registry ภายในขององค์กร
> แคช tarball ของ `mysql2` และ `leaflet.markercluster` ไม่ครบ (ได้ 404)

### 2) เลือกฐานข้อมูล

#### ทางเลือก A — SQLite (ค่าเริ่มต้น ไม่ต้องติดตั้งอะไรเพิ่ม)

```bash
cd backend
npm start
```

ใช้ไฟล์ `backend/data.db`

#### ทางเลือก B — MySQL 8.4 (ผ่าน Docker)

```bash
docker compose up -d                 # เริ่ม MySQL ที่พอร์ต 3307
cd backend
cp .env.example .env                 # แก้ค่าให้ชี้ MySQL
npm start
```

ค่าใน `.env`:
```
DATABASE_URL=mysql://ph2:ph2pass@127.0.0.1:3307/ph2
```

#### ทางเลือก C — ย้ายข้อมูลเดิมจาก SQLite ไป MySQL

```bash
cd backend
docker compose up -d
cp .env.example .env
npm run db:migrate-sqlite -- --force
```

สคริปต์นี้อ่านจาก `backend/data.db` แล้วเขียนเข้า MySQL ทีละตาราง
ถ้าข้อมูลมีปัญหาจะย้อนกลับทั้งหมด (ทำงานใน transaction เดียว)

---

## หน้าเว็บ (frontend)

### ทำงานแบบ dev — แก้แล้วเห็นทันที

ต้องรัน backend ไว้ด้วย เพราะ Vite จะ proxy `/api` ไปที่ `http://127.0.0.1:3000`

```bash
# ต่างหน้าต่างกัน 2 ตัว
cd backend   && npm start          # http://localhost:3000
cd frontend  && npm run dev        # http://localhost:5173
```

### ทำงานแบบ production — build แล้วให้ Express เสิร์ฟเอง

```bash
cd frontend && npm run build       # ผลลัพธ์อยู่ที่ frontend/dist
cd backend  && npm start           # เปิด http://localhost:3000 ได้เลย
```

ถ้ายังไม่ได้ build ระบบจะขึ้นข้อความแนะนำให้ใช้ dev server แทน

### ตรวจหน้าเว็บ

```bash
cd frontend
npm run verify:registry   # ตรวจ src/views/registry.js (key ซ้ำ · kind ตรงกัน · ไฟล์มีอยู่)
npm run verify:build      # ตรวจไฟล์ใน dist/ (chunk ครบทุกหน้า · CSS ตรงต้นฉบับ · worker pdf.js)
npm run verify:pages      # ตรวจทุกหน้า Vue แบบละเอียด (ต้องรัน backend อยู่)
npm run verify:runtime    # เปิด Chrome/Edge จริง ตรวจหน้าแรก + จับ runtime error
npm run verify:auth       # ตรวจหน้าเข้าสู่ระบบ/ลงทะเบียน
npm run verify:all        # ทั้งหมด รวมทุกเมนู (ต้องรัน backend อยู่)
```

### สถานะการย้ายหน้าเว็บเป็น Vue

ทุกเมนูย้ายเป็น Vue SFC เสร็จแล้ว — `npm run verify:registry` รายงาน `vue 14 · legacy 0`

`src/views/` เหลือแค่ 2 ไฟล์: `registry.js` (ตารางเส้นทาง) กับ `DocumentsView.js`

#### เมนูหนังสือราชการ — เหลือ hybrid 2 ฟอร์ม

`DocumentsView.js` ลดจาก 3,049 เหลือ **684 บรรทัด** เหลือเฉพาะ:

| ที่ยังเป็นโมดุลเดิม | บรรทัด | เหตุผลที่ยังไม่ย้าย |
|---|---|---|
| `openSendForm()` | 353 | สร้าง PDF หนังสือส่ง (ฝังรูป/ลายเซ็น) แล้วเปิดหน้าต่างพิมพ์ |
| `openPostalForm()` | 317 | เหมือนข้างบนแต่เป็นไปรษณีย์ภายในเขต |

สองฟอร์มนี้เขียนเอกสาร PDF ทั้งฉบับผ่าน `pdf-lib` แล้ว `window.open` หน้าต่างใหม่
Vue SFC ไม่ได้ช่วยอะไรกับส่วนนี้ การแยกเป็น component จะได้แค่โค้ดเดิมที่อยู่ในไฟล์อื่น

ย้ายเป็น Vue ครบแล้วทั้งหมดนอกจากนี้ อยู่ใน `src/components/documents/`:

| Component | แทนโค้ดเดิม |
|---|---|
| `DocumentsDetailModal` | `openView()` |
| `DocumentsCertA4Modal` | `certFormA4Html()` + `showCertificateFormA4()` + `printCertificateA4()` |
| `DocumentsExportModal` | `openExportDialog()` (125) |
| `DocumentsStaffSettingsModal` | `openStaffSettings()` (119) |
| `DocumentsCertStaffModal` | `openCertStaffSettings()` (35) |
| `DocumentsDocStaffSettingsModal` | `openDocStaffSettings()` (121) |
| `DocumentsSchoolPrefixModal` | `openSetSchoolDocPrefix()` (25) |
| `DocumentsStampEditor` | `_stampOverlay()` (163) |
| `DocumentsFormModal` | ส่วน order / certificate / honor ของ `openForm()` |
| `DocumentsIncomingFormModal` | ส่วน incoming ของ `openForm()` + `saveForm()` |
| `DocumentsOutgoingFormModal` | ส่วน outgoing ของ `openForm()` |

ฟังก์ชันที่ไม่มี DOM แยกไว้ใน `src/lib/`:

- `documents.js` — `docTypeMeta`, ค่าคงที่เดือนไทย, ชุดคอลัมน์ export, endpoint รายแท็บ, แยกไฟล์แนบ
- `documents-form.js` — วาดเกียรติบัตรลง canvas, พิมพ์/บันทึกเกียรติบัตร, ดึงรายชื่อบุคลากร/สถานศึกษา
- `cert-print-css.js` — CSS หน้าต่างพิมพ์ A4 (ต้องเป็น JS เพราะ CSS ถูกฝังลงเอกสารที่เปิดด้วย `window.open`)

#### โค้ดที่ port ไว้แต่ไม่ได้ใช้แล้ว

`npm run port` แปลงโค้ดจาก `docs/legacy/source-v1/js` เป็น ES module
เมื่อทุกหน้าย้ายเป็น Vue แล้ว ผลลัพธ์จึงถูกเขียนไว้ที่ `docs/legacy/ported-views/` เพื่อเก็บไว้เทียบอ้างอิง
(ไม่ใช่ `src/views/` เหมือนเดิม มิฉะนั้นจะสร้างไฟล์ที่ไม่มีใคร import กลับมาในทุกครั้งที่รัน)

`verify:build` จะเทียบ SHA256 ของ `src/styles/theme.css` กับ
`docs/legacy/source-v1/css/style.css` เพื่อกันไม่ให้ CSS ของระบบเดิมถูกแก้โดยไม่ตั้งใจ

### วิธีย้ายโค้ดหน้าต่าง ๆ มาจากรุ่นเดิม

โค้ดหน้า (13 ไฟล์ รวม ~818 KB) ถูกแปลงจากรุ่นเดิมด้วย **การแปลงแบบสคริปต์**
ไม่ใช่การพิมพ์ใหม่ เพื่อให้ข้อความไทย ชื่อ class และ markup ตรงกับต้นฉบับทุกตัวอักษร

```bash
cd frontend && npm run port   # อ่าน docs/legacy/source-v1/js → เขียน docs/legacy/ported-views/
```

> ครั้งแรกที่ย้ายผลลัพธ์เขียนลง `src/views/` ตอนนี้ทุกหน้าเป็น Vue SFC แล้ว
> จึงเปลี่ยนปลายทางเป็น `docs/legacy/ported-views/` เพื่อเก็บของแปลงไว้เทียบ
> โดยไม่สร้างไฟล์ที่ไม่มีใคร import กลับเข้ามาใน `src/`

สิ่งที่ถูกแปลง:

| ของเดิม | ของใหม่ |
|---|---|
| `API.get('/x')` | `api.get('/x')` — โมดุลแทน global |
| `go('office')` | `goTo('office')` ใน `<script setup>` เรียก `window.__P2_GO__` — vue-router |
| `render()` | `window.__P2_RERENDER__()` — ให้ ViewHost วาดหน้าใหม่ |
| Leaflet / PDFLib / pdf.js จาก CDN | import จาก `node_modules` (ไม่พึ่งอินเทอร์เน็ตภายนอก) |
| `Auth.renderTopbar()` วาด DOM เอง | `TopBar.vue` คำนวณจาก `session.user` แบบ reactive |

**ส่วนที่ยังไม่เปลี่ยน**: UI kit (`ui/ui.js`) ยังคงโค้ดเดิมทุกตัวอักษร
ทำให้หน้าตาและพฤติกรรมเหมือนระบบก่อนหน้านี้

### กติกาที่ต้องระวังตอนย้ายไฟล์เป็น Vue

- `<script setup>` เข้าถึงได้แค่ตัวแปรใน scope ของ component และ global ที่ Vue อนุญาต
  **เรียก `window.something` ใน `template` ไม่ได้** ต้องห่อเป็นฟังก์ชันใน `<script setup>` ก่อน
- `<script setup>` **export ค่าคงที่ข้าม component ไม่ได้** ต้องแยกไปไฟล์กลาง เช่น `src/lib/memo.js`
- รูปที่ backend เสิร์ฟ (เช่น `logo.png`, `/form/krut.png`) ต้องผูกเป็น runtime URL (`:src="'logo.png'"`)
  ถ้าเขียน `src="logo.png` ตรง ๆ Vite จะไปหาไฟล์ในโปรเจกต์ตอน build แล้ว fail ด้วย `Rollup failed to resolve import`
- ค่าจาก `import.meta.env` ต้องอ่านผ่าน computed/ฟังก์ชันใน template ไม่งั้นจะไม่ถูกแทนค่าตอน build
- เรียก `setInterval` ใน `onMounted` ต้อง `clearInterval` ใน `onBeforeUnmount` ไม่งั้นจะเดินค้างหลังเปลี่ยนหน้า
- อย่านับ element ของ component ตัวเองตอน `onBeforeUnmount` — Vue ยังไม่ถอด element ออกจาก DOM ในตอนนั้น
  ถ้าใช้นับสิ่งนี้เพื่อปลดล็อก `document.body.style.overflow` จะว่างไม่ปลด ผู้ใช้จะเลื่อนหน้าไม่ได้หลังปิด dialog
- ถ้าจะปิด modal ฝั่ง legacy ให้เรียก `UI.closeTopModal()` อย่าล้าง `innerHTML` ของ `#modal-root` เอง
- `<style scoped>` ในหน้าใหม่ปล่อยว่างได้ เพราะคลาสทั้งหมดมาจาก `styles/theme.css` ที่ตรงกับต้นฉบับ

---

## คำสั่งที่ใช้บ่อย

| คำสั่ง | ทำอะไร |
|---|---|
| `npm start` | เริ่มเซิร์ฟเวอร์ |
| `npm run dev` | เริ่มแบบ auto-reload (`node --watch`) |
| `npm test` | ทดสอบ endpoint ทั้งหมดบน SQLite |
| `npm run test:parity` | เทียบผลลัพธ์ระหว่าง SQLite ↔ MySQL |
| `npm run db:inspect` | ดูตาราง/คอลัมน์/จำนวนแถว |
| `npm run db:init` | สร้าง schema + migration + seed |
| `npm run db:migrate-sqlite` | ย้ายข้อมูลจาก SQLite ไป MySQL |
| `node scripts/verify.js --with-mysql` | ตรวจทั้งระบบ (ดูด้านล่าง) |

### คำสั่งของ frontend

| คำสั่ง (ใน `frontend/`) | ทำอะไร |
|---|---|
| `npm run dev` | เริ่ม dev server (proxy `/api` ไป backend) |
| `npm run build` | build เป็น `dist/` |
| `npm run preview` | ดูผล build แบบ static |
| `npm run port` | แปลงซอร์สรุ่นเดิม → ES module ไว้ที่ `docs/legacy/ported-views/` (รันซ้ำได้) |
| `npm run verify:registry` | ตรวจ registry ว่าทุกเมนูเป็น Vue แล้วและไม่มี key ซ้ำ |
| `npm run verify:build` | ตรวจผล build + ไฟล์ที่ server เสิร์ฟ |
| `npm run verify:pages` | ตรวจทุกหน้า Vue แบบละเอียด (เนื้อหา · ปุ่ม · ข้อมูลจริง) |
| `npm run verify:runtime` | เปิดเบราว์เซอร์จริง ตรวจทุกหน้า + จับ JS error |
| `npm run verify:auth` | ตรวจหน้าเข้าสู่ระบบและลงทะเบียน |
| `npm run verify:all` | ตรวจครบทั้ง build และ runtime (ทุกเมนู) |

### ตรวจความถูกต้องทั้งระบบ

```bash
node scripts/verify.js                 # ตรวจเฉพาะ SQLite
node scripts/verify.js --with-mysql    # ตรวจทั้งสอง dialect (ต้องรัน MySQL อยู่)
```

ตรวจ: syntax ทุกไฟล์ · SQL เทียบ schema จริง · เรื่อง `await` precedence ·
ทดสอบ endpoint บน SQLite · เทียบผลระหว่าง SQLite กับ MySQL

---

## เครื่องมือตรวจสอบใน `backend/scripts/`

| ไฟล์ | หน้าที่ |
|---|---|
| `verify.js` | รันทุกการตรวจพร้อมกัน |
| `check-syntax.js` | ตรวจว่าไฟล์ JS ทุกไฟล์ parse ผ่าน |
| `check-sql-schema.js` | ตรวจว่าไม่มี query ที่อ้างคอลัมน์ซึ่งไม่มีจริง |
| `check-await-parens.js` | ตรวจ/แก้ `await fn().prop` ซึ่งพังเมื่อเป็น async |
| `test-await-parens.js` | เทสต์ตัวตรวจข้างบน 19 กรณี |
| `measure-columns.js` | วัดความยาวข้อมูลจริง เพื่อเลือกขนาด VARCHAR ให้เหมาะสม |
| `probe-mysql-ddl.js` | ทดสอบว่า MySQL ยอมรับไวยากรณ์ DDL แบบไหน |
| `inspect-db.js` | แสดง schema และจำนวนแถว |
| `show-ddl.js` | แสดง DDL ดิบตามที่ฐานข้อมูลเก็บไว้ |
| `debug-endpoint.js` | ยิง endpoint ที่ระบุแล้วดู error จากเซิร์ฟเวอร์ |
| `migrate-to-mysql.js` | ย้ายข้อมูล SQLite → MySQL |
| `fix-known-bugs.js` | แก้บั๊กที่ค้นพบระหว่างตรวจสอบ (มีคำอธิบายกำกับ) |
| `port-to-async.js` | ไปป์ไลน์แปลงซอร์สรุ่นเดิม → async (รันซ้ำได้ ผลเหมือนเดิม) |
| `port-maintenance.js` | port สคริปต์บำรุงรักษาเดิมให้ใช้ adapter ตัวเดียวกัน |

---

## รองรับทั้ง SQLite และ MySQL อย่างไร

โค้ดทั้งระบบเขียน SQL **แบบ SQLite** เหมือนเดิมทุกบรรทัด
ชั้น `backend/db/` จะแปลงให้เป็น MySQL เมื่อ `DATABASE_URL` ชี้ไปที่ MySQL

สิ่งที่ชั้นแปลงจัดการให้อัตโนมัติ:

| เรื่อง | การจัดการ |
|---|---|
| `ON CONFLICT … DO UPDATE` | → `ON DUPLICATE KEY UPDATE` |
| `INSERT OR IGNORE` | → `INSERT IGNORE` |
| `datetime('now','localtime')` | → `NOW()` |
| `CAST(x AS INTEGER)` | → `CAST(x AS SIGNED)` |
| `AUTOINCREMENT` / `REAL` / `TEXT` | → `AUTO_INCREMENT` / `DOUBLE` / `MEDIUMTEXT`·`VARCHAR` |
| คอลัมน์ชื่อ `key` `read` (reserved word) | ห่อด้วย backtick (ใช้ได้ทั้งสอง dialect) |
| `\|\|` ต่อสตริง | ตั้ง `PIPES_AS_CONCAT` ใน `sql_mode` |
| `GROUP BY` แบบไม่ aggregate ทุกคอลัมน์ | ปลด `ONLY_FULL_GROUP_BY` |
| **ลำดับการเรียงข้อความ** | ใช้ collation `utf8mb4_bin` ให้ตรงกับ SQLite (ดู ADR-0007) |

รายละเอียดเชิงลึกของแต่ละเรื่องอยู่ใน `docs/adr/`

---

## โครงสร้าง backend

- `db.js` — สร้างตาราง เพิ่มคอลัมน์ที่ขาด ใส่ข้อมูลตัวอย่าง (ทำซ้ำได้ ไม่เป็นอันตราย)
- `routes/` — 162 endpoint แบ่งเป็น 5 ไฟล์ ตามกลุ่มเมนู (โครงสร้างเดิม)
- `lib/async-route.js` — จัดการ error ของ async handler
  (Express 4 ไม่ catch promise ที่ reject เอง ถ้าไม่มีตัวนี้ request จะค้าง)
- `lib/approvals.js` — เครื่องมืออนุมัติหลายระดับ ใช้ร่วมกันทั้ง 5 ระบบ

ทุก endpoint ที่ต้องยิงฐานข้อมูลเป็น `async` และใช้ `await` นำหน้าคำสั่ง SQL

---

## เอกสารเพิ่มเติม

- `docs/adr/` — บันทึกการตัดสินใจทางสถาปัตยกรรม (ทำไมถึงเลือกแบบนั้น)
- `docs/glossary.md` — ศัพท์เฉพาะของระบบ
- `docs/legacy/` — ซอร์สและเอกสารของรุ่นเดิม (ไว้เทียบและย้อนกลับ)
