import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildSearchIndex } from './searchIndex.js';

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

export async function loadPolicies(storeDir) { return readJson(storeDir, 'policies'); }
export async function loadDrafts(storeDir) { return readJson(storeDir, 'drafts'); }
export async function loadSnapshots(storeDir) { return readJson(storeDir, 'snapshots'); }
export async function loadSearchIndex(storeDir) { return readJson(storeDir, 'index'); }
export async function loadApiCache(storeDir) { return readJson(storeDir, 'apiCache'); }

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
      [String(sourceId), String(externalId || safeId), String(content || ''), JSON.stringify(metadata || {})],
    );
    return { filePath: `postgres://lifepass_raw_documents/${safeSource}/${safeId}`, filename };
  }
  const filePath = path.join(storeDir, FILES.rawDir, filename);
  await fs.writeFile(filePath, String(content || ''));
  await fs.writeFile(`${filePath}.meta.json`, JSON.stringify(metadata, null, 2));
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
    url: response.url || '',
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
