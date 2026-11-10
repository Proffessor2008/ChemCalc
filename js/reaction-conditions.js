import substanceData from '../data/substances.json' with { type: 'json' };
import { t } from './i18n.js';

const AQUEOUS_ACIDS = new Set(['HCl', 'HNO3', 'H2SO4', 'HBr']);
const AQUEOUS_BASES = new Set(['LiOH', 'NaOH', 'KOH', 'RbOH', 'CsOH', 'Ca(OH)2', 'Ba(OH)2']);
const SALT_CLASSES = new Set(['salt', 'acidic_salt', 'basic_salt', 'complex', 'organic_salt']);
const AQUEOUS_KINDS = new Set([
  'ionic-redox', 'mutual-hydrolysis', 'ammonium-salt-base', 'amphoteric-salt-base',
  'amphoteric-hydroxide-base', 'amphoteric-oxide-base', 'basic-oxide-acid',
  'acidic-oxide-base', 'acidic-salt-acid', 'acidic-salt-base', 'weak-acid-salt-acid', 'volatile-acid-salt',
  'complex-acid-ratio', 'weak-acid-base', 'neutralization', 'metal-acid', 'metal-salt',
  'acid-carbonate', 'double-displacement', 'nonmetal-oxidizing-acid',
  'nonmetal-halide-hydrolysis', 'acid-deficit-salt', 'salt-peroxide-alkali',
  'permanganate-halide-acid', 'dichromate-iron-acid'
]);

export function isNonAqueousSolvent(solvent) {
  return solvent !== undefined && solvent !== 'aqueous';
}

export function requiresAqueousRule(rule) {
  if (rule.when?.solvent) return rule.when.solvent === 'aqueous';
  if (AQUEOUS_KINDS.has(rule.kind)) return true;
  if (/обмен|нейтрализация|гидролиз|комплексообразование/.test(rule.type || '')) return true;
  return [...(rule.reactants || []), ...(rule.addReactants || []), ...(rule.acids || [])]
    .some((formula) => formula === 'H2O' || AQUEOUS_ACIDS.has(formula) || AQUEOUS_BASES.has(formula));
}

function requiresAqueousMechanism(input) {
  if (input.length < 2) return false;
  if (input.some((item) => item.formula === 'H2O' || AQUEOUS_ACIDS.has(item.formula) || AQUEOUS_BASES.has(item.formula))) return true;
  const classes = input.map((item) => substanceData.items.find((record) => record.formula === item.formula)?.class);
  if (classes.every((name) => SALT_CLASSES.has(name))) return true;
  if (classes.includes('salt') && classes.includes('metal')) return true;
  return classes.includes('acid') && classes.includes('base');
}

export function phasePredictionBlock(input, conditions) {
  if (!isNonAqueousSolvent(conditions.solvent) || !requiresAqueousMechanism(input)) return null;
  return {
    status: 'no-reaction',
    confidence: 'high',
    ruleId: 'non-aqueous-solvent',
    type: 'Несовместимая среда',
    message: t('nonAqueousPrediction'),
    why: [t('nonAqueousPrediction')],
    conditions: { ...conditions },
    source: 'Модель среды: водные ионные механизмы не переносятся автоматически в неводную фазу'
  };
}
