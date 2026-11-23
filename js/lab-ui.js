import acidBaseData from '../data/acid-base-constants.json' with { type: 'json' };
import substancesData from '../data/substances.json' with { type: 'json' };
import { getLocale } from './i18n.js';
import { element, button } from './dom.js';
import {
  bufferFromTarget, convertUnits, dilution, prepareFromMassFraction,
  prepareFromSolid, unitsForGroup
} from './lab.js';

const ACIDS = acidBaseData.records
  .filter((record) => record.type === 'acid' && Number.isFinite(record.pKa))
  .sort((left, right) => left.pKa - right.pKa);
const SUBSTANCES = substancesData.items.filter((item) => item.class !== 'invalid');

const COPY = {
  ru: {
    title: 'Лаборатория',
    subtitle: 'Растворы, единицы и буферные системы',
    solutions: 'Растворы',
    units: 'Единицы',
    buffers: 'Буферы',
    prepare: 'Приготовить',
    dilute: 'Разбавить',
    percent: 'Массовая доля',
    formula: 'Формула вещества',
    formulaPlaceholder: 'Например, NaCl или CuSO4·5H2O',
    target: 'Нужная концентрация',
    concentrationUnit: 'Единица концентрации',
    volume: 'Объём раствора',
    volumeUnit: 'Единица объёма',
    purity: 'Чистота вещества, %',
    density: 'Плотность раствора, г/мл',
    massPercent: 'Массовая доля, %',
    stockConcentration: 'Концентрация исходного раствора',
    finalConcentration: 'Нужная концентрация',
    finalVolume: 'Нужный объём',
    calculate: 'Рассчитать',
    result: 'Результат',
    molarMass: 'Молярная масса',
    moles: 'Количество вещества',
    pureMass: 'Масса чистого вещества',
    weigh: 'Навеска с учётом чистоты',
    solutionMass: 'Масса раствора',
    molarity: 'Молярность',
    stockVolume: 'Объём исходного раствора',
    solventVolume: 'Добавить растворителя',
    finalVolumeResult: 'Итоговый объём',
    prepareNote: 'Доведите раствор растворителем до нужного объёма в мерной колбе. Не добавляйте весь растворитель сразу.',
    category: 'Величина',
    from: 'Из',
    to: 'В',
    value: 'Значение',
    converted: 'Результат',
    mass: 'Масса',
    volumeLabel: 'Объём',
    amount: 'Количество вещества',
    molar: 'Молярная концентрация',
    massConcentration: 'Массовая концентрация',
    bufferPair: 'Кислота / сопряжённое основание',
    customPair: 'Другое значение pKa',
    pKa: 'pKa',
    targetPh: 'Целевой pH',
    totalConcentration: 'Суммарная концентрация буфера, моль/л',
    bufferResult: 'Состав буфера',
    baseRatio: 'Соотношение основание / кислота',
    acidFraction: 'Доля кислоты',
    baseFraction: 'Доля основания',
    acidConcentration: 'Концентрация кислоты',
    baseConcentration: 'Концентрация основания',
    acidMoles: 'Моль кислоты',
    baseMoles: 'Моль основания',
    weakCapacity: 'pH слишком далеко от pKa: буферная ёмкость будет низкой.',
    invalidFormula: 'Проверьте химическую формулу.',
    labPositive: 'Значение должно быть больше нуля.',
    labPercentRange: 'Процент должен быть в диапазоне от 0 до 100.',
    labDilutionImpossible: 'Исходный раствор должен быть концентрированнее конечного.',
    labIncompatibleUnits: 'Выбраны единицы разных величин.',
    labUnknownUnit: 'Неизвестная единица измерения.',
    labFormulaRequired: 'Для этой единицы нужна формула вещества.',
    labInvalidPka: 'pKa должен быть в разумном диапазоне.',
    labInvalidPh: 'pH должен быть от 0 до 14.',
    labInvalidNumber: 'Введите число.',
    methodInfo: 'Методика и примеры',
    infoFormula: 'Формула',
    infoSteps: 'Порядок работы',
    infoExample: 'Пример',
    close: 'Закрыть',
    educational: 'Учебные расчёты. Проверяйте единицы и условия эксперимента.'
  },
  en: {
    title: 'Laboratory',
    subtitle: 'Solutions, units and buffer systems',
    solutions: 'Solutions',
    units: 'Units',
    buffers: 'Buffers',
    prepare: 'Prepare',
    dilute: 'Dilute',
    percent: 'Mass fraction',
    formula: 'Substance formula',
    formulaPlaceholder: 'For example, NaCl or CuSO4·5H2O',
    target: 'Target concentration',
    concentrationUnit: 'Concentration unit',
    volume: 'Solution volume',
    volumeUnit: 'Volume unit',
    purity: 'Purity, %',
    density: 'Solution density, g/mL',
    massPercent: 'Mass fraction, %',
    stockConcentration: 'Stock concentration',
    finalConcentration: 'Target concentration',
    finalVolume: 'Target volume',
    calculate: 'Calculate',
    result: 'Result',
    molarMass: 'Molar mass',
    moles: 'Amount of substance',
    pureMass: 'Pure substance mass',
    weigh: 'Mass to weigh (with purity)',
    solutionMass: 'Solution mass',
    molarity: 'Molarity',
    stockVolume: 'Stock volume',
    solventVolume: 'Solvent to add',
    finalVolumeResult: 'Final volume',
    prepareNote: 'Bring the solution to the final volume in a volumetric flask. Do not add all solvent at once.',
    category: 'Quantity',
    from: 'From',
    to: 'To',
    value: 'Value',
    converted: 'Result',
    mass: 'Mass',
    volumeLabel: 'Volume',
    amount: 'Amount of substance',
    molar: 'Molar concentration',
    massConcentration: 'Mass concentration',
    bufferPair: 'Acid / conjugate base',
    customPair: 'Custom pKa',
    pKa: 'pKa',
    targetPh: 'Target pH',
    totalConcentration: 'Total buffer concentration, mol/L',
    bufferResult: 'Buffer composition',
    baseRatio: 'Base / acid ratio',
    acidFraction: 'Acid fraction',
    baseFraction: 'Base fraction',
    acidConcentration: 'Acid concentration',
    baseConcentration: 'Base concentration',
    acidMoles: 'Acid moles',
    baseMoles: 'Base moles',
    weakCapacity: 'pH is too far from pKa: buffer capacity will be low.',
    invalidFormula: 'Check the chemical formula.',
    labPositive: 'The value must be greater than zero.',
    labPercentRange: 'The percentage must be between 0 and 100.',
    labDilutionImpossible: 'The stock solution must be more concentrated than the final one.',
    labIncompatibleUnits: 'The selected units measure different quantities.',
    labUnknownUnit: 'Unknown unit.',
    labFormulaRequired: 'This unit requires a chemical formula.',
    labInvalidPka: 'pKa is outside a reasonable range.',
    labInvalidPh: 'pH must be between 0 and 14.',
    labInvalidNumber: 'Enter a number.',
    methodInfo: 'Method and examples',
    infoFormula: 'Formula',
    infoSteps: 'Procedure',
    infoExample: 'Example',
    close: 'Close',
    educational: 'Educational calculations. Check units and experimental conditions.'
  }
};

