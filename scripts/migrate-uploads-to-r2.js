#!/usr/bin/env node
'use strict';
// Mavjud (data/uploads dagi) fayllarni Cloudflare R2'ga ko'chiradi va
// bazadagi havolalarni (/uploads/xxx -> R2_PUBLIC_URL/xxx) yangilaydi.
//
// Fayl nomi (key) O'ZGARTIRILMAYDI — shuning uchun bazada faqat prefiks
// almashtiriladi, har bir yozuvni alohida topib yangilashning hojati yo'q.
//
// Ishlatish: STORAGE_DRIVER=r2 bilan barcha R2_* env o'zgaruvchilar o'rnatilgan
// holda: node scripts/migrate-uploads-to-r2.js
// (Eski fayllar ko'chirilgandan keyin ham data/uploads'da qoladi — ishonch hosil
// qilgach, ularni qo'lda o'chirishingiz mumkin.)

const fs = require('fs');
const path = require('path');
const { db, init } = require('../src/db');
const storage = require('../src/storage');

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

async function main() {
  if (storage.driver !== 'r2') {
    console.error("STORAGE_DRIVER=r2 o'rnatilmagan. Bu skript faqat R2'ga ko'chirish uchun.");
    process.exit(1);
  }
  if (!R2_PUBLIC_URL) {
    console.error('R2_PUBLIC_URL kerak.');
    process.exit(1);
  }

  const uploadDir = storage.UPLOAD_DIR;
  if (!fs.existsSync(uploadDir)) {
    console.log('data/uploads papkasi topilmadi — ko\'chiriladigan fayl yo\'q.');
    process.exit(0);
  }

  const files = fs.readdirSync(uploadDir).filter(f => fs.statSync(path.join(uploadDir, f)).isFile());
  console.log(`Topildi: ${files.length} ta fayl`);

  let uploaded = 0, failed = 0;
  for (const file of files) {
    const ext = path.extname(file);
    const buffer = fs.readFileSync(path.join(uploadDir, file));
    try {
      await storage.putObject(file, buffer, ext);
      uploaded++;
      if (uploaded % 20 === 0) console.log(`  ${uploaded}/${files.length} yuklandi...`);
    } catch (e) {
      failed++;
      console.error(`  ❌ ${file}: ${e.message}`);
    }
  }
  console.log(`✅ Yuklandi: ${uploaded}, ❌ Xato: ${failed}`);

  if (failed > 0) {
    console.error("Ba'zi fayllar yuklanmadi — baza yangilanishidan oldin muammoni hal qiling.");
    process.exit(1);
  }

  // Bazadagi havolalarni yangilash: /uploads/xxx -> R2_PUBLIC_URL/xxx
  await init();
  const prefix = R2_PUBLIC_URL.replace(/\/$/, '');
  const updates = [
    ["UPDATE users SET avatar = $1 || substring(avatar from 10) WHERE avatar LIKE '/uploads/%'", [prefix]],
    ["UPDATE users SET banner = $1 || substring(banner from 10) WHERE banner LIKE '/uploads/%'", [prefix]],
    ["UPDATE communities SET avatar = $1 || substring(avatar from 10) WHERE avatar LIKE '/uploads/%'", [prefix]],
    ["UPDATE communities SET banner = $1 || substring(banner from 10) WHERE banner LIKE '/uploads/%'", [prefix]],
    ["UPDATE posts SET image = $1 || substring(image from 10) WHERE image LIKE '/uploads/%'", [prefix]],
    ["UPDATE posts SET video = $1 || substring(video from 10) WHERE video LIKE '/uploads/%'", [prefix]],
    ["UPDATE posts SET audio = $1 || substring(audio from 10) WHERE audio LIKE '/uploads/%'", [prefix]],
    ["UPDATE messages SET image_url = $1 || substring(image_url from 10) WHERE image_url LIKE '/uploads/%'", [prefix]],
    ["UPDATE messages SET audio_url = $1 || substring(audio_url from 10) WHERE audio_url LIKE '/uploads/%'", [prefix]],
  ];
  for (const [sql, params] of updates) {
    const r = await db.query(sql, params);
    if (r.rowCount) console.log(`  ${sql.split(' ')[1]}: ${r.rowCount} qator yangilandi`);
  }
  console.log('✅ Baza havolalari yangilandi.');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Xatolik:', err);
  process.exit(1);
});
