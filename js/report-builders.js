import { findSubstance } from './checker.js';
import { t } from './i18n.js';
import { formulaToUnicode, parseEquation } from './parser.js';
import { buildPrintModel } from './print-solution.js';
import { createReport, formatReportDate } from './report.js';

function signedState(value) {
  const text = String(value).replace('-', '−');
  return value.n > 0n ? `+${text}` : text;
}

function substanceRows(equation, redox) {
  const parsed = typeof equation === 'string' ? parseEquation(equation) : equation;
  const species = [...parsed.left, ...parsed.right];
  return species.map((item) => {
    const substance = findSubstance(item.formula);
    const details = redox?.stateDetails?.find((entry) => entry.species === item);
    const oxidation = details?.complete && details.states.size
      ? [...details.states].map(([symbol, value]) => `${symbol}: ${signedState(value)}`).join('; ')
      : '—';
    return [formulaToUnicode(item), substance?.name_ru || t('unknown'), item.molarMass.toFixed(3), oxidation];
  });
}

function buildEquationReport({ subtitle, equation, conditions, type = '', source = '', explanation = [], ionic = null, warnings = [], redox = null, verdict = '', filename }) {
  const model = buildPrintModel({ equation, conditions, type, source, explanation, ionic });
  const sections = [];
  sections.push({ heading: t('solution'), blocks: [{ type: 'list', ordered: true, items: model.steps }] });
  if (redox?.isRedox && redox.summary?.length) {
    sections.push({ heading: t('redoxTitle'), blocks: [{ type: 'list', items: redox.summary }] });
  }
  if (model.ionic) {
    const blocks = [
      { type: 'paragraph', text: `${t('fullIonic')}: ${model.ionic.full || model.ionic.message || '—'}` },
      { type: 'paragraph', text: `${t('netIonic')}: ${model.ionic.net || '—'}` }
    ];
    sections.push({ heading: t('ionicEquations'), blocks });
  }
  const rows = substanceRows(equation, redox);
  if (rows.length) {
    sections.push({
      heading: t('substances'),
      blocks: [{ type: 'table', headers: [t('formula'), t('name'), t('molarMass'), t('oxidation')], rows }]
    });
  }
  if (warnings.length) sections.push({ heading: t('warnings'), blocks: [{ type: 'list', items: warnings }] });
  if (model.explanation.length) sections.push({ heading: t('why'), blocks: [{ type: 'list', items: model.explanation }] });
  const meta = [
    { label: t('reportGenerated'), value: formatReportDate() },
    { label: t('conditions'), value: model.conditions },
    { label: t('reactionTypeLabel'), value: model.type },
    { label: t('source'), value: model.source },
    { label: t('reportVerdict'), value: verdict }
  ];
  return createReport({ title: 'ChemCalc', subtitle, meta, sections, filename });
}

export function buildCheckReport({ equation, conditions = {}, warnings = [], redox = null, verdict = '', source = '' }) {
  return buildEquationReport({
    subtitle: t('reportCheckTitle'),
    equation,
    conditions,
    source,
    warnings,
    redox,
    verdict,
    filename: `chemcalc-check-${new Date().toISOString().slice(0, 10)}`
  });
}

export function buildAutoReport({ equation, conditions = {}, type = '', source = '', explanation = [], ionic = null, verdict = '' }) {
  return buildEquationReport({
    subtitle: t('reportAutoTitle'),
    equation,
    conditions,
    type,
    source,
    explanation,
    ionic,
    verdict,
    filename: `chemcalc-prediction-${new Date().toISOString().slice(0, 10)}`
  });
}

export function buildStoichiometryReport(result) {
  const showActual = result.yieldPercent !== 100;
  const hasGasProduct = Boolean(result.hasGasProduct);
  const hasAvailability = result.rows.some((row) => row.availableMoles !== null);
  const headers = [t('formula'), 'ν', t('molarMass'), t('usedAmount'), t('theoreticalMass'), t('gasVolumeShort')];
  if (showActual) headers.push(t('actualMolesShort'), t('actualMassShort'));
  if (showActual && hasGasProduct) headers.push(t('actualGasVolumeShort'));
  if (hasAvailability) headers.push(t('availableMolesShort'), t('remainingMolesShort'));
  const rows = result.rows.map((row) => {
    const cells = [
      formulaToUnicode(row.formula),
      row.coefficient,
      row.molarMass.toFixed(3),
      row.moles,
      row.massG,
      row.gasVolumeL ?? '—'
    ];
    if (showActual) cells.push(row.actualMoles ?? '—', row.actualMassG ?? '—');
    if (showActual && hasGasProduct) cells.push(row.actualGasVolumeL ?? '—');
    if (hasAvailability) cells.push(row.availableMoles ?? '—', row.remainingMoles ?? '—');
    return cells;
  });
  const sections = [];
  if (result.yieldPercent !== 100 && result.practicalProducts.length) {
    const conditions = result.gasConditions === 'satp' ? t('gasConditionsShortSatp') : t('gasConditionsShortNormal');
    sections.push({
      heading: t('practicalProductsTitle'),
      blocks: [{ type: 'list', items: result.practicalProducts.map((item) => (item.gasVolumeL === null
        ? t('practicalLine', { formula: formulaToUnicode(item.formula), moles: item.moles, mass: item.massG })
        : t('practicalLineGas', { formula: formulaToUnicode(item.formula), moles: item.moles, mass: item.massG, volume: item.gasVolumeL, conditions }))) }]
    });
  }
  sections.push({ heading: t('stoichiometry'), blocks: [{ type: 'table', headers, rows }] });
  sections.push({ heading: t('solution'), blocks: [{ type: 'list', ordered: true, items: result.steps }] });
  const meta = [
    { label: t('reportGenerated'), value: formatReportDate() },
    { label: t('reportEquation'), value: result.equationUnicode },
    { label: t('limitingReactantLabel'), value: result.limitingFormula },
    { label: t('gasConditions'), value: result.gasConditions === 'satp' ? t('gasConditionsShortSatp') : t('gasConditionsShortNormal') },
    { label: t('yield'), value: `${result.yieldPercent}%` }
  ];
  return createReport({
    title: 'ChemCalc',
    subtitle: t('reportStoichTitle'),
    meta,
    sections,
    filename: `chemcalc-stoichiometry-${new Date().toISOString().slice(0, 10)}`
  });
}

