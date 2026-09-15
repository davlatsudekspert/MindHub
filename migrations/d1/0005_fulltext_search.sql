-- Postgres migrations/005_fulltext_search.sql'ning D1 (SQLite) versiyasi.
-- Postgres'da generated tsvector + GIN indeks ishlatilgan edi — SQLite/D1'da
-- ekvivalenti yo'q, o'rniga FTS5 virtual jadval ishlatiladi (contentless emas —
-- content='posts' bilan asosiy jadvaldan o'qiydi, alohida nusxa saqlamaydi).
-- Triggerlar orqali posts jadvali bilan sinxron saqlanadi (INSERT/UPDATE/DELETE).

CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  title, body, content='posts', content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS posts_fts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
CREATE TRIGGER IF NOT EXISTS posts_fts_ad AFTER DELETE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
END;
CREATE TRIGGER IF NOT EXISTS posts_fts_au AFTER UPDATE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
  INSERT INTO posts_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
