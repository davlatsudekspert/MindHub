'use strict';
const crypto = require('crypto');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/mindhub';

// Only use SSL for remote databases (Railway etc.), disable for localhost
const isLocal = DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1');
const ssl = isLocal ? false : (process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false });
const pool = new Pool({ connectionString: DATABASE_URL, ssl });

// Sync-style facade over async pg pool
const db = {
  async query(text, params = []) { return pool.query(text, params); },
  async get(text, params = [])   { const r = await pool.query(text, params); return r.rows[0] || null; },
  async all(text, params = [])   { const r = await pool.query(text, params); return r.rows; },
  async run(text, params = [])   { await pool.query(text, params); }
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    pass TEXT NOT NULL,
    avatar TEXT,
    banner TEXT,
    color TEXT DEFAULT '#C8922A',
    bio TEXT DEFAULT '',
    karma INTEGER DEFAULT 0,
    followers INTEGER DEFAULT 0,
    is_admin INTEGER DEFAULT 0,
    is_banned INTEGER DEFAULT 0,
    ban_reason TEXT,
    created_at INTEGER DEFAULT (extract(epoch from now())::int)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (lower(username));
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));

  CREATE TABLE IF NOT EXISTS communities (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    rules TEXT DEFAULT '',
    color TEXT DEFAULT '#C8922A',
    owner_id TEXT NOT NULL REFERENCES users(id),
    avatar TEXT,
    banner TEXT,
    members INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (extract(epoch from now())::int)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_communities_slug_lower ON communities (lower(slug));

  CREATE TABLE IF NOT EXISTS memberships (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    PRIMARY KEY(user_id, community_id)
  );

  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    link TEXT,
    image TEXT,
    video TEXT,
    audio TEXT,
    type TEXT DEFAULT 'text',
    score INTEGER DEFAULT 1,
    upvotes INTEGER DEFAULT 1,
    downvotes INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    flair TEXT,
    created_at INTEGER DEFAULT (extract(epoch from now())::int)
  );
  CREATE INDEX IF NOT EXISTS idx_posts_community ON posts (community_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_posts_user ON posts (user_id, created_at);

  CREATE TABLE IF NOT EXISTS post_votes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    vote INTEGER NOT NULL,
    PRIMARY KEY(user_id, post_id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id TEXT,
    body TEXT NOT NULL,
    score INTEGER DEFAULT 1,
    depth INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (extract(epoch from now())::int)
  );
  CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id, score);

  CREATE TABLE IF NOT EXISTS comment_votes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    vote INTEGER NOT NULL,
    PRIMARY KEY(user_id, comment_id)
  );

  CREATE TABLE IF NOT EXISTS saved_posts (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    saved_at INTEGER DEFAULT (extract(epoch from now())::int),
    PRIMARY KEY(user_id, post_id)
  );

  CREATE TABLE IF NOT EXISTS follows (
    follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY(follower_id, following_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    type TEXT DEFAULT 'text',
    image_url TEXT,
    audio_url TEXT,
    duration TEXT,
    is_read INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (extract(epoch from now())::int)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages (from_id, to_id, created_at);

  CREATE TABLE IF NOT EXISTS _meta (k TEXT PRIMARY KEY, v TEXT);

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    post_id TEXT,
    comment_id TEXT,
    msg TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (extract(epoch from now())::int)
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_to ON notifications (to_id, created_at);

  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id TEXT,
    comment_id TEXT,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at INTEGER DEFAULT (extract(epoch from now())::int)
  );

  CREATE TABLE IF NOT EXISTS polls (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    options TEXT NOT NULL,
    duration_days INTEGER DEFAULT 3,
    ends_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT (extract(epoch from now())::int)
  );

  CREATE TABLE IF NOT EXISTS poll_votes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    option_index INTEGER NOT NULL,
    PRIMARY KEY(user_id, poll_id)
  );

  CREATE TABLE IF NOT EXISTS push_tokens (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    PRIMARY KEY(user_id, token)
  );

  CREATE TABLE IF NOT EXISTS reset_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    used INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS verify_codes (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (extract(epoch from now())::int)
  );

  ALTER TABLE communities ADD COLUMN IF NOT EXISTS is_private INTEGER DEFAULT 0;
  ALTER TABLE communities ADD COLUMN IF NOT EXISTS views INTEGER DEFAULT 0;

  ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS tg_chat_id TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS tg_id TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_expires_at INTEGER;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS pass_version INTEGER DEFAULT 1;

  CREATE TABLE IF NOT EXISTS community_roles (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'admin',
    PRIMARY KEY(user_id, community_id)
  );

  CREATE TABLE IF NOT EXISTS community_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending',
    created_at INTEGER DEFAULT (extract(epoch from now())::int),
    UNIQUE(user_id, community_id)
  );

  CREATE TABLE IF NOT EXISTS tg_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (extract(epoch from now())::int)
  );
