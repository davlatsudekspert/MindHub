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
TELEGRAM_BOT_TOKEN, AI_PROVIDER, AI_API_KEY
