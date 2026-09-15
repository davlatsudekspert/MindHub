-- Postgres migrations/001_email_verification.sql'ning D1 (SQLite) versiyasi.
ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN email_verified_at INTEGER;

CREATE TABLE IF NOT EXISTS email_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 5,
  ip TEXT,
  expires_at INTEGER NOT NULL,
  used INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_email_codes_user ON email_codes (user_id, purpose, used);
-- Eslatma: Postgres migratsiyasidagi "eski userlarni tasdiqlangan deb
-- belgilash" qadami bu yerda yo'q — D1 bazasi noldan boshlanadi, hali
-- hech qanday user yo'q.
