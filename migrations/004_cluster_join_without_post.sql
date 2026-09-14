-- FAZA 5.2: "Menda ham shu muammo bor" — foydalanuvchini postsiz klasterga qo'shish.
-- cluster_members.post_id ilgari (cluster_id,post_id) composite PRIMARY KEY qismi edi,
-- shuning uchun NULL bo'la olmasdi. Endi alohida "id" ustuni PRIMARY KEY bo'ladi,
-- va ikkita qisman unique indeks avvalgi cheklovlarni saqlaydi.

ALTER TABLE cluster_members DROP CONSTRAINT IF EXISTS cluster_members_pkey;
ALTER TABLE cluster_members ALTER COLUMN post_id DROP NOT NULL;
ALTER TABLE cluster_members ADD COLUMN IF NOT EXISTS id TEXT;
UPDATE cluster_members SET id = cluster_id || ':' || post_id WHERE id IS NULL AND post_id IS NOT NULL;
ALTER TABLE cluster_members ALTER COLUMN id SET NOT NULL;
ALTER TABLE cluster_members ADD PRIMARY KEY (id);

-- Bitta post bitta klasterda faqat bir marta bo'lsin (eski PK o'rnini bosadi)
CREATE UNIQUE INDEX IF NOT EXISTS idx_clm_cluster_post ON cluster_members (cluster_id, post_id) WHERE post_id IS NOT NULL;
-- Bitta foydalanuvchi postsiz bitta klasterga faqat bir marta qo'shilsin
CREATE UNIQUE INDEX IF NOT EXISTS idx_clm_cluster_user_nopost ON cluster_members (cluster_id, user_id) WHERE post_id IS NULL;
