## Loyiha
MindHub — o'zbek tilidagi ijtimoiy platforma (Reddit uslubida). Odamlar jamoalar (community)
ichida g'oya va muammolarini ulashadi, izoh va reaksiya qoldiradi, shaxsiy xabar yozadi.

## Stack (2026: Cloudflare'ga to'liq ko'chirildi — Railway/PostgreSQL EMAS)
- Backend: Cloudflare Workers (worker/index.js kirish nuqtasi). Biznes-mantiq
  (src/routes.js#route(req,res)) Node http.Server uslubidagi req/res
  interfeysida yozilgan bo'lib qoladi — worker/index.js buni Workers
  Request/Response'ga moslashtiruvchi "shim" orqali chaqiradi (pastdagi
  "Cloudflare Workers migratsiyasi" bo'limiga qarang).
- DB: Cloudflare D1 (SQLite). Barcha querylar src/db.js ichidagi Q obyektida —
  SQL matni ko'p joyda Postgres uslubida yozilgan qoladi (masalan $1, ::int),
  chunki src/db.js#toD1() bularni avtomatik SQLite-mos shaklga o'giradi.
- Fayl saqlash: Cloudflare R2 (binding orqali, src/storage.js).
- WebSocket: Cloudflare Durable Object (src/ws-do.js — haqiqiy ish shu yerda;
  src/ws.js esa routes.js uchun moslik qatlami, DO'ga HTTP orqali murojaat qiladi).
- Frontend: vanilla JS, build step yo'q. public/js/{core,posts,features,app}.js
  (o'zgarishsiz — Workers Assets binding orqali xizmat qiladi).
- Deploy: `wrangler deploy` (Railway ENDI ISHLATILMAYDI — server.js/src/migrate.js
  eski Node/Postgres yo'li endi FUNKSIONAL EMAS, chunki src/db.js D1-ga
  moslashtirilgan; ular faqat tarixiy ma'lumot sifatida qolgan).

## Qoidalar
- Barcha UI matni va xato xabarlari O'ZBEK TILIDA (lotin alifbosida)
- Yangi SQL query qo'shsang — src/db.js dagi Q obyektiga qo'sh, route ichida
  inline yozma. Postgres uslubidagi SQL yozishda davom etilsa ham bo'ladi
  ($1,$2, ::int cast) — toD1() buni avtomatik SQLite'ga o'giradi (lekin ANY(),
  CURRENT_DATE arifmetikasi, DISTINCT ON kabi Postgres-ga XOS narsalar
  AVTOMATIK O'GIRILMAYDI — pastdagi bo'limga qara)
- Barcha query parametrli bo'lsin ($1, $2) — string konkatenatsiya QILMA
- Frontendda foydalanuvchi matnini innerHTML ga qo'yishdan oldin esc() dan o'tkaz
- Yangi dependency qo'shishdan oldin so'ra. Loyiha ataylab minimal dependency bilan yozilgan
- Fayl oxiri CRLF (\r\n) — mavjud fayllarni tahrirlaganda buzma
- Har bir o'zgarishdan keyin `node -c` yoki `node --check` bilan sintaksisni
  tekshir. ⚠️ worker/index.js ESM sintaksisda (export default/export class) —
  node --check buni CommonJS deb tushunib xato beradi, bu FAYL uchun
  `npx wrangler deploy --dry-run` (yoki `wrangler dev` + so'rov yuborish)
  haqiqiy tekshiruv hisoblanadi.
- Cloudflare Workers'da GLOBAL scope'da setInterval/setTimeout/fetch/
  crypto.randomUUID() kabi async/random operatsiyalar TAQIQLANGAN ("Disallowed
  operation called within global scope") — faqat handler ichida (fetch/
  scheduled/DO metodlari) chaqiriladi. Bu real bug sifatida topilgan edi:
  src/ratelimit.js'da module-level `setInterval(...)` bo'lgani uchun butun
  Worker ishga tushmay qolgan — endi opportunistic (har chaqiruvda vaqt
  tekshirib) tozalashga almashtirilgan.

## Env o'zgaruvchilar (Cloudflare Workers)
- **Binding'lar** (wrangler.toml'da statik e'lon qilinadi, secret emas):
  `DB` (D1), `R2` (R2 bucket), `WSHUB` (Durable Object namespace, class WsHub),
  `ASSETS` (Workers Assets — public/ papkasi).
- **`wrangler secret put NOM`** orqali qo'yiladigan maxfiy qiymatlar: `SECRET`
  (majburiy — token imzolash uchun), `RESEND_API_KEY`, `AI_API_KEY`,
  `TELEGRAM_BOT_TOKEN`.
- **`[vars]`** (wrangler.toml, maxfiy emas): `APP_URL`, `MAIL_FROM`,
  `ALLOWED_ORIGINS`, `AI_PROVIDER`, `CF_ACCOUNT_ID`, `AI_EMBED_MODEL`,
  `AI_CHAT_MODEL`, `CLUSTER_THRESHOLD`, `CLUSTER_MIN_SIZE`, `STORAGE_DRIVER`
  (default endi `'r2'`, Node/Railway davridagi `'local'` emas).
- ⚠️ `DATABASE_URL`, `PORT`, `DATA_DIR`, `R2_ACCOUNT_ID`, `R2_BUCKET`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL` — ENDI KERAK
  EMAS (Postgres connection string va hand-rolled R2 SigV4 kalitlari edi,
  D1/R2 binding'lari ularning o'rnini bosadi).
- Lokal test uchun: `.dev.vars` fayliga `SECRET=...` yoz (`.gitignore`da,
  repo'ga tushmaydi).

## Cloudflare Workers migratsiyasi (Railway/Postgres'dan to'liq ko'chirish)
- **Nega**: foydalanuvchi talabi bilan — Railway/Postgres o'rniga to'liq
  Cloudflare (Workers+D1+R2) ustida ishlashi kerak.
- **worker/index.js** — kirish nuqtasi (ESM: `export default {fetch,scheduled}`,
  `export {WsHub}`). `fetch()` ichida: WebSocket so'rovlarini DO'ga proksi
  qiladi, `/uploads/:key`ni R2 binding orqali (Range support bilan) xizmat
  qiladi, `/api/*`ni Node-uslubidagi req/res "shim" orqali
  `src/routes.js#route(req,res)`ga uzatadi (1600+ qatorlik biznes-mantiq
  O'ZGARTIRILMAGAN — faqat HTTP qatlami moslashtirilgan), qolganini Workers
  Assets binding orqali (public/) xizmat qiladi. `scheduled()` — Cron Trigger
  (har daqiqada), src/cron.js#runScheduled + src/ai/worker.js#tick ni chaqiradi
  (Node'dagi setInterval-asosli fon jarayonlar o'rnini bosadi).
- **src/env.js** — Workers binding'lari (env) va ctx.waitUntil faqat
  fetch(request,env,ctx) ichida beriladi, module yuklanganda mavjud emas.
  setEnv(env,ctx)/getEnv()/waitUntil() — bitta isolyat davomida shu holatni
  saqlaydigan kichik singleton (src/db.js, src/helpers.js#SECRET,
  src/storage.js, src/ws.js shu orqali binding'larga kiradi).
- **src/db.js#toD1()** — Postgres SQL matnini SQLite (D1)ga avtomatik
  moslashtiradi: `$N`->`?` (qiymatlar tartibi bilan, takroriy $N'lar ham
  to'g'ri), `::int`/`::text[]`/`::double precision` kabi FAQAT aniq
  ro'yxatdagi cast'lar olib tashlanadi (⚠️ ochiq `[a-zA-Z ]+` regex avval
  "IS NULL OR" kabi so'zlarni ham yutib yuborgan — haqiqiy bug, wrangler dev
  orqali topilgan va qattiq ro'yxatga almashtirilgan), `extract(epoch from
  now())`->`unixepoch()`, `greatest(`->`max(`. AVTOMATIK O'GIRILMAYDIGAN
  narsalar har bir Q funksiyasida QO'LDA qayta yozilgan:
  - `ANY($N::text[])` (massiv parametr) — SQLite'da yo'q, `IN (?,?,...)`
    dinamik ro'yxatiga (inClause() yordamchisi) almashtirilgan (~12 ta
    `*Batch` funksiya: pvGetBatch, svCheckBatch, memCheckBatch va h.k.)
  - `CURRENT_DATE` arifmetikasi (`CURRENT_DATE-7`, `CURRENT_DATE-$N`) — JS'da
    hisoblab, oddiy $N sifatida uzatiladi (cdIncr, cdSeries, clListRanked,
    stTrending)
  - To'liq matnli qidiruv (pSearch) — Postgres tsvector/GIN/plainto_tsquery
    o'rniga SQLite FTS5 virtual jadval (`posts_fts`, migrations/d1/0005,
    posts bilan trigger orqali sinxron). bm25() natijasi kichik=yaxshi
    (ts_rank'ning teskarisi) — ORDER BY ASC.
  - `DISTINCT ON (post_id)` (clmByPostIdBatch) — SQLite qo'llab-quvvatlamaydi,
    oddiy SELECT'ga soddalashtirilgan (chaqiruvchi Map orqali dublikatlarni
    baribir yig'adi).
  - `FOR UPDATE SKIP LOCKED` (ai_jobs navbati) — D1 yagona yozuvchi modeliga
    ega, shuning uchun oddiy atomik `UPDATE...WHERE id IN (SELECT...) RETURNING`
    (Q.ajClaimBatch) yetarli, alohida tranzaksiya/qulf shart emas.
- **migrations/d1/*.sql** — D1 migratsiyalari (`wrangler d1 migrations apply`),
  Postgres migrations/*.sql'dan ALOHIDA (SQLite sintaksisida, yakuniy shaklda
  to'g'ridan-to'g'ri yaratilgan — Postgres'dagi kabi bosqichma-bosqich ALTER
  TABLE tarixi yo'q, chunki D1 bazasi noldan boshlanadi). Node versiyasidagi
  kabi server ishga tushganda AVTOMATIK ishlamaydi — deploy vaqtida qo'lda/CI
  orqali qo'llanadi (`npm run migrate:local` / `migrate:remote`).
- **src/ws-do.js** (Durable Object "WsHub") — src/ws.js'dagi eski xom TCP
  socket implementatsiyasi o'rnini bosadi. Hibernatable WebSockets API
  (`state.acceptWebSocket`) ishlatiladi — DO faol emasligida CPU/xotira
  sarflamaydi. Bitta singleton DO instansi ("hub" nomi bilan) BARCHA
  ulanishlarni ushlaydi va foydalanuvchi ID bo'yicha (WebSocket "tag"lari
  orqali) yo'naltiradi. src/ws.js endi faqat DO'ga HTTP so'rov yuboruvchi
  moslik qatlami (sendTo/sendAll/isOnline) — routes.js buni o'zgarishsiz
  chaqiraveradi. ⚠️ sendTo/sendAll routes.js'da odatda `await`siz chaqiriladi
  (fire-and-forget) — javob mijozga qaytarilgandan keyin ham so'rov
  tugashini kafolatlash uchun src/env.js#waitUntil(ctx.waitUntil) ishlatiladi.
- **src/storage.js** — R2 uchun ilgari qo'lda yozilgan AWS Signature V4
  (@aws-sdk/client-s3'siz, Node/Railway'dan R2'ga tashqi HTTP so'rovi
  sifatida) olib tashlandi — Workers'da R2 binding (`env.R2.put/get/delete`)
  to'g'ridan-to'g'ri, tezroq va xavfsizroq ishlaydi. Yuklangan fayllar R2
  "public" qilinishi yoki alohida domen ulanishi SHART EMAS — worker/index.js
  ularni `/uploads/:key` orqali R2 binding'dan o'qib beradi (Range so'rovlar —
  video/audio seek — bilan birga).
- **Cloudflare Workers'ning global-scope cheklovi**: setInterval/setTimeout/
  fetch/crypto.randomUUID() kabi operatsiyalar faqat handler ICHIDA
  chaqirilishi mumkin — module yuklanganda (global scope) chaqirilsa Worker
  butunlay ishga tushmay qoladi ("Disallowed operation called within global
  scope"). Bu HAQIQIY BUG sifatida topildi: src/ratelimit.js'da module-level
  `setInterval(...)` bor edi (Map tozalash uchun) — endi har `check()`
  chaqiruvida vaqt tekshirilib, ehtimollik asosida (opportunistic)
  tozalanadi, alohida timer YO'Q.
- **Bilib qo'yish kerak bo'lgan cheklovlar (texnik qarz, hal qilinmagan)**:
  - src/ratelimit.js'dagi in-memory Map faqat BITTA isolyat ichida — Workers
    ko'p isolyatga tarqatadi, shuning uchun rate limit "eng yaxshi urinish"
    darajasida (global emas). To'liq to'g'ri bo'lishi uchun Durable
    Object/D1 asosidagi hisoblagich kerak bo'ladi.
  - **test/*.js (`npm test`) ENDI ISHLAMAYDI** — eski test/_helpers.js
    to'g'ridan-to'g'ri `require('../src/db')`ga tayanadi, u endi D1 binding
    (`getEnv()`) so'raydi va Worker konteksti tashqarisida xato beradi.
    Yangi testlar Miniflare/wrangler'ning Node API'si orqali yozilishi kerak
    — bu hali qilinmagan.
  - server.js, src/migrate.js — eski Node/Railway/Postgres yo'li, ENDI
    FUNKSIONAL EMAS (src/db.js D1-ga to'liq almashtirilgan). O'chirilmagan
    (tarix uchun), lekin ishlatilmaydi.
  - scripts/migrate-uploads-to-r2.js — eski Railway diskidan R2'ga ko'chirish
    uchun yozilgan edi, endi kerak emas (Railway ishlatilmayapti).
  - AI klasterlash fon ishchisi (src/ai/worker.js) endi Cron Trigger orqali
    HAR DAQIQADA ishlaydi (Node'dagi 5 soniyalik setInterval o'rniga) —
    AI_PROVIDER o'rnatilmagan bo'lsa (default) hech narsa qilmaydi.

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

## Post feedlar: cursor-asosli pagination
- GET /api/posts va GET /api/communities/:slug/posts OFFSET o'rniga cursor
  ishlatadi (src/db.js#pHot/pNew/pCom/pComNew). Javob shakli
  `{posts:[...], next_cursor: string|null}` — cursor base64url'da kodlangan
  JSON (src/helpers.js#encodeCursor/decodeCursor), mijoz uni tushunmasdan
  keyingi so'rovga `?cursor=` sifatida qaytaradi.
- ⚠️ Tiebreak muammosi (sinov paytida topilgan haqiqiy bug): bir vaqtda
  yaratilgan postlar bir xil hot_rank/created_at qiymatiga ega bo'lishi
  mumkin. Faqat shu ikkitasi bo'yicha cursor solishtirsa, "chegaradagi"
  teng qatorlar sahifalar orasida butunlay yo'qolib qolardi (page 2 bo'sh
  qaytardi, garchi hali postlar qolgan bo'lsa ham). Yechim: p.id (UUID,
  unikal) uchinchi tiebreaker sifatida qo'shildi — ORDER BY va WHERE'dagi
  qator (row-value) solishtiruvga ham kiritilgan.
- ⚠️ Precision muammosi: hot_rank ustuni `float8` (double precision)da
  hisoblanadi, lekin cursor qiymati SQL'da `::real` (float4)ga cast
  qilinganda aniqlik yo'qolib, teng bo'lishi kerak bo'lgan qiymatlar teng
  bo'lmay qolgan — bu ham page 2'ni bo'sh qaytarishga sabab bo'lgan.
  Yechim: `::double precision` ishlatiladi, `::real` emas.
- Yangi cursor-pagination endpoint qo'shsang: (1) barcha ORDER BY
  ustunlariga id kabi unikal tiebreaker qo'sh, (2) cast turlarini haqiqiy
  hisoblangan ustun turi bilan mosla (float8 ustunni real'ga cast qilma).

## Feed formatlash: N+1 query va fmtPostsBatch/fmtCmtsBatch
- Post/izoh ro'yxatlarini JSON javobga tayyorlashda (ovoz, saqlangan, so'rovnoma,
  klaster ma'lumoti) HAR BIR qator uchun alohida so'rov yubormang — bu N+1 query
  (25 postlik sahifada 100+ ketma-ket DB murojaati bo'lishi mumkin edi).
  src/routes.js#fmtPostsBatch/fmtCmtsBatch shu ma'lumotlarni sahifadagi BARCHA
  postlar/izohlar uchun bir nechta `WHERE id = ANY($1::text[])` so'rovida birdaniga
  oladi, keyin Map/Set orqali xotirada har bir qatorga mos qo'yadi.
- fmtPost/fmtCmt (bitta element uchun) hali ham post/izoh DETAIL sahifasida
  qoladi (bitta postni ochish, bitta izohni qaytarish) — faqat RO'YXAT
  qaytaradigan joylarda (feed, profil, qidiruv, saqlanganlar) batch versiyasi
  ishlatiladi.
- Yangi Q.*Batch funksiyasi qo'shsang: bo'sh massiv/user_id yo'qligida SQL'ga
  murojaat qilmasdan `Promise.resolve([])` qaytar (ANY($1) bo'sh massiv bilan
  ham ishlaydi, lekin keraksiz round-trip'dan saqlanish uchun).
- GET /api/posts (umumiy feed)da maxfiy jamoa postlarini filtrlash uchun
  ilgari har bir post uchun alohida `SELECT is_private FROM communities...`
  so'rovi yuborilardi. Endi is_private ustuni to'g'ridan-to'g'ri pHot/pNew
  so'rovining JOIN'idan keladi (qo'shimcha so'rovsiz), a'zolik esa sahifadagi
  BARCHA maxfiy jamoalar uchun bitta Q.memCheckBatch chaqiruvida tekshiriladi.

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
