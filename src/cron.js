'use strict';
const { db, Q } = require('./db');
const { uid } = require('./helpers');

async function cleanupExpired() {
  try {
    await db.run("DELETE FROM email_codes WHERE expires_at<extract(epoch from now())::int OR used=1");
    await db.run("DELETE FROM reset_tokens WHERE expires_at<extract(epoch from now())::int OR used=1");
    await db.run("DELETE FROM verify_codes WHERE expires_at<extract(epoch from now())::int OR used=1");
    await db.run("DELETE FROM tg_codes WHERE expires_at<extract(epoch from now())::int OR used=1");
  } catch (e) {
    console.error('cron cleanupExpired:', e.message);
  }
}

// Haftada bir marta: ai_jobs navbatiga 'recluster' vazifasini qo'yadi
// (haqiqiy ish src/ai/worker.js orqali bajariladi)
async function scheduleWeeklyRecluster() {
  try {
    const provider = require('./ai/provider');
    if (!provider.enabled) return;
    await Q.ajInsert(uid(), 'recluster', {});
  } catch (e) {
    console.error('cron scheduleWeeklyRecluster:', e.message);
  }
}

function startCron() {
  // Har 10 daqiqada muddati o'tgan kod/tokenlarni tozalash
  cleanupExpired();
  setInterval(cleanupExpired, 10 * 60 * 1000).unref();
  // Har 7 kunda bir marta klaster birlashtirish vazifasi
  setInterval(scheduleWeeklyRecluster, 7 * 24 * 60 * 60 * 1000).unref();
  console.log('⏰ Cron: har 10 daqiqada eskirgan kod/tokenlar tozalanadi');
}

module.exports = { startCron, cleanupExpired };
