# AGENTS.md — P2-SMART

คู่มือสำหรับ AI agent ที่ทำงานกับโปรเจกต์นี้ รวมวิธีรันเซิร์ฟเวอร์
และรายละเอียดการใช้งานของแต่ละประเภทผู้ใช้

---

## 1. โปรเจกต์นี้คืออะไร

ระบบศูนย์กลางการบริหารจัดการ **สำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2 (สพป.แพร่ เขต 2)**

| | |
|---|---|
| Frontend | Vue 3 + Vite (JavaScript ไม่มี TypeScript) + Pinia |
| Backend | Node.js + Express + CommonJS |
| ฐานข้อมูล | SQLite (`node:sqlite`) หรือ MySQL 8 / MariaDB |
| Router | `createWebHashHistory()` → เส้นทางเป็น `#/documents` |
| พอร์ต | backend 3000 · frontend dev 5173 · MySQL 3307 · MariaDB 3308 |

**สถานะการย้าย:** ทุกหน้าเป็น Vue SFC แล้ว (14 เมนู, `vue 14 · legacy 0`)
เหลือโมดุลเดิมแค่ `frontend/src/views/DocumentsView.js` (684 บรรทัด) สำหรับ 2 ฟอร์มที่สร้าง PDF

---

## 2. กติกาที่ห้ามละเมิด

### 2.1 CSS และข้อความภาษาไทย

- `frontend/src/styles/theme.css` **ห้ามแก้** — `verify:build` เทียบ SHA256 กับ
  `docs/legacy/source-v1/css/style.css` ถ้าต่างกันเทสต์จะ fail
- ข้อความไทยใน UI ต้องตรงต้นฉบับทุกตัวอักษร ห้ามย่อ ห้ามเปลี่ยนคำ

### 2.2 กฎเฉพาะ Vue

- `<script setup>` **export ค่าคงที่ข้าม component ไม่ได้** → ต้องแยกไปไฟล์กลาง (`src/lib/`)
- `<template>` **เข้าถึง `window` ไม่ได้** → ต้องห่อเป็นฟังก์ชันใน `<script setup>` ก่อน
  ```js
  // ✗ ผิด — ReferenceError ตอนคลิก
  @click="window.__P2_GO__(m.key)"
  // ✓ ถูก
  function goTo(key) { window.__P2_GO__(key); }
  ```
- รูปที่ backend เสิร์ฟ (`logo.png`, `/form/krut.png`) ต้องเป็น **runtime URL**
  ```vue
  ✗ <img src="logo.png" />        <!-- Vite จะหาไฟล์ตอน build แล้ว fail -->
  ✓ <img :src="'logo.png'" />    <!-- ผูกเป็น runtime -->
  ```
- `setInterval` ใน `onMounted` ต้อง `clearInterval` ใน `onBeforeUnmount`
- **นับ element ของ component ตัวเองตอน unmount ไม่ได้** เพราะ Vue เรียก
  `onBeforeUnmount()` **ก่อน** ถอด element ออกจาก DOM
  ```js
  // ✗ ผิด — ปิด modal แล้วเลื่อนหน้าไม่ได้ (เจอจริงบนหน้าแรก admin)
  // นับเจอตัวเอง 1 ตัวตอนปิด → คิดว่ายังมี modal ค้าง → overflow='hidden' ค้างตลอด
  onBeforeUnmount(() => {
    const stillOpen = document.querySelectorAll('[data-app-modal]').length > 0;
    document.body.style.overflow = stillOpen ? 'hidden' : '';
  });

  // ✓ ถูก — ตัดตัวเองออกจากการนับเสมอ
  const root = ref(null);
  onBeforeUnmount(() => {
    const others = [...document.querySelectorAll('[data-app-modal]')]
      .filter((el) => el !== root.value);
    document.body.style.overflow = others.length > 0 ? 'hidden' : '';
  });
  ```
  > อาการ: ผู้ใช้เปิด-ปิด dialog ใดๆ แล้วเลื่อนหน้าไม่ได้อีก จนกว่าจะรีเฟรช
  > กันไว้แล้วที่ `verify-vue-pages.mjs` → "เปิด-ปิด dialog แล้วยังเลื่อนหน้าได้"
  > ถ้าจะปิด modal ฝั่ง legacy ให้เรียก `UI.closeTopModal()` อย่างเดียว
  > (มันล้าง `#modal-root` และปลดล็อก body ให้พร้อมกัน — ล้าง `innerHTML` เองจะค้าง)
- `AppModal` ต้องมี **prop `footer`** ถึงจะแสดง slot `#footer` (ไม่งั้นปุ่มหายเงียบ ๆ)
- component ที่ import เป็น default ให้เขียน `import X from './X.vue'` — อย่าใช้ `{ X }`
  (ตรวจด้วย: ไฟล์นั้นมี `export` ใน SFC ไหม)

### 2.3 ต้องตรวจหลังแก้โค้ด

