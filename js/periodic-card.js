import { equationToUnicode, parseEquation } from './parser.js';

function hasValue(value) {
  return value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0);
}

function textValue(value, unit = '') {
  if (!hasValue(value)) return '—';
  const text = Array.isArray(value) ? value.join(', ') : String(value);
  return `${text}${unit ? ` ${unit}` : ''}`;
}

function addRow(list, label, value, unit = '') {
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = textValue(value, unit);
  if (!hasValue(value)) {
    const note = document.createElement('small');
    note.textContent = 'нет данных';
    description.append(document.createElement('br'), note);
  }
  list.append(term, description);
}

function makeSection(id, title) {
  const section = document.createElement('section');
  section.id = `element-${id}`;
  section.className = 'element-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  section.append(heading);
  return section;
}

function propertySection(id, title, rows) {
  const section = makeSection(id, title);
  const list = document.createElement('dl');
  list.className = 'property-list';
  rows.forEach((row) => addRow(list, ...row));
  section.append(list);
  return section;
}

function textSection(id, title, entries) {
  const section = makeSection(id, title);
  for (const [label, value] of entries) {
    const paragraph = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `${label}: `;
    paragraph.append(strong, document.createTextNode(hasValue(value) ? String(value) : '— (нет данных)'));
    section.append(paragraph);
  }
  return section;
}

function listSection(id, title, items, emptyText = 'Сведения отсутствуют в локальной базе.') {
  const section = makeSection(id, title);
  if (!hasValue(items)) {
    const empty = document.createElement('p');
    empty.className = 'no-data';
    empty.textContent = emptyText;
    section.append(empty);
    return section;
  }
  const list = document.createElement('ul');
  for (const text of items) {
    const item = document.createElement('li');
    item.textContent = text;
    list.append(item);
  }
  section.append(list);
  return section;
}

function shellDiagram(shells) {
  const container = document.createElement('div');
  container.className = 'shell-diagram';
  const circles = shells.map((count, index) => {
    const radius = 22 + index * 13;
    return `<circle cx="120" cy="120" r="${radius}"></circle><text x="120" y="${120 - radius + 4}">${count}</text>`;
  }).join('');
  container.innerHTML = `<svg viewBox="0 0 240 240" role="img" aria-label="Электроны по оболочкам: ${shells.join(', ')}"><circle class="nucleus" cx="120" cy="120" r="10"></circle>${circles}</svg>`;
  return container;
}

function oxidationText(element) {
  if (!element.oxidation_states.length) return null;
  return element.oxidation_states.map((state) => {
    const signed = `${state > 0 ? '+' : ''}${state}`;
    return element.typical_oxidation_states.includes(state) ? `${signed} (типичная)` : signed;
  }).join(', ');
}

