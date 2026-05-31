import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildSearchIndex } from './searchIndex.js';
import { flattenRecords, redactUrlCredentials } from './httpClient.js';

const FILES = {
  policies: 'policies.json',
  drafts: 'review_drafts.json',
  snapshots: 'source_snapshots.json',
  index: 'search_index.json',
  apiCache: 'api_cache.json',
  rawDir: 'raw',
};

const DEFAULT_VALUES = {
  policies: [],
  drafts: [],
  snapshots: [],
  index: { generated_at: null, index: {} },
  apiCache: [],
};

let poolPromise = null;
function usePostgres() {
  return Boolean(process.env.DATABASE_URL);
}

async function getPool() {
  if (!usePostgres()) return null;
  if (!poolPromise) {
    poolPromise = import('pg').then(({ Pool }) => new Pool({ connectionString: process.env.DATABASE_URL }));
  }
  return poolPromise;
}

async function ensurePostgres() {
  const pool = await getPool();
  if (!pool) return null;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lifepass_policy_documents (
      kind TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lifepass_raw_documents (
      source_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (source_id, external_id)
    )
  `);
  return pool;
}

async function ensureStore(storeDir) {
  if (usePostgres()) {
    await ensurePostgres();
    return;
  }
  await fs.mkdir(storeDir, { recursive: true });
  await fs.mkdir(path.join(storeDir, FILES.rawDir), { recursive: true });
  for (const key of ['policies', 'drafts', 'snapshots', 'index', 'apiCache']) {
    const file = path.join(storeDir, FILES[key]);
    try { await fs.access(file); }
    catch { await fs.writeFile(file, JSON.stringify(DEFAULT_VALUES[key], null, 2)); }
  }
}

async function readJson(storeDir, key) {
  await ensureStore(storeDir);
  if (usePostgres()) {
    const pool = await ensurePostgres();
    const result = await pool.query('SELECT data FROM lifepass_policy_documents WHERE kind = $1', [key]);
    if (!result.rows.length) {
      await pool.query(
        'INSERT INTO lifepass_policy_documents(kind, data) VALUES($1, $2::jsonb) ON CONFLICT (kind) DO NOTHING',
        [key, JSON.stringify(DEFAULT_VALUES[key])],
      );
      return structuredClone(DEFAULT_VALUES[key]);
    }
    return result.rows[0].data;
  }
  const text = await fs.readFile(path.join(storeDir, FILES[key]), 'utf-8');
  return JSON.parse(text || JSON.stringify(DEFAULT_VALUES[key]));
}

async function writeJson(storeDir, key, value) {
  await ensureStore(storeDir);
  if (usePostgres()) {
    const pool = await ensurePostgres();
    await pool.query(
      `INSERT INTO lifepass_policy_documents(kind, data, updated_at)
       VALUES($1, $2::jsonb, NOW())
       ON CONFLICT (kind) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [key, JSON.stringify(value)],
    );
    return;
  }
  await fs.writeFile(path.join(storeDir, FILES[key]), JSON.stringify(value, null, 2));
}

export function sha256(value = '') {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export async function loadPolicies(storeDir) {
  const [policies, apiCache] = await Promise.all([readJson(storeDir, 'policies'), readJson(storeDir, 'apiCache')]);
  return enhancePolicyListForDisplay(policies, apiCache);
}
export async function loadDrafts(storeDir) { return readJson(storeDir, 'drafts'); }
export async function loadSnapshots(storeDir) { return readJson(storeDir, 'snapshots'); }
export async function loadSearchIndex(storeDir) { return readJson(storeDir, 'index'); }
export async function loadApiCache(storeDir) { return readJson(storeDir, 'apiCache'); }


function sanitizeValue(value) {
  if (typeof value === 'string') return redactUrlCredentials(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitizeValue(child)]));
  }
  return value;
}


const PUBLIC_URL_KEYS = [
  '상세조회URL', '상세조회Url', '서비스상세URL', '상세페이지URL', '신청URL', '온라인신청URL', '신청링크', '상세URL',
  'url', 'link', 'detailUrl', 'detailLink', 'applyUrl', 'onlineApplyUrl', 'homepageUrl', 'referenceUrl', 'siteUrl', '바로가기',
];
const SECRET_QUERY_PARAMS = new Set(['servicekey', 'oc', 'authkey', 'openapivlak', 'apikey', 'key']);
const URL_PATTERN = /https?:\/\/[^\s<>)\]]+/i;

function stringifyRecordValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(stringifyRecordValue).filter(Boolean).join('\n');
  if (typeof value === 'object') return Object.values(value).map(stringifyRecordValue).filter(Boolean).join('\n');
  return String(value).trim();
}

