import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { balanceEquation, inspectBalance } from '../js/balancer.js';
import { buildIonicEquations } from '../js/ionic.js';
import { predictReaction } from '../js/predictor.js';
import { openCommunityDatabase } from '../server/db.mjs';
import { validateProposal } from '../server/validation.mjs';
import { ruleEquation } from '../js/community-ui.js';

const conditions = { medium: 'acidic', solvent: 'aqueous', acidConcentration: 'concentrated', ratio: 'normal', catalyst: '', heating: false, current: false };
const payload = { equation: 'Au + HNO3 + 4HCl = H[AuCl4] + NO + 2H2O', conditions, sourceType: 'glinka', sourceDetails: 'Глинка, Общая химия: царская водка', comment: 'Комплексообразование Au(III)', reactionType: 'ОВР, комплексообразование', substances: [] };

const balancedExamples = [
  ['Перманганат в кислоте', '2KMnO4 + 10FeSO4 + 8H2SO4 = K2SO4 + 2MnSO4 + 5Fe2(SO4)3 + 8H2O'],
  ['Перманганат и сульфит', '2KMnO4 + 5K2SO3 + 3H2SO4 = 2MnSO4 + 6K2SO4 + 3H2O'],
  ['Дихромат и сероводород', 'K2Cr2O7 + 3H2S + 4H2SO4 = Cr2(SO4)3 + 3S + K2SO4 + 7H2O'],
  ['Медь и разбавленная HNO3', '3Cu + 8HNO3 = 3Cu(NO3)2 + 2NO + 4H2O'],
  ['Медь и концентрированная HNO3', 'Cu + 4HNO3 = Cu(NO3)2 + 2NO2 + 2H2O'],
  ['Цинк и разбавленная HNO3', '4Zn + 10HNO3 = 4Zn(NO3)2 + NH4NO3 + 3H2O'],
  ['Хром(III) и пероксид', '2CrCl3 + 3H2O2 + 10KOH = 2K2CrO4 + 6KCl + 8H2O'],
  ['Алюминий в щёлочи', '2Al + 2NaOH + 6H2O = 2Na[Al(OH)4] + 3H2'],
  ['Хлор в холодной щёлочи', 'Cl2 + 2NaOH = NaCl + NaClO + H2O'],
  ['Хлор в горячей щёлочи', '3Cl2 + 6NaOH = 5NaCl + NaClO3 + 3H2O'],
  ['Электролиз раствора NaCl', '2NaCl + 2H2O = 2NaOH + H2 + Cl2'],
  ['Нитрат аммония', '2NH4NO3 = 2N2 + O2 + 4H2O'],
  ['Дихромат аммония', '(NH4)2Cr2O7 = Cr2O3 + N2 + 4H2O'],
  ['Хлорат калия', '2KClO3 = 2KCl + 3O2'],
  ['Пирит', '4FeS2 + 11O2 = 2Fe2O3 + 8SO2'],
  ['Пероксид натрия', '2Na2O2 + 2H2O = 4NaOH + O2'],
  ['Гидролиз PCl5', 'PCl5 + 4H2O = H3PO4 + 5HCl'],
  ['Пентагидрат сульфата меди', 'CuSO4·5H2O = CuSO4 + 5H2O']
];
for (const [name, equation] of balancedExamples) test(`Расширенный баланс: ${name}`, () => assert.equal(inspectBalance(equation).isBalanced, true, equation));

test('Au: две воды корректны, три воды нарушают H и O', () => {
  const correct = inspectBalance(payload.equation);
  assert.equal(correct.isBalanced, true);
  assert.deepEqual(correct.coefficients, [1, 1, 4, 1, 1, 2]);
  const wrong = inspectBalance(payload.equation.replace('2H2O', '3H2O'));
  assert.equal(wrong.isBalanced, false);
  assert.deepEqual(wrong.atomRows.filter((row) => !row.balanced).map(({ symbol, left, right }) => ({ symbol, left, right })), [{ symbol: 'H', left: 5, right: 7 }, { symbol: 'O', left: 3, right: 4 }]);
  const solution = balanceEquation('Au + HNO3 + HCl = H[AuCl4] + NO + H2O');
  assert.equal(solution.status, 'balanced');
  assert.deepEqual(solution.coefficients, [1, 1, 4, 1, 1, 2]);
  assert.equal(predictReaction('Au + HNO3 + HCl', conditions).formatted, 'Au + HNO3 + 4HCl → H[AuCl4] + NO↑ + 2H2O');
});

