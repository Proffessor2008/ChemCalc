import { Fraction } from './balancer.js';
import { formulaToUnicode, parseFormula } from './parser.js';
import { analyzeInternalRedox } from './internal-redox.js';
import { electrolyteRecord } from './electrolytes.js';
import functionalGroupData from '../data/functional-groups.json' with { type: 'json' };

const ALKALI = new Set(['Li', 'Na', 'K', 'Rb', 'Cs', 'Fr']);
const ALKALINE_EARTH = new Set(['Be', 'Mg', 'Ca', 'Sr', 'Ba', 'Ra']);
const HALOGENS = new Set(['Cl', 'Br', 'I']);
const PEROXIDES = new Set(['H2O2', 'Li2O2', 'Na2O2', 'K2O2', 'Rb2O2', 'Cs2O2', 'MgO2', 'CaO2', 'SrO2', 'BaO2', 'O2^2-']);
const SUPEROXIDES = new Set(['KO2', 'RbO2', 'CsO2', 'O2^-']);
const FIXED_OXYANION_STATES = [
  { pattern: /SO4/, symbol: 'S', state: 6 },
  { pattern: /SO3/, symbol: 'S', state: 4 },
  { pattern: /NO3/, symbol: 'N', state: 5 },
  { pattern: /NO2/, symbol: 'N', state: 3 },
  { pattern: /CO3/, symbol: 'C', state: 4 },
  { pattern: /PO4/, symbol: 'P', state: 5 },
  { pattern: /PO3/, symbol: 'P', state: 3 }
];

function sumCharge(atoms, states) {
  let total = new Fraction(0);
  for (const [symbol, state] of states) total = total.add(state.mul(atoms.get(symbol) || 0));
  return total;
}

export function oxidationStates(species) {
  const atoms = species.atoms;
  const states = new Map();
  const notes = [];
  if (species.isElectron) return { states, complete: true, notes };
  if (atoms.size === 1) {
    const [symbol, count] = atoms.entries().next().value;
    states.set(symbol, new Fraction(species.charge, count));
    return { states, complete: true, notes };
  }
  for (const symbol of atoms.keys()) {
    if (ALKALI.has(symbol)) states.set(symbol, new Fraction(1));
    if (ALKALINE_EARTH.has(symbol)) states.set(symbol, new Fraction(2));
  }
  if (atoms.has('F')) states.set('F', new Fraction(-1));
  if (atoms.has('O')) {
    if (PEROXIDES.has(species.formula)) {
      states.set('O', new Fraction(-1));
      notes.push('Пероксид: кислород имеет степень окисления −1');
    } else if (SUPEROXIDES.has(species.formula)) {
      states.set('O', new Fraction(-1, 2));
      notes.push('Супероксид: средняя степень окисления кислорода −1/2');
    } else if (atoms.has('F')) {
      states.set('O', new Fraction(atoms.get('F'), atoms.get('O')));
    } else {
      states.set('O', new Fraction(-2));
    }
  }
  if (atoms.has('H')) {
    const hydride = [...atoms.keys()].every((symbol) => symbol === 'H' || ALKALI.has(symbol) || ALKALINE_EARTH.has(symbol));
    states.set('H', new Fraction(hydride ? -1 : 1));
  }
  if (species.charge !== 0 || atoms.size !== 2) {
    for (const { pattern, symbol, state } of FIXED_OXYANION_STATES) {
      if (atoms.has(symbol) && atoms.has('O') && pattern.test(species.baseFormula)) states.set(symbol, new Fraction(state));
    }
  }
  for (const symbol of atoms.keys()) {
    if (HALOGENS.has(symbol) && !atoms.has('O') && !atoms.has('F') && !states.has(symbol)) {
      states.set(symbol, new Fraction(-1));
    }
  }
  const unknown = [...atoms.keys()].filter((symbol) => !states.has(symbol));
  if (unknown.length === 1) {
    const symbol = unknown[0];
    const knownCharge = sumCharge(atoms, states);
    states.set(symbol, new Fraction(species.charge).sub(knownCharge).div(atoms.get(symbol)));
  } else if (unknown.length > 1) {
    notes.push(`Недостаточно правил для однозначного определения: ${unknown.join(', ')}`);
  }
  const complete = unknown.length <= 1;
  if (complete && !sumCharge(atoms, states).equals(species.charge)) {
    notes.push('Правила степеней окисления дали противоречивый результат; требуется проверка структуры вещества');
    return { states, complete: false, notes };
  }
  return { states, complete, notes };
}

