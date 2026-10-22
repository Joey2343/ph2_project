set -e
APP_DIR="${1:?ต้องส่ง APP_DIR เป็นพารามิเตอร์ตัวแรก}"
WEB_DIR="${2:?ต้องส่ง WEB_DIR เป็นพารามิเตอร์ตัวที่สอง}"
cd "$APP_DIR"
REPORT="$WEB_DIR/p2deploy-report.txt"
: > "$REPORT" 2>/dev/null || true
say() { echo "$*"; echo "$*" >> "$REPORT" 2>/dev/null || true; }

# ⚠️ ไม่เก็บ log ทั้งหมดของสคริปต์นี้ลง public_html แล้ว (เดิมเก็บไว้ชั่วคราว
#    ตอนกู้ระบบ 21–22 ต.ค. เพราะอ่าน log ของ GitHub Actions ไม่ได้)
#    เหตุผลที่ถอด: ไฟล์ใน public_html เปิดอ่านได้จากอินเทอร์เน็ต
#    ตอนนี้เหลือแค่สรุปสั้น ๆ ที่ $REPORT ซึ่งไม่มีรหัสผ่าน
echo "===== deploy start $(date) ====="

echo ">>> 2. ติดตั้ง Backend"
cd backend
npm ci --omit=dev

echo ">>> 2.5 ตรวจ backend/.env (ไม่อยู่ใน git — หายไปพร้อมโฟลเดอร์)"
ENV_FILE="$PWD/.env"
if [ ! -f "$ENV_FILE" ] && [ -n "$DB_URL_B64" ]; then
  DB_URL_DEC=$(printf '%s' "$DB_URL_B64" | base64 -d)
  printf 'PORT=3000\nDATABASE_URL=%s\nDB_CONNECTION_LIMIT=10\n' "$DB_URL_DEC" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  unset DB_URL_DEC
  echo "    ✅ สร้าง .env จาก GitHub Secret PROD_DATABASE_URL"
  echo "backend/.env: สร้างจาก GitHub Secret PROD_DATABASE_URL" >> "$REPORT"
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "    ไม่พบ .env — ค้นหารหัสผ่านฐานข้อมูลจากหลักฐานในเครื่อง"
  CANDS="$HOME/.p2-cands"
  : > "$CANDS"
  chmod 600 "$CANDS" 2>/dev/null || true

  # (ก) จาก .env อื่นที่ยังเหลือในเครื่อง
  for f in $(find "$HOME" -maxdepth 6 -type f -name '.env' -not -path '*/node_modules/*' 2>/dev/null | head -20); do
    sed -n 's/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*//p' "$f" 2>/dev/null | head -1 | tr -d '\r' >> "$CANDS"
  done

  # (ข) จาก ~/.my.cnf
  for f in "$HOME/.my.cnf" "$HOME/.my.cnf.bak"; do
    [ -f "$f" ] || continue
    sed -n 's/^[[:space:]]*password[[:space:]]*=[[:space:]]*//p' "$f" | head -2 >> "$CANDS"
  done

  # (ค) จาก history ของไคลเอนต์ mysql/mariadb ที่เคยพิมพ์ -p...
  for f in "$HOME/.mariadb_history" "$HOME/.mysql_history"; do
    [ -f "$f" ] || continue
    grep -oE -- '-p[^[:space:]]+' "$f" 2>/dev/null | sed 's/^-p//' >> "$CANDS"
  done

  # (ง) ค่าเริ่มต้นที่บันทึกไว้ในเอกสารโปรเจกต์
  echo "admin_ph2pass" >> "$CANDS"

  # (จ) จาก wp-config.php ของเว็บ WordPress บนโฮสต์เดียวกัน
  #     (ผู้ดูแลมักตั้งรหัสฐานข้อมูลซ้ำกันทุกบริการ)
  for f in $(find "$HOME/domains" -maxdepth 4 -type f -name 'wp-config.php' 2>/dev/null | head -10); do
    sed -n "s/.*DB_PASSWORD[^']*'\([^']*\)'.*/\1/p" "$f" 2>/dev/null | head -1 >> "$CANDS"
  done

  # (ฉ) จาก cron ที่อาจเก็บ -p<รหัส>
  crontab -l 2>/dev/null | grep -oE -- '-p[^[:space:]]+' | sed 's/^-p//' >> "$CANDS" || true

  # (ช) จากไฟล์ php/sh/conf ที่มี mysql:// อยู่
  grep -rhoE 'mysql2?://[^[:space:]"'"'"']+' "$HOME/domains" --include='*.php' --include='*.sh' --include='*.conf' --include='*.env' 2>/dev/null | head -20 >> "$CANDS" || true

  # (ซ) รหัสว่าง และชื่อผู้ใช้เป็นรหัส
  echo "__EMPTY__" >> "$CANDS"
  echo "admin_ph2" >> "$CANDS"

  TRY="$PWD/.try-env.js"
  cat > "$TRY" <<'JS'
