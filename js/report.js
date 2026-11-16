import { getLocale } from './i18n.js';
import { getTelegramController } from './telegram.js';

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

function readBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.readAsDataURL(blob);
  });
}

async function uploadTemporaryFile(blob, filename) {
  const data = await readBase64(blob);
  const response = await fetch('/api/files/temp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, type: blob.type, data })
  });
  if (!response.ok) throw new Error('Не удалось подготовить файл');
  const result = await response.json();
  return result.url;
}

export async function downloadBlob(blob, filename) {
  const telegram = getTelegramController();
  if (telegram) {
    try {
      const url = await uploadTemporaryFile(blob, filename);
      if (await telegram.downloadFile(url, filename)) return;
    } catch (error) {
      console.error('ChemCalc Telegram download failed', error);
    }
  }
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
