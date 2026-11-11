import { balanceEquation, inspectBalance } from './balancer.js';
import { buildIonicEquations } from './ionic.js';
import { equationToUnicode } from './parser.js';
import { getLocale, t } from './i18n.js';

function addText(parent, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text || '—';
  parent.append(node);
  return node;
}

export function buildPrintModel({ equation, conditions = {}, type = '', source = '', explanation = [], ionic = null }) {
  if (!equation) throw new TypeError('Для печати нужно рассчитанное уравнение');
  const balance = inspectBalance(equation);
  const solution = balanceEquation(equation);
  const ionicResult = ionic || (balance.isBalanced ? buildIonicEquations(equation, { solvent: conditions.solvent }) : null);
  const conditionText = [t(conditions.medium || 'neutral'), t(conditions.solvent || 'aqueous'), conditions.acidConcentration && conditions.acidConcentration !== 'unspecified' ? t(conditions.acidConcentration) : '', conditions.catalyst ? `${t('catalyst')}: ${conditions.catalyst}` : '', conditions.heating ? t('heating') : '', conditions.current ? t('electricCurrent') : '', conditions.ratio === 'deficit' ? t('deficitRatio') : ''].filter(Boolean).join(' · ');
  const steps = [
    `${t('printEquationInput')}: ${equationToUnicode(equation)}`,
    `${t('printBalanceMethod')}: ${solution.status === 'balanced' ? solution.coefficients.join(', ') : solution.message}`
  ];
  for (const row of balance.atomRows) steps.push(`${row.symbol}: ${row.left} = ${row.right}${row.balanced ? ' ✓' : ` (${t('mismatched')})`}`);
  steps.push(`${t('charge')}: ${balance.charge.left} = ${balance.charge.right}${balance.charge.balanced ? ' ✓' : ` (${t('mismatched')})`}`);
  return {
    title: 'ChemCalc',
    equation: equationToUnicode(equation),
    conditions: conditionText,
    type,
    source,
    explanation: [...explanation],
    steps,
    ionic: ionicResult ? { full: ionicResult.fullUnicode || ionicResult.full || '', net: ionicResult.netUnicode || ionicResult.net || '', message: ionicResult.message || '' } : null
  };
}

export function printSolution(input) {
  const model = buildPrintModel(input);
  const host = document.querySelector('#print-solution');
  host.replaceChildren();
  addText(host, 'h1', '', model.title);
  addText(host, 'p', 'print-date', new Intl.DateTimeFormat(getLocale(), { dateStyle: 'long', timeStyle: 'short' }).format(new Date()));
  addText(host, 'h2', '', t('printSolution'));
  addText(host, 'p', 'print-equation', model.equation);
  addText(host, 'p', '', `${t('conditions')}: ${model.conditions}`);
  if (model.type) addText(host, 'p', '', `${t('reactionTypeLabel')}: ${model.type}`);
  addText(host, 'p', '', `${t('source')}: ${model.source || '—'}`);
  if (model.explanation.length) {
    addText(host, 'h2', '', t('why'));
    const reasons = document.createElement('ul');
    for (const reason of model.explanation) addText(reasons, 'li', '', reason);
    host.append(reasons);
  }
  addText(host, 'h2', '', t('solution'));
  const steps = document.createElement('ol');
  for (const step of model.steps) addText(steps, 'li', '', step);
  host.append(steps);
  if (model.ionic) {
    addText(host, 'h2', '', t('ionicEquations'));
    addText(host, 'p', '', `${t('fullIonic')}: ${model.ionic.full || model.ionic.message || '—'}`);
    addText(host, 'p', '', `${t('netIonic')}: ${model.ionic.net || '—'}`);
  }
  window.print();
  return model;
}
