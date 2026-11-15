import { randomUUID } from 'node:crypto';

export const MAX_VOTES_PER_HOUR = 20;

export const ACCEPT_REPUTATION = 1;

export const REPUTATION_SQL = `(
  SELECT COALESCE(SUM(v.value), 0) FROM proposals AS p
    LEFT JOIN votes AS v ON v.proposal_id = p.id WHERE p.author_id = users.id)
 + (SELECT COALESCE(SUM(pv.value), 0) FROM questions AS q
    LEFT JOIN post_votes AS pv ON pv.target_type = 'question' AND pv.target_id = q.id WHERE q.author_id = users.id)
 + (SELECT COALESCE(SUM(pv.value), 0) FROM answers AS a
    LEFT JOIN post_votes AS pv ON pv.target_type = 'answer' AND pv.target_id = a.id WHERE a.author_id = users.id)
 + (SELECT COUNT(*) FROM answers AS a WHERE a.author_id = users.id AND a.accepted = 1)`;

export function voteWeight(reputation) {
  const normalized = Number.isFinite(Number(reputation)) ? Math.max(0, Number(reputation)) : 0;
  return 1 + Math.min(2, Math.sqrt(normalized / 25));
}

export async function reputationForUser(db, userId) {
  const row = await db.prepare(`SELECT ${REPUTATION_SQL} AS reputation FROM users WHERE users.id = ?`).get(userId);
  return Number(row?.reputation || 0);
}

export async function recordReview(db, proposal, actor, action, note = '') {
  await db.prepare(`INSERT INTO review_events(id,proposal_id,actor_id,action,note,created_at,proposal_version,score)
    VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(), proposal.id, actor.id, action, String(note || '').slice(0, 2000), new Date().toISOString(), proposal.version, Number(proposal.score));
}

export async function reviewHistory(db, proposalId) {
  return db.prepare(`SELECT review_events.*, COALESCE(NULLIF(users.nickname, ''), users.login) AS actor_login FROM review_events
    JOIN users ON users.id = review_events.actor_id WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`).all(proposalId);
}

export async function reviewHistoryMap(db, rows) {
  const result = new Map();
  if (!rows.length) return result;
  const placeholders = rows.map(() => '?').join(',');
  const events = await db.prepare(`SELECT review_events.*, COALESCE(NULLIF(users.nickname, ''), users.login) AS actor_login FROM review_events
    JOIN users ON users.id = review_events.actor_id WHERE proposal_id IN (${placeholders}) ORDER BY created_at ASC, id ASC`).all(...rows.map((row) => row.id));
  for (const event of events) {
    if (!result.has(event.proposal_id)) result.set(event.proposal_id, []);
    result.get(event.proposal_id).push(event);
  }
  return result;
}