export function renderElementCard(element, { onInsert, onReaction }) {
  const root = document.createElement('div');
  root.className = 'element-card-body';
  const nav = document.createElement('nav');
  nav.className = 'element-anchor-nav';
  nav.setAttribute('aria-label', 'Разделы карточки элемента');
  const sections = [
    ['general', 'Общее'], ['physical', 'Физика'], ['chemical', 'Химия'], ['isotopes', 'Изотопы'], ['history', 'История'], ['nature', 'Природа'], ['applications', 'Применение'], ['safety', 'Безопасность'], ['facts', 'Факты'], ['sources', 'Источники']
  ];
  for (const [id, label] of sections) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.cardSection = id;
    button.textContent = label;
    nav.append(button);
  }
  root.append(nav);

  const general = propertySection('general', '1. Общие сведения', [
    ['Символ', element.symbol], ['Название', element.name_ru], ['Название (англ.)', element.name_en], ['Название (лат.)', element.name_lat],
    ['Атомный номер', element.number], ['Атомная масса', element.atomic_mass, 'у.е.'], ['Группа', element.group], ['Период', element.period],
    ['Блок', element.block], ['Категория', element.category_ru], ['Агрегатное состояние при н. у.', { solid: 'Твёрдое', liquid: 'Жидкое', gas: 'Газообразное', unknown: null }[element.phase_stp]],
    ['Полная электронная конфигурация', element.electron_configuration], ['Сокращённая конфигурация', element.electron_configuration_short]
  ]);
  general.append(shellDiagram(element.shells));
  if (!element.configuration_confirmed) {
    const note = document.createElement('p');
    note.className = 'no-data';
    note.textContent = 'Электронная конфигурация по исходному набору ещё не подтверждена экспериментально.';
    general.append(note);
  }
  root.append(general);

  root.append(propertySection('physical', '2. Физические свойства', [
    ['Цвет / внешний вид', element.color], ['Внешний вид в источнике (англ.)', element.appearance_en],
    ['Плотность', element.density, element.density_unit], ['Температура плавления', element.melt_K, 'K'], ['Температура кипения', element.boil_K, 'K'],
    ['Молярная теплоёмкость', element.molar_heat, 'Дж/(моль·K)'], ['Теплота плавления', element.fusion_heat, 'кДж/моль'], ['Теплота парообразования', element.vaporization_heat, 'кДж/моль'],
    ['Теплопроводность', element.thermal_conductivity, 'Вт/(м·K)'], ['Удельное сопротивление', element.electrical_resistivity, 'Ом·м'],
    ['Кристаллическая решётка', element.crystal_structure], ['Твёрдость', element.hardness], ['Магнитные свойства', element.magnetic_properties]
  ]));

  const chemical = propertySection('chemical', '3. Химические свойства', [
    ['Степени окисления', oxidationText(element)], ['Электроотрицательность (Полинг)', element.electronegativity],
    ['Энергии ионизации', element.ionization_energies, 'кДж/моль'], ['Сродство к электрону', element.electron_affinity, 'кДж/моль'],
    ['Атомный радиус', element.atomic_radius, 'pm'], ['Ионный радиус', element.ionic_radius == null ? null : `${element.ionic_radius}${element.ionic_radius_note ? ` (${element.ionic_radius_note})` : ''}`, 'pm'],
    ['Стандартный электродный потенциал', element.standard_electrode_potential, 'В'], ['Отношение к воде, кислотам, щёлочам и кислороду', element.chemical_relations],
    ['Характерные оксиды, гидроксиды и соединения', element.characteristic_compounds]
  ]);
  if (element.reactions.length) {
    const heading = document.createElement('h4');
    heading.textContent = 'Типичные уравнения';
    chemical.append(heading);
    for (const reaction of element.reactions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'reaction-link';
      try { button.textContent = equationToUnicode(parseEquation(reaction)); }
      catch { button.textContent = reaction; }
      button.title = 'Открыть в калькуляторе';
      button.addEventListener('click', () => onReaction(reaction));
      chemical.append(button);
    }
  } else {
    const empty = document.createElement('p');
    empty.className = 'no-data';
    empty.textContent = 'Проверенные типовые уравнения для этого элемента пока не добавлены.';
    chemical.append(empty);
  }
  root.append(chemical);
  root.append(propertySection('isotopes', '4. Изотопы', [
    ['Стабильные изотопы и распространённость', element.isotopes], ['Долгоживущий радиоизотоп и период полураспада', element.longest_radioisotope]
  ]));
  root.append(textSection('history', '5. История открытия', [
    ['Кто', element.discovered_by], ['Год', element.discovery_year], ['Контекст из источника', element.discovery_context], ['Кем назван', element.named_by], ['Происхождение названия', element.etymology]
  ]));
  root.append(textSection('nature', '6. Нахождение в природе и получение', [
    ['Нахождение и распространённость', element.occurrence], ['Содержание в земной коре', element.abundance.earth_crust],
    ['Содержание в морской воде', element.abundance.seawater], ['Содержание в организме человека', element.abundance.human_body],
    ['Минералы и руды', element.minerals], ['Промышленное получение', element.production]
  ]));
  root.append(listSection('applications', '7. Применение', element.applications));
  root.append(textSection('safety', '8. Биологическая роль и безопасность', [
    ['Биологическая роль', element.biological_role], ['Токсичность и меры предосторожности', element.hazards], ['Радиационная опасность', element.radioactive ? 'Радиоактивный элемент' : 'Не отмечен как радиоактивный в используемой классификации']
  ]));
  root.append(listSection('facts', '9. Интересные факты', element.facts, 'Дополнительные проверенные факты отсутствуют в локальной базе.'));

  const sources = makeSection('sources', '10. Источники данных');
  const sourceList = document.createElement('ul');
  for (const source of element.sources) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = source.label;
    item.append(link);
    sourceList.append(item);
  }
  sources.append(sourceList);
  root.append(sources);

  const insert = document.createElement('button');
  insert.type = 'button';
  insert.className = 'button primary element-insert-button';
  insert.textContent = `Вставить ${element.symbol} в формулу`;
  insert.addEventListener('click', () => onInsert(element.symbol));
  root.append(insert);
  return root;
}