```bash
# 1) syntax ของไฟล์ JS (เร็ว)
node --check frontend/src/path/to/file.js

# ถ้าขึ้น "Unexpected end of input" → หาบรรทัดที่วงเล็บไม่ครบ
node frontend/scripts/check-braces.mjs frontend/src/path/to/file.js

# 2) syntax ของไฟล์ Vue — ใช้ compiler ตรง ๆ (เร็วกว่า build)
node -e "const {parse}=require('./frontend/node_modules/@vue/compiler-sfc');
const fs=require('fs');const f='frontend/src/.../X.vue';
const r=parse(fs.readFileSync(f,'utf8'),{filename:f});
(r.errors||[]).forEach(e=>console.log(e.message));
console.log('errors='+(r.errors||[]).length,
  r.descriptor.scriptSetup?'scriptSetup ok':'NO scriptSetup');"
```

> เคยเสียเวลาเพราะไฟล์ Vue ขาด `<script setup>` เปิด → build พังด้วย `Invalid end tag`
> เทสต์ข้อ 2 จับได้ใน 2 วินาที (`descriptor.scriptSetup` จะเป็น `undefined` ถ้าไม่มี `<script setup>`)

### 2.4 encoding

ไฟล์ทั้งหมดเป็น UTF-8 ห้ามมีอักขระ U+FFFD (`�`)
เขียนไฟล์ไทยยาว ๆ ผ่าน PowerShell `Out-File` แล้วอักขระจะเพี้ยน
**เช็กก่อนจบทุกครั้ง:**

```bash
node -e "const fs=require('fs');
fs.readdirSync('frontend/src',{recursive:true}).filter(f=>/\.(js|vue)\$/.test(f))
 .forEach(f=>{const n=(fs.readFileSync('frontend/src/'+f,'utf8').match(/�/g)||[]).length;
 if(n)console.log('BAD',f,n);});"
```

---

## 3. เริ่มเซิร์ฟเวอร์

### 3.1 ติดตั้งครั้งแรก

```bash
cd backend  && npm install
cd ../frontend && npm install
```

> `.npmrc` มีทั้งที่รากโปรเจกต์ **และ** ใน `backend/` + `frontend/`
> npm อ่าน `.npmrc` จากโฟลเดอร์ที่มี `package.json` เท่านั้น ไม่ได้ไล่ขึ้นไปข้างบน
> ไฟล์นี้บังคับ `registry.npmjs.org` เพราะ registry ภายในองค์กรแคช tarball ของ
> `mysql2` และ `leaflet.markercluster` ไม่ครบ (404)

### 3.2 ทางเลือก A — SQLite (ค่าเริ่มต้น ไม่ต้องติดตั้งอะไร)

```bash
# เทอร์มินัล 1
cd backend && npm start          # http://localhost:3000
# เทอร์มินัล 2
cd frontend && npm run dev       # http://localhost:5173
```

ใช้ไฟล์ `backend/data.db`

### 3.3 ทางเลือก B — MySQL 8.4 (Docker)

```bash
docker compose up -d                      # MySQL ที่พอร์ต 3307
docker compose ps                         # ดูสถานะ
docker compose logs -f mysql              # ดู log
docker compose down                       # หยุด (เก็บข้อมูลไว้)
docker compose down -v                    # หยุด + ลบข้อมูลทั้งหมด

cp backend/.env.example backend/.env      # แก้ค่าให้ชี้ MySQL
cd backend && npm start
```

ค่าใน `backend/.env`:
```
DATABASE_URL=mysql://admin_ph2:admin_ph2pass@127.0.0.1:3307/admin_ph2
```

**ทำไมต้องเป็น 3307** — กันชนกับ MySQL ที่อาจมีอยู่แล้วในเครื่อง
ถ้าจะใช้ 3306 ให้แก้ทั้ง `docker-compose.yml` (ports) และ `DATABASE_URL` ให้ตรงกัน

> ⚠️ **ชื่อฐานข้อมูลมาจาก 2 ที่** — `backend/db/config.js:71` อ่าน `DB_NAME` ก่อน
> path ใน `DATABASE_URL` ดังนั้น**ถ้าเคยแตะ `DB_NAME` ต้องแก้ให้ตรงกันด้วย**
> ถ้าไม่ได้ใช้แยกตัวแปร ให้ลบบรรทัด `DB_NAME` ทิ้ง จะได้ไม่ต้องคอยแก้สองที่ให้ตรงกัน

> ⚠️ **`MYSQL_DATABASE` มีผลตอน datadir ว่างเท่านั้น** (docker-entrypoint รันครั้งแรก)
> ถ้าเปลี่ยนชื่อฐานบน volume เดิม ระบบจะไม่สร้างฐานใหม่ และไม่ rename ฐานเดิม
> ต้อง `docker compose down -v` แล้ว `up -d` ใหม่ (หรือสร้างฐานด้วย SQL เอง)

### 3.4 MariaDB (ตัวเลือก ทดสอบความเข้ากันได้)

