import { balanceEquation } from './balancer.js';
import { t } from './i18n.js';
import { equationToUnicode, formulaToUnicode, parseEquation } from './parser.js';
import { calculateStoichiometry } from './stoichiometry.js';

const $ = (selector) => document.querySelector(selector);

function hasGasProduct(result) {
  return Boolean(result.hasGasProduct) || result.rows.some((row) => row.side === 'right' && row.gasVolumeL !== null);
}

export function buildStoichiometryTable(result) {
  const showActual = result.yieldPercent !== 100;
  const gasProducts = hasGasProduct(result);
  const gasActualHeader = gasProducts ? `<th scope="col">${t('actualGasVolumeShort')}</th>` : '';
  const actualHeaders = showActual ? `<th scope="col">${t('actualMolesShort')}</th><th scope="col">${t('actualMassShort')}</th>${gasActualHeader}` : '';
  const header = `<thead><tr><th scope="col">${t('formula')}</th><th scope="col">ν</th><th scope="col">${t('molarMass')}</th><th scope="col">${t('usedAmount')}</th><th scope="col">${t('theoreticalMass')}</th><th scope="col">${t('gasVolumeShort')}</th>${actualHeaders}</tr></thead>`;
  const rows = result.rows.map((row) => {
    const actualCells = showActual ? `<td>${row.actualMoles ?? '—'}</td><td>${row.actualMassG ?? '—'}</td>${gasProducts ? `<td>${row.actualGasVolumeL ?? '—'}</td>` : ''}` : '';
    return `<tr><th scope="row" class="chem">${row.side === 'left' ? '←' : '→'} ${formulaToUnicode(row.formula)}</th><td>${row.coefficient}</td><td>${row.molarMass.toFixed(3)}</td><td>${row.moles}</td><td>${row.massG}</td><td>${row.gasVolumeL ?? '—'}</td>${actualCells}</tr>`;
  }).join('');
  return `<table>${header}<tbody>${rows}</tbody></table>`;
}

export function buildPracticalLines(result) {
  if (result.yieldPercent === 100 || !result.practicalProducts?.length) return [];
  const conditions = result.gasConditions === 'satp' ? t('gasConditionsShortSatp') : t('gasConditionsShortNormal');
  return result.practicalProducts.map((item) => ({
    isGas: item.gasVolumeL !== null,
    text: item.gasVolumeL === null
      ? t('practicalLine', { formula: formulaToUnicode(item.formula), moles: item.moles, mass: item.massG })
      : t('practicalLineGas', { formula: formulaToUnicode(item.formula), moles: item.moles, mass: item.massG, volume: item.gasVolumeL, conditions })
  }));
}

