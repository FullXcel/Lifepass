import fs from 'node:fs/promises';
import path from 'node:path';
import { enabledSources } from '../config/policySources.js';
import { getServerConfig } from '../config/env.js';
import { fetchWithTimeout, flattenRecords, withServiceKey } from './httpClient.js';
import { extractTextFromBuffer, extractTextFromHtml } from './textExtractors.js';
import { normalizePolicyRecord } from './policyNormalizer.js';
import { recordSnapshot, saveRawDocument, sha256, upsertDraft, rebuildSearchIndex, storeSummary } from './policyStore.js';

function envList(name, env = process.env) {
  return String(env[name] || '').split(',').map((x) => x.trim()).filter(Boolean);
}

async function collectOfficialApi(source, config, env = process.env) {
  const baseUrl = env[source.apiBaseEnv];
  if (!baseUrl) {
    return { source, records: [], skipped: true, reason: `${source.apiBaseEnv} 환경변수가 없어 수집을 건너뜁니다.` };
  }
  const url = withServiceKey(baseUrl, env[source.apiKeyEnv]);
  const { body, contentType } = await fetchWithTimeout(url, { timeoutMs: config.requestTimeoutMs });
  let records = [];
  if (typeof body === 'string' && contentType.includes('xml')) {
    records = [{ title: source.label, description: body, url }];
  } else if (typeof body === 'string') {
    try { records = flattenRecords(JSON.parse(body)); } catch { records = [{ title: source.label, description: body, url }]; }
  } else {
    records = flattenRecords(body);
  }
  return { source: { ...source, lastFetchedUrl: url }, records, skipped: false };
}

async function collectAllowlistCrawler(source, config, env = process.env) {
  const urls = envList(source.urlListEnv, env);
  if (!urls.length) {
    return { source, records: [], skipped: true, reason: `${source.urlListEnv} 환경변수가 없어 보조 크롤링을 건너뜁니다.` };
  }
  const records = [];
  for (const url of urls) {
    const { body, contentType } = await fetchWithTimeout(url, { timeoutMs: config.requestTimeoutMs });
    let text;
    let parser;
    if (typeof body === 'string' && contentType.includes('html')) {
      const extracted = extractTextFromHtml(body);
      text = extracted.text;
      parser = extracted.parser;
    } else if (typeof body === 'string') {
      text = body;
      parser = 'server-text-response';
    } else {
      const extracted = await extractTextFromBuffer(Buffer.from(JSON.stringify(body)), 'response.json', 'application/json');
      text = extracted.text;
      parser = extracted.parser;
    }
    records.push({ title: text.split(/\r?\n/).find(Boolean) || url, description: text, url, parser });
  }
  return { source, records, skipped: false };
}

async function collectSource(source, config, env = process.env) {
  if (source.strategy === 'official_api') return collectOfficialApi(source, config, env);
  if (source.strategy === 'crawl_allowlist') return collectAllowlistCrawler(source, config, env);
  return { source, records: [], skipped: true, reason: `지원하지 않는 수집 전략: ${source.strategy}` };
}

export async function ingestPolicySources(options = {}) {
  const config = { ...getServerConfig(), ...(options.config || {}) };
  const env = options.env || process.env;
  const sources = options.sources || enabledSources(env);
  const startedAt = new Date().toISOString();
  const logs = [];
  const drafts = [];
  const changed = [];
  const skipped = [];
  for (const source of sources.sort((a, b) => b.priority - a.priority)) {
    try {
      const collection = await collectSource(source, config, env);
      if (collection.skipped) {
        skipped.push({ source_id: source.id, reason: collection.reason });
        logs.push(`[skip] ${source.label}: ${collection.reason}`);
        continue;
      }
      logs.push(`[collect] ${source.label}: ${collection.records.length}건`);
      for (const record of collection.records) {
        const normalized = normalizePolicyRecord(record, collection.source);
        const externalId = normalized.source.external_id;
        const contentHash = normalized.ingestion.content_hash || sha256(normalized.rawText);
        const snapshotResult = await recordSnapshot(config.storeDir, {
          source_id: source.id,
          source_label: source.label,
          external_id: externalId,
          content_hash: contentHash,
          original_url: normalized.source.original_url,
          source_modified_at: normalized.ingestion.source_modified_at,
        });
        await saveRawDocument(config.storeDir, source.id, externalId, normalized.rawText, normalized.source);
        if (snapshotResult.changed || options.forceReview) {
          const draft = await upsertDraft(config.storeDir, {
            ...normalized,
            status: 'pending_review',
            change_type: snapshotResult.previous ? 'updated' : 'new',
          });
          drafts.push(draft);
          changed.push({ source_id: source.id, external_id: externalId, change_type: draft.change_type });
        }
      }
    } catch (error) {
      logs.push(`[error] ${source.label}: ${error.message}`);
    }
  }
  await rebuildSearchIndex(config.storeDir);
  const summary = await storeSummary(config.storeDir);
  return { started_at: startedAt, finished_at: new Date().toISOString(), logs, drafts_created: drafts.length, changed, skipped, summary };
}

export async function ingestLocalPolicyFile(filePath, sourceLabel = '로컬 정책 문서') {
  const config = getServerConfig();
  const raw = await fs.readFile(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const extracted = await extractTextFromBuffer(raw, filePath, ext === 'html' ? 'text/html' : 'text/plain');
  const source = { id: 'local-upload', label: sourceLabel, strategy: 'manual_upload', priority: 60 };
  const normalized = normalizePolicyRecord({ title: path.basename(filePath), description: extracted.text }, source, { parser: extracted.parser });
  await recordSnapshot(config.storeDir, {
    source_id: source.id,
    source_label: source.label,
    external_id: normalized.source.external_id,
    content_hash: normalized.ingestion.content_hash,
    original_url: filePath,
  });
  await saveRawDocument(config.storeDir, source.id, normalized.source.external_id, normalized.rawText, normalized.source);
  const draft = await upsertDraft(config.storeDir, normalized);
  await rebuildSearchIndex(config.storeDir);
  return draft;
}