```bash
docker compose --profile mariadb up -d mariadb   # พอร์ต 3308
# แก้ DATABASE_URL เป็น mysql://admin_ph2:admin_ph2pass@127.0.0.1:3308/admin_ph2
```

> เวอร์ชันใน `docker-compose.yml` คือ `mariadb:11.4` ซึ่งตรงกับเซิร์ฟเวอร์จริง (11.4 LTS)
> MariaDB **ไม่มี `RENAME DATABASE`** ถ้าเปลี่ยนชื่อฐานบนเซิร์ฟเวอร์ด้วยการย้ายตาราง
> grant ในตาราง `mysql.db` จะ**ไม่ย้ายตาม** ต้อง `GRANT` ใหม่เอง

### 3.5 ทางเลือก C — ย้ายข้อมูลจาก SQLite ไป MySQL

```bash
docker compose up -d
cp backend/.env.example backend/.env
cd backend && npm run db:migrate-sqlite -- --force
```

อ่านจาก `backend/data.db` → เขียนเข้า MySQL ทีละตาราง
ถ้าข้อมูลมีปัญหาจะย้อนกลับทั้งหมด (ทำงานใน transaction เดียว)

> เคยมี 23 ตาราง · 444 แถว (ย้ายสำเร็จทั้ง MySQL 8.4 และ MariaDB 11.4)
> ชื่อฐานและ user ปัจจุบัน: `admin_ph2` / `admin_ph2` / รหัส `admin_ph2pass`
> รหัสผ่านเปลี่ยนแล้วถ้า Docker ยังจำของเดิมอยู่ ต้องล้าง volume (ดูหมายเหตุข้างล่าง)

> ⚠️ **`data.db` เปิดโหมด WAL** — ข้อมูลที่เพิ่งเขียนจะอยู่ในไฟล์ `data.db-wal`
> ยังไม่ถูก merge เข้าไฟล์หลัก จนกว่าจะ checkpoint หรือปิดแบบสะอาด
> **ถ้าจะ copy `data.db` ไปที่อื่น ต้อง `PRAGMA wal_checkpoint(TRUNCATE)` ก่อน**
> ไม่งั้นจะได้ฐานที่ตัดข้อมูลออก — `test/parity.js` และ `test/smoke.js`
> ตอนนี้ checkpoint ให้แล้วทั้งสองไฟล์
> (อาการคือ parity ไม่ผ่านเฉพาะตารางที่เพิ่งเขียน เช่น `time_records`)

> ⚠️ **เปลี่ยนรหัสผ่าน/ชื่อฐานใน compose แล้วต้องล้าง volume ด้วย**
> `MYSQL_PASSWORD` / `MARIADB_PASSWORD` มีผลตอน datadir ว่างเท่านั้นเหมือนกัน
> และ `docker compose down -v` **ไม่ลบ service ที่อยู่หลัง profile**
> ต้องระบุ profile ด้วย:
> ```bash
> docker compose --profile mariadb down -v
> ```
> ไม่งั้นจะเจอ `ER_ACCESS_DENIED_ERROR` ทั้งที่ compose อ่านค่าใหม่แล้ว

### 3.6 โหมด dev ของ backend

```bash
cd backend && npm run dev     # node --watch เปิดใหม่เองเมื่อไฟล์เปลี่ยน
```

### 3.7 โหมด production

```bash
cd frontend && npm run build   # ผลลัพธ์ที่ frontend/dist
cd backend  && npm start       # Express เสิร์ฟเองที่ http://localhost:3000
```

ถ้ายังไม่ได้ build ระบบจะขึ้นข้อความแนะนำให้ใช้ dev server แทน

### 3.8 ตัวแปรแวดล้อม

ไฟล์ `backend/.env` รองรับ:

| ตัวแปร | ค่าเริ่มต้น | หมายเหตุ |
|---|---|---|
| `PORT` | `3000` | พอร์ต backend |
| `DATABASE_URL` | ว่าง = ใช้ SQLite | `mysql://user:pass@host:port/db` |
| `SQLITE_FILE` | `data.db` | ไฟล์ SQLite |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | — | ใช้แทน `DATABASE_URL` ได้ |
| `DB_CONNECTION_LIMIT` | — | จำนวน connection สูงสุดของ pool |
| `DB_CHARSET` `DB_COLLATION` | — | ต้องเป็น `utf8mb4` เพื่อให้ไทย + emoji ใช้ได้ |
| `TELEGRAM_API_BASE` | — | Telegram bot (ถ้าใช้แจ้งเตือน) |

> `.env` อยู่ใน `.gitignore` — ห้าม commit

---

## 4. ผู้ใช้แต่ละประเภท

### 4.1 ผู้ที่ยังไม่ล็อกอิน (บุคคลทั่วไป)

เปิดเว็บที่ `http://localhost:5173` ได้เลย ไม่ต้องมีบัญชี

**สิ่งที่ทำได้:** ดูข้อมูลพื้นฐานสำนักงาน + ดูแผนที่โรงเรียนในสังกัด

