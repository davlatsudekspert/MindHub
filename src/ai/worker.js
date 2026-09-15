'use strict';
const { Q } = require('../db');
const provider = require('./provider');
const { processEmbedJob, processSummarizeJob, processReclusterJob } = require('./cluster');

const BATCH_SIZE = 5;

// Postgres versiyasida "FOR UPDATE SKIP LOCKED" bilan tranzaksiya ichida
// qulflab olinardi (bir nechta worker instansi bir xil vazifani ikki marta
// olib qo'ymasligi uchun). D1 yagona yozuvchi modeliga ega — bir vaqtning
// o'zida faqat bitta yozish amali bajariladi, shuning uchun oddiy
// UPDATE...RETURNING (Q.ajClaimBatch, src/db.js) allaqachon atomik va bu
// yerda alohida tranzaksiya/qulf shart emas.
async function claimJobs() {
  return Q.ajClaimBatch(BATCH_SIZE);
}

async function runJob(job) {
  const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
  try {
    if (job.kind === 'embed') {
      await processEmbedJob(payload.post_id);
    } else if (job.kind === 'summarize') {
      await processSummarizeJob(payload.cluster_id);
    } else if (job.kind === 'recluster') {
      await processReclusterJob();
    } else if (job.kind === 'distribute') {
      // FAZA 4 modulida to'ldiriladi (agar mavjud bo'lsa)
      try {
        const { distributeExperts } = require('./distribute');
        await distributeExperts(payload);
      } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND') throw e;
      }
    } else {
      console.warn(`ai job: noma'lum kind '${job.kind}'`);
    }
    await Q.ajMarkDone(job.id);
  } catch (e) {
    console.error(`ai job ${job.kind} (${job.id}) xato:`, e.message);
    const attempts = (job.attempts || 0) + 1;
    const runAfter = Math.floor(Date.now() / 1000) + Math.pow(2, attempts) * 60;
    await Q.ajMarkFailed(job.id, String(e.message).slice(0, 500), runAfter, attempts);
  }
}

let running = false;
async function tick() {
  if (!provider.enabled) return;
  if (running) return;
  running = true;
  try {
    const jobs = await claimJobs();
    for (const job of jobs) await runJob(job);
  } catch (e) {
    console.error('ai worker tick xatoligi:', e.message);
  } finally {
    running = false;
  }
}

// Node/setInterval versiyasi endi yo'q — Workers'da doimiy background process
// bo'lmaydi. Buning o'rniga worker/index.js'dagi scheduled() handler (Cron
// Trigger, wrangler.toml'da "*/1 * * * *") har daqiqada tick()ni chaqiradi.
module.exports = { tick };
