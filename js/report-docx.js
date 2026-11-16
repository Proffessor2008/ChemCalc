import { downloadBlob, safeFilename } from './report.js';

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const xml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => XML_ESCAPES[character]);

function utf8(value) {
  return new TextEncoder().encode(String(value));
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function zipStore(files) {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const name = utf8(file.name);
    const data = file.data;
    const crc = crc32(data);
    const localHeader = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,
      ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)
    ]);
    const local = concatBytes([localHeader, name, data]);
    localParts.push(local);
    const centralHeader = new Uint8Array([
      0x50, 0x4b, 0x01, 0x02,
      ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset)
    ]);
    centralParts.push(concatBytes([centralHeader, name]));
    offset += local.length;
  }
  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06,
    ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(centralSize), ...u32(centralOffset), ...u16(0)
  ]);
  return concatBytes([...localParts, ...centralParts, end]);
}

function textRuns(value, { bold = false, italic = false, color = null, size = null, font = null } = {}) {
  const properties = [
    font ? `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/>` : '',
    bold ? '<w:b/>' : '',
    italic ? '<w:i/>' : '',
    color ? `<w:color w:val="${color}"/>` : '',
    size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : ''
  ].join('');
  const rPr = properties ? `<w:rPr>${properties}</w:rPr>` : '';
  return String(value ?? '').split('\n').map((line, index) => `<w:r>${rPr}${index ? '<w:br/>' : ''}<w:t xml:space="preserve">${xml(line)}</w:t></w:r>`).join('');
}

function paragraph(value, style = 'Normal', options = {}) {
  const pPr = `<w:pPr><w:pStyle w:val="${style}"/>${options.align ? `<w:jc w:val="${options.align}"/>` : ''}</w:pPr>`;
  return `<w:p>${pPr}${textRuns(value, options)}</w:p>`;
}

function metaParagraph(label, value) {
  return `<w:p><w:pPr><w:pStyle w:val="Meta"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${xml(label)}: </w:t></w:r><w:r><w:t xml:space="preserve">${xml(value)}</w:t></w:r></w:p>`;
}

