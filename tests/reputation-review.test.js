import test from 'node:test';
import assert from 'node:assert/strict';
import { openCommunityDatabase } from '../server/db.mjs';
import { MAX_VOTES_PER_HOUR, recordReview, reputationForUser, reviewHistoryMap, voteWeight } from '../server/review.mjs';

test('вес голоса ограничен и не усиливает отрицательную репутацию', () => {
  assert.equal(voteWeight(-100), 1);
  assert.equal(voteWeight(0), 1);
  assert.equal(voteWeight(25), 2);
  assert.equal(voteWeight(100), 3);
  assert.equal(voteWeight(10000), 3);
  assert.equal(voteWeight(Number.NaN), 1);
  assert.equal(MAX_VOTES_PER_HOUR, 20);
});

test('репутация остаётся суммой signed votes и может быть отрицательной', async () => {
  const db = openCommunityDatabase(':memory:');
  try {
    for (const id of [1, 2, 3, 4]) db.prepare('INSERT INTO users(login,login_canonical,password_hash,privileges,created_at) VALUES(?,?,?,?,?)').run(`user${id}`, `user${id}`, 'hash', 'basic', '2026-01-01');
    db.prepare('INSERT INTO proposals(id,author_id,reaction_key,proposed_rule_json,source_type,source_details,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run('proposal', 1, 'key', '{}', 'glinka', 'source', '2026-01-01', '2026-01-01');
    for (const [user, value] of [[2, 1], [3, -1], [4, -1]]) {
      db.prepare('INSERT INTO votes(proposal_id,user_id,value,weight,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('proposal', user, value, 1, '2026-01-01', '2026-01-01');
    }
    assert.equal(await reputationForUser(db, 1), -1);
    assert.equal(db.prepare('SELECT SUM(value * weight) AS score FROM votes WHERE proposal_id = ?').get('proposal').score, -1);
    const proposal = db.prepare('SELECT * FROM proposals WHERE id = ?').get('proposal');
    await recordReview(db, proposal, { id: 2 }, 'changes_requested', 'Нужно уточнить условия');
    const history = await reviewHistoryMap(db, [proposal]);
    assert.equal(history.get('proposal').length, 1);
    assert.equal(history.get('proposal')[0].actor_login, 'user2');
    assert.equal(history.get('proposal')[0].note, 'Нужно уточнить условия');
    assert.ok(db.prepare("SELECT 1 FROM pragma_table_info('votes') WHERE name = 'weight'").get());
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'review_events'").get());
  } finally {
    db.close();
  }
});
