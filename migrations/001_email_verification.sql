-- FAZA 2: Email tasdiqlash (2 bosqichli ro'yxatdan o'tish)

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at INTEGER;

CREATE TABLE IF NOT EXISTS email_codes (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,          -- kod OCHIQ saqlanmaydi, sha256 hash
  purpose TEXT NOT NULL,            -- 'register' | 'reset' | 'login_2fa' | 'email_change'
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 5,
  ip TEXT,
  expires_at INTEGER NOT NULL,
  used INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (extract(epoch from now())::int)
);
CREATE INDEX IF NOT EXISTS idx_email_codes_user ON email_codes (user_id, purpose, used);

-- Mavjud users qatorlari uchun: allaqachon mavjud (eski) foydalanuvchilarni
-- endi yangi email-tasdiqlash talabi ostida "qulflab qo'ymaslik" uchun
-- tasdiqlangan deb belgilaymiz. Yangi ro'yxatdan o'tuvchilar email_verified=0
-- bilan boshlanadi va /api/auth/verify-email orqali tasdiqlaydi.
UPDATE users SET email_verified = 1 WHERE email_verified = 0;
