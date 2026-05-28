import { detectDocumentKind, extractPolicySignalsFromText } from '../../src/logic/documentPipeline.js';
import { generateRuleFromPolicySignals, generateWarningRuleFromPolicySignals } from './ruleGenerator.js';
import { sha256 } from './policyStore.js';

const TITLE_KEYS = [
  'title', 'name', 'servNm', 'serviceName', '서비스명', '사업명', 'policyName', 'plcyNm', 'plcyName',
  'svcNm', 'svcName', 'bizNm', 'programName', 'recrutPblancTtl', 'pblancNm', 'wantedTitle', 'jobTitle',
  '_lifepass_detail.servNm', '_lifepass_detail.serviceName', '_lifepass_detail.plcyNm', '_lifepass_detail.svcNm',
];

const SUMMARY_KEYS = [
  'summary', 'description', 'servDgst', '서비스목적', '지원내용', 'servicePurpose', 'supportContent',
  'plcyExplnCn', 'plcyCn', 'policyCn', 'svcDgst', 'svcCn', 'bizPrpsCn', 'recrutPbancCn', 'jobCont',
  '_lifepass_detail.summary', '_lifepass_detail.description', '_lifepass_detail.servDgst', '_lifepass_detail.plcyExplnCn',
  '_lifepass_support_conditions.description', '_lifepass_support_conditions.supportContent',
];

const TARGET_KEYS = [
  'target', 'supportTarget', '대상', '지원대상', 'trgetCn', 'sprtTrgtCn', 'aplyTrgtCn', 'aplyTarget',
  'targetContent', 'whoCanApply', 'eligibility', '_lifepass_detail.sprtTrgtCn', '_lifepass_detail.aplyTrgtCn',
  '_lifepass_support_conditions.sprtTrgtCn', '_lifepass_support_conditions.aplyTrgtCn',
];

const CRITERIA_KEYS = [
  'selectionCriteria', 'criteria', '선정기준', '지원조건', 'slctCritCn', 'sprtCndCn', 'eligibilityCriteria',
  'incomeCriteria', 'ageInfo', 'residenceInfo', '_lifepass_detail.slctCritCn', '_lifepass_detail.sprtCndCn',
  '_lifepass_support_conditions.slctCritCn', '_lifepass_support_conditions.sprtCndCn',
];

const APPLY_KEYS = [
  'application', 'applyMethod', '신청방법', 'aplyMthdCn', 'reqstMthdCn', 'onlineApplyUrl', 'applyUrl',
  'applicationMethod', '_lifepass_detail.aplyMthdCn', '_lifepass_detail.reqstMthdCn',
];

const DOC_KEYS = [
  'requiredDocs', 'documents', '구비서류', '제출서류', 'sbmsnDcmntCn', 'reqDoc', 'requiredDocuments',
  '_lifepass_detail.sbmsnDcmntCn', '_lifepass_detail.reqDoc',
];

const URL_KEYS = [
  'url', 'link', 'detailUrl', 'applyUrl', '신청URL', '바로가기', 'homepageUrl', 'referenceUrl', 'siteUrl',
  '_lifepass_source_url', '_lifepass_detail_url', 'onlineApplyUrl',
];

const ID_KEYS = [
  'id', 'serviceId', 'svcId', 'servId', 'wlfareInfoId', '정책ID', 'plcyNo', 'bizId', 'policyId',
  'recrutPblancId', 'wantedAuthNo', 'wantedNo', 'pblancId',
];

const MODIFIED_KEYS = ['modifiedAt', 'updatedAt', 'lastModified', '수정일', '변경일', 'modDt', 'chgDt', 'lastModYmd', 'pblancDt'];

function getByPath(record, pathExpr = '') {
  return String(pathExpr).split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), record);
}

function stringifyValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(stringifyValue).filter(Boolean).join('\n');
  if (typeof value === 'object') return Object.entries(value)
    .map(([key, child]) => {
      const rendered = stringifyValue(child);
      return rendered ? `${key}: ${rendered}` : '';
    })
    .filter(Boolean)
    .join('\n');
  return String(value).trim();
}

function pick(record, keys = []) {
  for (const key of keys) {
    const value = key.includes('.') ? getByPath(record, key) : record?.[key];
    const rendered = stringifyValue(value);
    if (rendered) return rendered;
  }
  return '';
}

function textFromRecord(record = {}) {
  if (typeof record === 'string') return record;
  return [
    pick(record, TITLE_KEYS),
    pick(record, SUMMARY_KEYS),
    pick(record, TARGET_KEYS),
    pick(record, CRITERIA_KEYS),
    pick(record, APPLY_KEYS),
    pick(record, DOC_KEYS),
    stringifyValue(record._lifepass_detail),
    stringifyValue(record._lifepass_support_conditions),
  ].filter(Boolean).join('\n');
}

