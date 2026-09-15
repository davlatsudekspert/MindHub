-- D1 (SQLite) uchun boshlang'ich sxema. src/db.js dagi Postgres SCHEMA'dan
-- ko'chirilgan: SERIAL -> INTEGER PRIMARY KEY AUTOINCREMENT, JSONB -> TEXT,
-- extract(epoch from now())::int -> unixepoch(). D1 xotira modeli
-- Postgres'dan farqli — migratsiyalar faqat BIR MARTA qo'llanadi (Node
-- tarafidagi kabi har server ishga tushganda "CREATE TABLE IF NOT EXISTS"
-- qayta-qayta chaqirilmaydi), shuning uchun bu yerda "IF NOT EXISTS"
-- ehtiyot chorasi sifatida saqlangan, lekin ALTER TABLE...ADD COLUMN
-- IF NOT EXISTS kabi keyingi migratsiyalarda alohida-alohida fayllarda
-- olib boriladi (Postgres versiyasidagi kabi bitta SCHEMA emas).

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
  phone TEXT,
  tg_chat_id TEXT,
  tg_id TEXT,
  ban_expires_at INTEGER,
  pass_version INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch())
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
  is_private INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
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
  kind TEXT DEFAULT 'post',
  status TEXT DEFAULT 'open',
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_posts_community ON posts (community_id, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_kind ON posts (kind);

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
  is_solution INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
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
  saved_at INTEGER DEFAULT (unixepoch()),
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
  created_at INTEGER DEFAULT (unixepoch())
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
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_notifications_to ON notifications (to_id, created_at);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id TEXT,
  comment_id TEXT,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS polls (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options TEXT NOT NULL,
  duration_days INTEGER DEFAULT 3,
  ends_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);

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
  created_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(user_id, community_id)
);

CREATE TABLE IF NOT EXISTS tg_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);
