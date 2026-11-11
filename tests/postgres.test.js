import test from 'node:test';
import assert from 'node:assert/strict';
import { openPostgresDatabase, toPostgresSql } from '../server/postgres.mjs';
import { transaction } from '../server/db.mjs';

function fakeClient() {
  return {
    calls: [],
    connected: false,
    ended: false,
    async connect() { this.connected = true; },
    async end() { this.ended = true; },
    async query(text, parameters = []) {
      this.calls.push({ text, parameters });
      if (/^SELECT COUNT\(\*\) AS count FROM users$/.test(text)) return { rows: [{ count: '0' }], rowCount: 1 };
      if (/^INSERT INTO users\b/.test(text)) return { rows: [{ id: '7' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }
  };
}

test('PostgreSQL: параметры преобразуются без изменения строковых литералов', () => {
  assert.equal(toPostgresSql('SELECT * FROM users WHERE id = ? AND login_canonical = ?'), 'SELECT * FROM users WHERE id = $1 AND login_canonical = $2');
  assert.equal(toPostgresSql("SELECT '?' AS placeholder, id FROM users WHERE id = ?"), "SELECT '?' AS placeholder, id FROM users WHERE id = $1");
  assert.equal(toPostgresSql("UPDATE users SET privileges = 'admin+' WHERE id = ?"), "UPDATE users SET privileges = 'admin+' WHERE id = $1");
});

test('PostgreSQL: инициализация, RETURNING id и транзакции используют одно соединение', async () => {
  const client = fakeClient();
  const db = await openPostgresDatabase(null, { client });
  assert.equal(db.kind, 'postgres');
  assert.equal(client.connected, true);
  assert.ok(client.calls[0].text.includes("CHECK(privileges IN ('basic', 'admin', 'admin+', 'GOD'))"));
  const created = await db.prepare('INSERT INTO users(login,login_canonical,password_hash,privileges,created_at) VALUES(?,?,?,?,?)').run('user', 'user', 'hash', 'basic', 'now');
  assert.equal(created.lastInsertRowid, 7);
  const insert = client.calls.at(-1);
  assert.ok(insert.text.endsWith('RETURNING id'));
  assert.deepEqual(insert.parameters, ['user', 'user', 'hash', 'basic', 'now']);
  await transaction(db, async () => {
    await db.prepare('UPDATE users SET privileges = ? WHERE id = ?').run('admin+', 7);
    await db.prepare('SELECT * FROM users WHERE id = ?').get(7);
  });
  assert.ok(client.calls.some((call) => call.text === 'BEGIN'));
  assert.ok(client.calls.some((call) => call.text === 'COMMIT'));
  await assert.rejects(transaction(db, async () => {
    await db.prepare('SELECT * FROM users WHERE id = ?').get(7);
    throw new Error('rollback test');
  }), /rollback test/);
  assert.ok(client.calls.some((call) => call.text === 'ROLLBACK'));
  await db.close();
  assert.equal(client.ended, true);
});

test('драйвер pg установлен, а DATABASE_URL обязателен без тестового клиента', async () => {
  const { Client } = await import('pg');
  assert.equal(typeof Client, 'function');
  await assert.rejects(openPostgresDatabase(''), { name: 'TypeError', message: 'Для PostgreSQL задайте DATABASE_URL' });
});
