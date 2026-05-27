import fs from 'node:fs/promises';
import path from 'node:path';

function stripHtml(html = '') {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripXml(xml = '') {
  return String(xml)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractTextFromHtml(html) {
  return { text: stripHtml(html), parser: 'server-html-stripper' };
}

export async function extractTextFromPdfBuffer(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: false }).promise;
  const chunks = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    chunks.push(content.items.map((item) => item.str || '').join(' '));
  }
  return { text: chunks.join('\n'), parser: 'server-pdfjs-text-layer', pages: pdf.numPages };
}

export async function extractTextFromDocxBuffer(buffer) {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return { text: result.value || '', parser: 'server-mammoth-docx', warnings: result.messages || [] };
}

export async function extractTextFromHwpxBuffer(buffer) {
  const JSZip = await import('jszip');
  const zip = await JSZip.default.loadAsync(buffer);
  const files = Object.values(zip.files).filter((f) => /Contents\/.*\.xml$|content.*\.xml$|section.*\.xml$/i.test(f.name));
  const chunks = [];
  for (const file of files) chunks.push(stripXml(await file.async('text')));
  return { text: chunks.join('\n'), parser: 'server-hwpx-zip-xml' };
}

export function extractVisibleTextFromHwpBuffer(buffer) {
  const utf16 = new TextDecoder('utf-16le', { fatal: false }).decode(buffer);
  const visible16 = utf16.match(/[가-힣A-Za-z0-9\s:：,._\-()]{3,}/g)?.join(' ') || '';
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  const visible8 = utf8.match(/[가-힣A-Za-z0-9\s:：,._\-()]{3,}/g)?.join(' ') || '';
  return {
    text: visible16.length > visible8.length ? visible16 : visible8,
    parser: 'server-hwp-visible-string-fallback',
    warnings: ['바이너리 HWP는 구조화 파싱이 제한적입니다. 가능하면 HWPX/PDF 원문을 함께 저장하세요.'],
  };
}

export async function extractTextFromBuffer(buffer, filename = '', contentType = '') {
  const ext = path.extname(filename).replace('.', '').toLowerCase();
  if (contentType.includes('html') || ['html', 'htm'].includes(ext)) return extractTextFromHtml(buffer.toString('utf-8'));
  if (contentType.includes('pdf') || ext === 'pdf') return extractTextFromPdfBuffer(buffer);
  if (contentType.includes('wordprocessingml') || ext === 'docx') return extractTextFromDocxBuffer(buffer);
  if (['hwpx', 'owpml'].includes(ext)) return extractTextFromHwpxBuffer(buffer);
  if (ext === 'hwp') return extractVisibleTextFromHwpBuffer(buffer);
  return { text: buffer.toString('utf-8'), parser: 'server-plain-text' };
}

export async function extractTextFromFilePath(filePath, contentType = '') {
  const buffer = await fs.readFile(filePath);
  return extractTextFromBuffer(buffer, path.basename(filePath), contentType);
}
