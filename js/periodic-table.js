import elementData from '../data/elements.json' with { type: 'json' };
import { renderElementCard } from './periodic-card.js';

export const PERIODIC_ELEMENTS = elementData.elements;
export const ELEMENT_BY_NUMBER = new Map(PERIODIC_ELEMENTS.map((element) => [element.number, element]));
const METALS = new Set(['alkali-metal', 'alkaline-earth', 'transition-metal', 'post-transition', 'lanthanide', 'actinide']);
const NONMETALS = new Set(['nonmetal', 'halogen', 'noble-gas']);
const CATEGORY_ORDER = ['alkali-metal', 'alkaline-earth', 'transition-metal', 'post-transition', 'lanthanide', 'actinide', 'metalloid', 'nonmetal', 'halogen', 'noble-gas', 'unknown'];
const MODE_LABELS = { category: 'Категория', block: 'Блок', phase: 'Агрегатное состояние', electronegativity: 'Электроотрицательность', radius: 'Атомный радиус', density: 'Плотность', discovery: 'Год открытия' };

export function filterElements(elements, query = '', filters = {}) {
  const normalized = query.trim().toLocaleLowerCase('ru');
  return elements.filter((element) => {
    const matchesQuery = !normalized || [element.symbol, element.name_ru, element.name_en, element.name_lat, String(element.number)]
      .some((value) => String(value || '').toLocaleLowerCase('ru').includes(normalized));
    const matchesType = filters.type === 'metal' ? METALS.has(element.category)
      : filters.type === 'nonmetal' ? NONMETALS.has(element.category)
        : filters.type === 'metalloid' ? element.category === 'metalloid' : true;
    const matchesGroup = !filters.group || element.group === Number(filters.group);
    const matchesPeriod = !filters.period || element.period === Number(filters.period);
    return matchesQuery && matchesType && matchesGroup && matchesPeriod && (!filters.radioactive || element.radioactive);
  });
}

export function phaseAt(element, temperatureK) {
  if (!Number.isFinite(Number(temperatureK)) || Number(temperatureK) < 0) return 'unknown';
  if (element.melt_K === null || element.boil_K === null) return 'unknown';
  if (Number(temperatureK) < element.melt_K) return 'solid';
  if (Number(temperatureK) < element.boil_K) return 'liquid';
  return 'gas';
}

export function elementMetric(element, mode, temperature = 298) {
  if (mode === 'electronegativity') return element.electronegativity;
  if (mode === 'radius') return element.atomic_radius;
  if (mode === 'density') return element.density;
  if (mode === 'discovery') return element.discovery_year;
  return null;
}

function heatColor(value, minimum, maximum) {
  if (value === null || value === undefined || minimum === maximum) return null;
  const ratio = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  return `hsl(${Math.round(220 - ratio * 220)} 72% 66%)`;
}

function metricRange(mode) {
  const values = PERIODIC_ELEMENTS.map((element) => elementMetric(element, mode)).filter((value) => Number.isFinite(value));
  return values.length ? [Math.min(...values), Math.max(...values)] : [null, null];
}

function symbolLabel(element) {
  return `${element.symbol}, ${element.name_ru}, элемент ${element.number}, ${element.category_ru}`;
}

