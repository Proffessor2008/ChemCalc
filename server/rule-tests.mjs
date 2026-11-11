import { buildIonicEquations } from '../js/ionic.js';
import { formatEquation, parseSpecies } from '../js/parser.js';
import { predictReaction, updateCommunityData } from '../js/predictor.js';

export function regressionTestForRule(rule) {
  const reactants = rule.reactants || rule.left || [];
  const equation = {
    left: reactants.map((formula, index) => ({ ...parseSpecies(formula), coefficient: rule.coefficients?.[index] || rule.inputCoefficients?.[index] || 1 })),
    right: (rule.products || []).map((formula, index) => ({ ...parseSpecies(formula), coefficient: rule.coefficients?.[reactants.length + index] || 1 })),
    separator: rule.separator || '→'
  };
  const expected = { status: rule.outcome === 'no-reaction' ? 'no-reaction' : 'predicted' };
  if (expected.status === 'predicted') {
    expected.formatted = formatEquation(equation);
    expected.ionicNet = rule.ionicOverride?.net || buildIonicEquations(equation, { solvent: rule.when?.solvent || 'aqueous' }).netUnicode || null;
  }
  return {
    id: `regression-${rule.id}`,
    ruleId: rule.id,
    reactants: reactants.join(' + '),
    conditions: { ...(rule.when || {}) },
    expected
  };
}

export function regressionTestsForPackage(packageData) {
  updateCommunityData(packageData);
  return packageData.rules.map(regressionTestForRule);
}

export function validateRegressionTests(packageData) {
  const errors = [];
  updateCommunityData(packageData);
  for (const test of packageData.tests || []) {
    try {
      const result = predictReaction(test.reactants, test.conditions);
      if (result.status !== test.expected.status) errors.push(`${test.id}: статус ${result.status} вместо ${test.expected.status}`);
      if (result.ruleId !== test.ruleId) errors.push(`${test.id}: выбрано правило ${result.ruleId || '—'} вместо ${test.ruleId}`);
      if (test.expected.formatted && result.formatted !== test.expected.formatted) errors.push(`${test.id}: ${result.formatted || '—'} вместо ${test.expected.formatted}`);
      if (test.expected.ionicNet) {
        const actual = result.ionicOverride?.net || buildIonicEquations(result.formatted, { solvent: test.conditions.solvent }).netUnicode;
        if (actual !== test.expected.ionicNet) errors.push(`${test.id}: ионный результат ${actual || '—'} вместо ${test.expected.ionicNet}`);
      }
    } catch (error) {
      errors.push(`${test.id}: ${error.message}`);
    }
  }
  return errors;
}