function inferDomain(text = '') {
  if (/월세|임대|주거|전세|보증금|공공주택|주택|입주/.test(text)) return '주거';
  if (/취업|구직|훈련|고용|일자리|채용|직업|근로/.test(text)) return '고용';
  if (/청년|대학생|졸업|사회초년/.test(text)) return '청년';
  if (/의료|건강|병원|치료/.test(text)) return '의료';
  if (/금융|대출|신용|채무|이자/.test(text)) return '금융';
  if (/교육|장학|학자금|수업료/.test(text)) return '교육';
  return '생활지원';
}

function extractUrl(record = {}) {
  return pick(record, URL_KEYS);
}

function externalIdFromRecord(record = {}, text = '') {
  return String(pick(record, ID_KEYS) || sha256(text).slice(0, 16));
}

function splitDocs(value = '', signalsDocs = []) {
  const docs = new Set(Array.isArray(signalsDocs) ? signalsDocs : []);
  String(value || '')
    .split(/[,/·ㆍ\n]| 및 | 또는 /)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2 && x.length <= 30)
    .forEach((x) => docs.add(x));
  return Array.from(docs).slice(0, 12);
}

export function normalizePolicyRecord(record = {}, source = {}, context = {}) {
  const rawText = context.rawText || textFromRecord(record) || stringifyValue(record);
  const title = String(pick(record, TITLE_KEYS) || rawText.split(/\r?\n/).find(Boolean) || '수집 정책').trim().slice(0, 120);
  const sourceId = source.id || context.source_id || 'unknown-source';
  const externalId = externalIdFromRecord(record, rawText);
  const signals = extractPolicySignalsFromText(rawText);
  const rule = generateRuleFromPolicySignals(signals);
  const warningRule = generateWarningRuleFromPolicySignals(signals);
  const contentHash = sha256(rawText);
  const id = `${sourceId}-${externalId}`.replace(/[^a-zA-Z0-9가-힣_-]/g, '-').slice(0, 120);
  const domain = inferDomain(rawText);
  const requiredDocs = splitDocs(pick(record, DOC_KEYS), signals.required_docs || []);
  const benefit = {
    id,
    name: title,
    domain,
    estimated_monthly_value: signals.support_amount || 0,
    priority: source.priority || 50,
    description: String(pick(record, SUMMARY_KEYS) || rawText.slice(0, 220)).trim(),
    target: String(pick(record, TARGET_KEYS) || pick(record, CRITERIA_KEYS) || (signals.age_range ? `만 ${signals.age_range[0]}~${signals.age_range[1]}세 대상` : '정책 원문 확인 필요')).trim().slice(0, 300),
    required_docs: requiredDocs,
    apply_url: extractUrl(record),
    exclusive_group: domain === '주거' ? 'housing_support_auto' : undefined,
    conflicts_with: [],
    rule,
    warning_rule: warningRule,
  };
  return {
    id: `${id}-${contentHash.slice(0, 8)}`,
    benefit,
    signals,
    documentKind: detectDocumentKind(rawText),
    source: {
      id: sourceId,
      label: source.label || sourceId,
      strategy: source.strategy || 'unknown',
      external_id: externalId,
      original_url: context.original_url || extractUrl(record) || source.lastFetchedUrl || '',
      fetched_urls: source.fetchedUrls || [],
    },
    ingestion: {
      content_hash: contentHash,
      collected_at: new Date().toISOString(),
      source_modified_at: pick(record, MODIFIED_KEYS) || context.last_modified || null,
      parser: context.parser || 'record-normalizer',
      needs_review: true,
      review_reasons: buildReviewReasons(signals, rule, record),
    },
    rawText,
  };
}

function buildReviewReasons(signals, rule, record = {}) {
  const reasons = [];
  if (record._lifepass_error) reasons.push('수집 과정에서 오류 응답이 발생했습니다. 원문 URL과 인증키를 확인해야 합니다.');
  if (!rule.all?.length) reasons.push('자동으로 생성된 자격 조건이 부족합니다.');
  if (!signals.support_amount) reasons.push('지원 금액을 확정하지 못했습니다.');
  if (!signals.income_percent_criteria?.length) reasons.push('소득 기준을 확정하지 못했습니다.');
  if (!signals.application_methods?.length && !pick(record, APPLY_KEYS)) reasons.push('신청 방법을 원문에서 다시 확인해야 합니다.');
  return reasons.length ? reasons : ['자동 추출 결과를 관리자 검수 후 공개하세요.'];
}