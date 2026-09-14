-- FAZA 4: Yechim belgilash va ekspertlarga taqsimlash

CREATE TABLE IF NOT EXISTS solutions (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  cluster_id TEXT REFERENCES clusters(id) ON DELETE SET NULL,
  solver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  marked_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER DEFAULT (extract(epoch from now())::int),
  UNIQUE (post_id, comment_id)
);

CREATE TABLE IF NOT EXISTS expert_topics (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  score REAL DEFAULT 0,
  updated_at INTEGER DEFAULT (extract(epoch from now())::int),
  PRIMARY KEY (user_id, cluster_id)
);
CREATE INDEX IF NOT EXISTS idx_expert_topics_cluster ON expert_topics (cluster_id, score DESC);

CREATE TABLE IF NOT EXISTS expert_invites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'sent',      -- 'sent' | 'answered' | 'declined' | 'expired'
  created_at INTEGER DEFAULT (extract(epoch from now())::int),
  UNIQUE (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_expert_invites_user ON expert_invites (user_id, created_at);

ALTER TABLE posts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open';
ALTER TABLE comments ADD COLUMN IF NOT EXISTS is_solution INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS notif_prefs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  expert_invite INTEGER DEFAULT 1,
  cluster_match INTEGER DEFAULT 1,
  solution_found INTEGER DEFAULT 1,
  email_digest INTEGER DEFAULT 1
);
