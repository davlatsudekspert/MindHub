'use strict';
const { db } = require('./db');

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

function startCron() {
  // Har 10 daqiqada muddati o'tgan kod/tokenlarni tozalash
  cleanupExpired();
  setInterval(cleanupExpired, 10 * 60 * 1000).unref();
  console.log('⏰ Cron: har 10 daqiqada eskirgan kod/tokenlar tozalanadi');
}

module.exports = { startCron, cleanupExpired };
