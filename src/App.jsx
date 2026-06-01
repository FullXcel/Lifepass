import React, { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import benefitsSeed from "./data/benefits.json";
import sampleProfiles from "./data/sample_profiles.json";
import {
  DEFAULT_PROFILE,
  asProfile,
  normalizeProfile,
  validateProfile,
  parseOnboardingText,
  evaluateAll,
  optimizeBenefits,
  solveBenefitPortfolio,
  simulateTimeline,
  simulateIncomeCliff,
  generateTimelineEvents,
  buildApplicationStrategy,
  buildApplicationWorkflow,
  planNotifications,
  buildAgentPlan,
  buildAgentWorkflow,
  buildTrustAudit,
  buildCounterfactuals,
  analyzeProfiles,
  makeMarkdownReport,
  money,
  downloadText,
} from "./logic/lifepassCore.js";
import {
  FIELD_LABELS,
  runDocumentPipeline,
  buildVerificationChecklist,
  mapRowsToProfiles,
  buildSchemaMap,
  profileToEditableRows,
} from "./logic/documentPipeline.js";

const TABS = [
  "홈",
  "내 정보 불러오기",
  "받을 수 있는 혜택",
  "복지절벽 미리보기",
  "신청 준비하기",
  "판정 근거 확인하기",
];

function valueText(value) {
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (typeof value === "number" && value >= 10000) return money(value);
  return String(value ?? "");
}

function Badge({ children, tone = "neutral" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function Metric({ label, value, note }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {note && <div className="metric-note">{note}</div>}
    </div>
  );
}

const SECRET_QUERY_PARAMS = new Set([
  "servicekey",
  "oc",
  "authkey",
  "openapivlak",
  "apikey",
  "key",
]);
const URL_PATTERN = /https?:\/\/[^\s<>)\]]+/gi;

function isApiTraceUrl(url) {
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  if (host.includes("apis.data.go.kr") || host.includes("api.odcloud.kr")) return true;
  if (pathname.includes("/drf/lawsearch.do") || pathname.includes("/drf/lawservice.do")) return true;
  if (pathname.includes("/opi/") && /openapivlak|authkey|servicekey/i.test(url.search)) return true;
  return [...url.searchParams.keys()].some((key) => SECRET_QUERY_PARAMS.has(key.toLowerCase()));
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!/^https?:$/.test(url.protocol)) return "";
    if (isApiTraceUrl(url)) return "";
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return "";
  }
}

function publicHrefFor(item) {
  const candidates = [item?.apply_url, item?.detail_url, item?.source?.original_url].filter(Boolean);
  for (const href of candidates) {
    const safe = safeExternalUrl(href);
    if (safe) return safe;
  }
  return "";
}