| เมนู | ที่อยู่ | ทำอะไรได้ |
|---|---|---|
| ⊞ ข้อมูลพื้นฐาน สพป.แพร่ เขต 2 | `#/office` | ประวัติความเป็นมา · วิสัยทัศน์ · โครงสร้างองค์กร · การติดต่อ |
| ⊙ พิกัดโรงเรียนในสังกัด | `#/schools` | แผนที่ Leaflet + ค้นหา/ดูรายละเอียดโรงเรียน |

**สิ่งที่ทำไม่ได้:** หน้าแรกจะแสดงการ์ดเมนูทั้งหมด แต่กดเมนูที่ต้องล็อกอินจะขึ้น "ไม่มีสิทธิ์"

### 4.2 เจ้าหน้าที่ สพป.แพร่ เขต 2 (สมาชิกทั่วไป)

สมัครที่หน้าเข้าสู่ระบบ → เลือก "เจ้าหน้าที่ สพป.แพร่ เขต 2" → รอ admin อนุมัติใน
แท็บ **รออนุมัติ** จึงจะล็อกอินได้ (`status` ต้องเป็น `active`)

**เมนูที่เข้าได้ทั้งหมด ยกเว้น** `เจ้าหน้าที่ในสำนักงาน` (admin เท่านั้น)
และ **ไม่เห็น** `travel-school` (หน้าสายสถานศึกษา)

| เมนู | ที่อยู่ | ทำอะไรได้ |
|---|---|---|
| ◷ ลงเวลาทำงาน | `#/clock` | ดูกะ/นาฬิกา ลงเวลาเข้า-ออกงาน ดูประวัติรายเดือน แก้ไขเวลาของคนอื่น (ต้องมีสิทธิ์ `can_approve`) |
| 🚐 จองยานพาหนะ | `#/vehicles` | จอง-ยกเลิก ดูสถานะรถ (ว่าง/มีผู้ใช้) จองซ้ำวันเดียวกันไม่ได้ แนบเอกสารประกอบ |
| ⌂ จองห้องประชุม | `#/rooms` | จองห้อง ดูปฏิทินรายวัน/สัปดาห์ ยกเลิกการจอง ผ่านระบบอนุมัติ 2 ขั้น |
| ✎ บันทึกข้อความ | `#/memos` | เขียนบันทึก (ตัวพิมพ์ + แนบไฟล์) ส่งผ่านการอนุมัติ ติดตามสถานะ แก้ไข/ถอนก่อนอนุมัติ |
| ✈ ขออนุญาตไปราชการ | `#/travel` | ยื่นคำขอเดินทาง (แนบหนังสือ) ติดตามสถานะแต่ละขั้น |
| ☀ ขออนุญาตลา | `#/leave` | ลาป่วย/กิจ/คลอด · ลาพักผ่อน · ดูยอดคงเหลือรายปีงบ ดูสถิติตามกลุ่มงาน |
| ฿ บริหารงบประมาณ | `#/budgets` | ดู/เพิ่ม/แก้ไขแผนงบประมาณรายโครงการ |
| 📖 บริหารงานวิชาการ | `#/academic` | โครงการและกิจกรรมทางวิชาการ |
| ✉ หนังสือราชการ | `#/documents` | ดูทะเบียนหนังสือรับ/ส่ง ส่งหนังสือไปหน่วยงานอื่น แนบไฟล์ ปั้มตราลง PDF |
| ⊞ / ⊙ ข้อมูลพื้นฐาน / พิกัดโรงเรียน | `#/office` `#/schools` | เหมือนบุคคลทั่วไป |

**สิทธิ์พิเศษที่ admin อาจตั้งให้**

| สิทธิ์ | ผล |
|---|---|
| `can_approve` | เห็นปุ่มอนุมัติในระบบที่ได้รับมอบหมาย (ต้องเป็นผู้อนุมัติของระบบนั้นด้วย) |
| ผู้ตรวจสอบไปราชการสายสถานศึกษา | เข้า `travel-school` ได้ |
| ผู้แก้ไขเวลาทำงาน | แก้เวลาเข้า-ออกของเจ้าหน้าที่คนอื่นในหน้า `#/clock` |

> สมัครใหม่มาเป็น `status = pending` เสมอ — backend ปฏิเสธการล็อกอิน (403) จนกว่า admin จะอนุมัติ

### 4.3 เจ้าหน้าที่สถานศึกษา

สมัครที่หน้าเข้าสู่ระบบ → เลือก **เจ้าหน้าที่สถานศึกษา**
กรอกข้อมูลให้ครบ (ชื่อ เลขบัตรประชาชน ตำแหน่ง **โรงเรียนที่ปฏิบัติงาน** ซึ่งเป็นตัวตั้ง `school_code`)

