import { initAutoUI } from './auto-ui.js';
import { initCommunityUI } from './community-ui.js';
import { balanceEquation, inspectBalance } from './balancer.js';
import { checkEquation, findSubstance, getHint, revealAnswer } from './checker.js';
import { createHistoryStore } from './history.js';
import { initHistoryUI } from './history-ui.js';
import { copyText } from './clipboard.js';
import { equationToLatex } from './export.js';
import { getLocale, setLocale, t } from './i18n.js';
import { buildIonicEquations } from './ionic.js';
import { initOnboarding } from './onboarding.js';
import { equationToUnicode, formatEquation, parseEquation } from './parser.js';
import { initPeriodicTable } from './periodic-table.js';
import { initReferenceUI } from './reference-ui.js';
import { initStoichiometryUI } from './stoichiometry-ui.js';
import { renderThermoPanel } from './thermo-panel.js';
import { renderRedoxPanel } from './redox-view.js';
import { getReactionRule } from './predictor.js';

const memoryStorage = new Map();
const storage = {
  getItem(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return memoryStorage.get(key) ?? null;
    }
  },
  setItem(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      memoryStorage.set(key, value);
    }
  }
};

const STORAGE_KEY = 'chemcalc-stage2';
let saved = {};
try {
  saved = JSON.parse(storage.getItem(STORAGE_KEY) || storage.getItem('chemcalc-stage1') || '{}');
} catch {
  saved = {};
}
const state = {
  mode: saved.mode === 'auto' ? 'auto' : 'check',
  tab: ['calculator', 'stoichiometry', 'references', 'history', 'community', 'documentation'].includes(saved.tab) ? saved.tab : 'calculator',
  draft: typeof saved.draft === 'string' ? saved.draft : '2H2 + O2 = 2H2O',
  autoDraft: typeof saved.autoDraft === 'string' ? saved.autoDraft : '',
  attempts: 0,
  hints: 0,
  currentEquation: null,
  result: null,
  autoDirty: false,
  checkDraft: '',
  checkSolvent: ['aqueous', 'melt', 'gas', 'organic'].includes(saved.checkSolvent) ? saved.checkSolvent : 'aqueous'
};
const historyStore = createHistoryStore(storage);
let autoController;
let stoichController;
let historyController;
let communityController;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const input = $('#equation-input');
const autoInput = $('#auto-input');
const form = $('#equation-form');
const confirmDialog = $('#confirm-dialog');
let toastTimer;

function saveState() {
  storage.setItem(STORAGE_KEY, JSON.stringify({
    mode: state.mode,
    tab: state.tab,
    draft: input.value,
    autoDraft: autoInput.value,
    checkSolvent: state.checkSolvent,
    locale: getLocale()
  }));
}

function showToast(message) {
  const toast = $('#toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2800);
}

function confirmAction(message) {
  $('#confirm-message').textContent = message;
  confirmDialog.returnValue = '';
  confirmDialog.showModal();
  return new Promise((resolve) => {
    confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'confirm'), { once: true });
  });
}