export function initPeriodicTable({ onInsert, onReaction, showToast }) {
  const dialog = document.querySelector('#periodic-dialog');
  const elementDialog = document.querySelector('#element-dialog');
  const table = document.querySelector('#periodic-table');
  const search = document.querySelector('#periodic-search');
  const modeSelect = document.querySelector('#periodic-color-mode');
  const typeFilter = document.querySelector('#periodic-type-filter');
  const groupFilter = document.querySelector('#periodic-group-filter');
  const periodFilter = document.querySelector('#periodic-period-filter');
  const radioactiveFilter = document.querySelector('#periodic-radioactive');
  const temperature = document.querySelector('#periodic-temperature');
  let clickMode = 'info';
  let colorMode = 'category';
  let selectedCategory = null;
  let selectedNumber = null;
  let currentElementNumber = 1;
  let pointerStart = null;
  const buttons = new Map();
  for (let group = 1; group <= 18; group += 1) groupFilter.add(new Option(String(group), String(group)));
  for (let period = 1; period <= 7; period += 1) periodFilter.add(new Option(String(period), String(period)));

  function createGrid() {
    const fragment = document.createDocumentFragment();
    for (const element of PERIODIC_ELEMENTS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'element-cell';
      button.dataset.number = String(element.number);
      button.dataset.category = element.category;
      button.style.gridColumn = String(element.xpos);
      button.style.gridRow = String(element.ypos);
      button.style.setProperty('--element-color', `var(--category-${element.category})`);
      button.tabIndex = element.number === 1 ? 0 : -1;
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-label', symbolLabel(element));
      const number = document.createElement('span');
      number.className = 'element-number';
      number.textContent = String(element.number);
      const symbol = document.createElement('strong');
      symbol.textContent = element.symbol;
      const name = document.createElement('span');
      name.className = 'element-name';
      name.textContent = element.name_ru;
      const mass = document.createElement('small');
      mass.textContent = Number(element.atomic_mass).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
      const marker = document.createElement('span');
      marker.className = 'element-marker';
      button.append(number, symbol, name, mass, marker);
      buttons.set(element.number, button);
      fragment.append(button);
    }
    for (const [text, row] of [['Лантаноиды', 9], ['Актиноиды', 10]]) {
      const label = document.createElement('div');
      label.className = 'f-block-label';
      label.style.gridColumn = '1 / 3';
      label.style.gridRow = String(row);
      label.textContent = text;
      fragment.append(label);
    }
    table.append(fragment);
  }

  function renderLegend() {
    const legend = document.querySelector('#periodic-legend');
    legend.replaceChildren();
    if (colorMode === 'category') {
      for (const category of CATEGORY_ORDER) {
        const sample = PERIODIC_ELEMENTS.find((element) => element.category === category);
        if (!sample) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'legend-item';
        button.dataset.legendCategory = category;
        button.setAttribute('aria-pressed', String(selectedCategory === category));
        const swatch = document.createElement('span');
        swatch.className = 'legend-swatch';
        swatch.style.background = `var(--category-${category})`;
        button.append(swatch, document.createTextNode(sample.category_ru));
        legend.append(button);
      }
    } else if (colorMode === 'block') {
      legend.textContent = 's / p / d / f — обозначение блока указано в каждой клетке.';
    } else if (colorMode === 'phase') {
      legend.textContent = `Т — твёрдое, Ж — жидкое, Г — газообразное при ${temperature.value} K. Приближение по температурам плавления и кипения; давление не моделируется.`;
    } else {
      const [minimum, maximum] = metricRange(colorMode);
      legend.textContent = minimum === null ? 'Нет данных для этой шкалы.' : `Тепловая шкала: ${minimum} … ${maximum}. «—» означает отсутствие данных.`;
    }
  }

  function applyView() {
    const filters = {
      type: typeFilter.value,
      group: groupFilter.value,
      period: periodFilter.value,
      radioactive: radioactiveFilter.checked
    };
    const visible = new Set(filterElements(PERIODIC_ELEMENTS, search.value, filters).map((element) => element.number));
    const [minimum, maximum] = metricRange(colorMode);
    for (const element of PERIODIC_ELEMENTS) {
      const button = buttons.get(element.number);
      button.hidden = !visible.has(element.number);
      button.classList.toggle('dimmed', Boolean(selectedCategory && selectedCategory !== element.category));
      button.classList.toggle('selected', selectedNumber === element.number);
      button.classList.toggle('context-highlight', selectedNumber !== null && selectedNumber !== element.number && (element.group !== null && element.group === ELEMENT_BY_NUMBER.get(selectedNumber).group || element.period === ELEMENT_BY_NUMBER.get(selectedNumber).period));
      const marker = button.querySelector('.element-marker');
      let color = `var(--category-${element.category})`;
      let markerText = '';
      if (colorMode === 'block') {
        const blockColors = { s: '#f4bf75', p: '#83cfe0', d: '#b5a4e3', f: '#e69ab5' };
        color = blockColors[element.block] || 'var(--surface-muted)';
        markerText = element.block || '—';
      } else if (colorMode === 'phase') {
        const phase = phaseAt(element, Number(temperature.value));
        color = { solid: '#e4b77e', liquid: '#83c7dc', gas: '#b5a7e2', unknown: 'var(--surface-muted)' }[phase];
        markerText = { solid: 'Т', liquid: 'Ж', gas: 'Г', unknown: '—' }[phase];
      } else if (!['category'].includes(colorMode)) {
        const value = elementMetric(element, colorMode, Number(temperature.value));
        color = heatColor(value, minimum, maximum) || 'var(--surface-muted)';
        markerText = value === null || value === undefined ? '—' : String(value);
      }
      button.style.setProperty('--element-color', color);
      marker.textContent = markerText;
      button.title = `${symbolLabel(element)}${markerText ? ` · ${MODE_LABELS[colorMode]}: ${markerText}` : ''}`;
    }
    document.querySelector('#periodic-result-count').textContent = `Показано ${visible.size} из ${PERIODIC_ELEMENTS.length}`;
    renderLegend();
  }

  function activateElement(element, focus = false) {
    selectedNumber = element.number;
    for (const [number, button] of buttons) button.tabIndex = number === element.number ? 0 : -1;
    if (focus) buttons.get(element.number).focus();
    applyView();
    if (clickMode === 'insert') onInsert(element.symbol);
    else openElement(element.number);
  }

  function openElement(number) {
    currentElementNumber = Math.max(1, Math.min(118, number));
    const element = ELEMENT_BY_NUMBER.get(currentElementNumber);
    document.querySelector('#element-card-title').textContent = `${element.name_ru} · ${element.symbol}`;
    const content = document.querySelector('#element-card-content');
    content.replaceChildren(renderElementCard(element, {
      onInsert(symbol) {
        onInsert(symbol);
        elementDialog.close();
        close();
      },
      onReaction(equation) {
        elementDialog.close();
        close();
        onReaction(equation);
      }
    }));
    content.scrollTop = 0;
    if (!elementDialog.open) elementDialog.showModal();
  }

  function open() {
    if (dialog.open) return;
    if (window.matchMedia('(min-width: 1200px)').matches) {
      dialog.show();
      document.body.classList.add('periodic-open');
    } else {
      dialog.showModal();
    }
  }

  function close() {
    if (dialog.open) dialog.close();
    document.body.classList.remove('periodic-open', 'periodic-fullscreen');
  }

  function toggle() {
    if (dialog.open) close();
    else open();
  }

  table.addEventListener('click', (event) => {
    const button = event.target.closest('[data-number]');
    if (button) activateElement(ELEMENT_BY_NUMBER.get(Number(button.dataset.number)));
  });
  table.addEventListener('keydown', (event) => {
    const button = event.target.closest('[data-number]');
    if (!button || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const current = ELEMENT_BY_NUMBER.get(Number(button.dataset.number));
    const candidates = PERIODIC_ELEMENTS.filter((element) => !buttons.get(element.number).hidden).filter((element) => {
      if (event.key === 'ArrowLeft') return element.ypos === current.ypos && element.xpos < current.xpos;
      if (event.key === 'ArrowRight') return element.ypos === current.ypos && element.xpos > current.xpos;
      if (event.key === 'ArrowUp') return element.xpos === current.xpos && element.ypos < current.ypos;
      return element.xpos === current.xpos && element.ypos > current.ypos;
    });
    const next = candidates.sort((a, b) => {
      const distance = (element) => Math.abs(element.xpos - current.xpos) + Math.abs(element.ypos - current.ypos);
      return distance(a) - distance(b) || a.number - b.number;
    })[0];
    if (next) {
      selectedNumber = next.number;
      for (const [number, cell] of buttons) cell.tabIndex = number === next.number ? 0 : -1;
      buttons.get(next.number).focus();
      applyView();
    }
  });
  [search, modeSelect, typeFilter, groupFilter, periodFilter, radioactiveFilter].forEach((control) => control.addEventListener(control === search ? 'input' : 'change', () => {
    colorMode = modeSelect.value;
    document.querySelector('#periodic-temperature-wrap').hidden = colorMode !== 'phase';
    applyView();
  }));
  temperature.addEventListener('input', () => {
    document.querySelector('#periodic-temperature-value').textContent = `${temperature.value} K`;
    applyView();
  });
  document.querySelector('#periodic-legend').addEventListener('click', (event) => {
    const button = event.target.closest('[data-legend-category]');
    if (!button) return;
    selectedCategory = selectedCategory === button.dataset.legendCategory ? null : button.dataset.legendCategory;
    applyView();
  });
  document.querySelectorAll('[data-periodic-click-mode]').forEach((button) => button.addEventListener('click', () => {
    clickMode = button.dataset.periodicClickMode;
    document.querySelectorAll('[data-periodic-click-mode]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    document.querySelector('#periodic-click-hint').textContent = clickMode === 'insert' ? 'Щелчок по элементу вставит его символ в активную формулу.' : 'Щелчок по элементу откроет подробную справку.';
  }));
  document.querySelectorAll('[data-open-periodic]').forEach((button) => button.addEventListener('click', toggle));
  document.querySelector('#close-periodic').addEventListener('click', close);
  function setExpanded(expanded) {
    dialog.classList.toggle('periodic-expanded', expanded);
    document.body.classList.toggle('periodic-fullscreen', expanded && window.matchMedia('(min-width: 1200px)').matches);
    document.querySelector('#expand-periodic').setAttribute('aria-pressed', String(expanded));
    document.querySelector('#expand-periodic').setAttribute('aria-label', expanded ? 'Свернуть таблицу' : 'Развернуть таблицу');
  }
  document.querySelector('#expand-periodic').addEventListener('click', () => setExpanded(!dialog.classList.contains('periodic-expanded')));
  document.querySelector('#periodic-exit-fullscreen').addEventListener('click', () => setExpanded(false));
  document.querySelector('#close-element-card').addEventListener('click', () => elementDialog.close());
  document.querySelector('#element-previous').addEventListener('click', () => openElement(currentElementNumber === 1 ? 118 : currentElementNumber - 1));
  document.querySelector('#element-next').addEventListener('click', () => openElement(currentElementNumber === 118 ? 1 : currentElementNumber + 1));
  elementDialog.addEventListener('keydown', (event) => {
    if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if (event.key === 'ArrowLeft') openElement(currentElementNumber === 1 ? 118 : currentElementNumber - 1);
    if (event.key === 'ArrowRight') openElement(currentElementNumber === 118 ? 1 : currentElementNumber + 1);
  });
  document.querySelector('#element-card-content').addEventListener('click', (event) => {
    const anchor = event.target.closest('[data-card-section]');
    if (!anchor) return;
    document.querySelector(`#element-${anchor.dataset.cardSection}`)?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
  dialog.addEventListener('close', () => document.body.classList.remove('periodic-open', 'periodic-fullscreen'));
  const handle = document.querySelector('#periodic-sheet-handle');
  handle.addEventListener('pointerdown', (event) => { pointerStart = event.clientY; handle.setPointerCapture(event.pointerId); });
  handle.addEventListener('pointerup', (event) => {
    if (pointerStart !== null && event.clientY - pointerStart > 70 && !window.matchMedia('(min-width: 1200px)').matches) close();
    pointerStart = null;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() !== 't' || event.ctrlKey || event.metaKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if (elementDialog.open) return;
    event.preventDefault();
    toggle();
  });
  createGrid();
  applyView();
  return { open, close, toggle, openElement, applyView, getVisibleCount: () => filterElements(PERIODIC_ELEMENTS, search.value, { type: typeFilter.value, group: groupFilter.value, period: periodFilter.value, radioactive: radioactiveFilter.checked }).length };
}