| เข้าได้ | เข้าไม่ได้ |
|---|---|
| ⊞ ข้อมูลพื้นฐาน | ◷ ลงเวลาทำงาน (สถานศึกษาไม่ใช้ระบบนี้) |
| ⊙ พิกัดโรงเรียน | 🚐 จองยานพาหนะ |
| ✉ หนังสือราชการ | ⌂ จองห้องประชุม |
| ✈ ไปราชการ (สถานศึกษา) `#/travel-school` | ✈ ไปราชการ (ฝั่ง สพป.) `#/travel` |
| | ✎ บันทึกข้อความ · ฿ งบประมาณ · 📖 วิชาการ · ☺ เจ้าหน้าที่ |

**ผู้อำนวยการสถานศึกษา** (`position` มีคำว่า "ผู้อำนวยการสถานศึกษา") เข้าเพิ่มได้:
`travel-school` และ `leave`

**หน้าหนังสือราชการของสถานศึกษาเห็น 4 แท็บ**

| แท็บ | ทำอะไรได้ |
|---|---|
| ▼ หนังสือรับ | ดูหนังสือที่ส่งเข้ามา |
| ▲ หนังสือส่ง | ดูหนังสือที่ตัวเองส่ง + ผู้รับ |
| ▭ ทะเบียนหนังสือรับ | เฉพาะผู้ที่ได้รับแต่งตั้งเป็น **สารบัญเขต** |
| ▭ ทะเบียนหนังสือส่ง | ลงทะเบียนหนังสือส่งของโรงเรียน |

**ปุ่มด้านบนของหน้าหนังสือราชการ (ฝั่งสถานศึกษา)**

- ▲ ส่งหนังสือไป สพป.แพร่ เขต 2 — สร้างหนังสือเป็น PDF แล้วเปิดหน้าต่างพิมพ์
- ▲ ส่งหนังสือไปสถานศึกษาในสังกัด — ส่งหนังสือของโรงเรียนไปโรงเรียนอื่น

**ปุ่มในแท็บทะเบียนหนังสือส่ง**

- ▭ ลงทะเบียนหนังสือส่ง — เลขที่หนังสือจะขึ้นต้นด้วย `ที่ ศธ 04110.` ตามที่ตั้งไว้
- 🔢 กำหนดเลขหนังสือสถานศึกษา — เฉพาะผู้ที่ได้รับแต่งตั้งเป็น **สารบัญสถานศึกษา**

**ฟิลด์ที่สถานศึกษาใช้เพิ่ม**

| ฟิลด์ | ความหมาย |
|---|---|
| `current_school` | สถานศึกษาที่เลือกตอนลงชื่อเข้า — ใช้แสดงช่อง "จาก" ในฟอร์มส่งหนังสือ |
| `workplace` | สถานศึกษาหลัก (8 หลักแรกคือ `school_code`) |
| `workplace_secondary` | JSON array ของสถานศึกษาที่ดูแลเป็นที่รอง |

### 4.4 ผู้ดูแลระบบ (admin)

บัญชีเริ่มต้น:

```
username: admin
password: Joey2343**
```

> **รหัสผ่านลงท้ายด้วย `**` สองตัว** — ถ้าพิมพ์แค่ `Joey2343` จะได้ 401
> (เปลี่ยนรหัสทันทีเมื่อใช้งานจริง)

ระบบใช้ **cookie session** (`credentials: 'same-origin'`) ไม่ใช้ Bearer token
ดังนั้นการเรียก `/api/...` ก่อน login จะได้ 401 เสมอ — เป็นพฤติกรรมที่ถูกต้อง ไม่ใช่บั๊ก

เข้าทุกเมนู รวมถึง `☺ เจ้าหน้าที่ในสำนักงาน` ซึ่งไม่มีบัญชีอื่นเข้าถึงได้
และผ่านทุกขั้นของระบบอนุมัติโดยไม่ต้องตั้งเป็นผู้อนุมัติ

**5 แท็บของหน้าเจ้าหน้าที่ (`#/staff`)**

| แท็บ | ทำอะไร |
|---|---|
| รออนุมัติ | อนุมัติ/ปฏิเสธสมาชิกใหม่ (แยกแท็บ สพป. / สถานศึกษา) ดูรูปและลายเซ็นก่อนตัดสิน |
| เจ้าหน้าที่ สพป.แพร่ เขต 2 | ค้นหา/กรองสถานะ · แก้ไขข้อมูลทั่วไป · เปลี่ยนบทบาท · รีเซ็ตรหัสผ่าน · อนุมัติเวลาทำงาน · ลบสมาชิก |
| เจ้าหน้าที่สถานศึกษา | เหมือนข้างบน แต่เป็นฝั่งสถานศึกษา |
| ตั้งค่าการอนุมัติ | กำหนดผู้อนุมัติแต่ละระบบ และจำนวนขั้น (1–3) |
| โหมดจำลองวันที่ | ตั้งวันที่ปัจจุบันจำลอง — ใช้ทดสอบงานที่ผูกกับวันเกิด/วันหมดอายุ |

**หน้าหนังสือราชการ (`#/documents`) admin เห็น 7 แท็บ**

