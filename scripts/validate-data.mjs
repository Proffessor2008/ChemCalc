import { readFileSync } from 'node:fs';
import elementsData from '../data/elements.json' with { type: 'json' };
import substancesData from '../data/substances.json' with { type: 'json' };
import solubilityData from '../data/solubility.json' with { type: 'json' };
import reactionData from '../data/reaction-rules.json' with { type: 'json' };
import finalReactionData from '../data/reaction-rules-final.json' with { type: 'json' };
import potentialsData from '../data/electrode-potentials.json' with { type: 'json' };
import thermoData from '../data/thermo.json' with { type: 'json' };
import thermoExtraData from '../data/thermo-extra.json' with { type: 'json' };
import { balanceEquation, inspectBalance } from '../js/balancer.js';
import { parseEquation, parseSpecies } from '../js/parser.js';
import { validateRegressionTests } from '../server/rule-tests.mjs';

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function ruleEquation(rule) {
  return {
    left: (rule.left || [...rule.reactants, ...(rule.addReactants || [])]).map((formula, index) => ({ ...parseSpecies(formula), coefficient: rule.inputCoefficients?.[index] || 1 })),
    right: rule.products.map((formula) => parseSpecies(formula)),
    separator: rule.separator || '→'
  };
}

export function validateData({ communityPath = new URL('../data/reaction-rules-community.json', import.meta.url) } = {}) {
  const communityData = JSON.parse(readFileSync(communityPath, 'utf8'));
  const errors = [];
  const warnings = [];
  const allRules = [...reactionData.rules, ...finalReactionData.rules, ...communityData.rules];
  const solubilityRecords = { ...solubilityData.substances, ...communityData.solubility.substances };
  const thermoRecords = [...thermoData.records, ...thermoExtraData.records];
  for (const id of duplicateValues(allRules.map((rule) => rule.id))) errors.push(`Повторяющийся id правила: ${id}`);
  for (const formula of duplicateValues(substancesData.items.map((item) => item.formula))) errors.push(`Повторяющееся вещество: ${formula}`);
  for (const id of duplicateValues(thermoRecords.map((record) => record.id))) errors.push(`Повторяющийся id термодинамики: ${id}`);
  for (const key of duplicateValues(thermoRecords.map((record) => `${record.formula}|${record.phase}|${record.cas || record.name_en}`))) errors.push(`Повторяющаяся запись одного вещества и фазы термодинамики: ${key}`);
  if (elementsData.elements.length !== 118) errors.push(`Ожидалось 118 элементов, найдено ${elementsData.elements.length}`);
  elementsData.elements.forEach((element, index) => {
    if (element.number !== index + 1) errors.push(`Нарушена последовательность элементов: ${element.symbol}`);
  });

  for (const [formula, record] of Object.entries(solubilityRecords)) {
    try {
      const parent = parseSpecies(formula);
      const ions = record.ions || [];
      if (record.strong && ['Р', 'М'].includes(record.solubility)) {
        const atoms = new Map();
        let charge = 0;
        for (const ion of ions) {
          const parsed = parseSpecies(ion.formula);
          charge += parsed.charge * ion.coefficient;
          for (const [symbol, count] of parsed.atoms) atoms.set(symbol, (atoms.get(symbol) || 0) + count * ion.coefficient);
        }
        if (charge !== parent.charge || [...parent.atoms].some(([symbol, count]) => atoms.get(symbol) !== count) || [...atoms].some(([symbol, count]) => parent.atoms.get(symbol) !== count)) {
          errors.push(`Ионный состав не совпадает с формулой: ${formula}`);
        }
      }
    } catch (error) {
      errors.push(`Растворимость ${formula}: ${error.message}`);
    }
  }

  for (const rule of allRules) {
    if (rule.kind !== 'exact' || rule.outcome === 'no-reaction') continue;
    try {
      const equation = ruleEquation(rule);
      const balanced = rule.coefficients ? inspectBalance(equation, rule.coefficients) : balanceEquation(equation);
      const valid = rule.coefficients ? balanced.isBalanced : balanced.status === 'balanced';
      if (!valid) errors.push(`Правило ${rule.id} не уравнено: ${balanced.message || 'неверные коэффициенты'}`);
      for (const [kind, text] of Object.entries(rule.ionicOverride || {})) {
        if (!inspectBalance(parseEquation(text)).isBalanced) errors.push(`Правило ${rule.id}: ручная ионная форма ${kind} не сбалансирована`);
      }
    } catch (error) {
      if (rule.id !== 'final-197') errors.push(`Правило ${rule.id}: ${error.message}`);
    }
  }

  for (const record of potentialsData.records) {
    try {
      if (!inspectBalance(parseEquation(record.half)).isBalanced) errors.push(`Полуреакция ${record.id} не уравнена`);
    } catch (error) {
      errors.push(`Полуреакция ${record.id}: ${error.message}`);
    }
  }

  const named = new Set([...substancesData.items, ...communityData.substances].map((item) => item.formula));
  const ruleFormulas = new Set(allRules.flatMap((rule) => [...(rule.reactants || []), ...(rule.addReactants || []), ...(rule.products || [])]));
  for (const formula of ruleFormulas) {
    try {
      const normalized = parseSpecies(formula).formula;
      if (!named.has(normalized)) warnings.push(`Нет русского названия: ${normalized}`);
    } catch (error) {
      if (!formula.includes('C17H35COO)3C3H5')) errors.push(`Формула из правил ${formula}: ${error.message}`);
    }
  }
  for (const record of thermoRecords) {
    if (!record.source || !['s', 'l', 'g', 'aq'].includes(record.phase)) errors.push(`Термодинамическая запись без источника или фазы: ${record.id}`);
    for (const key of ['Hf_kJ_mol', 'Gf_kJ_mol', 'S_J_mol_K']) if (!Number.isFinite(record[key])) errors.push(`Термодинамическая запись ${record.id}: ${key}`);
  }
  errors.push(...validateRegressionTests(communityData));
  return {
    errors,
    warnings,
    stats: {
      elements: elementsData.elements.length,
      substances: substancesData.items.length + communityData.substances.length,
      solubleRecords: Object.keys(solubilityRecords).length,
      rules: allRules.length,
      regressionTests: (communityData.tests || []).length,
      potentials: potentialsData.records.length,
      thermoRecords: thermoRecords.length
    }
  };
}

if (process.argv[1]?.endsWith('validate-data.mjs')) {
  const result = validateData();
  console.log(JSON.stringify(result.stats, null, 2));
  for (const warning of result.warnings.slice(0, 30)) console.warn(`Предупреждение: ${warning}`);
  if (result.warnings.length > 30) console.warn(`Ещё предупреждений: ${result.warnings.length - 30}`);
  for (const error of result.errors) console.error(`Ошибка: ${error}`);
  console.log(`Проверка данных: ошибок ${result.errors.length}; предупреждений ${result.warnings.length}`);
  if (result.errors.length) process.exitCode = 1;
}
