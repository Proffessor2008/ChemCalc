import solubilityData from '../data/solubility.json' with { type: 'json' };
import activityData from '../data/activity-series.json' with { type: 'json' };
import substanceData from '../data/substances.json' with { type: 'json' };
import elementData from '../data/elements.json' with { type: 'json' };
import { formulaToUnicode, parseFormula } from './parser.js';
import { predictReaction } from './predictor.js';
import { REFERENCE_SOURCES, ACID_BASE_RECORDS, ELECTRODE_RECORDS, ELECTRONEGATIVITY_RECORDS, bondType, bufferPH, calculatePH, checkIonPair, galvanicCell, nernst, willDisplace } from './reference-tables.js';
import { THERMO_RECORDS, THERMO_SOURCE, calculateReactionThermo } from './thermo.js';

const REFERENCES = [
  { id: 'solubility', label: 'Растворимость', symbol: 'Р / Н' },
  { id: 'activity', label: 'Ряд активности', symbol: 'E°' },
  { id: 'electronegativity', label: 'Электроотрицательность', symbol: 'χ' },
  { id: 'acid-base', label: 'Ka / Kb и pH', symbol: 'pH' },
  { id: 'electrodes', label: 'Электродные потенциалы', symbol: 'В' },
  { id: 'thermo', label: 'Термодинамика', symbol: 'ΔG°' }
];
const $ = (selector) => document.querySelector(selector);
const substanceNames = new Map(substanceData.items.map((item) => [item.formula, item.name_ru]));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const chemical = (formula) => { try { return escapeHtml(formulaToUnicode(formula)); } catch { return escapeHtml(formula); } };
const formatNumber = (value) => value === null || value === undefined ? '—' : Number.isFinite(value) ? (Math.abs(value) >= 1e6 || Math.abs(value) < 0.001 && value !== 0 ? value.toExponential(4) : Number(value.toPrecision(6)).toLocaleString('ru')) : '∞';
const phaseName = { s: 'твёрдое', l: 'жидкое', g: 'газ', aq: 'водный раствор' };

function svgThermoCurve(curve) {
  const values = curve.map((point) => point.deltaG);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = curve.map((point, index) => `${30 + index * 470 / (curve.length - 1)},${170 - (point.deltaG - min) / (max - min || 1) * 140}`).join(' ');
  return `<svg class="thermo-curve" viewBox="0 0 540 210" role="img" aria-label="График приближённой зависимости ΔG от температуры"><path d="M30 10V170H510" fill="none" stroke="currentColor"/><text x="4" y="18">ΔG</text><text x="450" y="198">T, K</text><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="3"/></svg>`;
}

