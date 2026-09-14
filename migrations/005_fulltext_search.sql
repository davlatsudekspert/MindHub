-- To'g'ri full-text qidiruv: LIKE '%...%' indeks ishlatmaydi va postlar
-- ko'payishi bilan sekinlashadi. 'simple' konfiguratsiya ishlatiladi (stemming
-- yo'q, faqat so'zlarga bo'lish + kichik harf) — o'zbek tili uchun PostgreSQL'da
-- alohida lug'at yo'q, 'english'/'russian' kabi stemmerlar noto'g'ri natija
-- berardi.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(body, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_posts_search ON posts USING GIN (search_vector);
