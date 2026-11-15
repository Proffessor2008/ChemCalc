import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateStoichiometry } from '../js/stoichiometry.js';
import { parseEquation } from '../js/parser.js';
import { createReport, safeFilename } from '../js/report.js';
import { buildDocx } from '../js/report-docx.js';
import { buildPdfDocument } from '../js/report-pdf.js';
import { buildAutoReport, buildCheckReport, buildStoichiometryReport, tableToReportBlock, activityToReportBlock } from '../js/report-builders.js';

function readStoredZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      end = index;
      break;
    }
  }
  assert.notEqual(end, -1, 'EOCD not found');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    assert.equal(view.getUint32(offset, true), 0x02014b50, 'central directory signature');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    assert.equal(method, 0, `expected stored entry for ${name}`);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name, new TextDecoder().decode(bytes.subarray(dataStart, dataStart + compressedSize)));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test('модель отчёта отбрасывает пустые метаданные и сохраняет порядок разделов', () => {
  const report = createReport({
    title: 'ChemCalc',
    subtitle: 'Тест',
    meta: [['Пусто', ''], ['Дата', 'сегодня']],
    sections: [{ heading: 'Первый', blocks: [{ type: 'paragraph', text: 'Текст' }] }, { heading: '', blocks: [] }],
    orientation: 'landscape',
    filename: 'test report'
  });
  assert.deepEqual(report.meta, [{ label: 'Дата', value: 'сегодня' }]);
  assert.equal(report.sections.length, 1);
  assert.equal(report.orientation, 'landscape');
  assert.equal(safeFilename(report.filename, 'docx'), 'test-report.docx');
});

test('отчёт проверки содержит шаги, вещества, ионы и предупреждения', () => {
  const report = buildCheckReport({
    equation: parseEquation('HCl + NaOH = NaCl + H2O'),
    conditions: { medium: 'neutral', solvent: 'aqueous' },
    warnings: ['Проверочное предупреждение'],
    verdict: 'Верно'
  });
  const headings = report.sections.map((section) => section.heading);
  assert.ok(headings.includes('Пошаговое решение'));
  assert.ok(headings.includes('Ионные уравнения'));
  assert.ok(headings.includes('Вещества и молярные массы'));
  assert.ok(headings.includes('Предупреждения'));
  const table = report.sections.find((section) => section.heading === 'Вещества и молярные массы').blocks[0];
  assert.deepEqual(table.headers, ['Формула', 'Название', 'M, г/моль', 'Степени окисления']);
  assert.ok(table.rows.some((row) => row[0] === 'NaCl' && row[1] === 'Хлорид натрия'));
  assert.equal(report.meta.find((entry) => entry.label === 'Вердикт').value, 'Верно');
});

test('отчёт предсказания содержит объяснение и вердикт', () => {
  const report = buildAutoReport({
    equation: parseEquation('MgO + HCl = MgCl2 + H2O'),
    conditions: { medium: 'neutral', solvent: 'aqueous' },
    type: 'обмен',
    source: 'Правило оксидов',
    explanation: ['Оксид металла + кислота'],
    verdict: 'Реакция предсказана'
  });
  assert.ok(report.sections.some((section) => section.heading === 'Почему так'));
  assert.equal(report.meta.find((entry) => entry.label === 'Вердикт').value, 'Реакция предсказана');
});

test('отчёт стехиометрии содержит практический объём газа', () => {
  const result = calculateStoichiometry('3Cu + 8HNO3 = 3Cu(NO3)2 + 2NO + 4H2O', {
    known: { index: 0, kind: 'mass', value: 19.2 },
    availableReactants: { 0: 0.3, 1: 0.8 },
    gasConditions: 'satp',
    yieldPercent: 80,
    yieldProductIndex: 3
  });
  const report = buildStoichiometryReport(result);
  const headings = report.sections.map((section) => section.heading);
  assert.ok(headings.includes('Практический выход'));
  assert.ok(headings.includes('Стехиометрия'));
  const table = report.sections.find((section) => section.heading === 'Стехиометрия').blocks[0];
  assert.ok(table.headers.includes('V практ., л'));
  assert.ok(table.headers.includes('Наличие, моль'));
  assert.ok(table.rows.some((row) => row.map(String).includes('3.92')));
  const practical = report.sections.find((section) => section.heading === 'Практический выход').blocks[0];
  assert.match(practical.items[0], /NO: n = 0\.16 моль; m = 4\.80096 г; V = 3\.92 л \(САТП\)/);
});

