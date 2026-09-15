-- Postgres migrations/002 + 004'ning D1 (SQLite) versiyasi — yakuniy shakl
-- to'g'ridan-to'g'ri yaratiladi (Postgres'dagi kabi keyinchalik ALTER TABLE
-- bilan post_id'ni NULL qilib borish shart emas, D1 yangi baza).

CREATE TABLE IF NOT EXISTS post_embeddings (
  post_id TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  embedding TEXT NOT NULL,   -- JSON massiv (pgvector o'rniga)
  model TEXT NOT NULL,
  norm REAL,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS clusters (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT DEFAULT '',
  centroid TEXT NOT NULL,    -- JSON massiv
  member_count INTEGER DEFAULT 0,
  unique_users INTEGER DEFAULT 0,
  status TEXT DEFAULT 'open',
  kind TEXT DEFAULT 'problem',
  top_community_id TEXT,
  last_activity_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_clusters_rank ON clusters (status, member_count DESC);

-- post_id NULLABLE — "Menda ham shu muammo bor" (postsiz a'zolik). id ustuni
-- PRIMARY KEY (cluster_id:post_id yoki cluster_id:u:user_id:<random>).
CREATE TABLE IF NOT EXISTS cluster_members (
  id TEXT PRIMARY KEY,
  cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  similarity REAL NOT NULL,
  joined_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_cluster_members_post ON cluster_members (post_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clm_cluster_post ON cluster_members (cluster_id, post_id) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clm_cluster_user_nopost ON cluster_members (cluster_id, user_id) WHERE post_id IS NULL;

CREATE TABLE IF NOT EXISTS cluster_daily (
  cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  day TEXT NOT NULL,  -- 'YYYY-MM-DD'
  new_posts INTEGER DEFAULT 0,
  PRIMARY KEY (cluster_id, day)
);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,   -- JSON
  status TEXT DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  run_after INTEGER DEFAULT (unixepoch()),
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_queue ON ai_jobs (status, run_after);
