import http from 'node:http';
import { URL } from 'node:url';
import { getServerConfig, assertAdmin, adminAuthStatus } from './config/env.js';
import { OFFICIAL_POLICY_SOURCES, enabledSources } from './config/policySources.js';
import { ingestPolicySources } from './lib/ingestionRunner.js';
import { approveDraft, loadCollectedPolicies, loadDrafts, loadPolicies, loadSearchIndex, rejectDraft, storeSummary } from './lib/policyStore.js';
import { searchPolicies } from './lib/searchIndex.js';
import { redactUrlCredentials } from './lib/httpClient.js';

const config = getServerConfig();
const allowedOrigins = String(config.corsOrigin || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function corsOriginFor(req) {
  const origin = req.headers.origin || '';
  if (allowedOrigins.includes('*')) return '*';
  if (origin && allowedOrigins.includes(origin)) return origin;
  // Non-browser requests do not send Origin. Use the first configured origin for deterministic headers.
  return allowedOrigins[0] || 'http://localhost:5173';
}

function send(res, status, data, headers = {}, req = null) {
  const corsOrigin = req ? corsOriginFor(req) : (allowedOrigins[0] || 'http://localhost:5173');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': corsOrigin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-admin-token,authorization',
    'vary': 'Origin',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    ...headers,
  });
  if (status === 204) return res.end();
  return res.end(JSON.stringify(data, null, 2));
}

async function parseBody(req, maxBytes = config.maxBodyBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const err = new Error(`요청 본문이 너무 큽니다. 최대 ${maxBytes} bytes까지 허용됩니다.`);
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf-8');
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function requireAdmin(req, res) {
  if (assertAdmin(req, config)) return true;
  send(res, 401, {
    error: config.adminToken
      ? '관리자 토큰이 올바르지 않습니다.'
      : '서버에 LIFEPASS_ADMIN_TOKEN이 설정되어 있지 않아 관리자 API를 차단했습니다.',
    ...adminAuthStatus(config),
  }, {}, req);
  return false;
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {}, {}, req);
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, {
        ok: true,
        service: 'lifepass-policy-api',
        auth: adminAuthStatus(config),
        summary: await storeSummary(config.storeDir),
      }, {}, req);
    }
    if (req.method === 'GET' && url.pathname === '/api/sources') {
      return send(res, 200, { sources: OFFICIAL_POLICY_SOURCES, enabled: enabledSources().map((s) => s.id) }, {}, req);
    }
    if (req.method === 'GET' && url.pathname === '/api/policies') {
      const includeDrafts = url.searchParams.get('includeDrafts') === 'true';
      if (includeDrafts && !requireAdmin(req, res)) return;
      const approved = await loadPolicies(config.storeDir);
      const collected = await loadCollectedPolicies(config.storeDir, { includePendingDrafts: includeDrafts });
      return send(res, 200, {
        policies: approved,
        collected_policies: includeDrafts ? collected : approved,
        using_pending_drafts: includeDrafts && collected.length > approved.length,
      }, {}, req);
    }
    if (req.method === 'GET' && url.pathname === '/api/policies/search') {
      const q = url.searchParams.get('q') || '';
      const policies = await loadPolicies(config.storeDir);
      const index = await loadSearchIndex(config.storeDir);
      return send(res, 200, { query: q, policies: searchPolicies(q, policies, index) }, {}, req);
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/review') {
      if (!requireAdmin(req, res)) return;
      const drafts = await loadDrafts(config.storeDir);
      return send(res, 200, { drafts: drafts.filter((d) => d.status === 'pending_review') }, {}, req);
    }
    if (req.method === 'POST' && url.pathname === '/api/ingest/run') {
      if (!requireAdmin(req, res)) return;
      const body = await parseBody(req);
      const result = await ingestPolicySources({ forceReview: Boolean(body.forceReview), forceRefresh: Boolean(body.forceRefresh) });
      return send(res, 200, result, {}, req);
    }
    const approveMatch = url.pathname.match(/^\/api\/admin\/review\/([^/]+)\/approve$/);
    if (req.method === 'POST' && approveMatch) {
      if (!requireAdmin(req, res)) return;
      const body = await parseBody(req);
      const policy = await approveDraft(config.storeDir, decodeURIComponent(approveMatch[1]), body.reviewer || 'admin');
      return send(res, 200, { policy }, {}, req);
    }
    const rejectMatch = url.pathname.match(/^\/api\/admin\/review\/([^/]+)\/reject$/);
    if (req.method === 'POST' && rejectMatch) {
      if (!requireAdmin(req, res)) return;
      const body = await parseBody(req);
      const draft = await rejectDraft(config.storeDir, decodeURIComponent(rejectMatch[1]), body.reviewer || 'admin', body.reason || '관리자 반려');
      return send(res, 200, { draft }, {}, req);
    }
    return send(res, 404, { error: 'not found', path: url.pathname }, {}, req);
  } catch (error) {
    const status = error.status || 500;
    return send(res, status, {
      error: redactUrlCredentials(error.message || String(error)),
      stack: process.env.NODE_ENV === 'production' ? undefined : redactUrlCredentials(error.stack || ''),
    }, {}, req);
  }
}

const server = http.createServer(handle);
server.listen(config.port, config.host, () => {
  console.log(`LifePass policy API listening on http://${config.host}:${config.port}`);
});