function columnWidths(rows, columns, contentWidth) {
  const weights = Array.from({ length: columns }, (_, column) => {
    const lengths = rows.map((row) => String(row[column] ?? '').length);
    return Math.max(6, Math.min(44, Math.max(...lengths, 1)));
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const widths = weights.map((weight) => Math.max(1, Math.round(contentWidth * weight / total)));
  const widthTotal = widths.reduce((sum, width) => sum + width, 0);
  if (widthTotal !== contentWidth) widths[widths.length - 1] += contentWidth - widthTotal;
  return widths;
}

function tableBlock(headers, rows, contentWidth, options = {}) {
  const columns = Math.max(headers.length, ...rows.map((row) => row.length));
  const normalizedHeaders = Array.from({ length: columns }, (_, index) => headers[index] ?? '');
  const normalizedRows = rows.map((row) => Array.from({ length: columns }, (_, index) => row[index] ?? ''));
  if (!normalizedRows.length) return '';
  const widths = columnWidths([normalizedHeaders, ...normalizedRows], columns, contentWidth);
  const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="C9D6D3"/>`;
  const cellMargins = options.ionMatrix ? '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="30" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="30" w:type="dxa"/></w:tblCellMar>' : '<w:tblCellMar><w:top w:w="50" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="50" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar>';
  const tblPr = `<w:tblPr><w:tblW w:w="${contentWidth}" w:type="dxa"/><w:tblBorders>${border('top')}${border('left')}${border('bottom')}${border('right')}${border('insideH')}${border('insideV')}</w:tblBorders><w:tblLayout w:type="fixed"/>${cellMargins}</w:tblPr>`;
  const grid = `<w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`;
  const row = (cells, header) => `<w:tr><w:trPr><w:cantSplit/>${header && options.ionMatrix ? '<w:trHeight w:val="900" w:hRule="atLeast"/>' : ''}${header ? '<w:tblHeader/>' : ''}</w:trPr>${cells.map((cell, index) => {
    const direction = header && options.ionMatrix && index > 0 ? '<w:textDirection w:val="btLr"/><w:vAlign w:val="bottom"/>' : '';
    return `<w:tc><w:tcPr><w:tcW w:w="${widths[index]}" w:type="dxa"/>${direction}${header ? '<w:shd w:val="clear" w:color="auto" w:fill="E7F0EE"/>' : ''}</w:tcPr>${paragraph(cell, options.ionMatrix ? 'TableTextCompact' : 'TableText', { bold: header })}</w:tc>`;
  }).join('')}</w:tr>`;
  return `<w:tbl>${tblPr}${grid}${row(normalizedHeaders, true)}${normalizedRows.map((cells) => row(cells, false)).join('')}</w:tbl>${options.ionMatrix ? '' : paragraph('', 'Normal')}`;
}

function stylesXml() {
  const style = (id, name, basedOn, options) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${basedOn ? `<w:basedOn w:val="${basedOn}"/>` : ''}<w:next w:val="Normal"/><w:qFormat/>${options}</w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
${style('Normal', 'Normal', null, '')}
${style('Title', 'Title', 'Normal', '<w:pPr><w:spacing w:before="0" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="0D6B62"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr>')}
${style('Subtitle', 'Subtitle', 'Normal', '<w:pPr><w:spacing w:after="220"/></w:pPr><w:rPr><w:color w:val="5B6B69"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>')}
${style('Heading1', 'Heading 1', 'Normal', '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/></w:pPr><w:rPr><w:b/><w:color w:val="0D6B62"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr>')}
${style('Heading2', 'Heading 2', 'Normal', '<w:pPr><w:keepNext/><w:spacing w:before="180" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="174F49"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>')}
${style('Equation', 'Equation', 'Normal', '<w:pPr><w:spacing w:before="120" w:after="120"/><w:jc w:val="center"/></w:pPr><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:eastAsia="Cambria" w:cs="Cambria"/><w:color w:val="0A4A44"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>')}
${style('Meta', 'Meta', 'Normal', '<w:pPr><w:spacing w:after="40"/></w:pPr><w:rPr><w:color w:val="5B6B69"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>')}
${style('TableText', 'Table Text', 'Normal', '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>')}
${style('TableTextCompact', 'Table Text Compact', 'Normal', '<w:pPr><w:spacing w:after="0" w:line="200" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="12"/><w:szCs w:val="12"/></w:rPr>')}
${style('ListParagraph', 'List Paragraph', 'Normal', '<w:pPr><w:ind w:left="420" w:hanging="220"/><w:spacing w:after="40"/></w:pPr><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>')}
</w:styles>`;
}

function sectionXml(section, contentWidth) {
  const blocks = [];
  if (section.heading) blocks.push(paragraph(section.heading, 'Heading1'));
  for (const block of section.blocks || []) {
    if (block.type === 'paragraph') {
      blocks.push(paragraph(block.text, block.variant === 'subheading' ? 'Heading2' : 'Normal'));
    } else if (block.type === 'equation') {
      blocks.push(paragraph(block.text, 'Equation'));
    } else if (block.type === 'list') {
      let counter = 0;
      block.items.forEach((item) => {
        const prefix = block.ordered ? `${(counter += 1)}. ` : '• ';
        blocks.push(paragraph(`${prefix}${item}`, 'ListParagraph'));
      });
    } else if (block.type === 'table') {
      if (block.forcePageBreak && blocks.length) blocks.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      if (block.caption) blocks.push(paragraph(block.caption, 'Heading2'));
      blocks.push(tableBlock(block.headers || [], block.rows || [], contentWidth, { ionMatrix: block.ionMatrix }));
    }
  }
  return blocks.join('');
}

export function buildDocx(report) {
  const landscape = report.orientation === 'landscape';
  const pageWidth = landscape ? 16838 : 11906;
  const pageHeight = landscape ? 11906 : 16838;
  const margin = 1134;
  const contentWidth = pageWidth - margin * 2;
  const body = [];
  body.push(paragraph(report.title, 'Title'));
  if (report.subtitle) body.push(paragraph(report.subtitle, 'Subtitle'));
  for (const entry of report.meta) body.push(metaParagraph(entry.label, entry.value));
  for (const section of report.sections) body.push(sectionXml(section, contentWidth));
  const sectPr = `<w:sectPr><w:pgSz w:w="${pageWidth}" w:h="${pageHeight}"${landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join('')}${sectPr}</w:body></w:document>`;
  const now = new Date().toISOString();
  const files = [
    {
      name: '[Content_Types].xml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`)
    },
    {
      name: '_rels/.rels',
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`)
    },
    { name: 'word/document.xml', data: utf8(document) },
    { name: 'word/styles.xml', data: utf8(stylesXml()) },
    {
      name: 'word/_rels/document.xml.rels',
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)
    },
    {
      name: 'docProps/core.xml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(report.documentTitle)}</dc:title><dc:creator>ChemCalc</dc:creator><cp:lastModifiedBy>ChemCalc</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`)
    },
    {
      name: 'docProps/app.xml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>ChemCalc</Application></Properties>`)
    }
  ];
  return zipStore(files);
}

export async function downloadReportDocx(report) {
  const bytes = buildDocx(report);
  if (typeof document === 'undefined') return bytes;
  await downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), safeFilename(report.filename || report.documentTitle, 'docx'));
  return bytes;
}
