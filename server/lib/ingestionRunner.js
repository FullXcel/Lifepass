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

function appendPathIfNeeded(baseUrl = '', appendPath = '') {
  if (!baseUrl || !appendPath) return baseUrl;
  try {
    const url = new URL(baseUrl);
    const normalizedPath = appendPath.replace(/^\/+/, '');
    if (!url.pathname.toLowerCase().endsWith(`/${normalizedPath.toLowerCase()}`)) {
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/${normalizedPath}`;
    }
    return url.toString();
  } catch {
    return baseUrl;
  }
}

function endpointUrl(source, env, endpointEnv, detailConfig = null) {
  const configured = endpointEnv ? env[endpointEnv] : '';
  const base = env[source.apiBaseEnv] || '';
  if (detailConfig?.useBaseEndpoint) return appendPathIfNeeded(base || configured, detailConfig.path || '');

  const isAuxiliaryEndpoint = Boolean(detailConfig) && endpointEnv && endpointEnv !== source.apiBaseEnv;
  if (isAuxiliaryEndpoint && !configured && !detailConfig?.path) return '';

  const appendPath = detailConfig?.path || (!detailConfig ? (source.listPath || '') : '');
  return appendPathIfNeeded(configured || base, appendPath);
}

function normalizeComparableId(value = '') {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

function recordsContainApiError(records = []) {
  return records.find((record) => {
    const code = String(record?.resultCode || record?.resultCd || record?.header?.resultCode || '').trim();
    const message = String(record?.resultMessage || record?.resultMsg || record?.header?.resultMsg || record?.errorMsg || '').trim();
    if (!code && !message) return false;
    return !['00', '0000', '0', 'success', 'ok'].includes(code.toLowerCase()) || /error|invalid|fail|exception|오류|실패|에러/i.test(message);
  }) || null;
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

function selectMatchingDetailRecord(detailRecords = [], detailConfig = {}, requestedId = '', sourceRecord = {}) {
  const requested = normalizeComparableId(requestedId);
  if (!requested) return { record: detailRecords[0] || {}, matched: Boolean(detailRecords[0]), reason: 'requested-id-empty' };

  const idKeys = Array.from(new Set([
    ...(detailConfig.idKeys || []),
    '서비스ID', 'serviceId', 'svcId', 'servId', 'wlfareInfoId', '복지서비스ID', '법령일련번호', 'MST', 'id',
  ]));

  const exact = detailRecords.find((candidate) => {
    const ids = recordIdValues(candidate, idKeys).map(normalizeComparableId);
    return ids.includes(requested);
  });
  if (exact) return { record: exact, matched: true, reason: 'exact-id-match' };

  const sourceName = String(pick(sourceRecord, ['서비스명', 'servNm', 'serviceName', 'name', 'title']) || '').trim();
  if (sourceName) {
    const byTitle = detailRecords.find((candidate) => {
      const title = String(pick(candidate, ['서비스명', 'servNm', 'serviceName', 'name', 'title']) || '').trim();
      return title && title === sourceName;
    });
    if (byTitle) return { record: byTitle, matched: true, reason: 'title-match-without-id' };
  }

  if (detailRecords.length === 1) {
    const only = detailRecords[0];
    const ids = recordIdValues(only, idKeys).map(normalizeComparableId);
    if (!ids.length) return { record: only, matched: true, reason: 'single-record-no-id' };
  }

  return {
    record: {},
    matched: false,
    reason: `상세조회 응답에서 요청 ID(${requestedId})와 일치하는 항목을 찾지 못했습니다. 첫 번째 응답을 붙이지 않고 상세정보 결합을 보류합니다.`,
  };
}

async function enrichWithEndpoint(records, source, env, config, endpointEnv, detailConfig, targetKey) {
  const detailUrl = endpointUrl(source, env, endpointEnv, detailConfig);
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
        defaultParams: detailConfig.inheritDefaultParams === false ? (detailConfig.defaultParams || {}) : { ...(source.defaultParams || {}), ...(detailConfig.defaultParams || {}) },
        params: { [detailConfig.param || 'id']: id },
      });
      const { records: detailRecords } = await fetchApiRecords(url, config, { forceRefresh: config.forceRefresh });
      const apiError = recordsContainApiError(detailRecords);
      if (apiError) {
        target[`${targetKey}_warning`] = `${apiError.resultCode || ''} ${apiError.resultMessage || apiError.resultMsg || '상세조회 API 오류'}`.trim();
        target[`${targetKey}_url`] = redactUrlCredentials(url);
        continue;
      }
      const { record: detailRecord, matched, reason } = selectMatchingDetailRecord(detailRecords, detailConfig, id, record);
      if (matched) {
        target[targetKey] = detailRecord;
        target[`${targetKey}_match_reason`] = reason;
        target[`${targetKey}_url`] = redactUrlCredentials(url);
      } else {
        target[`${targetKey}_warning`] = reason;
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
  const baseUrl = endpointUrl(source, env, source.apiBaseEnv, { path: source.listPath });
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
      const apiError = recordsContainApiError(result.records);
      if (apiError) {
        records.push({
          title: `${source.label} 수집 오류`,
          description: `${apiError.resultCode || ''} ${apiError.resultMessage || apiError.resultMsg || 'API 오류 응답'}`.trim(),
          url: redactUrlCredentials(result.url || url),
          _lifepass_error: true,
        });
        break;
      }
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