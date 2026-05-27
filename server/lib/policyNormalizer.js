import { detectDocumentKind, extractPolicySignalsFromText } from '../../src/logic/documentPipeline.js';
import { generateRuleFromPolicySignals, generateWarningRuleFromPolicySignals } from './ruleGenerator.js';
import { sha256 } from './policyStore.js';

function pick(record, keys = []) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function textFromRecord(record = {}) {
  if (typeof record === 'string') return record;
  return [
    pick(record, ['title', 'name', 'servNm', 'serviceName', '서비스명', '사업명']),
    pick(record, ['summary', 'description', 'servDgst', '서비스목적', '지원내용']),
    pick(record, ['target', 'supportTarget', '대상', '지원대상']),
    pick(record, ['selectionCriteria', 'criteria', '선정기준']),
    pick(record, ['application', 'applyMethod', '신청방법']),
    pick(record, ['requiredDocs', 'documents', '구비서류', '제출서류']),
  ].filter(Boolean).join('\n');
}

function inferDomain(text = '') {
  if (/월세|임대|주거|전세|보증금/.test(text)) return '주거';
  if (/취업|구직|훈련|고용|일자리/.test(text)) return '고용';
  if (/의료|건강|병원|치료/.test(text)) return '의료';
  if (/금융|대출|신용|채무/.test(text)) return '금융';
  if (/교육|장학|학자금/.test(text)) return '교육';
  return '생활지원';
}

function extractUrl(record = {}) {
  return pick(record, ['url', 'link', 'detailUrl', 'applyUrl', '신청URL', '바로가기']);
}

function externalIdFromRecord(record = {}, text = '') {
  return String(pick(record, ['id', 'serviceId', 'servId', 'wlfareInfoId', '정책ID']) || sha256(text).slice(0, 16));
}

export function normalizePolicyRecord(record = {}, source = {}, context = {}) {
  const rawText = context.rawText || textFromRecord(record);
  const title = String(pick(record, ['title', 'name', 'servNm', 'serviceName', '서비스명', '사업명']) || rawText.split(/\r?\n/).find(Boolean) || '수집 정책').trim();
  const sourceId = source.id || context.source_id || 'unknown-source';
  const externalId = externalIdFromRecord(record, rawText);
  const signals = extractPolicySignalsFromText(rawText);
  const rule = generateRuleFromPolicySignals(signals);
  const warningRule = generateWarningRuleFromPolicySignals(signals);
  const contentHash = sha256(rawText);
  const id = `${sourceId}-${externalId}`.replace(/[^a-zA-Z0-9가-힣_-]/g, '-').slice(0, 120);
  const benefit = {
    id,
    name: title,
    domain: inferDomain(rawText),
    estimated_monthly_value: signals.support_amount || 0,
    priority: source.priority || 50,
    description: String(pick(record, ['summary', 'description', 'servDgst', '지원내용']) || rawText.slice(0, 180)).trim(),
    target: String(pick(record, ['target', 'supportTarget', '대상', '지원대상']) || (signals.age_range ? `만 ${signals.age_range[0]}~${signals.age_range[1]}세 대상` : '정책 원문 확인 필요')).trim(),
    required_docs: signals.required_docs || [],
    apply_url: extractUrl(record),
    exclusive_group: inferDomain(rawText) === '주거' ? 'housing_support_auto' : undefined,
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
    },
    ingestion: {
      content_hash: contentHash,
      collected_at: new Date().toISOString(),
      source_modified_at: pick(record, ['modifiedAt', 'updatedAt', 'lastModified', '수정일', '변경일']) || context.last_modified || null,
      parser: context.parser || 'record-normalizer',
      needs_review: true,
      review_reasons: buildReviewReasons(signals, rule),
    },
    rawText,
  };
}

function buildReviewReasons(signals, rule) {
  const reasons = [];
  if (!rule.all?.length) reasons.push('자동으로 생성된 자격 조건이 부족합니다.');
  if (!signals.support_amount) reasons.push('지원 금액을 확정하지 못했습니다.');
  if (!signals.income_percent_criteria?.length) reasons.push('소득 기준을 확정하지 못했습니다.');
  if (!signals.application_methods?.length) reasons.push('신청 방법을 원문에서 다시 확인해야 합니다.');
  return reasons.length ? reasons : ['자동 추출 결과를 관리자 검수 후 공개하세요.'];
}
