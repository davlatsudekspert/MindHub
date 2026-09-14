## Loyiha
MindHub — o'zbek tilidagi ijtimoiy platforma (Reddit uslubida). Odamlar jamoalar (community)
ichida g'oya va muammolarini ulashadi, izoh va reaksiya qoldiradi, shaxsiy xabar yozadi.

## Stack
- Backend: sof Node.js 22+, `http` moduli (Express YO'Q — qo'shmang)
- DB: PostgreSQL, `pg` kutubxonasi. Barcha querylar src/db.js ichidagi Q obyektida
- WebSocket: src/ws.js dagi qo'lda yozilgan implementatsiya
- Frontend: vanilla JS, build step yo'q. public/js/{core,posts,features,app}.js
- Deploy: Railway

## Qoidalar
- Barcha UI matni va xato xabarlari O'ZBEK TILIDA (lotin alifbosida)
- Yangi SQL query qo'shsang — src/db.js dagi Q obyektiga qo'sh, route ichida inline yozma
- Barcha query parametrli bo'lsin ($1, $2) — string konkatenatsiya QILMA
- Frontendda foydalanuvchi matnini innerHTML ga qo'yishdan oldin esc() dan o'tkaz
- Yangi dependency qo'shishdan oldin so'ra. Loyiha ataylab minimal dependency bilan yozilgan
- Fayl oxiri CRLF (\r\n) — mavjud fayllarni tahrirlaganda buzma
- Har bir o'zgarishdan keyin `node -c` yoki `node --check` bilan sintaksisni tekshir

## Env o'zgaruvchilar
DATABASE_URL, SECRET, PORT, DATA_DIR, APP_URL, RESEND_API_KEY, MAIL_FROM,
TELEGRAM_BOT_TOKEN, ALLOWED_ORIGINS, AI_PROVIDER, AI_API_KEY, CF_ACCOUNT_ID,
AI_EMBED_MODEL, AI_CHAT_MODEL, CLUSTER_THRESHOLD, CLUSTER_MIN_SIZE,
STORAGE_DRIVER, R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
R2_PUBLIC_URL

## AI Fikr Taqsimlovchi (FAZA 3)
- src/ai/provider.js — AI_PROVIDER orqali tanlanadigan embed/chat abstraksiyasi.
  AI_PROVIDER bo'sh bo'lsa butun AI qismi jim o'chadi (feature flag).
- src/ai/cluster.js — klasterlash algoritmi (cosine similarity, JS asosida —
  pgvector ishlatilmaydi). src/ai/worker.js — fon ishchi (ai_jobs navbatini
  FOR UPDATE SKIP LOCKED bilan ishlaydi).
- Faqat posts.kind IN ('problem','idea') postlari klasterlanadi.

## Migratsiyalar
- Schema o'zgarishlari migrations/NNN_nom.sql fayllari orqali (src/migrate.js,
  server.js#init() dan keyin avtomatik ishga tushadi). Yangi fayl qo'shsang,
  tartib raqamini oshir (002_, 003_, ...) — src/db.js dagi asosiy SCHEMA'ga
  to'g'ridan-to'g'ri ustun qo'shma.

