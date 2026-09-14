#!/usr/bin/env node
'use strict';
// Bazadagi barcha mavjud 'problem'/'idea' postlari uchun ai_jobs navbatiga
// 'embed' vazifalarini qo'shadi (100 tadan partiyalar bilan).
//
// Ishlatish: node scripts/backfill-embeddings.js
// (DATABASE_URL, SECRET va AI_PROVIDER env o'zgaruvchilari o'rnatilgan bo'lishi kerak)

const { db, init } = require('../src/db');
const { migrate } = require('../src/migrate');
const { Q } = require('../src/db');
const { uid } = require('../src/helpers');
const provider = require('../src/ai/provider');

const BATCH_SIZE = 100;

async function main() {
  if (!provider.enabled) {
    console.error("AI_PROVIDER o'rnatilmagan — backfill uchun kerak. .env yoki Railway'da o'rnating.");
    process.exit(1);
  }

  await init();
  await migrate();

  let offset = 0;
  let total = 0;
  let queued = 0;

  while (true) {
    const rows = await db.all(
      `SELECT p.id FROM posts p
       LEFT JOIN post_embeddings pe ON pe.post_id = p.id
       WHERE p.kind IN ('problem','idea') AND pe.post_id IS NULL
       ORDER BY p.created_at ASC
       LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset]
    );
    if (!rows.length) break;

    for (const row of rows) {
      await Q.ajInsert(uid(), 'embed', { post_id: row.id });
      queued++;
    }
    total += rows.length;
    console.log(`▶ ${total} ta post ko'rib chiqildi, ${queued} tasi navbatga qo'yildi`);
    offset += BATCH_SIZE;
  }

  console.log(`✅ Tayyor. Jami ${queued} ta post embed navbatiga qo'yildi.`);
  console.log("   Ular src/ai/worker.js fon ishchisi orqali (server ishga tushganda) qayta ishlanadi.");
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Backfill xatoligi:', err);
  process.exit(1);
});
