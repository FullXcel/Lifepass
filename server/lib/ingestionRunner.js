import fs from 'node:fs/promises';
import path from 'node:path';
import { enabledSources } from '../config/policySources.js';
import { getServerConfig } from '../config/env.js';
import { fetchWithTimeout, flattenRecords, looksLikeDataPortalDocPage, redactUrlCredentials, withApiParams } from './httpClient.js';
import { extractTextFromBuffer } from './textExtractors.js';
import { normalizePolicyRecord } from './policyNormalizer.js';
import { getCachedApiResponse, recordSnapshot, saveApiResponse, saveRawDocument, sha256, upsertDraft, rebuildSearchIndex, storeSummary } from './policyStore.js';

function envList(name, env = process.env) {
  return String(env[name] || '').split(',').map((x) => x.trim()).filter(Boolean);
}

function getByPath(obj, pathExpr = '') {
  if (!obj || !pathExpr) return undefined;
  return String(pathExpr).split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

function apiKeyForSource(source, env = process.env) {
  const keys = [source.apiKeyEnv, source.fallbackApiKeyEnv, ...(source.apiKeyEnvAliases || [])].filter(Boolean);
  for (const key of keys) {
    if (env[key]) return env[key];
  }
  return '';
}

function pick(record, keys = []) {
  for (const key of keys) {
    const value = key.includes('.') ? getByPath(record, key) : record?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function inferMimeFromUrl(url = '', contentType = '') {
  if (contentType) return contentType;
  const pathname = (() => { try { return new URL(url).pathname; } catch { return url; } })();
  const ext = path.extname(pathname).slice(1).toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (['html', 'htm'].includes(ext)) return 'text/html';
  if (['hwpx', 'owpml'].includes(ext)) return 'application/owpml';
  if (ext === 'hwp') return 'application/x-hwp';
  return 'text/plain';
}

function recordsFromBody(body, contentType = '', url = '') {
  if (Buffer.isBuffer(body)) return [{ title: url, description: body.toString('utf-8'), url }];
  if (typeof body === 'string') return flattenRecords(body).map((record) => ({ ...record, _lifepass_source_url: url }));
  return flattenRecords(body).map((record) => ({ ...record, _lifepass_source_url: url }));
}

function sourceQueries(source, env = process.env) {
  const configured = source.queryEnv ? envList(source.queryEnv, env) : [];
  return configured.length ? configured : (source.defaultQueries || []);
}

function pageUrls(source, baseUrl, env, config) {
  const maxPages = Math.max(1, Number(env[source.maxPagesEnv] || config.maxPagesPerSource || 1));
  const urls = [];
  const pagination = source.pagination;
  const queries = sourceQueries(source, env);
  const queryValues = queries.length ? queries : [null];
  for (const query of queryValues) {
    if (!pagination) {
      urls.push(withApiParams(baseUrl, {
        key: apiKeyForSource(source, env),
        authParam: source.authParam || 'serviceKey',
        defaultParams: source.defaultParams || {},
        params: query ? { [source.queryParam || 'query']: query } : {},
      }));
      continue;
    }
    for (let page = 1; page <= maxPages; page += 1) {
      const params = {
        [pagination.pageParam]: page,
        [pagination.sizeParam]: pagination.size,
        ...(query ? { [source.queryParam || 'query']: query } : {}),
      };
      urls.push(withApiParams(baseUrl, {
        key: apiKeyForSource(source, env),
        authParam: source.authParam || 'serviceKey',
        defaultParams: source.defaultParams || {},
        params,
      }));
    }
  }
  return urls.filter(Boolean);
}

async function fetchApiRecords(url, config, options = {}) {
  const cacheKey = sha256(url);
  if (!options.forceRefresh) {
    const cached = await getCachedApiResponse(config.storeDir, cacheKey, config.policyRefreshTtlHours);
    if (cached) {
      return {
        records: recordsFromBody(cached.body, cached.contentType, cached.url || url),
        contentType: cached.contentType,
        url: cached.url || url,
        redactedUrl: redactUrlCredentials(cached.url || url),
        cached: true,
      };
    }
  }
  const { body, contentType, status, redactedUrl } = await fetchWithTimeout(url, { timeoutMs: config.requestTimeoutMs });
  await saveApiResponse(config.storeDir, cacheKey, { body, contentType, status, url: redactedUrl || redactUrlCredentials(url), redactedUrl });
  return { records: recordsFromBody(body, contentType, url), contentType, url, redactedUrl: redactedUrl || redactUrlCredentials(url), cached: false };
}

function detailIds(records, source) {
  const idKeys = source.detail?.idKeys || source.support?.idKeys || ['id', 'serviceId', 'servId', 'wlfareInfoId', 'plcyNo'];
  return records
    .map((record) => ({ record, id: pick(record, idKeys) }))
    .filter((x) => x.id)
    .map((x) => ({ ...x, id: String(x.id).trim() }));
}


function recordIdValues(record = {}, keys = []) {
  return keys.map((key) => String(pick(record, [key]) || '').trim()).filter(Boolean);
}

function detailMatchesRequestedId(detailRecord = {}, detailConfig = {}, requestedId = '') {
  const requested = String(requestedId || '').trim();
  if (!requested) return true;
  const candidates = recordIdValues(detailRecord, detailConfig.idKeys || []);
  if (!candidates.length) return true;
  return candidates.includes(requested);
}

async function enrichWithEndpoint(records, source, env, config, endpointEnv, detailConfig, targetKey) {
  const detailUrl = endpointEnv ? env[endpointEnv] : '';
  if (!detailUrl || !detailConfig) return records;
  const maxDetails = Math.min(
    Math.max(0, Number(env[source.maxDetailsEnv] || config.maxDetailsPerSource || detailConfig.maxDetails || 0)),
    detailConfig.maxDetails || 25,
  );
  if (!maxDetails) return records;
  const pairs = detailIds(records, { detail: detailConfig }).slice(0, maxDetails);
  const byObject = new WeakMap(records.map((record) => [record, { ...record }]));
  for (const { record, id } of pairs) {
    const target = byObject.get(record) || record;
    try {
      const url = withApiParams(detailUrl, {
        key: apiKeyForSource(source, env),
        authParam: source.authParam || 'serviceKey',
        defaultParams: source.defaultParams || {},
        params: { [detailConfig.param || 'id']: id },
      });
      const { records: detailRecords } = await fetchApiRecords(url, config, { forceRefresh: config.forceRefresh });
      const detailRecord = detailRecords[0] || {};
      if (detailMatchesRequestedId(detailRecord, detailConfig, id)) {
        target[targetKey] = detailRecord;
        target[`${targetKey}_url`] = redactUrlCredentials(url);
      } else {
        target[`${targetKey}_warning`] = `상세조회 응답 ID 불일치: requested=${id}`;
        target[`${targetKey}_url`] = redactUrlCredentials(url);
      }
    } catch (error) {
      target[`${targetKey}_error`] = redactUrlCredentials(error.message);
    }
    byObject.set(record, target);
  }
  return records.map((record) => byObject.get(record) || record);
}

async function enrichRecords(records, source, env, config) {
  let enriched = records;
  enriched = await enrichWithEndpoint(enriched, source, env, config, source.detailUrlEnv, source.detail, '_lifepass_detail');
  enriched = await enrichWithEndpoint(enriched, source, env, config, source.supportConditionsUrlEnv, source.support, '_lifepass_support_conditions');
  return enriched;
}

async function collectOfficialApi(source, config, env = process.env) {
  const baseUrl = env[source.apiBaseEnv];
  if (!baseUrl) {
    return { source, records: [], skipped: true, reason: `${source.apiBaseEnv} 환경변수가 없어 수집을 건너뜁니다.` };
  }
  if (looksLikeDataPortalDocPage(baseUrl)) {
    return { source, records: [], skipped: true, reason: `${source.apiBaseEnv} 값이 data.go.kr 소개 페이지입니다. 실제 API 호출 엔드포인트로 교체해야 합니다.` };
  }
  if (source.apiKeyEnv && !apiKeyForSource(source, env)) {
    return { source, records: [], skipped: true, reason: `${source.apiKeyEnv} 인증키가 없어 수집을 건너뜁니다.` };
  }

  const urls = pageUrls(source, baseUrl, env, config);
  const records = [];
  const fetchedUrls = [];
  for (const url of urls) {
    try {
      const result = await fetchApiRecords(url, config, { forceRefresh: config.forceRefresh });
      fetchedUrls.push(redactUrlCredentials(result.redactedUrl || result.url));
      records.push(...result.records);
      if (!result.records.length) break;
    } catch (error) {
      records.push({ title: `${source.label} 수집 오류`, description: redactUrlCredentials(error.message), url: redactUrlCredentials(url), _lifepass_error: true });
      break;
    }
  }
  const enriched = await enrichRecords(records, source, env, config);
  return { source: { ...source, lastFetchedUrl: fetchedUrls[0] || redactUrlCredentials(urls[0]), fetchedUrls }, records: enriched, skipped: false };
}

async function collectAllowlistCrawler(source, config, env = process.env) {
  const urls = envList(source.urlListEnv, env);
  if (!urls.length) {
    return { source, records: [], skipped: true, reason: `${source.urlListEnv} 환경변수가 없어 보조 크롤링을 건너뜁니다.` };
  }
  const records = [];
  for (const url of urls) {
    try {
      const { body, contentType } = await fetchWithTimeout(url, { timeoutMs: config.requestTimeoutMs, asBuffer: true });
      const pathname = (() => { try { return new URL(url).pathname; } catch { return url; } })();
      const extracted = await extractTextFromBuffer(body, path.basename(pathname) || 'notice.html', inferMimeFromUrl(url, contentType));
      const text = extracted.text || '';
      records.push({ title: text.split(/\r?\n/).find(Boolean) || url, description: text, url, parser: extracted.parser });
    } catch (error) {
      records.push({ title: `${source.label} 수집 오류`, description: redactUrlCredentials(error.message), url: redactUrlCredentials(url), _lifepass_error: true });
    }
  }
  return { source, records, skipped: false };
}

async function collectSource(source, config, env = process.env) {
  if (source.strategy === 'official_api') return collectOfficialApi(source, config, env);
  if (source.strategy === 'crawl_allowlist') return collectAllowlistCrawler(source, config, env);
  return { source, records: [], skipped: true, reason: `지원하지 않는 수집 전략: ${source.strategy}` };
}

export async function ingestPolicySources(options = {}) {
  const config = { ...getServerConfig(), ...(options.config || {}), forceRefresh: Boolean(options.forceRefresh) };
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
  const extracted = await extractTextFromBuffer(raw, filePath);
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