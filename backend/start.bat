@echo off
title ระบบศูนย์กลางการบริหารจัดการ สพป.แพร่ เขต 2
cd /d "%~dp0"

rem ─────────────────────────────────────────────────────────────────────────────
rem  เริ่มระบบ backend
rem  ใช้ฐานข้อมูลตามที่ตั้งใน .env (ถ้าไม่มีจะใช้ SQLite ที่ backend\data.db)
rem ─────────────────────────────────────────────────────────────────────────────

if not exist ".env" (
  echo.
  echo  [!] ไม่พบไฟล์ .env — จะใช้ SQLite ที่ data.db (ค่าเริ่มต้น)
  echo      ถ้าต้องการใช้ MySQL ให้คัดลอก .env.example เป็น .env แล้วแก้ค่า
  echo.
)

where node >nul 2>nul
if %errorlevel%==0 (
  node server.js
  goto :end
)

rem ── ไม่มี Node.js ใน PATH — ลองใช้ตัวที่มากับโปรเจกต์ (ถ้ามี) ────────────────
if exist ".\runtime\node\node.exe" (
  echo [i] ใช้ Node.js จาก runtime\node\node.exe
  ".\runtime\node\node.exe" server.js
  goto :end
)

echo.
echo  **************************************************************
echo  *  ไม่พบ Node.js ในเครื่องนี้                              *
echo  *                                                            *
echo  *  กรุณาติดตั้ง Node.js 22 ขึ้นไปจาก https://nodejs.org    *
echo  *  (ต้องเป็น 22 ขึ้นไป เพราะระบบใช้โมดูล node:sqlite)      *
echo  **************************************************************
echo.
pause

:end
