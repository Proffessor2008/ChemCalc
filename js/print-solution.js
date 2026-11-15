import { balanceEquation, inspectBalance } from './balancer.js';
import { buildIonicEquations } from './ionic.js';
import { equationToUnicode } from './parser.js';
import { t } from './i18n.js';

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
