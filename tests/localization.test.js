import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import thermoData from '../data/thermo.json' with { type: 'json' };
import { SUBSTANCE_CLASSES, classLabel } from '../js/classes.js';
import { t } from '../js/i18n.js';

const hasCyrillic = (value) => /[А-Яа-яЁё]/.test(value);
const latinOnly = (value) => /[A-Za-z]/.test(value) && !hasCyrillic(value);

test('в термодинамическом справочнике нет английских названий веществ', () => {
  const english = thermoData.records.filter((record) => latinOnly(record.name_ru));
  assert.deepEqual(english.map((record) => `${record.formula}: ${record.name_ru}`), []);
  for (const record of thermoData.records) assert.ok(hasCyrillic(record.name_ru), `${record.id}: ${record.name_ru}`);
  const suspicious = thermoData.records.filter((record) => /[a-z]/.test(record.name_ru) && !/\[[^\]]*\]/.test(record.name_ru));
  assert.deepEqual(suspicious.map((record) => `${record.formula}: ${record.name_ru}`), []);
});

test('все классы веществ имеют русские подписи', () => {
  for (const value of SUBSTANCE_CLASSES) {
    const label = classLabel(value);
    assert.notEqual(label, value, `нет подписи для класса ${value}`);
    assert.ok(hasCyrillic(label), `класс ${value} переведён не на русский: ${label}`);
  }
});

test('подписи экспорта и отчётов переведены', () => {
  for (const key of ['exportPdf', 'exportDocx', 'exportPreparing', 'exportPage', 'exportReady', 'exportFailed', 'exportPdfFailed', 'exportHint', 'reportCheckTitle', 'reportAutoTitle', 'reportStoichTitle', 'reportReferenceTitle', 'reportGenerated', 'reportVerdict', 'reportFilter', 'reportEquation', 'limitingReactantLabel', 'availableMolesShort', 'remainingMolesShort', 'warnings']) {
    assert.notEqual(t(key), key, `нет перевода для ${key}`);
  }
});

test('справочник термодинамики выбирает язык названия', () => {
  const source = readFileSync('js/reference-ui.js', 'utf8');
  assert.ok(source.includes('recordName'));
  assert.ok(source.includes('getLocale() === \'en\''));
  assert.ok(source.includes('record.name_en || record.name_ru'));
});

test('форма вещества использует переведённые классы', () => {
  const source = readFileSync('js/community-ui.js', 'utf8');
  assert.ok(source.includes('SUBSTANCE_CLASSES'));
  assert.ok(source.includes('classLabel'));
  assert.ok(source.includes('selectOptions(SUBSTANCE_CLASSES'));
});