test('Au: H[AuCl4] диссоциирует, H+ сокращается, нейтральные Au/NO/H2O сохраняются', () => {
  const ionic = buildIonicEquations(payload.equation);
  assert.equal(ionic.fullUnicode, 'Au + H⁺ + NO₃⁻ + 4H⁺ + 4Cl⁻ → H⁺ + [AuCl₄]⁻ + NO + 2H₂O');
  assert.equal(ionic.netUnicode, 'Au + 4H⁺ + NO₃⁻ + 4Cl⁻ → [AuCl₄]⁻ + NO + 2H₂O');
  assert.deepEqual(ionic.spectators, [{ formula: 'H^+', coefficient: 1 }]);
  assert.equal(inspectBalance('Au + 4H+ + NO3^- + 4Cl^- = [AuCl4]^- + NO + 3H2O').isBalanced, false);
});

test('частный случай и admin+/GOD допускают разбор, но обычные роли требуют баланс', () => {
  const unbalanced = payload.equation.replace('2H2O', '3H2O');
  assert.throws(() => validateProposal({ ...payload, equation: unbalanced }), { code: 'unbalanced' });
  assert.throws(() => validateProposal({ ...payload, equation: unbalanced }, { privileges: 'admin' }), { code: 'unbalanced' });
  for (const privileges of ['admin+', 'GOD']) {
    const result = validateProposal({ ...payload, equation: unbalanced }, { privileges });
    assert.ok(result.proposedRule.issueTypes.includes('balance_engine'));
    assert.ok(result.warnings.some((warning) => warning.includes('до публикации')));
  }
  const special = validateProposal({ ...payload, equation: unbalanced, specialCase: true });
  assert.equal(special.proposedRule.specialCase, true);
  assert.ok(special.issueTypes.includes('balance_engine'));
});

test('ручные ионные поля необязательны, а заполненные значения проверяются', () => {
  const blank = validateProposal({ ...payload, manualIonicFull: '', manualIonicNet: '' });
  assert.equal(blank.proposedRule.ionicOverride, undefined);
  const full = 'Au + H^+ + NO3^- + 4H^+ + 4Cl^- = H^+ + [AuCl4]^- + NO + 2H2O';
  const net = 'Au + 4H+ + NO3^- + 4Cl^- = [AuCl4]^- + NO + 2H2O';
  const manual = validateProposal({ ...payload, manualIonicFull: full, manualIonicNet: net });
  assert.equal(manual.proposedRule.ionicOverride.full, full.replace(' = ', ' → '));
  assert.equal(manual.proposedRule.ionicOverride.net, net.replaceAll('H+', 'H^+').replace(' = ', ' → '));
  assert.throws(() => validateProposal({ ...payload, manualIonicNet: net.replace('2H2O', '3H2O') }), { code: 'invalid_ionic' });
  const special = validateProposal({ ...payload, specialCase: true, manualIonicNet: net.replace('2H2O', '3H2O') });
  assert.ok(special.warnings.some((warning) => warning.includes('ионное')));
  assert.equal(validateProposal({ ...payload, substances: [{ formula: 'Au', name_ru: 'Золото', class: 'metal', solubility: '—', strong: false, ions: [] }] }).proposedRule.substances[0].ions.length, 0);
});

test('миграция добавляет admin+ и сохраняет пользователей и сессии', () => {
  const path = `var/test-migration-${process.pid}.db`;
  mkdirSync('var', { recursive: true });
  let raw;
  let migrated;
  try {
    raw = new DatabaseSync(path);
    raw.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, login TEXT NOT NULL, login_canonical TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, privileges TEXT NOT NULL CHECK(privileges IN ('basic','admin','GOD')), created_at TEXT NOT NULL, last_login_at TEXT);
      CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, csrf_token TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
      INSERT INTO users VALUES(1,'creator','creator','hash','GOD','2026-01-01',NULL);
      INSERT INTO sessions VALUES('token',1,'csrf','2026-01-01','2030-01-01','2026-01-01');`);
    raw.close();
    raw = null;
    migrated = openCommunityDatabase(path);
    assert.equal(migrated.prepare('UPDATE users SET privileges = ? WHERE id = 1').run('admin+').changes, 1);
    assert.equal(migrated.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
    assert.equal(migrated.prepare('SELECT user_id FROM sessions WHERE token_hash = ?').get('token').user_id, 1);
    assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    raw?.close();
    migrated?.close();
    for (const suffix of ['', '-shm', '-wal']) rmSync(`${path}${suffix}`, { force: true });
    if (readdirSync('var').length === 0) rmdirSync('var');
  }
});

test('карточка заявки сохраняет коэффициенты продуктов при отображении', () => {
  const rule = validateProposal({ ...payload, equation: payload.equation.replace('2H2O', '3H2O'), specialCase: true }).proposedRule;
  assert.equal(ruleEquation(rule), 'Au + HNO₃ + 4HCl → H[AuCl₄] + NO + 3H₂O');
});