const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export function tableToReportBlock(table) {
  const headerRow = table.tHead?.rows[table.tHead.rows.length - 1] || table.rows[0];
  if (!headerRow) return null;
  const headers = [...headerRow.cells].map((cell) => cleanText(cell.textContent));
  const bodyRows = table.tBodies.length
    ? [...table.tBodies].flatMap((body) => [...body.rows])
    : [...table.rows].slice(1);
  const rows = bodyRows.map((row) => [...row.cells].map((cell) => cleanText(cell.textContent)));
  return headers.length && rows.length ? { type: 'table', headers, rows } : null;
}

export function activityToReportBlock(container) {
  const buttons = [...container.querySelectorAll('button')];
  if (!buttons.length) return null;
  return {
    type: 'table',
    headers: [t('element'), 'E°, В'],
    rows: buttons.map((button) => [
      cleanText(button.querySelector('strong')?.textContent || button.textContent),
      cleanText(button.querySelector('span')?.textContent || '')
    ])
  };
}

export function splitWideTable(block, maxColumns = 6) {
  if (!block?.headers?.length || block.headers.length <= maxColumns + 1) return [block];
  const chunks = [];
  for (let start = 1; start < block.headers.length; start += maxColumns) {
    const end = Math.min(block.headers.length, start + maxColumns);
    chunks.push({
      type: 'table',
      headers: [block.headers[0], ...block.headers.slice(start, end)],
      rows: block.rows.map((row) => [row[0], ...row.slice(start, end)])
    });
  }
  return chunks;
}

export function buildReferenceReport({ root, id, label, source = '', filter = '' }) {
  const cards = [...root.querySelectorAll(':scope > section.card')];
  const sections = [];
  const tableBlock = tableToReportBlock;
  const activityBlock = activityToReportBlock;
  const walk = (node, blocks, state) => {
    if (node.nodeType === 3) {
      const text = cleanText(node.textContent);
      if (text) blocks.push({ type: 'paragraph', text });
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (['form', 'svg', 'script', 'style', 'input', 'select', 'textarea', 'button', 'details', 'summary'].includes(tag)) return;
    if (node.classList?.contains('tool-card') || node.classList?.contains('tool-result') || node.classList?.contains('en-grid')) return;
    if (tag === 'table') {
      const block = tableBlock(node);
      if (block) {
        if (id === 'solubility' && String(block.headers[0] || '').includes('Катион')) {
          const chunks = splitWideTable(block, 6);
          chunks.forEach((chunk, index) => {
            blocks.push({ type: 'paragraph', text: `Матрица растворимости · часть ${index + 1} из ${chunks.length}`, variant: 'subheading' });
            blocks.push(chunk);
          });
        } else {
          blocks.push(block);
        }
      }
      return;
    }
    if (node.classList?.contains('activity-series')) {
      const block = activityBlock(node);
      if (block) blocks.push(block);
      return;
    }
    if (tag === 'h2') {
      const text = cleanText(node.textContent);
      if (!text) return;
      if (state.heading === null) state.heading = text;
      else blocks.push({ type: 'paragraph', text, variant: 'subheading' });
      return;
    }
    if (tag === 'h3' || tag === 'h4') {
      const text = cleanText(node.textContent);
      if (text) blocks.push({ type: 'paragraph', text, variant: 'subheading' });
      return;
    }
    if (tag === 'p') {
      const text = cleanText(node.textContent);
      if (text) blocks.push({ type: 'paragraph', text });
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      const items = [...node.querySelectorAll(':scope > li')].map((item) => cleanText(item.textContent)).filter(Boolean);
      if (items.length) blocks.push({ type: 'list', ordered: tag === 'ol', items });
      return;
    }
    for (const child of node.childNodes) walk(child, blocks, state);
  };
  for (const card of cards) {
    const state = { heading: null };
    const blocks = [];
    walk(card, blocks, state);
    if (blocks.length) sections.push({ heading: state.heading || '', blocks });
  }
  if (!sections.length) {
    const state = { heading: null };
    const blocks = [];
    walk(root, blocks, state);
    if (blocks.length) sections.push({ heading: state.heading || '', blocks });
  }
  const meta = [
    { label: t('reportGenerated'), value: formatReportDate() },
    { label: t('source'), value: source },
    { label: t('reportFilter'), value: filter }
  ];
  return createReport({
    title: 'ChemCalc',
    subtitle: label,
    meta,
    sections,
    orientation: 'landscape',
    filename: `chemcalc-reference-${id}`
  });
}
