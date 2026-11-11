import { randomUUID } from 'node:crypto';

export async function notifyProposalAuthor(db, proposal, actor, kind, message) {
  if (!proposal?.author_id || proposal.author_id === actor.id) return;
  await db.prepare('INSERT INTO notifications(id,user_id,proposal_id,kind,message,created_at) VALUES(?,?,?,?,?,?)')
    .run(randomUUID(), proposal.author_id, proposal.id, kind, String(message || '').slice(0, 2000), new Date().toISOString());
}

export async function notificationsForUser(db, userId) {
  const [notifications, unread] = await Promise.all([
    db.prepare(`SELECT notifications.*, proposals.reaction_key FROM notifications
      LEFT JOIN proposals ON proposals.id = notifications.proposal_id
      WHERE notifications.user_id = ? ORDER BY notifications.created_at DESC LIMIT 100`).all(userId),
    db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId)
  ]);
  return { notifications, unread: Number(unread.count) };
}
