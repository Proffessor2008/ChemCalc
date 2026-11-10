import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createCommunityServer } from '../server/app.mjs';
import { validateData } from '../scripts/validate-data.mjs';

const PACKAGE = 'data/reaction-rules-community.json';
const originalPackage = readFileSync(PACKAGE, 'utf8');
const credentials = { login: 'creator', password: 'StrongPass123!' };
const conditions = { medium: 'neutral', solvent: 'aqueous', acidConcentration: 'unspecified', ratio: 'normal', catalyst: '', heating: false, current: false };

function proposalPayload() {
  return {
    equation: 'HCl + LiOH = LiCl + H2O',
    conditions,
    sourceType: 'glinka',
    sourceDetails: 'Общая химия, раздел нейтрализации',
    issueTypes: ['products'],
    comment: 'Щёлочь лития нейтрализуется соляной кислотой',
    reactionType: 'нейтрализация',
    substances: [
      { formula: 'LiOH', name_ru: 'Гидроксид лития', class: 'base', solubility: 'Р', strong: true, ions: [{ formula: 'Li^+', coefficient: 1 }, { formula: 'OH^-', coefficient: 1 }] },
      { formula: 'LiCl', name_ru: 'Хлорид лития', class: 'salt', solubility: 'Р', strong: true, ions: [{ formula: 'Li^+', coefficient: 1 }, { formula: 'Cl^-', coefficient: 1 }] }
    ]
  };
}

async function request(port, path, { method = 'GET', body, cookie, csrfToken } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  return { status: response.status, data, ...data, cookie: response.headers.get('set-cookie') };
}

async function register(port, login, password = 'password123') {
  const result = await request(port, '/api/auth/register', { method: 'POST', body: { login, password, confirmPassword: password } });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.user.privileges, 'basic');
  assert.ok(result.data.user.created_at);
  assert.ok(result.data.csrfToken);
  assert.ok(result.cookie);
  assert.ok(!result.data.cookie);
  return { ...result.data, cookie: result.cookie, password };
}