## Parol va sessiya
- Parollar scrypt bilan hashlanadi (src/helpers.js#hashPassword/verifyPassword).
  Eski hmac formatidagi parollar login paytida shaffof ravishda qayta hashlanadi.
- JWT tokenlar users.pass_version bilan bog'langan — parol o'zgarganda eski
  tokenlar avtomatik bekor bo'ladi (src/routes.js#getAuth bazani tekshiradi).

## Email
- src/mailer.js — Resend REST API orqali. RESEND_API_KEY yo'q bo'lsa, kod
  konsolga chiqadi (lokal test uchun). nodemailer ishlatilmaydi.
- Ro'yxatdan o'tish 2 bosqichli: /api/auth/register pending holat qaytaradi,
  /api/auth/verify-email kod bilan tasdiqlaydi va to'liq token beradi.

## Nomlash: cluster_members vs comments
- Q obyektida comments jadvali uchun qisqartma "cm" (cmInsert, cmByPost, ...)
  band qilingan. cluster_members jadvali uchun "clm" prefiksi ishlatiladi
  (clmInsert, clmByCluster, ...) — ikkalasini aralashtirib yubormaslik uchun
  ATAYLAB har xil. Yangi Q funksiyasi qo'shishdan oldin nom band emasligini
  tekshir (bitta marta shu sababdan production xatosi bo'lgan).

## Yechim va ekspert taqsimlash (FAZA 4)
- Post egasi yoki jamoa admini POST/DELETE /api/comments/:id/solution orqali
  izohni yechim deb belgilaydi (posts.status, comments.is_solution).
- src/ai/distribute.js — klasterga yaqin mavzularda faol foydalanuvchilarga
  taklif yuboradi (kuniga 3ta/user, postiga 5ta chegarasi bilan).
  src/ai/worker.js ai_jobs('distribute') orqali chaqiradi.

## Fayl saqlash (FAZA 6)
- src/storage.js — save(buffer,ext)/del(url), STORAGE_DRIVER='local'|'r2'.
  R2 rejimi @aws-sdk/client-s3 ISHLATMAYDI — AWS Signature V4 qo'lda yozilgan
  (loyihaning minimal-dependency qoidasiga mos). ⚠️ Bu qism haqiqiy R2 bucket
  bilan hali sinalmagan (bu muhitda R2 hisobi yo'q) — production'ga qo'yishdan
  oldin staging'da kichik fayl yuklab tekshiring.
- scripts/migrate-uploads-to-r2.js — mavjud data/uploads fayllarini R2'ga
  ko'chiradi (fayl nomi o'zgarmaydi, bazada faqat /uploads/ prefiksi almashadi).

## Frontend (FAZA 5)
- public/js/trends.js — "Muammolar" (/trends) va klaster sahifasi (goSec('trends')/
  goSec('cluster')). Yangi bo'lim qo'shsang shu faylga qo'sh, features.js allaqachon
  1700+ qator.
- Post yozish modali: kind selector (post/muammo/g'oya) + sarlavha yozilganda
  debounce bilan /api/ai/similar so'raladi (public/js/features.js#onSubTitleInput).
- Yechim UI: post-title'da "✓ Yechilgan" belgisi, izohda "✓ Yechim deb belgilash"
  tugmasi (faqat post egasi/admin), ekspert taklifi bildirishnomasi maxsus
  ko'rinishda (public/js/features.js#loadNotifs).

## Testlar
- `npm test` (`node --test`, node:test — tashqi kutubxona kerak emas).
  Haqiqiy PostgreSQL kerak: `DATABASE_URL=postgres://postgres:postgres@localhost:5432/mindhub_test npm test`
  (baza oldindan yaratilgan bo'lishi kerak — `createdb mindhub_test`).
- test/_helpers.js — routelarni haqiqiy server/port ochmasdan chaqiradi
  (soxta req/res). Fayl nomi ATAYLAB `_helpers.js` (`helpers.test.js` emas) —
  `node --test` standart holatda test/ papkasidagi HAR QANDAY faylni emas,
  balki faqat *.test.js'larni yugurtiradi, lekin ehtiyot chorasi sifatida shunday.
- Testlar ketma-ket ishlaydi (`--test-concurrency=1`) — parallel fayllar bitta
  bazada bir vaqtda CREATE TABLE IF NOT EXISTS ishga tushirsa, Postgres'da
  `pg_type_typname_nsp_index` poyga holati (race condition) yuzaga keladi.
- CI: `.github/workflows/ci.yml` — har push/PR'da node --check + npm test
  (Postgres service container bilan).

## Logging va xatoliklarni ushlash
- src/logger.js — `log.info/warn/error(msg, meta)`. NODE_ENV=production'da
  JSON qatorlar chiqaradi (Railway loglarida filtrlash uchun), aks holda
  odatdagi o'qilishi qulay format. Mavjud console.log/error chaqiriqlari
  ataylab o'zgartirilmagan — logger yangi/muhim joylar uchun.
- server.js: process.on('uncaughtException'/'unhandledRejection') qo'shildi —
  avval bular yo'q edi, ya'ni bitta await qilinmagan promise (masalan
  fire-and-forget email) butun serverni yiqitishi mumkin edi (Node 15+ da
  unhandledRejection standart holatda jarayonni to'xtatadi). Endi
  unhandledRejection faqat logga yoziladi (jarayon davom etadi),
  uncaughtException esa logga yozib process.exit(1) qiladi (railway.json
  restartPolicy avtomatik qayta ishga tushiradi — bu Node hujjatlari
  tavsiya qilgan xavfsiz naqsh, chunki uncaughtException'dan keyin
  jarayon holati noaniq bo'lishi mumkin).