export function initReferenceUI({ storage, onOpenFormula, onOpenEquation, getCurrentEquation }) {
  let current = 'solubility';
  let items = [];
  let activityMode = 'practical';
  let thermoPhase = '';

  function sorted(list) {
    const query = $('#reference-search').value.trim().toLocaleLowerCase('ru');
    const filtered = list.filter((item) => !query || `${item.label} ${item.search || ''}`.toLocaleLowerCase('ru').includes(query));
    const direction = $('#reference-sort').value;
    return [...filtered].sort((a, b) => direction === 'asc' ? (a.value ?? Infinity) - (b.value ?? Infinity)
      : direction === 'desc' ? (b.value ?? -Infinity) - (a.value ?? -Infinity)
        : direction === 'name' ? a.label.localeCompare(b.label, 'ru') : 0);
  }

  function updateItems(nextItems) {
    items = sorted(nextItems);
    for (const selector of ['#reference-compare-a', '#reference-compare-b']) {
      const select = $(selector);
      select.replaceChildren();
      for (const item of items) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.label;
        select.append(option);
      }
    }
    if (items.length > 1) $('#reference-compare-b').value = items[1].id;
    renderComparison();
  }

  function renderComparison() {
    const a = items.find((item) => item.id === $('#reference-compare-a').value);
    const b = items.find((item) => item.id === $('#reference-compare-b').value);
    $('#reference-compare-output').textContent = a && b ? `${a.label}: ${a.detail}\n${b.label}: ${b.detail}` : 'Выберите две позиции для сравнения.';
  }

  function showDetail(title, text, source = '', action = null) {
    $('#reference-detail-title').textContent = title;
    $('#reference-detail-content').textContent = text;
    if (source) {
      const note = document.createElement('p');
      note.className = 'source-note';
      note.textContent = `Источник: ${source}`;
      $('#reference-detail-content').append(note);
    }
    const button = $('#reference-detail-open');
    button.hidden = !action;
    button.onclick = action ? () => { $('#reference-detail').close(); action(); } : null;
    $('#reference-detail').showModal();
  }

  function table(headers, rows) {
    return `<div class="table-scroll reference-table"><table><thead><tr>${headers.map((header) => `<th scope="col">${header}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }

  function renderSolubility() {
    const records = Object.entries(solubilityData.substances).map(([formula, record]) => ({ id: `sol-${formula}`, label: chemical(formula), value: record.ksp ?? null, detail: `${record.solubility}; Ksp = ${record.ksp ?? '—'}`, formula, source: record.kspSource || record.source }));
    updateItems(records);
    const cations = [...new Set(records.flatMap((entry) => solubilityData.substances[entry.formula].ions.filter((ion) => parseFormula(ion.formula).charge > 0).map((ion) => ion.formula)))];
    const anions = [...new Set(records.flatMap((entry) => solubilityData.substances[entry.formula].ions.filter((ion) => parseFormula(ion.formula).charge < 0).map((ion) => ion.formula)))];
    const options = (values) => values.map((value) => `<option value="${value}">${chemical(value)}</option>`).join('');
    const matrixRows = cations.map((cation) => {
      const cells = anions.map((anion) => {
        const result = checkIonPair(cation, anion);
        const id = `solubility-${cation}-${anion}`.replace(/[^a-zA-Z0-9]+/g, '-');
        return `<td id="${id}"><button class="solubility-cell sol-${result.status}" data-cation="${cation}" data-anion="${anion}" title="${chemical(result.formula)}: ${result.status}">${result.status}</button></td>`;
      }).join('');
      return `<tr><th scope="row">${chemical(cation)}</th>${cells}</tr>`;
    });
    $('#reference-content').innerHTML = `<section class="card"><h2>Матрица растворимости</h2><p class="help-text">Р — растворимо, М — малорастворимо, Н — нерастворимо, ? — нет данных. Буква видна независимо от цвета.</p><label class="check-control"><input id="solubility-insoluble" type="checkbox"><span>Подсветить только нерастворимые</span></label>${table(anions.map((anion) => chemical(anion)), matrixRows)}</section>
      <form id="ion-pair-form" class="card tool-card"><h2>Проверить пару ионов</h2><div class="tool-grid"><label>Катион<select id="ion-cation">${options(cations)}</select></label><label>Анион<select id="ion-anion">${options(anions)}</select></label><button class="button primary" type="submit">Проверить</button></form><div id="ion-pair-result" class="tool-result" aria-live="polite"></div>`;
    $('#ion-pair-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const result = checkIonPair($('#ion-cation').value, $('#ion-anion').value);
      $('#ion-pair-result').textContent = result.explanation;
    });
    $('#solubility-insoluble').addEventListener('change', (event) => {
      document.querySelectorAll('.solubility-cell').forEach((cell) => cell.classList.toggle('filtered-out', event.target.checked && cell.textContent !== 'Н'));
    });
  }

  function renderActivity() {
    const entries = activityMode === 'practical' ? activityData.order.map((symbol) => {
      const potential = ELECTRODE_RECORDS.find((record) => record.element === symbol && record.reduced === symbol);
      return { id: `activity-${symbol}`, label: symbol === 'H' ? '(H)' : symbol, value: potential?.E0_V ?? null, detail: potential ? `E° = ${potential.E0_V} В` : 'Потенциал не указан в локальной таблице', source: potential?.source || activityData.source };
    }) : ELECTRODE_RECORDS.filter((record) => record.reduced === record.element).sort((a, b) => a.E0_V - b.E0_V).map((record) => ({ id: `activity-${record.element}`, label: record.element, value: record.E0_V, detail: `${record.half}; E° = ${record.E0_V} В`, source: record.source }));
    updateItems(entries);
    $('#reference-content').innerHTML = `<section class="card"><div class="section-inline"><h2>${activityMode === 'practical' ? 'Практический ряд активности' : 'Ряд по стандартным E°'}</h2><button id="activity-toggle" class="button ghost" type="button">${activityMode === 'practical' ? 'Показать по E°' : 'Показать практический'}</button></div><div class="activity-series">${sorted(entries).map((entry) => `<button class="activity-metal ${entry.label === '(H)' ? 'hydrogen' : ''}" data-detail="${entry.id}" type="button"><strong>${entry.label}</strong><span>${entry.value === null ? '—' : `${entry.value} В`}</span></button>`).join('')}</div><div class="activity-zones"><p>До H: типовое вытеснение водорода из кислот-неокислителей.</p><p>После H: не вытесняют водород по этому правилу.</p></div></section>
      <form id="displacement-form" class="card tool-card"><h2>Вытеснит ли A металл B из соли?</h2><div class="tool-grid"><label>Металл A<select id="displace-a">${activityData.order.filter((symbol) => symbol !== 'H').map((symbol) => `<option>${symbol}</option>`).join('')}</select></label><label>Металл B<select id="displace-b">${activityData.order.filter((symbol) => symbol !== 'H').map((symbol) => `<option ${symbol === 'Cu' ? 'selected' : ''}>${symbol}</option>`).join('')}</select></label></div><button class="button primary" type="submit">Проверить</button></form><div id="displacement-result" class="tool-result" aria-live="polite"></div><section class="card"><h2>Исключения и оговорки</h2><p>Щелочные и щёлочноземельные металлы реагируют с водой. Al, Fe и Cr пассивируются в холодных концентрированных кислотах-окислителях. Ряд не описывает кинетику и комплексообразование.</p></section>`;
    $('#activity-toggle').addEventListener('click', () => { activityMode = activityMode === 'practical' ? 'theoretical' : 'practical'; renderActivity(); });
    $('#displacement-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const a = $('#displace-a').value;
      const b = $('#displace-b').value;
      const result = willDisplace(a, b);
      $('#displacement-result').textContent = `${result.possible ? 'Да' : 'Нет'}: ${result.message}`;
      if (result.possible) {
        const prediction = predictReaction(`${a} + ${b}SO4`);
        if (prediction.status === 'predicted') {
          const button = document.createElement('button');
          button.className = 'button secondary';
          button.type = 'button';
          button.textContent = 'Открыть уравнение';
          button.addEventListener('click', () => onOpenEquation(prediction.formatted));
          $('#displacement-result').append(button);
        }
      }
    });
  }

  function renderElectronegativity() {
    const entries = ELECTRONEGATIVITY_RECORDS.map((record) => ({ id: `en-${record.symbol}`, label: `${record.symbol} — ${record.name_ru}`, value: record.pauling, detail: `χ(Полинг) = ${record.pauling ?? '—'}`, source: record.source }));
    updateItems(entries);
    const bySymbol = new Map(ELECTRONEGATIVITY_RECORDS.map((record) => [record.symbol, record]));
    const mapCells = elementData.elements.map((element) => {
      const value = bySymbol.get(element.symbol)?.pauling;
      const color = value === null ? 'var(--surface-muted)' : `hsl(${220 - value / 4 * 220} 70% 66%)`;
      return `<button class="en-cell" style="grid-column:${element.xpos};grid-row:${element.ypos};background:${color}" data-detail="en-${element.symbol}" title="${element.name_ru}: ${value ?? '—'}">${element.symbol}<small>${value ?? '—'}</small></button>`;
    }).join('');
    const points = ELECTRONEGATIVITY_RECORDS.filter((record) => record.pauling !== null).map((record) => `<circle cx="${30 + record.number * 4.6}" cy="${170 - record.pauling / 4 * 140}" r="3"><title>${record.symbol}: ${record.pauling}</title></circle>`).join('');
    $('#reference-content').innerHTML = `<section class="card"><h2>Тепловая карта по Полингу</h2><div class="table-scroll"><div class="en-grid">${mapCells}</div></div></section><section class="card"><h2>Периодичность</h2><svg class="en-chart" viewBox="0 0 590 195" role="img" aria-label="Электроотрицательность по атомному номеру"><path d="M30 10V170H580" fill="none" stroke="currentColor"/>${points}<text x="4" y="20">χ</text><text x="500" y="192">Z</text></svg>${table(['Элемент', 'χ, Полинг'], sorted(entries).map((entry) => `<tr><th scope="row"><button class="table-link" data-detail="${entry.id}">${entry.label}</button></th><td>${entry.value ?? '—'}</td></tr>`))}</section>
      <form id="bond-form" class="card tool-card"><h2>Тип связи по Δχ</h2><div class="tool-grid"><label>Элемент A<select id="bond-a">${ELECTRONEGATIVITY_RECORDS.map((record) => `<option value="${record.symbol}" ${record.symbol === 'H' ? 'selected' : ''}>${record.symbol}</option>`).join('')}</select></label><label>Элемент B<select id="bond-b">${ELECTRONEGATIVITY_RECORDS.map((record) => `<option value="${record.symbol}" ${record.symbol === 'Cl' ? 'selected' : ''}>${record.symbol}</option>`).join('')}</select></label></div><button class="button primary" type="submit">Рассчитать</button></form><div id="bond-result" class="tool-result"></div>`;
    $('#bond-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const result = bondType($('#bond-a').value, $('#bond-b').value);
      $('#bond-result').textContent = `Δχ = ${formatNumber(result.delta)}. ${result.type}. ${result.direction || ''} ${result.message}`;
    });
  }

  function renderAcidBase() {
    const entries = ACID_BASE_RECORDS.map((record) => ({ id: `acid-${record.id}`, label: `${record.formula} — ${record.name}`, value: record.pKa ?? record.pKb ?? null, detail: `${record.strength}; ${record.pKa !== null ? `pKa = ${record.pKa}` : record.pKb !== null ? `pKb = ${record.pKb}` : 'Сильный электролит'}; сопряжённая форма ${record.conjugate}`, source: record.source }));
    updateItems(entries);
    $('#reference-content').innerHTML = `<section class="card"><h2>Константы при 25 °C</h2>${table(['Формула', 'Название', 'pKa / pKb', 'Ka / Kb', 'Сила'], sorted(entries).map((entry) => {
      const record = ACID_BASE_RECORDS.find((item) => `acid-${item.id}` === entry.id);
      const constant = record.pKa !== null ? 10 ** -record.pKa : record.pKb !== null ? 10 ** -record.pKb : null;
      return `<tr><th scope="row"><button class="table-link" data-detail="${entry.id}">${chemical(record.formula)}</button></th><td>${record.name}</td><td>${entry.value ?? '—'}</td><td>${constant === null ? '—' : constant.toExponential(3)}</td><td>${record.strength === 'strong' ? 'Сильная' : 'Слабая'}</td></tr>`;
    }))}</section><form id="ph-form" class="card tool-card"><h2>pH раствора</h2><div class="tool-grid"><label>Вещество<select id="ph-record">${ACID_BASE_RECORDS.map((record) => `<option value="${record.id}" ${record.id === 'acetic' ? 'selected' : ''}>${chemical(record.formula)} — ${record.name}</option>`).join('')}</select></label><label>Концентрация, моль/л<input id="ph-concentration" type="number" min="0" step="any" value="0.1"></label></div><button class="button primary" type="submit">Рассчитать pH</button></form><div id="ph-result" class="tool-result"></div><form id="buffer-form" class="card tool-card"><h2>Буфер: Гендерсон–Хассельбальх</h2><div class="tool-grid three"><label>pKa<input id="buffer-pka" type="number" step="any" value="4.76"></label><label>Кислота, М<input id="buffer-acid" type="number" min="0" step="any" value="0.1"></label><label>Основание, М<input id="buffer-base" type="number" min="0" step="any" value="0.1"></label></div><button class="button primary" type="submit">Рассчитать буфер</button></form><div id="buffer-result" class="tool-result"></div>`;
    $('#ph-form').addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        const result = calculatePH($('#ph-record').value, $('#ph-concentration').value);
        $('#ph-result').textContent = `pH = ${result.pH.toFixed(3)}${result.alpha !== null ? `; степень диссоциации α = ${(result.alpha * 100).toFixed(3)}%` : ''}\n${result.steps.join('\n')}`;
      } catch (error) { $('#ph-result').textContent = error.message; }
    });
    $('#buffer-form').addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        const result = bufferPH($('#buffer-pka').value, $('#buffer-acid').value, $('#buffer-base').value);
        $('#buffer-result').textContent = `pH = ${result.pH.toFixed(3)}\n${result.steps.join('\n')}\n${result.note}`;
      } catch (error) { $('#buffer-result').textContent = error.message; }
    });
  }

  function renderElectrodes() {
    const entries = ELECTRODE_RECORDS.map((record) => ({ id: `electrode-${record.id}`, label: `${record.element}: ${record.half}`, value: record.E0_V, detail: `E° = ${record.E0_V} В; n = ${record.electrons}; ${record.medium}`, source: record.source }));
    updateItems(entries);
    const options = ELECTRODE_RECORDS.map((record) => `<option value="${record.id}" ${record.id === 'zinc' ? 'selected' : ''}>${record.half}</option>`).join('');
    const optionsCu = ELECTRODE_RECORDS.map((record) => `<option value="${record.id}" ${record.id === 'copper' ? 'selected' : ''}>${record.half}</option>`).join('');
    $('#reference-content').innerHTML = `<section class="card"><h2>Стандартные восстановительные потенциалы</h2>${table(['Полуреакция', 'E°, В', 'n', 'Среда'], sorted(entries).map((entry) => {
      const record = ELECTRODE_RECORDS.find((item) => `electrode-${item.id}` === entry.id);
      return `<tr><th scope="row"><button class="table-link" data-detail="${entry.id}">${chemical(record.half)}</button></th><td>${record.E0_V}</td><td>${record.electrons}</td><td>${record.medium}</td></tr>`;
    }))}</section><form id="galvanic-form" class="card tool-card"><h2>Гальванический элемент / пойдёт ли ОВР?</h2><div class="tool-grid"><label>Пара 1<select id="galvanic-a">${options}</select></label><label>Пара 2<select id="galvanic-b">${optionsCu}</select></label></div><button class="button primary" type="submit">Рассчитать</button></form><div id="galvanic-result" class="tool-result"></div><form id="nernst-form" class="card tool-card"><h2>Уравнение Нернста</h2><div class="tool-grid four"><label>Пара<select id="nernst-record">${optionsCu}</select></label><label>Q<input id="nernst-q" type="number" min="0" step="any" value="1"></label><label>T, K<input id="nernst-t" type="number" min="0" step="any" value="298.15"></label></div><button class="button primary" type="submit">Рассчитать E</button></form><div id="nernst-result" class="tool-result"></div>`;
    $('#galvanic-form').addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        const result = galvanicCell($('#galvanic-a').value, $('#galvanic-b').value);
        $('#galvanic-result').textContent = `Катод: ${result.cathode.half}; анод: ${result.anode.half}\nE° = ${result.E0.toFixed(4)} В; n = ${result.electrons}; ΔG° = ${result.deltaG.toFixed(2)} кДж/моль; lg K = ${result.logK.toFixed(3)}\n${result.notation}\n${result.equation}\n${result.possible ? 'Термодинамически возможна.' : 'Не идёт в выбранном направлении.'} ${result.note}`;
        const open = document.createElement('button');
        open.className = 'button secondary';
        open.textContent = 'Открыть суммарное уравнение';
        open.type = 'button';
        open.addEventListener('click', () => onOpenEquation(result.equation));
        $('#galvanic-result').append(open);
      } catch (error) { $('#galvanic-result').textContent = error.message; }
    });
    $('#nernst-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const record = ELECTRODE_RECORDS.find((item) => item.id === $('#nernst-record').value);
      try {
        const result = nernst(record.E0_V, record.electrons, $('#nernst-q').value, $('#nernst-t').value);
        $('#nernst-result').textContent = `E = ${result.E.toFixed(6)} В\n${result.steps.join('\n')}`;
      } catch (error) { $('#nernst-result').textContent = error.message; }
    });
  }

  function renderThermo() {
    const entries = THERMO_RECORDS.filter((record) => !thermoPhase || record.phase === thermoPhase).map((record) => ({ id: `thermo-${record.id}`, label: `${record.formula} (${record.phase}) — ${record.name_ru}`, value: record.Hf_kJ_mol, detail: `ΔfH° = ${record.Hf_kJ_mol}${record.uncertainty ? ` ± ${record.uncertainty.Hf_kJ_mol}` : ''} кДж/моль; ΔfG° = ${record.Gf_kJ_mol}${record.uncertainty ? ` ± ${record.uncertainty.Gf_kJ_mol}` : ''} кДж/моль; S° = ${record.S_J_mol_K}${record.uncertainty ? ` ± ${record.uncertainty.S_J_mol_K}` : ''} Дж/(моль·K); Cp° = ${record.Cp_J_mol_K ?? '—'}${record.note ? `. ${record.note}` : ''}`, source: record.source }));
    updateItems(entries);
    $('#reference-content').innerHTML = `<section class="card"><div class="section-inline"><h2>Стандартные свойства: ${THERMO_RECORDS.length} записей</h2><label>Фаза<select id="thermo-phase"><option value="">Все</option><option value="s" ${thermoPhase === 's' ? 'selected' : ''}>Твёрдые</option><option value="l" ${thermoPhase === 'l' ? 'selected' : ''}>Жидкие</option><option value="g" ${thermoPhase === 'g' ? 'selected' : ''}>Газы</option><option value="aq" ${thermoPhase === 'aq' ? 'selected' : ''}>Водные ионы</option></select></label></div><p class="help-text">298,15 K, 1 бар. Для простых веществ в стандартном состоянии ΔfH° = 0 и ΔfG° = 0.</p>${table(['Формула', 'Название', 'Фаза', 'ΔfH°, кДж/моль', 'ΔfG°, кДж/моль', 'S°, Дж/(моль·K)'], sorted(entries).map((entry) => {
      const record = THERMO_RECORDS.find((item) => `thermo-${item.id}` === entry.id);
      return `<tr><th scope="row"><button class="table-link" data-detail="${entry.id}">${chemical(record.formula)}</button></th><td>${escapeHtml(record.name_ru)}</td><td>${phaseName[record.phase]}</td><td>${record.Hf_kJ_mol}</td><td>${record.Gf_kJ_mol}</td><td>${record.S_J_mol_K}</td></tr>`;
    }))}</section><form id="hess-form" class="card tool-card"><h2>Расчёт реакции по закону Гесса</h2><label>Уравнение<input id="hess-equation" class="equation-input" value="2H2 + O2 = 2H2O" spellcheck="false"></label><div class="tool-grid"><label>T, K<input id="hess-temperature" type="number" min="0" step="any" value="298.15"></label><button id="hess-current" class="button ghost" type="button">Взять из калькулятора</button></div><button class="button primary" type="submit">Рассчитать ΔH°, ΔS°, ΔG° и K</button></form><div id="hess-result" class="tool-result"></div>`;
    $('#thermo-phase').addEventListener('change', (event) => { thermoPhase = event.target.value; renderThermo(); });
    $('#hess-current').addEventListener('click', () => { $('#hess-equation').value = getCurrentEquation(); });
    $('#hess-form').addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        const result = calculateReactionThermo($('#hess-equation').value, { temperatureK: $('#hess-temperature').value });
        const output = $('#hess-result');
        if (result.status !== 'ok') { output.textContent = result.message; return; }
        output.textContent = `ΔH° = ${result.deltaH} кДж; ΔS° = ${result.deltaS} Дж/K; ΔG°(298) = ${result.deltaG} кДж; K = ${formatNumber(result.K)}\nΔG(${result.temperature} K) ≈ ${result.deltaG_T} кДж. ${result.effect}. ${result.spontaneous}.\nТемпература ΔG = 0: ${result.transitionK ? `${result.transitionK} K` : 'не определена в модели'}.\n${result.steps.join('\n')}\n${result.note}`;
        output.insertAdjacentHTML('beforeend', svgThermoCurve(result.curve));
      } catch (error) { $('#hess-result').textContent = error.message; }
    });
  }

  function render() {
    const definition = REFERENCES.find((item) => item.id === current);
    $('#reference-source').textContent = `Источник: ${current === 'thermo' ? THERMO_SOURCE : REFERENCE_SOURCES[current]}`;
    $('#reference-nav').querySelectorAll('button').forEach((button) => button.setAttribute('aria-current', String(button.dataset.reference === current)));
    $('#reference-select').value = current;
    $('#reference-content').dataset.reference = current;
    ({ solubility: renderSolubility, activity: renderActivity, electronegativity: renderElectronegativity, 'acid-base': renderAcidBase, electrodes: renderElectrodes, thermo: renderThermo })[current]();
    document.querySelectorAll('[data-panel="references"] [data-i18n]').forEach(() => {});
  }

  function selectReference(id, updateHash = true) {
    if (!REFERENCES.some((item) => item.id === id)) return;
    current = id;
    storage.setItem('chemcalc-reference-tab', id);
    $('#reference-search').value = '';
    $('#reference-sort').value = 'default';
    if (updateHash) history.replaceState(null, '', `#${id}`);
    render();
  }

  for (const definition of REFERENCES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.reference = definition.id;
    button.innerHTML = `<span aria-hidden="true">${definition.symbol}</span><span>${definition.label}</span>`;
    button.addEventListener('click', () => selectReference(definition.id));
    $('#reference-nav').append(button);
    const option = document.createElement('option');
    option.value = definition.id;
    option.textContent = definition.label;
    $('#reference-select').append(option);
  }
  $('#reference-select').addEventListener('change', (event) => selectReference(event.target.value));
  $('#reference-search').addEventListener('input', render);
  $('#reference-sort').addEventListener('change', render);
  $('#reference-compare-a').addEventListener('change', renderComparison);
  $('#reference-compare-b').addEventListener('change', renderComparison);
  $('#reference-print').addEventListener('click', () => window.print());
  $('#reference-explain').addEventListener('click', () => showDetail(REFERENCES.find((item) => item.id === current).label, current === 'solubility' ? 'Р — растворимо, М — малорастворимо, Н — нерастворимо, ? — нет данных. Щелчок по ячейке открывает подробности.' : 'Численные значения действительны только при условиях, указанных под названием справочника. — означает отсутствие данных.', REFERENCE_SOURCES[current] || THERMO_SOURCE));
  $('#reference-detail-close').addEventListener('click', () => $('#reference-detail').close());
  $('#reference-content').addEventListener('click', (event) => {
    const ion = event.target.closest('[data-cation]');
    if (ion) {
      const result = checkIonPair(ion.dataset.cation, ion.dataset.anion);
      history.replaceState(null, '', `#solubility-${ion.dataset.cation}-${ion.dataset.anion}`);
      showDetail(result.formula, `${result.explanation}\nKsp при 25 °C: ${result.record?.ksp ?? '—'}\nИсточник растворимости: ${result.record?.source || 'нет данных'}`, result.record?.kspSource || result.record?.source, () => onOpenFormula(result.formula));
      return;
    }
    const detail = event.target.closest('[data-detail]');
    if (detail) {
      const item = items.find((entry) => entry.id === detail.dataset.detail);
      if (item) {
        history.replaceState(null, '', `#${item.id.replace(/^sol-/, 'solubility-')}`);
        showDetail(item.label, item.detail, item.source, item.formula ? () => onOpenFormula(item.formula) : null);
      }
    }
  });
  const hash = location.hash.slice(1);
  const hashReference = REFERENCES.find((item) => hash === item.id || hash.startsWith(`${item.id}-`));
  selectReference(hashReference?.id || storage.getItem('chemcalc-reference-tab') || 'solubility', false);
  return { selectReference, render };
}
