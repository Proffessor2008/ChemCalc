import elementData from '../data/elements.json' with { type: 'json' };

export const ELEMENTS = elementData.elements;
export const ELEMENT_BY_SYMBOL = new Map(ELEMENTS.map((element) => [element.symbol, element]));
const ELEMENT_SYMBOLS = new Set(ELEMENTS.map((element) => element.symbol));
const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉';
const SUPERSCRIPTS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const OPENERS = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = new Set(Object.values(OPENERS));
const FORMULA_ALIASES = new Map([
  ['CuSO45H2O', 'CuSO4·5H2O'],
  ['FeSO47H2O', 'FeSO4·7H2O'],
  ['Na2CO310H2O', 'Na2CO3·10H2O']
]);
const STRUCTURAL_ALIASES = [
  ['CH2=CH2', 'C2H4'],
  ['CH2(OH)-CH2(OH)', 'HOCH2CH2OH'],
  ['CH3-CH2-OH', 'CH3CH2OH']
];

export function normalizeReactionNotation(source) {
  return STRUCTURAL_ALIASES.reduce((text, [alias, formula]) => text.replaceAll(alias, formula), String(source).trim());
}

export class FormulaSyntaxError extends Error {
  constructor(message, position = null, code = 'syntax') {
    super(message);
    this.name = 'FormulaSyntaxError';
    this.position = position;
    this.code = code;
  }
}

function normalizeUnicode(value) {
  let normalized = String(value).trim()
    .replace(/[−–—]/g, '-')
    .replace(/[∙⋅•]/g, '·')
    .replace(/[₀-₉]/g, (digit) => String(SUBSCRIPTS.indexOf(digit)))
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (digit) => String(SUPERSCRIPTS.indexOf(digit)));
  normalized = normalized.replace(/(\d*)⁺/g, (_, digits) => `^${digits}+`)
    .replace(/(\d*)⁻/g, (_, digits) => `^${digits}-`);
  return normalized;
}

function readInteger(source, state) {
  const start = state.index;
  while (state.index < source.length && /\d/.test(source[state.index])) state.index += 1;
  if (start === state.index) return 1;
  const value = Number(source.slice(start, state.index));
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new FormulaSyntaxError(`Индекс должен быть положительным целым числом (позиция ${start + 1})`, start, 'index');
  }
  return value;
}

function addAtoms(target, source, multiplier = 1) {
  for (const [symbol, count] of source) {
    target.set(symbol, (target.get(symbol) || 0) + count * multiplier);
  }
}

function parseGroup(source, state, expectedCloser = null) {
  const atoms = new Map();
  while (state.index < source.length) {
    const character = source[state.index];
    if (CLOSERS.has(character)) {
      if (!expectedCloser || character !== expectedCloser) {
        throw new FormulaSyntaxError(`Непарная скобка «${character}» в позиции ${state.index + 1}`, state.index, 'bracket');
      }
      state.index += 1;
      return atoms;
    }
    if (OPENERS[character]) {
      const openerPosition = state.index;
      state.index += 1;
      const inner = parseGroup(source, state, OPENERS[character]);
      if (state.index > source.length || source[state.index - 1] !== OPENERS[character]) {
        throw new FormulaSyntaxError(`Скобка в позиции ${openerPosition + 1} не закрыта`, openerPosition, 'bracket');
      }
      addAtoms(atoms, inner, readInteger(source, state));
      continue;
    }
    if (/[A-Z]/.test(character)) {
      const position = state.index;
      let symbol = character;
      if (state.index + 1 < source.length && /[a-z]/.test(source[state.index + 1])) {
        symbol += source[state.index + 1];
      }
      if (!ELEMENT_SYMBOLS.has(symbol)) {
        throw new FormulaSyntaxError(`Неизвестный символ ${symbol} в позиции ${position + 1}`, position, 'unknown-element');
      }
      state.index += symbol.length;
      atoms.set(symbol, (atoms.get(symbol) || 0) + readInteger(source, state));
      continue;
    }
    if (/[a-z]/.test(character)) {
      throw new FormulaSyntaxError(`Элемент должен начинаться с заглавной буквы: позиция ${state.index + 1}`, state.index, 'case');
    }
    throw new FormulaSyntaxError(`Недопустимый символ «${character}» в позиции ${state.index + 1}`, state.index, 'character');
  }
  if (expectedCloser) {
    throw new FormulaSyntaxError(`Не хватает закрывающей скобки «${expectedCloser}»`, source.length - 1, 'bracket');
  }
  return atoms;
}

