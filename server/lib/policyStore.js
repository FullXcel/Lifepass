import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildSearchIndex } from './searchIndex.js';

const FILES = {
  policies: 'policies.json',
  drafts: 'review_drafts.json',
  snapshots: 'source_snapshots.json',
  index: 'search_index.json',
  rawDir: 'raw',
};

async function ensureStore(storeDir) {
  await fs.mkdir(storeDir, { recursive: true });
  await fs.mkdir(path.join(storeDir, FILES.rawDir), { recursive: true });
  for (const key of ['policies', 'drafts', 'snapshots', 'index']) {
    const file = path.join(storeDir, FILES[key]);
    try { await fs.access(file); } catch { await fs.writeFile(file, key === 'index' ? JSON.stringify({ generated_at: null, index: {} }, null, 2) : '[]'); }
  }
}

async function readJson(storeDir, key) {
  await ensureStore(storeDir);
  const text = await fs.readFile(path.join(storeDir, FILES[key]), 'utf-8');
  return JSON.parse(text || (key === 'index' ? '{}' : '[]'));
}

async function writeJson(storeDir, key, value) {
  await ensureStore(storeDir);
  await fs.writeFile(path.join(storeDir, FILES[key]), JSON.stringify(value, null, 2));
}

export function sha256(value = '') {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export async function loadPolicies(storeDir) { return readJson(storeDir, 'policies'); }
export async function loadDrafts(storeDir) { return readJson(storeDir, 'drafts'); }
export async function loadSnapshots(storeDir) { return readJson(storeDir, 'snapshots'); }
export async function loadSearchIndex(storeDir) { return readJson(storeDir, 'index'); }

export async function saveRawDocument(storeDir, sourceId, externalId, content, metadata = {}) {
  await ensureStore(storeDir);
  const safeSource = String(sourceId).replace(/[^a-z0-9_-]/gi, '_');
  const safeId = String(externalId || sha256(content).slice(0, 12)).replace(/[^a-z0-9_-]/gi, '_');
  const filename = `${safeSource}__${safeId}.txt`;
  const filePath = path.join(storeDir, FILES.rawDir, filename);
  await fs.writeFile(filePath, String(content || ''));
  await fs.writeFile(`${filePath}.meta.json`, JSON.stringify(metadata, null, 2));
  return { filePath, filename };
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
  const [policies, drafts, snapshots, searchIndex] = await Promise.all([
    loadPolicies(storeDir), loadDrafts(storeDir), loadSnapshots(storeDir), loadSearchIndex(storeDir),
  ]);
  return {
    policies: policies.length,
    drafts: drafts.length,
    pending_drafts: drafts.filter((d) => d.status === 'pending_review').length,
    snapshots: snapshots.length,
    indexed_terms: Object.keys(searchIndex.index || {}).length,
  };
}
