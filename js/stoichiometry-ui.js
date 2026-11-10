import { balanceEquation } from './balancer.js';
import { t } from './i18n.js';
import { equationToUnicode, formulaToUnicode, parseEquation } from './parser.js';
import { calculateStoichiometry } from './stoichiometry.js';

const $ = (selector) => document.querySelector(selector);

export function initStoichiometryUI({ getCurrentEquation }) {
  const input = $('#stoich-equation');
  let balanced = null;

  function populate() {
    try {
      balanced = balanceEquation(parseEquation(input.value));
      if (balanced.status !== 'balanced') throw new RangeError(balanced.message);
      const equation = balanced.equation;
      const species = [...equation.left, ...equation.right];
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
    $('#stoich-result').hidden = false;
    $('#stoich-result-equation').textContent = result.equationUnicode;
    $('#stoich-limiting').hidden = !result.limitingFormula;
    $('#stoich-limiting').textContent = result.limitingFormula ? `Лимитирующий реагент: ${result.limitingFormula}.` : '';
    $('#stoich-yield-target').textContent = result.yieldPercent === 100 ? '' : t('yieldTarget', { product: $('#stoich-yield-product').selectedOptions[0]?.textContent || '—' });
    const header = `<thead><tr><th scope="col">${t('formula')}</th><th scope="col">ν</th><th scope="col">M, г/моль</th><th scope="col">${t('usedAmount')}</th><th scope="col">${t('theoreticalMass')}</th><th scope="col">${t('gasVolumeShort')}</th><th scope="col">${t('actualMassShort')}</th></tr></thead>`;
    const rows = result.rows.map((row) => `<tr><th scope="row">${row.side === 'left' ? '←' : '→'} ${formulaToUnicode(row.formula)}</th><td>${row.coefficient}</td><td>${row.molarMass.toFixed(3)}</td><td>${row.moles}</td><td>${row.massG}</td><td>${row.gasVolumeL ?? '—'}</td><td>${row.actualMassG ?? '—'}</td></tr>`).join('');
    $('#stoich-table').innerHTML = `<table>${header}<tbody>${rows}</tbody></table>`;
    const steps = $('#stoich-steps');
    steps.replaceChildren();
    for (const text of result.steps) {
      const item = document.createElement('li');
      item.textContent = text;
      steps.append(item);
    }
  }

  input.addEventListener('input', populate);
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
    if (!populate()) return;
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