function signed(value) {
  const number = value.toNumber();
  const sign = number > 0 ? '+' : number < 0 ? '−' : '';
  const absolute = number < 0 ? value.neg() : value;
  return `${sign}${absolute.toString()}`;
}

function speciesLabel(species) {
  return formulaToUnicode(species);
}

function commonHalfReactions(reductions, oxidations) {
  const reactions = [];
  const reductionFormulas = new Set(reductions.flatMap((event) => [event.fromSpecies.baseFormula, event.toSpecies.baseFormula]));
  const oxidationFormulas = new Set(oxidations.flatMap((event) => [event.fromSpecies.baseFormula, event.toSpecies.baseFormula]));
  if ((reductionFormulas.has('KMnO4') || reductionFormulas.has('MnO4')) && [...reductionFormulas].some((formula) => ['MnCl2', 'MnSO4', 'Mn'].includes(formula))) {
    reactions.push('Восстановление: MnO₄⁻ + 8H⁺ + 5e⁻ → Mn²⁺ + 4H₂O');
  }
  if (reductionFormulas.has('Cr2O7') && reductionFormulas.has('Cr')) {
    reactions.push('Восстановление: Cr₂O₇²⁻ + 14H⁺ + 6e⁻ → 2Cr³⁺ + 7H₂O');
  }
  if (reductionFormulas.has('H') && reductionFormulas.has('H2')) {
    reactions.push('Восстановление: 2H⁺ + 2e⁻ → H₂');
  }
  if (oxidationFormulas.has('Fe') && [...oxidationFormulas].some((formula) => ['Fe', 'FeSO4', 'Fe2(SO4)3'].includes(formula))) {
    const event = oxidations.find((entry) => entry.symbol === 'Fe');
    const electronsPerAtom = event?.to.sub(event.from).toString();
    if (electronsPerAtom === '1') reactions.push('Окисление: Fe²⁺ → Fe³⁺ + e⁻');
  }
  if (oxidationFormulas.has('HCl') && oxidationFormulas.has('Cl2')) {
    reactions.push('Окисление: 2Cl⁻ → Cl₂ + 2e⁻');
  }
  return reactions;
}

function oxidationStateSites(species, result) {
  const fallback = () => [...result.states].map(([symbol, state]) => ({ symbol, state, count: species.atoms.get(symbol), label: species.baseFormula }));
  const functional = functionalGroupData.records[species.formula];
  if (functional) {
    const symbols = new Set(functional.sites.map((site) => site.symbol));
    return [
      ...fallback().filter((site) => !symbols.has(site.symbol)),
      ...functional.sites.map((site) => ({ ...site, state: new Fraction(site.state) }))
    ];
  }
  const record = electrolyteRecord(species.formula);
  if (!record?.strong || !['Р', 'М'].includes(record.solubility) || !record.ions) return fallback();
  const sites = [];
  for (const ion of record.ions) {
    const parsed = parseFormula(ion.formula);
    const ionStates = oxidationStates(parsed);
    if (!ionStates.complete) return fallback();
    for (const [symbol, state] of ionStates.states) {
      sites.push({ symbol, state, count: parsed.atoms.get(symbol) * ion.coefficient, label: ion.formula });
    }
  }
  return sites;
}

function cancelUnchangedStates(left, right) {
  const remainingRight = right.map((entry) => ({ ...entry }));
  const remainingLeft = [];
  for (const entry of left) {
    const match = remainingRight.find((candidate) => candidate.amount > 0 && candidate.label === entry.label && candidate.state.equals(entry.state));
    if (!match) {
      remainingLeft.push({ ...entry });
      continue;
    }
    const cancelled = Math.min(entry.amount, match.amount);
    match.amount -= cancelled;
    if (entry.amount > cancelled) remainingLeft.push({ ...entry, amount: entry.amount - cancelled });
  }
  return { left: remainingLeft, right: remainingRight.filter((entry) => entry.amount > 0) };
}

