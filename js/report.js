import { getLocale } from './i18n.js';

export function formatReportDate(date = new Date()) {
  try {
    return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'long', timeStyle: 'short' }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function createReport({ title = 'ChemCalc', subtitle = '', meta = [], sections = [], orientation = 'portrait', filename = 'chemcalc-report' }) {
  const normalizedMeta = meta
    .map((entry) => Array.isArray(entry) ? { label: String(entry[0]), value: entry[1] } : entry)
    .filter((entry) => entry && entry.value !== undefined && entry.value !== null && String(entry.value).trim() !== '')
    .map((entry) => ({ label: String(entry.label), value: String(entry.value) }));
  return {
    title: String(title),
    subtitle: String(subtitle || ''),
    meta: normalizedMeta,
    sections: sections.filter((section) => section && (section.heading || section.blocks?.length)),
    orientation: orientation === 'landscape' ? 'landscape' : 'portrait',
    filename,
    documentTitle: [title, subtitle].filter(Boolean).join(' — ')
  };
}

export function safeFilename(name, extension) {
  const base = String(name || 'chemcalc-report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'chemcalc-report';
  return `${base}.${extension}`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