▼ หนังสือรับ · ▲ หนังสือส่ง · ▭ ทะเบียนหนังสือรับ · ▭ ทะเบียนหนังสือส่ง ·
▭ ทะเบียนคำสั่ง · ▭ ทะเบียนหนังสือรับรอง · ▭ ทะเบียนเกียรติบัตร

**ปุ่มเฉพาะ admin ในหน้าหนังสือราชการ**

| ปุ่ม | ทำอะไร |
|---|---|
| ⊗ กำหนดเจ้าหน้าที่สารบัญเขต | เจ้าหน้าที่ฝั่ง สพป. ที่เห็นหนังสือจากสถานศึกษา + แท็บทะเบียนหนังสือรับ |
| ⊗ กำหนดเจ้าหน้าที่สารบัญสถานศึกษา | เลือกสถานศึกษา → เลือกเจ้าหน้าที่ที่รับหนังสือจาก สพป. |
| ⊛ ตั้งค่าเจ้าหน้าที่หนังสือราชการ | ทั้ง 2 ส่วนใน dialog เดียว (สพป. + สถานศึกษา) |
| ⊗ กำหนดเจ้าหน้าที่หนังสือรับรอง | ผู้ที่ลงทะเบียน/แก้ไข/ลบหนังสือรับรองได้ |

**ขั้นตอนให้สิทธิ์อนุมัติแก่เจ้าหน้าที่ทั่วไป**

1. หน้า **เจ้าหน้าที่** → แท็บ **ตั้งค่าการอนุมัติ** → เลือกผู้อนุมัติของแต่ละระบบ (ขั้นที่ 1/2/3)
2. หน้า **เจ้าหน้าที่** → แท็บฝั่งที่เกี่ยวข้อง → กดแก้ไขสมาชิก → ติ๊ก **can_approve**
3. ลบผู้ใช้ออกจากรายชื่อผู้อนุมัติของระบบนั้น = สิทธิ์หมดอัตโนมัติ

> ห้องประชุม + ยานพาหนะ ใช้รายชื่อผู้อนุมัติชุดเดียวกัน (`approvers_booking`) ตั้งครั้งเดียวใช้ได้ทั้ง 2 ระบบ

### 4.5 บทบาทพิเศษอื่น ๆ (ตั้งโดย admin ไม่ใช่ role แยก)

| บทบาท | เกิดจาก | สิทธิ์พิเศษ |
|---|---|---|
| สารบัญเขต | ⊗ กำหนดเจ้าหน้าที่สารบัญเขต | เห็นหนังสือที่สถานศึกษาส่งมาให้ สพป. เข้าแท็บทะเบียนหนังสือรับ |
| สารบัญสถานศึกษา | ⊗ กำหนดเจ้าหน้าที่สารบัญสถานศึกษา | เข้าแท็บทะเบียนหนังสือรับ + กำหนดเลขหนังสือสถานศึกษา |
| เจ้าหน้าที่หนังสือรับรอง | ⊗ กำหนดเจ้าหน้าที่หนังสือรับรอง | ลงทะเบียนหนังสือรับรอง แก้ไข/ลบ/เปลี่ยนสถานะ ได้ |
| ผู้ตรวจสอบไปราชการสายสถานศึกษา | ตั้งในระบบอนุมัติ | เข้า `#/travel-school` ได้แม้เป็นเจ้าหน้าที่ สพป. |
| ผู้ลงนามเกียรติบัตร | `position` = ผู้อำนวยการ / รองผู้อำนวยการ | เลือกได้ใน dropdown ผู้ลงนามเกียรติบัตร |

---

## 5. ระบบอนุมัติหลายขั้น

ทุกระบบ (ยานพาหนะ · ห้องประชุม · ไปราชการ · ลา · บันทึกข้อความ)
ใช้โครงสร้างเดียวกัน ตั้งจำนวนขั้นได้ 1–3 ขั้น

| ขั้น | ชื่อ | หมายเหตุ |
|---|---|---|
| 1 | ผู้ตรวจสอบ | ตรวจความถูกต้องของเอกสาร |
| 2 | ผู้อนุมัติขั้นต้น | เห็นแผนงบ/รายละเอียดการใช้จ่าย |
| 3 | ผู้อนุมัติ | อนุมัติสุดท้าย |

- ห้องประชุม + ยานพาหนะ ใช้รายชื่อผู้อนุมัติชุดเดียวกัน (`approvers_booking`)
- ค่าเริ่มต้น: `approval_vehicle=2`, `approval_room=2`, `approval_travel=1`, `approval_leave=1`
- ผู้ขออนุมัติต้องมี `can_approve` ก่อน (ยกเว้น admin ที่ผ่านทุกขั้น)

---

## 6. โครงสร้างโปรเจกต์

