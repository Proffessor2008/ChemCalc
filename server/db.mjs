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
  const reviewDefinition = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'review_events'").get()?.sql || '';
  if (!reviewDefinition.includes("'rollback'")) {
    transaction(db, () => {
      db.exec(`
        CREATE TABLE review_events_with_rollback (
          id TEXT PRIMARY KEY,
          proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
          actor_id INTEGER NOT NULL REFERENCES users(id),
          action TEXT NOT NULL CHECK(action IN ('approved','rejected','needs_evidence','changes_requested','edited','rollback')),
          note TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          proposal_version INTEGER NOT NULL,
          score REAL NOT NULL DEFAULT 0
        );
        INSERT INTO review_events_with_rollback SELECT * FROM review_events;
        DROP TABLE review_events;
        ALTER TABLE review_events_with_rollback RENAME TO review_events;
        CREATE INDEX review_events_proposal ON review_events(proposal_id, created_at);
      `);
    });
  }
  db.exec(`INSERT INTO rule_versions(id,reaction_key,rule_json,proposal_id,published_by,published_at,package_version)
    SELECT id,reaction_key,rule_json,source_proposal_id,published_by,published_at,version FROM production_rules
    WHERE NOT EXISTS(SELECT 1 FROM rule_versions WHERE rule_versions.id = production_rules.id)`);
}

function migrateQaFeatures(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(questions)').all().map((column) => column.name));
  if (!columns.has('closed')) db.exec('ALTER TABLE questions ADD COLUMN closed INTEGER NOT NULL DEFAULT 0');
  if (!columns.has('closed_reason')) db.exec("ALTER TABLE questions ADD COLUMN closed_reason TEXT NOT NULL DEFAULT ''");
  if (!columns.has('duplicate_of')) db.exec('ALTER TABLE questions ADD COLUMN duplicate_of TEXT');
  if (!columns.has('views')) db.exec('ALTER TABLE questions ADD COLUMN views INTEGER NOT NULL DEFAULT 0');
}

function migrateProfileFeatures(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(users)').all().map((column) => column.name));
  if (!columns.has('avatar')) db.exec("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT ''");
  if (!columns.has('privacy')) db.exec("ALTER TABLE users ADD COLUMN privacy TEXT NOT NULL DEFAULT 'public'");
  if (!columns.has('nickname')) db.exec("ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT ''");
  if (!columns.has('telegram_id')) db.exec('ALTER TABLE users ADD COLUMN telegram_id INTEGER');
  if (!columns.has('telegram_username')) db.exec('ALTER TABLE users ADD COLUMN telegram_username TEXT');
  if (!columns.has('telegram_photo_url')) db.exec('ALTER TABLE users ADD COLUMN telegram_photo_url TEXT');
  if (!columns.has('deleted_at')) db.exec('ALTER TABLE users ADD COLUMN deleted_at TEXT');
  if (!columns.has('password_set')) db.exec('ALTER TABLE users ADD COLUMN password_set INTEGER NOT NULL DEFAULT 1');
  db.prepare("UPDATE users SET password_set = 1 WHERE password_set IS NULL").run();
  db.prepare("UPDATE users SET password_set = 0 WHERE telegram_id IS NOT NULL AND login LIKE 'tg\\_%' ESCAPE '\\'").run();
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_id_unique ON users(telegram_id)');
  db.prepare("UPDATE users SET nickname = login WHERE nickname = '' OR nickname IS NULL").run();
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
      nickname TEXT NOT NULL DEFAULT '',
      telegram_id INTEGER,
      telegram_username TEXT,
      telegram_photo_url TEXT,
      password_hash TEXT NOT NULL,
      password_set INTEGER NOT NULL DEFAULT 1,
      privileges TEXT NOT NULL CHECK(privileges IN ('basic', 'admin', 'admin+', 'GOD')),
      avatar TEXT NOT NULL DEFAULT '',
      privacy TEXT NOT NULL DEFAULT 'public',
      deleted_at TEXT,
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
    CREATE TABLE IF NOT EXISTS telegram_auth (
      key TEXT PRIMARY KEY,
      used_at TEXT NOT NULL
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
    CREATE TABLE IF NOT EXISTS rule_versions (
      id TEXT PRIMARY KEY,
      reaction_key TEXT NOT NULL,
      rule_json TEXT NOT NULL,
      proposal_id TEXT NOT NULL REFERENCES proposals(id),
      published_by INTEGER NOT NULL REFERENCES users(id),
      published_at TEXT NOT NULL,
      package_version INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS rule_versions_reaction ON rule_versions(reaction_key, package_version DESC);
    CREATE TABLE IF NOT EXISTS review_events (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
      actor_id INTEGER NOT NULL REFERENCES users(id),
      action TEXT NOT NULL CHECK(action IN ('approved','rejected','needs_evidence','changes_requested','edited','rollback')),
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      proposal_version INTEGER NOT NULL,
      score REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS review_events_proposal ON review_events(proposal_id, created_at);
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      proposal_id TEXT REFERENCES proposals(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS notifications_user_created ON notifications(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS notifications_user_unread ON notifications(user_id, read_at);
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      score REAL NOT NULL DEFAULT 0,
      closed INTEGER NOT NULL DEFAULT 0,
      closed_reason TEXT NOT NULL DEFAULT '',
      duplicate_of TEXT,
      views INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS questions_score ON questions(score DESC, created_at DESC);
    CREATE INDEX IF NOT EXISTS questions_created ON questions(created_at DESC);
    CREATE INDEX IF NOT EXISTS questions_author ON questions(author_id);
    CREATE TABLE IF NOT EXISTS answers (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      accepted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS answers_question ON answers(question_id, accepted DESC, score DESC, created_at ASC);
    CREATE INDEX IF NOT EXISTS answers_author ON answers(author_id);
    CREATE TABLE IF NOT EXISTS post_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK(target_type IN ('question', 'answer')),
      target_id TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      value INTEGER NOT NULL CHECK(value IN (-1, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(target_type, target_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS post_votes_user_updated ON post_votes(user_id, updated_at);
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL CHECK(target_type IN ('question', 'answer')),
      target_id TEXT NOT NULL,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS comments_target ON comments(target_type, target_id, created_at ASC);
    CREATE TABLE IF NOT EXISTS post_edits (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL CHECK(target_type IN ('question', 'answer')),
      target_id TEXT NOT NULL,
      editor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title_before TEXT,
      title_after TEXT,
      body_before TEXT NOT NULL,
      body_after TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS post_edits_target ON post_edits(target_type, target_id, created_at ASC);
    CREATE TABLE IF NOT EXISTS question_flags (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE(question_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS question_flags_question ON question_flags(question_id, created_at DESC);
  `);
  migratePrivileges(db);
  migrateCommunityFeatures(db);
  migrateQaFeatures(db);
  migrateProfileFeatures(db);
  return db;
}

export function publicUser(row) {
  return row && {
    id: row.id,
    login: row.login,
    nickname: row.nickname || row.login,
    telegram_linked: Boolean(row.telegram_id),
    telegram_username: row.telegram_username || '',
    password_set: row.password_set !== 0,
    privileges: row.privileges,
    avatar: row.avatar || '',
    privacy: row.privacy || 'public',
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