function firstUrl(value = '') {
  const text = stringifyRecordValue(value);
  return text.match(URL_PATTERN)?.[0] || text;
}

function isApiTraceUrl(url) {
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  if (host.includes('apis.data.go.kr') || host.includes('api.odcloud.kr')) return true;
  if (pathname.includes('/drf/lawsearch.do') || pathname.includes('/drf/lawservice.do')) return true;
  if (pathname.includes('/opi/') && /openapivlak|authkey|servicekey/i.test(url.search)) return true;
  return [...url.searchParams.keys()].some((key) => SECRET_QUERY_PARAMS.has(key.toLowerCase()));
}

function sanitizePublicUrl(value = '') {
  try {
    const url = new URL(firstUrl(value));
    if (!/^https?:$/.test(url.protocol)) return '';
    if (isApiTraceUrl(url)) return '';
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return '';
  }
}

function publicUrlFromRecord(record = {}) {
  for (const key of PUBLIC_URL_KEYS) {
    const url = sanitizePublicUrl(record?.[key]);
    if (url) return url;
  }
  const nested = sanitizePublicUrl(record?._lifepass_detail?.상세조회URL || record?._lifepass_detail?.applyUrl || record?._lifepass_detail?.onlineApplyUrl);
  if (nested) return nested;
  return '';
}

