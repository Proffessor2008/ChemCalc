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

function migrateCommunityFeatures(db) {
  if (!db.prepare('PRAGMA table_info(votes)').all().some((column) => column.name === 'weight')) {
    db.exec('ALTER TABLE votes ADD COLUMN weight REAL NOT NULL DEFAULT 1');
  }
  db.exec(`
    INSERT INTO review_events(id,proposal_id,actor_id,action,note,created_at,proposal_version,score)
    SELECT lower(hex(randomblob(16))), proposals.id, proposals.reviewed_by, proposals.status,
      proposals.review_note, proposals.reviewed_at, proposals.version, proposals.score FROM proposals
    WHERE proposals.reviewed_by IS NOT NULL
      AND proposals.status IN ('approved','rejected','needs_evidence','changes_requested')
      AND NOT EXISTS(SELECT 1 FROM review_events WHERE proposal_id = proposals.id AND action = proposals.status AND created_at = proposals.reviewed_at);
  `);
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
      score REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      review_note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS proposals_status_score ON proposals(status, score DESC, created_at DESC);
    CREATE INDEX IF NOT EXISTS proposals_reaction_key ON proposals(reaction_key);
    CREATE INDEX IF NOT EXISTS proposals_author_id ON proposals(author_id);
    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      value INTEGER NOT NULL CHECK(value IN (-1, 1)),
      weight REAL NOT NULL DEFAULT 1,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(proposal_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS votes_user_updated ON votes(user_id, updated_at);
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
    CREATE TABLE IF NOT EXISTS review_events (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
      actor_id INTEGER NOT NULL REFERENCES users(id),
      action TEXT NOT NULL CHECK(action IN ('approved','rejected','needs_evidence','changes_requested','edited')),
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      proposal_version INTEGER NOT NULL,
      score REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS review_events_proposal ON review_events(proposal_id, created_at);
  `);
  migratePrivileges(db);
  migrateCommunityFeatures(db);
  return db;
}

export function publicUser(row) {
  return row && {
    id: row.id,
    login: row.login,
    privileges: row.privileges,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
    pending_count: Number(row.pending_count ?? 0),
    reputation: Number(row.reputation ?? 0)
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
  if (typeof db.transaction === 'function') return db.transaction(callback);
  db.exec('BEGIN IMMEDIATE');
  let value;
  try { value = callback(); } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  if (value && typeof value.then === 'function') return value.then((result) => {
    db.exec('COMMIT');
    return result;
  }, (error) => {
    db.exec('ROLLBACK');
    throw error;
  });
  db.exec('COMMIT');
  return value;
}
