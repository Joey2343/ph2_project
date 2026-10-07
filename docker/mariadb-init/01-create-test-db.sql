-- สคริปต์เตรียมฐานข้อมูลสำหรับ dev/test (รันอัตโนมัติตอน container เริ่มครั้งแรก)
--
-- สร้างฐานทดสอบ admin_ph2_test แยกจาก admin_ph2
-- เพราะ test/smoke.js เขียนและลบข้อมูล (POST /api/time/check) ถ้าใช้ฐานจริง
-- จะไปลบบันทึกลงเวลาของพนักงานได้ โค้ดจึงปฏิเสธทำงานถ้าชื่อฐานไม่ลงท้าย _test
--
-- หมายเหตุ: ไฟล์นี้รันเฉพาะตอน datadir ว่าง (ครั้งแรกเท่านั้น)
-- ถ้าลบ volume แล้ว up ใหม่ จะได้ฐานทั้งสองพร้อมข้อมูลตั้งต้นครบ

CREATE DATABASE IF NOT EXISTS `admin_ph2_test`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_bin;

GRANT ALL PRIVILEGES ON `admin_ph2_test`.* TO 'admin_ph2'@'%';

FLUSH PRIVILEGES;