```
ph2_project/
├── backend/
│   ├── server.js              entry point · เสิร์ฟ API + static
│   ├── db.js                  schema · migration · seed · สลับ SQLite/MySQL
│   ├── lib/
│   │   ├── db-adapter.js      async DB ที่ใช้ร่วมกันได้ทั้ง 2 dialect
│   │   ├── year-filter.js     ตัวช่วยกรองปี พ.ศ.
│   │   ├── approvals.js       ตรรกะอนุมัติหลายขั้น
│   │   ├── auth.js            hash / session
│   │   └── simdate.js         นาฬิกาจำลอง (ต้อง install ก่อนโค้ดที่ใช้ Date)
│   ├── routes/                auth · content · ops · requests · admin
│   ├── public/                uploads · logo.png
│   ├── font/ form/            ฟอนต์ + แบบเอกสาร เสิร์ฟที่ /fonts และ /form
│   ├── scripts/               verify.js · migrate-to-mysql.js · inspect-db.js
│   └── test/                  smoke.js · parity.js
├── frontend/
│   ├── src/
│   │   ├── main.js            bootstrap (Pinia · router · global เดิมบน window)
│   │   ├── App.vue
│   │   ├── pages/             14 หน้าเป็น Vue SFC
│   │   ├── components/
│   │   │   ├── ui/            AppModal · ThaiDateField · FilePicker · Memo*/Leave*/Travel*
│   │   │   └── documents/     11 component ของเมนูหนังสือราชการ
│   │   ├── lib/               documents · documents-form · cert-print-css · memo · pdfjs
│   │   ├── router/            registry.js (ตารางเส้นทาง) · menus.js · index.js
│   │   ├── stores/            auth (Pinia) · session
│   │   ├── ui/ui.js           UI kit เดิม — ห้ามลดรูป
│   │   └── views/             registry.js + DocumentsView.js (2 ฟอร์ม PDF)
│   └── scripts/               verify-*.mjs · check-registry.mjs · port-frontend.mjs
├── docs/legacy/
│   ├── source-v1/             ต้นฉบับระบบเดิม (อ้างอิง + เทียบ CSS)
│   └── ported-views/          ผลลัพธ์ npm run port (ไม่ได้ import)
└── docker-compose.yml         MySQL 3307 + MariaDB 3308
```

---

## 7. คำสั่งที่ใช้บ่อย

### backend

| คำสั่ง | ทำอะไร |
|---|---|
| `npm start` | เปิดเซิร์ฟเวอร์ |
| `npm run dev` | `node --watch` เปิดใหม่เองเมื่อไฟล์เปลี่ยน |
| `npm test` | ทดสอบ endpoint บน SQLite |
| `npm run test:parity` | เทียบผลลัพธ์ SQLite ↔ MySQL |
| `npm run db:inspect` | ดูตาราง/คอลัมน์/จำนวนแถว |
| `npm run db:init` | สร้าง schema + migration + seed |
| `npm run db:migrate-sqlite` | ย้ายข้อมูล SQLite → MySQL |
| `node scripts/verify.js --with-mysql` | ตรวจครบทั้ง 2 dialect |

