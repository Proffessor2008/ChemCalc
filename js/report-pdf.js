import { downloadBlob, safeFilename } from './report.js';

const PAGE_SIZES = {
  portrait: { width: 794, height: 1123 },
  landscape: { width: 1123, height: 794 }
};

const REPORT_CSS = `
.report-page { box-sizing: border-box; padding: 48px 48px 60px; background: #ffffff; color: #142725; font-family: "Segoe UI", Arial, sans-serif; font-size: 13px; line-height: 1.45; position: relative; overflow: hidden; }
.report-page, .report-page * { box-sizing: border-box; }
.report-page h1 { margin: 0 0 4px; color: #0d6b62; font-size: 27px; line-height: 1.15; letter-spacing: 0; }
.report-page .report-subtitle { margin: 0 0 16px; color: #5b6b69; font-size: 15px; }
.report-page h2 { margin: 22px 0 8px; color: #0d6b62; font-size: 17px; line-height: 1.25; letter-spacing: 0; page-break-after: avoid; }
.report-page h3 { margin: 14px 0 6px; color: #174f49; font-size: 14px; letter-spacing: 0; }
.report-page p { margin: 0 0 7px; }
.report-page .report-lead { font-size: 14px; }
.report-page .report-equation { margin: 8px 0 14px; padding: 8px 10px; border-left: 3px solid #0d6b62; background: #eef6f4; color: #0a4a44; font-family: Cambria, Georgia, serif; font-size: 17px; overflow-wrap: anywhere; }
.report-page .report-meta { display: grid; gap: 2px; margin: 0 0 6px; }
.report-page .report-meta-row { color: #5b6b69; font-size: 11px; }
.report-page .report-meta-row strong { color: #174f49; }
.report-page .report-body { display: flow-root; }
.report-page ul, .report-page ol { margin: 4px 0 10px; padding-left: 22px; }
.report-page li { margin: 3px 0; }
.report-page table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 6px 0 12px; font-size: 10px; }
.report-page th, .report-page td { border: 1px solid #c9d6d3; padding: 4px 5px; text-align: left; vertical-align: top; overflow-wrap: anywhere; white-space: normal; position: static; font-size: 10px; line-height: 1.3; }
.report-page th { background: #e7f0ee; color: #174f49; font-weight: 700; letter-spacing: 0; }
.report-page .report-table-wide th, .report-page .report-table-wide td { font-size: 8px; padding: 2px 3px; }
.report-page .report-footer { position: absolute; left: 48px; right: 48px; bottom: 16px; display: flex; justify-content: space-between; gap: 12px; padding-top: 5px; border-top: 1px solid #d8e2e0; color: #6b7a78; font-size: 8px; }
.report-page .report-footer span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBinary(bytes) {
  let result = '';
  const chunk = 8192;
  for (let index = 0; index < bytes.length; index += chunk) {
    result += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
  }
  return result;
}

function pdfHexText(value) {
  let hex = 'FEFF';
  for (const character of String(value)) {
    let code = character.codePointAt(0);
    if (code > 0xffff) {
      code -= 0x10000;
      hex += (0xd800 + (code >> 10)).toString(16).toUpperCase().padStart(4, '0');
      hex += (0xdc00 + (code & 0x3ff)).toString(16).toUpperCase().padStart(4, '0');
    } else {
      hex += code.toString(16).toUpperCase().padStart(4, '0');
    }
  }
  return `<${hex}>`;
}

export function buildPdfDocument(pages, { title = 'ChemCalc', orientation = 'portrait' } = {}) {
  const landscape = orientation === 'landscape';
  const pageWidth = landscape ? 841.89 : 595.28;
  const pageHeight = landscape ? 595.28 : 841.89;
  const objects = [];
  const objectCount = 3 + pages.length * 3;
  const setObject = (number, body) => { objects[number - 1] = body; };
  const kids = pages.map((_, index) => `${4 + index * 3} 0 R`).join(' ');
  setObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  setObject(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  setObject(3, `<< /Title ${pdfHexText(title)} /Author (ChemCalc) /Creator (ChemCalc) /Producer (ChemCalc) /CreationDate (D:${timestamp}) >>`);
  pages.forEach((page, index) => {
    const pageNumber = 4 + index * 3;
    const contentNumber = pageNumber + 1;
    const imageNumber = pageNumber + 2;
    const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`;
    setObject(pageNumber, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 ${imageNumber} 0 R >> >> /Contents ${contentNumber} 0 R >>`);
    setObject(contentNumber, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    setObject(imageNumber, `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n${bytesToBinary(page.jpeg)}\nendstream`);
  });
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = new Array(objectCount + 1).fill(0);
  for (let number = 1; number <= objectCount; number += 1) {
    offsets[number] = pdf.length;
    pdf += `${number} 0 obj\n${objects[number - 1]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let number = 1; number <= objectCount; number += 1) {
    pdf += `${String(offsets[number]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  const bytes = new Uint8Array(pdf.length);
  for (let index = 0; index < pdf.length; index += 1) bytes[index] = pdf.charCodeAt(index) & 0xff;
  return bytes;
}

function createElement(tag, className = '', text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null) node.textContent = text;
  return node;
}

function createPage(host, dims) {
  const page = createElement('div', 'report-page');
  page.style.width = `${dims.width}px`;
  page.style.height = `${dims.height}px`;
  const body = createElement('div', 'report-body');
  const footer = createElement('div', 'report-footer');
  page.append(body, footer);
  host.append(page);
  return { page, body, footer };
}

function createTable(headers, rows) {
  const table = createElement('table');
  if (headers.length > 8) table.classList.add('report-table-wide');
  const header = createElement('thead');
  const headerRow = createElement('tr');
  const weights = headers.map((item, column) => {
    const lengths = [item, ...rows.map((row) => row[column] ?? '')].map((value) => String(value).length);
    return Math.max(6, Math.min(44, Math.max(...lengths, 1)));
  });
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  const percentages = weights.map((value) => value / total * 100);
  headers.forEach((text, index) => {
    const cell = createElement('th', '', text);
    cell.style.width = `${percentages[index].toFixed(2)}%`;
    headerRow.append(cell);
  });
  header.append(headerRow);
  const body = createElement('tbody');
  table.append(header, body);
  return { table, body };
}

export function paginateReport(report) {
  const dims = PAGE_SIZES[report.orientation] || PAGE_SIZES.portrait;
  const style = document.createElement('style');
  style.textContent = REPORT_CSS;
  const host = createElement('div', 'report-page-host');
  host.style.position = 'absolute';
  host.style.left = '-100000px';
  host.style.top = '0';
  host.style.width = `${dims.width}px`;
  document.head.append(style);
  document.body.append(host);
  try {
  const pages = [];
  const maxBodyHeight = dims.height - 48 - 60;
  const startPage = () => {
    const page = createPage(host, dims);
    pages.push(page);
    return page;
  };
  let current = startPage();

  const append = (node) => {
    current.body.append(node);
    if (current.body.scrollHeight > maxBodyHeight + 1 && current.body.children.length > 1) {
      current.body.removeChild(node);
      current = startPage();
      current.body.append(node);
    }
  };

  const title = createElement('h1', '', report.title);
  current.body.append(title);
  if (report.subtitle) current.body.append(createElement('p', 'report-subtitle', report.subtitle));
  if (report.meta.length) {
    const meta = createElement('div', 'report-meta');
    for (const entry of report.meta) {
      const row = createElement('div', 'report-meta-row');
      row.append(createElement('strong', '', `${entry.label}: `), createElement('span', '', entry.value));
      meta.append(row);
    }
    append(meta);
  }

  for (const section of report.sections) {
    if (current.body.scrollHeight + 52 > maxBodyHeight && current.body.children.length > 0) current = startPage();
    if (section.heading) current.body.append(createElement('h2', '', section.heading));
    for (const block of section.blocks || []) {
      if (block.type === 'paragraph') {
        append(createElement(block.variant === 'subheading' ? 'h3' : 'p', block.variant === 'lead' ? 'report-lead' : '', block.text));
      } else if (block.type === 'equation') {
        append(createElement('div', 'report-equation', block.text));
      } else if (block.type === 'list') {
        let list = createElement(block.ordered ? 'ol' : 'ul');
        let counter = 0;
        append(list);
        for (const item of block.items) {
          const entry = createElement('li', '', item);
          list.append(entry);
          counter += 1;
          if (current.body.scrollHeight > maxBodyHeight + 1 && list.children.length > 1) {
            list.removeChild(entry);
            counter -= 1;
            current = startPage();
            list = createElement(block.ordered ? 'ol' : 'ul');
            if (block.ordered) list.setAttribute('start', String(counter + 1));
            current.body.append(list);
            list.append(entry);
            counter += 1;
          }
        }
      } else if (block.type === 'table') {
        let table = createTable(block.headers || [], block.rows || []);
        append(table.table);
        for (const row of block.rows || []) {
          const tr = createElement('tr');
          for (const cell of row) tr.append(createElement('td', '', cell));
          table.body.append(tr);
          if (current.body.scrollHeight > maxBodyHeight + 1 && table.body.rows.length > 1) {
            table.body.removeChild(tr);
            current = startPage();
            table = createTable(block.headers || [], block.rows || []);
            current.body.append(table.table);
            table.body.append(tr);
          }
        }
      }
    }
  }

  pages.forEach((page, index) => {
    page.footer.append(createElement('span', '', report.documentTitle), createElement('span', '', `${index + 1} / ${pages.length}`));
  });
  const result = pages.map((page) => ({ html: page.page.innerHTML, width: dims.width, height: dims.height }));
  return result;
  } finally {
    host.remove();
    style.remove();
  }
}

async function renderPageToJpeg(page, scale = 2) {
  const wrapper = `<div xmlns="http://www.w3.org/1999/xhtml" class="report-page" style="width:${page.width}px;height:${page.height}px"><style>${REPORT_CSS}</style>${page.html}</div>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}"><foreignObject x="0" y="0" width="${page.width}" height="${page.height}">${wrapper}</foreignObject></svg>`;
  const image = new Image();
  image.decoding = 'sync';
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PDF page render timeout')), 10000);
    image.onload = () => { clearTimeout(timer); resolve(); };
    image.onerror = () => { clearTimeout(timer); reject(new Error('PDF page render failed')); };
    image.src = source;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(page.width * scale);
  canvas.height = Math.round(page.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const sample = context.getImageData(0, 0, canvas.width, Math.min(220, canvas.height)).data;
  let hasInk = false;
  for (let index = 0; index < sample.length; index += 4) {
    if (sample[index] < 245 || sample[index + 1] < 245 || sample[index + 2] < 245) {
      hasInk = true;
      break;
    }
  }
  if (!hasInk) throw new Error('PDF page rendered blank');
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  return { jpeg: base64ToBytes(dataUrl.split(',')[1]), width: canvas.width, height: canvas.height };
}

export async function buildReportPdf(report, { onProgress } = {}) {
  if (typeof document === 'undefined') throw new Error('PDF export requires a browser');
  const pages = paginateReport(report);
  const images = [];
  for (let index = 0; index < pages.length; index += 1) {
    onProgress?.(index + 1, pages.length);
    images.push(await renderPageToJpeg(pages[index]));
  }
  return buildPdfDocument(images, { title: report.documentTitle, orientation: report.orientation });
}

export async function downloadReportPdf(report, options = {}) {
  const bytes = await buildReportPdf(report, options);
  if (typeof document === 'undefined') return bytes;
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), safeFilename(report.filename || report.documentTitle, 'pdf'));
  return bytes;
}