export function analyzeRedox(input, coefficients = null) {
  const species = [...input.left, ...input.right];
  const values = coefficients || species.map((item) => item.coefficient);
  const internal = analyzeInternalRedox(input, values, oxidationStates);
  if (internal) return internal;
  const stateCache = new Map();
  const getStates = (item) => {
    if (!stateCache.has(item)) {
      const result = oxidationStates(item);
      stateCache.set(item, { ...result, sites: oxidationStateSites(item, result) });
    }
    return stateCache.get(item);
  };
  const symbols = [];
  for (const item of species) {
    for (const symbol of item.atoms.keys()) if (!symbols.includes(symbol)) symbols.push(symbol);
  }
  const reductions = [];
  const oxidations = [];
  let incomplete = false;
  const stateDetails = [];
  for (const item of species) {
    const result = getStates(item);
    incomplete ||= !result.complete;
    stateDetails.push({ species: item, ...result });
  }
  for (const symbol of symbols) {
    const leftSites = input.left.flatMap((item, index) => getStates(item).sites
      .filter((site) => site.symbol === symbol)
      .map((site) => ({ item, index, state: site.state, label: site.label, amount: site.count * values[index] })));
    const rightSites = input.right.flatMap((item, index) => getStates(item).sites
      .filter((site) => site.symbol === symbol)
      .map((site) => ({ item, index, state: site.state, label: site.label, amount: site.count * values[input.left.length + index] })));
    const { left, right } = cancelUnchangedStates(leftSites, rightSites);
    if (!left.length || !right.length) continue;
    const leftStates = left.map((entry) => entry.state);
    const rightStates = right.map((entry) => entry.state);
    const minLeft = leftStates.reduce((a, b) => a.toNumber() <= b.toNumber() ? a : b);
    const maxLeft = leftStates.reduce((a, b) => a.toNumber() >= b.toNumber() ? a : b);
    const minRight = rightStates.reduce((a, b) => a.toNumber() <= b.toNumber() ? a : b);
    const maxRight = rightStates.reduce((a, b) => a.toNumber() >= b.toNumber() ? a : b);
    const leftTotal = left.reduce((sum, entry) => sum.add(entry.state.mul(entry.amount)), new Fraction(0));
    const rightTotal = right.reduce((sum, entry) => sum.add(entry.state.mul(entry.amount)), new Fraction(0));
    const difference = rightTotal.sub(leftTotal);
    if (maxRight.toNumber() > minLeft.toNumber()) {
      const from = left.find((entry) => entry.state.equals(minLeft));
      const to = right.find((entry) => entry.state.equals(maxRight));
      oxidations.push({
        symbol,
        from: minLeft,
        to: maxRight,
        fromSpecies: from.item,
        toSpecies: to.item,
        electronCount: difference
      });
    }
    if (maxLeft.toNumber() > minRight.toNumber()) {
      const from = left.find((entry) => entry.state.equals(maxLeft));
      const to = right.find((entry) => entry.state.equals(minRight));
      reductions.push({
        symbol,
        from: maxLeft,
        to: minRight,
        fromSpecies: from.item,
        toSpecies: to.item,
        electronCount: difference.neg()
      });
    }
  }
  const isRedox = reductions.length > 0 || oxidations.length > 0;
  const electronsLost = oxidations.reduce((sum, event) => sum.add(event.electronCount), new Fraction(0));
  const electronsGained = reductions.reduce((sum, event) => sum.add(event.electronCount), new Fraction(0));
  const oxidizers = [...new Set(reductions.map((event) => event.fromSpecies))];
  const reducers = [...new Set(oxidations.map((event) => event.fromSpecies))];
  const transitions = [...reductions, ...oxidations].map((event) => `${event.symbol}: ${signed(event.from)} → ${signed(event.to)}`);
  const halfReactions = isRedox ? commonHalfReactions(reductions, oxidations) : [];
  return {
    isRedox,
    complete: !incomplete,
    reductions,
    oxidations,
    oxidizers,
    reducers,
    electronsLost,
    electronsGained,
    electronBalance: electronsLost.equals(electronsGained),
    transitions,
    stateDetails,
    halfReactions,
    notes: stateDetails.flatMap((detail) => detail.notes),
    summary: isRedox ? [
      `Степени окисления: ${transitions.join('; ')}`,
      `${oxidizers.length ? `Окислитель: ${oxidizers.map(speciesLabel).join(', ')}` : 'Окислитель однозначно не определён'}; ${reducers.length ? `восстановитель: ${reducers.map(speciesLabel).join(', ')}` : 'восстановитель однозначно не определён'}`,
      `Электронный баланс: отдано ${electronsLost.toString()}e⁻, принято ${electronsGained.toString()}e⁻ — ${electronsLost.equals(electronsGained) ? 'сходится' : 'не сходится'}`,
      ...halfReactions
    ] : []
  };
}
