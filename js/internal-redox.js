import siteData from '../data/redox-sites.json' with { type: 'json' };
import { Fraction } from './balancer.js';
import { formulaToUnicode } from './parser.js';
import { t } from './i18n.js';

function signed(value) {
  const number = value.toNumber();
  const sign = number > 0 ? '+' : number < 0 ? '−' : '';
  return `${sign}${number < 0 ? value.neg().toString() : value.toString()}`;
}

export function analyzeInternalRedox(input, coefficients = null, getOxidationStates) {
  const reactants = input.left.filter((species) => siteData.records[species.formula]);
  if (!reactants.length) return null;
  const species = [...input.left, ...input.right];
  const values = coefficients || species.map((item) => item.coefficient);
  const reductions = [];
  const oxidations = [];
  const stateDetails = [];
  for (const item of reactants) {
    const leftIndex = input.left.indexOf(item);
    const record = siteData.records[item.formula];
    const coefficient = values[leftIndex] ?? item.coefficient;
    const states = new Map(record.sites.map((site) => [site.symbol, new Fraction(site.state)]));
    const notes = record.sites.map((site) => `${t(site.label)}: ${site.symbol} ${signed(new Fraction(site.state))}`);
    stateDetails.push({ species: item, states, complete: true, notes });
    for (const site of record.sites) {
      const leftState = new Fraction(site.state);
      const candidates = input.right.flatMap((product, rightIndex) => {
        if (!product.atoms.has(site.symbol)) return [];
        const result = getOxidationStates(product);
        if (!result.complete || !result.states.has(site.symbol)) return [];
        return [{ state: result.states.get(site.symbol), product, index: rightIndex }];
      });
      if (!candidates.length) return null;
      const minRight = candidates.reduce((a, b) => a.toNumber() <= b.state.toNumber() ? a : b).state;
      const maxRight = candidates.reduce((a, b) => a.toNumber() >= b.state.toNumber() ? a : b).state;
      const atomCount = site.count || 1;
      if (maxRight.toNumber() > leftState.toNumber()) {
        const to = candidates.find((candidate) => candidate.state.equals(maxRight));
        oxidations.push({
          symbol: site.symbol,
          label: site.label,
          from: leftState,
          to: maxRight,
          fromSpecies: item,
          toSpecies: to.product,
          electronCount: maxRight.sub(leftState).mul(atomCount * coefficient)
        });
      }
      if (leftState.toNumber() > minRight.toNumber()) {
        const to = candidates.find((candidate) => candidate.state.equals(minRight));
        reductions.push({
          symbol: site.symbol,
          label: site.label,
          from: leftState,
          to: minRight,
          fromSpecies: item,
          toSpecies: to.product,
          electronCount: leftState.sub(minRight).mul(atomCount * coefficient)
        });
      }
    }
  }
  if (!reductions.length && !oxidations.length) return null;
  const electronsLost = oxidations.reduce((sum, event) => sum.add(event.electronCount), new Fraction(0));
  const electronsGained = reductions.reduce((sum, event) => sum.add(event.electronCount), new Fraction(0));
  const oxidizers = [...new Set(reductions.map((event) => event.fromSpecies))];
  const reducers = [...new Set(oxidations.map((event) => event.fromSpecies))];
  const transitions = [...reductions, ...oxidations].map((event) => `${event.symbol} (${t(event.label)}): ${signed(event.from)} → ${signed(event.to)}`);
  const halfReactions = [
    ...reductions.map((event) => t('redoxSiteReduction', { label: t(event.label), symbol: event.symbol, from: signed(event.from), to: signed(event.to) })),
    ...oxidations.map((event) => t('redoxSiteOxidation', { label: t(event.label), symbol: event.symbol, from: signed(event.from), to: signed(event.to) }))
  ];
  return {
    isRedox: true,
    internal: true,
    complete: true,
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
    source: t('internalRedoxSource'),
    summary: [
      t('internalRedoxTransfer', { transitions: transitions.join('; ') }),
      t('redoxAgents', {
        oxidizers: oxidizers.map((item) => formulaToUnicode(item)).join(', ') || '—',
        reducers: reducers.map((item) => formulaToUnicode(item)).join(', ') || '—'
      }),
      t('redoxElectronBalance', {
        lost: electronsLost.toString(),
        gained: electronsGained.toString(),
        status: t(electronsLost.equals(electronsGained) ? 'redoxBalanced' : 'redoxUnbalanced')
      }),
      ...halfReactions
    ]
  };
}
