'use strict';
const { db, Q } = require('./db');
const { uid } = require('./helpers');

async function cleanupExpired() {
  try {
    await db.run("DELETE FROM email_codes WHERE expires_at<extract(epoch from now())::int OR used=1");
    await db.run("DELETE FROM reset_tokens WHERE expires_at<extract(epoch from now())::int OR used=1");
    await db.run("DELETE FROM verify_codes WHERE expires_at<extract(epoch from now())::int OR used=1");
    await db.run("DELETE FROM tg_codes WHERE expires_at<extract(epoch from now())::int OR used=1");
    // Ekspert takliflari 7 kun ichida javobsiz qolsa — muddati tugagan deb belgilash
    await Q.eiExpireOld();
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

// Node/setInterval versiyasi endi yo'q — Workers'da doimiy background process
// bo'lmaydi. worker/index.js'dagi scheduled() handler (Cron Trigger, har
// daqiqada) o'rniga runScheduled()ni chaqiradi: cleanupExpired() har safar,
// scheduleWeeklyRecluster() esa _meta jadvalidagi "oxirgi ishga tushirilgan
// vaqt" belgisiga qarab haftada bir martagina bajariladi (Workers'da
// "har 7 kunda bitta setInterval" tushunchasi yo'q, shuning uchun vaqt
// belgisi bazada saqlanadi).
async function scheduleWeeklyReclusterIfDue() {
  try {
    const WEEK = 7 * 24 * 60 * 60;
    const now = Math.floor(Date.now() / 1000);
    const row = await db.get("SELECT v FROM _meta WHERE k='last_weekly_recluster'", []);
    const last = row ? Number(row.v) : 0;
    if (now - last < WEEK) return;
    await scheduleWeeklyRecluster();
    await db.run("INSERT INTO _meta(k,v) VALUES('last_weekly_recluster',$1) ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v", [String(now)]);
  } catch (e) {
    console.error('cron scheduleWeeklyReclusterIfDue:', e.message);
  }
}

async function runScheduled() {
  await cleanupExpired();
  await scheduleWeeklyReclusterIfDue();
}

module.exports = { runScheduled, cleanupExpired };
