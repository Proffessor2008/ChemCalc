import { AsyncLocalStorage } from 'node:async_hooks';

export function toPostgresSql(sql) {
  let index = 0;
  let quoted = false;
  let result = '';
  for (const character of sql) {
    if (character === "'") quoted = !quoted;
    result += character === '?' && !quoted ? `$${++index}` : character;
  }
  return result;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    login TEXT NOT NULL,
    login_canonical TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    privileges TEXT NOT NULL CHECK(privileges IN ('basic', 'admin', 'admin+', 'GOD')),
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    author_id BIGINT NOT NULL REFERENCES users(id),
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
    score DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    reviewed_by BIGINT REFERENCES users(id),
    reviewed_at TEXT,
    review_note TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS proposals_status_score ON proposals(status, score DESC, created_at DESC);
  CREATE INDEX IF NOT EXISTS proposals_reaction_key ON proposals(reaction_key);
  CREATE INDEX IF NOT EXISTS proposals_author_id ON proposals(author_id);
  CREATE TABLE IF NOT EXISTS votes (
    id BIGSERIAL PRIMARY KEY,
    proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    value INTEGER NOT NULL CHECK(value IN (-1, 1)),
    weight DOUBLE PRECISION NOT NULL DEFAULT 1,
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
    published_by BIGINT NOT NULL REFERENCES users(id),
    published_at TEXT NOT NULL,
    version INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS rule_versions (
    id TEXT PRIMARY KEY,
    reaction_key TEXT NOT NULL,
    rule_json TEXT NOT NULL,
    proposal_id TEXT NOT NULL REFERENCES proposals(id),
    published_by BIGINT NOT NULL REFERENCES users(id),
    published_at TEXT NOT NULL,
    package_version INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS rule_versions_reaction ON rule_versions(reaction_key, package_version DESC);
  CREATE TABLE IF NOT EXISTS review_events (
    id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    actor_id BIGINT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL CHECK(action IN ('approved','rejected','needs_evidence','changes_requested','edited','rollback')),
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    proposal_version INTEGER NOT NULL,
    score DOUBLE PRECISION NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS review_events_proposal ON review_events(proposal_id, created_at);
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    proposal_id TEXT REFERENCES proposals(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    read_at TEXT
  );
  CREATE INDEX IF NOT EXISTS notifications_user_created ON notifications(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS notifications_user_unread ON notifications(user_id, read_at);
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_privileges_check;
  ALTER TABLE users ADD CONSTRAINT users_privileges_check CHECK(privileges IN ('basic', 'admin', 'admin+', 'GOD'));
  ALTER TABLE proposals ALTER COLUMN score TYPE DOUBLE PRECISION;
  ALTER TABLE votes ADD COLUMN IF NOT EXISTS weight DOUBLE PRECISION NOT NULL DEFAULT 1;
  ALTER TABLE public.review_events ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.rule_versions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
  ALTER TABLE review_events DROP CONSTRAINT IF EXISTS review_events_action_check;
  ALTER TABLE review_events ADD CONSTRAINT review_events_action_check CHECK(action IN ('approved','rejected','needs_evidence','changes_requested','edited','rollback'));
  INSERT INTO review_events(id,proposal_id,actor_id,action,note,created_at,proposal_version,score)
    SELECT md5(proposals.id || ':' || proposals.reviewed_by || ':' || proposals.status || ':' || proposals.reviewed_at),
      proposals.id, proposals.reviewed_by, proposals.status, proposals.review_note, proposals.reviewed_at,
      proposals.version, proposals.score FROM proposals
    WHERE proposals.reviewed_by IS NOT NULL
      AND proposals.status IN ('approved','rejected','needs_evidence','changes_requested')
      AND NOT EXISTS(SELECT 1 FROM review_events WHERE proposal_id = proposals.id AND action = proposals.status AND created_at = proposals.reviewed_at)
    ON CONFLICT(id) DO NOTHING;
  INSERT INTO rule_versions(id,reaction_key,rule_json,proposal_id,published_by,published_at,package_version)
    SELECT id,reaction_key,rule_json,source_proposal_id,published_by,published_at,version FROM production_rules
    WHERE NOT EXISTS(SELECT 1 FROM rule_versions WHERE rule_versions.id = production_rules.id);
`;

class PostgresCommunityDatabase {
  constructor(client) {
    this.client = client;
    this.kind = 'postgres';
    this.context = new AsyncLocalStorage();
    this.queue = Promise.resolve();
  }

  enqueue(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  query(sql, parameters = []) {
    const text = toPostgresSql(sql);
    if (this.context.getStore()) return this.context.getStore().query(text, parameters);
    return this.enqueue(() => this.client.query(text, parameters));
  }

  prepare(sql) {
    return {
      get: async (...parameters) => (await this.query(sql, parameters)).rows[0],
      all: async (...parameters) => (await this.query(sql, parameters)).rows,
      run: async (...parameters) => {
        const needsId = /^\s*INSERT\s+INTO\s+users\b/i.test(sql);
        const result = await this.query(needsId ? `${toPostgresSql(sql)} RETURNING id` : sql, parameters);
        return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id === undefined ? undefined : Number(result.rows[0].id) };
      }
    };
  }

  exec(sql) {
    return this.query(sql);
  }

  transaction(callback) {
    return this.enqueue(async () => {
      await this.client.query('BEGIN');
      try {
        const result = await this.context.run(this.client, callback);
        await this.client.query('COMMIT');
        return result;
      } catch (error) {
        await this.client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async close() {
    await this.queue;
    await this.client.end();
  }
}

export async function openPostgresDatabase(connectionString, { client } = {}) {
  if (!connectionString && !client) throw new TypeError('Для PostgreSQL задайте DATABASE_URL');
  if (!client) {
    const { Client } = await import('pg');
    const url = new URL(connectionString);
    const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    const sslMode = url.searchParams.get('sslmode');
    client = new Client({
      connectionString,
      ssl: local || sslMode === 'disable' ? false : { rejectUnauthorized: sslMode === 'verify-full' }
    });
  }
  await client.connect();
  try {
    const db = new PostgresCommunityDatabase(client);
    await db.exec(SCHEMA);
    return db;
  } catch (error) {
    await client.end();
    throw error;
  }
}
