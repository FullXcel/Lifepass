function decodeEntities(text = '') {
  return String(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs = 15000, asBuffer = false, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...rest, signal: controller.signal });
    const contentType = response.headers.get('content-type') || '';
    let body;
    if (asBuffer) {
      body = Buffer.from(await response.arrayBuffer());
    } else if (contentType.includes('application/json') || contentType.includes('+json')) {
      body = await response.json();
    } else {
      body = await response.text();
    }
    if (!response.ok) {
      const err = new Error(`HTTP ${response.status} ${response.statusText} while fetching ${url}`);
      err.responseBody = body;
      err.status = response.status;
      throw err;
    }
    return { body, contentType, status: response.status, url: response.url || url };
  } finally {
    clearTimeout(timer);
  }
}

export function withApiParams(baseUrl, options = {}) {
  if (!baseUrl) return null;
  const {
    key = '',
    authParam = 'serviceKey',
    defaultParams = {},
    params = {},
  } = options;
  const url = new URL(baseUrl);
  if (key && authParam && !url.searchParams.has(authParam)) url.searchParams.set(authParam, key);
  for (const [name, value] of Object.entries({ ...defaultParams, ...params })) {
    if (value !== undefined && value !== null && value !== '' && !url.searchParams.has(name)) {
      url.searchParams.set(name, value);
    }
  }
  return url.toString();
}

export function withServiceKey(baseUrl, key) {
  return withApiParams(baseUrl, {
    key,
    authParam: 'serviceKey',
    defaultParams: { _type: 'json' },
  });
}

function xmlNodeToObject(xml = '') {
  const obj = {};
  const tagPattern = /<([A-Za-z0-9_:\-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;
  let match;
  while ((match = tagPattern.exec(xml))) {
    const key = match[1].replace(/^.*:/, '');
    const inner = match[2];
    const hasChild = /<([A-Za-z0-9_:\-]+)(?:\s[^>]*)?>/.test(inner);
    const value = hasChild ? xmlNodeToObject(inner) : decodeEntities(inner).trim();
    if (obj[key] === undefined) obj[key] = value;
    else if (Array.isArray(obj[key])) obj[key].push(value);
    else obj[key] = [obj[key], value];
  }
  return obj;
}

export function parseXmlRecords(xml = '') {
  const text = String(xml || '');
  const records = [];
  const preferredTags = ['item', 'row', 'data', 'service', 'policy', 'plcy', 'wanted'];
  for (const tag of preferredTags) {
    const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    let match;
    while ((match = pattern.exec(text))) {
      const record = xmlNodeToObject(match[1]);
      if (Object.keys(record).length) records.push(record);
    }
    if (records.length) return records;
  }
  const body = text.match(/<body(?:\s[^>]*)?>([\s\S]*?)<\/body>/i)?.[1] || text;
  const fallback = xmlNodeToObject(body);
  return Object.keys(fallback).length ? [fallback] : [];
}

function flattenObjectArrays(value) {
  if (!value || typeof value !== 'object') return [];
  const queue = [value];
  const arrays = [];
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      arrays.push(current);
      for (const item of current) if (item && typeof item === 'object') queue.push(item);
      continue;
    }
    for (const child of Object.values(current)) {
      if (child && typeof child === 'object') queue.push(child);
    }
  }
  return arrays
    .filter((arr) => arr.length && arr.some((item) => typeof item === 'object'))
    .sort((a, b) => b.length - a.length);
}

export function flattenRecords(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('<')) return parseXmlRecords(trimmed);
    try { return flattenRecords(JSON.parse(trimmed)); } catch { return [{ title: '원문 응답', description: trimmed }]; }
  }
  const candidates = [
    payload.items,
    payload.item,
    payload.data,
    payload.result,
    payload.results,
    payload.list,
    payload.rows,
    payload.services,
    payload.policies,
    payload.response?.body?.items?.item,
    payload.response?.body?.items,
    payload.response?.body?.data,
    payload.response?.body,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (typeof candidate === 'object') {
      const arrays = flattenObjectArrays(candidate);
      if (arrays.length) return arrays[0];
    }
  }
  const arrays = flattenObjectArrays(payload);
  if (arrays.length) return arrays[0];
  return typeof payload === 'object' ? [payload] : [];
}

export function looksLikeDataPortalDocPage(url = '') {
  return /data\.go\.kr\/data\/\d+\/openapi\.do/i.test(String(url || ''));
}