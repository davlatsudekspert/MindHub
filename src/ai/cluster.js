'use strict';
const { Q, db } = require('../db');
const { uid } = require('../helpers');
const provider = require('./provider');

const CLUSTER_THRESHOLD = parseFloat(process.env.CLUSTER_THRESHOLD || '0.78');
const CLUSTER_MIN_SIZE = parseInt(process.env.CLUSTER_MIN_SIZE || '3', 10);
const RECLUSTER_MERGE_THRESHOLD = 0.92;

function parseVec(v) { return typeof v === 'string' ? JSON.parse(v) : v; }

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Yangi post uchun embedding hisoblab, mos klasterni topadi yoki yangisini yaratadi.
// Faqat kind IN ('problem','idea') bo'lgan postlar klasterlanadi.
async function processEmbedJob(postId) {
  const post = await db.get('SELECT id,user_id,title,body,kind,community_id FROM posts WHERE id=$1', [postId]);
  if (!post || !['problem', 'idea'].includes(post.kind)) return null;

  const text = `${post.title}\n${post.body || ''}`.slice(0, 2000);
  const vectors = await provider.embed([text]);
  if (!vectors || !vectors[0]) return null;
  const embedding = vectors[0];
  const norm = Math.sqrt(embedding.reduce((s, x) => s + x*x, 0));
  await Q.peUpsert(postId, embedding, provider.provider, norm);

  const clusters = await Q.clAllActive();
  let best = null, bestSim = -1;
  for (const c of clusters) {
    const sim = cosineSim(embedding, parseVec(c.centroid));
    if (sim > bestSim) { bestSim = sim; best = c; }
  }

  let clusterId;
  if (best && bestSim >= CLUSTER_THRESHOLD) {
    clusterId = best.id;
    await Q.clmInsert(clusterId, postId, post.user_id, bestSim);
    // Markazni yangilash: to'liq qayta hisoblash o'rniga vaznli o'rtacha
    // (barcha a'zolar embeddinglarini qayta o'qish qimmat bo'lgani uchun)
    const oldCentroid = parseVec(best.centroid);
    const n = best.member_count;
    const newCentroid = oldCentroid.map((v, i) => (v*n + embedding[i]) / (n + 1));
    const uniqueUsers = (await Q.clmUniqueUsers(clusterId)).c;
    await Q.clUpdateAfterJoin(clusterId, newCentroid, n + 1, uniqueUsers);
  } else {
    clusterId = uid();
    await Q.clInsert(clusterId, post.title.slice(0, 120), '', embedding, post.kind);
    await Q.clmInsert(clusterId, postId, post.user_id, 1);
  }

  await Q.cdIncr(clusterId);
  if (post.community_id) await Q.clSetTopCommunity(clusterId, post.community_id);

  const cluster = await Q.clById(clusterId);
  if (cluster.member_count === CLUSTER_MIN_SIZE || cluster.member_count % 10 === 0) {
    await Q.ajInsert(uid(), 'summarize', { cluster_id: clusterId });
  }
  // Ekspert taqsimlash (FAZA 4 tomonidan qayta ishlanadi)
  await Q.ajInsert(uid(), 'distribute', { cluster_id: clusterId, post_id: postId });

  return clusterId;
}

// LLM yordamida klaster uchun o'zbekcha sarlavha va qisqa xulosa yozadi
async function processSummarizeJob(clusterId) {
  const posts = await Q.clmSamplePosts(clusterId, 10);
  if (!posts.length) return;
  const titles = posts.map(p => `- ${p.title}`).join('\n');
  const system = "Siz o'zbek tilida yozadigan yordamchisiz. Foydalanuvchilar ko'targan o'xshash " +
    "muammo/g'oyalarning sarlavhalarini o'qib, ularni birlashtiruvchi QISQA sarlavha (5-8 so'z) va " +
    "2-3 gapli xulosa yozing. Javobni FAQAT JSON formatida bering, boshqa matn qo'shmang: " +
    '{"title":"...","summary":"..."}';
  const user = `Sarlavhalar:\n${titles}`;
  try {
    const raw = await provider.chat(system, user);
    if (!raw) return;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.title) {
      await Q.clUpdateSummary(clusterId, String(parsed.title).slice(0, 120), String(parsed.summary || '').slice(0, 500));
    }
  } catch (e) {
    console.error('processSummarizeJob:', e.message);
  }
}

// Haftalik: juda yaqin klasterlarni birlashtiradi (centroid similarity > 0.92)
async function processReclusterJob() {
  const clusters = await Q.clAllActive();
  const merged = new Set();
  for (let i = 0; i < clusters.length; i++) {
    if (merged.has(clusters[i].id)) continue;
    const ci = parseVec(clusters[i].centroid);
    for (let j = i + 1; j < clusters.length; j++) {
      if (merged.has(clusters[j].id)) continue;
      const cj = parseVec(clusters[j].centroid);
      if (cosineSim(ci, cj) <= RECLUSTER_MERGE_THRESHOLD) continue;

      const keepId = clusters[i].id, dropId = clusters[j].id;
      // dropId'dagi postlarni keepId'ga ko'chirish (dublikatlarni tashlab)
      await db.run(
        `UPDATE cluster_members SET cluster_id=$1
         WHERE cluster_id=$2 AND post_id NOT IN (SELECT post_id FROM cluster_members WHERE cluster_id=$1)`,
        [keepId, dropId]
      );
      await db.run('DELETE FROM cluster_members WHERE cluster_id=$1', [dropId]);
      await db.run('DELETE FROM cluster_daily WHERE cluster_id=$1', [dropId]);
      await db.run('DELETE FROM clusters WHERE id=$1', [dropId]);
      const memberCount = (await db.get('SELECT COUNT(*)::int as c FROM cluster_members WHERE cluster_id=$1', [keepId])).c;
      const uniqueUsers = (await Q.clmUniqueUsers(keepId)).c;
      await Q.clUpdateAfterJoin(keepId, ci, memberCount, uniqueUsers);
      merged.add(dropId);
    }
  }
  if (merged.size) console.log(`[ai:recluster] ${merged.size} ta klaster birlashtirildi`);
}

module.exports = {
  cosineSim, parseVec,
  processEmbedJob, processSummarizeJob, processReclusterJob,
  CLUSTER_THRESHOLD, CLUSTER_MIN_SIZE,
};
