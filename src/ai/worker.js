'use strict';
const { pool, Q } = require('../db');
const provider = require('./provider');
const { processEmbedJob, processSummarizeJob, processReclusterJob } = require('./cluster');

const POLL_INTERVAL_MS = 5000;
const BATCH_SIZE = 5;

// FOR UPDATE SKIP LOCKED — bir vaqtda faqat bitta worker instance bir xil
// vazifani olmasligi uchun (ko'p instance bo'lsa ham xavfsiz).
async function claimJobs() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM ai_jobs WHERE status='pending' AND run_after<=extract(epoch from now())::int
       ORDER BY created_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [BATCH_SIZE]
    );
    if (rows.length) {
      const ids = rows.map(r => r.id);
      await client.query(`UPDATE ai_jobs SET status='running' WHERE id = ANY($1::text[])`, [ids]);
    }
    await client.query('COMMIT');
    return rows;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
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

function startAiWorker() {
  if (!provider.enabled) {
    console.log("ℹ️  AI_PROVIDER o'rnatilmagan — AI klasterlash o'chirilgan (ilova baribir ishlaydi)");
    return;
  }
  setInterval(tick, POLL_INTERVAL_MS).unref();
  console.log(`🤖 AI ishchi ishga tushdi (provayder: ${provider.provider}, har ${POLL_INTERVAL_MS/1000}s tekshiradi)`);
}

module.exports = { startAiWorker, tick };