test('таблицы и ряд активности из справочника превращаются в блоки отчёта', () => {
  const table = {
    tHead: { rows: [{ cells: [{ textContent: ' Формула ' }, { textContent: 'Название' }] }] },
    tBodies: [{ rows: [{ cells: [{ textContent: 'H₂O' }, { textContent: '  Вода ' }] }] }],
    rows: []
  };
  assert.deepEqual(tableToReportBlock(table), { type: 'table', headers: ['Формула', 'Название'], rows: [['H₂O', 'Вода']] });
  const container = {
    querySelectorAll: () => [
      { textContent: 'Mn 0.00 В', querySelector: (selector) => selector === 'strong' ? { textContent: 'Mn' } : { textContent: '0.00 В' } },
      { textContent: 'Zn −0.76 В', querySelector: (selector) => selector === 'strong' ? { textContent: 'Zn' } : { textContent: '−0.76 В' } }
    ]
  };
  assert.deepEqual(activityToReportBlock(container).rows, [['Mn', '0.00 В'], ['Zn', '−0.76 В']]);
});

test('при 100 % отчёт не показывает раздел практического выхода', () => {
  const result = calculateStoichiometry('2H2 + O2 = 2H2O', { known: { index: 0, kind: 'amount', value: 2 }, yieldPercent: 100 });
  const report = buildStoichiometryReport(result);
  assert.ok(!report.sections.some((section) => section.heading === 'Практический выход'));
});

test('DOCX собирается как корректный OOXML-пакет с русским текстом и таблицей', () => {
  const report = buildCheckReport({
    equation: parseEquation('HCl + NaOH = NaCl + H2O'),
    conditions: { medium: 'neutral', solvent: 'aqueous' },
    warnings: ['Проверочное предупреждение'],
    verdict: 'Верно'
  });
  const bytes = buildDocx(report);
  assert.ok(bytes.length > 3000);
  const entries = readStoredZip(bytes);
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml', 'docProps/app.xml']) {
    assert.ok(entries.has(name), `missing ${name}`);
  }
  const document = entries.get('word/document.xml');
  assert.match(document, /<w:tbl>/);
  assert.match(document, /<w:tblHeader\/>/);
  assert.match(document, /<w:tblGrid>/);
  assert.match(document, /Проверка уравнения/);
  assert.match(document, /Хлорид натрия/);
  assert.match(document, /Пошаговое решение/);
  assert.doesNotMatch(document, /undefined/);
  assert.match(entries.get('word/styles.xml'), /w:styleId="Heading1"/);
});

test('DOCX поддерживает альбомную ориентацию и широкие таблицы', () => {
  const headers = Array.from({ length: 30 }, (_, index) => `К${index + 1}`);
  const rows = [Array.from({ length: 30 }, (_, index) => `З${index + 1}`)];
  const report = createReport({
    title: 'ChemCalc',
    subtitle: 'Справочник',
    sections: [{ heading: 'Матрица', blocks: [{ type: 'table', headers, rows }] }],
    orientation: 'landscape',
    filename: 'reference'
  });
  const entries = readStoredZip(buildDocx(report));
  const document = entries.get('word/document.xml');
  assert.match(document, /w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/);
  assert.equal((document.match(/<w:gridCol /g) || []).length, 30);
  const widths = [...document.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((match) => Number(match[1]));
  assert.equal(widths.reduce((sum, width) => sum + width, 0), 14570);
  assert.ok(widths.every((width) => width > 0));
  assert.match(document, /<w:tblHeader\/>/);
});

test('PDF собирается с корректным xref, страницами и альбомной ориентацией', () => {
  const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);
  const bytes = buildPdfDocument([
    { jpeg, width: 1588, height: 2246 },
    { jpeg, width: 1588, height: 2246 }
  ], { title: 'Проверка', orientation: 'landscape' });
  const text = Buffer.from(bytes).toString('latin1');
  assert.match(text, /^%PDF-1\.4/);
  assert.equal((text.match(/\/Type \/Page\b/g) || []).length, 2);
  assert.match(text, /\/Count 2/);
  assert.match(text, /\/MediaBox \[0 0 841\.89 595\.28\]/);
  assert.match(text, /\/Title <FEFF041F/);
  const start = Number(text.match(/startxref\n(\d+)\n%%EOF/)[1]);
  assert.equal(text.slice(start, start + 4), 'xref');
  assert.ok(text.trimEnd().endsWith('%%EOF'));
});