### frontend

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run dev` | Vite dev server (proxy `/api` → :3000) |
| `npm run build` | build เป็น `dist/` |
| `npm run verify:registry` | ตรวจ registry — key ซ้ำ · kind ตรงกัน · ไฟล์มีอยู่ |
| `npm run verify:build` | ตรวจ `dist/` + SHA256 ของ theme.css |
| `npm run verify:pages` | ตรวจทุกหน้า Vue แบบละเอียด (เปิด Chrome จริง) |
| `npm run verify:runtime` | ตรวจทุกเมนู + จับ runtime error |
| `npm run verify:auth` | ตรวจหน้าเข้าสู่ระบบ/ลงทะเบียน |
| `npm run verify:all` | ทุกชุด (ต้องรัน backend อยู่) |
| `npm run port` | แปลงซอร์สรุ่นเดิม → `docs/legacy/ported-views/` |
| `npm run probe` | ดู route resolution ของหน้าที่ระบุ |

### เครื่องมือช่วยตรวจใน `frontend/scripts/`

| สคริปต์ | ใช้ทำอะไร |
|---|---|
| `check-braces.mjs` | นับวงเล็บปีกกาโดยข้าม comment/string — ใช้ตอน `node --check` บอก "Unexpected end of input" แต่บอกไม่ได้ว่าบรรทัดไหน |
| `dump-page.mjs` | dump DOM ของหน้าเว็บ |
| `probe-route.mjs` | ตรวจว่า key หนึ่งถูก route ไปที่ Vue หรือ legacy |

> `verify:pages` / `verify:runtime` ต้องรัน backend ไว้ก่อน และต้องมี Chrome หรือ Edge
> ถ้า fail ให้เพิ่ม `--dump <keys>` เพื่อดู DOM/runtime จริง (ดูหัวข้อ 10)

---

## 8. ข้อควรรู้เรื่องข้อมูล

- **ปี พ.ศ.** — ทุก endpoint ที่มีตัวกรองปีรับ `year` เป็น พ.ศ. และกรองด้วยช่วงวันที่จริง
  (เคยพบบั๊กที่ใช้ `doc_no LIKE '%/2569%'` ซึ่งผิด เพราะเลขที่หนังสือไม่ได้ผูกกับปีเสมอ)
  ใช้ `backend/lib/year-filter.js` เสมอ
- **หมายเหตุเรื่องปี** — ย้ายข้อมูล SQLite → MySQL ต้องรัน `npm run db:migrate-sqlite`
  ปัจจุบันมี 247 แถว จาก 23 ตาราง ผ่าน parity check แล้ว
- **ไฟล์อัปโหลด** — เก็บที่ `backend/public/uploads/` เสิร์ฟที่ `/uploads/...`
- **สิทธิ์แก้ไขรายการ** — admin · สารบัญเขต · เจ้าของรายการเท่านั้น
  (หนังสือรับรอง: เจ้าหน้าที่หนังสือรับรองเท่านั้นที่แก้ได้)
- **localStorage** — เก็บแท็บ/หน้าที่เคยค้างไว้ของหนังสือราชการ ล้างได้จาก DevTools

---

## 9. งานที่ทำแล้ว — อย่าย้อนกลับไปแก้ซ้ำ

| เรื่อง | สถานะ |
|---|---|
| ย้ายทุกหน้าเป็น Vue SFC | เสร็จ (14 เมนู) |
| Dialog เมนูหนังสือราชการ | เสร็จ 11 component (รวมตัวปั้มตรา) |
| ลบ `src/views/*.View.js` ที่ไม่มีใคร import | เสร็จ (ลบ 12 ไฟล์) |
| ย้าย `DocumentsView.openForm` + `saveForm` | เสร็จ (3 component) |
| ลบ `stamp-editor-bridge.js` | เสร็จ (ไม่ต้องมีสะพานอีก) |
| ปรับ `npm run port` ไม่ให้สร้างไฟล์ตายใน `src/` | เสร็จ (เขียนไป `docs/legacy/ported-views/`) |
| `DocumentsView.openSendForm` / `openPostalForm` | **ยังไม่ย้าย** — เหตุผลด้านล่าง |

**ทำไม 2 ฟอร์มสุดท้ายยังไม่ย้าย**
ทั้งคู่สร้าง PDF ทั้งฉบับด้วย `pdf-lib` (ฝังรูปโลโก้ ลายเซ็น เขียนทับหน้า)
แล้ว `window.open` เขียนเอกสารลงหน้าต่างใหม่ — Vue SFC ไม่ได้ช่วยอะไรกับส่วนนี้
การแยกเป็น component จะได้แค่โค้ดเดิมที่ย้ายไปอยู่ไฟล์อื่น ถ้าจะทำต่อให้ทำเป็นรอบแยกโดยเฉพาะ

---

## 10. เช็กลิสต์ก่อนจบงาน

```bash
# 1) ไม่มี U+FFFD ในไฟล์ที่แก้
node -e "const fs=require('fs'),p=require('path');
(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){
 if(['node_modules','dist'].includes(e.name))continue;const f=p.join(d,e.name);
 e.isDirectory()?w(f):/\.(js|vue)\$/.test(e.name)&&((fs.readFileSync(f,'utf8').match(/�/g)||[]).length&&console.log('BAD',f));
}})('frontend/src');console.log('done')"

# 2) build + verify ครบ (ต้องเปิด backend ไว้ในเทอร์มินัลอีกตัว)
cd frontend && npm run build
npm run verify:registry
npm run verify:build -- --server
npm run verify:pages
npm run verify:runtime
npm run verify:auth
# หรือทุกอย่างรวดเดียว:  npm run verify:all

# 3) backend (MySQL ต้องรันอยู่ก่อน)
cd ../backend
node scripts/verify.js --with-mysql
```

**ผลที่ถือว่าผ่าน (ยืนยันล่าสุด)**

| ตรวจ | ผล |
|---|---|
| `check-registry` | ผ่าน 6 · ไม่ผ่าน 0 (`vue 14 · legacy 0`) |
| `npm run build` | ผ่าน 366 modules |
| `verify-build --server` | ผ่าน 40/40 |
| `verify-vue-pages --all` | ผ่าน **183** · ไม่ผ่าน 0 |
| `verify-runtime --all` | ผ่าน 21/21 |
| `verify-runtime --auth` | ผ่าน 59/59 |
| `backend/verify.js --with-mysql` | ผ่าน 15/15 (SQLite ↔ MySQL parity) |

ถ้าแตะ `verify:pages` หรือ `verify:runtime` แล้วได้ exit ≠ 0
ให้เพิ่ม `--dump <keys>` เพื่อดู DOM/runtime จริง:

```bash
node scripts/verify-vue-pages.mjs --dump documents
node scripts/dump-page.mjs --url '#/leave'
```

> PowerShell กับ npm: ถ้าเห็น `FullyQualifiedErrorId : NativeCommandError` แต่ `exit=0`
> แปลว่าผ่าน — เป็นแค่ stderr ของ npm ที่ถูกหยิบมาแสดง
