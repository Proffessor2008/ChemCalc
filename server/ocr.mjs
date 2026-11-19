const SUBSCRIPTS = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
const SUPERSCRIPTS = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-' };

export function normalizeOcrEquation(value) {
  let text = String(value || '')
    .replace(/\r/g, '\n')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/\\ce\{([^{}]*)\}/g, '$1')
    .replace(/\\mathrm\{([^{}]*)\}/g, '$1')
    .replace(/\\text\{([^{}]*)\}/g, '$1')
    .replace(/\\left|\\right/g, '')
    .replace(/\\[,!;:]/g, '')
    .replace(/\\rightarrow|\\to|\\longrightarrow|=>|->|⟶|⟹|⇄|⇌|→/g, '=')
    .replace(/\\cdot/g, '·')
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (character) => SUBSCRIPTS[character] || character)
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g, (characters) => `^${[...characters].map((character) => SUPERSCRIPTS[character] || character).join('')}`)
    .replace(/([A-Za-z)\]])\_(\d+)/g, '$1$2')
    .replace(/\^\{([^{}]+)\}/g, '^$1')
    .replace(/[{}]/g, '')
    .replace(/\((?:aq|s|l|g|ж|г|т)\)/gi, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s*\+\s*/g, ' + ')
    .replace(/\s*=\s*/g, ' = ')
    .replace(/^\s+|\s+$/g, '');
  return text;
}

async function recognizeWithSpace(buffer, mime, apiKey) {
  if (!apiKey) throw Object.assign(new Error('OCR.space key is not configured'), { code: 'ocr_space_disabled' });
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), 'equation.jpg');
  form.append('language', 'auto');
  form.append('OCREngine', '2');
  form.append('scale', 'true');
  form.append('detectOrientation', 'true');
  form.append('isOverlayRequired', 'false');
  const response = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: { apikey: apiKey },
    body: form,
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.IsErroredOnProcessing) {
    const message = Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join('; ') : data.ErrorMessage || `HTTP ${response.status}`;
    throw Object.assign(new Error(String(message)), { code: 'ocr_space_failed' });
  }
  const text = (data.ParsedResults || []).map((result) => result.ParsedText || '').join('\n').trim();
  if (!text) throw Object.assign(new Error('OCR.space returned no text'), { code: 'ocr_space_empty' });
  return { text, provider: 'ocr.space', confidence: null };
}

async function recognizeWithTesseract(buffer) {
  const { createWorker } = await import('tesseract.js');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const worker = await createWorker('eng', 1, { cachePath: join(tmpdir(), 'chemcalc-tesseract') });
  try {
    const result = await worker.recognize(buffer);
    const text = String(result?.data?.text || '').trim();
    if (!text) throw Object.assign(new Error('Tesseract returned no text'), { code: 'tesseract_empty' });
    return { text, provider: 'tesseract', confidence: Number.isFinite(result?.data?.confidence) ? result.data.confidence / 100 : null };
  } finally {
    await worker.terminate().catch(() => {});
  }
}

export async function recognizeEquation({
  buffer,
  mime = 'image/jpeg',
  apiKey = '',
  spaceRecognizer = recognizeWithSpace,
  tesseractRecognizer = recognizeWithTesseract
} = {}) {
  const failures = [];
  if (apiKey) {
    try {
      const result = await spaceRecognizer(buffer, mime, apiKey);
      return { ...result, rawText: result.text, text: normalizeOcrEquation(result.text) };
    } catch (error) {
      failures.push(`ocr.space: ${error.message}`);
    }
  }
  try {
    const result = await tesseractRecognizer(buffer);
    return { ...result, rawText: result.text, text: normalizeOcrEquation(result.text) };
  } catch (error) {
    failures.push(`tesseract: ${error.message}`);
  }
  throw Object.assign(new Error('Не удалось распознать изображение'), { status: 502, code: 'ocr_failed', details: failures });
}