function SafeLink({ href, children = "링크 열기" }) {
  const safeHref = safeExternalUrl(href);
  if (!safeHref) return <span>{children}</span>;
  return (
    <a className="inline-link" href={safeHref} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function LinkText({ text }) {
  const raw = String(text ?? "");
  const matches = [...raw.matchAll(URL_PATTERN)];
  if (!matches.length) return raw;
  if (matches.length === 1 && matches[0][0] === raw.trim()) {
    return <SafeLink href={matches[0][0]} />;
  }
  const parts = [];
  let cursor = 0;
  matches.forEach((match, idx) => {
    const url = match[0];
    const start = match.index ?? 0;
    if (start > cursor) parts.push(raw.slice(cursor, start));
    parts.push(
      <SafeLink key={`${url}-${idx}`} href={url}>
        링크 열기
      </SafeLink>,
    );
    cursor = start + url.length;
  });
  if (cursor < raw.length) parts.push(raw.slice(cursor));
  return parts;
}

function CellValue({ value }) {
  if (Array.isArray(value)) {
    if (!value.length) return "";
    return value.map((item, idx) => (
      <React.Fragment key={idx}>
        {idx > 0 ? ", " : ""}
        <CellValue value={item} />
      </React.Fragment>
    ));
  }
  if (value && typeof value === "object") {
    if (value.href || value.url) {
      return <SafeLink href={value.href || value.url}>{value.label || "링크 열기"}</SafeLink>;
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return <LinkText text={value} />;
  return String(value ?? "");
}

function sourceLabelOf(item, fallback = "출처 미상") {
  return item?.source?.label || item?.source_label || fallback;
}

function linkCellFor(item) {
  const href = publicHrefFor(item);
  if (href) return { url: href, label: '링크 열기' };
  if (item?.link_status === 'api_trace_only' || item?.apply_url || item?.source?.original_url) {
    return 'API 호출 URL은 수집·추적용이라 사용자용 링크로 숨김';
  }
  return item?.link_reason || '공개 신청·상세 링크 없음';
}

function LinkNotice({ item }) {
  const href = publicHrefFor(item);
  if (href) return <SafeLink href={href}>링크 열기</SafeLink>;
  return <span className="muted">{linkCellFor(item)}</span>;
}

function importanceText(value) {
  const score = Number(value || 0);
  if (score >= 90) return `${score}점 · 매우 높음`;
  if (score >= 70) return `${score}점 · 높음`;
  if (score >= 50) return `${score}점 · 보통`;
  return `${score}점 · 참고`;
}

const CONFIRM_PRIORITY_GUIDE = [
  { 점수대: "0~44점", 상태: "안정", 의미: "소득 공백·주거비 부담·혜택 상실 위험이 낮아 일반 확인으로 충분합니다." },
  { 점수대: "45~59점", 상태: "주의", 의미: "일부 위험 신호가 있어 입력 정보와 서류를 다시 확인하는 것이 좋습니다." },
  { 점수대: "60~69점", 상태: "주의/확인 권장", 의미: "상담사 또는 운영자 추가 확인을 권장하는 구간입니다." },
  { 점수대: "70~100점", 상태: "긴급", 의미: "복지절벽·실업급여 종료·소득 공백 등 즉시 확인할 신호가 큽니다." },
];

const AUDIT_SCORE_GUIDE = [
  { 점수대: "85~100점", 상태: "확인 완료", 의미: "자동 판정 근거가 비교적 충분하며 추가 확인 항목이 적습니다." },
  { 점수대: "73~84점", 상태: "추가 확인 필요", 의미: "일부 통제항목이 미흡하므로 근거·중복수급·개인정보 항목을 확인해야 합니다." },
  { 점수대: "72점 이하", 상태: "강한 추가 확인 필요", 의미: "여러 통제항목에서 확인 필요가 발생한 상태입니다." },
];

const POLICY_PRIORITY_GUIDE = [
  { 점수대: "90~100점", 표시: "매우 높음", 의미: "운영자가 핵심 정책으로 보거나 원천 데이터에서 높은 우선값을 가진 정책입니다. 금액 조건이 비슷하면 먼저 검토할 후보입니다." },
  { 점수대: "70~89점", 표시: "높음", 의미: "추천·정렬에서 우선적으로 고려되는 정책입니다. 단, 실제 수급 가능 여부는 자격 조건 충족 여부가 먼저입니다." },
  { 점수대: "50~69점", 표시: "보통", 의미: "일반적인 검토 대상입니다. 최적 조합에서는 월 환산효과와 중복수급 충돌 여부가 더 크게 작용합니다." },
  { 점수대: "0~49점", 표시: "참고", 의미: "보조 참고 정책입니다. 조건이 맞더라도 다른 정책보다 추천 순위가 뒤로 밀릴 수 있습니다." },
];

const POLICY_IMPORTANCE_BASIS = [
  { 기준: "원천 정책의 기본 우선값", 설명: "서버에서 수집·정규화된 정책 데이터 또는 데모 정책에 저장된 기본값을 출발점으로 사용합니다." },
  { 기준: "정책 성격별 보정", 설명: "주거·고용·의료·교육 등 분야, 실제 월 환산효과, 취약계층·청년 등 대상자 표현, 사용자용 링크 확인 여부를 반영해 같은 출처 정책도 다른 점수가 나오게 보정합니다." },
  { 기준: "최적 조합에서의 보조 가중치", 설명: "최적 조합 계산은 월 환산효과를 크게 보고, 중요도는 같은 수준의 혜택을 정렬하거나 비교할 때 보조 점수로 사용합니다." },
  { 기준: "자격 판정과의 구분", 설명: "중요도는 정책 자체의 추천 우선값입니다. 사용자가 실제로 받을 수 있는지는 나이, 소득, 지역, 가구원 수 같은 조건 판정으로 따로 결정됩니다." },
];


const LEGAL_SCOPE_RULES = [
  {
    domain: "생활지원",
    label: "생계·긴급복지·기초생활 보장 정책",
    pattern: /국민기초생활|기초생활보장|긴급복지|생계급여|차상위|사회보장|복지|저소득/,
  },
  {
    domain: "주거",
    label: "주거급여·공공임대·월세·전월세 지원 정책",
    pattern: /주거급여|공공주택|임대주택|주택|월세|전세|임대차|주거/,
  },
  {
    domain: "고용",
    label: "고용보험·국민취업지원·직업훈련·구직 지원 정책",
    pattern: /고용보험|국민취업지원|직업능력|직업훈련|구직|취업|실업급여|근로자|일자리/,
  },
  {
    domain: "의료",
    label: "의료급여·건강보험·의료비 지원 정책",
    pattern: /의료급여|건강보험|의료비|요양|병원|치료|건강/,
  },
  {
    domain: "교육",
    label: "교육비·장학·학자금 지원 정책",
    pattern: /교육급여|교육비|장학|학자금|수업료|학교|대학생/,
  },
  {
    domain: "청년",
    label: "청년 주거·취업·자립 지원 정책",
    pattern: /청년|청소년|대학생|사회초년|자립준비/,
  },
  {
    domain: "금융",
    label: "서민금융·채무조정·보증·이자 지원 정책",
    pattern: /서민금융|채무|신용|보증|이자|대출|금융/,
  },
];

const LEGAL_BASIS_GUIDE = [
  {
    질문: "어디서 온 데이터인가",
    설명: "국가법령정보센터 등 공식 법령 출처에서 수집한 현행 법률·시행령·시행규칙·조문 후보입니다.",
  },
  {
    질문: "무엇의 근거인가",
    설명: "화면에 추천되는 혜택 그 자체가 아니라, 그 혜택의 대상자 범위·급여/지원 기준·집행기관 권한이 어디에서 나오는지 설명하는 상위 근거입니다.",
  },
  {
    질문: "왜 중요한가",
    설명: "정책 공고나 API 응답은 요약본일 수 있으므로, 법령 근거를 함께 보면 제도 목적과 자격 기준이 임의 안내가 아니라 공식 근거에 기반하는지 확인할 수 있습니다.",
  },
  {
    질문: "사용자는 왜 알아야 하나",
    설명: "신청 전에는 내가 왜 대상인지·왜 제외될 수 있는지 확인할 수 있고, 상담·문의·이의제기 때 어떤 법적 기준을 확인해야 하는지 알 수 있습니다.",
  },
];

const LEGAL_ACT_ROLE_RULES = [
  {
    pattern: /주거급여/,
    domains: ["주거", "생활지원"],
    target: "주거급여·임차료·수선유지급여 등 주거비 지원 정책",
    role: "주거급여 신청 대상, 임차료·수선유지급여 같은 지원 종류, 소득인정액과 주거 형태에 따른 지급 기준의 근거입니다.",
    userValue: "월세·전세·자가 여부나 소득 기준 때문에 주거급여 대상이 되는지 확인할 때 원문 기준을 대조할 수 있습니다.",
  },
  {
    pattern: /국민기초생활|기초생활보장/,
    domains: ["생활지원", "주거", "의료", "교육"],
    target: "생계급여·의료급여·주거급여·교육급여 등 기초생활 보장 정책",
    role: "수급권자 범위, 급여 종류, 소득인정액·부양의무자 등 기초생활보장 급여 판단 기준의 근거입니다.",
    userValue: "내 소득·재산·가구 상황 때문에 기초생활 관련 급여 대상 또는 제외 대상이 되는 이유를 확인할 수 있습니다.",
  },
  {
    pattern: /긴급복지/,
    domains: ["생활지원", "의료", "주거"],
    target: "갑작스러운 위기 상황의 생계·의료·주거 긴급지원 정책",
    role: "실직, 질병, 주거 상실 등 위기사유 인정 범위와 긴급지원의 종류·절차를 정하는 근거입니다.",
    userValue: "위기 사유를 왜 예/아니오로 먼저 확인하는지, 어떤 상황이 긴급지원 사유가 되는지 원문으로 확인할 수 있습니다.",
  },
  {
    pattern: /고용보험/,
    domains: ["고용"],
    target: "실업급여·고용안정·직업능력개발 등 고용보험 기반 정책",
    role: "고용보험 가입, 실업급여 수급, 직업훈련·고용안정 지원의 대상과 급여 조건을 정하는 근거입니다.",
    userValue: "퇴사·실업급여 잔여일·고용보험 가입 여부가 추천 결과에 어떤 영향을 주는지 확인할 수 있습니다.",
  },
  {
    pattern: /국민취업지원|구직자 취업촉진/,
    domains: ["고용", "청년"],
    target: "국민취업지원제도·구직촉진수당·취업지원서비스 정책",
    role: "구직자 유형, 소득·재산 요건, 취업지원서비스와 구직촉진수당 지급 범위를 정하는 근거입니다.",
    userValue: "취업 상태·소득·재산 기준 때문에 국민취업지원제도 대상인지 확인할 때 쓸 수 있습니다.",
  },
  {
    pattern: /청년|위기아동|자립준비|청소년/,
    domains: ["청년", "생활지원"],
    target: "청년·청소년·자립준비청년 생활·주거·취업 지원 정책",
    role: "청년 또는 위기아동·청소년의 지원 대상 범위와 국가·지자체의 지원 책임을 설명하는 근거입니다.",
    userValue: "나이·가구상황·자립 여부가 청년 지원 정책 추천에 왜 반영되는지 확인할 수 있습니다.",
  },
  {
    pattern: /노인복지/,
    domains: ["생활지원", "의료"],
    target: "노인 돌봄·건강·생활안정 지원 정책",
    role: "노인 복지서비스, 건강·돌봄·생활안정 지원의 대상과 국가·지자체 책무를 설명하는 근거입니다.",
    userValue: "나이 기준이나 노인가구 여부에 따라 지원 대상이 달라지는 이유를 확인할 수 있습니다.",
  },
  {
    pattern: /장애인/,
    domains: ["생활지원", "의료", "교육", "고용"],
    target: "장애인 생활·의료·교육·고용 지원 정책",
    role: "장애인 등록, 복지서비스, 교육·고용·의료 지원의 대상과 서비스 범위를 설명하는 근거입니다.",
    userValue: "장애 여부 또는 장애인 가구 조건이 정책 추천에 쓰이는 이유와 확인해야 할 증빙을 파악할 수 있습니다.",
  },
  {
    pattern: /교육|유아교육|영유아보육|초ㆍ중등교육|고등교육|학자금/,
    domains: ["교육", "청년"],
    target: "교육비·보육료·장학금·학자금 지원 정책",
    role: "교육·보육 지원의 대상, 비용 지원 범위, 학교·보육기관 관련 행정 기준을 정하는 근거입니다.",
    userValue: "학생 여부, 자녀 여부, 학자금·교육비 조건이 추천 결과에 왜 연결되는지 확인할 수 있습니다.",
  },
  {
    pattern: /사회복지사업|사회보장|사회복지/,
    domains: ["생활지원"],
    target: "사회복지서비스 제공, 복지시설, 지자체 복지사업 전반",
    role: "사회복지서비스 제공 체계, 복지시설 운영, 국가·지자체의 복지사업 집행 권한을 설명하는 포괄 근거입니다.",
    userValue: "개별 지원금의 직접 지급 기준보다는, 복지서비스가 어떤 행정 체계에서 운영되는지 확인할 때 필요합니다.",
  },
];

function cleanGenericLawTitle(value = "") {
  const text = String(value || "").trim();
  if (!text || /^LawSearch:/i.test(text) || /^target:/i.test(text)) return "";
  return text;
}

function extractXmlTag(block = "", tag = "") {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(block || "").match(new RegExp(`<${escaped}>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return (match?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
}

function extractLawEntriesFromText(text = "") {
  const source = String(text || "");
  const blocks = source.match(/<법령일련번호>[\s\S]*?(?=<법령일련번호>|$)/g) || [];
  const entries = blocks
    .map((block) => {
      const name = extractXmlTag(block, "법령명한글");
      if (!name) return null;
      const serial = extractXmlTag(block, "법령일련번호");
      return {
        name,
        shortName: extractXmlTag(block, "법령약칭명"),
        serial,
        mst: serial,
        lawId: extractXmlTag(block, "법령ID"),
        ministry: extractXmlTag(block, "소관부처명"),
        lawType: extractXmlTag(block, "법령구분명"),
        effectiveDate: extractXmlTag(block, "시행일자"),
        detailPath: extractXmlTag(block, "법령상세링크"),
        rawText: block,
      };
    })
    .filter(Boolean);
  if (entries.length) return entries;

  const names = [...source.matchAll(/<법령명한글>([\s\S]*?)<\/법령명한글>/g)]
    .map((match) => match[1]?.trim())
    .filter(Boolean);
  return [...new Set(names)].map((name) => ({ name, rawText: source }));
}

function lawPublicLink(entry = {}, law = {}) {
  const name = cleanGenericLawTitle(entry.name || law.name);
  if (name) return `https://www.law.go.kr/법령/${encodeURIComponent(name)}`;
  return publicHrefFor(law);
}

function getSpecificLegalRole(entry = {}, law = {}) {
  const text = [entry.name, entry.shortName, entry.rawText, law.description, law.target].filter(Boolean).join("\n");
  const rule = LEGAL_ACT_ROLE_RULES.find((item) => item.pattern.test(text));
  if (rule) return rule;
  const fallback = inferLegalBasisInfo({
    ...law,
    name: cleanGenericLawTitle(entry.name || law.name) || law.name,
    description: entry.rawText || law.description,
  });
  return {
    domains: fallback.domains,
    target: fallback.targetScope,
    role: fallback.role,
    userValue: fallback.userValue,
  };
}

function textOfPolicy(item = {}) {
  return [
    item.name,
    item.domain,
    item.description,
    item.target,
    item.legal_basis_summary,
    item.legal_basis_role,
    item.user_value,
    item.source?.label,
  ].filter(Boolean).join("\n");
}

function inferLegalBasisInfo(law = {}) {
  const text = textOfPolicy(law);
  const declaredDomains = Array.isArray(law.related_policy_domains)
    ? law.related_policy_domains.filter(Boolean)
    : [];
  const matched = LEGAL_SCOPE_RULES.filter((rule) => declaredDomains.includes(rule.domain) || rule.pattern.test(text));
  const domains = matched.length ? matched.map((rule) => rule.domain) : declaredDomains;
  const scopeLabels = matched.length ? matched.map((rule) => rule.label) : [];
  const targetScope = scopeLabels.length ? scopeLabels.join(", ") : "복지·고용·주거 등 관련 정책";
  return {
    domains,
    targetScope,
    role:
      law.legal_basis_role ||
      `${targetScope}의 대상자 범위, 지원 기준, 집행기관 권한을 설명하는 상위 법령 근거입니다.`,
    userValue:
      law.user_value ||
      "사용자는 이 근거를 통해 해당 혜택이 왜 존재하는지, 본인이 어떤 자격 기준 때문에 대상 또는 제외 대상이 되는지, 상담·문의 때 무엇을 확인해야 하는지 알 수 있습니다.",
    summary:
      law.legal_basis_summary ||
      `${law.name || "법령"}은 ${targetScope}와 연결되는 근거 데이터입니다. 직접 지급되는 혜택으로 계산하지 않고 판정 설명과 원문 확인용으로 분리합니다.`,
  };
}

function overlapScore(a = "", b = "") {
  const terms = [...new Set(String(a).match(/[가-힣A-Za-z0-9]{2,}/g) || [])]
    .filter((term) => !/정책|지원|사업|대상|내용|근거|법률|시행령|시행규칙|관련/.test(term))
    .slice(0, 40);
  return terms.reduce((score, term) => score + (String(b).includes(term) ? 1 : 0), 0);
}

function relatedPoliciesForLaw(law = {}, policies = []) {
  const info = inferLegalBasisInfo(law);
  const lawText = textOfPolicy(law);
  const scored = policies
    .filter((policy) => policy?.domain !== "법령근거")
    .map((policy) => {
      const policyText = textOfPolicy(policy);
      const domainScore = info.domains.includes(policy.domain) ? 4 : 0;
      return { name: policy.name, score: domainScore + overlapScore(lawText, policyText) };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name), "ko-KR"));
  return scored.slice(0, 3).map((row) => row.name);
}

function buildLegalBasisRows(legalReferences = [], policies = []) {
  const rows = [];
  for (const law of legalReferences) {
    const sourceText = [law.description, law.target, law.legal_basis_summary, law.legal_basis_role, law.name].filter(Boolean).join("\n");
    const entries = extractLawEntriesFromText(sourceText);
    const displayEntries = entries.length
      ? entries
      : cleanGenericLawTitle(law.name)
        ? [{ name: cleanGenericLawTitle(law.name), rawText: sourceText }]
        : [];

    for (const entry of displayEntries) {
      const roleInfo = getSpecificLegalRole(entry, law);
      const lawLike = {
        ...law,
        name: entry.name,
        description: [entry.rawText, law.description].filter(Boolean).join("\n"),
        related_policy_domains: roleInfo.domains || [],
        legal_basis_role: roleInfo.role,
        user_value: roleInfo.userValue,
      };
      const related = relatedPoliciesForLaw(lawLike, policies);
      const publicLink = lawPublicLink(entry, law);
      rows.push({
        법령명: entry.shortName ? `${entry.name}(${entry.shortName})` : entry.name,
        소관부처: entry.ministry || "확인 필요",
        근거가되는대상: related.length ? related.join(", ") : roleInfo.target,
        근거역할: roleInfo.role,
        사용자가알아야하는이유: roleInfo.userValue,
        근거링크: publicLink ? { url: publicLink, label: "법령 원문 열기" } : linkCellFor(law),
      });
    }
  }

  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.법령명}::${row.소관부처}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ExplanationDetails({ children, title = "상세 설명", summary = "자세히 보기" }) {
  return (
    <details className="explain-details">
      <summary>{summary}</summary>
      <div className="explain-content">
        <h3>{title}</h3>
        {children}
      </div>
    </details>
  );
}

function ImportanceDetails({ score }) {
  return (
    <ExplanationDetails title="중요도의 의미" summary="중요도의 의미: 자세히 보기">
      <p>
        중요도는 해당 정책을 추천 목록과 최적 조합에서 얼마나 우선적으로 검토할지
        나타내는 내부 우선순위 점수입니다. 현재 정책의 중요도는 <b>{importanceText(score)}</b>입니다.
      </p>
      <p>
        이 값은 수급 확정 점수가 아니라 정책 데이터에 저장된 중요도 값을 국문으로 바꿔
        보여주는 값입니다. 최종 가능 여부는 나이, 지역, 소득, 가구원 수, 월세, 중복수급 제한 같은
        조건 판정 결과로 따로 결정됩니다.
      </p>
      <h4>무엇을 기준으로 측정하나</h4>
      <SimpleTable rows={POLICY_IMPORTANCE_BASIS} />
      <h4>점수대별 의미</h4>
      <SimpleTable rows={POLICY_PRIORITY_GUIDE} />
    </ExplanationDetails>
  );
}

function Section({ title, subtitle, children, right }) {
  return (
    <section className="section-card">
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function SimpleTable({ rows, limit = 12 }) {
  const data = Array.isArray(rows) ? rows.slice(0, limit) : [];
  if (!data.length) return <p className="muted">표시할 데이터가 없습니다.</p>;
  const columns = Object.keys(data[0]);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr key={idx}>
              {columns.map((c) => (
                <td key={c}>
                  <CellValue value={row[c]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MONEY_FIELDS = new Set([
  "monthly_income",
  "expected_monthly_income",
  "rent",
  "deposit",
  "assets_million",
  "medical_expense_3m",
  "debt_monthly_payment",
]);

function formatCommaNumber(value) {
  if (value === null || value === undefined || value === "") return "";

  const raw = String(value).replace(/[^\d.-]/g, "");
  if (!raw || raw === "-") return raw;

  const [integerPart, decimalPart] = raw.split(".");
  const sign = integerPart.startsWith("-") ? "-" : "";
  const digits = integerPart.replace("-", "");

  const formattedInteger = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return decimalPart !== undefined
    ? `${sign}${formattedInteger}.${decimalPart}`
    : `${sign}${formattedInteger}`;
}

function ProfileEditor({ profile, onChange }) {
  const rows = profileToEditableRows(profile);
  const update = (field, raw) => {
    let value = raw;
    if (typeof DEFAULT_PROFILE[field] === "number")
      value = Number(String(raw).replaceAll(",", ""));
    if (typeof DEFAULT_PROFILE[field] === "boolean") value = raw === "true";
    onChange(normalizeProfile({ ...profile, [field]: value }));
  };
  return (
    <div className="profile-grid">
      {rows.map(({ field, label, value, help }) => (
        <label key={field} className="field-row">
          <span>{label}</span>
          {help && <small className="field-help">{help}</small>}
          {typeof DEFAULT_PROFILE[field] === "boolean" ? (
            <select
              value={String(Boolean(value))}
              onChange={(e) => update(field, e.target.value)}
            >
              <option value="true">예</option>
              <option value="false">아니오</option>
            </select>
          ) : field === "employment_status" ? (
            <select
              value={value || ""}
              onChange={(e) => update(field, e.target.value)}
            >
              <option value="unemployed">현재 소득 없음/실직</option>
              <option value="job_seeker">구직 중</option>
              <option value="part_time">아르바이트/파트타임</option>
              <option value="employed">재직 중</option>
              <option value="freelancer">프리랜서</option>
              <option value="student">학생</option>
            </select>
          ) : (
            <input
              value={MONEY_FIELDS.has(field) ? formatCommaNumber(value) : value ?? ""}
              onChange={(e) => update(field, e.target.value)}
            />
          )}
        </label>
      ))}
    </div>
  );
}

function useDerived(profile, benefits) {
  return useMemo(() => {
    const [safeProfile, validationWarnings] = validateProfile(
      asProfile(profile),
    );
    const evaluations = evaluateAll(benefits, safeProfile);
    const plan = optimizeBenefits(evaluations);
    const portfolio = solveBenefitPortfolio(evaluations, 6);
    const timeline = simulateTimeline(safeProfile, benefits, [0, 1, 3, 6, 12]);
    const cliffs = simulateIncomeCliff(safeProfile, benefits);
    const events = generateTimelineEvents(safeProfile, benefits);
    const strategy = buildApplicationStrategy(safeProfile, benefits);
    const workflow = buildApplicationWorkflow(safeProfile, plan.selected);
    const notifications = planNotifications(safeProfile, workflow);
    const agent = buildAgentPlan(
      safeProfile,
      benefits,
      "현재 가능한 혜택과 향후 상실 위험을 설명해줘",
    );
    const agentWorkflow = buildAgentWorkflow(
      safeProfile,
      benefits,
      "상담 흐름",
    );
    const audit = buildTrustAudit(safeProfile, benefits, agent);
    const counterfactuals = buildCounterfactuals(safeProfile, benefits);
    return {
      safeProfile,
      validationWarnings,
      evaluations,
      plan,
      portfolio,
      timeline,
      cliffs,
      events,
      strategy,
      workflow,
      notifications,
      agent,
      agentWorkflow,
      audit,
      counterfactuals,
    };
  }, [profile, benefits]);
}

export default function App() {
  const [activeTab, setActiveTab] = useState(0);
  const [approvedPolicies, setApprovedPolicies] = useState([]);
  const [collectedPolicies, setCollectedPolicies] = useState([]);
  const [legalReferences, setLegalReferences] = useState([]);
  const activeExternalPolicies = useMemo(() => {
    return collectedPolicies
      .filter(
        (policy) => policy?.id && policy?.name && policy?.domain !== '법령근거',
      )
      .map((policy) => ({
        ...policy,
        required_docs: Array.isArray(policy.required_docs)
          ? policy.required_docs
          : [],
        conflicts_with: Array.isArray(policy.conflicts_with)
          ? policy.conflicts_with
          : [],
        rule: policy.rule || { all: [] },
      }));
  }, [collectedPolicies]);
  const usingFallbackPolicies = activeExternalPolicies.length === 0;
  const usingPendingCollectedPolicies = activeExternalPolicies.some((policy) => policy.pending_review || policy.review_status === "pending_review");
  const benefits = useMemo(() => {
    if (activeExternalPolicies.length > 0) return activeExternalPolicies;
    return benefitsSeed;
  }, [activeExternalPolicies]);
  const [profile, setProfile] = useState(
    normalizeProfile(sampleProfiles[0]?.profile || DEFAULT_PROFILE),
  );
  const [onboardingText, setOnboardingText] = useState("");
  const [onboardingParsed, setOnboardingParsed] = useState(false);
  const [docResult, setDocResult] = useState(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState("");
  const [batchRows, setBatchRows] = useState([]);
  const [batchAnalysis, setBatchAnalysis] = useState([]);
  const [policyAdmin, setPolicyAdmin] = useState({
    sources: [],
    enabled: [],
    drafts: [],
    policies: [],
  });
  const [policyAdminLoading, setPolicyAdminLoading] = useState(false);
  const [policyAdminMessage, setPolicyAdminMessage] = useState("");
  const [adminToken, setAdminToken] = useState(
    () => localStorage.getItem("lifepassAdminToken") || "",
  );
  const adminHeaders = useMemo(
    () => (adminToken ? { "x-admin-token": adminToken } : {}),
    [adminToken],
  );
  const saveAdminToken = (value) => {
    setAdminToken(value);
    if (value) localStorage.setItem("lifepassAdminToken", value);
    else localStorage.removeItem("lifepassAdminToken");
  };
  const derived = useDerived(profile, benefits);
  const policySourceBreakdown = useMemo(() => {
    if (usingFallbackPolicies) return [{ 출처: "데모 정책", 포함정책: benefits.length }];
    const counts = new Map();
    activeExternalPolicies.forEach((policy) => {
      const label = sourceLabelOf(policy, "출처 미상");
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    return [...counts.entries()]
      .map(([출처, 포함정책]) => ({ 출처, 포함정책 }))
      .sort((a, b) => b.포함정책 - a.포함정책);
  }, [activeExternalPolicies, benefits.length, usingFallbackPolicies]);
  const policySourceValue = usingFallbackPolicies
    ? "데모 정책"
    : policySourceBreakdown.length <= 2
      ? policySourceBreakdown.map((s) => s.출처).join(", ")
      : `${policySourceBreakdown.slice(0, 2).map((s) => s.출처).join(", ")} 외 ${policySourceBreakdown.length - 2}곳`;

  const legalBasisRows = useMemo(
    () => buildLegalBasisRows(legalReferences, activeExternalPolicies),
    [legalReferences, activeExternalPolicies],
  );

  const loadPolicyAdmin = async () => {
    setPolicyAdminLoading(true);
    setPolicyAdminMessage("");
    try {
      const [sourcesRes, draftsRes, policiesRes] = await Promise.all([
        fetch("/api/sources"),
        fetch("/api/admin/review", { headers: adminHeaders }),
        fetch("/api/policies"),
      ]);
      if (!sourcesRes.ok)
        throw new Error(
          "정책 수집 서버에 연결할 수 없습니다. 먼저 npm run server를 실행해 주세요.",
        );
      const sources = await sourcesRes.json();
      const drafts = draftsRes.ok ? await draftsRes.json() : { drafts: [] };
      const policies = policiesRes.ok
        ? await policiesRes.json()
        : { policies: [] };
      const approved = (policies.policies || [])
        .map((p) => ({
          ...p,
          required_docs: Array.isArray(p.required_docs) ? p.required_docs : [],
          conflicts_with: Array.isArray(p.conflicts_with)
            ? p.conflicts_with
            : [],
          rule: p.rule || { all: [] },
        }))
        .filter((p) => p.id && p.name);
      const collected = (policies.collected_policies || policies.policies || [])
        .map((p) => ({
          ...p,
          required_docs: Array.isArray(p.required_docs) ? p.required_docs : [],
          conflicts_with: Array.isArray(p.conflicts_with)
            ? p.conflicts_with
            : [],
          rule: p.rule || { all: [] },
        }))
        .filter((p) => p.id && p.name);
      setApprovedPolicies(approved);
      setCollectedPolicies(collected);
      setLegalReferences(
        collected.filter((p) => p?.domain === "법령근거"),
      );
      setPolicyAdmin({
        sources: sources.sources || [],
        enabled: sources.enabled || [],
        drafts: drafts.drafts || [],
        policies: approved,
        collectedPolicies: collected,
      });
    } catch (error) {
      setPolicyAdminMessage(error?.message || String(error));
    } finally {
      setPolicyAdminLoading(false);
    }
  };

  const runPolicyIngestion = async () => {
    setPolicyAdminLoading(true);
    setPolicyAdminMessage(
      "정책 수집을 시작했습니다. API 키와 수집 URL이 설정되어 있어야 실제 데이터가 들어옵니다.",
    );
    try {
      const res = await fetch("/api/ingest/run", {
        method: "POST",
        headers: { "content-type": "application/json", ...adminHeaders },
        body: JSON.stringify({ forceReview: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "정책 수집 실행 실패");
      setPolicyAdminMessage(
        `수집 완료: 검수 후보 ${data.drafts_created}건, 저장 정책 ${data.summary?.policies || 0}건. 후보가 있으면 데모 대신 수집 정책 기준으로 표시됩니다.`,
      );
      await loadPolicyAdmin();
    } catch (error) {
      setPolicyAdminMessage(error?.message || String(error));
    } finally {
      setPolicyAdminLoading(false);
    }
  };

  const reviewPolicyDraft = async (draftId, action) => {
    setPolicyAdminLoading(true);
    try {
      const res = await fetch(
        `/api/admin/review/${encodeURIComponent(draftId)}/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", ...adminHeaders },
          body: JSON.stringify({ reviewer: "local-admin" }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "검수 처리 실패");
      setPolicyAdminMessage(
        action === "approve"
          ? "정책 후보를 승인했습니다."
          : "정책 후보를 반려했습니다.",
      );
      await loadPolicyAdmin();
    } catch (error) {
      setPolicyAdminMessage(error?.message || String(error));
    } finally {
      setPolicyAdminLoading(false);
    }
  };

  useEffect(() => {
    loadPolicyAdmin();
  }, [adminHeaders]);

  const handleOnboardingText = () => {
    if (!onboardingText.trim()) return;
    const parsed = parseOnboardingText(onboardingText);
    setProfile(parsed);
    setOnboardingParsed(true);
  };

  const handleDocument = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setDocLoading(true);
    setDocError("");
    try {
      const result = await runDocumentPipeline(file, { useOcr: true });
      setDocResult(result);
      if (result.documentKind !== "policy_notice") setProfile(result.profile);
    } catch (error) {
      setDocError(error?.message || String(error));
    } finally {
      setDocLoading(false);
    }
  };

  const handleBatchCsv = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    const rows = parsed.data || [];
    const mapped = mapRowsToProfiles(rows);
    const [summary] = analyzeProfiles(
      mapped.map((m) => m.profile),
      benefits,
    );
    setBatchRows(mapped);
    setBatchAnalysis(summary);
  };

  const exportReport = () => {
    const report = makeMarkdownReport(profile, benefits);
    downloadText("lifepass_report.md", report, "text/markdown");
  };

  const verificationChecklist = docResult
    ? buildVerificationChecklist(docResult)
    : [];
  const eligibleRows = derived.evaluations.map((ev) => ({
    혜택: ev.name,
    출처: sourceLabelOf(ev, usingFallbackPolicies ? "데모 정책" : "출처 미상"),
    분야: ev.domain,
    판정: ev.eligible ? "가능" : "불가",
    월환산: money(ev.monthly_value),
    중요도: importanceText(ev.priority),
    충족조건: ev.matched.slice(0, 3).join(", "),
    미충족조건: ev.unmet.slice(0, 3).join(", "),
    안내링크: linkCellFor(ev),
  }));
  const timelineRows = derived.timeline.map((r) => ({
    시점: r.label,
    월소득: money(r.income),
    선택혜택수: r.selected_benefits.length,
    월환산효과: money(r.benefit_value),
    순효과: money(r.net_effect),
    신규: r.gained?.join(", ") || "없음",
    상실: r.lost?.join(", ") || "없음",
  }));
  const cliffRows = derived.cliffs.map((r) => ({
    소득시나리오: r.label,
    혜택: money(r.benefit_value),
    순효과: money(r.net_effect),
    경고: r.warnings.join(" / "),
  }));
  const applicationStrategyEntries = Object.entries(derived.strategy || {});
  const agentReasons =
    Array.isArray(derived.agent?.reasons) && derived.agent.reasons.length
      ? derived.agent.reasons
      : (derived.agent?.actions || [])
          .map((a) => `${a.액션} — ${a.이유}`)
          .filter(Boolean);
  const taskStatusText = { todo: "준비 전", planned: "예정", done: "완료" };

  return (
    <div className="app-shell">

      <nav className="tabs" aria-label="LifePass 화면 탭">
        {TABS.map((tab, idx) => (
          <button
            key={tab}
            type="button"
            className={activeTab === idx ? "active" : ""}
            onClick={() => setActiveTab(idx)}
          >
            {tab}
          </button>
        ))}
      </nav>

      {activeTab === 0 && (
        <main className="landing-screen">
          <section className="landing-hero">
            <div className="landing-copy">
              <div className="eyebrow">LifePass AI · 복지 혜택 최대화 플랫폼</div>
              <h1>
                내 상황과 정책·법령 데이터를 한 번에 연결해 받을 수 있는 혜택을
                찾아냅니다
              </h1>
              <p>
                문서에서 사용자 조건을 읽고, 공식 정책 API와 국가법령정보센터
                데이터를 수집·저장한 뒤, 현재 신청 가능성·복지절벽·신청 준비
                순서를 한 화면에서 정리합니다.
              </p>
            </div>
            <div className="landing-orbit" aria-hidden="true">
              <div className="orbit-card card-a">정책 혜택</div>
              <div className="orbit-card card-b">법령 근거</div>
              <div className="orbit-core">LifePass AI</div>
            </div>
          </section>

          <section className="feature-grid">
            <article className="feature-card gradient-blue">
              <span>01</span>
              <h3>문서 기반 내 조건 추출</h3>
              <p>
                상담 메모, 임대차계약 정보, 소득·주거 상황 등을 읽어
                나이·지역·소득·월세 기준으로 정리합니다.
              </p>
            </article>
            <article className="feature-card gradient-purple">
              <span>02</span>
              <h3>정책·법령 자동 수집</h3>
              <p>
                복지로, 정부24, 청년정책 API와 국가법령정보센터 법령 데이터를
                함께 수집하여 최적의 혜택 조합을 제공합니다.
              </p>
            </article>
            <article className="feature-card gradient-orange">
              <span>03</span>
              <h3>복지절벽 시뮬레이션</h3>
              <p>
                소득이 생기거나 가구 조건이 바뀔 때, 상실·신규 혜택과 신청 순서
                조정 필요성을 미리 보여줍니다.
              </p>
            </article>
          </section>

          <section className="dashboard-strip">
            <Metric
              label="매칭 정책"
              value={`${benefits.length}개`}
              note={
                usingFallbackPolicies
                  ? "데모 정책 기준"
                  : usingPendingCollectedPolicies
                    ? "수집 후보 정책 기준"
                    : "승인 정책 기준"
              }
            />
            <Metric
              label="법령 근거"
              value={`${legalReferences.length}건`}
              note="승인된 법령 데이터"
            />
            <Metric
              label="최적 조합"
              value={`${derived.plan.selected.length}개`}
              note={money(derived.plan.total_monthly_value)}
            />
            <Metric
              label="확인 우선도"
              value={`${derived.agent.priority_score}점`}
              note={derived.agent.priority_grade}
            />
          </section>
          <ExplanationDetails>
            <SimpleTable
              rows={[
                {
                  항목: "매칭 정책",
                  현재값: `${benefits.length}개`,
                  의미: "현재 사용자 조건과 비교하는 정책 수입니다.",
                  결과해석: usingFallbackPolicies
                    ? "공식 수집 정책이 없어 내장 데모 정책으로 판정 중입니다."
                    : "공식 API 또는 수집 후보에서 가져온 정책으로 판정 중입니다.",
                },
                {
                  항목: "법령 근거",
                  현재값: `${legalReferences.length}건`,
                  의미: "혜택 판정의 배경 설명에 참고할 수 있는 승인된 법령 데이터 수입니다.",
                  결과해석: "법령 근거는 직접 혜택으로 추천하지 않고 정책 판단 근거로 분리합니다.",
                },
                {
                  항목: "최적 조합",
                  현재값: `${derived.plan.selected.length}개`,
                  의미: "현재 받을 가능성이 있는 혜택 중 중복·충돌을 제거하고 남긴 추천 조합입니다.",
                  결과해석: `월 환산효과는 ${money(derived.plan.total_monthly_value)}입니다.`,
                },
                {
                  항목: "확인 우선도",
                  현재값: `${derived.agent.priority_score}점`,
                  의미: "소득 공백, 실업급여 종료, 주거비 부담, 혜택 상실 가능성 등을 합산한 추가 확인 필요도입니다.",
                  결과해석: derived.agent.priority_grade,
                },
              ]}
            />
            <h4>확인 우선도 점수대</h4>
            <SimpleTable rows={CONFIRM_PRIORITY_GUIDE} />
          </ExplanationDetails>
        </main>
      )}

      {activeTab === 1 && (
        <main className="tab-panel">
          <Section
            title="내 정보 불러오기"
            subtitle="나이, 거주지역, 소득, 월세 같은 정보를 입력하면 받을 수 있는 복지 혜택을 안내해 드립니다."
          >
            <div className="two-col">
              <div className="input-path-card">
                <h3>내 상황 직접 입력하기</h3>
                <p className="muted">
                  나이, 거주지, 소득, 월세 등 본인의 상황을 자유롭게 적어
                  주세요.
                </p>
                <textarea
                  placeholder="예: 만 28세, 서울에서 혼자 자취 중입니다. 3개월 전 퇴사해서 실업급여를 받고 있고 잔여일이 40일 남았습니다. 월세 45만원, 보증금 3000만원이고..."
                  value={onboardingText}
                  onChange={(e) => {
                    setOnboardingText(e.target.value);
                    setOnboardingParsed(false);
                  }}
                />
                <button
                  className="primary"
                  onClick={handleOnboardingText}
                  disabled={!onboardingText.trim()}
                >
                  내 정보 분석하기
                </button>
                {onboardingParsed && (
                  <p className="status-line">
                    입력하신 내용에서 정보를 읽어왔습니다. 아래에서 확인해
                    주세요.
                  </p>
                )}
              </div>
              <div className="input-path-card">
                <h3>문서 파일로 입력하기</h3>
                <p className="muted">
                  어떤 정보를 입력해야 할지 모르겠다면, 양식을 다운받아 채운 뒤
                  업로드해 주세요.
                </p>
                <a
                  className="primary template-download"
                  href="/Template.docx"
                  download
                >
                  양식 다운로드
                </a>
                <input
                  className="file-input"
                  type="file"
                  accept=".pdf,.docx,.hwp,.hwpx,.owpml,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.txt,.md,.csv,.json"
                  onChange={handleDocument}
                />
                <p className="muted">
                  ※ 양식을 작성하신 후 PDF로 변환하여 업로드해 주세요.
                </p>
                {docLoading && (
                  <p className="status-line">
                    문서를 읽고 있습니다. 큰 이미지나 PDF는 잠시 시간이 걸릴 수
                    있습니다.
                  </p>
                )}
                {docError && <p className="error-line">{docError}</p>}
              </div>
            </div>
          </Section>

          {onboardingParsed && !docResult && (
            <Section
              title="읽어낸 정보 확인하기"
              subtitle="입력하신 내용에서 아래 정보를 추출했습니다. 틀린 부분이 있으면 직접 수정해 주세요."
            >
              <ProfileEditor profile={profile} onChange={setProfile} />
            </Section>
          )}

          {docResult && (
            <Section
              title="읽어낸 정보 확인하기"
              subtitle={`파일: ${docResult.file?.name}`}
            >
              <div className="metrics-row">
                <Metric
                  label="추출 근거"
                  value={`${docResult.evidence?.length || 0}개`}
                />
                <Metric
                  label="검증 이슈"
                  value={`${docResult.validation?.issues?.length || 0}개`}
                />
                <Metric
                  label="원문 길이"
                  value={`${docResult.text?.length || 0}자`}
                />
                <Metric
                  label="문서 유형"
                  value={
                    docResult.documentKind === "policy_notice"
                      ? "정책 공고"
                      : "신청자 문서"
                  }
                />
              </div>
              <ExplanationDetails>
                <SimpleTable
                  rows={[
                    {
                      항목: "추출 근거",
                      현재값: `${docResult.evidence?.length || 0}개`,
                      의미: "문서나 입력문에서 실제 프로필 필드로 변환한 근거 개수입니다.",
                      결과해석: "개수가 많을수록 자동으로 채운 항목이 많지만, 최종 신청 전에는 사용자가 직접 확인해야 합니다.",
                    },
                    {
                      항목: "검증 이슈",
                      현재값: `${docResult.validation?.issues?.length || 0}개`,
                      의미: "나이·소득·월세 등 입력값이 비어 있거나 모순될 때 발생하는 확인 항목입니다.",
                      결과해석: "0개가 아니면 아래 확인·수정란에서 값을 보완하는 것이 좋습니다.",
                    },
                    {
                      항목: "원문 길이",
                      현재값: `${docResult.text?.length || 0}자`,
                      의미: "파일에서 읽어낸 텍스트 양입니다.",
                      결과해석: "너무 짧으면 PDF 스캔본·이미지 품질 문제로 일부 항목이 누락됐을 수 있습니다.",
                    },
                    {
                      항목: "문서 유형",
                      현재값: docResult.documentKind === "policy_notice" ? "정책 공고" : "신청자 문서",
                      의미: "정책 기준을 담은 문서인지, 사용자의 조건을 담은 문서인지 구분한 결과입니다.",
                      결과해석: "정책 공고는 프로필을 자동 변경하지 않고 조건 추출 참고용으로만 사용합니다.",
                    },
                  ]}
                />
              </ExplanationDetails>
              {!!docResult.parserWarnings?.length && (
                <div className="warn-box">
                  {docResult.parserWarnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </div>
              )}
              {docResult.documentKind === "policy_notice" &&
                docResult.policySignals && (
                  <div className="info-box">
                    <strong>정책 문서 추출 결과</strong>
                    <SimpleTable
                      rows={[
                        {
                          항목: "정책명/제목",
                          값: docResult.policySignals.title,
                        },
                        {
                          항목: "지역 언급",
                          값:
                            docResult.policySignals.regions?.join(", ") ||
                            "전국/미확인",
                        },
                        {
                          항목: "연령 기준",
                          값: docResult.policySignals.age_range
                            ? `${docResult.policySignals.age_range[0]}~${docResult.policySignals.age_range[1]}세`
                            : "미확인",
                        },
                        {
                          항목: "월세 기준",
                          값: docResult.policySignals.rent_cap
                            ? money(docResult.policySignals.rent_cap)
                            : "미확인",
                        },
                        {
                          항목: "보증금 기준",
                          값: docResult.policySignals.deposit_cap
                            ? money(docResult.policySignals.deposit_cap)
                            : "미확인",
                        },
                        {
                          항목: "지원금",
                          값: docResult.policySignals.support_amount
                            ? money(docResult.policySignals.support_amount)
                            : "미확인",
                        },
                        {
                          항목: "소득 기준",
                          값: docResult.policySignals.income_percent_criteria
                            ?.length
                            ? docResult.policySignals.income_percent_criteria
                                .map((x) => `중위소득 ${x}% 이하`)
                                .join(", ")
                            : "미확인",
                        },
                        {
                          항목: "필요서류",
                          값:
                            docResult.policySignals.required_docs?.join(", ") ||
                            "미확인",
                        },
                        {
                          항목: "신청방법",
                          값:
                            docResult.policySignals.application_methods?.join(
                              ", ",
                            ) || "미확인",
                        },
                      ]}
                    />
                    <p className="muted">
                      정책 문서는 사용자 개인정보가 아니므로 현재 프로필을 자동
                      변경하지 않습니다. 정책 기준은 카탈로그 갱신이나 상담 근거
                      확인에 사용하세요.
                    </p>
                  </div>
                )}
              <div className="two-col">
                <div>
                  <h3>추출 근거</h3>
                  <SimpleTable
                    rows={(docResult.evidence || []).map((e) => ({
                      필드: e.label,
                      값: valueText(e.value),
                      근거: e.source,
                      신뢰도: Math.round(e.confidence * 100) + "%",
                    }))}
                  />
                  <h3>검증 체크리스트</h3>
                  <SimpleTable
                    rows={verificationChecklist.map((x) => ({
                      항목: x.item,
                      상태: x.status,
                      이유: x.reason,
                    }))}
                  />
                </div>
                <div>
                  <h3>내 정보 확인·수정하기</h3>
                  <ProfileEditor profile={profile} onChange={setProfile} />
                </div>
              </div>
              {docResult.validation?.issues?.length > 0 && (
                <div className="warn-box">
                  <strong>확인 필요:</strong>
                  <ul>
                    {docResult.validation.issues.map((issue, idx) => (
                      <li key={idx}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}
              <details>
                <summary>원문 추출 결과 보기</summary>
                <pre className="raw-text">{docResult.text}</pre>
              </details>
            </Section>
          )}

          <Section
            title="CSV 일괄 분석(기관용)"
            subtitle="다수의 사용자 데이터가 정리된 csv 파일을 업로드하여 일괄 분석합니다."
          >
            <input
              className="file-input"
              type="file"
              accept=".csv"
              onChange={handleBatchCsv}
            />
            {batchRows.length > 0 && (
              <>
                <div className="metrics-row">
                  <Metric label="매핑 사용자" value={`${batchRows.length}명`} />
                  <Metric
                    label="Schema coverage"
                    value={`${Math.round(buildSchemaMap(Object.keys(batchRows[0].original)).coverage * 100)}%`}
                  />
                </div>
                <SimpleTable rows={batchAnalysis} limit={8} />
              </>
            )}
          </Section>
        </main>
      )}

      {activeTab === 2 && (
        <main className="tab-panel">
          <Section
            title="현재 받을 수 있는 혜택"
            subtitle="입력한 정보를 등록된 정책 조건과 비교해 지금 신청 가능성이 높은 혜택을 보여줍니다."
          >
            <div className="metrics-row">
              <Metric
                label="정책 출처"
                value={policySourceValue || "출처 미상"}
                note={
                  usingFallbackPolicies
                    ? "수집 정책 후보도 없을 때만 사용"
                    : usingPendingCollectedPolicies
                      ? `${activeExternalPolicies.length}개 수집 후보 포함`
                      : `${activeExternalPolicies.length}개 승인 정책 기준`
                }
              />
              <Metric
                label="가능 혜택"
                value={`${derived.evaluations.filter((e) => e.eligible).length}개`}
              />
              <Metric
                label="최적 선택"
                value={`${derived.plan.selected.length}개`}
              />
              <Metric
                label="월 환산효과"
                value={money(derived.plan.total_monthly_value)}
              />
              <Metric
                label="혜택 간 충돌"
                value={derived.portfolio.conflict_free ? "없음" : "있음"}
              />
            </div>
            <ExplanationDetails>
              <SimpleTable
                rows={[
                  {
                    항목: "정책 출처",
                    현재값: policySourceValue || "출처 미상",
                    의미: "현재 판정에 사용한 정책 데이터의 출처입니다.",
                    결과해석: usingFallbackPolicies
                      ? "공식 API 수집 정책이 없어 데모 정책으로 표시됩니다."
                      : "여러 사이트에서 수집되면 출처명이 여러 개로 집계됩니다.",
                  },
                  {
                    항목: "가능 혜택",
                    현재값: `${derived.evaluations.filter((e) => e.eligible).length}개`,
                    의미: "현재 입력 정보가 정책 조건을 통과한 혜택 수입니다.",
                    결과해석: "실제 지급 확정이 아니라 신청 가능성이 높은 후보입니다.",
                  },
                  {
                    항목: "최적 선택",
                    현재값: `${derived.plan.selected.length}개`,
                    의미: "가능 혜택 중 중복 수급 제한과 충돌을 고려해 우선 추천한 조합입니다.",
                    결과해석: "월 환산효과와 중요도를 함께 보되, 금액 효과가 더 크게 작용합니다.",
                  },
                  {
                    항목: "월 환산효과",
                    현재값: money(derived.plan.total_monthly_value),
                    의미: "선택된 혜택을 월 단위 금액으로 환산해 합산한 값입니다.",
                    결과해석: "일시금·연간 지원은 월평균처럼 단순 환산하고, 융자·보증의 원금 한도는 실제 지급 현금이 아니므로 월 환산효과에서 제외합니다.",
                  },
                  {
                    항목: "혜택 간 충돌",
                    현재값: derived.portfolio.conflict_free ? "없음" : "있음",
                    의미: "동일 성격 혜택의 중복수급 제한이나 직접 충돌 조건이 있는지 본 결과입니다.",
                    결과해석: "없음이면 현재 선택 조합 안에서는 충돌을 찾지 못했다는 뜻입니다.",
                  },
                ]}
              />
              <h4>출처별 포함 정책 수</h4>
              <SimpleTable rows={policySourceBreakdown} />
              <h4>중요도 점수대</h4>
              <SimpleTable rows={POLICY_PRIORITY_GUIDE} />
            </ExplanationDetails>
            <div className="selected-list">
              {derived.plan.selected.map((b) => (
                <article key={b.benefit_id} className="benefit-card">
                  <div className="card-top">
                    <Badge tone="good">선택</Badge>
                    <strong>{b.name}</strong>
                  </div>
                  <p>{b.description}</p>
                  <p className="benefit-meta">
                    <b>{money(b.monthly_value)}</b> · {b.domain} · 중요도 {importanceText(b.priority)} · 출처 {sourceLabelOf(b, usingFallbackPolicies ? "데모 정책" : "출처 미상")}
                  </p>
                  <p className="link-line">
                    신청·안내 <LinkNotice item={b} />
                  </p>
                </article>
              ))}
            </div>
            <h3>전체 룰 판정표</h3>
            <SimpleTable rows={eligibleRows} />
          </Section>

          <Section
            title="동시에 받기 어려운 혜택 확인"
            subtitle="같은 성격의 혜택을 중복으로 받을 수 없는 경우, 더 유리한 조합을 우선 보여줍니다."
          >
            <ul className="clean-list">
              {derived.plan.explanation.map((line, idx) => (
                <li key={idx}>{line}</li>
              ))}
            </ul>
            <SimpleTable
              rows={(derived.plan.conflict_details || []).map((detail) => ({
                제외혜택: detail.benefit_name,
                충돌대상: detail.blockers.map((b) => b.name).join(', ') || '선택된 혜택',
                정확한사유: detail.reason,
                금액비교: detail.comparison,
              }))}
            />
          </Section>
        </main>
      )}

      {activeTab === 3 && (
        <main className="tab-panel">
          <Section
            title="생애전환·복지절벽 시뮬레이션"
            subtitle="실업급여 종료, 소득 발생, 소득 구간 변화에 따라 혜택 신규/상실을 보여주는 LifePass의 핵심 차별점입니다."
          >
            <div className="metrics-row">
              <Metric
                label="현재 순효과"
                value={money(derived.timeline[0]?.net_effect || 0)}
              />
              <Metric
                label="3개월 후 순효과"
                value={money(
                  derived.timeline.find((x) => x.month === 3)?.net_effect || 0,
                )}
              />
              <Metric label="이벤트" value={`${derived.events.length}개`} />
            </div>
            <ExplanationDetails>
              <SimpleTable
                rows={[
                  {
                    항목: "현재 순효과",
                    현재값: money(derived.timeline[0]?.net_effect || 0),
                    의미: "현재 월소득과 선택 혜택 월환산효과에서 월세·대출상환액을 뺀 추정 여유액입니다.",
                    결과해석: "생활 여력을 빠르게 비교하기 위한 시뮬레이션 값입니다.",
                  },
                  {
                    항목: "3개월 후 순효과",
                    현재값: money(derived.timeline.find((x) => x.month === 3)?.net_effect || 0),
                    의미: "예상 소득 발생·실업급여 종료 등 3개월 뒤 조건 변화를 반영한 추정값입니다.",
                    결과해석: "현재보다 낮아지면 복지절벽 또는 소득 공백 위험을 확인해야 합니다.",
                  },
                  {
                    항목: "이벤트",
                    현재값: `${derived.events.length}개`,
                    의미: "앞으로 신규 가능, 상실 위험, 재점검 필요 등으로 표시한 변화 알림 수입니다.",
                    결과해석: "이벤트가 많을수록 시간에 따른 자격 변동을 더 자주 확인해야 합니다.",
                  },
                ]}
              />
            </ExplanationDetails>
            <h3>시간축 변화</h3>
            <SimpleTable rows={timelineRows} />
            <h3>소득별 복지절벽</h3>
            <SimpleTable rows={cliffRows} />
          </Section>

          <Section
            title="예상 시나리오 비교"
            subtitle="같은 사용자가 다른 선택/상황을 맞았을 때 월환산효과가 어떻게 바뀌는지 비교합니다."
          >
            <SimpleTable
              rows={derived.counterfactuals.map((r) => ({
                시나리오: r.scenario,
                월환산효과: money(r.월환산효과),
                변화: r.delta_label,
                선택혜택: r.selected,
              }))}
            />
          </Section>
        </main>
      )}

      {activeTab === 4 && (
        <main className="tab-panel">
          <Section
            title="신청 준비하기"
            subtitle="받을 가능성이 높은 혜택부터 서류 준비, 신청, 결과 확인 순서로 정리합니다."
          >
            <div className="metrics-row">
              <Metric
                label="준비할 일"
                value={`${derived.workflow.tasks.length}개`}
              />
              <Metric
                label="알림 예정"
                value={`${derived.notifications.length}개`}
              />
            </div>
            <ExplanationDetails>
              <SimpleTable
                rows={[
                  
                  {
                    항목: "준비할 일",
                    현재값: `${derived.workflow.tasks.length}개`,
                    의미: "서류 준비, 신청, 결과 확인처럼 사용자가 처리해야 할 작업 수입니다.",
                    결과해석: "개수가 많으면 우선순위가 높은 혜택부터 처리하는 것이 좋습니다.",
                  },
                  {
                    항목: "알림 예정",
                    현재값: `${derived.notifications.length}개`,
                    의미: "마감일이나 재확인 시점에 맞춰 알려줘야 할 일정 수입니다.",
                    결과해석: "실제 알림 기능과 연결하려면 캘린더·푸시 알림 연동이 추가로 필요합니다.",
                  },
                ]}
              />
            </ExplanationDetails>
            <h3>먼저 할 일</h3>
            <SimpleTable
              rows={derived.workflow.tasks.map((t) => ({
                혜택: t.benefit,
                할일: t.task,
                기한: t.due,
                상태: taskStatusText[t.status] || t.status,
              }))}
            />
            <h3>혜택별 준비 방법</h3>
            {applicationStrategyEntries.map(([benefit, items]) => (
              <div className="check-block" key={benefit}>
                <strong>{benefit}</strong>
                <ul>
                  {items.map((item, idx) => (
                    <li key={idx}><LinkText text={item} /></li>
                  ))}
                </ul>
              </div>
            ))}
          </Section>

          <Section
            title="추가 확인이 필요한 부분"
            subtitle="입력한 정보만으로 자동 판단하기 어려운 부분이 있으면 여기에서 확인할 수 있습니다."
          >
            <div className="metrics-row">
              <Metric
                label="확인 우선도"
                value={`${derived.agent.priority_score}점`}
              />
              <Metric label="상태" value={derived.agent.priority_grade} />
              <Metric
                label="상담사 확인"
                value={
                  derived.agentWorkflow.human_review_required ? "권장" : "선택"
                }
              />
            </div>
            <ExplanationDetails>
              <SimpleTable
                rows={[
                  {
                    항목: "확인 우선도",
                    현재값: `${derived.agent.priority_score}점`,
                    의미: "현재 상황에서 추가 확인이 얼마나 필요한지 나타내는 점수입니다.",
                    결과해석: derived.agent.priority_grade,
                  },
                  {
                    항목: "상태",
                    현재값: derived.agent.priority_grade,
                    의미: "확인 우선도 점수를 안정·주의·긴급으로 번역한 상태입니다.",
                    결과해석: "주의 이상이면 입력값, 원문 공고, 제출 서류를 다시 확인하는 것이 좋습니다.",
                  },
                  {
                    항목: "상담사 확인",
                    현재값: derived.agentWorkflow.human_review_required ? "권장" : "선택",
                    의미: "자동 판정만으로 부족할 수 있어 사람이 검토해야 하는지 나타냅니다.",
                    결과해석: "권장이면 법령·최신 공고·중복수급 여부를 추가 확인하세요.",
                  },
                ]}
              />
              <h4>확인 우선도 점수대</h4>
              <SimpleTable rows={CONFIRM_PRIORITY_GUIDE} />
            </ExplanationDetails>
            <ul className="clean-list">
              {agentReasons.map((r, idx) => (
                <li key={idx}>{r}</li>
              ))}
            </ul>
          </Section>
        </main>
      )}

      {activeTab === 5 && (
        <main className="tab-panel">
          <Section
            title="판정 근거 확인하기"
            subtitle="어떤 조건 때문에 가능 또는 불가능으로 판단했는지 확인할 수 있습니다."
            right={
              <button className="primary" onClick={exportReport}>
                리포트 저장
              </button>
            }
          >
            <div className="metrics-row">
              <Metric
                label="판정점수"
                value={`${derived.audit.audit_score}점`}
              />
              <Metric label="상태" value={derived.audit.status} />
              <Metric
                label="검증 경고"
                value={`${derived.validationWarnings.length}개`}
              />
            </div>
            <ExplanationDetails>
              <SimpleTable
                rows={[
                  {
                    항목: "판정점수",
                    현재값: `${derived.audit.audit_score}점`,
                    의미: "조건 확인, 중복 신청 가능성, 상담사 확인 필요 여부, 개인정보 최소 사용, 판정 근거 제공 상태를 종합한 신뢰 점수입니다.",
                    결과해석: derived.audit.status,
                  },
                  {
                    항목: "상태",
                    현재값: derived.audit.status,
                    의미: "판정점수를 사람이 이해하기 쉽게 바꾼 결과입니다.",
                    결과해석: "추가 확인 필요이면 자동 판정 결과를 그대로 확정하지 말고 근거를 확인하세요.",
                  },
                  {
                    항목: "검증 경고",
                    현재값: `${derived.validationWarnings.length}개`,
                    의미: "프로필 입력값에 누락·비정상 값이 있을 때 표시되는 경고 수입니다.",
                    결과해석: "0개가 아니면 내 정보 불러오기 탭에서 값을 보완하세요.",
                  },
                ]}
              />
              <h4>판정점수 점수대</h4>
              <SimpleTable rows={AUDIT_SCORE_GUIDE} />
            </ExplanationDetails>
            <h3>법령 근거는 무엇을 설명하나</h3>
            <div className="info-box">
              <strong>법령 근거는 직접 지급되는 혜택이 아니라, 추천된 정책 판단의 공식 배경입니다.</strong>
              <p>
                예를 들어 주거 지원 정책은 주거급여·공공주택·임대차 관련 법령과 연결될 수 있고,
                고용 지원 정책은 고용보험·국민취업지원·직업훈련 관련 법령과 연결될 수 있습니다.
                따라서 법령 데이터는 “이 혜택을 받을 수 있다”는 계산값이 아니라
                “그 판단이 어떤 제도적 근거 위에 있는지”를 설명하는 자료입니다.
              </p>
            </div>
            <ExplanationDetails title="법령 근거를 사용자가 알아야 하는 이유">
              <SimpleTable rows={LEGAL_BASIS_GUIDE} />
            </ExplanationDetails>
            <SimpleTable
              rows={legalBasisRows.length ? legalBasisRows.slice(0, 6) : [
                {
                  법령명: "승인된 법령 근거 없음",
                  소관부처: "-",
                  근거가되는대상: "LAW_OPEN_API_OC 설정 후 법령 후보를 수집·승인하면 표시됩니다.",
                  근거역할: "현재는 정책 추천의 상위 법령 근거를 화면에 연결할 수 없습니다.",
                  사용자가알아야하는이유: "법령 근거가 없으면 최신 공고와 접수 기관 안내를 별도로 확인해야 합니다.",
                  근거링크: "-",
                },
              ]}
            />
            <h3>안전 확인 항목</h3>
            <SimpleTable
              rows={derived.audit.controls.map((c) => ({
                통제항목: c.control,
                상태: c.status,
                근거: c.evidence,
              }))}
            />
            <h3>판정 과정 요약</h3>
            <SimpleTable
              rows={derived.agentWorkflow.steps.map((s) => ({
                단계: s.step,
                노드: s.node,
                작업: s.action,
                결과: s.result,
              }))}
            />
          </Section>

          <Section
            title="정책 수집 관리"
            subtitle="공식 API로 수집한 정책 후보를 검수하고 승인하는 운영자용 화면입니다. 실제 운영에서는 백엔드 서버와 관리자 토큰을 반드시 설정해야 합니다."
          >
            <div className="metrics-row">
              <Metric
                label="수집 소스"
                value={`${policyAdmin.sources.length}개`}
                note={`${policyAdmin.enabled.length}개 활성`}
              />
              <Metric
                label="검수 대기"
                value={`${policyAdmin.drafts.length}건`}
              />
              <Metric
                label="승인 정책"
                value={`${policyAdmin.policies.length}건`}
              />
              <Metric label="법령 근거" value={`${legalReferences.length}건`} />
              <Metric
                label="서버 상태"
                value={
                  policyAdminMessage &&
                  policyAdminMessage.includes("연결할 수 없습니다")
                    ? "확인 필요"
                    : "연결 시도"
                }
              />
            </div>
            <ExplanationDetails>
              <SimpleTable
                rows={[
                  {
                    항목: "수집 소스",
                    현재값: `${policyAdmin.sources.length}개`,
                    의미: "서버에 등록된 공식 API·보조 수집 출처 전체 개수입니다.",
                    결과해석: `${policyAdmin.enabled.length}개가 현재 활성화되어 있습니다.`,
                  },
                  {
                    항목: "검수 대기",
                    현재값: `${policyAdmin.drafts.length}건`,
                    의미: "수집됐지만 운영자가 승인 또는 반려하지 않은 정책 후보 수입니다.",
                    결과해석: "후보 정책은 실제 운영 전 원문과 조건을 검수해야 합니다.",
                  },
                  {
                    항목: "승인 정책",
                    현재값: `${policyAdmin.policies.length}건`,
                    의미: "검수 후 실제 판정 카탈로그에 들어간 정책 수입니다.",
                    결과해석: "승인 정책이 있으면 데모 정책보다 우선 사용됩니다.",
                  },
                  {
                    항목: "법령 근거",
                    현재값: `${legalReferences.length}건`,
                    의미: "정책의 자격 기준·급여 기준·집행기관 권한이 어떤 법률 또는 조문에서 비롯되는지 설명하는 근거 데이터입니다.",
                    결과해석: "법령은 직접 받을 수 있는 혜택이 아니므로 혜택 목록에서는 제외하고, 어떤 정책 판단의 근거인지 연결해 표시합니다.",
                  },
                  {
                    항목: "서버 상태",
                    현재값: policyAdminMessage && policyAdminMessage.includes("연결할 수 없습니다") ? "확인 필요" : "연결 시도",
                    의미: "프론트엔드가 백엔드 정책 수집 API에 접근할 수 있는지의 상태입니다.",
                    결과해석: "확인 필요이면 npm run server 실행 여부와 .env 설정을 확인하세요.",
                  },
                ]}
              />
              <h4>중요도 점수대</h4>
              <SimpleTable rows={POLICY_PRIORITY_GUIDE} />
            </ExplanationDetails>
            <div className="admin-token-row">
              <label>
                <span>관리자 토큰</span>
                <input
                  type="password"
                  value={adminToken}
                  onChange={(e) => saveAdminToken(e.target.value)}
                  placeholder=".env의 LIFEPASS_ADMIN_TOKEN 입력"
                />
              </label>
              <p className="muted">
                토큰은 이 브라우저에만 저장되며, 관리자 API 호출 시
                x-admin-token 헤더로 전송됩니다.
              </p>
            </div>
            <button
              className="primary"
              onClick={loadPolicyAdmin}
              disabled={policyAdminLoading}
            >
              상태 새로고침
            </button>
            <button
              className="primary secondary-action"
              onClick={runPolicyIngestion}
              disabled={policyAdminLoading}
            >
              공식 API 정책 수집 실행
            </button>
            {policyAdminMessage && (
              <div
                className={
                  policyAdminMessage.includes("실패") ||
                  policyAdminMessage.includes("연결할 수 없습니다")
                    ? "warn-box"
                    : "info-box"
                }
              >
                {policyAdminMessage}
              </div>
            )}
            <h3>수집 소스</h3>
            <SimpleTable
              rows={policyAdmin.sources.map((s) => ({
                소스: s.label,
                방식:
                  s.strategy === "official_api"
                    ? "공식 API"
                    : "허용 URL 보조 수집",
                중요도: importanceText(s.priority),
                상태: policyAdmin.enabled.includes(s.id) ? "활성" : "비활성",
                승인정책: policyAdmin.policies.filter((p) => (p.source?.id || p.source_id) === s.id).length,
                검수대기: policyAdmin.drafts.filter((d) => (d.source?.id || d.source_id) === s.id && d.status === "pending_review").length,
                설명: s.note,
              }))}
            />
            <h3>승인된 법령 근거</h3>
            <div className="info-box">
              <strong>어디서 어떤 것의 근거가 되는가?</strong>
              <p>
                아래 법령은 국가법령정보센터 등 공식 출처에서 수집한 데이터입니다.
                각 법령은 특정 혜택의 신청 버튼이 아니라, 주거·고용·생계·의료·교육 같은 정책 분야의
                대상자 기준, 지원 범위, 행정기관 권한을 설명하는 근거로 사용됩니다.
              </p>
              <p className="muted">
                사용자는 이 정보를 통해 “왜 내가 대상인지”, “어떤 기준 때문에 제외될 수 있는지”,
                “상담·문의·이의제기 때 어떤 원문을 확인해야 하는지”를 알 수 있습니다.
              </p>
            </div>
            {legalReferences.length === 0 ? (
              <p className="muted">
                승인된 법령 데이터가 없습니다. LAW_OPEN_API_OC를 설정한 뒤
                수집하고 법령 후보를 승인하세요.
              </p>
            ) : (
              <SimpleTable rows={legalBasisRows.slice(0, 10)} />
            )}
            <h3>검수 대기 정책 후보</h3>
            {policyAdmin.drafts.length === 0 ? (
              <p className="muted">
                검수 대기 중인 정책 후보가 없습니다. API 키와 엔드포인트를
                설정한 뒤 수집을 실행하세요.
              </p>
            ) : (
              <div className="trace-list">
                {policyAdmin.drafts.slice(0, 6).map((draft) => (
                  <details key={draft.id}>
                    <summary>{draft.benefit?.name || draft.id}</summary>
                    <SimpleTable
                      rows={[
                        {
                          항목: "출처",
                          값: draft.source?.label || draft.source?.id,
                        },
                        {
                          항목: "사용자용 링크",
                          값: linkCellFor({ ...draft.benefit, source: draft.source }),
                        },
                        {
                          항목: "링크 상태",
                          값: draft.benefit?.link_reason || draft.benefit?.link_status || '확인 필요',
                        },
                        { 항목: "변경유형", 값: draft.change_type || "new" },
                        {
                          항목: "지원금",
                          값: draft.benefit?.estimated_monthly_value
                            ? money(draft.benefit.estimated_monthly_value)
                            : "확인 필요",
                        },
                        {
                          항목: "검수 사유",
                          값:
                            draft.ingestion?.review_reasons?.join(", ") ||
                            "확인 필요",
                        },
                      ]}
                    />
                    <button
                      className="primary"
                      onClick={() => reviewPolicyDraft(draft.id, "approve")}
                      disabled={policyAdminLoading}
                    >
                      승인
                    </button>
                    <button
                      className="primary danger-action"
                      onClick={() => reviewPolicyDraft(draft.id, "reject")}
                      disabled={policyAdminLoading}
                    >
                      반려
                    </button>
                  </details>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="판정 근거 상세"
            subtitle="사용자에게 왜 가능/불가능한지 조건 단위로 설명할 수 있습니다."
          >
            <div className="trace-list">
              {derived.evaluations.slice(0, 8).map((ev) => (
                <details key={ev.benefit_id}>
                  <summary>
                    {ev.eligible ? "✅" : "❌"} {ev.name}
                  </summary>
                  <SimpleTable
                    rows={ev.trace.map((t) => ({
                      조건: t.label,
                      통과: t.passed ? "Y" : "N",
                      상세: t.detail,
                    }))}
                    limit={20}
                  />
                </details>
              ))}
            </div>
          </Section>
        </main>
      )}
    </div>
  );
}
