import { calculateIonicReactionThermo, calculateReactionThermo } from './thermo.js';
import { t } from './i18n.js';
import { isNonAqueousSolvent } from './reaction-conditions.js';

export function renderThermoPanel(selector, equation, options = {}) {
  const panel = document.querySelector(selector);
  if (!panel || !equation) return;
  const result = options.ionic ? calculateIonicReactionThermo(equation, options) : calculateReactionThermo(equation, options);
  panel.hidden = false;
  panel.replaceChildren();
  const heading = document.createElement('h3');
  heading.textContent = options.ionic ? t('thermoIonic') : t('thermoReaction');
  panel.append(heading);
  if (isNonAqueousSolvent(options.solvent)) {
    const phaseNote = document.createElement('p');
    phaseNote.className = 'help-text';
    phaseNote.textContent = t('nonAqueousThermo');
    panel.append(phaseNote);
  }
  const text = document.createElement('p');
  if (result.status !== 'ok') {
    text.textContent = result.message;
    panel.append(text);
    if (!options.ionic) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button ghost compact';
      button.textContent = t('tryIonicThermo');
      button.addEventListener('click', () => renderThermoPanel(selector, equation, { ...options, ionic: true }));
      panel.append(button);
    }
    return;
  }
  text.textContent = `ΔH° = ${result.deltaH} кДж; ΔS° = ${result.deltaS} Дж/K; ΔG°(298) = ${result.deltaG} кДж; K = ${Number.isFinite(result.K) ? result.K.toExponential(3) : '∞'}.`;
  const conclusion = document.createElement('p');
  conclusion.className = 'help-text';
  conclusion.textContent = `${result.effect}. ${result.spontaneous}. ${result.note}`;
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = t('hessSteps');
  const list = document.createElement('ol');
  for (const step of result.steps) {
    const item = document.createElement('li');
    item.textContent = step;
    list.append(item);
  }
  details.append(summary, list);
  panel.append(text, conclusion, details);
}
