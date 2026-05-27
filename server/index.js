import http from 'node:http';
import { URL } from 'node:url';
import { getServerConfig, assertAdmin } from './config/env.js';
import { OFFICIAL_POLICY_SOURCES, enabledSources } from './config/policySources.js';
import { ingestPolicySources } from './lib/ingestionRunner.js';
import { approveDraft, loadDrafts, loadPolicies, loadSearchIndex, rejectDraft, storeSummary } from './lib/policyStore.js';
import { searchPolicies } from './lib/searchIndex.js';

const config = getServerConfig();

function send(res, status, data, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': config.corsOrigin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-admin-token,authorization',
    ...headers,
  });
  res.end(JSON.stringify(data, null, 2));
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf-8');
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, service: 'lifepass-policy-api', summary: await storeSummary(config.storeDir) });
    }
    if (req.method === 'GET' && url.pathname === '/api/sources') {
      return send(res, 200, { sources: OFFICIAL_POLICY_SOURCES, enabled: enabledSources().map((s) => s.id) });
    }
    if (req.method === 'GET' && url.pathname === '/api/policies') {
      return send(res, 200, { policies: await loadPolicies(config.storeDir) });
    }
    if (req.method === 'GET' && url.pathname === '/api/policies/search') {
      const q = url.searchParams.get('q') || '';
      const policies = await loadPolicies(config.storeDir);
      const index = await loadSearchIndex(config.storeDir);
      return send(res, 200, { query: q, policies: searchPolicies(q, policies, index) });
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/review') {
      if (!assertAdmin(req, config)) return send(res, 401, { error: '관리자 토큰이 필요합니다.' });
      const drafts = await loadDrafts(config.storeDir);
      return send(res, 200, { drafts: drafts.filter((d) => d.status === 'pending_review') });
    }
    if (req.method === 'POST' && url.pathname === '/api/ingest/run') {
      if (!assertAdmin(req, config)) return send(res, 401, { error: '관리자 토큰이 필요합니다.' });
      const body = await parseBody(req);
      const result = await ingestPolicySources({ forceReview: Boolean(body.forceReview) });
      return send(res, 200, result);
    }
    const approveMatch = url.pathname.match(/^\/api\/admin\/review\/([^/]+)\/approve$/);
    if (req.method === 'POST' && approveMatch) {
      if (!assertAdmin(req, config)) return send(res, 401, { error: '관리자 토큰이 필요합니다.' });
      const body = await parseBody(req);
      const policy = await approveDraft(config.storeDir, decodeURIComponent(approveMatch[1]), body.reviewer || 'admin');
      return send(res, 200, { policy });
    }
    const rejectMatch = url.pathname.match(/^\/api\/admin\/review\/([^/]+)\/reject$/);
    if (req.method === 'POST' && rejectMatch) {
      if (!assertAdmin(req, config)) return send(res, 401, { error: '관리자 토큰이 필요합니다.' });
      const body = await parseBody(req);
      const draft = await rejectDraft(config.storeDir, decodeURIComponent(rejectMatch[1]), body.reviewer || 'admin', body.reason || '관리자 반려');
      return send(res, 200, { draft });
    }
    return send(res, 404, { error: 'not found', path: url.pathname });
  } catch (error) {
    return send(res, 500, { error: error.message, stack: process.env.NODE_ENV === 'production' ? undefined : error.stack });
  }
}

const server = http.createServer(handle);
server.listen(config.port, config.host, () => {
  console.log(`LifePass policy API listening on http://${config.host}:${config.port}`);
});