const INFO = {
  ru: {
    prepare: {
      title: 'Приготовление раствора',
      intro: 'Сначала рассчитайте массу вещества, затем растворите её в небольшом объёме растворителя и доведите объём до метки в мерной колбе.',
      formula: 'm = C × V × M / чистота',
      steps: ['Переведите объём в литры.', 'Найдите молярную массу по формуле.', 'Рассчитайте количество вещества и массу.', 'Учтите чистоту и доведите объём в мерной колбе.'],
      example: 'Для 100 мл 0,9 г/л NaCl нужно 0,09 г NaCl. При чистоте 90% навеска составит 0,10 г.'
    },
    dilute: {
      title: 'Разбавление раствора',
      intro: 'Количество растворённого вещества при разбавлении не меняется. Поэтому произведение концентрации на объём сохраняется.',
      formula: 'C₁ × V₁ = C₂ × V₂',
      steps: ['Приведите концентрации к одной единице.', 'Вычислите объём исходного раствора.', 'Добавьте растворитель до конечного объёма.', 'Перемешайте раствор.'],
      example: 'Из 1 М раствора нужно получить 100 мл 0,1 М: взять 10 мл исходного раствора и добавить 90 мл растворителя.'
    },
    percent: {
      title: 'Массовая доля',
      intro: 'Массовая доля показывает, сколько граммов вещества содержится в 100 г раствора. Для перехода к объёму нужна плотность раствора.',
      formula: 'm(вещества) = V × ρ × w / 100',
      steps: ['Переведите объём в миллилитры.', 'Найдите массу раствора по плотности.', 'Умножьте на массовую долю.', 'При необходимости пересчитайте в молярность.'],
      example: '100 мл раствора с плотностью 1,0 г/мл и массовой долей 0,9% содержит 0,9 г NaCl.'
    },
    units: {
      title: 'Перевод единиц',
      intro: 'Переводить можно только величины одного типа: массу в массу, объём в объём, количество вещества в количество вещества. Молярность и массовая концентрация — разные величины.',
      formula: 'значение × коэффициент(из) / коэффициент(в)',
      steps: ['Выберите физическую величину.', 'Укажите исходную и конечную единицу.', 'Проверьте, что единицы одного типа.', 'Сравните порядок результата с ожидаемым.'],
      example: '1 г = 1000 мг; 1 л = 1000 мл; 1 моль/л = 1000 ммоль/л.'
    },
    buffers: {
      title: 'Буферные системы',
      intro: 'Буфер состоит из слабой кислоты и её сопряжённого основания. Соотношение компонентов задаёт pH, а суммарная концентрация — буферную ёмкость.',
      formula: 'pH = pKa + log₁₀([основание] / [кислота])',
      steps: ['Выберите пару кислота/основание или задайте pKa.', 'Вычислите отношение основание/кислота.', 'Распределите общую концентрацию между компонентами.', 'Проверьте, что pH близок к pKa.'],
      example: 'При pKa 7,2 и pH 7,4 отношение основание/кислота равно 1,58; при общей концентрации 0,1 М основание составляет 0,061 М, кислота — 0,039 М.'
    }
  },
  en: {
    prepare: {
      title: 'Preparing a solution',
      intro: 'Calculate the mass first, dissolve it in a small amount of solvent, then bring the volume to the mark in a volumetric flask.',
      formula: 'm = C × V × M / purity',
      steps: ['Convert volume to litres.', 'Find the molar mass from the formula.', 'Calculate amount of substance and mass.', 'Account for purity and bring to volume.'],
      example: 'For 100 mL of 0.9 g/L NaCl you need 0.09 g. At 90% purity the weighed mass is 0.10 g.'
    },
    dilute: {
      title: 'Diluting a solution',
      intro: 'The amount of solute does not change during dilution, so concentration times volume is constant.',
      formula: 'C₁ × V₁ = C₂ × V₂',
      steps: ['Convert concentrations to the same unit.', 'Calculate the stock volume.', 'Add solvent to the final volume.', 'Mix the solution.'],
      example: 'To make 100 mL of 0.1 M from 1 M stock, take 10 mL of stock and add 90 mL of solvent.'
    },
    percent: {
      title: 'Mass fraction',
      intro: 'Mass fraction is the mass of solute in 100 g of solution. Density is needed to relate it to volume.',
      formula: 'm(solute) = V × ρ × w / 100',
      steps: ['Convert volume to millilitres.', 'Find solution mass from density.', 'Multiply by mass fraction.', 'Convert to molarity if needed.'],
      example: '100 mL of solution with density 1.0 g/mL and mass fraction 0.9% contains 0.9 g NaCl.'
    },
    units: {
      title: 'Unit conversion',
      intro: 'Only quantities of the same kind can be converted: mass to mass, volume to volume, amount to amount. Molarity and mass concentration are different quantities.',
      formula: 'value × factor(from) / factor(to)',
      steps: ['Choose the quantity.', 'Select source and target units.', 'Check that the units are compatible.', 'Check the order of magnitude.'],
      example: '1 g = 1000 mg; 1 L = 1000 mL; 1 mol/L = 1000 mmol/L.'
    },
    buffers: {
      title: 'Buffer systems',
      intro: 'A buffer contains a weak acid and its conjugate base. Their ratio sets pH; total concentration affects buffer capacity.',
      formula: 'pH = pKa + log₁₀([base] / [acid])',
      steps: ['Choose an acid/base pair or set pKa.', 'Calculate the base/acid ratio.', 'Split total concentration between components.', 'Check that pH is close to pKa.'],
      example: 'At pKa 7.2 and pH 7.4 the base/acid ratio is 1.58; at 0.1 M total, base is 0.061 M and acid is 0.039 M.'
    }
  }
};

