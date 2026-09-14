-- FAZA 3: AI Fikr Taqsimlovchi — o'xshash muammo/g'oyalarni avtomatik klasterlash

CREATE TABLE IF NOT EXISTS post_embeddings (
  post_id TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  embedding JSONB NOT NULL,        -- float massiv (pgvector yo'q muhitlarda ham ishlashi uchun)
  model TEXT NOT NULL,
  norm REAL,                       -- oldindan hisoblangan L2 norma (cosine tezligi uchun)
  created_at INTEGER DEFAULT (extract(epoch from now())::int)
);

CREATE TABLE IF NOT EXISTS clusters (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,             -- AI yozgan sarlavha, o'zbekcha
  summary TEXT DEFAULT '',         -- 2-3 gapli xulosa
  centroid JSONB NOT NULL,
  member_count INTEGER DEFAULT 0,
  unique_users INTEGER DEFAULT 0,
  status TEXT DEFAULT 'open',      -- 'open' | 'solved' | 'archived'
  kind TEXT DEFAULT 'problem',     -- 'problem' | 'idea' | 'question'
  top_community_id TEXT,
  last_activity_at INTEGER,
  created_at INTEGER DEFAULT (extract(epoch from now())::int)
);
CREATE INDEX IF NOT EXISTS idx_clusters_rank ON clusters (status, member_count DESC);

CREATE TABLE IF NOT EXISTS cluster_members (
  cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  similarity REAL NOT NULL,
  joined_at INTEGER DEFAULT (extract(epoch from now())::int),
  PRIMARY KEY (cluster_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_cluster_members_post ON cluster_members (post_id);

CREATE TABLE IF NOT EXISTS cluster_daily (
  cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  new_posts INTEGER DEFAULT 0,
  PRIMARY KEY (cluster_id, day)
);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,              -- 'embed' | 'summarize' | 'recluster' | 'moderate'
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'pending',   -- 'pending' | 'running' | 'done' | 'failed'
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  run_after INTEGER DEFAULT (extract(epoch from now())::int),
  created_at INTEGER DEFAULT (extract(epoch from now())::int)
);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_queue ON ai_jobs (status, run_after);

-- Postlarni 'problem'/'idea'/'post' turiga ajratish
ALTER TABLE posts ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'post';
CREATE INDEX IF NOT EXISTS idx_posts_kind ON posts (kind);
