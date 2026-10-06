#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  เริ่มระบบ backend
#  ใช้ฐานข้อมูลตามที่ตั้งใน .env (ถ้าไม่มีจะใช้ SQLite ที่ backend/data.db)
# ─────────────────────────────────────────────────────────────────────────────
cd "$(dirname "$0")" || exit 1

if [ ! -f ".env" ]; then
  echo "[!] ไม่พบไฟล์ .env — จะใช้ SQLite ที่ data.db (ค่าเริ่มต้น)"
  echo "    ถ้าต้องการใช้ MySQL ให้คัดลอก .env.example เป็น .env แล้วแก้ค่า"
  echo
fi

if command -v node >/dev/null 2>&1; then
  exec node server.js
fi

if [ -x "./runtime/node/bin/node" ]; then
  echo "[i] ใช้ Node.js จาก runtime/node/bin/node"
  exec ./runtime/node/bin/node server.js
fi

echo "**************************************************************"
echo "*  ไม่พบ Node.js                                            *"
echo "*                                                           *"
echo "*  กรุณาติดตั้ง Node.js 22 ขึ้นไปจาก https://nodejs.org     *"
echo "*  (ต้องเป็น 22 ขึ้นไป เพราะระบบใช้โมดูล node:sqlite)       *"
echo "**************************************************************"
exit 1