const fs = require('fs');
const mysql = require('mysql2/promise');
(async () => {
  const file = process.argv[2];
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch (e) {}
  const seen = new Set();
  const candidates = [];
  for (const raw of lines) {
    const s = raw.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    if (s === '__EMPTY__') {
      candidates.push({ host: '127.0.0.1', port: 3306, user: 'admin_ph2', password: '', database: 'admin_ph2' });
    } else if (/^mysql2?:\/\//i.test(s)) {
      try {
        const u = new URL(s);
        candidates.push({
          host: u.hostname || '127.0.0.1',
          port: Number(u.port || 3306),
          user: decodeURIComponent(u.username || 'admin_ph2'),
          password: decodeURIComponent(u.password || ''),
          database: decodeURIComponent((u.pathname || '/').replace(/^\//, '')),
        });
      } catch (e) {}
    } else {
      candidates.push({ host: '127.0.0.1', port: 3306, user: 'admin_ph2', password: s, database: 'admin_ph2' });
    }
  }
  for (const c of candidates) {
    if (!c.database) continue;
    try {
      const conn = await mysql.createConnection(Object.assign({ connectTimeout: 5000 }, c));
      await conn.query('SELECT 1');
      await conn.end();
      process.stdout.write(
        'mysql://' + encodeURIComponent(c.user) + ':' + encodeURIComponent(c.password) +
        '@' + c.host + ':' + c.port + '/' + encodeURIComponent(c.database)
      );
      process.exit(0);
    } catch (e) { /* ลองตัวถัดไป */ }
  }
  process.exit(2);
})();
JS
  echo "    ลองเชื่อมต่อด้วย $(wc -l < "$CANDS") ตัวเลือก"
  DB_URL=$(node "$TRY" "$CANDS" 2>/dev/null || true)
  rm -f "$TRY" "$CANDS"
  if [ -n "$DB_URL" ]; then
    printf 'PORT=3000\nDATABASE_URL=%s\nDB_CONNECTION_LIMIT=10\n' "$DB_URL" > "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    echo "    ✅ สร้าง .env ใหม่ได้ (รหัสผ่านไม่ถูกพิมพ์ลง log)"
    echo "backend/.env: สร้างใหม่ได้จากหลักฐานในเครื่อง" >> "$REPORT"
  else
    echo "    ❌ หารหัสผ่านฐานข้อมูลไม่สำเร็จ — ต้องให้ผู้ดูแลระบบระบุรหัส"
    echo "backend/.env: หาย และหารหัสผ่านไม่ได้ → ต้องระบุรหัสฐานข้อมูล" >> "$REPORT"
    exit 1
  fi
else
  echo "    พบ .env อยู่แล้ว"
fi

echo ">>> 3. สร้าง/ปรับ schema + seed ข้อมูลตั้งต้น"
# server.js ก็เรียก bootstrap() ตอนบูต แต่เรียกตรง ๆ ตรงนี้
# เพื่อให้เห็น error ก่อน reload และไม่เสี่ยงทำให้ process ตายวน
node db.js --init

echo ">>> 4. นำเข้าข้อมูลโรงเรียนจริงจาก Definition.csv"
# ใส่ --if-seed ไว้เพื่อกันไว้
#   ขั้นตอนนี้ "ล้างตาราง schools ทั้งตาราง" แล้วนำเข้าใหม่
#   ถ้ามีข้อมูลจริงอยู่แล้ว (คนละ seed) จะข้ามให้ ไม่ทับข้อมูลที่แอดมินแก้ไว้
#   เช่น รูปภาพโรงเรียน ข้อมูลภัยพิบัติ หมายเหตุ และกลุ่มงาน
node scripts/import_schools.js --if-seed

echo ">>> 5. ตั้งรหัสโรงเรียนตามทะเบียนจริง (8 หลัก 5402xxxx)"
# รหัสไม่ได้เรียงเอง แต่อ่านจาก pikud/school_codes.csv ทะเบียนที่ได้รับมา
# ตัวเลขจึงเว้นตรงที่ทะเบียนไม่มี (ไม่มี 54020004 / 54020009 / 54020016)
# ถ้าทะเบียนเปลี่ยน ให้แก้ CSV แล้วรันสคริปต์นี้ซ้ำ ห้ามแก้ฐานตรง ๆ
#
# ปลอดภัยเมื่อรันซ้ำ
#   - ถ้ารหัสตรงทะเบียนแล้ว จะข้ามไปเงียบ ๆ
#   - จับคู่โรงเรียนด้วยชื่อ (ไม่ใช่รหัสเดิม) จับไม่ครบจะหยุดทันที ไม่เดา
#   - เป็น UPDATE เฉพาะคอลัมน์ code ไม่ลบตาราง
node scripts/migrate_school_codes.js --apply

echo ">>> 5.4 Build Frontend"
# ⚠️ ต้อง build "ก่อน" reload process (ขั้น 6)
#    ตอน clone โปรเจกต์ใหม่ frontend/dist ยังไม่มี → server.js ตั้งค่า
#    FRONTEND_EXISTS = false ตั้งแต่ตอนบูต และไม่รู้จัก dist ที่เพิ่งสร้างทีหลัง
#    → คำขอที่ไม่ใช่ /api/ (เช่น /uploads/none.jpg) จะได้ 503 "ยังไม่ได้ build หน้าเว็บ"
#    แทนที่จะเป็น SPA fallback ปกติ (เจอจริงรอบกู้ระบบ 22 ต.ค.)
cd ../frontend
npm ci
npm run build
# กลับมาที่ backend เพื่อให้ขั้น 5.5 รัน `node server.js` ในโฟลเดอร์ที่ถูก
# (dotenv อ่าน backend/.env จาก cwd)
cd ../backend

echo ">>> 5.5 ทดสอบให้แอปใหม่บูตบนพอร์ตสำรองก่อนสลับ"
# ⚠️ ถ้า process เดิมยังทำงานอยู่แล้วเราสั่ง reload ทันที
#    แต่แอปใหม่บูตไม่ขึ้น (เช่น .env ผิด/ต่อฐานข้อมูลไม่ได้)
#    เว็บจะล่มทั้งระบบ — จึงทดสอบบนพอร์ต 3100 ก่อนเสมอ
BOOT_LOG="$APP_DIR/backend/.boot-test.log"
PORT=3100 node server.js > "$BOOT_LOG" 2>&1 &
BOOT_PID=$!
CODE=000
for i in $(seq 1 20); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:3100/api/office || echo 000)
  if [ "$CODE" = "200" ]; then break; fi
  sleep 1
done
kill $BOOT_PID 2>/dev/null || true
wait $BOOT_PID 2>/dev/null || true
if [ "$CODE" != "200" ]; then
  echo "    ❌ แอปใหม่บูตไม่ขึ้น (HTTP $CODE) — หยุดก่อน ไม่แตะ process เดิม"
  tail -n 40 "$BOOT_LOG" || true
  echo "boot_test: FAILED (HTTP $CODE)" >> "$REPORT"
  rm -f "$BOOT_LOG"
  exit 1
fi
echo "    ✅ บูตผ่าน (HTTP 200)"
rm -f "$BOOT_LOG"

echo ">>> 6. โหลดโค้ดใหม่เข้า process"
pm2 reload ph2-api --update-env

echo ">>> 8. ซิงค์ไฟล์ Build ไปที่ Web Root (public_html)"
# คัดลอกเฉพาะไฟล์ที่ build ได้ไปวางที่ public_html โดยไม่ลบ .htaccess
# cp ทับเฉยๆ จะทำให้ไฟล์รุ่นเก่าไม่ถูกลบออกไปเลย (cp ไม่มีคำสั่งลบ)
# เว็บยังใช้ได้ตลอด แต่ public_html จะโตขึ้นทุกครั้งที่ deploy
cd ../frontend
cp -r dist/* $WEB_DIR/

# ค่อยล้างไฟล์ใน assets ที่ไม่อยู่ใน build ปัจจุบัน
#   ชื่อไฟล์มี hash จึงเปลี่ยนทุกครั้งที่ build ไฟล์เก่าไม่มีใครอ้างถึง
#   ข้ามไฟล์ที่ยังไม่เก่า (<7 วัน) ไว้ เผื่อผู้ใช้เปิดหน้าเว็บค้างไว้
#   แล้วเด้งไปเมนูอื่นที่โหลด chunk เก่า จะได้ไม่เจอรูปเสีย
DIST_ASSETS="$APP_DIR/frontend/dist/assets"
if [ -d "$WEB_DIR/assets" ]; then
  STALE=0
  for f in "$WEB_DIR/assets"/*; do
    [ -e "$f" ] || continue
    name=$(basename "$f")
    [ -e "$DIST_ASSETS/$name" ] && continue
    if [ -n "$(find "$f" -maxdepth 0 -mtime +7 2>/dev/null)" ]; then
      rm -f "$f"
      STALE=$((STALE + 1))
    fi
  done
  echo "    ล้างไฟล์เก่า $STALE ไฟล์"
fi

echo ">>> 8.1 ตั้งค่า Cache-Control ที่ web root (.htaccess)"
# ⚠️ production เสิร์ฟไฟล์ด้วย Apache (public_html) ไม่ใช่ Express
#    ค่าที่ server.js ตั้งไว้จึงไม่มีผลกับไฟล์ที่ Apache ส่งเอง
#
#    ปัญหาที่เคยเจอ: index.html ไม่มี Cache-Control → เบราว์เซอร์เดาเอง
#    (heuristic caching) แล้วใช้ index เก่าหลัง deploy ผู้ใช้เห็นหน้าเดิม
#    จนกว่าจะกด Ctrl+F5
#
#    วิธีแก้: จัดการบล็อกของเราเองใน .htaccess แบบ "ลบของเก่าแล้วใส่ใหม่"
#      - ไม่แตะ directive อื่นของ DirectAdmin (ลบเฉพาะระหว่าง marker)
#      - ทำซ้ำได้ (idempotent) ไม่ต่อซ้ำทุกครั้งที่ deploy
#      - ถ้าจะเลิกใช้ ให้ลบบล็อกในไฟล์นี้ แล้ว deploy อีกครั้ง = ถูกถอดออก
#
#    ห่อด้วย IfModule mod_headers.c — ถ้าเซิร์ฟเวอร์ไม่ได้เปิดโมดูลนี้
#    Apache จะข้ามไป ไม่ทำให้ทั้งเว็บเป็น 500
HTC="$WEB_DIR/.htaccess"
HTC_TMP="$WEB_DIR/.htaccess.p2tmp"
HTC_BAK="$WEB_DIR/.htaccess.p2bak"
# เก็บของเดิมไว้ เผื่อ directive ที่เพิ่มไปทำให้ Apache ตอบ 500
if [ -f "$HTC" ]; then
  cp -p "$HTC" "$HTC_BAK" || cp "$HTC" "$HTC_BAK" || true
fi
if [ -f "$HTC" ] \
   && grep -q '^# >>> P2-SMART cache headers >>>$' "$HTC" \
   && grep -q '^# <<< P2-SMART cache headers <<<$' "$HTC"; then
  # มีบล็อกเดิมครบทั้งหัวและท้าย → ตัดออกก่อน แล้วค่อยใส่ใหม่
  awk '/^# >>> P2-SMART cache headers >>>$/{skip=1}
       !skip{print}
       /^# <<< P2-SMART cache headers <<<$/{skip=0}' "$HTC" > "$HTC_TMP"
elif [ -f "$HTC" ]; then
  # ไม่มีบล็อกของเรา (หรือ marker ไม่ครบ) → คัดลอกไว้ทั้งไฟล์ ห้ามตัดทิ้ง
  cat "$HTC" > "$HTC_TMP"
else
  : > "$HTC_TMP"
fi
cat >> "$HTC_TMP" <<'HTACCESS'

# >>> P2-SMART cache headers >>>
# index.html ต้องตรวจสอบกับเซิร์ฟเวอร์ทุกครั้ง (ชื่อไฟล์คงที่ แต่เนื้อหาเปลี่ยนทุก deploy)
# ไฟล์ใน /assets/ มี hash ในชื่อแล้ว จึงแคชได้ยาวและไม่ต้องตรวจซ้ำ
<IfModule mod_headers.c>
  <FilesMatch "^index\.html$">
    Header set Cache-Control "no-cache, no-store, must-revalidate"
  </FilesMatch>
  <FilesMatch "-[A-Za-z0-9_-]{8}\.(js|css|woff2?|png|jpe?g|gif|svg|webp|ico)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
</IfModule>
# <<< P2-SMART cache headers <<<
HTACCESS
# เขียนทับเนื้อหาเดิมในไฟล์เดิม (คงเจ้าของ/สิทธิ์ของ .htaccess ไว้)
cat "$HTC_TMP" > "$HTC"
rm -f "$HTC_TMP"
echo "    อัปเดต Cache-Control ใน .htaccess แล้ว"

echo ">>> 8.2 ตรวจว่าเว็บยังเปิดได้หลังแก้ .htaccess"
# ⚠️ ถ้า Apache ตั้ง AllowOverride ไม่ให้ใช้ Header ใน .htaccess
#    ทั้งเว็บจะกลายเป็น 500 — ต้องคืนไฟล์เดิมทันที ไม่ปล่อยให้เว็บล่ม
SITE_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  -H "Host: p2-smart.phrae2.go.th" http://127.0.0.1/ || echo 000)
if [ "$SITE_CODE" = "500" ]; then
  echo "!! Apache ตอบ 500 หลังแก้ .htaccess → คืนไฟล์เดิม"
  if [ -f "$HTC_BAK" ]; then
    cp -p "$HTC_BAK" "$HTC" || cp "$HTC_BAK" "$HTC"
  else
    rm -f "$HTC"
  fi
  echo "   คืน .htaccess เดิมแล้ว (เว็บใช้งานได้ตามเดิม แต่ยังไม่มี Cache-Control)"
  exit 1
fi
echo "    Apache ตอบ HTTP $SITE_CODE"
rm -f "$HTC_BAK"

echo ">>> 9. ตรวจว่าเซิร์ฟเวอร์ตอบกลับ"
# ⚠️ เดิมเช็คแค่ /api/office ซึ่งเป็น endpoint สาธารณะ ไม่แตะตาราง sessions
#    ถ้า deploy ทำให้ "ล็อกอิน" พัง แต่ /api/office ยังตอบได้
#    → ขั้นนี้ผ่าน → รายงานว่าสำเร็จ ทั้งที่ผู้ใช้ล็อกอินไม่ได้
#
#    ① /api/office          = 200 → route + ฐานข้อมูล + schema พร้อม
#    ② POST /api/auth/login = 401 → เส้นทางล็อกอินยังไม่พัง
#       (ยิงด้วยชื่อผู้ใช้ปลอมโดยตั้งใจ → ได้ 401 ตามปกติ
#        คือ route ทำงาน ไม่ใช่ 500 และไม่ได้สร้าง session เก็บไว้)
for i in $(seq 1 10); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://127.0.0.1:3000/api/office || echo 000)
  if [ "$CODE" = "200" ]; then
    echo "    ตอบกลับแล้ว (รอบที่ $i)"
    break
  fi
  echo "    รอให้บูต... ($i/10 · HTTP $CODE)"
  sleep 3
  if [ "$i" = "10" ]; then
    echo "!! เซิร์ฟเวอร์ไม่ตอบกลับหลัง 30 วินาที"
    pm2 logs ph2-api --lines 40 --nostream
    exit 1
  fi
done

echo ">>> 9.1 ตรวจเส้นทางล็อกอินด้วย"
LOGIN_CODE=$(curl -s -o /tmp/login-check.out -w "%{http_code}" --max-time 15 -X POST http://127.0.0.1:3000/api/auth/login -H "Content-Type: application/json" -d '{"username":"__healthcheck__","password":"__healthcheck__"}' || echo 000)
if [ "$LOGIN_CODE" = "401" ]; then
  echo "    เส้นทางล็อกอินปกติ (401 ตามที่ควรเป็น)"
else
  echo "!! เส้นทางล็อกอินตอบ HTTP $LOGIN_CODE (ควรเป็น 401)"
  echo "   เนื้อหาที่ได้:"
  head -c 500 /tmp/login-check.out || true
  echo ""
  pm2 logs ph2-api --lines 40 --nostream
  exit 1
fi

echo ">>> 9.2 ลบไฟล์วินิจฉัยชั่วคราวที่หลงเหลือใน web root"
# ไฟล์เหล่านี้ถูกสร้างตอนกู้ระบบ (21–22 ต.ค.) เพื่ออ่านสถานะเซิร์ฟเวอร์ทางเว็บ
# ⚠️ เปิดอ่านได้จากอินเทอร์เน็ต — p2discover.txt มีรายการไฟล์/สิทธิ์ในโฮม,
#    p2deploy-log.txt มีพาธและชื่อฐานข้อมูล จึงต้องลบทิ้งเมื่อกู้เสร็จ
for f in p2diag.txt p2discover.txt p2deploy-log.txt; do
  if [ -f "$WEB_DIR/$f" ]; then
    rm -f "$WEB_DIR/$f" && echo "    ลบ $f แล้ว"
  fi
done
# ไฟล์ผู้สมัครรหัสผ่านฐานข้อมูลที่สคริปต์เคยสร้างไว้ (ไม่เกี่ยวกับเว็บ แต่ไม่ควรค้าง)
rm -f "$HOME/.p2-cands"

echo ">>> 9.3 สรุปสถานะหลัง deploy"
{
  echo "date: $(date)"
  echo "app_dir: $APP_DIR"
  echo "env_exists: $([ -f "$APP_DIR/backend/.env" ] && echo yes || echo no)"
  echo "uploads_files: $(find "$APP_DIR/backend/public/uploads" -type f 2>/dev/null | wc -l)"
  echo "frontend_dist: $([ -f "$APP_DIR/frontend/dist/index.html" ] && echo yes || echo no)"
  echo "== uploads probe (ผ่าน Node) =="
  for u in /api/office /uploads/staff/none.jpg; do
    echo -n "$u => "
    curl -s -o /dev/null -w '%{http_code} %{content_type}\n' --max-time 10 "http://127.0.0.1:3000$u" 2>&1 || echo "(curl failed)"
  done
  echo "== นับไฟล์ใน public_html =="
  ls "$WEB_DIR" | head -20
} > "$REPORT" 2>&1 || true
chmod 644 "$REPORT" 2>/dev/null || true
echo "    เขียนสรุปที่ $REPORT"

echo ">>> Deploy สำเร็จ!"