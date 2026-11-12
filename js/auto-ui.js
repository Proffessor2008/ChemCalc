import { inspectBalance } from './balancer.js';
import { t } from './i18n.js';
import { buildIonicEquations } from './ionic.js';
import { copyText } from './clipboard.js';
import { equationToLatex } from './export.js';
import { equationToUnicode, formatEquation, formulaToUnicode, parseEquation, parseSide } from './parser.js';
import { DEFAULT_CONDITIONS, predictReaction } from './predictor.js';
import { renderThermoPanel } from './thermo-panel.js';

const CONDITION_KEY = 'chemcalc-auto-conditions-v2';
const $ = (selector) => document.querySelector(selector);

export function initAutoUI({ storage, saveState, showToast, onHistory, onOpenCheck, onStoich, onPropose, onAlternatives }) {
  const input = $('#auto-input');
  let result = null;
  let currentEquation = null;
  let ruleCoefficients = null;

  function getConditions() {
    return {
      medium: $('#auto-medium').value,
      acidConcentration: $('#auto-concentration').value,
      solvent: $('#auto-solvent').value,
      ratio: $('#auto-ratio').value,
      catalyst: $('#auto-catalyst').value,
      heating: $('#auto-heating').checked,
      current: $('#auto-current').checked
    };
  }

  function setConditions(conditions = {}) {
    const values = { ...DEFAULT_CONDITIONS, ...conditions };
    $('#auto-medium').value = values.medium;
    $('#auto-concentration').value = values.acidConcentration;
    $('#auto-solvent').value = values.solvent;
    $('#auto-ratio').value = values.ratio;
    $('#auto-catalyst').value = values.catalyst;
    $('#auto-heating').checked = Boolean(values.heating);
    $('#auto-current').checked = Boolean(values.current);
  }

  function saveConditions() {
    storage.setItem(CONDITION_KEY, JSON.stringify(getConditions()));
    saveState();
  }

  function validateInput() {
    const value = input.value.trim();
    const hint = $('#auto-input-hint');
    input.removeAttribute('aria-invalid');
    if (!value) {
      hint.textContent = '';
      return;
    }
    if (/(?:->|→|⇄|↔|=)/.test(value)) {
      hint.textContent = t('inputEquationHint');
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    try {
      const species = parseSide(value);
      hint.textContent = t('inputValid', { count: species.length });
    } catch (error) {
      hint.textContent = error.message;
      input.setAttribute('aria-invalid', 'true');
    }
  }

  function setList(selector, items) {
    const list = $(selector);
    list.replaceChildren();
    for (const text of items || []) {
      const item = document.createElement('li');
      item.textContent = text;
      list.append(item);
    }
  }

  function renderIonic() {
    const panel = $('#auto-ionic');
    if (!currentEquation || !inspectBalance(currentEquation).isBalanced) {
      panel.hidden = true;
      $('#auto-thermo-panel').hidden = true;
      $('#auto-dissociation-wrap').hidden = true;
      return;
    }
    renderThermoPanel('#auto-thermo-panel', currentEquation, { solvent: getConditions().solvent });
    const ionic = buildIonicEquations(currentEquation, { solvent: getConditions().solvent });
    const override = result?.formatted === formatEquation(currentEquation) ? result.ionicOverride : null;
    panel.hidden = false;
    $('#auto-ionic-full').textContent = override?.full ? equationToUnicode(parseEquation(override.full)) : ionic.fullUnicode || ionic.message;
    $('#auto-ionic-net').textContent = override?.net ? equationToUnicode(parseEquation(override.net)) : ionic.netUnicode || '—';
    $('#auto-ionic-notes').textContent = override ? t('manualIonicApproved') : [...(ionic.notes || []), ionic.message].filter(Boolean).join(' ');
    const dissociation = $('#auto-dissociation');
    dissociation.replaceChildren();
    for (const step of ionic.dissociation || []) {
      const item = document.createElement('li');
      item.textContent = `${step.equation}${step.Ka == null ? '' : `; Ka = ${step.Ka.toExponential(2)} (pKa = ${step.pKa})`}`;
      dissociation.append(item);
    }
    $('#auto-dissociation-wrap').hidden = !(ionic.dissociation || []).length;
  }

  function renderCoefficients() {
    const container = $('#auto-coefficients');
    container.replaceChildren();
    if (!currentEquation) return;
    const species = [...currentEquation.left, ...currentEquation.right];
    species.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'auto-coefficient-row';
      const label = document.createElement('label');
      label.textContent = formulaToUnicode(item);
      const stepper = document.createElement('div');
      stepper.className = 'stepper';
      const minus = document.createElement('button');
      minus.type = 'button';
      minus.dataset.autoStep = '-1';
      minus.dataset.index = String(index);
      minus.textContent = '−';
      minus.setAttribute('aria-label', `Уменьшить коэффициент ${item.formula}`);
      const number = document.createElement('input');
      number.type = 'number';
      number.min = '1';
      number.step = '1';
      number.value = String(item.coefficient);
      number.dataset.autoCoefficient = String(index);
      number.setAttribute('aria-label', `Коэффициент ${item.formula}`);
      const plus = document.createElement('button');
      plus.type = 'button';
      plus.dataset.autoStep = '1';
      plus.dataset.index = String(index);
      plus.textContent = '+';
      plus.setAttribute('aria-label', `Увеличить коэффициент ${item.formula}`);
      stepper.append(minus, number, plus);
      row.append(label, stepper);
      container.append(row);
    });
    const inspection = inspectBalance(currentEquation);
    $('#auto-balance-status').textContent = inspection.isBalanced ? t('balanceOk') : t('balanceBad');
    $('#auto-balance-status').className = inspection.isBalanced ? 'help-text balance-ok' : 'help-text balance-bad';
    $('#auto-equation').textContent = equationToUnicode(currentEquation);
    renderIonic();
  }

  function updateCoefficients(values) {
    if (!currentEquation) return;
    currentEquation.left.forEach((item, index) => { item.coefficient = values[index]; });
    currentEquation.right.forEach((item, index) => { item.coefficient = values[currentEquation.left.length + index]; });
    renderCoefficients();
  }

  function renderAlternatives(variants = []) {
    const container = $('#auto-alternatives');
    container.replaceChildren();
    for (const variant of variants) {
      if (variant.status !== 'predicted') continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'alternative-card';
      button.dataset.concentration = variant.conditions.acidConcentration;
      const condition = document.createElement('strong');
      condition.textContent = t(variant.conditions.acidConcentration === 'dilute' ? 'diluteCondition' : 'concentratedCondition');
      const equation = document.createElement('span');
      equation.textContent = equationToUnicode(variant.equation, variant.coefficients);
      button.append(condition, equation);
      container.append(button);
    }
  }

  function renderSuggestions(suggestions = []) {
    const container = $('#auto-alternatives');
    container.replaceChildren();
    suggestions.forEach((suggestion, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'alternative-card';
      button.dataset.suggestion = String(index);
      const title = document.createElement('strong');
      title.textContent = t('similarExample');
      const equation = document.createElement('span');
      equation.textContent = suggestion.reactants;
      const hint = document.createElement('small');
      hint.textContent = suggestion.hint;
      button.append(title, equation, hint);
      container.append(button);
    });
  }

  function render(nextResult) {
    result = nextResult;
    currentEquation = null;
    ruleCoefficients = null;
    $('#auto-empty').hidden = true;
    $('#auto-result').hidden = false;
    $('#auto-solution').hidden = true;
    $('#auto-coefficients-wrap').hidden = true;
    $('#auto-ionic').hidden = true;
    $('#auto-thermo-panel').hidden = true;
    $('#auto-alternatives').replaceChildren();
    $('#auto-equation').textContent = '';
    $('#auto-type').textContent = '';
    $('#auto-notice').textContent = '';
    const statusClass = {
      predicted: result.confidence === 'high' ? 'correct' : 'nonminimal',
      'no-reaction': 'product-warning',
      'no-rule': 'partial',
      ambiguous: 'partial',
      'needs-conditions': 'partial',
      'check-required': 'partial',
      'syntax-error': 'syntax-error',
      'balance-error': 'syntax-error'
    }[result.status] || 'partial';
    $('#auto-status').className = `verdict ${statusClass}`;
    $('#auto-status-icon').textContent = result.status === 'predicted' ? '✓' : result.status === 'no-reaction' ? '⊘' : result.status === 'syntax-error' ? '×' : '?';
    const titleKeys = { 'no-reaction': 'noReaction', 'no-rule': 'noRule', ambiguous: 'ambiguous', 'needs-conditions': 'needsConditions', 'check-required': 'openCheck', 'syntax-error': 'statusSyntax', 'balance-error': 'statusNotBalanced' };
    $('#auto-status-title').textContent = result.status === 'predicted' ? t('predicted') : t(titleKeys[result.status]);
    $('#auto-status-message').textContent = result.message || '';
    const confidenceKey = result.confidence === 'high' ? 'highConfidence' : result.confidence === 'medium' ? 'mediumConfidence' : 'lowConfidence';
    $('#auto-confidence').textContent = `${result.confidence === 'high' ? '●' : result.confidence === 'medium' ? '◐' : '○'} ${t(confidenceKey)}`;
    $('#auto-confidence').className = `confidence confidence-${result.confidence || 'low'}`;
    $('#auto-copy').hidden = true;
    $('#auto-latex').hidden = true;
    $('#auto-share').hidden = true;
    $('#auto-print').hidden = true;
    $('#auto-to-check').hidden = true;
    $('#auto-to-stoich').hidden = true;
    $('#auto-community-feedback').hidden = ['syntax-error', 'balance-error', 'check-required'].includes(result.status);
    $('#auto-proposal-button').hidden = result.status !== 'no-rule';
    $('#auto-correction-button').hidden = !['predicted', 'no-reaction'].includes(result.status);
    if (['predicted', 'no-reaction', 'no-rule'].includes(result.status)) onAlternatives?.($('#auto-community-alternatives'), { reactants: input.value.trim(), conditions: getConditions() });
    else $('#auto-community-alternatives').replaceChildren();
    if (result.status === 'no-rule') {
      renderSuggestions(result.suggestions);
      $('#auto-to-check').hidden = false;
      return;
    }
    if (result.status === 'ambiguous') {
      renderAlternatives(result.variants);
      return;
    }
    if (result.status !== 'predicted') return;
    currentEquation = result.equation;
    ruleCoefficients = [...result.coefficients];
    currentEquation.left.forEach((item, index) => { item.coefficient = result.coefficients[index]; });
    currentEquation.right.forEach((item, index) => { item.coefficient = result.coefficients[currentEquation.left.length + index]; });
    $('#auto-equation').textContent = equationToUnicode(currentEquation);
    $('#auto-type').textContent = t('reactionType', { type: result.type });
    $('#auto-notice').textContent = result.notice;
    $('#auto-solution').hidden = false;
    setList('#auto-why', result.why);
    setList('#auto-assumptions', result.assumptions);
    $('#auto-source').textContent = t('ruleSource', { source: result.source });
    $('#auto-coefficients-wrap').hidden = false;
    $('#auto-copy').hidden = false;
    $('#auto-latex').hidden = false;
    $('#auto-share').hidden = false;
    $('#auto-print').hidden = false;
    $('#auto-to-check').hidden = false;
    $('#auto-to-stoich').hidden = false;
    renderCoefficients();
  }

  function run(addToHistory = true) {
    const conditions = getConditions();
    const nextResult = predictReaction(input.value.trim(), conditions);
    render(nextResult);
    saveConditions();
    if (nextResult.status === 'predicted' && addToHistory) {
      onHistory({ equation: nextResult.formatted, mode: 'auto', conditions });
    }
    return nextResult;
  }

  $('#auto-form').addEventListener('submit', (event) => {
    event.preventDefault();
    run();
  });
  input.addEventListener('input', () => {
    validateInput();
    result = null;
    currentEquation = null;
    $('#auto-result').hidden = true;
    $('#auto-empty').hidden = false;
    $('#auto-community-feedback').hidden = true;
    $('#auto-community-alternatives').replaceChildren();
  });
  $('#auto-proposal-button').addEventListener('click', () => onPropose?.(false));
  $('#auto-correction-button').addEventListener('click', () => onPropose?.(true));
  $$autoConditions().forEach((control) => control.addEventListener('change', () => {
    saveConditions();
    if (result) run(false);
  }));
  $$autoExamples().forEach((button) => button.addEventListener('click', () => {
    input.value = button.dataset.autoExample;
    const conditions = getConditions();
    if (button.dataset.medium) conditions.medium = button.dataset.medium;
    if (button.dataset.current) conditions.current = true;
    if (button.dataset.solvent) conditions.solvent = button.dataset.solvent;
    setConditions(conditions);
    run();
  }));
  $('#auto-alternatives').addEventListener('click', (event) => {
    const suggestionButton = event.target.closest('[data-suggestion]');
    if (suggestionButton) {
      const suggestion = result?.suggestions?.[Number(suggestionButton.dataset.suggestion)];
      if (!suggestion) return;
      input.value = suggestion.reactants;
      setConditions({ ...getConditions(), ...suggestion.conditions });
      run();
      return;
    }
    const button = event.target.closest('[data-concentration]');
    if (!button) return;
    $('#auto-concentration').value = button.dataset.concentration;
    run();
  });
  $('#auto-coefficients').addEventListener('click', (event) => {
    const button = event.target.closest('[data-auto-step]');
    if (!button || !currentEquation) return;
    const values = [...currentEquation.left, ...currentEquation.right].map((item) => item.coefficient);
    const index = Number(button.dataset.index);
    values[index] = Math.max(1, values[index] + Number(button.dataset.autoStep));
    updateCoefficients(values);
  });
  $('#auto-coefficients').addEventListener('change', (event) => {
    if (!event.target.matches('[data-auto-coefficient]') || !currentEquation) return;
    const value = Number(event.target.value);
    if (!Number.isSafeInteger(value) || value < 1) {
      showToast(t('coefficientError'));
      renderCoefficients();
      return;
    }
    const values = [...currentEquation.left, ...currentEquation.right].map((item) => item.coefficient);
    values[Number(event.target.dataset.autoCoefficient)] = value;
    updateCoefficients(values);
  });
  $('#auto-reset-coefficients').addEventListener('click', () => {
    if (ruleCoefficients) updateCoefficients([...ruleCoefficients]);
  });
  async function copyWithFeedback(button, text, successMessage) {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = t('copying');
    try {
      await copyText(text);
      showToast(successMessage);
    } catch {
      showToast(t('copyError'));
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  $('#auto-copy').addEventListener('click', () => {
    if (currentEquation) copyWithFeedback($('#auto-copy'), equationToUnicode(currentEquation), t('copiedEquation'));
  });
  $('#auto-latex').addEventListener('click', () => {
    if (currentEquation) copyWithFeedback($('#auto-latex'), equationToLatex(currentEquation), t('copiedLatex'));
  });
  $('#auto-share').addEventListener('click', async () => {
    if (!currentEquation) return;
    const url = new URL(window.location.href);
    const params = new URLSearchParams({ mode: 'auto', reactants: input.value.trim() });
    for (const [key, value] of Object.entries(getConditions())) params.set(key, String(value));
    url.hash = params.toString();
    try {
      await copyText(url.toString());
      showToast(t('linked'));
    } catch { showToast(t('copyError')); }
  });
  $('#auto-to-check').addEventListener('click', () => {
    if (currentEquation) onOpenCheck(formatEquation(currentEquation));
    else if (result?.status === 'no-rule') onOpenCheck(`${input.value.trim()} = `);
  });
  $('#auto-to-stoich').addEventListener('click', () => {
    if (currentEquation) onStoich(formatEquation(currentEquation));
  });
  $('#auto-print').addEventListener('click', async () => {
    if (!currentEquation) return;
    try {
      const { printSolution } = await import('./print-solution.js');
      const ionicOverride = result?.formatted === formatEquation(currentEquation) ? result.ionicOverride : null;
      printSolution({
        equation: currentEquation,
        conditions: getConditions(),
        type: result.type,
        source: result.source,
        explanation: [...(result.why || []), ...(result.assumptions || [])],
        ionic: ionicOverride || buildIonicEquations(currentEquation, { solvent: getConditions().solvent })
      });
    } catch {
      showToast(t('serverUnavailable'));
    }
  });

  try {
    const savedConditions = JSON.parse(storage.getItem(CONDITION_KEY) || '{}');
    setConditions(savedConditions);
  } catch { setConditions(); }
  validateInput();

  return {
    run,
    setConditions,
    getConditions,
    getResult: () => result,
    getCurrentEquation: () => currentEquation,
    setEquation(value) { input.value = value; },
    readShared() {
      const params = new URLSearchParams(window.location.hash.slice(1));
      if (params.get('mode') !== 'auto' || !params.get('reactants')) return null;
      const conditions = {};
      for (const key of Object.keys(DEFAULT_CONDITIONS)) {
        if (!params.has(key)) continue;
        const value = params.get(key);
        conditions[key] = typeof DEFAULT_CONDITIONS[key] === 'boolean' ? value === 'true' : value;
      }
      return { reactants: params.get('reactants'), conditions };
    }
  };
}

function $$autoConditions() {
  return [...document.querySelectorAll('#auto-medium, #auto-concentration, #auto-solvent, #auto-ratio, #auto-catalyst, #auto-heating, #auto-current')];
}

function $$autoExamples() {
  return [...document.querySelectorAll('[data-auto-example]')];
}
