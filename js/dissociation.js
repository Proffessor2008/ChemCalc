import acidBaseData from '../data/acid-base-constants.json' with { type: 'json' };
import { inspectBalance } from './balancer.js';
import { equationToUnicode, parseEquation } from './parser.js';

function makeStep(from, conjugate, record, strong = false) {
  const source = `${from} ${strong || record.strength === 'strong' ? '→' : '⇄'} H^+ + ${conjugate}`;
  const equation = parseEquation(source);
  if (!inspectBalance(equation).isBalanced) throw new RangeError(`Ошибка ступени диссоциации: ${source}`);
  return {
    from,
    to: conjugate,
    equation: equationToUnicode(equation),
    pKa: record.pKa ?? null,
    Ka: record.pKa == null ? null : 10 ** -record.pKa,
    strength: strong ? 'strong' : record.strength,
    source: record.source
  };
}

export function acidDissociationSteps(formula) {
  if (formula === 'H2SO4') {
    const first = { strength: 'strong', pKa: null, source: 'Школьное приближение: первая ступень H2SO4 полная' };
    return [
      makeStep('H2SO4', 'HSO4^-', first, true),
      ...acidDissociationSteps('HSO4^-')
    ];
  }
  const steps = [];
  let current = formula;
  const visited = new Set();
  while (!visited.has(current)) {
    visited.add(current);
    const record = acidBaseData.records.find((item) => item.formula === current && item.type === 'acid');
    if (!record) break;
    steps.push(makeStep(current, record.conjugate, record));
    current = record.conjugate;
  }
  return steps;
}

export function equationDissociationSteps(equation) {
  const formulas = [...new Set([...equation.left, ...equation.right].map((species) => species.formula))];
  return formulas.flatMap((formula) => acidDissociationSteps(formula));
}
