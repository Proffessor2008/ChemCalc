import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function migratePrivileges(db) {
  const definition = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql || '';
  if (definition.includes("'admin+'")) return;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    transaction(db, () => {
      db.exec(`
        CREATE TABLE users_with_admin_plus (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          login TEXT NOT NULL,
          login_canonical TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          privileges TEXT NOT NULL CHECK(privileges IN ('basic', 'admin', 'admin+', 'GOD')),
          created_at TEXT NOT NULL,
          last_login_at TEXT
        );
        INSERT INTO users_with_admin_plus SELECT * FROM users;
        DROP TABLE users;
        ALTER TABLE users_with_admin_plus RENAME TO users;
      `);
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Ошибка миграции связей пользователей');
}

export function openCommunityDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT NOT NULL,
      login_canonical TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      privileges TEXT NOT NULL CHECK(privileges IN ('basic', 'admin', 'admin+', 'GOD')),
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      author_id INTEGER NOT NULL REFERENCES users(id),
      reaction_key TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'new',
      base_rule_id TEXT,
      original_rule_json TEXT,
      proposed_rule_json TEXT NOT NULL,
      issue_types TEXT NOT NULL DEFAULT '[]',
      source_type TEXT NOT NULL,
      source_details TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      score INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      review_note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS proposals_status_score ON proposals(status, score DESC, created_at DESC);
    CREATE INDEX IF NOT EXISTS proposals_reaction_key ON proposals(reaction_key);
    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      value INTEGER NOT NULL CHECK(value IN (-1, 1)),
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(proposal_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS production_rules (
      id TEXT PRIMARY KEY,
      reaction_key TEXT NOT NULL UNIQUE,
      rule_json TEXT NOT NULL,
      source_proposal_id TEXT NOT NULL UNIQUE REFERENCES proposals(id),
      published_by INTEGER NOT NULL REFERENCES users(id),
      published_at TEXT NOT NULL,
      version INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
  `);
  migratePrivileges(db);
  return db;
}

export function publicUser(row) {
  return row && {
    id: row.id,
    login: row.login,
    privileges: row.privileges,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
    pending_count: row.pending_count ?? 0
  };
}

export function jsonRecord(row, fields) {
  if (!row) return null;
  const result = { ...row };
  for (const field of fields) {
    try { result[field] = JSON.parse(result[field]); } catch { result[field] = null; }
  }
  return result;
}

export function transaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = callback();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
