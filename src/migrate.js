'use strict';
const fs = require('fs');
const path = require('path');
const { db, pool } = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function ensureMigrationsTable() {
  await db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER DEFAULT (extract(epoch from now())::int)
    )
  `);
}

async function appliedMigrations() {
  const rows = await db.all('SELECT name FROM _migrations');
  return new Set(rows.map(r => r.name));
}

async function migrate() {
  await ensureMigrationsTable();
  if (!fs.existsSync(MIGRATIONS_DIR)) return;

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort(); // 001_, 002_, ... tartib bo'yicha

  const applied = await appliedMigrations();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`▶ Migratsiya qo'llanmoqda: ${file}`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations(name) VALUES($1)', [file]);
      await client.query('COMMIT');
      console.log(`✅ ${file} qo'llandi`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`❌ ${file} muvaffaqiyatsiz:`, e.message);
      throw e;
    } finally {
      client.release();
    }
  }
}

module.exports = { migrate };