`;

const Q = {
  /* users */
  uById:      (id) => db.get('SELECT id,username,name,email,color,bio,avatar,banner,karma,followers,is_admin,is_banned,ban_reason,ban_expires_at,created_at,phone,pass_version FROM users WHERE id=$1', [id]),
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
  uFollowers: (id) => db.run('UPDATE users SET followers=(SELECT COUNT(*)::int FROM follows WHERE following_id=users.id) WHERE id=$1', [id]),
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
  comDecMem: (id) => db.run('UPDATE communities SET members=GREATEST(0,members-1) WHERE id=$1', [id]),
  comTop:    () => db.all('SELECT c.*,u.username as oname FROM communities c JOIN users u ON c.owner_id=u.id ORDER BY c.members DESC LIMIT 10'),
  comMine:   (user_id) => db.all('SELECT c.*,u.username as oname FROM communities c JOIN users u ON c.owner_id=u.id JOIN memberships m ON m.community_id=c.id WHERE m.user_id=$1 ORDER BY c.members DESC', [user_id]),

  /* memberships */
  memCheck:  (user_id, community_id) => db.get('SELECT 1 FROM memberships WHERE user_id=$1 AND community_id=$2', [user_id, community_id]),
  memJoin:   (user_id, community_id) => db.run('INSERT INTO memberships(user_id,community_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [user_id, community_id]),
  memLeave:  (user_id, community_id) => db.run('DELETE FROM memberships WHERE user_id=$1 AND community_id=$2', [user_id, community_id]),

  /* posts */
  pHot:    (off) => db.all('SELECT p.*,u.username,u.color,u.avatar,c.slug as cslug,c.name as cname,c.color as ccolor FROM posts p JOIN users u ON p.user_id=u.id JOIN communities c ON p.community_id=c.id ORDER BY p.score DESC,p.created_at DESC LIMIT 25 OFFSET $1', [off]),
  pNew:    (off) => db.all('SELECT p.*,u.username,u.color,u.avatar,c.slug as cslug,c.name as cname,c.color as ccolor FROM posts p JOIN users u ON p.user_id=u.id JOIN communities c ON p.community_id=c.id ORDER BY p.created_at DESC LIMIT 25 OFFSET $1', [off]),
  pCom:    (slug, off) => db.all('SELECT p.*,u.username,u.color,u.avatar,c.slug as cslug,c.name as cname,c.color as ccolor FROM posts p JOIN users u ON p.user_id=u.id JOIN communities c ON p.community_id=c.id WHERE lower(c.slug)=lower($1) ORDER BY p.score DESC,p.created_at DESC LIMIT 25 OFFSET $2', [slug, off]),
  pComNew: (slug, off) => db.all('SELECT p.*,u.username,u.color,u.avatar,c.slug as cslug,c.name as cname,c.color as ccolor FROM posts p JOIN users u ON p.user_id=u.id JOIN communities c ON p.community_id=c.id WHERE lower(c.slug)=lower($1) ORDER BY p.created_at DESC LIMIT 25 OFFSET $2', [slug, off]),
  pByUser: (user_id) => db.all('SELECT p.*,u.username,u.color,u.avatar,c.slug as cslug,c.name as cname,c.color as ccolor FROM posts p JOIN users u ON p.user_id=u.id JOIN communities c ON p.community_id=c.id WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 25', [user_id]),
  pOne:    (id) => db.get('SELECT p.*,u.username,u.color,u.avatar,c.slug as cslug,c.name as cname,c.color as ccolor FROM posts p JOIN users u ON p.user_id=u.id JOIN communities c ON p.community_id=c.id WHERE p.id=$1', [id]),
  pInsert: (id, user_id, community_id, title, body, link, image, video, audio, type, flair, kind) => db.run('INSERT INTO posts(id,user_id,community_id,title,body,link,image,video,audio,type,flair,kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [id, user_id, community_id, title, body, link, image, video, audio, type, flair, kind || 'post']),
  pDelete: (id) => db.run('DELETE FROM posts WHERE id=$1', [id]),
  pUpdate: (title, body, id, user_id) => db.run('UPDATE posts SET title=$1,body=$2 WHERE id=$3 AND user_id=$4', [title, body, id, user_id]),
  pOwner:  (id) => db.get('SELECT user_id,community_id FROM posts WHERE id=$1', [id]),
  pScore:  (score, upvotes, downvotes, id) => db.run('UPDATE posts SET score=$1,upvotes=$2,downvotes=$3 WHERE id=$4', [score, upvotes, downvotes, id]),
  pIncCmt: (id) => db.run('UPDATE posts SET comment_count=comment_count+1 WHERE id=$1', [id]),
  pSearch: (p1, p2) => db.all('SELECT p.*,u.username,u.color,u.avatar,c.slug as cslug,c.name as cname,c.color as ccolor FROM posts p JOIN users u ON p.user_id=u.id JOIN communities c ON p.community_id=c.id WHERE lower(p.title) LIKE $1 OR lower(p.body) LIKE $2 ORDER BY p.score DESC LIMIT 20', [p1, p2]),
  pSaved:  (user_id) => db.all('SELECT p.*,u.username,u.color,u.avatar,c.slug as cslug,c.name as cname,c.color as ccolor FROM posts p JOIN users u ON p.user_id=u.id JOIN communities c ON p.community_id=c.id JOIN saved_posts sp ON sp.post_id=p.id WHERE sp.user_id=$1 ORDER BY sp.saved_at DESC', [user_id]),

  /* post votes */
  pvGet:    (user_id, post_id) => db.get('SELECT vote FROM post_votes WHERE user_id=$1 AND post_id=$2', [user_id, post_id]),
  pvUpsert: (user_id, post_id, vote) => db.run('INSERT INTO post_votes(user_id,post_id,vote) VALUES($1,$2,$3) ON CONFLICT (user_id,post_id) DO UPDATE SET vote=EXCLUDED.vote', [user_id, post_id, vote]),
  pvDelete: (user_id, post_id) => db.run('DELETE FROM post_votes WHERE user_id=$1 AND post_id=$2', [user_id, post_id]),
  pvCount:  (post_id) => db.get('SELECT COALESCE(SUM(CASE WHEN vote=1 THEN 1 ELSE 0 END),0)::int as up,COALESCE(SUM(CASE WHEN vote=-1 THEN 1 ELSE 0 END),0)::int as dn FROM post_votes WHERE post_id=$1', [post_id]),

  /* saved */
  svCheck:  (user_id, post_id) => db.get('SELECT 1 FROM saved_posts WHERE user_id=$1 AND post_id=$2', [user_id, post_id]),
  svInsert: (user_id, post_id) => db.run('INSERT INTO saved_posts(user_id,post_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [user_id, post_id]),
  svDelete: (user_id, post_id) => db.run('DELETE FROM saved_posts WHERE user_id=$1 AND post_id=$2', [user_id, post_id]),

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
  cvCount:  (comment_id) => db.get('SELECT COALESCE(SUM(CASE WHEN vote=1 THEN 1 ELSE 0 END),0)::int as up,COALESCE(SUM(CASE WHEN vote=-1 THEN 1 ELSE 0 END),0)::int as dn FROM comment_votes WHERE comment_id=$1', [comment_id]),

  /* follows */
  fwCheck:     (follower_id, following_id) => db.get('SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2', [follower_id, following_id]),
  fwInsert:    (follower_id, following_id) => db.run('INSERT INTO follows(follower_id,following_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [follower_id, following_id]),
  fwDelete:    (follower_id, following_id) => db.run('DELETE FROM follows WHERE follower_id=$1 AND following_id=$2', [follower_id, following_id]),
  fwFollowers: (following_id) => db.get('SELECT COUNT(*)::int as c FROM follows WHERE following_id=$1', [following_id]),
  fwFollowing: (follower_id) => db.get('SELECT COUNT(*)::int as c FROM follows WHERE follower_id=$1', [follower_id]),

  /* messages */
  msgConvos:   (uid) => db.all('SELECT DISTINCT CASE WHEN from_id=$1 THEN to_id ELSE from_id END as oid FROM messages WHERE from_id=$1 OR to_id=$1', [uid]),
  msgThread:   (a, b, c, d) => db.all('SELECT * FROM messages WHERE (from_id=$1 AND to_id=$2) OR (from_id=$3 AND to_id=$4) ORDER BY created_at ASC LIMIT 100', [a, b, c, d]),
  msgInsert:   (id, from_id, to_id, body, type, image_url, audio_url, duration) => db.run('INSERT INTO messages(id,from_id,to_id,body,type,image_url,audio_url,duration) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, from_id, to_id, body, type, image_url, audio_url, duration]),
  msgMarkRead: (from_id, to_id) => db.run('UPDATE messages SET is_read=1 WHERE from_id=$1 AND to_id=$2', [from_id, to_id]),
  msgLast:     (a, b, c, d) => db.get('SELECT * FROM messages WHERE (from_id=$1 AND to_id=$2) OR (from_id=$3 AND to_id=$4) ORDER BY created_at DESC LIMIT 1', [a, b, c, d]),
  msgUnread:   (to_id) => db.get('SELECT COUNT(*)::int as c FROM messages WHERE to_id=$1 AND is_read=0', [to_id]),

  /* notifications */
  nInsert:   (id, to_id, from_id, type, post_id, comment_id, msg) => db.run('INSERT INTO notifications(id,to_id,from_id,type,post_id,comment_id,msg) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, to_id, from_id, type, post_id, comment_id, msg]),
  nAll:      (to_id) => db.all('SELECT n.*,u.username as fn,u.color as fc,u.avatar as fa FROM notifications n LEFT JOIN users u ON n.from_id=u.id WHERE n.to_id=$1 ORDER BY n.created_at DESC LIMIT 60', [to_id]),
  nMarkRead: (to_id) => db.run('UPDATE notifications SET is_read=1 WHERE to_id=$1', [to_id]),
  nUnread:   (to_id) => db.get('SELECT COUNT(*)::int as c FROM notifications WHERE to_id=$1 AND is_read=0', [to_id]),

  /* polls */
  pollInsert:  (id, post_id, question, options, duration_days, ends_at) => db.run('INSERT INTO polls(id,post_id,question,options,duration_days,ends_at) VALUES($1,$2,$3,$4,$5,$6)', [id, post_id, question, options, duration_days, ends_at]),
  pollGet:     (post_id) => db.get('SELECT * FROM polls WHERE post_id=$1', [post_id]),
  pollGetById: (id) => db.get('SELECT * FROM polls WHERE id=$1', [id]),
  pollVoteGet: (user_id, poll_id) => db.get('SELECT option_index FROM poll_votes WHERE user_id=$1 AND poll_id=$2', [user_id, poll_id]),
  pollVoteIns: (user_id, poll_id, option_index) => db.run('INSERT INTO poll_votes(user_id,poll_id,option_index) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [user_id, poll_id, option_index]),
  pollVoteCnt: (poll_id) => db.all('SELECT option_index,COUNT(*)::int as cnt FROM poll_votes WHERE poll_id=$1 GROUP BY option_index', [poll_id]),
  pollTotalVotes: (poll_id) => db.get('SELECT COUNT(*)::int as c FROM poll_votes WHERE poll_id=$1', [poll_id]),

  /* push tokens */
  pushIns:    (user_id, token) => db.run('INSERT INTO push_tokens(user_id,token) VALUES($1,$2) ON CONFLICT DO NOTHING', [user_id, token]),
  pushDel:    (user_id, token) => db.run('DELETE FROM push_tokens WHERE user_id=$1 AND token=$2', [user_id, token]),
  pushByUser: (user_id) => db.all('SELECT token FROM push_tokens WHERE user_id=$1', [user_id]),

  /* followers list for notifications */
  fwFollowersList: (following_id) => db.all('SELECT follower_id FROM follows WHERE following_id=$1', [following_id]),
  fwFollowersCount: (following_id) => db.get('SELECT COUNT(*)::int as c FROM follows WHERE following_id=$1', [following_id]),

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
  adminStats: () => db.get("SELECT (SELECT COUNT(*)::int FROM users) as users,(SELECT COUNT(*)::int FROM posts) as posts,(SELECT COUNT(*)::int FROM comments) as comments,(SELECT COUNT(*)::int FROM communities) as communities,(SELECT COUNT(*)::int FROM reports WHERE status='pending') as reports"),

  /* email tasdiqlash (FAZA 2) */
  uSetEmailVerified: (id) => db.run("UPDATE users SET email_verified=1,email_verified_at=extract(epoch from now())::int WHERE id=$1", [id]),
  ecInsert:         (user_id, email, code_hash, purpose, expires_at, ip) => db.run('INSERT INTO email_codes(user_id,email,code_hash,purpose,expires_at,ip) VALUES($1,$2,$3,$4,$5,$6)', [user_id, email, code_hash, purpose, expires_at, ip || null]),
  ecGetActive:      (user_id, purpose) => db.get("SELECT * FROM email_codes WHERE user_id=$1 AND purpose=$2 AND used=0 AND expires_at>extract(epoch from now())::int ORDER BY created_at DESC LIMIT 1", [user_id, purpose]),
  ecLatest:         (user_id, purpose) => db.get('SELECT * FROM email_codes WHERE user_id=$1 AND purpose=$2 ORDER BY created_at DESC LIMIT 1', [user_id, purpose]),
  ecIncAttempts:    (id) => db.run('UPDATE email_codes SET attempts=attempts+1 WHERE id=$1', [id]),
  ecMarkUsed:       (id) => db.run('UPDATE email_codes SET used=1 WHERE id=$1', [id]),
  ecInvalidateOthers:(user_id, purpose) => db.run('UPDATE email_codes SET used=1 WHERE user_id=$1 AND purpose=$2 AND used=0', [user_id, purpose]),
  ecCountLastHour:  (user_id, purpose) => db.get("SELECT COUNT(*)::int as c FROM email_codes WHERE user_id=$1 AND purpose=$2 AND created_at>extract(epoch from now())::int-3600", [user_id, purpose]),

  /* ══ FAZA 3: AI klasterlash ══ */
  /* post embeddings */
  peUpsert: (post_id, embedding, model, norm) => db.run('INSERT INTO post_embeddings(post_id,embedding,model,norm) VALUES($1,$2,$3,$4) ON CONFLICT (post_id) DO UPDATE SET embedding=EXCLUDED.embedding,model=EXCLUDED.model,norm=EXCLUDED.norm', [post_id, JSON.stringify(embedding), model, norm]),
  peGet:    (post_id) => db.get('SELECT * FROM post_embeddings WHERE post_id=$1', [post_id]),

  /* clusters */
  clInsert:  (id, title, summary, centroid, kind) => db.run('INSERT INTO clusters(id,title,summary,centroid,kind,member_count,unique_users,last_activity_at) VALUES($1,$2,$3,$4,$5,1,1,extract(epoch from now())::int)', [id, title, summary || '', JSON.stringify(centroid), kind || 'problem']),
  clById:    (id) => db.get('SELECT * FROM clusters WHERE id=$1', [id]),
  clAllActive: () => db.all("SELECT id,centroid,member_count FROM clusters WHERE status!='archived'"),
  clUpdateAfterJoin: (id, centroid, memberCount, uniqueUsers) => db.run('UPDATE clusters SET centroid=$1,member_count=$2,unique_users=$3,last_activity_at=extract(epoch from now())::int WHERE id=$4', [JSON.stringify(centroid), memberCount, uniqueUsers, id]),
  clUpdateSummary: (id, title, summary) => db.run('UPDATE clusters SET title=$1,summary=$2 WHERE id=$3', [title, summary, id]),
  clSetStatus: (id, status) => db.run('UPDATE clusters SET status=$1 WHERE id=$2', [status, id]),
  clSetTopCommunity: (id, community_id) => db.run('UPDATE clusters SET top_community_id=$1 WHERE id=$2', [community_id, id]),
  clListRanked: (minSize, limit, offset) => db.all(
    `SELECT c.*,
       (SELECT COUNT(*)::int FROM cluster_daily cd WHERE cd.cluster_id=c.id AND cd.day>=CURRENT_DATE-7) as growth_7d
     FROM clusters c
     WHERE c.member_count>=$1
     ORDER BY (c.unique_users*3 + c.member_count + COALESCE((SELECT SUM(new_posts) FROM cluster_daily cd WHERE cd.cluster_id=c.id AND cd.day>=CURRENT_DATE-7),0)*5) * (CASE WHEN c.status='open' THEN 1.3 ELSE 1 END) DESC
     LIMIT $2 OFFSET $3`, [minSize, limit, offset]),
  clListNew: (minSize, limit, offset) => db.all('SELECT * FROM clusters WHERE member_count>=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [minSize, limit, offset]),
  clListSize: (minSize, limit, offset) => db.all('SELECT * FROM clusters WHERE member_count>=$1 ORDER BY member_count DESC LIMIT $2 OFFSET $3', [minSize, limit, offset]),
  clListUnsolved: (minSize, limit, offset) => db.all("SELECT * FROM clusters WHERE member_count>=$1 AND status='open' ORDER BY member_count DESC LIMIT $2 OFFSET $3", [minSize, limit, offset]),

  /* cluster members — "clm" prefix (comments allaqachon "cm" prefiksini band qilgan, chalkashmaslik uchun) */
  clmInsert: (cluster_id, post_id, user_id, similarity) => db.run('INSERT INTO cluster_members(cluster_id,post_id,user_id,similarity) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [cluster_id, post_id, user_id, similarity]),
  clmByCluster: (cluster_id, limit, offset) => db.all('SELECT cm.*,p.title,p.created_at as post_created_at,u.username,u.avatar,u.color FROM cluster_members cm JOIN posts p ON cm.post_id=p.id JOIN users u ON cm.user_id=u.id WHERE cm.cluster_id=$1 ORDER BY cm.joined_at DESC LIMIT $2 OFFSET $3', [cluster_id, limit, offset]),
  clmUniqueUsers: (cluster_id) => db.get('SELECT COUNT(DISTINCT user_id)::int as c FROM cluster_members WHERE cluster_id=$1', [cluster_id]),
  clmSamplePosts: (cluster_id, limit) => db.all('SELECT p.id,p.title,p.created_at,u.username FROM cluster_members cm JOIN posts p ON cm.post_id=p.id JOIN users u ON p.user_id=u.id WHERE cm.cluster_id=$1 ORDER BY cm.joined_at DESC LIMIT $2', [cluster_id, limit]),
  clmByPostId: (post_id) => db.get('SELECT * FROM cluster_members WHERE post_id=$1', [post_id]),
  clmForUserClusters: (user_id) => db.all('SELECT DISTINCT cluster_id FROM cluster_members WHERE user_id=$1', [user_id]),
  clmCountForUser: (user_id) => db.get('SELECT COUNT(DISTINCT cluster_id)::int as c FROM cluster_members WHERE user_id=$1', [user_id]),

  /* cluster daily growth */
  cdIncr: (cluster_id) => db.run(`INSERT INTO cluster_daily(cluster_id,day,new_posts) VALUES($1,CURRENT_DATE,1) ON CONFLICT (cluster_id,day) DO UPDATE SET new_posts=cluster_daily.new_posts+1`, [cluster_id]),
  cdSeries: (cluster_id, days) => db.all('SELECT day,new_posts FROM cluster_daily WHERE cluster_id=$1 AND day>=CURRENT_DATE-$2::int ORDER BY day ASC', [cluster_id, days]),

  /* ai jobs queue */
  ajInsert: (id, kind, payload, run_after) => db.run('INSERT INTO ai_jobs(id,kind,payload,run_after) VALUES($1,$2,$3,$4)', [id, kind, JSON.stringify(payload), run_after || Math.floor(Date.now()/1000)]),
  ajMarkDone: (id) => db.run("UPDATE ai_jobs SET status='done' WHERE id=$1", [id]),
  ajMarkFailed: (id, error, run_after, attempts) => db.run("UPDATE ai_jobs SET status=$1,last_error=$2,run_after=$3,attempts=$4 WHERE id=$5", [attempts >= 5 ? 'failed' : 'pending', error, run_after, attempts, id]),

  /* stats */
  stTopReporters: (limit) => db.all(`SELECT u.id,u.username,u.name,u.avatar,u.color,COUNT(DISTINCT cm.cluster_id)::int as cluster_count FROM cluster_members cm JOIN users u ON cm.user_id=u.id GROUP BY u.id ORDER BY cluster_count DESC LIMIT $1`, [limit]),
  stByCommunity: () => db.all(`SELECT c.slug,c.name,c.color,COUNT(DISTINCT cl.id)::int as active_clusters FROM clusters cl JOIN cluster_members cm ON cm.cluster_id=cl.id JOIN posts p ON cm.post_id=p.id JOIN communities c ON p.community_id=c.id WHERE cl.status='open' GROUP BY c.id ORDER BY active_clusters DESC LIMIT 20`),
  stSolvedRate: () => db.get(`SELECT COUNT(*) FILTER (WHERE status='solved')::int as solved, COUNT(*)::int as total FROM clusters WHERE member_count>=3`),
  stTrending: (limit) => db.all(`SELECT c.*,COALESCE((SELECT SUM(new_posts) FROM cluster_daily cd WHERE cd.cluster_id=c.id AND cd.day>=CURRENT_DATE-7),0) as growth_7d FROM clusters c WHERE c.member_count>=3 ORDER BY growth_7d DESC LIMIT $1`, [limit]),

  /* ══ FAZA 4: Yechim va taqsimot ══ */
  /* solutions */
  slInsert:     (id, post_id, comment_id, cluster_id, solver_id, marked_by) => db.run('INSERT INTO solutions(id,post_id,comment_id,cluster_id,solver_id,marked_by) VALUES($1,$2,$3,$4,$5,$6)', [id, post_id, comment_id, cluster_id, solver_id, marked_by]),
  slByComment:  (comment_id) => db.get('SELECT * FROM solutions WHERE comment_id=$1', [comment_id]),
  slDeleteByComment: (comment_id) => db.run('DELETE FROM solutions WHERE comment_id=$1', [comment_id]),
  slCountForCluster: (cluster_id) => db.get('SELECT COUNT(DISTINCT post_id)::int as c FROM solutions WHERE cluster_id=$1', [cluster_id]),

  /* posts/comments status */
  pSetStatus: (post_id, status) => db.run('UPDATE posts SET status=$1 WHERE id=$2', [status, post_id]),
  cmSetSolution: (comment_id, val) => db.run('UPDATE comments SET is_solution=$1 WHERE id=$2', [val, comment_id]),
  cmSolutionForPost: (post_id) => db.get('SELECT cm.*,u.username,u.color,u.avatar FROM comments cm JOIN users u ON cm.user_id=u.id WHERE cm.post_id=$1 AND cm.is_solution=1 LIMIT 1', [post_id]),

  /* expert topics */
  etUpsertScore: (user_id, cluster_id, delta) => db.run('INSERT INTO expert_topics(user_id,cluster_id,score) VALUES($1,$2,$3) ON CONFLICT (user_id,cluster_id) DO UPDATE SET score=expert_topics.score+$3,updated_at=extract(epoch from now())::int', [user_id, cluster_id, delta]),
  etTopForClusters: (clusterIds, excludeUserId, limit) => db.all('SELECT user_id,SUM(score)::real as total_score FROM expert_topics WHERE cluster_id = ANY($1::text[]) AND user_id!=$2 GROUP BY user_id ORDER BY total_score DESC LIMIT $3', [clusterIds, excludeUserId, limit]),
  etByUser: (user_id, limit) => db.all('SELECT et.*,c.title as cluster_title FROM expert_topics et JOIN clusters c ON et.cluster_id=c.id WHERE et.user_id=$1 ORDER BY et.score DESC LIMIT $2', [user_id, limit]),

  /* expert invites */
  eiInsert:  (id, user_id, cluster_id, post_id) => db.run('INSERT INTO expert_invites(id,user_id,cluster_id,post_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [id, user_id, cluster_id, post_id]),
  eiExists:  (user_id, post_id) => db.get('SELECT 1 FROM expert_invites WHERE user_id=$1 AND post_id=$2', [user_id, post_id]),
  eiCountForUserSince: (user_id, sinceTs) => db.get('SELECT COUNT(*)::int as c FROM expert_invites WHERE user_id=$1 AND created_at>=$2', [user_id, sinceTs]),
  eiCountForPost: (post_id) => db.get('SELECT COUNT(*)::int as c FROM expert_invites WHERE post_id=$1', [post_id]),
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

/* ── Seed ── */
const SECRET = process.env.SECRET;
if (!SECRET) {
  console.error('SECRET env o\'zgaruvchisi majburiy');
  process.exit(1);
}
function hmac(s) { return crypto.createHmac('sha256', SECRET).update(s).digest('hex'); }

async function seed() {
  const SYS = 'u_system';
  const sys = await Q.uById(SYS);
  if (!sys) {
    await Q.uInsert(SYS, 'mindhub', 'MindHub', 'system@mindhub.uz', hmac('_sys_'), '#C8922A');
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

async function init() {
  await db.query(SCHEMA);
  await seed();
  console.log('✅ PostgreSQL ulandi, sxema tayyor');
}

module.exports = { db, Q, hmac, SECRET, init, pool };
