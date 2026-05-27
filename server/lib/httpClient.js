export async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs = 15000, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...rest, signal: controller.signal });
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const err = new Error(`HTTP ${response.status} ${response.statusText} while fetching ${url}`);
      err.responseBody = body;
      throw err;
    }
    return { body, contentType, status: response.status, url };
  } finally {
    clearTimeout(timer);
  }
}

export function withServiceKey(baseUrl, key) {
  if (!baseUrl) return null;
  const url = new URL(baseUrl);
  if (key && !url.searchParams.has('serviceKey')) url.searchParams.set('serviceKey', key);
  if (!url.searchParams.has('_type')) url.searchParams.set('_type', 'json');
  return url.toString();
}

export function flattenRecords(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  const candidates = [
    payload.items,
    payload.item,
    payload.data,
    payload.result,
    payload.response?.body?.items?.item,
    payload.response?.body?.items,
    payload.response?.body?.data,
    payload.response?.body,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (typeof candidate === 'object') {
      const values = Object.values(candidate).filter((v) => Array.isArray(v));
      if (values.length) return values.flat();
    }
  }
  return typeof payload === 'object' ? [payload] : [];
}