function setTab(tab) {
  state.tab = tab;
  $$('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== tab; });
  $$('[data-tab]').forEach((button) => {
    if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  saveState();
}

function setMode(mode, transfer = true) {
  if (transfer && mode !== state.mode) {
    if (mode === 'auto') {
      state.checkDraft = input.value;
      state.autoDirty = false;
      autoInput.value = input.value.split(/->|→|⇄|↔|=/)[0].trim();
    } else {
      state.checkSolvent = autoController?.getConditions().solvent || state.checkSolvent;
      $('#check-solvent').value = state.checkSolvent;
      const autoEquation = autoController?.getCurrentEquation();
      const preservedEquation = state.checkDraft || input.value;
      input.value = autoEquation
        ? formatEquation(autoEquation)
        : !state.autoDirty && preservedEquation.trim()
          ? preservedEquation
          : autoInput.value.trim() ? `${autoInput.value.trim()} = ` : preservedEquation;
    }
  }
  state.mode = mode;
  $$('[data-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
  $('#check-view').hidden = mode !== 'check';
  $('#auto-view').hidden = mode !== 'auto';
  $('#mode-description').dataset.i18n = mode === 'check' ? 'checkDescription' : 'autoDescription';
  setLocale(getLocale());
  if (mode === 'check') updateLive();
  saveState();
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#theme-toggle').setAttribute('aria-pressed', String(theme === 'dark'));
  storage.setItem('chemcalc-theme', theme);
}

function clearResult() {
  state.result = null;
  $('#empty-result').hidden = false;
  $('#verdict').hidden = true;
  $('#warning-list').replaceChildren();
  $('#copy-button').hidden = true;
  $('#latex-button').hidden = true;
  $('#solution').hidden = true;
  renderRedoxPanel($('#redox-panel'), $('#redox-steps'), null);
  $('#check-ionic-panel').hidden = true;
  $('#check-thermo-panel').hidden = true;
  $('#substance-details').hidden = true;
  $('#check-proposal-button').hidden = true;
}

function resetLearning() {
  state.attempts = 0;
  state.hints = 0;
  $('#attempt-count').textContent = '0';
  $('#hint-count').textContent = '0';
  $('#hint-count-label').textContent = '0/3';
  $('#hint-output').hidden = true;
  clearResult();
}

function balanceTable(balance) {
  const rows = balance.atomRows.map((row) => `
    <tr class="${row.balanced ? 'row-balanced' : 'row-unbalanced'}">
      <th scope="row">${row.symbol}</th><td>${row.left}</td><td>${row.right}</td>
      <td>${row.balanced ? '✓' : '×'}<span class="sr-only"> ${row.balanced ? t('matched') : t('mismatched')}</span></td>
    </tr>`);
  if (balance.charge.left !== 0 || balance.charge.right !== 0) {
    rows.push(`<tr class="${balance.charge.balanced ? 'row-balanced' : 'row-unbalanced'}"><th scope="row">${t('charge')}</th><td>${balance.charge.left}</td><td>${balance.charge.right}</td><td>${balance.charge.balanced ? '✓' : '×'}</td></tr>`);
  }
  return `<table><thead><tr><th scope="col">${t('element')}</th><th scope="col">${t('left')}</th><th scope="col">${t('right')}</th><th scope="col"><span class="sr-only">Статус</span></th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function signedState(value) {
  const text = value.toString().replace('-', '−');
  return value.n > 0n ? `+${text}` : text;
}

function renderSubstances(result) {
  const container = $('#substance-details');
  if (!result.equation) {
    container.hidden = true;
    return;
  }
  const species = [...result.equation.left, ...result.equation.right];
  const rows = species.map((item) => {
    const substance = findSubstance(item.formula);
    const details = result.redox?.stateDetails.find((entry) => entry.species === item);
    const oxidation = details?.complete && details.states.size
      ? [...details.states].map(([symbol, value]) => `${symbol}: ${signedState(value)}`).join('; ')
      : '—';
    return `<tr><th scope="row">${equationToUnicode({ left: [{ ...item, coefficient: 1 }], right: [], separator: '→' }).split(' →')[0] || item.formula}</th><td>${substance?.name_ru || t('unknown')}</td><td>${item.molarMass.toFixed(3)}</td><td>${oxidation}</td></tr>`;
  }).join('');
  container.innerHTML = `<h3>${t('substances')}</h3><div class="table-scroll"><table><thead><tr><th scope="col">${t('formula')}</th><th scope="col">${t('name')}</th><th scope="col">${t('molarMass')}</th><th scope="col">${t('oxidation')}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  container.hidden = false;
}

function renderResult(result) {
  state.result = result;
  $('#empty-result').hidden = true;
  $('#solution').hidden = true;
  const verdict = $('#verdict');
  verdict.hidden = false;
  verdict.className = `verdict ${result.status}`;
  const statusKeys = {
    correct: 'statusCorrect',
    nonminimal: 'statusNonminimal',
    'not-balanced': 'statusNotBalanced',
    'product-warning': 'statusWarning',
    partial: 'statusPartial',
    'syntax-error': 'statusSyntax'
  };
  const icons = { correct: '✓', nonminimal: '÷', 'not-balanced': '×', 'product-warning': '!', partial: '?', 'syntax-error': '×' };
  $('#verdict-icon').textContent = icons[result.status] || '!';
  $('#verdict-title').textContent = t(statusKeys[result.status]);
  $('#verdict-message').textContent = result.message;
  $('#copy-button').hidden = !result.equation;
  $('#latex-button').hidden = !result.equation;
  const warnings = $('#warning-list');
  warnings.replaceChildren();
  for (const warning of result.warnings || []) {
    if (warning.message === result.message) continue;
    const item = document.createElement('p');
    item.className = 'warning-item';
    item.textContent = warning.message;
    warnings.append(item);
  }
  renderRedoxPanel($('#redox-panel'), $('#redox-steps'), result.redox);
  const ionicPanel = $('#check-ionic-panel');
  if (result.balance?.isBalanced) {
    const ionic = buildIonicEquations(result.equation, { solvent: state.checkSolvent });
    ionicPanel.hidden = false;
    $('#check-ionic-full').textContent = ionic.fullUnicode || ionic.message;
    $('#check-ionic-net').textContent = ionic.netUnicode || '—';
    $('#check-ionic-notes').textContent = [...(ionic.notes || []), ionic.message].join(' ');
  } else {
    ionicPanel.hidden = true;
  }
  if (result.balance?.isBalanced) renderThermoPanel('#check-thermo-panel', result.equation, { solvent: state.checkSolvent });
  else $('#check-thermo-panel').hidden = true;
  renderSubstances(result);
  $('#check-proposal-button').hidden = false;
}

function renderCoefficientEditor(equation) {
  const container = $('#coefficient-editor');
  const fragment = document.createDocumentFragment();
  [...equation.left, ...equation.right].forEach((species, index) => {
    const row = document.createElement('div');
    row.className = 'coefficient-row';
    const formula = document.createElement('span');
    formula.className = 'coefficient-formula';
    const side = document.createElement('span');
    side.className = 'side-tag';
    side.textContent = index < equation.left.length ? t('left') : t('right');
    formula.append(side, document.createTextNode(equationToUnicode({ left: [{ ...species, coefficient: 1 }], right: [], separator: '→' }).split(' →')[0]));
    const stepper = document.createElement('div');
    stepper.className = 'stepper';
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.dataset.step = '-1';
    minus.dataset.index = String(index);
    minus.setAttribute('aria-label', `Уменьшить коэффициент ${species.formula}`);
    minus.textContent = '−';
    const number = document.createElement('input');
    number.type = 'number';
    number.min = '1';
    number.step = '1';
    number.value = String(species.coefficient);
    number.dataset.coefficient = String(index);
    number.setAttribute('aria-label', `Коэффициент ${species.formula}`);
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.dataset.step = '1';
    plus.dataset.index = String(index);
    plus.setAttribute('aria-label', `Увеличить коэффициент ${species.formula}`);
    plus.textContent = '+';
    stepper.append(minus, number, plus);
    const auto = document.createElement('button');
    auto.type = 'button';
    auto.className = 'auto-coefficient';
    auto.dataset.autoIndex = String(index);
    auto.textContent = 'авто';
    auto.setAttribute('aria-label', `Подобрать коэффициент ${species.formula}`);
    row.append(formula, stepper, auto);
    fragment.append(row);
  });
  container.replaceChildren(fragment);
}

function updateLive() {
  try {
    const equation = parseEquation(input.value);
    state.currentEquation = equation;
    const balance = inspectBalance(equation);
    $('#formula-preview').textContent = equationToUnicode(equation);
    $('#live-balance').innerHTML = balanceTable(balance);
    $('#inline-error').hidden = true;
    input.removeAttribute('aria-invalid');
    renderCoefficientEditor(equation);
    return equation;
  } catch (error) {
    state.currentEquation = null;
    $('#formula-preview').textContent = '';
    $('#live-balance').replaceChildren();
    $('#coefficient-editor').replaceChildren();
    $('#inline-error').textContent = error.message;
    $('#inline-error').hidden = false;
    input.setAttribute('aria-invalid', 'true');
    return null;
  }
}

function applyCoefficients(coefficients) {
  if (!state.currentEquation) return;
  input.value = formatEquation(state.currentEquation, coefficients);
  resetLearning();
  updateLive();
  saveState();
}

function currentCoefficients() {
  return [...state.currentEquation.left, ...state.currentEquation.right].map((species) => species.coefficient);
}

function showSolution(solution) {
  if (solution.status !== 'balanced') {
    showToast(solution.message);
    return;
  }
  $('#solution-equation').textContent = equationToUnicode(solution.equation, solution.coefficients);
  const steps = $('#solution-steps');
  steps.replaceChildren();
  for (const text of solution.steps) {
    const item = document.createElement('li');
    item.textContent = text;
    steps.append(item);
  }
  $('#solution').hidden = false;
}

$('#check-solvent').value = state.checkSolvent;
$('#check-solvent').addEventListener('change', (event) => {
  state.checkSolvent = event.target.value;
  resetLearning();
  updateLive();
  saveState();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  state.attempts += 1;
  $('#attempt-count').textContent = String(state.attempts);
  const result = checkEquation(input.value);
  renderResult(result);
  if (result.equation) {
    historyStore.add({ equation: formatEquation(result.equation), mode: 'check', conditions: { solvent: state.checkSolvent } });
    historyController?.render();
  }
});

input.addEventListener('input', () => {
  resetLearning();
  updateLive();
  saveState();
});

autoInput.addEventListener('input', () => {
  state.autoDirty = true;
  saveState();
});

$$('[data-example]').forEach((button) => button.addEventListener('click', () => {
  input.value = button.dataset.example;
  resetLearning();
  updateLive();
  saveState();
  input.focus();
}));

$('#coefficient-editor').addEventListener('click', (event) => {
  const step = event.target.closest('[data-step]');
  const auto = event.target.closest('[data-auto-index]');
  if (step && state.currentEquation) {
    const coefficients = currentCoefficients();
    const index = Number(step.dataset.index);
    coefficients[index] = Math.max(1, coefficients[index] + Number(step.dataset.step));
    applyCoefficients(coefficients);
  }
  if (auto && state.currentEquation) {
    const solution = balanceEquation(state.currentEquation);
    if (solution.status !== 'balanced') {
      showToast(solution.message);
      return;
    }
    const coefficients = currentCoefficients();
    coefficients[Number(auto.dataset.autoIndex)] = solution.coefficients[Number(auto.dataset.autoIndex)];
    applyCoefficients(coefficients);
  }
});

$('#coefficient-editor').addEventListener('change', (event) => {
  if (!event.target.matches('[data-coefficient]') || !state.currentEquation) return;
  const value = Number(event.target.value);
  if (!Number.isSafeInteger(value) || value < 1) {
    showToast('Коэффициент должен быть положительным целым числом');
    updateLive();
    return;
  }
  const coefficients = currentCoefficients();
  coefficients[Number(event.target.dataset.coefficient)] = value;
  applyCoefficients(coefficients);
});

$('#balance-button').addEventListener('click', async () => {
  const equation = updateLive();
  if (!equation) return;
  if (state.attempts === 0 && !await confirmAction(t('confirmBalance'))) return;
  const solution = balanceEquation(equation);
  if (solution.status !== 'balanced') {
    showToast(solution.message);
    return;
  }
  applyCoefficients(solution.coefficients);
  renderResult(checkEquation(input.value));
});

$('#reset-button').addEventListener('click', () => {
  if (!state.currentEquation) return;
  applyCoefficients(currentCoefficients().map(() => 1));
});

$('#answer-button').addEventListener('click', async () => {
  if (!await confirmAction(t('confirmAnswer'))) return;
  const result = checkEquation(input.value);
  renderResult(result);
  const solution = revealAnswer(result);
  if (solution) showSolution(solution);
});

$('#hint-button').addEventListener('click', () => {
  if (state.hints >= 3) {
    showToast('Использованы все три уровня подсказок');
    return;
  }
  state.hints += 1;
  $('#hint-count').textContent = String(state.hints);
  $('#hint-count-label').textContent = `${state.hints}/3`;
  const output = $('#hint-output');
  output.textContent = getHint(checkEquation(input.value), state.hints);
  output.hidden = false;
});

$('#copy-button').addEventListener('click', async () => {
  if (!state.result?.equation) return;
  try {
    await copyText(equationToUnicode(state.result.equation));
    showToast(t('copied'));
  } catch {
    showToast(t('copyError'));
  }
});

$('#latex-button').addEventListener('click', async () => {
  if (!state.result?.equation) return;
  try {
    await copyText(equationToLatex(state.result.equation));
    showToast('LaTeX скопирован');
  } catch {
    showToast(t('copyError'));
  }
});

$$('[data-tab]').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));
$$('[data-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
$('#brand-home').addEventListener('click', () => {
  setMode('check');
  setTab('calculator');
  input.focus();
});

$('#language-select').addEventListener('change', (event) => {
  setLocale(event.target.value);
  if (state.currentEquation) {
    renderCoefficientEditor(state.currentEquation);
    $('#live-balance').innerHTML = balanceTable(inspectBalance(state.currentEquation));
  }
  if (state.result) renderResult(state.result);
  communityController?.refresh();
  saveState();
});

$('#theme-toggle').addEventListener('click', () => {
  const current = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  setTheme(current === 'dark' ? 'light' : 'dark');
});

function insertElement(symbol) {
  const target = state.mode === 'auto' ? autoInput : input;
  const hasCaret = target.dataset.editing === 'true';
  let start = hasCaret ? target.selectionStart ?? target.value.length : target.value.length;
  let end = hasCaret ? target.selectionEnd ?? start : start;
  if (!hasCaret && target === input) {
    const separator = /->|→|⇄|↔|=/.exec(target.value);
    if (separator) {
      start = separator.index;
      end = start;
    }
  }
  const insertion = !hasCaret && target.value.trim() ? ` + ${symbol}` : symbol;
  target.setRangeText(insertion, start, end, 'end');
  target.dispatchEvent(new Event('input', { bubbles: true }));
  showToast(`${symbol} вставлен в формулу`);
}
[input, autoInput].forEach((field) => field.addEventListener('focus', () => { field.dataset.editing = 'true'; }));

const savedTheme = storage.getItem('chemcalc-theme');
if (savedTheme === 'light' || savedTheme === 'dark') setTheme(savedTheme);
else $('#theme-toggle').setAttribute('aria-pressed', String(matchMedia('(prefers-color-scheme: dark)').matches));
const initialLocale = saved.locale === 'en' ? 'en' : 'ru';
$('#language-select').value = initialLocale;
setLocale(initialLocale);
input.value = state.draft;
autoInput.value = state.autoDraft;
stoichController = initStoichiometryUI({
  getCurrentEquation: () => state.mode === 'auto' && autoController?.getCurrentEquation()
    ? formatEquation(autoController.getCurrentEquation())
    : input.value
});
autoController = initAutoUI({
  storage,
  saveState,
  showToast,
  onHistory(entry) {
    historyStore.add(entry);
    historyController?.render();
  },
  onOpenCheck(equation) {
    input.value = equation;
    state.autoDirty = false;
    state.checkSolvent = autoController.getConditions().solvent;
    $('#check-solvent').value = state.checkSolvent;
    setMode('check', false);
    resetLearning();
    updateLive();
    saveState();
  },
  onStoich(equation) {
    stoichController.setEquation(equation);
    setTab('stoichiometry');
  },
  onPropose(correction) { communityController?.openAutoProposal(correction); },
  onAlternatives(container, context) { communityController?.showAlternatives(container, context); }
});
communityController = initCommunityUI({
  showToast,
  onNavigate: setTab,
  getAutoContext() {
    const result = autoController.getResult();
    return {
      reactants: autoInput.value.trim(),
      equation: autoController.getCurrentEquation() ? formatEquation(autoController.getCurrentEquation()) : '',
      conditions: autoController.getConditions(),
      outcome: result?.status === 'no-reaction' ? 'no-reaction' : 'products',
      originalRule: result?.ruleId ? getReactionRule(result.ruleId) : null
    };
  },
  getCheckContext: () => ({
    reactants: input.value.split(/->|→|⇄|↔|=/)[0].trim(),
    equation: input.value,
    conditions: { solvent: state.checkSolvent },
    outcome: 'products',
    originalRule: null
  })
});
$('#check-proposal-button').addEventListener('click', () => communityController.openCheckProposal());
historyController = initHistoryUI({
  store: historyStore,
  confirmAction,
  onOpen(entry) {
    if (entry.mode === 'check') {
      input.value = entry.equation;
      state.checkSolvent = entry.conditions?.solvent || 'aqueous';
      $('#check-solvent').value = state.checkSolvent;
      setMode('check', false);
      resetLearning();
      updateLive();
    } else {
      autoController.setEquation(entry.equation.split(/->|→|⇄|↔|=/)[0].trim());
      autoController.setConditions(entry.conditions);
      state.autoDirty = false;
      setMode('auto', false);
      autoController.run(false);
    }
    setTab('calculator');
    saveState();
  }
});
initReferenceUI({
  storage,
  getCurrentEquation: () => state.mode === 'auto' && autoController?.getCurrentEquation()
    ? formatEquation(autoController.getCurrentEquation())
    : input.value,
  onOpenFormula(formula) {
    autoController.setEquation(formula);
    state.autoDirty = false;
    setMode('auto', false);
    setTab('calculator');
    autoController.run(false);
  },
  onOpenEquation(equation) {
    input.value = equation;
    setMode('check', false);
    setTab('calculator');
    resetLearning();
    updateLive();
    saveState();
  }
});
initPeriodicTable({
  onInsert: insertElement,
  showToast,
  onReaction(equation) {
    input.value = equation;
    setMode('check', false);
    setTab('calculator');
    resetLearning();
    updateLive();
    saveState();
    input.focus();
  }
});
const shared = autoController.readShared();
if (shared) {
  autoController.setEquation(shared.reactants);
  autoController.setConditions(shared.conditions);
  state.mode = 'auto';
  state.tab = 'calculator';
}
setTab(state.tab);
setMode(state.mode, false);
updateLive();
clearResult();
if (shared) autoController.run(false);
initOnboarding(storage);
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