const text = (key, values = {}) => {
  const template = COPY[getLocale()]?.[key] || COPY.ru[key] || key;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
};

function format(value, digits = 5) {
  return new Intl.NumberFormat(getLocale(), { maximumSignificantDigits: digits }).format(value);
}

function formatVolume(liters) {
  if (Math.abs(liters) < 0.001) return `${format(liters * 1_000_000)} µL`;
  if (Math.abs(liters) < 1) return `${format(liters * 1000)} mL`;
  return `${format(liters)} L`;
}

function field(labelText, control, hint = '') {
  const label = element('label', 'lab-field');
  label.append(element('span', 'lab-field-label', labelText), control);
  if (hint) label.append(element('small', 'help-text', hint));
  return label;
}

function numberInput(value, step = 'any', min = '') {
  const input = element('input', 'equation-input lab-input');
  input.type = 'number';
  input.step = step;
  if (min !== '') input.min = min;
  input.value = String(value);
  input.autocomplete = 'off';
  return input;
}

function formulaInput(value, placeholder = '') {
  const input = numberInput(value);
  input.type = 'text';
  input.placeholder = placeholder;
  input.setAttribute('list', 'lab-substances');
  return input;
}

function select(options, value) {
  const node = element('select', 'lab-select');
  for (const option of options) {
    const item = document.createElement('option');
    item.value = option.value;
    item.textContent = option.label;
    if (String(option.value) === String(value)) item.selected = true;
    node.append(item);
  }
  return node;
}

