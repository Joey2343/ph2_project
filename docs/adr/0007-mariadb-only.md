# ADR-0007 · ใช้ MariaDB 11.4 ตัวเดียว ถอด SQLite และ MySQL ออก

**สถานะ:** ตัดสินใจแล้ว · **วันที่:** 2026-10-07

## บริบท

ระบบเดิมรองรับฐานข้อมูล 2 ชนิด คือ SQLite (ตอนพัฒนา) และ MySQL/MariaDB (ตอน deploy)
ทำให้ทุกจุดต้องระวังความต่างของสอง dialect และต้องมีชั้นแปลง SQL กลาง

ผลที่ตามมา:

- **เขียนโค้ดยากขึ้น** — ต้องจำว่า `ON CONFLICT` กับ `ON DUPLICATE KEY`,
  `INSERT OR IGNORE` กับ `INSERT IGNORE`, `CAST(... AS INTEGER)` กับ `AS SIGNED`
  และ `substr` กับ `SUBSTRING`
- **ชั้นแปลงซ่อนความต่าง** — `db/sql.js` แปลง DDL และ DML ทำให้อ่าน schema
  ที่ประกาศไว้แล้วไม่เห็นว่าฐานจริงเป็นแบบไหน
- **เพิ่มงานที่ต้องทำซ้ำ** — ต้องมีทั้ง parity test, migration script
  และเครื่องมือ probe dialect
- **เซิร์ฟเวอร์ใช้ MariaDB 11.4 LTS** อยู่แล้ว ไม่ใช่ MySQL

## การตัดสินใจ

**ใช้ MariaDB 11.4 ตัวเดียว** ทั้งตอนพัฒนาและตอน deploy

- ถอด `backend/db/driver-sqlite.js` และ `backend/db/sql.js` (ชั้นแปลง) ออก
- เขียน `SCHEMA_SQL` ใน `db.js` เป็น DDL ของ MariaDB จริง
- `COLUMN_MIGRATIONS` เป็นชนิด MariaDB เต็มรูปแบบ
- แก้ SQL ใน `routes/` ทั้งหมดให้เป็น MariaDB
- ตัวทดสอบใช้ฐานที่ลงท้าย `_test` แยกจากฐานจริงเสมอ

## เหตุผล

1. **ตรงกับเซิร์ฟเวอร์จริง** — dev กับ production ใช้ชนิดเดียวกัน
   บั๊กที่เกิดเฉพาะ dialect หายไปในระบบ
2. **ไม่มีชั้นแปลงแล้ว** — อ่าน `SCHEMA_SQL` แล้วเห็น schema จริง
   ไม่ต้องเดาว่าตัวแปลงเปลี่ยนอะไร
3. **CI ทดสอบตรงจุด** — เดิม `test/parity.js` เปรียบเทียบสอง dialect
   ซึ่งบังคับให้ CI ต้องมีทั้งสองฐาน ตอนนี้ใช้ MariaDB service container
   ชนิดเดียวกับ production
4. **เครื่องมือน้อยลง** — ลบได้ 24 ไฟล์ (driver, translator, parity,
   migration, codemod, probe)

## ผลกระทบ

### บวก

- โค้ดที่อ่านเข้าใจได้เลย ไม่ต้องแปลงอะไรก่อนรัน
- บั๊กจำพวก "SQLite ทำได้ แต่ MariaDB ทำไม่ได้" หายไป
- ลดพื้นที่โค้ด ~400 บรรทัดจากชั้นแปลงและเครื่องมือ
- GitHub Actions ใช้ MariaDB 11.4 ตรงกับ production เป๊ะ

### ลบ

- ฐานว่างไม่ได้มาด้วย `node start` เปล่า ๆ ต้องมี MariaDB ก่อนเสมอ
- ผู้ที่เคยรันด้วย SQLite ต้องติดตั้ง MariaDB ก่อนครั้งแรก

### ต้องระวัง

- `INSERT IGNORE` ของ MariaDB กลืน error อื่นด้วย (เช่น ข้อมูลยาวเกิน)
  ต่างจาก `INSERT OR IGNORE` ของ SQLite ที่ข้ามเฉพาะข้อมูลซ้ำ
- `||` ต่อสตริงได้เพราะตั้ง `PIPES_AS_CONCAT` ใน `sql_mode`
  ถ้าเปลี่ยน `DB_SQL_MODE` ต้องระวังเรื่องนี้
- ยังต้องเก็บ `ONLY_FULL_GROUP_BY` **ออก** เพราะมี GROUP BY ที่ไม่ aggregate
  ทุกคอลัมน์อยู่ในโค้ดเดิม

## ทางเลือกที่พิจารณาแล้วไม่เลือก

| ทางเลือก | เหตุผลที่ไม่เลือก |
|---|---|
| คง 2 dialect ไว้ | ยังต้องเดาว่าโค้ดรันบนฐานไหน ปัญหาเดิมไม่หาย |
| คง SQLite เป็นตัวหลักตอน dev | dev กับ production คนละชนิด บั๊กจะหลุดตอน deploy |
| เปลี่ยนเป็น MySQL 8 | production ใช้ MariaDB อยู่แล้ว สร้างความต่างใหม่ |

## ผลกระทบต่อการเพิ่ม schema

ดูหัวข้อ "เพิ่ม schema ต้องทำอะไร" ใน `AGENTS.md`

## บันทึกเดิมที่ถูกแทนที่

- ADR-0004 (dialect adapter)
- ADR-0006 (DDL translation)