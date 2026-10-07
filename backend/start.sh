#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  เริ่มระบบ backend
#  ต้องมี DATABASE_URL ใน .env ที่ชี้ MariaDB 11.4
# ─────────────────────────────────────────────────────────────────────────────
cd "$(dirname "$0")" || exit 1

if [ ! -f ".env" ]; then
  echo "[!] ไม่พบไฟล์ .env — ระบบต้องมี DATABASE_URL จึงจะทำงานได้"
  echo "    คัดลอก .env.example เป็น .env แล้วแก้ค่า DATABASE_URL"
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
echo "*  (ต้องเป็น 22 ขึ้นไป)                                     *"
echo "**************************************************************"
exit 1