export function initStoichiometryUI({ getCurrentEquation, showToast = null }) {
  const input = $('#stoich-equation');
  let balanced = null;
  let lastResult = null;

  function invalidateResult() {
    lastResult = null;
    $('#stoich-result').hidden = true;
  }

  function populate(preserveAvailable = false) {
    invalidateResult();
    try {
      balanced = balanceEquation(parseEquation(input.value));
      if (balanced.status !== 'balanced') throw new RangeError(balanced.message);
      const equation = balanced.equation;
      const species = [...equation.left, ...equation.right];
      const previousAvailable = preserveAvailable
        ? new Map([...document.querySelectorAll('[data-available-index]')].map((field) => [field.dataset.availableIndex, field.value]))
        : new Map();
      const select = $('#stoich-substance');
      const previousSubstance = select.value;
      select.replaceChildren();
      species.forEach((item, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `${index < equation.left.length ? '←' : '→'} ${formulaToUnicode(item)}`;
        select.append(option);
      });
      if (species.some((_, index) => String(index) === previousSubstance)) select.value = previousSubstance;
      const yieldProduct = $('#stoich-yield-product');
      const previousYieldProduct = yieldProduct.value;
      yieldProduct.replaceChildren();
      equation.right.forEach((item, index) => {
        const option = document.createElement('option');
        option.value = String(equation.left.length + index);
        option.textContent = formulaToUnicode(item);
        yieldProduct.append(option);
      });
      if ([...yieldProduct.options].some((option) => option.value === previousYieldProduct)) yieldProduct.value = previousYieldProduct;
      const available = $('#stoich-available');
      available.replaceChildren();
      const heading = document.createElement('h3');
      heading.textContent = t('availableAmounts');
      const help = document.createElement('p');
      help.className = 'help-text';
      help.textContent = t('availableHelp');
      const grid = document.createElement('div');
      grid.className = 'available-grid';
      equation.left.forEach((item, index) => {
        const label = document.createElement('label');
        const name = document.createElement('span');
        name.textContent = formulaToUnicode(item);
        const field = document.createElement('input');
        field.type = 'number';
        field.min = '0';
        field.step = 'any';
        field.placeholder = '—';
        field.dataset.availableIndex = String(index);
        field.value = previousAvailable.get(String(index)) ?? '';
        label.append(name, field);
        grid.append(label);
      });
      available.append(heading, help, grid);
      $('#stoich-error').hidden = true;
      input.removeAttribute('aria-invalid');
      return true;
    } catch (error) {
      balanced = null;
      $('#stoich-substance').replaceChildren();
      $('#stoich-available').replaceChildren();
      $('#stoich-error').textContent = error.message;
      $('#stoich-error').hidden = false;
      input.setAttribute('aria-invalid', 'true');
      $('#stoich-result').hidden = true;
      return false;
    }
  }

  function render(result) {
    lastResult = result;
    $('#stoich-result').hidden = false;
    $('#stoich-result-equation').textContent = result.equationUnicode;
    $('#stoich-limiting').hidden = !result.limitingFormula;
    $('#stoich-limiting').textContent = result.limitingFormula ? t('limitingReactant', { formula: formulaToUnicode(result.limitingFormula) }) : '';
    const basisNote = $('#stoich-basis-note');
    if (result.basisSource === 'limiting' && result.limitingFormula) {
      basisNote.hidden = false;
      basisNote.textContent = t('stoichBasisLimiting', {
        formula: formulaToUnicode(result.limitingFormula),
        moles: result.basisMoles
      });
    } else if (result.availableCount === 1 && result.availableFormula) {
      basisNote.hidden = false;
      basisNote.textContent = t('stoichBasisSingleAvailable', { formula: formulaToUnicode(result.availableFormula) });
    } else {
      basisNote.hidden = true;
      basisNote.textContent = '';
    }
    $('#stoich-yield-target').textContent = result.yieldPercent === 100 ? '' : t('yieldTarget', { product: $('#stoich-yield-product').selectedOptions[0]?.textContent || '—' });
    $('#stoich-table').innerHTML = buildStoichiometryTable(result);
    const practical = $('#stoich-practical');
    practical.replaceChildren();
    const practicalLines = buildPracticalLines(result);
    if (practicalLines.length) {
      practical.hidden = false;
      const title = document.createElement('strong');
      title.textContent = `${t('practicalProductsTitle')}: `;
      practical.append(title);
      practicalLines.forEach((item, index) => {
        if (index > 0) practical.append(document.createTextNode(' · '));
        const line = document.createElement('span');
        line.className = item.isGas ? 'practical-item practical-item-gas' : 'practical-item';
        line.textContent = item.text;
        practical.append(line);
      });
    } else {
      practical.hidden = true;
    }
    const steps = $('#stoich-steps');
    steps.replaceChildren();
    for (const text of result.steps) {
      const item = document.createElement('li');
      item.textContent = text;
      steps.append(item);
    }
  }

  input.addEventListener('input', () => populate());
  $('#stoich-form').addEventListener('input', invalidateResult);
  $('#stoich-form').addEventListener('change', invalidateResult);
  async function exportStoichiometry(format, button) {
    if (!lastResult) return;
    try {
      const [{ buildStoichiometryReport }, { runReportExport }] = await Promise.all([
        import('./report-builders.js'),
        import('./report-ui.js')
      ]);
      await runReportExport(format, buildStoichiometryReport(lastResult), { button, showToast });
    } catch (error) {
      console.error('ChemCalc stoichiometry export failed', error);
      if (showToast) showToast(t('exportFailed'));
    }
  }
  $('#stoich-export-pdf').addEventListener('click', (event) => exportStoichiometry('pdf', event.currentTarget));
  $('#stoich-export-docx').addEventListener('click', (event) => exportStoichiometry('docx', event.currentTarget));
  $('#stoich-kind').addEventListener('change', () => {
    $('#stoich-concentration-wrap').hidden = $('#stoich-kind').value !== 'solution';
  });
  $('#stoich-use-current').addEventListener('click', () => {
    const equation = getCurrentEquation();
    if (!equation) return;
    input.value = equation;
    populate();
  });
  $('#stoich-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const availableReactants = {};
    document.querySelectorAll('[data-available-index]').forEach((field) => {
      if (field.value !== '') availableReactants[field.dataset.availableIndex] = field.value;
    });
    if (!populate(true)) return;
    try {
      const result = calculateStoichiometry(input.value, {
        known: {
          index: Number($('#stoich-substance').value),
          kind: $('#stoich-kind').value,
          value: $('#stoich-value').value,
          concentrationMolL: $('#stoich-concentration').value
        },
        gasConditions: $('#stoich-gas-conditions').value,
        yieldPercent: $('#stoich-yield').value,
        yieldProductIndex: $('#stoich-yield-product').value,
        availableReactants
      });
      if (result.status !== 'ok') throw new RangeError(result.message);
      render(result);
    } catch (error) {
      $('#stoich-error').textContent = error.message;
      $('#stoich-error').hidden = false;
      $('#stoich-result').hidden = true;
    }
  });
  populate();

  return {
    setEquation(value) { input.value = value; populate(); },
    getEquation: () => input.value,
    populate
  };
}
