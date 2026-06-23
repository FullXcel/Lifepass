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
  const lawUrl = publicLawUrlFromRecord(record);
  if (lawUrl) return lawUrl;
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

function cleanGenericLawTitle(value = '') {
  const text = String(value || '').trim();
  if (!text || /^LawSearch:/i.test(text) || /^target:/i.test(text)) return '';
  return text;
}

function extractXmlTag(block = '', tag = '') {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(block || '').match(new RegExp(`<${escaped}>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return (match?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
}

function lawNameFromRecord(record = {}, fallback = '') {
  return cleanGenericLawTitle(
    record?.법령명한글 || record?.법령명 || record?.lawNm || record?.lsNm || extractXmlTag(stringifyRecordValue(record), '법령명한글') || fallback,
  );
}

function publicLawUrlFromRecord(record = {}, fallback = '') {
  const name = lawNameFromRecord(record, fallback);
  return name ? `https://www.law.go.kr/법령/${encodeURIComponent(name)}` : '';
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

const LEGAL_ACT_ROLE_RULES = [
  {
    pattern: /주거급여/,
    domains: ['주거', '생활지원'],
    target: '주거급여·임차료·수선유지급여 등 주거비 지원 정책',
    role: '주거급여 신청 대상, 임차료·수선유지급여 같은 지원 종류, 소득인정액과 주거 형태에 따른 지급 기준의 근거입니다.',
    userValue: '월세·전세·자가 여부나 소득 기준 때문에 주거급여 대상이 되는지 확인할 때 원문 기준을 대조할 수 있습니다.',
  },
  {
    pattern: /국민기초생활|기초생활보장/,
    domains: ['생활지원', '주거', '의료', '교육'],
    target: '생계급여·의료급여·주거급여·교육급여 등 기초생활 보장 정책',
    role: '수급권자 범위, 급여 종류, 소득인정액·부양의무자 등 기초생활보장 급여 판단 기준의 근거입니다.',
    userValue: '내 소득·재산·가구 상황 때문에 기초생활 관련 급여 대상 또는 제외 대상이 되는 이유를 확인할 수 있습니다.',
  },
  {
    pattern: /긴급복지/,
    domains: ['생활지원', '의료', '주거'],
    target: '갑작스러운 위기 상황의 생계·의료·주거 긴급지원 정책',
    role: '실직, 질병, 주거 상실 등 위기사유 인정 범위와 긴급지원의 종류·절차를 정하는 근거입니다.',
    userValue: '위기 사유를 왜 예/아니오로 먼저 확인하는지, 어떤 상황이 긴급지원 사유가 되는지 원문으로 확인할 수 있습니다.',
  },
  {
    pattern: /고용보험/,
    domains: ['고용'],
    target: '실업급여·고용안정·직업능력개발 등 고용보험 기반 정책',
    role: '고용보험 가입, 실업급여 수급, 직업훈련·고용안정 지원의 대상과 급여 조건을 정하는 근거입니다.',
    userValue: '퇴사·실업급여 잔여일·고용보험 가입 여부가 추천 결과에 어떤 영향을 주는지 확인할 수 있습니다.',
  },
  {
    pattern: /국민취업지원|구직자 취업촉진/,
    domains: ['고용', '청년'],
    target: '국민취업지원제도·구직촉진수당·취업지원서비스 정책',
    role: '구직자 유형, 소득·재산 요건, 취업지원서비스와 구직촉진수당 지급 범위를 정하는 근거입니다.',
    userValue: '취업 상태·소득·재산 기준 때문에 국민취업지원제도 대상인지 확인할 때 쓸 수 있습니다.',
  },
  {
    pattern: /청년|위기아동|자립준비|청소년/,
    domains: ['청년', '생활지원'],
    target: '청년·청소년·자립준비청년 생활·주거·취업 지원 정책',
    role: '청년 또는 위기아동·청소년의 지원 대상 범위와 국가·지자체의 지원 책임을 설명하는 근거입니다.',
    userValue: '나이·가구상황·자립 여부가 청년 지원 정책 추천에 왜 반영되는지 확인할 수 있습니다.',
  },
  {
    pattern: /노인복지/,
    domains: ['생활지원', '의료'],
    target: '노인 돌봄·건강·생활안정 지원 정책',
    role: '노인 복지서비스, 건강·돌봄·생활안정 지원의 대상과 국가·지자체 책무를 설명하는 근거입니다.',
    userValue: '나이 기준이나 노인가구 여부에 따라 지원 대상이 달라지는 이유를 확인할 수 있습니다.',
  },
  {
    pattern: /장애인/,
    domains: ['생활지원', '의료', '교육', '고용'],
    target: '장애인 생활·의료·교육·고용 지원 정책',
    role: '장애인 등록, 복지서비스, 교육·고용·의료 지원의 대상과 서비스 범위를 설명하는 근거입니다.',
    userValue: '장애 여부 또는 장애인 가구 조건이 정책 추천에 쓰이는 이유와 확인해야 할 증빙을 파악할 수 있습니다.',
  },
  {
    pattern: /교육|유아교육|영유아보육|초ㆍ중등교육|고등교육|학자금/,
    domains: ['교육', '청년'],
    target: '교육비·보육료·장학금·학자금 지원 정책',
    role: '교육·보육 지원의 대상, 비용 지원 범위, 학교·보육기관 관련 행정 기준을 정하는 근거입니다.',
    userValue: '학생 여부, 자녀 여부, 학자금·교육비 조건이 추천 결과에 왜 연결되는지 확인할 수 있습니다.',
  },
  {
    pattern: /사회복지사업|사회보장|사회복지/,
    domains: ['생활지원'],
    target: '사회복지서비스 제공, 복지시설, 지자체 복지사업 전반',
    role: '사회복지서비스 제공 체계, 복지시설 운영, 국가·지자체의 복지사업 집행 권한을 설명하는 포괄 근거입니다.',
    userValue: '개별 지원금의 직접 지급 기준보다는, 복지서비스가 어떤 행정 체계에서 운영되는지 확인할 때 필요합니다.',
  },
];

function inferLegalReferenceDisplayInfo(policy = {}) {
  const lawName = lawNameFromRecord(policy, policy.name) || cleanGenericLawTitle(policy.name) || '법령';
  const text = [lawName, policy.description, policy.target, policy.source?.label].filter(Boolean).join('\n');
  const specific = LEGAL_ACT_ROLE_RULES.find((rule) => rule.pattern.test(text));
  if (specific) {
    return {
      related_policy_domains: policy.related_policy_domains?.length ? policy.related_policy_domains : specific.domains,
      legal_basis_summary: policy.legal_basis_summary || `${lawName}은 ${specific.target}의 판단 근거입니다. 직접 지급되는 혜택으로 계산하지 않고 자격·지원 기준 설명과 원문 확인용으로 분리합니다.`,
      legal_basis_role: policy.legal_basis_role || specific.role,
      user_value: policy.user_value || specific.userValue,
    };
  }
  const matched = LEGAL_SCOPE_RULES.filter((rule) => rule.pattern.test(text));
  const scope = matched.length ? matched.map((rule) => rule.label).join(', ') : '복지·고용·주거 등 관련 정책';
  return {
    related_policy_domains: policy.related_policy_domains?.length ? policy.related_policy_domains : matched.map((rule) => rule.domain),
    legal_basis_summary: policy.legal_basis_summary || `${lawName}은 ${scope}와 연결되는 상위 근거입니다. 직접 지급되는 혜택으로 계산하지 않고 정책 판정 설명과 원문 확인용으로 분리합니다.`,
    legal_basis_role: policy.legal_basis_role || `${scope}의 대상자 범위, 지원 기준, 급여·서비스 범위, 행정기관 집행 권한을 설명하는 법적 근거입니다.`,
    user_value: policy.user_value || '사용자는 이 근거를 통해 해당 혜택이 왜 존재하는지, 본인이 어떤 자격 기준 때문에 대상 또는 제외 대상이 되는지, 상담·문의·이의제기 때 어떤 원문을 확인해야 하는지 알 수 있습니다.',
  };
}


function policyDisplayText(policy = {}) {
  return [policy.name, policy.description, policy.target, policy.domain, policy.source?.label, policy.recommendation_scope_reason]
    .filter(Boolean)
    .join(' ');
}

function isLikelyPreschoolPolicy(policy = {}) {
  return /(유아|영유아|누리과정|유치원|어린이집|보육|방과후과정|3~5세|3-5세)/.test(policyDisplayText(policy));
}

function isLikelyChildOrCaregiverPolicy(policy = {}) {
  return /(유아|영유아|아동|어린이|보육|유치원|초등|자녀|부양자녀|양육|출산|임신|보호자|가족돌봄|청소년)/.test(policyDisplayText(policy));
}

function sanitizeRuleForDisplay(rule, policy = {}) {
  if (!rule || typeof rule !== 'object') return rule;
  if (Array.isArray(rule.all)) {
    const all = rule.all
      .map((node) => sanitizeRuleForDisplay(node, policy))
      .filter(Boolean);
    return { ...rule, all };
  }
  if (Array.isArray(rule.any)) {
    const any = rule.any
      .map((node) => sanitizeRuleForDisplay(node, policy))
      .filter(Boolean);
    return { ...rule, any };
  }
  if (rule.not) {
    const not = sanitizeRuleForDisplay(rule.not, policy);
    return not ? { ...rule, not } : null;
  }
  if (rule.field === 'age' && rule.op === 'between' && Array.isArray(rule.value)) {
    const min = Number(rule.value[0]);
    const max = Number(rule.value[1]);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      if (min <= 5 && max <= 7 && !isLikelyPreschoolPolicy(policy)) return null;
      if (max < 19 && !isLikelyChildOrCaregiverPolicy(policy)) return null;
    }
  }
  return rule;
}


function inferDisplayDomain(policy = {}) {
  if (policy.domain === '법령근거' || policy.legal_basis) return '법령근거';
  const text = policyDisplayText(policy);
  if (/월세|임대|주거|전세|보증금|공공주택|주택|입주|임차/.test(text)) return '주거';
  if (/유아|영유아|유치원|어린이집|보육|교육|장학|학자금|수업료|학비|방과후|학교/.test(text)) return '교육';
  if (/취업|구직|훈련|고용|일자리|채용|직업|근로|실업급여|국민취업지원/.test(text)) return '고용';
  if (/청년|대학생|졸업|사회초년|자립준비/.test(text)) return '청년';
  if (/의료|건강|병원|치료|요양|의료비/.test(text)) return '의료';
  if (/금융|대출|신용|채무|이자|보증료|융자/.test(text)) return '금융';
  return policy.domain || '생활지원';
}

function isBusinessOrProviderPolicyForDisplay(policy = {}) {
  if (policy.domain === '법령근거' || policy.legal_basis) return false;
  const text = policyDisplayText(policy);
  return /(기업|단체|조합|협회|농가|어업인|어업경영체|원양선사|선박|어선|중소기업|소상공인|창업기업|수출업체|사업체|운영비|인건비|기관\s*종사|어린이집\s*(운영|종사|시설장)|학교\s*(운영|법인)|병원\s*(운영|기관)|설치\s*희망|허가를\s*받은\s*자)/.test(text);
}

function enhancePolicyForDisplay(policy = {}, lookup = null) {
  const next = sanitizeValue(policy || {});
  next.domain = inferDisplayDomain(next);
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
  if (next.rule) {
    const sanitizedRule = sanitizeRuleForDisplay(next.rule, next);
    next.rule = sanitizedRule || { all: [] };
    if (JSON.stringify(sanitizedRule || {}) !== JSON.stringify(policy.rule || {})) {
      next.rule_quality_warning = '정책 본문과 맞지 않는 자동 추출 연령 조건을 제거했습니다. 관리자 검수 전까지 보수적으로 판정합니다.';
    }
  }
  if (isBusinessOrProviderPolicyForDisplay(next)) {
    next.recommended_for_individuals = false;
    next.recommendation_scope_reason = next.recommendation_scope_reason || '기관·사업자·단체 중심 정책으로 감지되어 개인 복지 추천 조합에서는 제외합니다.';
  } else if (next.recommended_for_individuals !== false) {
    next.recommended_for_individuals = true;
  }
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
  const { includePendingDrafts = false } = options;
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
  const [policies, drafts, snapshots, searchIndex, apiCache, collected] = await Promise.all([
    loadPolicies(storeDir),
    loadDrafts(storeDir),
    loadSnapshots(storeDir),
    loadSearchIndex(storeDir),
    loadApiCache(storeDir),
    loadCollectedPolicies(storeDir, { includePendingDrafts: true }),
  ]);
  return {
    storage: usePostgres() ? 'postgresql' : 'json-file',
    policies: policies.length,
    collected_policies: collected.length,
    active_individual_policies: collected.filter((p) => p.domain !== '법령근거' && p.recommended_for_individuals !== false).length,
    excluded_non_individual_policies: collected.filter((p) => p.recommended_for_individuals === false).length,
    legal_references: collected.filter((p) => p.domain === '법령근거').length,
    drafts: drafts.length,
    pending_drafts: drafts.filter((d) => d.status === 'pending_review').length,
    snapshots: snapshots.length,
    api_cache_entries: apiCache.length,
    indexed_terms: Object.keys(searchIndex.index || {}).length,
  };
}