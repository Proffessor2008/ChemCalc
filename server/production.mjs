import { renameSync, unlinkSync, writeFileSync } from 'node:fs';
import reactionData from '../data/reaction-rules.json' with { type: 'json' };
import finalReactionData from '../data/reaction-rules-final.json' with { type: 'json' };
import { transaction } from './db.mjs';
import { validateData } from '../scripts/validate-data.mjs';

const PRIORITIES = new Map([...finalReactionData.rules, ...reactionData.rules].map((rule) => [rule.id, rule.priority]));
const PACKAGE_PATH = new URL('../data/reaction-rules-community.json', import.meta.url);
const TEMP_PATH = new URL('../data/reaction-rules-community.tmp', import.meta.url);

export async function communityPackage(db) {
  const rules = (await db.prepare('SELECT * FROM production_rules WHERE active = 1 ORDER BY published_at, id').all())
    .map((row) => JSON.parse(row.rule_json));
  const substances = [];
  const solubility = { substances: {} };
  const activeSubstances = await db.prepare(`SELECT proposals.proposed_rule_json FROM production_rules
    JOIN proposals ON proposals.id = production_rules.source_proposal_id WHERE production_rules.active = 1`).all();
  for (const row of activeSubstances) {
    const rule = JSON.parse(row.proposed_rule_json);
    for (const substance of rule.substances || []) {
      if (!substances.some((item) => item.formula === substance.formula) && !solubility.substances[substance.formula]) {
        substances.push({ formula: substance.formula, name_ru: substance.name_ru, class: substance.class });
        solubility.substances[substance.formula] = {
          source: substance.source,
          solubility: substance.solubility,
          strong: substance.strong,
          ions: substance.ions
        };
      }
    }
  }
  const version = Number((await db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM production_rules').get()).version);
  return { version, source: 'Проверенные правила сообщества', rules, substances, solubility };
}

export async function publishProposal(db, proposal, reviewer) {
  if (proposal.source_type === 'personal') throw Object.assign(new Error('Личное мнение нельзя опубликовать без независимого источника'), { status: 422, code: 'source_required' });
  const previousRow = await db.prepare('SELECT * FROM production_rules WHERE reaction_key = ?').get(proposal.reaction_key);
  if (previousRow && proposal.kind !== 'correction') {
    throw Object.assign(new Error('Такое правило уже опубликовано. Откройте его для предложения исправления.'), { status: 409, code: 'duplicate_rule' });
  }
  const previous = previousRow ? JSON.parse(previousRow.rule_json) : null;
  const proposed = JSON.parse(proposal.proposed_rule_json);
  const id = `community-${proposal.id}`;
  const rule = {
    ...proposed,
    id,
    priority: proposal.base_rule_id ? (PRIORITIES.get(proposal.base_rule_id) ?? previous?.priority ?? 0) + 100 : 600,
    contributors: [...new Set([...(previous?.contributors || []), proposal.author_login])],
    basedOn: proposal.base_rule_id || null,
    sourceProposalId: proposal.id,
    publishedBy: reviewer.login,
    publishedAt: new Date().toISOString()
  };
  delete rule.substances;
  await transaction(db, async () => {
    const version = Number((await db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS version FROM production_rules').get()).version);
    await db.prepare(`INSERT INTO production_rules(id,reaction_key,rule_json,source_proposal_id,published_by,published_at,version,active) VALUES(?,?,?,?,?,?,?,1)
      ON CONFLICT(reaction_key) DO UPDATE SET id = excluded.id, rule_json = excluded.rule_json,
        source_proposal_id = excluded.source_proposal_id, published_by = excluded.published_by,
        published_at = excluded.published_at, version = excluded.version, active = 1`)
      .run(id, proposal.reaction_key, JSON.stringify(rule), proposal.id, reviewer.id, rule.publishedAt, version);
    await db.prepare("UPDATE proposals SET status = 'approved', reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?")
      .run(reviewer.id, rule.publishedAt, 'Опубликовано модератором', proposal.id);
    const packageData = await communityPackage(db);
    writeFileSync(TEMP_PATH, `${JSON.stringify(packageData, null, 2)}\n`);
    const validation = validateData({ communityPath: TEMP_PATH });
    if (validation.errors.length) {
      try { unlinkSync(TEMP_PATH); } catch { /* already absent */ }
      throw Object.assign(new Error(`Правило не прошло проверку базы: ${validation.errors.join('; ')}`), { status: 422, code: 'invalid_production_rule', details: validation.errors });
    }
    renameSync(TEMP_PATH, PACKAGE_PATH);
  });
  return rule;
}