function formRow(...nodes) {
  const row = element('div', 'lab-row');
  row.append(...nodes);
  return row;
}

function errorMessage(error) {
  return text(error?.code || 'labInvalidNumber');
}

function renderResult(container, title, rows, note = '', warning = '') {
  container.replaceChildren();
  container.hidden = false;
  container.append(element('h3', '', title));
  if (warning) container.append(element('p', 'lab-warning', warning));
  const grid = element('div', 'lab-result-grid');
  for (const [label, value] of rows) {
    const item = element('div', 'lab-result-item');
    item.append(element('span', 'lab-result-label', label), element('strong', '', value));
    grid.append(item);
  }
  container.append(grid);
  if (note) container.append(element('p', 'help-text', note));
}

export function initLabUI({ showToast = () => {} } = {}) {
  const root = document.getElementById('lab-app');
  if (!root) return;
  let tool = 'solutions';
  let solutionMode = 'prepare';
  const infoDialog = document.getElementById('lab-info-dialog');
  const infoContent = document.getElementById('lab-info-content');

  if (!document.getElementById('lab-substances')) {
    const list = element('datalist');
    list.id = 'lab-substances';
    for (const substance of SUBSTANCES) {
      const option = document.createElement('option');
      option.value = substance.formula;
      option.label = substance.name_ru;
      list.append(option);
    }
    document.body.append(list);
  }

  function openInfo(topic) {
    if (!infoDialog || !infoContent) return;
    const language = getLocale() === 'en' ? 'en' : 'ru';
    const data = INFO[language]?.[topic] || INFO.ru[topic];
    if (!data) return;
    infoContent.replaceChildren();
    const head = element('div', 'dialog-heading');
    const title = element('h2', '', data.title);
    title.id = 'lab-info-title';
    const close = button('×', 'icon-button');
    close.setAttribute('aria-label', text('close'));
    close.addEventListener('click', () => infoDialog.close());
    head.append(title, close);
    const body = element('div', 'lab-info-content');
    body.append(element('p', '', data.intro));
    const formula = element('p', 'lab-info-formula');
    formula.append(element('strong', '', text('infoFormula')), document.createTextNode(`: ${data.formula}`));
    body.append(formula);
    const steps = element('ol', 'lab-info-steps');
    for (const step of data.steps) steps.append(element('li', '', step));
    body.append(element('h3', '', text('infoSteps')), steps);
    const example = element('div', 'lab-info-example');
    example.append(element('strong', '', text('infoExample')), element('p', '', data.example));
    body.append(example);
    infoContent.append(head, body);
    if (!infoDialog.open) infoDialog.showModal();
  }

  function infoButton(topic) {
    const node = button('i', 'lab-info-button');
    node.setAttribute('aria-label', text('methodInfo'));
    node.title = text('methodInfo');
    node.addEventListener('click', () => openInfo(topic));
    return node;
  }

  function cardHead(title, topic) {
    const head = element('div', 'lab-card-head');
    head.append(element('h2', '', title), infoButton(topic));
    return head;
  }

  infoDialog?.addEventListener('click', (event) => { if (event.target === infoDialog) infoDialog.close(); });

  function toolbar() {
    const bar = element('div', 'lab-toolbar');
    for (const [key, label] of [['solutions', text('solutions')], ['units', text('units')], ['buffers', text('buffers')]]) {
      const tab = button(label, `lab-tab${tool === key ? ' active' : ''}`);
      tab.addEventListener('click', () => { tool = key; render(); });
      bar.append(tab);
    }
    return bar;
  }

  function solutionSubbar() {
    const bar = element('div', 'lab-subbar');
    for (const [key, label] of [['prepare', text('prepare')], ['dilute', text('dilute')], ['percent', text('percent')]]) {
      const tab = button(label, `lab-subtab${solutionMode === key ? ' active' : ''}`);
      tab.addEventListener('click', () => { solutionMode = key; render(); });
      bar.append(tab);
    }
    return bar;
  }

  function renderSolutions() {
    const card = element('section', 'card lab-card');
    card.append(cardHead(text('solutions'), solutionMode));
    card.append(solutionSubbar());
    const form = element('form', 'lab-form');
    const result = element('div', 'lab-result');
    result.hidden = true;
    const calculate = button(text('calculate'), 'button primary', 'submit');
    const actions = element('div', 'lab-actions');
    actions.append(calculate);

    if (solutionMode === 'prepare') {
      const formula = formulaInput('NaCl', text('formulaPlaceholder'));
      const target = numberInput(0.9);
      const targetUnit = select([{ value: 'g/L', label: 'g/L' }, { value: 'mol/L', label: 'mol/L' }, { value: 'mmol/L', label: 'mmol/L' }], 'g/L');
      const volume = numberInput(100);
      const volumeUnit = select([{ value: 'mL', label: 'mL' }, { value: 'L', label: 'L' }], 'mL');
      const purity = numberInput(100);
      form.append(
        field(text('formula'), formula),
        formRow(field(text('target'), target), field(text('concentrationUnit'), targetUnit)),
        formRow(field(text('volume'), volume), field(text('volumeUnit'), volumeUnit)),
        field(text('purity'), purity)
      );
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        try {
          const data = prepareFromSolid({ formula: formula.value, target: target.value, targetUnit: targetUnit.value, volume: volume.value, volumeUnit: volumeUnit.value, purity: purity.value });
          renderResult(result, text('result'), [
            [text('molarMass'), `${format(data.molarMass)} g/mol`],
            [text('moles'), `${format(data.moles)} mol`],
            [text('pureMass'), `${format(data.pureMass)} g`],
            [text('weigh'), `${format(data.stockMass)} g`]
          ], text('prepareNote'));
        } catch (error) { showToast(errorMessage(error)); }
      });
    } else if (solutionMode === 'dilute') {
      const stock = numberInput(1);
      const stockUnit = select([{ value: 'mol/L', label: 'mol/L' }, { value: 'mmol/L', label: 'mmol/L' }, { value: 'g/L', label: 'g/L' }, { value: 'mg/L', label: 'mg/L' }], 'mol/L');
      const final = numberInput(0.1);
      const finalUnit = select([{ value: 'mol/L', label: 'mol/L' }, { value: 'mmol/L', label: 'mmol/L' }, { value: 'g/L', label: 'g/L' }, { value: 'mg/L', label: 'mg/L' }], 'mol/L');
      const volume = numberInput(100);
      const volumeUnit = select([{ value: 'mL', label: 'mL' }, { value: 'L', label: 'L' }], 'mL');
      form.append(
        formRow(field(text('stockConcentration'), stock), field(text('concentrationUnit'), stockUnit)),
        formRow(field(text('finalConcentration'), final), field(text('concentrationUnit'), finalUnit)),
        formRow(field(text('finalVolume'), volume), field(text('volumeUnit'), volumeUnit))
      );
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        try {
          const data = dilution({ stockConcentration: stock.value, stockUnit: stockUnit.value, finalConcentration: final.value, finalUnit: finalUnit.value, finalVolume: volume.value, finalVolumeUnit: volumeUnit.value });
          renderResult(result, text('result'), [
            [text('stockVolume'), formatVolume(data.stockVolumeL)],
            [text('solventVolume'), formatVolume(data.solventVolumeL)],
            [text('finalVolumeResult'), formatVolume(data.finalVolumeL)]
          ]);
        } catch (error) { showToast(errorMessage(error)); }
      });
    } else {
      const formula = formulaInput('NaCl', text('formulaPlaceholder'));
      const percent = numberInput(0.9);
      const density = numberInput(1.0);
      const volume = numberInput(100);
      const volumeUnit = select([{ value: 'mL', label: 'mL' }, { value: 'L', label: 'L' }], 'mL');
      const purity = numberInput(100);
      form.append(
        field(text('formula'), formula),
        field(text('massPercent'), percent),
        field(text('density'), density),
        formRow(field(text('volume'), volume), field(text('volumeUnit'), volumeUnit)),
        field(text('purity'), purity)
      );
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        try {
          const data = prepareFromMassFraction({ formula: formula.value, massPercent: percent.value, density: density.value, volume: volume.value, volumeUnit: volumeUnit.value, purity: purity.value });
          renderResult(result, text('result'), [
            [text('molarMass'), `${format(data.molarMass)} g/mol`],
            [text('solutionMass'), `${format(data.solutionMass)} g`],
            [text('pureMass'), `${format(data.pureMass)} g`],
            [text('weigh'), `${format(data.stockMass)} g`],
            [text('molarity'), `${format(data.molarity)} mol/L`]
          ]);
        } catch (error) { showToast(errorMessage(error)); }
      });
    }

    form.append(actions);
    card.append(form, result);
    return card;
  }

  function renderUnits() {
    const card = element('section', 'card lab-card');
    card.append(cardHead(text('units'), 'units'));
    const form = element('form', 'lab-form');
    const result = element('div', 'lab-result');
    result.hidden = true;
    const category = select([
      { value: 'mass', label: text('mass') },
      { value: 'volume', label: text('volumeLabel') },
      { value: 'amount', label: text('amount') },
      { value: 'molar', label: text('molar') },
      { value: 'massConcentration', label: text('massConcentration') }
    ], 'mass');
    const from = select(unitsForGroup('mass').map((unit) => ({ value: unit, label: unit })), 'g');
    const to = select(unitsForGroup('mass').map((unit) => ({ value: unit, label: unit })), 'mg');
    const value = numberInput(1);
    const repopulate = () => {
      const units = unitsForGroup(category.value);
      from.replaceChildren();
      to.replaceChildren();
      for (const unit of units) {
        from.append(new Option(unit, unit));
        to.append(new Option(unit, unit));
      }
      from.value = units[0];
      to.value = units[1] || units[0];
    };
    category.addEventListener('change', repopulate);
    const actions = element('div', 'lab-actions');
    actions.append(button(text('calculate'), 'button primary', 'submit'));
    form.append(
      field(text('category'), category),
      formRow(field(text('from'), from), field(text('to'), to)),
      field(text('value'), value),
      actions
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        const converted = convertUnits(value.value, from.value, to.value);
        renderResult(result, text('converted'), [[`${from.value} → ${to.value}`, `${format(converted)} ${to.value}`]]);
      } catch (error) { showToast(errorMessage(error)); }
    });
    card.append(form, result);
    return card;
  }

  function renderBuffers() {
    const card = element('section', 'card lab-card');
    card.append(cardHead(text('buffers'), 'buffers'));
    const form = element('form', 'lab-form');
    const result = element('div', 'lab-result');
    result.hidden = true;
    const options = ACIDS.map((record) => ({ value: record.formula, label: `${record.name} · pKa ${record.pKa}` }));
    options.push({ value: 'custom', label: text('customPair') });
    const pair = select(options, 'H2PO4^-');
    const pKa = numberInput(7.2);
    const targetPh = numberInput(7.4);
    const total = numberInput(0.1);
    const volume = numberInput(100);
    const volumeUnit = select([{ value: 'mL', label: 'mL' }, { value: 'L', label: 'L' }], 'mL');
    pair.addEventListener('change', () => {
      const record = ACIDS.find((item) => item.formula === pair.value);
      if (record) pKa.value = String(record.pKa);
    });
    const actions = element('div', 'lab-actions');
    actions.append(button(text('calculate'), 'button primary', 'submit'));
    form.append(
      field(text('bufferPair'), pair),
      formRow(field(text('pKa'), pKa), field(text('targetPh'), targetPh)),
      field(text('totalConcentration'), total),
      formRow(field(text('volume'), volume), field(text('volumeUnit'), volumeUnit)),
      actions
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        const data = bufferFromTarget({ pKa: pKa.value, targetPh: targetPh.value, totalConcentration: total.value, volume: volume.value, volumeUnit: volumeUnit.value });
        renderResult(result, text('bufferResult'), [
          [text('baseRatio'), format(data.ratio)],
          [text('acidFraction'), `${format(data.acidFraction * 100)} %`],
          [text('baseFraction'), `${format(data.baseFraction * 100)} %`],
          [text('acidConcentration'), `${format(data.acidConcentration)} mol/L`],
          [text('baseConcentration'), `${format(data.baseConcentration)} mol/L`],
          [text('acidMoles'), `${format(data.acidMoles)} mol`],
          [text('baseMoles'), `${format(data.baseMoles)} mol`]
        ], '', data.weakCapacity ? text('weakCapacity') : '');
      } catch (error) { showToast(errorMessage(error)); }
    });
    card.append(form, result);
    return card;
  }

  function render() {
    root.replaceChildren();
    root.append(toolbar());
    if (tool === 'solutions') root.append(renderSolutions());
    else if (tool === 'units') root.append(renderUnits());
    else root.append(renderBuffers());
    root.append(element('p', 'help-text lab-disclaimer', text('educational')));
  }

  render();
  return { render };
}