function splitHydrate(source) {
  const parts = [];
  const stack = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (OPENERS[character]) stack.push(character);
    if (CLOSERS.has(character)) stack.pop();
    if ((character === '·' || character === '*' || character === '.') && stack.length === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  if (parts.some((part) => !part)) {
    throw new FormulaSyntaxError('Пустая часть кристаллогидрата', null, 'hydrate');
  }
  return parts;
}

function stripStateAndAnnotation(source) {
  let value = source.trim();
  let state = null;
  let annotation = null;
  let matched = true;
  while (matched) {
    matched = false;
    const arrow = value.match(/([↓↑])\s*$/u);
    if (arrow) {
      annotation = arrow[1];
      value = value.slice(0, arrow.index).trim();
      matched = true;
    }
    const phase = value.match(/\((aq|s|l|g|тв|ж|г|р-р)\)\s*$/iu);
    if (phase) {
      state = phase[1].toLowerCase();
      value = value.slice(0, phase.index).trim();
      matched = true;
    }
  }
  return { value, state, annotation };
}

function parseCharge(source) {
  const match = source.match(/(?:\^(\d+)?([+-])|([+-]))$/);
  if (!match) return { base: source, charge: 0, suffix: '' };
  const magnitude = Number(match[1] || 1);
  const sign = match[2] || match[3];
  if (magnitude < 1) throw new FormulaSyntaxError('Заряд не может быть нулевым', source.length - 1, 'charge');
  const suffix = `^${magnitude === 1 ? '' : magnitude}${sign}`;
  return {
    base: source.slice(0, match.index),
    charge: magnitude * (sign === '+' ? 1 : -1),
    suffix
  };
}

function parseTerm(input, allowCoefficient) {
  const original = String(input);
  let normalized = normalizeUnicode(normalizeReactionNotation(original));
  let coefficient = 1;
  if (allowCoefficient) {
    const leading = normalized.match(/^(\d+)\s*(?=[A-Z([{e])/);
    if (leading) {
      coefficient = Number(leading[1]);
      if (!Number.isSafeInteger(coefficient) || coefficient < 1) {
        throw new FormulaSyntaxError('Коэффициент должен быть положительным целым числом', 0, 'coefficient');
      }
      normalized = normalized.slice(leading[0].length).trim();
    }
  }
  if (!normalized) throw new FormulaSyntaxError('Введите формулу вещества', 0, 'empty');
  normalized = FORMULA_ALIASES.get(normalized) ?? normalized;
  if (/^e(?:\^-|-)?$/.test(normalized)) {
    return {
      input: original,
      formula: 'e^-',
      baseFormula: 'e',
      coefficient,
      atoms: new Map(),
      charge: -1,
      state: null,
      annotation: null,
      isElectron: true,
      molarMass: 0.000548579909
    };
  }
  const { value, state, annotation } = stripStateAndAnnotation(normalized);
  const { base, charge, suffix } = parseCharge(value);
  if (!base) throw new FormulaSyntaxError('Перед зарядом должна быть формула', 0, 'charge');
  const atoms = new Map();
  const canonicalParts = [];
  for (const part of splitHydrate(base)) {
    const multiplierMatch = part.match(/^\d+/);
    const multiplier = multiplierMatch ? Number(multiplierMatch[0]) : 1;
    if (multiplier < 1 || !Number.isSafeInteger(multiplier)) {
      throw new FormulaSyntaxError('Множитель кристаллогидрата должен быть положительным целым числом', null, 'hydrate');
    }
    const unit = part.slice(multiplierMatch ? multiplierMatch[0].length : 0);
    if (!unit) throw new FormulaSyntaxError('После множителя нужна формула', null, 'hydrate');
    const parserState = { index: 0 };
    const partAtoms = parseGroup(unit, parserState);
    addAtoms(atoms, partAtoms, multiplier);
    canonicalParts.push(`${multiplierMatch ? multiplier : ''}${unit}`);
  }
  const baseFormula = canonicalParts.join('·');
  let molarMass = 0;
  for (const [symbol, count] of atoms) molarMass += ELEMENT_BY_SYMBOL.get(symbol).atomic_mass * count;
  return {
    input: original,
    formula: `${baseFormula}${suffix}`,
    baseFormula,
    coefficient,
    atoms,
    charge,
    state,
    annotation,
    isElectron: false,
    molarMass
  };
}

export function parseFormula(formula) {
  return parseTerm(formula, false);
}

export function parseSpecies(species) {
  return parseTerm(species, true);
}

export function splitSide(side) {
  const source = String(side).trim();
  if (!source) throw new FormulaSyntaxError('Сторона уравнения не должна быть пустой', 0, 'empty-side');
  const parts = [];
  const stack = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (OPENERS[character]) stack.push(character);
    if (CLOSERS.has(character)) stack.pop();
    if (character !== '+' || stack.length > 0) continue;
    if (/\^\d*$/.test(source.slice(start, index))) continue;
    const nextNonSpace = source.slice(index + 1).search(/\S/) + index + 1;
    if (nextNonSpace < index + 1 || nextNonSpace >= source.length) continue;
    if (source[nextNonSpace] === '+') continue;
    parts.push(source.slice(start, index).trim());
    start = index + 1;
  }
  parts.push(source.slice(start).trim());
  if (parts.some((part) => !part)) {
    throw new FormulaSyntaxError('Лишний знак «+» или отсутствует вещество', null, 'plus');
  }
  return parts;
}

export function parseSide(side) {
  return splitSide(side).map(parseSpecies);
}

export function parseEquation(equation) {
  const source = normalizeReactionNotation(equation);
  const separators = [...source.matchAll(/->|→|⇄|↔|=/g)];
  if (separators.length !== 1) {
    throw new FormulaSyntaxError('Уравнение должно содержать ровно один разделитель: =, ->, → или ⇄', null, 'separator');
  }
  const separator = separators[0][0];
  const leftSource = source.slice(0, separators[0].index).trim();
  const rightSource = source.slice(separators[0].index + separator.length).trim();
  try {
    return {
      source,
      separator: separator === '->' || separator === '=' ? '→' : separator,
      leftSource,
      rightSource,
      left: parseSide(leftSource),
      right: parseSide(rightSource)
    };
  } catch (error) {
    if (error instanceof FormulaSyntaxError && !error.side) {
      error.side = error.position !== null && leftSource.length === 0 ? 'left' : undefined;
    }
    throw error;
  }
}

export function formatSpecies(species, includeCoefficient = true) {
  const parsed = typeof species === 'string' ? parseSpecies(species) : species;
  const coefficient = includeCoefficient && parsed.coefficient !== 1 ? String(parsed.coefficient) : '';
  const annotation = parsed.annotation || '';
  const state = parsed.state ? `(${parsed.state})` : '';
  return `${coefficient}${parsed.formula}${state}${annotation}`;
}

export function formatEquation(equation, coefficients = null) {
  const formatSide = (side, offset) => side.map((species, index) => {
    const coefficient = coefficients ? coefficients[offset + index] : species.coefficient;
    return formatSpecies({ ...species, coefficient });
  }).join(' + ');
  return `${formatSide(equation.left, 0)} ${equation.separator || '→'} ${formatSide(equation.right, equation.left.length)}`;
}

export function formulaToUnicode(formula) {
  const parsed = typeof formula === 'string' ? parseFormula(formula) : formula;
  const base = parsed.baseFormula.replace(/([A-Za-z)\]}])(\d+)/g, (_, prefix, digits) => (
    `${prefix}${[...digits].map((digit) => SUBSCRIPTS[Number(digit)]).join('')}`
  ));
  let charge = '';
  if (parsed.charge !== 0) {
    const magnitude = Math.abs(parsed.charge);
    const digits = magnitude === 1 ? '' : [...String(magnitude)].map((digit) => SUPERSCRIPTS[Number(digit)]).join('');
    charge = `${digits}${parsed.charge > 0 ? '⁺' : '⁻'}`;
  }
  const state = parsed.state ? `(${parsed.state})` : '';
  return `${base}${charge}${state}${parsed.annotation || ''}`;
}

export function equationToUnicode(equation, coefficients = null) {
  const plain = formatEquation(equation, coefficients);
  const separator = ` ${equation.separator || '→'} `;
  const [left, right] = plain.split(separator);
  const convertSide = (side) => side.split(' + ').map((term) => {
    const match = term.match(/^(\d+)(.*)$/);
    const coefficient = match ? match[1] : '';
    const formula = match ? match[2] : term;
    try {
      return `${coefficient}${formulaToUnicode(formula)}`;
    } catch {
      return term;
    }
  }).join(' + ');
  return `${convertSide(left)}${separator}${convertSide(right)}`;
}

export function atomCountsToObject(atoms) {
  return Object.fromEntries(atoms);
}