function normalizeLookupKey(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function buildPublicLinkLookup(apiCache = []) {
  const byName = new Map();
  const byId = new Map();
  for (const entry of apiCache || []) {
    for (const record of flattenRecords(entry.body)) {
      const href = publicUrlFromRecord(record);
      if (!href) continue;
      const name = normalizeLookupKey(record['서비스명'] || record.serviceName || record.servNm || record.name || record.title);
      const id = String(record['서비스ID'] || record.serviceId || record.svcId || record.servId || record.id || '').trim();
      if (name && !byName.has(name)) byName.set(name, href);
      if (id && !byId.has(id)) byId.set(id, href);
    }
  }
  return { byName, byId };
}


const LEGAL_SCOPE_RULES = [
  { domain: '생활지원', label: '생계·긴급복지·기초생활 보장 정책', pattern: /국민기초생활|기초생활보장|긴급복지|생계급여|차상위|사회보장|복지|저소득/ },
  { domain: '주거', label: '주거급여·공공임대·월세·전월세 지원 정책', pattern: /주거급여|공공주택|임대주택|주택|월세|전세|임대차|주거/ },
  { domain: '고용', label: '고용보험·국민취업지원·직업훈련·구직 지원 정책', pattern: /고용보험|국민취업지원|직업능력|직업훈련|구직|취업|실업급여|근로자|일자리/ },
  { domain: '의료', label: '의료급여·건강보험·의료비 지원 정책', pattern: /의료급여|건강보험|의료비|요양|병원|치료|건강/ },
  { domain: '교육', label: '교육비·장학·학자금 지원 정책', pattern: /교육급여|교육비|장학|학자금|수업료|학교|대학생/ },
  { domain: '청년', label: '청년 주거·취업·자립 지원 정책', pattern: /청년|청소년|대학생|사회초년|자립준비/ },
  { domain: '금융', label: '서민금융·채무조정·보증·이자 지원 정책', pattern: /서민금융|채무|신용|보증|이자|대출|금융/ },
];

function inferLegalReferenceDisplayInfo(policy = {}) {
  const text = [policy.name, policy.description, policy.target, policy.source?.label].filter(Boolean).join('\n');
  const matched = LEGAL_SCOPE_RULES.filter((rule) => rule.pattern.test(text));
  const scope = matched.length ? matched.map((rule) => rule.label).join(', ') : '복지·고용·주거 등 관련 정책';
  return {
    related_policy_domains: policy.related_policy_domains?.length ? policy.related_policy_domains : matched.map((rule) => rule.domain),
    legal_basis_summary: policy.legal_basis_summary || `${policy.name || '법령'}은 ${scope}와 연결되는 상위 근거입니다. 직접 지급되는 혜택으로 계산하지 않고 정책 판정 설명과 원문 확인용으로 분리합니다.`,
    legal_basis_role: policy.legal_basis_role || `${scope}의 대상자 범위, 지원 기준, 급여·서비스 범위, 행정기관 집행 권한을 설명하는 법적 근거입니다.`,
    user_value: policy.user_value || '사용자는 이 근거를 통해 해당 혜택이 왜 존재하는지, 본인이 어떤 자격 기준 때문에 대상 또는 제외 대상이 되는지, 상담·문의·이의제기 때 어떤 원문을 확인해야 하는지 알 수 있습니다.',
  };
}

function enhancePolicyForDisplay(policy = {}, lookup = null) {
  const next = sanitizeValue(policy || {});
  const current = sanitizePublicUrl(next.apply_url) || sanitizePublicUrl(next.detail_url) || sanitizePublicUrl(next.source?.original_url);
  const sourceId = String(next.source?.external_id || next.service_id || next['서비스ID'] || '').trim();
  const byId = sourceId ? lookup?.byId?.get(sourceId) : '';
  const byName = lookup?.byName?.get(normalizeLookupKey(next.name));
  const publicLink = current || byId || byName || '';
  if (publicLink) {
    next.apply_url = publicLink;
    next.link_status = 'ok';
    next.link_reason = next.link_reason || '공개 상세 페이지 URL을 확인했습니다.';
  } else if (next.apply_url || next.source?.original_url) {
    next.apply_url = '';
    next.link_status = next.link_status || 'api_trace_only';
    next.link_reason = next.link_reason || 'API 호출 URL은 사용자용 링크가 아니므로 숨겼습니다.';
  }
  if (next.source) next.source = { ...next.source, original_url: publicLink || '' };
  if (next.domain === '법령근거' || next.legal_basis) {
    Object.assign(next, inferLegalReferenceDisplayInfo(next));
  }
  return next;
}

function enhancePolicyListForDisplay(policies = [], apiCache = []) {
  const lookup = buildPublicLinkLookup(apiCache);
  return (policies || []).map((policy) => enhancePolicyForDisplay(policy, lookup));
}

function isUsableDraft(draft = {}) {
  if (draft.status !== 'pending_review') return false;
  if (!draft.benefit?.id || !draft.benefit?.name) return false;
  if (draft.benefit?.domain === '법령근거') return true;
  const raw = String(draft.rawText || draft.benefit?.description || '');
  if (draft._lifepass_error || /수집 오류|INVALID_REQUEST_PARAMETER_ERROR|SERVICE ERROR|HTTP \d+/i.test(raw)) return false;
  return true;
}

function draftToCollectedPolicy(draft = {}) {
  return {
    ...(draft.benefit || {}),
    ingestion: draft.ingestion,
    source: sanitizeValue(draft.source || {}),
    collected_at: draft.ingestion?.collected_at || draft.updated_at || draft.created_at,
    review_status: draft.status || 'pending_review',
    change_type: draft.change_type || 'new',
    pending_review: draft.status === 'pending_review',
  };
}

export async function loadCollectedPolicies(storeDir, options = {}) {
  const { includePendingDrafts = true } = options;
  const [policies, drafts, apiCache] = await Promise.all([loadPolicies(storeDir), loadDrafts(storeDir), loadApiCache(storeDir)]);
  const lookup = buildPublicLinkLookup(apiCache);
  const byId = new Map();
  for (const policy of policies) {
    if (policy?.id) byId.set(policy.id, { ...sanitizeValue(policy), review_status: policy.review_status || 'approved', pending_review: false });
  }
  if (includePendingDrafts) {
    for (const draft of drafts) {
      if (!isUsableDraft(draft)) continue;
      const candidate = enhancePolicyForDisplay(draftToCollectedPolicy(draft), lookup);
      if (candidate?.id && !byId.has(candidate.id)) byId.set(candidate.id, candidate);
    }
  }
  return Array.from(byId.values());
}

export async function saveRawDocument(storeDir, sourceId, externalId, content, metadata = {}) {
  await ensureStore(storeDir);
  const safeSource = String(sourceId).replace(/[^a-z0-9_-]/gi, '_');
  const safeId = String(externalId || sha256(content).slice(0, 12)).replace(/[^a-z0-9_-]/gi, '_');
  const filename = `${safeSource}__${safeId}.txt`;
  if (usePostgres()) {
    const pool = await ensurePostgres();
    await pool.query(
      `INSERT INTO lifepass_raw_documents(source_id, external_id, content, metadata, updated_at)
       VALUES($1, $2, $3, $4::jsonb, NOW())
       ON CONFLICT (source_id, external_id)
       DO UPDATE SET content = EXCLUDED.content, metadata = EXCLUDED.metadata, updated_at = NOW()`,
      [String(sourceId), String(externalId || safeId), String(content || ''), JSON.stringify(sanitizeValue(metadata || {}))],
    );
    return { filePath: `postgres://lifepass_raw_documents/${safeSource}/${safeId}`, filename };
  }
  const filePath = path.join(storeDir, FILES.rawDir, filename);
  await fs.writeFile(filePath, String(content || ''));
  await fs.writeFile(`${filePath}.meta.json`, JSON.stringify(sanitizeValue(metadata), null, 2));
  return { filePath, filename };
}

export async function getCachedApiResponse(storeDir, cacheKey, ttlHours = 24) {
  if (!ttlHours || ttlHours <= 0) return null;
  const cache = await loadApiCache(storeDir);
  const item = cache.find((entry) => entry.cache_key === cacheKey);
  if (!item) return null;
  const ageMs = Date.now() - new Date(item.fetched_at).getTime();
  if (!Number.isFinite(ageMs) || ageMs > ttlHours * 60 * 60 * 1000) return null;
  return item;
}

export async function saveApiResponse(storeDir, cacheKey, response) {
  const cache = await loadApiCache(storeDir);
  const next = {
    cache_key: cacheKey,
    fetched_at: new Date().toISOString(),
    status: response.status || 200,
    url: redactUrlCredentials(response.redactedUrl || response.url || ''),
    contentType: response.contentType || '',
    body: response.body,
  };
  const idx = cache.findIndex((entry) => entry.cache_key === cacheKey);
  if (idx >= 0) cache[idx] = next;
  else cache.push(next);
  await writeJson(storeDir, 'apiCache', cache.slice(-1000));
  return next;
}

export async function upsertDraft(storeDir, draft) {
  const drafts = await loadDrafts(storeDir);
  const existingIdx = drafts.findIndex((d) => d.id === draft.id);
  const nextDraft = { ...draft, updated_at: new Date().toISOString() };
  if (existingIdx >= 0) drafts[existingIdx] = { ...drafts[existingIdx], ...nextDraft };
  else drafts.push({ status: 'pending_review', created_at: new Date().toISOString(), ...nextDraft });
  await writeJson(storeDir, 'drafts', drafts);
  return nextDraft;
}

export async function approveDraft(storeDir, draftId, reviewer = 'admin') {
  const drafts = await loadDrafts(storeDir);
  const idx = drafts.findIndex((d) => d.id === draftId);
  if (idx < 0) throw new Error(`검수 대기 정책을 찾을 수 없습니다: ${draftId}`);
  const draft = drafts[idx];
  const policies = await loadPolicies(storeDir);
  const policy = {
    ...draft.benefit,
    ingestion: draft.ingestion,
    source: draft.source,
    approved_at: new Date().toISOString(),
    approved_by: reviewer,
  };
  const pidx = policies.findIndex((p) => p.id === policy.id);
  if (pidx >= 0) policies[pidx] = policy;
  else policies.push(policy);
  drafts[idx] = { ...draft, status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: reviewer };
  await writeJson(storeDir, 'policies', policies);
  await writeJson(storeDir, 'drafts', drafts);
  await rebuildSearchIndex(storeDir);
  return policy;
}

export async function rejectDraft(storeDir, draftId, reviewer = 'admin', reason = '') {
  const drafts = await loadDrafts(storeDir);
  const idx = drafts.findIndex((d) => d.id === draftId);
  if (idx < 0) throw new Error(`검수 대기 정책을 찾을 수 없습니다: ${draftId}`);
  drafts[idx] = { ...drafts[idx], status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: reviewer, reject_reason: reason };
  await writeJson(storeDir, 'drafts', drafts);
  return drafts[idx];
}

export async function recordSnapshot(storeDir, snapshot) {
  const snapshots = await loadSnapshots(storeDir);
  const key = `${snapshot.source_id}:${snapshot.external_id}`;
  const previous = snapshots.find((s) => `${s.source_id}:${s.external_id}` === key);
  const changed = !previous || previous.content_hash !== snapshot.content_hash;
  const next = { ...previous, ...snapshot, changed, checked_at: new Date().toISOString() };
  const idx = snapshots.findIndex((s) => `${s.source_id}:${s.external_id}` === key);
  if (idx >= 0) snapshots[idx] = next;
  else snapshots.push(next);
  await writeJson(storeDir, 'snapshots', snapshots);
  return { snapshot: next, changed, previous };
}

export async function rebuildSearchIndex(storeDir) {
  const policies = await loadPolicies(storeDir);
  const index = buildSearchIndex(policies);
  await writeJson(storeDir, 'index', index);
  return index;
}

export async function storeSummary(storeDir) {
  const [policies, drafts, snapshots, searchIndex, apiCache] = await Promise.all([
    loadPolicies(storeDir), loadDrafts(storeDir), loadSnapshots(storeDir), loadSearchIndex(storeDir), loadApiCache(storeDir),
  ]);
  return {
    storage: usePostgres() ? 'postgresql' : 'json-file',
    policies: policies.length,
    legal_references: policies.filter((p) => p.domain === '법령근거').length,
    drafts: drafts.length,
    pending_drafts: drafts.filter((d) => d.status === 'pending_review').length,
    snapshots: snapshots.length,
    api_cache_entries: apiCache.length,
    indexed_terms: Object.keys(searchIndex.index || {}).length,
  };
}