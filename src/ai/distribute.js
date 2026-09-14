'use strict';
// FAZA 4: Ekspert taqsimlash — klasterga yangi 'problem' post qo'shilganda,
// shu mavzuda ko'p yechim topgan/faol foydalanuvchilarga taklif yuboradi.
const { Q, db } = require('../db');
const { uid } = require('../helpers');
const ws = require('../ws');
const { cosineSim, parseVec } = require('./cluster');

const NEARBY_THRESHOLD = 0.7;
const MAX_INVITES_PER_POST = 5;
const MAX_INVITES_PER_USER_PER_DAY = 3;
const PAUSE_AFTER_CONSECUTIVE_UNANSWERED = 5;

async function distributeExperts({ cluster_id, post_id }) {
  if (!cluster_id || !post_id) return;
  const cluster = await Q.clById(cluster_id);
  if (!cluster) return;
  const post = await db.get('SELECT id,user_id,title FROM posts WHERE id=$1', [post_id]);
  if (!post) return;

  // Mavjud takliflar soni shu post uchun chegaradan oshmasin
  const existingCount = (await Q.eiCountForPost(post_id)).c;
  if (existingCount >= MAX_INVITES_PER_POST) return;

  // Shu klaster + yaqin klasterlar (centroid similarity > 0.7)
  const allClusters = await Q.clAllActive();
  const centroid = parseVec(cluster.centroid);
  const nearbyIds = allClusters
    .filter(c => c.id === cluster_id || cosineSim(centroid, parseVec(c.centroid)) > NEARBY_THRESHOLD)
    .map(c => c.id);

  const candidates = await Q.etTopForClusters(nearbyIds, post.user_id, 20);
  let sent = 0;
  const dayAgo = Math.floor(Date.now() / 1000) - 86400;

  for (const cand of candidates) {
    if (existingCount + sent >= MAX_INVITES_PER_POST) break;

    const userId = cand.user_id;
    if (userId === post.user_id) continue; // post muallifining o'ziga taklif yubormaslik

    const already = await Q.eiExists(userId, post_id);
    if (already) continue;

    const user = await Q.uById(userId);
    if (!user || user.is_banned) continue;

    // 24 soatda 3 tadan ko'p taklif olmagan bo'lsin
    const todayCount = (await Q.eiCountForUserSince(userId, dayAgo)).c;
    if (todayCount >= MAX_INVITES_PER_USER_PER_DAY) continue;

    // Ketma-ket 5 ta taklifni javobsiz qoldirgan bo'lsa — vaqtincha to'xtatish
    const lastN = await Q.eiLastNForUser(userId, PAUSE_AFTER_CONSECUTIVE_UNANSWERED);
    if (lastN.length >= PAUSE_AFTER_CONSECUTIVE_UNANSWERED && lastN.every(r => r.status === 'expired')) continue;

    // Foydalanuvchi sozlamalarida taklifni o'chirmagan bo'lsin
    await Q.npEnsure(userId);
    const prefs = await Q.npGet(userId);
    if (prefs && prefs.expert_invite === 0) continue;

    const inviteId = uid();
    await Q.eiInsert(inviteId, userId, cluster_id, post_id);

    const nid = uid();
    const msg = `Siz bu mavzuda yordam bera olasiz: ${post.title.slice(0, 60)}`;
    await Q.nInsert(nid, userId, post.user_id, 'expert_invite', post_id, null, msg);
    ws.sendTo(userId, {
      type: 'notif',
      data: { id: nid, type: 'expert_invite', post_id, msg, is_read: 0, ago: 'Hozir' },
    });

    sent++;
  }
}

module.exports = { distributeExperts };