test('community API: регистрация, заявки, голосование, модерация и публикация', async (context) => {
  const app = await createCommunityServer({ dbPath: ':memory:', god: credentials });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  context.after(async () => {
    await app.close();
    writeFileSync(PACKAGE, originalPackage);
  });

  const health = await request(port, '/api/health');
  assert.deepEqual(health.data, { ok: true, database: 'sqlite', schemaVersion: 2 });
  const mismatch = await request(port, '/api/auth/register', { method: 'POST', body: { login: 'baduser', password: 'password123', confirmPassword: 'otherPassword' } });
  assert.equal(mismatch.status, 422);
  const alice = await register(port, 'alice');
  const duplicate = await request(port, '/api/auth/register', { method: 'POST', body: { login: 'ALICE', password: 'password123', confirmPassword: 'password123' } });
  assert.equal(duplicate.status, 409);
  const bob = await register(port, 'bob');

  const noCsrf = await request(port, '/api/proposals', { method: 'POST', body: proposalPayload(), cookie: alice.cookie });
  assert.equal(noCsrf.status, 403);
  const unbalanced = await request(port, '/api/proposals', { method: 'POST', body: { ...proposalPayload(), equation: 'HCl + LiOH = 2LiCl + H2O' }, cookie: alice.cookie, csrfToken: alice.csrfToken });
  assert.equal(unbalanced.status, 422);
  assert.equal(unbalanced.data.error.code, 'unbalanced');
  const organic = await request(port, '/api/proposals', { method: 'POST', body: { ...proposalPayload(), equation: 'NaCl + AgNO3 = AgCl + NaNO3', conditions: { ...conditions, solvent: 'organic' } }, cookie: alice.cookie, csrfToken: alice.csrfToken });
  assert.equal(organic.status, 422);
  assert.equal(organic.data.error.code, 'invalid_medium');

  const created = await request(port, '/api/proposals', { method: 'POST', body: proposalPayload(), cookie: alice.cookie, csrfToken: alice.csrfToken });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.proposal.id;
  assert.equal(created.data.proposal.status, 'pending');
  assert.equal(created.data.proposal.author_login, 'alice');
  assert.equal(created.data.proposal.score, 0);

  const ownVote = await request(port, `/api/proposals/${id}/vote`, { method: 'POST', body: { value: 1 }, cookie: alice.cookie, csrfToken: alice.csrfToken });
  assert.equal(ownVote.status, 403);
  const basicReview = await request(port, `/api/proposals/${id}/review`, { method: 'POST', body: { action: 'approve' }, cookie: bob.cookie, csrfToken: bob.csrfToken });
  assert.equal(basicReview.status, 403);
  const firstVote = await request(port, `/api/proposals/${id}/vote`, { method: 'POST', body: { value: 1 }, cookie: bob.cookie, csrfToken: bob.csrfToken });
  assert.equal(firstVote.status, 200);
  assert.equal(firstVote.data.proposal.score, 1);
  assert.equal(firstVote.data.proposal.viewer_vote, 1);
  const secondVote = await request(port, `/api/proposals/${id}/vote`, { method: 'POST', body: { value: 1 }, cookie: bob.cookie, csrfToken: bob.csrfToken });
  assert.equal(secondVote.data.proposal.score, 1);

  const godLogin = await request(port, '/api/auth/login', { method: 'POST', body: credentials });
  assert.equal(godLogin.status, 200);
  assert.equal(godLogin.data.user.privileges, 'GOD');
  const users = await request(port, '/api/users', { cookie: godLogin.cookie });
  assert.equal(users.status, 200);
  assert.equal(users.data.users.length, 3);
  assert.ok(users.data.users.every((user) => !user.password_hash && !user.password));
  assert.equal(users.data.users.find((user) => user.login === 'alice').pending_count, 1);

  const promote = await request(port, '/api/users/3/role', { method: 'PATCH', body: { privileges: 'admin' }, cookie: godLogin.cookie, csrfToken: godLogin.csrfToken });
  assert.equal(promote.status, 200, JSON.stringify(promote.data));
  assert.equal(promote.data.user.privileges, 'admin');
  const forbiddenRole = await request(port, '/api/users/2/role', { method: 'PATCH', body: { privileges: 'admin' }, cookie: bob.cookie, csrfToken: bob.csrfToken });
  assert.equal(forbiddenRole.status, 403);
  const immutableGod = await request(port, '/api/users/1/role', { method: 'PATCH', body: { privileges: 'admin' }, cookie: godLogin.cookie, csrfToken: godLogin.csrfToken });
  assert.equal(immutableGod.status, 409);

  const adminLogin = await request(port, '/api/auth/login', { method: 'POST', body: { login: 'bob', password: bob.password } });
  const edited = await request(port, `/api/proposals/${id}`, { method: 'PATCH', body: { ...proposalPayload(), comment: 'Проверено и уточнено администратором' }, cookie: adminLogin.cookie, csrfToken: adminLogin.csrfToken });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.proposal.version, 2);
  const approved = await request(port, `/api/proposals/${id}/review`, { method: 'POST', body: { action: 'approve' }, cookie: adminLogin.cookie, csrfToken: adminLogin.csrfToken });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal(approved.data.proposal.status, 'approved');
  assert.equal(approved.data.rule.publishedBy, 'bob');
  assert.equal(approved.data.rule.priority, 600);

  const published = JSON.parse(readFileSync(PACKAGE, 'utf8'));
  assert.equal(published.version, 1);
  assert.equal(published.rules.length, 1);
  assert.equal(published.rules[0].publishedBy, 'bob');
  assert.equal(published.substances.length, 2);
  assert.equal(Object.keys(published.solubility.substances).length, 2);
  const validation = validateData();
  assert.deepEqual(validation.errors, []);
  assert.deepEqual(validation.warnings, []);
  assert.equal(validation.stats.rules, 334);
  assert.equal(validation.stats.substances, 267);
  assert.equal(validation.stats.solubleRecords, 127);

  const { predictReaction, updateCommunityData } = await import('../js/predictor.js');
  const { buildIonicEquations } = await import('../js/ionic.js');
  updateCommunityData(published);
  const prediction = predictReaction('HCl + LiOH');
  assert.equal(prediction.status, 'predicted', prediction.message);
  assert.equal(prediction.formatted, 'HCl + LiOH → LiCl + H2O');
  assert.equal(prediction.ruleId, `community-${id}`);
  const ionic = buildIonicEquations('HCl + LiOH = LiCl + H2O');
  assert.equal(ionic.netUnicode, 'H⁺ + OH⁻ → H₂O');
  const pending = await request(port, '/api/proposals?status=pending');
  assert.equal(pending.data.proposals.length, 0);

  const corrected = await request(port, '/api/proposals', { method: 'POST', body: { ...proposalPayload(), kind: 'correction', baseRuleId: prediction.ruleId, originalRule: published.rules[0], comment: 'Уточнение после проверки источника', manualIonicFull: 'H^+ + Cl^- + Li^+ + OH^- = Li^+ + Cl^- + H2O', manualIonicNet: 'H^+ + OH^- = H2O' }, cookie: alice.cookie, csrfToken: alice.csrfToken });
  assert.equal(corrected.status, 201, JSON.stringify(corrected.data));
  const correctionApproved = await request(port, `/api/proposals/${corrected.data.proposal.id}/review`, { method: 'POST', body: { action: 'approve' }, cookie: adminLogin.cookie, csrfToken: adminLogin.csrfToken });
  assert.equal(correctionApproved.status, 200, JSON.stringify(correctionApproved.data));
  const revision = JSON.parse(readFileSync(PACKAGE, 'utf8'));
  assert.equal(revision.version, 2);
  assert.equal(revision.rules.length, 1);
  assert.ok(revision.rules[0].contributors.includes('alice'));
  assert.equal(revision.rules[0].ionicOverride.net, 'H^+ + OH^- → H2O');
  updateCommunityData(revision);
  assert.equal(predictReaction('HCl + LiOH').ionicOverride.net, 'H^+ + OH^- → H2O');

  const personal = await request(port, '/api/proposals', { method: 'POST', body: { ...proposalPayload(), sourceType: 'personal', sourceDetails: 'Личное мнение' }, cookie: alice.cookie, csrfToken: alice.csrfToken });
  assert.equal(personal.status, 201);
  const rejected = await request(port, `/api/proposals/${personal.data.proposal.id}/review`, { method: 'POST', body: { action: 'approve' }, cookie: godLogin.cookie, csrfToken: godLogin.csrfToken });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.data.error.code, 'source_required');

  const me = await request(port, '/api/auth/me', { cookie: alice.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.login, 'alice');
  assert.equal(me.data.csrfToken, alice.csrfToken);
  assert.ok(me.data.user.last_login_at);
  const own = await request(port, '/api/proposals?author=me', { cookie: alice.cookie });
  assert.equal(own.status, 200);
  assert.equal(own.data.proposals.length, 3);
  assert.ok(own.data.proposals.every((proposal) => proposal.author_login === 'alice'));
  const alternatives = await request(port, `/api/proposals?status=pending&reactionKey=${encodeURIComponent(corrected.data.proposal.reaction_key)}`);
  assert.equal(alternatives.data.proposals.length, 1);
  assert.equal(alternatives.data.proposals[0].id, personal.data.proposal.id);
  const bobMe = await request(port, '/api/auth/me', { cookie: adminLogin.cookie });
  const restoredProposal = await request(port, '/api/proposals', { method: 'POST', body: { ...proposalPayload(), equation: 'HCl + NaOH = NaCl + H2O', substances: [] }, cookie: adminLogin.cookie, csrfToken: bobMe.data.csrfToken });
  assert.equal(restoredProposal.status, 201, JSON.stringify(restoredProposal.data));
  const selfReview = await request(port, `/api/proposals/${restoredProposal.data.proposal.id}/review`, { method: 'POST', body: { action: 'approve' }, cookie: adminLogin.cookie, csrfToken: bobMe.data.csrfToken });
  assert.equal(selfReview.status, 403);
  assert.equal(selfReview.data.error.code, 'self_review');
  const withdrawn = await request(port, `/api/proposals/${restoredProposal.data.proposal.id}/withdraw`, { method: 'POST', body: {}, cookie: adminLogin.cookie, csrfToken: bobMe.data.csrfToken });
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.data.proposal.status, 'withdrawn');

  const special = await request(port, '/api/proposals', { method: 'POST', body: { ...proposalPayload(), equation: 'H2 + O2 = H2O', specialCase: true, substances: [], manualIonicFull: '', manualIonicNet: '' }, cookie: alice.cookie, csrfToken: me.data.csrfToken });
  assert.equal(special.status, 201, JSON.stringify(special.data));
  assert.equal(special.data.proposal.proposed_rule_json.specialCase, true);
  assert.ok(special.data.proposal.issue_types.includes('balance_engine'));
  const unsafePublish = await request(port, `/api/proposals/${special.data.proposal.id}/review`, { method: 'POST', body: { action: 'approve' }, cookie: godLogin.cookie, csrfToken: godLogin.csrfToken });
  assert.equal(unsafePublish.status, 422);
  assert.equal(unsafePublish.data.error.code, 'invalid_production_rule');
  assert.equal((await request(port, `/api/proposals/${special.data.proposal.id}/withdraw`, { method: 'POST', body: {}, cookie: alice.cookie, csrfToken: me.data.csrfToken })).status, 200);

  const promotedPlus = await request(port, '/api/users/3/role', { method: 'PATCH', body: { privileges: 'admin+' }, cookie: godLogin.cookie, csrfToken: godLogin.csrfToken });
  assert.equal(promotedPlus.status, 200);
  assert.equal(promotedPlus.data.user.privileges, 'admin+');
  const privileged = await request(port, '/api/proposals', { method: 'POST', body: { ...proposalPayload(), equation: '2H2 + O2 = H2O', substances: [] }, cookie: adminLogin.cookie, csrfToken: bobMe.data.csrfToken });
  assert.equal(privileged.status, 201, JSON.stringify(privileged.data));
  const privilegedReview = await request(port, `/api/proposals/${privileged.data.proposal.id}/review`, { method: 'POST', body: { action: 'needs_evidence', note: 'Исправьте коэффициенты' }, cookie: adminLogin.cookie, csrfToken: bobMe.data.csrfToken });
  assert.equal(privilegedReview.status, 403);
  assert.equal(privilegedReview.data.error.code, 'self_review');
  const reviewedByGod = await request(port, `/api/proposals/${privileged.data.proposal.id}/review`, { method: 'POST', body: { action: 'needs_evidence', note: 'Исправьте коэффициенты' }, cookie: godLogin.cookie, csrfToken: godLogin.csrfToken });
  assert.equal(reviewedByGod.status, 200, JSON.stringify(reviewedByGod.data));

  const passwordRecord = app.db.prepare('SELECT password_hash FROM users WHERE login_canonical = ?').get('alice');
  assert.notEqual(passwordRecord.password_hash, 'password123');
  assert.ok(passwordRecord.password_hash.includes(':'));
  const logout = await request(port, '/api/auth/logout', { method: 'POST', body: {}, cookie: alice.cookie, csrfToken: me.data.csrfToken });
  assert.equal(logout.status, 200);
  assert.equal((await request(port, '/api/auth/me', { cookie: alice.cookie })).status, 401);
});
