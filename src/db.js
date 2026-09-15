'use strict';
const crypto = require('crypto');
const { getEnv } = require('./env');

/* ── Postgres SQL -> D1 (SQLite) moslashtiruvchi ──
   Bu loyiha ilgari (Railway'dagi) PostgreSQL bilan yozilgan edi — endi
   to'liq Cloudflare D1'ga ko'chirilgan. Q obyektidagi SQL matnlarining
   AKSARIYATI o'zgarishsiz qoldirilishi mumkin, chunki quyidagi transform
   BARCHA so'rovlar orqali avtomatik o'tadi va xavfsiz, universal
   almashtirishlarni bajaradi:
     - `$1,$2,...` -> oddiy `?` (SQLite), qiymatlar to'g'ri tartibda
       qayta joylashtiriladi — bitta $N bir necha marta ishlatilgan
       so'rovlarda ham to'g'ri ishlaydi (masalan clListRanked).
     - `::int`, `::text[]`, `::double precision` kabi Postgres cast'lari
       olib tashlanadi (SQLite dinamik tiplangan, kerak emas).
     - `extract(epoch from now())` -> `unixepoch()`.
     - `greatest(`/`GREATEST(` -> `max(` (SQLite'da alohida GREATEST yo'q,
       max() ikki argument bilan skalyar funksiya sifatida ishlaydi).
   Postgres'ga XOS bo'lgan, avtomatik almashtirilmaydigan narsalar (ANY(),
   CURRENT_DATE arifmetikasi, to'liq matnli qidiruv) har bir Q funksiyasida
   ALOHIDA qo'lda qayta yozilgan — pastda tegishli izohlar bilan belgilangan.
*/
// FAQAT haqiqatda ishlatilgan Postgres cast tiplari — ATAYLAB qattiq ro'yxat
// (oldingi versiyada `::\s*[a-zA-Z ]+` kabi "ochiq" regex ishlatilgan edi,
// u "::double precision IS NULL OR ..." kabi joylarda "IS NULL OR" so'zlarini
// ham "tip nomi" deb yutib yuborib, SQL'ni butunlay buzgan — haqiqiy bug,
// wrangler dev orqali topilgan). Faqat aniq shu ro'yxatdagi tiplar mos keladi.
const PG_CASTS = /::\s*(double precision|int|integer|text\[\]|text|real|bool|boolean|date)\b/gi;
function toD1(sql, params) {
  sql = sql.replace(PG_CASTS, '');
  sql = sql.replace(/extract\(epoch from now\(\)\)/gi, 'unixepoch()');
  sql = sql.replace(/greatest\(/gi, 'max(');
  const newParams = [];
  sql = sql.replace(/\$(\d+)/g, (_, n) => {
    const v = params[Number(n) - 1];
    newParams.push(v === undefined ? null : v);
    return '?';
  });
  return { sql, params: newParams };
}

const db = {
  async run(sql, params = []) {
    const { sql: s, params: p } = toD1(sql, params);
    return getEnv().DB.prepare(s).bind(...p).run();
  },
  async get(sql, params = []) {
    const { sql: s, params: p } = toD1(sql, params);
    const row = await getEnv().DB.prepare(s).bind(...p).first();
    return row || null;
  },
  async all(sql, params = []) {
    const { sql: s, params: p } = toD1(sql, params);
    const res = await getEnv().DB.prepare(s).bind(...p).all();
    return res.results || [];
  },
  async query(sql, params = []) { return { rows: await this.all(sql, params) }; }
};

// `WHERE col IN (?,?,...)` uchun dinamik $N ro'yxati quradi — Postgres'dagi
// `ANY($N::text[])` massiv-parametrini D1/SQLite qo'llab-quvvatlamaydi
// (SQLite'da massiv parametr tushunchasi yo'q). startN — ro'yxatdagi
// birinchi $N raqami (chaqiruvchi funksiya qolgan $N'lar bilan mos kelishini
// o'zi hisoblaydi).
function inClause(startN, arr) {
  return arr.map((_, i) => '$' + (startN + i)).join(',');
}

const Q = {
  /* users */
  uById:      (id) => db.get('SELECT id,username,name,email,color,bio,avatar,banner,karma,followers,is_admin,is_banned,ban_reason,ban_expires_at,created_at,phone,pass_version,email_verified FROM users WHERE id=$1', [id]),
  uByIdFull:  (id) => db.get('SELECT * FROM users WHERE id=$1', [id]),
  uByLogin:   (u) => db.get('SELECT * FROM users WHERE lower(username)=lower($1) OR lower(email)=lower($1)', [u]),
  uBySlug:    (param) => db.get('SELECT id,username,name,color,bio,avatar,banner,karma,followers,is_admin,is_banned,created_at FROM users WHERE lower(username)=lower($1) OR id=$1', [param]),
  uByUsername:(uname) => db.get('SELECT id,username,name,email FROM users WHERE lower(username)=lower($1)', [uname]),
  uByPhone:   (phone) => db.get('SELECT id,username,name,email FROM users WHERE phone=$1', [phone]),
  uByPhoneFull:(phone)=> db.get('SELECT * FROM users WHERE phone=$1', [phone]),
  uSearch:    (p1, p2) => db.all('SELECT id,username,name,color,avatar,karma FROM users WHERE lower(username) LIKE $1 OR lower(name) LIKE $2 LIMIT 20', [p1, p2]),
  uInsert:    (id, username, name, email, pass, color) => db.run('INSERT INTO users(id,username,name,email,pass,color) VALUES($1,$2,$3,$4,$5,$6)', [id, username, name, email, pass, color]),
  uExists:    (username, email) => db.get('SELECT id FROM users WHERE lower(username)=lower($1) OR lower(email)=lower($2)', [username, email]),
  uUpdProf:   (name, bio, id) => db.run('UPDATE users SET name=$1,bio=$2 WHERE id=$3', [name, bio, id]),
  uUpdPass:   (pass, id) => db.run('UPDATE users SET pass=$1,pass_version=pass_version+1 WHERE id=$2', [pass, id]),
  uSetPhone:  (phone, id) => db.run('UPDATE users SET phone=$1 WHERE id=$2', [phone, id]),
  uSetTgChat: (chat_id, id) => db.run('UPDATE users SET tg_chat_id=$1 WHERE id=$2', [chat_id, id]),
  uSetTgId:   (tg_id, id) => db.run('UPDATE users SET tg_id=$1 WHERE id=$2', [tg_id, id]),
  uByTgId:    (tg_id) => db.get('SELECT id,username,name,email FROM users WHERE tg_id=$1', [tg_id]),
  uUpdAv:     (avatar, id) => db.run('UPDATE users SET avatar=$1 WHERE id=$2', [avatar, id]),
  uUpdBanner: (banner, id) => db.run('UPDATE users SET banner=$1 WHERE id=$2', [banner, id]),
  uKarma:     (delta, id) => db.run('UPDATE users SET karma=karma+$1 WHERE id=$2', [delta, id]),
  uFollowers: (id) => db.run('UPDATE users SET followers=(SELECT COUNT(*) FROM follows WHERE following_id=users.id) WHERE id=$1', [id]),
  uAll:       () => db.all('SELECT id,username,name,email,color,avatar,karma,is_admin,is_banned,ban_reason,created_at FROM users ORDER BY created_at DESC LIMIT 100'),
  uBan:       (reason, id, expiresAt) => db.run('UPDATE users SET is_banned=1,ban_reason=$1,ban_expires_at=$2 WHERE id=$3', [reason, expiresAt||null, id]),
  uUnban:     (id) => db.run('UPDATE users SET is_banned=0,ban_reason=NULL,ban_expires_at=NULL WHERE id=$1', [id]),
  uMakeAdmin: (id) => db.run('UPDATE users SET is_admin=1 WHERE id=$1', [id]),
  uRemAdmin:  (id) => db.run('UPDATE users SET is_admin=0 WHERE id=$1', [id]),

  /* communities */
  comAll:    () => db.all('SELECT c.*,u.username as oname FROM communities c JOIN users u ON c.owner_id=u.id ORDER BY c.members DESC LIMIT 60'),
  comById:   (id) => db.get('SELECT c.*,u.username as oname FROM communities c JOIN users u ON c.owner_id=u.id WHERE c.id=$1', [id]),
  comBySlug: (slug) => db.get('SELECT c.*,u.username as oname FROM communities c JOIN users u ON c.owner_id=u.id WHERE lower(c.slug)=lower($1)', [slug]),
  comSearch: (p1, p2) => db.all('SELECT c.*,u.username as oname FROM communities c JOIN users u ON c.owner_id=u.id WHERE c.is_private=0 AND (lower(c.slug) LIKE $1 OR lower(c.name) LIKE $2) LIMIT 20', [p1, p2]),
  comInsert: (id, slug, name, description, color, owner_id, is_private) => db.run('INSERT INTO communities(id,slug,name,description,color,owner_id,is_private) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, slug, name, description, color, owner_id, is_private||0]),
  comUpdate: (name, description, rules, color, id) => db.run('UPDATE communities SET name=$1,description=$2,rules=$3,color=$4 WHERE id=$5', [name, description, rules, color, id]),
  comDelete: (id) => db.run('DELETE FROM communities WHERE id=$1', [id]),
  comIncMem: (id) => db.run('UPDATE communities SET members=members+1 WHERE id=$1', [id]),
  comDecMem: (id) => db.run('UPDATE communities SET members=max(0,members-1) WHERE id=$1', [id]),
  comTop:    () => db.all('SELECT c.*,u.username as oname FROM communities c JOIN users u ON c.owner_id=u.id ORDER BY c.members DESC LIMIT 10'),
  comMine:   (user_id) => db.all('SELECT c.*,u.username as oname FROM communities c JOIN users u ON c.owner_id=u.id JOIN memberships m ON m.community_id=c.id WHERE m.user_id=$1 ORDER BY c.members DESC', [user_id]),

  /* memberships */
  memCheck:  (user_id, community_id) => db.get('SELECT 1 FROM memberships WHERE user_id=$1 AND community_id=$2', [user_id, community_id]),
  // ANY($N::text[]) D1/SQLite'da yo'q — dinamik IN(...) ro'yxati (inClause)
  memCheckBatch: (user_id, community_ids) => (!user_id || !community_ids.length) ? Promise.resolve([]) :
    db.all(`SELECT community_id FROM memberships WHERE user_id=$1 AND community_id IN (${inClause(2, community_ids)})`, [user_id, ...community_ids]),
  memJoin:   (user_id, community_id) => db.run('INSERT INTO memberships(user_id,community_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [user_id, community_id]),
  memLeave:  (user_id, community_id) => db.run('DELETE FROM memberships WHERE user_id=$1 AND community_id=$2', [user_id, community_id]),

  /* posts */
  // "Hot" saralash — Reddit formulasi: sign(score)*log10(max(|score|,1)) + yosh/45000.
  // sign()/log() SQLite'ning matematik kengaytmasidan (D1'da yoqilgan) keladi.
  //
  // Cursor-asosli pagination va uning tiebreak/precision eslatmalari uchun
  // CLAUDE.md'ga qarang — bu SQL mantiq Postgres versiyasi bilan bir xil,
  // faqat toD1() orqali ?/cast-siz shaklga o'giriladi.
  pHot: (cursor, limit) => db.all(
    `SELECT p.*,u.username,u.color,u.avatar,c.slug as cslug,c.name as cname,c.color as ccolor,c.is_private,
       (sign(p.score)*log(greatest(abs(p.score),1)) + p.created_at/45000.0) as hot_rank
     FROM posts p JOIN users u ON p.user_id=u.id JOIN communities c ON p.community_id=c.id
     WHERE $1::double precision IS NULL OR (sign(p.score)*log(greatest(abs(p.score),1)) + p.created_at/45000.0, p.created_at, p.id) < ($1::double precision, $2::int, $3::text)
     ORDER BY hot_rank DESC, p.created_at DESC, p.id DESC LIMIT $4`,
    [cursor?.hs ?? null, cursor?.ct ?? null, cursor?.id ?? null, limit]
  ),
  pNew: (cursor, limit) => db.all(
    `SELECT p.*,u.username,u.color,u.avatar,c.slug as cslug,c.name as cname,c.color as ccolor,c.is_private
     FROM posts p JOIN users u ON p.user_id=u.id JOIN communities c ON p.community_id=c.id
     WHERE $1::int IS NULL OR (p.created_at, p.id) < ($1::int, $2::text)
     ORDER BY p.created_at DESC, p.id DESC LIMIT $3`,
    [cursor?.ct ?? null, cursor?.id ?? null, limit]
  ),
  pCom: (slug, cursor, limit) => db.all(
    `SELECT p.*,u.username,u.color,u.avatar,c.slug as cslug,c.name as cname,c.color as ccolor,
       (sign(p.score)*log(greatest(abs(p.score),1)) + p.created_at/45000.0) as hot_rank
     FROM posts p JOIN users u ON p.user_id=u.id JOIN communities c ON p.community_id=c.id
     WHERE lower(c.slug)=lower($1)
       AND ($2::double precision IS NULL OR (sign(p.score)*log(greatest(abs(p.score),1)) + p.created_at/45000.0, p.created_at, p.id) < ($2::double precision, $3::int, $4::text))
     ORDER BY hot_rank DESC, p.created_at DESC, p.id DESC LIMIT $5`,
    [slug, cursor?.hs ?? null, cursor?.ct ?? null, cursor?.id ?? null, limit]
  ),
  pComNew: (slug, cursor, limit) => db.all(
    `SELECT p.*,u.username,u.color,u.avatar,c.slug as cslug,c.name as cname,c.color as ccolor
     FROM posts p JOIN users u ON p.user_id=u.id JOIN communities c ON p.community_id=c.id
     WHERE lower(c.slug)=lower($1) AND ($2::int IS NULL OR (p.created_at, p.id) < ($2::int, $3::text))
     ORDER BY p.created_at DESC, p.id DESC LIMIT $4`,
    [slug, cursor?.ct ?? null, cursor?.id ?? null, limit]
  ),
  pByUser: (user_id) => db.all('SELECT p.*,u.username,u.color,u.avatar,c.slug as cslug,c.name as cname,c.color as ccolor FROM posts p JOIN users u ON p.user_id=u.id JOIN communities c ON p.community_id=c.id WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 25', [user_id]),
  pOne:    (id) => db.get('SELECT p.*,u.username,u.color,u.avatar,c.slug as cslug,c.name as cname,c.color as ccolor FROM posts p JOIN users u ON p.user_id=u.id JOIN communities c ON p.community_id=c.id WHERE p.id=$1', [id]),
  pInsert: (id, user_id, community_id, title, body, link, image, video, audio, type, flair, kind) => db.run('INSERT INTO posts(id,user_id,community_id,title,body,link,image,video,audio,type,flair,kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [id, user_id, community_id, title, body, link, image, video, audio, type, flair, kind || 'post']),
  pDelete: (id) => db.run('DELETE FROM posts WHERE id=$1', [id]),
  pUpdate: (title, body, id, user_id) => db.run('UPDATE posts SET title=$1,body=$2 WHERE id=$3 AND user_id=$4', [title, body, id, user_id]),
  pOwner:  (id) => db.get('SELECT user_id,community_id FROM posts WHERE id=$1', [id]),
  pScore:  (score, upvotes, downvotes, id) => db.run('UPDATE posts SET score=$1,upvotes=$2,downvotes=$3 WHERE id=$4', [score, upvotes, downvotes, id]),
  pIncCmt: (id) => db.run('UPDATE posts SET comment_count=comment_count+1 WHERE id=$1', [id]),
  // To'liq matnli qidiruv — Postgres'da tsvector/GIN/plainto_tsquery ishlatilgan
  // edi, D1/SQLite'da ekvivalenti yo'q. O'rniga migrations/d1/0005'da
  // yaratilgan FTS5 virtual jadval (posts_fts, posts bilan trigger orqali
  // sinxron) ishlatiladi. bm25() natijasi — kichikroq qiymat = ko'proq mos
  // (Postgres'dagi ts_rank'ning teskarisi), shuning uchun ASC bilan saralanadi.
  // Har bir so'z alohida qo'shtirnoqqa olinadi — foydalanuvchi matnida FTS5'ning
  // maxsus operatorlari (AND/OR/NOT/*/-) bo'lsa ham xavfsiz ishlaydi.
  pSearch: (query) => {
    const words = String(query || '').trim().split(/\s+/).filter(Boolean).slice(0, 10);
    if (!words.length) return Promise.resolve([]);
    const ftsQuery = words.map(w => '"' + w.replace(/"/g, '""') + '"').join(' ');
    return db.all(
      `SELECT p.*,u.username,u.color,u.avatar,c.slug as cslug,c.name as cname,c.color as ccolor
       FROM posts_fts JOIN posts p ON p.rowid = posts_fts.rowid
       JOIN users u ON p.user_id=u.id JOIN communities c ON p.community_id=c.id
       WHERE posts_fts MATCH $1
       ORDER BY bm25(posts_fts) ASC, p.score DESC LIMIT 20`,
      [ftsQuery]
    );
  },
  pSaved:  (user_id) => db.all('SELECT p.*,u.username,u.color,u.avatar,c.slug as cslug,c.name as cname,c.color as ccolor FROM posts p JOIN users u ON p.user_id=u.id JOIN communities c ON p.community_id=c.id JOIN saved_posts sp ON sp.post_id=p.id WHERE sp.user_id=$1 ORDER BY sp.saved_at DESC', [user_id]),

  /* post votes */
  pvGet:    (user_id, post_id) => db.get('SELECT vote FROM post_votes WHERE user_id=$1 AND post_id=$2', [user_id, post_id]),
  pvUpsert: (user_id, post_id, vote) => db.run('INSERT INTO post_votes(user_id,post_id,vote) VALUES($1,$2,$3) ON CONFLICT (user_id,post_id) DO UPDATE SET vote=EXCLUDED.vote', [user_id, post_id, vote]),
  pvDelete: (user_id, post_id) => db.run('DELETE FROM post_votes WHERE user_id=$1 AND post_id=$2', [user_id, post_id]),
  pvCount:  (post_id) => db.get('SELECT COALESCE(SUM(CASE WHEN vote=1 THEN 1 ELSE 0 END),0) as up,COALESCE(SUM(CASE WHEN vote=-1 THEN 1 ELSE 0 END),0) as dn FROM post_votes WHERE post_id=$1', [post_id]),
  pvGetBatch: (user_id, post_ids) => (!user_id || !post_ids.length) ? Promise.resolve([]) :
    db.all(`SELECT post_id, vote FROM post_votes WHERE user_id=$1 AND post_id IN (${inClause(2, post_ids)})`, [user_id, ...post_ids]),

  /* saved */
  svCheck:  (user_id, post_id) => db.get('SELECT 1 FROM saved_posts WHERE user_id=$1 AND post_id=$2', [user_id, post_id]),
  svInsert: (user_id, post_id) => db.run('INSERT INTO saved_posts(user_id,post_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [user_id, post_id]),
  svDelete: (user_id, post_id) => db.run('DELETE FROM saved_posts WHERE user_id=$1 AND post_id=$2', [user_id, post_id]),
  svCheckBatch: (user_id, post_ids) => (!user_id || !post_ids.length) ? Promise.resolve([]) :
    db.all(`SELECT post_id FROM saved_posts WHERE user_id=$1 AND post_id IN (${inClause(2, post_ids)})`, [user_id, ...post_ids]),

  /* comments */
  cmByPost: (post_id) => db.all('SELECT cm.*,u.username,u.color,u.avatar FROM comments cm JOIN users u ON cm.user_id=u.id WHERE cm.post_id=$1 ORDER BY cm.is_solution DESC,cm.score DESC,cm.created_at ASC', [post_id]),
  cmInsert: (id, post_id, user_id, parent_id, body, depth) => db.run('INSERT INTO comments(id,post_id,user_id,parent_id,body,depth) VALUES($1,$2,$3,$4,$5,$6)', [id, post_id, user_id, parent_id, body, depth]),
  cmOne:    (id) => db.get('SELECT cm.*,u.username,u.color,u.avatar FROM comments cm JOIN users u ON cm.user_id=u.id WHERE cm.id=$1', [id]),
  cmOwner:  (id) => db.get('SELECT user_id,post_id FROM comments WHERE id=$1', [id]),
  cmDelete: (id) => db.run("UPDATE comments SET is_deleted=1,body='[o''chirildi]' WHERE id=$1", [id]),
  cmScore:  (score, id) => db.run('UPDATE comments SET score=$1 WHERE id=$2', [score, id]),
  cmDepth:  (id) => db.get('SELECT depth FROM comments WHERE id=$1', [id]),

  /* comment votes */
  cvGet:    (user_id, comment_id) => db.get('SELECT vote FROM comment_votes WHERE user_id=$1 AND comment_id=$2', [user_id, comment_id]),
  cvUpsert: (user_id, comment_id, vote) => db.run('INSERT INTO comment_votes(user_id,comment_id,vote) VALUES($1,$2,$3) ON CONFLICT (user_id,comment_id) DO UPDATE SET vote=EXCLUDED.vote', [user_id, comment_id, vote]),
  cvDelete: (user_id, comment_id) => db.run('DELETE FROM comment_votes WHERE user_id=$1 AND comment_id=$2', [user_id, comment_id]),
  cvCount:  (comment_id) => db.get('SELECT COALESCE(SUM(CASE WHEN vote=1 THEN 1 ELSE 0 END),0) as up,COALESCE(SUM(CASE WHEN vote=-1 THEN 1 ELSE 0 END),0) as dn FROM comment_votes WHERE comment_id=$1', [comment_id]),
  cvGetBatch: (user_id, comment_ids) => (!user_id || !comment_ids.length) ? Promise.resolve([]) :
    db.all(`SELECT comment_id, vote FROM comment_votes WHERE user_id=$1 AND comment_id IN (${inClause(2, comment_ids)})`, [user_id, ...comment_ids]),

  /* follows */
  fwCheck:     (follower_id, following_id) => db.get('SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2', [follower_id, following_id]),
  fwInsert:    (follower_id, following_id) => db.run('INSERT INTO follows(follower_id,following_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [follower_id, following_id]),
  fwDelete:    (follower_id, following_id) => db.run('DELETE FROM follows WHERE follower_id=$1 AND following_id=$2', [follower_id, following_id]),
  fwFollowers: (following_id) => db.get('SELECT COUNT(*) as c FROM follows WHERE following_id=$1', [following_id]),
  fwFollowing: (follower_id) => db.get('SELECT COUNT(*) as c FROM follows WHERE follower_id=$1', [follower_id]),

  /* messages */
  msgConvos:   (uid) => db.all('SELECT DISTINCT CASE WHEN from_id=$1 THEN to_id ELSE from_id END as oid FROM messages WHERE from_id=$1 OR to_id=$1', [uid]),
  msgThread:   (a, b, c, d) => db.all('SELECT * FROM messages WHERE (from_id=$1 AND to_id=$2) OR (from_id=$3 AND to_id=$4) ORDER BY created_at ASC LIMIT 100', [a, b, c, d]),
  msgInsert:   (id, from_id, to_id, body, type, image_url, audio_url, duration) => db.run('INSERT INTO messages(id,from_id,to_id,body,type,image_url,audio_url,duration) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, from_id, to_id, body, type, image_url, audio_url, duration]),
  msgMarkRead: (from_id, to_id) => db.run('UPDATE messages SET is_read=1 WHERE from_id=$1 AND to_id=$2', [from_id, to_id]),
  msgLast:     (a, b, c, d) => db.get('SELECT * FROM messages WHERE (from_id=$1 AND to_id=$2) OR (from_id=$3 AND to_id=$4) ORDER BY created_at DESC LIMIT 1', [a, b, c, d]),
  msgUnread:   (to_id) => db.get('SELECT COUNT(*) as c FROM messages WHERE to_id=$1 AND is_read=0', [to_id]),

  /* notifications */
  nInsert:   (id, to_id, from_id, type, post_id, comment_id, msg) => db.run('INSERT INTO notifications(id,to_id,from_id,type,post_id,comment_id,msg) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, to_id, from_id, type, post_id, comment_id, msg]),
  nAll:      (to_id) => db.all('SELECT n.*,u.username as fn,u.color as fc,u.avatar as fa FROM notifications n LEFT JOIN users u ON n.from_id=u.id WHERE n.to_id=$1 ORDER BY n.created_at DESC LIMIT 60', [to_id]),
  nMarkRead: (to_id) => db.run('UPDATE notifications SET is_read=1 WHERE to_id=$1', [to_id]),
  nUnread:   (to_id) => db.get('SELECT COUNT(*) as c FROM notifications WHERE to_id=$1 AND is_read=0', [to_id]),

  /* polls */
  pollInsert:  (id, post_id, question, options, duration_days, ends_at) => db.run('INSERT INTO polls(id,post_id,question,options,duration_days,ends_at) VALUES($1,$2,$3,$4,$5,$6)', [id, post_id, question, options, duration_days, ends_at]),
  pollGet:     (post_id) => db.get('SELECT * FROM polls WHERE post_id=$1', [post_id]),
  pollGetById: (id) => db.get('SELECT * FROM polls WHERE id=$1', [id]),
  pollVoteGet: (user_id, poll_id) => db.get('SELECT option_index FROM poll_votes WHERE user_id=$1 AND poll_id=$2', [user_id, poll_id]),
  pollVoteIns: (user_id, poll_id, option_index) => db.run('INSERT INTO poll_votes(user_id,poll_id,option_index) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [user_id, poll_id, option_index]),
  pollVoteCnt: (poll_id) => db.all('SELECT option_index,COUNT(*) as cnt FROM poll_votes WHERE poll_id=$1 GROUP BY option_index', [poll_id]),
  pollTotalVotes: (poll_id) => db.get('SELECT COUNT(*) as c FROM poll_votes WHERE poll_id=$1', [poll_id]),
  pollGetBatch: (post_ids) => !post_ids.length ? Promise.resolve([]) :
    db.all(`SELECT * FROM polls WHERE post_id IN (${inClause(1, post_ids)})`, [...post_ids]),
  pollVoteCntBatch: (poll_ids) => !poll_ids.length ? Promise.resolve([]) :
    db.all(`SELECT poll_id, option_index, COUNT(*) as cnt FROM poll_votes WHERE poll_id IN (${inClause(1, poll_ids)}) GROUP BY poll_id, option_index`, [...poll_ids]),
  pollTotalVotesBatch: (poll_ids) => !poll_ids.length ? Promise.resolve([]) :
    db.all(`SELECT poll_id, COUNT(*) as c FROM poll_votes WHERE poll_id IN (${inClause(1, poll_ids)}) GROUP BY poll_id`, [...poll_ids]),
  pollVoteGetBatch: (user_id, poll_ids) => (!user_id || !poll_ids.length) ? Promise.resolve([]) :
    db.all(`SELECT poll_id, option_index FROM poll_votes WHERE user_id=$1 AND poll_id IN (${inClause(2, poll_ids)})`, [user_id, ...poll_ids]),

  /* push tokens */
  pushIns:    (user_id, token) => db.run('INSERT INTO push_tokens(user_id,token) VALUES($1,$2) ON CONFLICT DO NOTHING', [user_id, token]),
  pushDel:    (user_id, token) => db.run('DELETE FROM push_tokens WHERE user_id=$1 AND token=$2', [user_id, token]),
  pushByUser: (user_id) => db.all('SELECT token FROM push_tokens WHERE user_id=$1', [user_id]),

  /* followers list for notifications */
  fwFollowersList: (following_id) => db.all('SELECT follower_id FROM follows WHERE following_id=$1', [following_id]),
  fwFollowersCount: (following_id) => db.get('SELECT COUNT(*) as c FROM follows WHERE following_id=$1', [following_id]),

  /* community update with image */
  comUpdateFull: (name, description, rules, color, avatar, banner, id) => db.run('UPDATE communities SET name=$1,description=$2,rules=$3,color=$4,avatar=$5,banner=$6 WHERE id=$7', [name, description, rules, color, avatar, banner, id]),

  /* reports */
  rpInsert:  (id, reporter_id, post_id, comment_id, reason) => db.run('INSERT INTO reports(id,reporter_id,post_id,comment_id,reason) VALUES($1,$2,$3,$4,$5)', [id, reporter_id, post_id, comment_id, reason]),
  rpAll:     () => db.all("SELECT r.*,u.username as rname FROM reports r JOIN users u ON r.reporter_id=u.id WHERE r.status='pending' ORDER BY r.created_at DESC LIMIT 50"),
  rpResolve: (status, id) => db.run('UPDATE reports SET status=$1 WHERE id=$2', [status, id]),

  /* reset tokens */
  rtInsert:  (token, user_id, expires_at) => db.run('INSERT INTO reset_tokens(token,user_id,expires_at) VALUES($1,$2,$3)', [token, user_id, expires_at]),
  rtGet:     (token) => db.get("SELECT * FROM reset_tokens WHERE token=$1 AND used=0 AND expires_at>extract(epoch from now())::int", [token]),
  rtUse:     (token) => db.run('UPDATE reset_tokens SET used=1 WHERE token=$1', [token]),
  rtClean:   () => db.run("DELETE FROM reset_tokens WHERE expires_at<extract(epoch from now())::int OR used=1"),

  /* verify codes (email) */
  vcInsert:  (user_id, code, expires_at) => db.run('INSERT INTO verify_codes(user_id,code,expires_at) VALUES($1,$2,$3)', [user_id, code, expires_at]),
  vcGet:     (user_id, code) => db.get("SELECT * FROM verify_codes WHERE user_id=$1 AND code=$2 AND used=0 AND expires_at>extract(epoch from now())::int", [user_id, code]),
  vcUse:     (id) => db.run('UPDATE verify_codes SET used=1 WHERE id=$1', [id]),
  vcClean:   () => db.run("DELETE FROM verify_codes WHERE expires_at<extract(epoch from now())::int OR used=1"),

  /* community roles */
  comRoleGet:    (user_id, community_id) => db.get('SELECT role FROM community_roles WHERE user_id=$1 AND community_id=$2', [user_id, community_id]),
  comRoleSet:    (user_id, community_id, role) => db.run('INSERT INTO community_roles(user_id,community_id,role) VALUES($1,$2,$3) ON CONFLICT (user_id,community_id) DO UPDATE SET role=EXCLUDED.role', [user_id, community_id, role]),
  comRoleDel:    (user_id, community_id) => db.run('DELETE FROM community_roles WHERE user_id=$1 AND community_id=$2', [user_id, community_id]),
  comRoleList:   (community_id) => db.all('SELECT cr.user_id,cr.role,u.username,u.name,u.avatar,u.color FROM community_roles cr JOIN users u ON cr.user_id=u.id WHERE cr.community_id=$1', [community_id]),
  comIsAdmin:    (user_id, community_id) => db.get('SELECT 1 FROM community_roles WHERE user_id=$1 AND community_id=$2 AND role=$3', [user_id, community_id, 'admin']),
  comCanManage:  async (user_id, community_id) => {
    const owns = await db.get('SELECT 1 FROM communities WHERE id=$1 AND owner_id=$2', [community_id, user_id]);
    if (owns) return true;
    const admin = await db.get('SELECT 1 FROM community_roles WHERE user_id=$1 AND community_id=$2 AND role=$3', [user_id, community_id, 'admin']);
    return !!admin;
  },

  /* community views */
  comIncViews:   (id) => db.run('UPDATE communities SET views=views+1 WHERE id=$1', [id]),
  comByViews:    () => db.all('SELECT c.*,u.username as oname FROM communities c JOIN users u ON c.owner_id=u.id ORDER BY c.views DESC,c.members DESC LIMIT 20'),

  /* community requests */
  comReqInsert:  (id, user_id, community_id) => db.run('INSERT INTO community_requests(id,user_id,community_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [id, user_id, community_id]),
  comReqGet:     (user_id, community_id) => db.get('SELECT * FROM community_requests WHERE user_id=$1 AND community_id=$2 AND status=$3', [user_id, community_id, 'pending']),
  comReqByCom:   (community_id) => db.all('SELECT cr.*,u.username,u.name,u.avatar,u.color FROM community_requests cr JOIN users u ON cr.user_id=u.id WHERE cr.community_id=$1 AND cr.status=$2 ORDER BY cr.created_at DESC', [community_id, 'pending']),
  comReqApprove: (id) => db.run('UPDATE community_requests SET status=$1 WHERE id=$2', ['approved', id]),
  comReqReject:  (id) => db.run('UPDATE community_requests SET status=$1 WHERE id=$2', ['rejected', id]),
  comReqAll:     (user_id) => db.all('SELECT cr.*,c.name as cname,c.slug as cslug,c.color as ccolor FROM community_requests cr JOIN communities c ON cr.community_id=c.id WHERE cr.user_id=$1 ORDER BY cr.created_at DESC', [user_id]),

  /* telegram codes */
  tgCodeInsert:  (id, user_id, phone, code, expires_at) => db.run('INSERT INTO tg_codes(id,user_id,phone,code,expires_at) VALUES($1,$2,$3,$4,$5)', [id, user_id, phone, code, expires_at]),
  tgCodeGet:     (user_id, code) => db.get('SELECT * FROM tg_codes WHERE user_id=$1 AND code=$2 AND used=0 AND expires_at>extract(epoch from now())::int', [user_id, code]),
  tgCodeUse:     (id) => db.run('UPDATE tg_codes SET used=1 WHERE id=$1', [id]),
  tgCodeClean:   () => db.run("DELETE FROM tg_codes WHERE expires_at<extract(epoch from now())::int OR used=1"),

  /* admin */
  adminStats: () => db.get("SELECT (SELECT COUNT(*) FROM users) as users,(SELECT COUNT(*) FROM posts) as posts,(SELECT COUNT(*) FROM comments) as comments,(SELECT COUNT(*) FROM communities) as communities,(SELECT COUNT(*) FROM reports WHERE status='pending') as reports"),

  /* email tasdiqlash (FAZA 2) */
  uSetEmailVerified: (id) => db.run("UPDATE users SET email_verified=1,email_verified_at=extract(epoch from now())::int WHERE id=$1", [id]),
  ecInsert:         (user_id, email, code_hash, purpose, expires_at, ip) => db.run('INSERT INTO email_codes(user_id,email,code_hash,purpose,expires_at,ip) VALUES($1,$2,$3,$4,$5,$6)', [user_id, email, code_hash, purpose, expires_at, ip || null]),
  ecGetActive:      (user_id, purpose) => db.get("SELECT * FROM email_codes WHERE user_id=$1 AND purpose=$2 AND used=0 AND expires_at>extract(epoch from now())::int ORDER BY created_at DESC LIMIT 1", [user_id, purpose]),
  ecLatest:         (user_id, purpose) => db.get('SELECT * FROM email_codes WHERE user_id=$1 AND purpose=$2 ORDER BY created_at DESC LIMIT 1', [user_id, purpose]),
  ecIncAttempts:    (id) => db.run('UPDATE email_codes SET attempts=attempts+1 WHERE id=$1', [id]),
  ecMarkUsed:       (id) => db.run('UPDATE email_codes SET used=1 WHERE id=$1', [id]),
  ecInvalidateOthers:(user_id, purpose) => db.run('UPDATE email_codes SET used=1 WHERE user_id=$1 AND purpose=$2 AND used=0', [user_id, purpose]),
  ecCountLastHour:  (user_id, purpose) => db.get("SELECT COUNT(*) as c FROM email_codes WHERE user_id=$1 AND purpose=$2 AND created_at>extract(epoch from now())::int-3600", [user_id, purpose]),

  /* ══ FAZA 3: AI klasterlash ══ */
  /* post embeddings */
  peUpsert: (post_id, embedding, model, norm) => db.run('INSERT INTO post_embeddings(post_id,embedding,model,norm) VALUES($1,$2,$3,$4) ON CONFLICT (post_id) DO UPDATE SET embedding=EXCLUDED.embedding,model=EXCLUDED.model,norm=EXCLUDED.norm', [post_id, JSON.stringify(embedding), model, norm]),
  peGet:    (post_id) => db.get('SELECT * FROM post_embeddings WHERE post_id=$1', [post_id]),

  /* clusters */
  clInsert:  (id, title, summary, centroid, kind) => db.run('INSERT INTO clusters(id,title,summary,centroid,kind,member_count,unique_users,last_activity_at) VALUES($1,$2,$3,$4,$5,1,1,extract(epoch from now())::int)', [id, title, summary || '', JSON.stringify(centroid), kind || 'problem']),
  clById:    (id) => db.get('SELECT * FROM clusters WHERE id=$1', [id]),
  clByIdBatch: (ids) => !ids.length ? Promise.resolve([]) :
    db.all(`SELECT * FROM clusters WHERE id IN (${inClause(1, ids)})`, [...ids]),
  clAllActive: () => db.all("SELECT id,centroid,member_count FROM clusters WHERE status!='archived'"),
  clUpdateAfterJoin: (id, centroid, memberCount, uniqueUsers) => db.run('UPDATE clusters SET centroid=$1,member_count=$2,unique_users=$3,last_activity_at=extract(epoch from now())::int WHERE id=$4', [JSON.stringify(centroid), memberCount, uniqueUsers, id]),
  clUpdateSummary: (id, title, summary) => db.run('UPDATE clusters SET title=$1,summary=$2 WHERE id=$3', [title, summary, id]),
  clSetStatus: (id, status) => db.run('UPDATE clusters SET status=$1 WHERE id=$2', [status, id]),
  clSetTopCommunity: (id, community_id) => db.run('UPDATE clusters SET top_community_id=$1 WHERE id=$2', [community_id, id]),
  // CURRENT_DATE-7 Postgres date arifmetikasi — SQLite'da mos kelmaydi,
  // shuning uchun kesim sanasi JS'da hisoblab, $1 sifatida uzatiladi ($1
  // ikkita subquery'da ham ishlatilgan — toD1() buni to'g'ri qo'llaydi).
  clListRanked: (minSize, limit, offset) => {
    const cutoff7 = new Date(Date.now() - 7*86400000).toISOString().slice(0,10);
    return db.all(
      `SELECT c.*,
         (SELECT COUNT(*) FROM cluster_daily cd WHERE cd.cluster_id=c.id AND cd.day>=$1) as growth_7d
       FROM clusters c
       WHERE c.member_count>=$2
       ORDER BY (c.unique_users*3 + c.member_count + COALESCE((SELECT SUM(new_posts) FROM cluster_daily cd WHERE cd.cluster_id=c.id AND cd.day>=$1),0)*5) * (CASE WHEN c.status='open' THEN 1.3 ELSE 1 END) DESC
       LIMIT $3 OFFSET $4`, [cutoff7, minSize, limit, offset]);
  },
  clListNew: (minSize, limit, offset) => db.all('SELECT * FROM clusters WHERE member_count>=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [minSize, limit, offset]),
  clListSize: (minSize, limit, offset) => db.all('SELECT * FROM clusters WHERE member_count>=$1 ORDER BY member_count DESC LIMIT $2 OFFSET $3', [minSize, limit, offset]),
  clListUnsolved: (minSize, limit, offset) => db.all("SELECT * FROM clusters WHERE member_count>=$1 AND status='open' ORDER BY member_count DESC LIMIT $2 OFFSET $3", [minSize, limit, offset]),

  /* cluster members — "clm" prefix (comments allaqachon "cm" prefiksini band qilgan, chalkashmaslik uchun) */
  // post_id null bo'lishi mumkin — "Menda ham shu muammo bor" (postsiz a'zolik).
  // id: post bilan qo'shilganda deterministik (cluster_id:post_id) — takroriy
  // embed urinishlarida ON CONFLICT bilan xavfsiz; postsiz qo'shilganda tasodifiy —
  // (cluster_id,user_id) WHERE post_id IS NULL qisman indeksi dublikatni to'sadi.
  clmInsert: (cluster_id, post_id, user_id, similarity) => {
    const id = post_id ? `${cluster_id}:${post_id}` : `${cluster_id}:u:${user_id}:${crypto.randomUUID()}`;
    return db.run('INSERT INTO cluster_members(id,cluster_id,post_id,user_id,similarity) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [id, cluster_id, post_id, user_id, similarity]);
  },
  clmJoinWithoutPost: (cluster_id, user_id) => db.get('SELECT 1 FROM cluster_members WHERE cluster_id=$1 AND user_id=$2 AND post_id IS NULL', [cluster_id, user_id]),
  clBumpUniqueUsers: (id, uniqueUsers) => db.run('UPDATE clusters SET unique_users=$1,last_activity_at=extract(epoch from now())::int WHERE id=$2', [uniqueUsers, id]),
  clmByCluster: (cluster_id, limit, offset) => db.all('SELECT cm.*,p.title,p.created_at as post_created_at,u.username,u.avatar,u.color FROM cluster_members cm JOIN posts p ON cm.post_id=p.id JOIN users u ON cm.user_id=u.id WHERE cm.cluster_id=$1 ORDER BY cm.joined_at DESC LIMIT $2 OFFSET $3', [cluster_id, limit, offset]),
  clmUniqueUsers: (cluster_id) => db.get('SELECT COUNT(DISTINCT user_id) as c FROM cluster_members WHERE cluster_id=$1', [cluster_id]),
  clmSamplePosts: (cluster_id, limit) => db.all('SELECT p.id,p.title,p.created_at,u.username FROM cluster_members cm JOIN posts p ON cm.post_id=p.id JOIN users u ON p.user_id=u.id WHERE cm.cluster_id=$1 ORDER BY cm.joined_at DESC LIMIT $2', [cluster_id, limit]),
  clmByPostId: (post_id) => db.get('SELECT * FROM cluster_members WHERE post_id=$1', [post_id]),
  // Postgres'da DISTINCT ON (post_id) ishlatilgan edi — SQLite'da yo'q.
  // Amaliyotda bitta post bitta klasterda faqat bir marta bo'lishi mumkin
  // (idx_clm_cluster_post unikal indeksi shuni ta'minlaydi), shuning uchun
  // oddiy SELECT yetarli — chaqiruvchi (fmtPostsBatch) natijani Map orqali
  // post_id bo'yicha yig'adi, bu tasodifiy dublikatlarni ham xavfsiz qiladi.
  clmByPostIdBatch: (post_ids) => !post_ids.length ? Promise.resolve([]) :
    db.all(`SELECT post_id, cluster_id FROM cluster_members WHERE post_id IN (${inClause(1, post_ids)})`, [...post_ids]),
  clmForUserClusters: (user_id) => db.all('SELECT DISTINCT cluster_id FROM cluster_members WHERE user_id=$1', [user_id]),
  clmCountForUser: (user_id) => db.get('SELECT COUNT(DISTINCT cluster_id) as c FROM cluster_members WHERE user_id=$1', [user_id]),

  /* cluster daily growth — CURRENT_DATE JS'da hisoblanadi (yuqoridagi izohga qarang) */
  cdIncr: (cluster_id) => {
    const today = new Date().toISOString().slice(0,10);
    return db.run(`INSERT INTO cluster_daily(cluster_id,day,new_posts) VALUES($1,$2,1) ON CONFLICT (cluster_id,day) DO UPDATE SET new_posts=cluster_daily.new_posts+1`, [cluster_id, today]);
  },
  cdSeries: (cluster_id, days) => {
    const cutoff = new Date(Date.now() - days*86400000).toISOString().slice(0,10);
    return db.all('SELECT day,new_posts FROM cluster_daily WHERE cluster_id=$1 AND day>=$2 ORDER BY day ASC', [cluster_id, cutoff]);
  },

  /* ai jobs queue */
  ajInsert: (id, kind, payload, run_after) => db.run('INSERT INTO ai_jobs(id,kind,payload,run_after) VALUES($1,$2,$3,$4)', [id, kind, JSON.stringify(payload), run_after || Math.floor(Date.now()/1000)]),
  ajMarkDone: (id) => db.run("UPDATE ai_jobs SET status='done' WHERE id=$1", [id]),
  ajMarkFailed: (id, error, run_after, attempts) => db.run("UPDATE ai_jobs SET status=$1,last_error=$2,run_after=$3,attempts=$4 WHERE id=$5", [attempts >= 5 ? 'failed' : 'pending', error, run_after, attempts, id]),
  // D1/SQLite'da Postgres'ning "FOR UPDATE SKIP LOCKED" tranzaksiya qulfi yo'q
  // (D1 yagona yozuvchi modeliga ega — bir vaqtning o'zida faqat bitta yozuv
  // amalga oshadi, shuning uchun UPDATE...WHERE status='pending' allaqachon
  // atomik: ikkita parallel chaqiruv bir xil qatorni ikki marta "running"
  // qilib belgilay olmaydi). src/ai/worker.js buni ishlatadi.
  ajClaimBatch: (batchSize) => db.all(
    `UPDATE ai_jobs SET status='running'
     WHERE id IN (SELECT id FROM ai_jobs WHERE status='pending' AND run_after<=unixepoch() ORDER BY created_at ASC LIMIT $1)
     RETURNING *`,
    [batchSize]
  ),

  /* stats */
  stTopReporters: (limit) => db.all(`SELECT u.id,u.username,u.name,u.avatar,u.color,COUNT(DISTINCT cm.cluster_id) as cluster_count FROM cluster_members cm JOIN users u ON cm.user_id=u.id GROUP BY u.id ORDER BY cluster_count DESC LIMIT $1`, [limit]),
  stByCommunity: () => db.all(`SELECT c.slug,c.name,c.color,COUNT(DISTINCT cl.id) as active_clusters FROM clusters cl JOIN cluster_members cm ON cm.cluster_id=cl.id JOIN posts p ON cm.post_id=p.id JOIN communities c ON p.community_id=c.id WHERE cl.status='open' GROUP BY c.id ORDER BY active_clusters DESC LIMIT 20`),
  stSolvedRate: () => db.get(`SELECT COUNT(*) FILTER (WHERE status='solved') as solved, COUNT(*) as total FROM clusters WHERE member_count>=3`),
  stTrending: (limit) => {
    const cutoff7 = new Date(Date.now() - 7*86400000).toISOString().slice(0,10);
    return db.all(`SELECT c.*,COALESCE((SELECT SUM(new_posts) FROM cluster_daily cd WHERE cd.cluster_id=c.id AND cd.day>=$1),0) as growth_7d FROM clusters c WHERE c.member_count>=3 ORDER BY growth_7d DESC LIMIT $2`, [cutoff7, limit]);
  },

  /* ══ FAZA 4: Yechim va taqsimot ══ */
  /* solutions */
  slInsert:     (id, post_id, comment_id, cluster_id, solver_id, marked_by) => db.run('INSERT INTO solutions(id,post_id,comment_id,cluster_id,solver_id,marked_by) VALUES($1,$2,$3,$4,$5,$6)', [id, post_id, comment_id, cluster_id, solver_id, marked_by]),
  slByComment:  (comment_id) => db.get('SELECT * FROM solutions WHERE comment_id=$1', [comment_id]),
  slDeleteByComment: (comment_id) => db.run('DELETE FROM solutions WHERE comment_id=$1', [comment_id]),
  slCountForCluster: (cluster_id) => db.get('SELECT COUNT(DISTINCT post_id) as c FROM solutions WHERE cluster_id=$1', [cluster_id]),

  /* posts/comments status */
  pSetStatus: (post_id, status) => db.run('UPDATE posts SET status=$1 WHERE id=$2', [status, post_id]),
  cmSetSolution: (comment_id, val) => db.run('UPDATE comments SET is_solution=$1 WHERE id=$2', [val, comment_id]),
  cmSolutionForPost: (post_id) => db.get('SELECT cm.*,u.username,u.color,u.avatar FROM comments cm JOIN users u ON cm.user_id=u.id WHERE cm.post_id=$1 AND cm.is_solution=1 LIMIT 1', [post_id]),

  /* expert topics */
  etUpsertScore: (user_id, cluster_id, delta) => db.run('INSERT INTO expert_topics(user_id,cluster_id,score) VALUES($1,$2,$3) ON CONFLICT (user_id,cluster_id) DO UPDATE SET score=expert_topics.score+$3,updated_at=extract(epoch from now())::int', [user_id, cluster_id, delta]),
  etTopForClusters: (clusterIds, excludeUserId, limit) => !clusterIds.length ? Promise.resolve([]) :
    db.all(`SELECT user_id,SUM(score) as total_score FROM expert_topics WHERE cluster_id IN (${inClause(3, clusterIds)}) AND user_id!=$1 GROUP BY user_id ORDER BY total_score DESC LIMIT $2`, [excludeUserId, limit, ...clusterIds]),
  etByUser: (user_id, limit) => db.all('SELECT et.*,c.title as cluster_title FROM expert_topics et JOIN clusters c ON et.cluster_id=c.id WHERE et.user_id=$1 ORDER BY et.score DESC LIMIT $2', [user_id, limit]),

  /* expert invites */
  eiInsert:  (id, user_id, cluster_id, post_id) => db.run('INSERT INTO expert_invites(id,user_id,cluster_id,post_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [id, user_id, cluster_id, post_id]),
  eiExists:  (user_id, post_id) => db.get('SELECT 1 FROM expert_invites WHERE user_id=$1 AND post_id=$2', [user_id, post_id]),
  eiCountForUserSince: (user_id, sinceTs) => db.get('SELECT COUNT(*) as c FROM expert_invites WHERE user_id=$1 AND created_at>=$2', [user_id, sinceTs]),
  eiCountForPost: (post_id) => db.get('SELECT COUNT(*) as c FROM expert_invites WHERE post_id=$1', [post_id]),
  eiLastNForUser: (user_id, n) => db.all('SELECT status FROM expert_invites WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2', [user_id, n]),
  eiMarkAnswered: (user_id, post_id) => db.run("UPDATE expert_invites SET status='answered' WHERE user_id=$1 AND post_id=$2 AND status='sent'", [user_id, post_id]),
  eiExpireOld: () => db.run("UPDATE expert_invites SET status='expired' WHERE status='sent' AND created_at<extract(epoch from now())::int-7*86400"),

  /* notification preferences */
  npGet: (user_id) => db.get('SELECT * FROM notif_prefs WHERE user_id=$1', [user_id]),
  npEnsure: (user_id) => db.run('INSERT INTO notif_prefs(user_id) VALUES($1) ON CONFLICT DO NOTHING', [user_id]),
  npSet: (user_id, field, value) => {
    // field foydalanuvchidan kelishi mumkin — SQL in'ektsiyasining oldini olish
    // uchun faqat ruxsat etilgan ustun nomlari qabul qilinadi
    const ALLOWED = ['expert_invite', 'cluster_match', 'solution_found', 'email_digest'];
    if (!ALLOWED.includes(field)) throw new Error(`Notif pref: yaroqsiz maydon '${field}'`);
    return db.run(`UPDATE notif_prefs SET ${field}=$1 WHERE user_id=$2`, [value, user_id]);
  },
};

/* ── Seed ──
   D1'da migratsiyalar `wrangler d1 migrations apply` orqali DEPLOY vaqtida
   qo'llanadi (Node versiyasidagi kabi server ishga tushganda emas) — shuning
   uchun bu yerda init()/migrate() funksiyalari yo'q. seed() esa har isolyat
   birinchi so'rovda BIR MARTA chaqiriladi (worker/index.js), tizim
   foydalanuvchisi va standart jamoalarni yaratadi — mavjud bo'lsa hech narsa
   qilmaydi (idempotent).
*/
function hmac(secret, s) { return crypto.createHmac('sha256', secret).update(s).digest('hex'); }

async function seed(secret) {
  const SYS = 'u_system';
  const sys = await db.get('SELECT id,email FROM users WHERE id=$1', [SYS]);
  if (!sys) {
    await Q.uInsert(SYS, 'mindhub', 'MindHub', 'system@mindhub.uz', hmac(secret, '_sys_'), '#C8922A');
    await db.run('UPDATE users SET is_admin=1 WHERE id=$1', [SYS]);
  } else if (sys.email !== 'mindhubteamm@gmail.com') {
    await db.run("UPDATE users SET email='mindhubteamm@gmail.com' WHERE id=$1", [SYS]);
  }
  const COMS = [
    { id:'c_tech',  slug:'texnologiya', name:'Texnologiya', desc:"IT, dasturlash, AI haqida.",        color:'#4D8FFF' },
    { id:'c_sport', slug:'sport',       name:'Sport',       desc:"Futbol, kurash, boks va boshqalar.", color:'#46C97A' },
    { id:'c_uzb',   slug:'ozbekiston',  name:"O'zbekiston", desc:"Vatanimiz haqida.",                  color:'#C8922A' },
    { id:'c_music', slug:'musiqa',      name:'Musiqa',      desc:"O'zbek va jahon musiqasi.",          color:'#9B6FD4' },
    { id:'c_ilm',   slug:'ilm',         name:'Ilm-Fan',     desc:"Fan, ta'lim, kitoblar.",             color:'#3AADCC' },
    { id:'c_kulgu', slug:'kulgu',       name:'Kulgu',       desc:"Kulgili kontent, hazillar.",         color:'#E8703A' },
  ];
  for (const c of COMS) {
    const existing = await Q.comById(c.id);
    if (!existing) {
      await Q.comInsert(c.id, c.slug, c.name, c.desc, c.color, SYS);
    }
  }
}

module.exports = { db, Q, seed, toD1 };
