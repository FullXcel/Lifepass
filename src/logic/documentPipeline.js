import {
  asProfile,
  DEFAULT_PROFILE,
  normalizeProfile,
  parseOnboardingText,
  validateProfile,
  REGIONS,
  EMPLOYMENT_STATUSES,
  numberInput,
} from './lifepassCore.js';

const FIELD_LABELS = {
  age: '나이(만 나이 기준)',
  region: '지역',
  district: '시군구',
  household_size: '가구원 수',
  employment_status: '고용상태',
  monthly_income: '현재 월소득',
  expected_monthly_income: '예상 월소득',
  expected_income_start_month: '예상 소득 시작 시점(몇 개월 뒤)',
  rent: '월세',
  deposit: '보증금',
  assets_million: '자산(백만원)',
  unemployment_benefit_receiving: '실업급여 수급 여부',
  unemployment_benefit_days_left: '실업급여 잔여일',
  crisis_event: '긴급 위기 상황 해당 여부',
  medical_expense_3m: '최근 3개월 의료비',
  credit_score: '신용점수',
  debt_monthly_payment: '월 대출상환액',
  is_basic_livelihood: '기초생활수급',
  is_near_poverty: '차상위',
  has_housing_contract: '임대차계약 여부',
  wants_job_training: '직업훈련 희망',
};


const FIELD_HELP_TEXT = {
  expected_income_start_month: '앞으로 알바·취업·사업소득 등이 생길 예정이면 “몇 개월 뒤부터 생기는지”를 적는 항목입니다. 예: 3 = 3개월 뒤부터 예상 월소득 반영',
  crisis_event: '긴급복지·생계지원처럼 갑작스러운 실직, 연체, 생계곤란, 주거 위기 등이 있는지 묻는 항목입니다. 사유를 길게 쓰는 칸이 아니라 해당 여부를 예/아니오로 먼저 표시합니다.',
};

const HEADER_ALIASES = {
  name: ['name', '이름', '성명', '사용자', '대상자명'],
  age: ['age', '나이', '연령', '만나이', '만 나이'],
  region: ['region', '지역', '주소지', '거주지', '시도', '광역시도'],
  district: ['district', '시군구', '구', '군', '동네'],
  household_size: ['household_size', '가구원수', '가구원 수', '가구수', '1인가구', '인 가구'],
  employment_status: ['employment_status', '고용상태', '취업상태', '근로상태', '직업상태'],
  monthly_income: ['monthly_income', '월소득', '소득', '월 수입', '월급', '근로소득'],
  expected_monthly_income: ['expected_monthly_income', '예상소득', '예상 월소득', '예정 소득'],
  expected_income_start_month: ['expected_income_start_month', '예상소득시작월', '예상 소득 시작 시점', '예상 소득 발생 월', '소득발생월', '취업예정개월', '몇개월뒤', '몇 개월 뒤'],
  rent: ['rent', '월세', '임대료', '월 임대료'],
  deposit: ['deposit', '보증금', '임대보증금'],
  assets_million: ['assets_million', '자산', '재산', '자산백만원'],
  unemployment_benefit_receiving: ['unemployment_benefit_receiving', '실업급여', '구직급여', '실업급여수급'],
  unemployment_benefit_days_left: ['unemployment_benefit_days_left', '실업급여잔여일', '수급잔여일', '잔여일'],
  crisis_event: ['crisis_event', '위기사유', '긴급 위기 상황', '긴급', '생계곤란', '연체', '주거위기'],
  medical_expense_3m: ['medical_expense_3m', '의료비', '병원비', '최근의료비'],
  credit_score: ['credit_score', '신용점수', '신용'],
  debt_monthly_payment: ['debt_monthly_payment', '월상환', '대출상환', '상환액'],
  is_basic_livelihood: ['is_basic_livelihood', '기초생활수급', '수급자'],
  is_near_poverty: ['is_near_poverty', '차상위'],
  has_housing_contract: ['has_housing_contract', '임대차계약', '계약서'],
  wants_job_training: ['wants_job_training', '직업훈련', '훈련희망', '교육희망'],
};

function normalizeHeader(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s_\-()\[\]{}·:：/]/g, '')
    .trim();
}

const MONEY_AMOUNT_SOURCE = '-?\\d[\\d,]*(?:\\.\\d+)?\\s*(?:억원|천\\s*만\\s*원|천만원|백\\s*만\\s*원|백만원|만\\s*원|만원|천\\s*원|천원|원)';
const MONEY_AMOUNT_OPTIONAL_UNIT_SOURCE = '-?\\d[\\d,]*(?:\\.\\d+)?\\s*(?:억원|천\\s*만\\s*원|천만원|백\\s*만\\s*원|백만원|만\\s*원|만원|천\\s*원|천원|원)?';
const MONEY_AMOUNT_RE = new RegExp(`(${MONEY_AMOUNT_SOURCE})`);

function normalizeMoneyText(value) {
  return String(value || '')
    .replaceAll(',', '')
    .replace(/(\d)\s*(억|천\s*만|백\s*만|만|천)\s*원/g, (_, n, unit) => `${n}${unit.replace(/\s+/g, '')}원`)
    .replace(/\s+/g, ' ')
    .trim();
}

function inferredUnit(num, unit, defaultUnit = 'auto') {
  if (unit) return unit.replace(/\s+/g, '');
  if (defaultUnit && defaultUnit !== 'auto') return defaultUnit;
  return Math.abs(num) > 0 && Math.abs(num) < 10000 ? '만원' : '원';
}

function matchSchemaKey(header) {
  const n = normalizeHeader(header);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some((a) => normalizeHeader(a) === n || n.includes(normalizeHeader(a)))) return field;
  }
  return null;
}

function moneyToWon(value, defaultUnit = 'auto') {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Math.trunc(value);
  const text = normalizeMoneyText(value);
  if (/^(없음|무|무소득|해당없음|없다)$/i.test(text)) return 0;
  const m = text.match(/(-?\d+(?:\.\d+)?)\s*(억원|천만원|백만원|만원|천원|원)?/);
  if (!m) return numberInput(text, 0);
  const num = Number(m[1]);
  const unit = inferredUnit(num, m[2], defaultUnit);
  if (unit === '억원') return Math.trunc(num * 100000000);
  if (unit === '천만원') return Math.trunc(num * 10000000);
  if (unit === '백만원') return Math.trunc(num * 1000000);
  if (unit === '만원') return Math.trunc(num * 10000);
  if (unit === '천원') return Math.trunc(num * 1000);
  return Math.trunc(num);
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  const t = String(value || '').trim().toLowerCase();
  if (['true', 'y', 'yes', '1', '수급', '해당', '있음', '예', 'o', '○'].includes(t)) return true;
  if (['false', 'n', 'no', '0', '미수급', '비해당', '없음', '아니오', 'x', '×'].includes(t)) return false;
  return /(수급|해당|있음|계약|희망|예)/.test(t);
}

function normalizeEmployment(text) {
  const t = String(text || '').toLowerCase();
  if (/(무직|실직|실업|unemployed)/.test(t)) return 'unemployed';
  if (/(취준|구직|job)/.test(t)) return 'job_seeker';
  if (/(알바|아르바이트|파트|part)/.test(t)) return 'part_time';
  if (/(프리|freelance)/.test(t)) return 'freelancer';
  if (/(학생|student)/.test(t)) return 'student';
  if (/(직장|근로|재직|정규|계약|employ)/.test(t)) return 'employed';
  return EMPLOYMENT_STATUSES.includes(t) ? t : DEFAULT_PROFILE.employment_status;
}

function coerceField(field, value) {
  if (value === null || value === undefined || value === '') return undefined;
  if (['monthly_income', 'expected_monthly_income', 'rent', 'deposit', 'medical_expense_3m', 'debt_monthly_payment'].includes(field)) return moneyToWon(value, 'auto');
  if (field === 'assets_million') {
    const won = moneyToWon(value, 'auto');
    return won >= 1000000 ? Math.round(won / 1000000) : numberInput(value, 0);
  }
  if (['age', 'household_size', 'expected_income_start_month', 'unemployment_benefit_days_left', 'credit_score'].includes(field)) return Math.trunc(numberInput(value, DEFAULT_PROFILE[field] ?? 0));
  if (['unemployment_benefit_receiving', 'crisis_event', 'is_basic_livelihood', 'is_near_poverty', 'has_housing_contract', 'wants_job_training'].includes(field)) return toBool(value);
  if (field === 'employment_status') return normalizeEmployment(value);
  if (field === 'region') {
    const raw = String(value).trim();
    return REGIONS.find((r) => raw.includes(r)) || raw;
  }
  return String(value).trim();
}

export function buildSchemaMap(headers = []) {
  const mapped = {};
  const unmapped = [];
  for (const header of headers) {
    const field = matchSchemaKey(header);
    if (field) mapped[header] = field;
    else unmapped.push(header);
  }
  return { mapped, unmapped, coverage: headers.length ? Object.keys(mapped).length / headers.length : 0 };
}

export function mapRowToProfile(row = {}) {
  const mapping = buildSchemaMap(Object.keys(row));
  const profile = {};
  const evidence = [];
  for (const [header, field] of Object.entries(mapping.mapped)) {
    const value = coerceField(field, row[header]);
    if (value !== undefined) {
      profile[field] = value;
      evidence.push({ field, label: FIELD_LABELS[field] || field, value, source: header, confidence: 0.92 });
    }
  }
  const normalized = normalizeProfile(asProfile(profile));
  const [safe, warnings] = validateProfile(normalized);
  return { profile: safe, mapping, evidence, warnings };
}

export function mapRowsToProfiles(rows = []) {
  return rows.map((row, index) => ({ index, original: row, ...mapRowToProfile(row) }));
}

function addEvidence(list, field, value, source, confidence = 0.8) {
  if (value === undefined || value === null || value === '') return;
  const exists = list.some((x) => x.field === field && String(x.value) === String(value));
  if (!exists) list.push({ field, label: FIELD_LABELS[field] || field, value, source, confidence });
}

export function extractFieldsFromText(text = '') {
  const normalizedByNlp = parseOnboardingText(text);
  const profile = { ...normalizedByNlp };
  const evidence = [];
  const t = String(text || '');
  const moneyAmount = `(${MONEY_AMOUNT_SOURCE})`;
  const moneyAmountOptional = `(${MONEY_AMOUNT_OPTIONAL_UNIT_SOURCE})`;

  const patterns = [
    ['age', /(?:나이|연령)?\s*(?:은|는|:|：)?\s*(?:만\s*)?(\d{1,3})\s*(?:세|살)(?!\s*(?:이상|이하|~|-|부터|까지))/, (m) => /[~-]/.test(t.slice(Math.max(0, m.index - 2), m.index)) ? undefined : Number(m[1])],
    ['household_size', /(?:(\d+)\s*인\s*가구|가구원\s*수\s*(?:은|는|:|：)?\s*(\d+)\s*명?|가구\s*수\s*(?:은|는|:|：)?\s*(\d+)\s*명?)/, (m) => Number(m[1] || m[2] || m[3])],
    ['monthly_income', new RegExp(`(?:월\\s*소득|월소득|근로소득|월급|수입)\\s*(?:은|는|이|가|:|：)?\\s*(?:${moneyAmount}|없음|없|무소득)(?!\\s*%)`), (m) => /없|무소득/.test(m[0]) ? 0 : moneyToWon(m[1], 'auto')],
    ['expected_monthly_income', new RegExp(`(?:예상|예정)[^\\n]{0,30}?(?:월\\s*소득|소득|월급|수입|월)\\s*(?:은|는|이|가|:|：)?\\s*${moneyAmountOptional}(?!\\s*%)`), (m) => moneyToWon(m[1], 'auto')],
    ['rent', new RegExp(`(?:월세|임대료|차임)\\s*(?:은|는|이|가|:|：)?\\s*${moneyAmount}`), (m) => moneyToWon(m[1], 'auto')],
    ['deposit', new RegExp(`(?:보증금|임대보증금)\\s*(?:은|는|이|가|:|：)?\\s*${moneyAmount}`), (m) => moneyToWon(m[1], 'auto')],
    ['unemployment_benefit_days_left', /(?:실업급여|구직급여|수급)[^,.。\n]{0,25}?(\d+)\s*일/, (m) => Number(m[1])],
    ['unemployment_benefit_days_left', /(?:실업급여|구직급여|수급)[^,.。\n]{0,25}?(\d+)\s*개월/, (m) => /\d+\s*일/.test(m[0]) ? undefined : Number(m[1]) * 30],
    ['credit_score', /(?:신용점수|신용)\s*(?:은|이|:|：)?\s*(\d{3,4})/, (m) => Number(m[1])],
    ['debt_monthly_payment', new RegExp(`(?:월상환|대출상환|상환액)\\s*(?:은|는|이|가|:|：)?\\s*${moneyAmount}`), (m) => moneyToWon(m[1], 'auto')],
    ['medical_expense_3m', new RegExp(`(?:의료비|병원비)\\s*(?:은|는|이|가|:|：)?\\s*${moneyAmount}`), (m) => moneyToWon(m[1], 'auto')],
  ];

  for (const [field, regex, parser] of patterns) {
    const match = t.match(regex);
    if (match) {
      const value = parser(match);
      if (value === undefined) continue;
      profile[field] = value;
      addEvidence(evidence, field, value, match[0], 0.88);
    }
  }

  const region = REGIONS.find((r) => t.includes(r));
  if (region) {
    profile.region = region;
    addEvidence(evidence, 'region', region, `${region} 포함 문장`, 0.86);
  }

  if (/(혼자|자취|1인가구)/.test(t) && !profile.household_size) {
    profile.household_size = 1;
    addEvidence(evidence, 'household_size', 1, '혼자/자취/1인가구 표현', 0.82);
  }
  if (/(실업급여|구직급여)/.test(t)) {
    profile.unemployment_benefit_receiving = true;
    addEvidence(evidence, 'unemployment_benefit_receiving', true, '실업급여/구직급여 표현', 0.9);
  }
  if (/(위기|생계곤란|긴급|연체|월세밀림)/.test(t)) {
    profile.crisis_event = true;
    addEvidence(evidence, 'crisis_event', true, '위기/긴급/연체 표현', 0.78);
  }
  if (/(기초생활|수급자)/.test(t)) {
    profile.is_basic_livelihood = true;
    addEvidence(evidence, 'is_basic_livelihood', true, '기초생활/수급자 표현', 0.9);
  }
  if (/차상위/.test(t)) {
    profile.is_near_poverty = true;
    addEvidence(evidence, 'is_near_poverty', true, '차상위 표현', 0.9);
  }
  if (/(임대차계약서|계약서|월세계약)/.test(t)) {
    profile.has_housing_contract = true;
    addEvidence(evidence, 'has_housing_contract', true, '계약서 표현', 0.84);
  }
  const safeProfile = normalizeProfile(asProfile(profile));
  const [validated, warnings] = validateProfile(safeProfile);
  const completeness = Object.keys(FIELD_LABELS).filter((f) => validated[f] !== undefined && validated[f] !== DEFAULT_PROFILE[f]).length;
  return { profile: validated, evidence, warnings, completeness, rawText: t };
}

export function validateExtraction(extraction) {
  const profile = extraction.profile || extraction;
  const [safe, baseWarnings] = validateProfile(profile);
  const issues = [...baseWarnings];
  const confirmations = [];
  if (!profile.age || profile.age === DEFAULT_PROFILE.age) issues.push('나이가 제대로 입력되어 있는지 확인해 주세요.'); else confirmations.push('나이 확인');
  if (!profile.region || profile.region === DEFAULT_PROFILE.region) issues.push('거주 지역이 기본값일 수 있습니다. 실제 거주 지역을 확인해 주세요.'); else confirmations.push('지역 확인');
  if (!profile.monthly_income && !/(소득 없음|무소득|월소득 0|소득 0)/.test(extraction.rawText || '')) issues.push('월소득을 0원으로 읽었습니다. 실제로 소득이 없는 상태인지 확인해 주세요.');
  if (profile.rent > 0 && !profile.has_housing_contract) issues.push('월세 정보는 찾았지만 임대차계약서 여부는 확인하지 못했습니다. 계약서가 있는지 확인해 주세요.'); else if (profile.rent > 0) confirmations.push('월세/주거 정보 확인');
  const evidenceFields = new Set((extraction.evidence || []).map((x) => x.field));
  const missingEvidence = ['age', 'region', 'monthly_income', 'rent'].filter((f) => !evidenceFields.has(f));
  return { profile: safe, ok: issues.length === 0 || issues.length <= 2, issues, confirmations, missingEvidence, evidence: extraction.evidence || [] };
}


function hasLoanLikeContext(text = '') {
  return /(융자|대출|담보|원리금|상환|거치|균분상환|금리|연리|이차보전|이자차이|대출금|보증료|신용보증|보증지원|보증한도)/.test(String(text || ''));
}

function isCriteriaOnlyContext(text = '') {
  const t = String(text || '');
  if (/(지원|지급|급여|장려금|수당|교육비|훈련비|포상금|바우처|이용권|보조|환급)/.test(t)) return false;
  return /(소득|재산|자산|보증금|월세금|월세|임차보증금|총\s*급여|선정기준|기준|이하|미만|초과)/.test(t);
}

function isMonthlyContext(text = '') {
  return /(월\s*(최대|한도|마다|별|액|지원|지급)?|매월|월별|개월\s*마다|[/／]\s*월)/.test(String(text || ''));
}

function isAnnualOrOneTimeContext(text = '') {
  return /(연간|연\s*최대|매년|1년|12\s*개월|전년도|총액|총\s*지원|누적|장려금|일시|1회|한\s*번|포상금|컨설팅|까지\s*지원|한도)/.test(String(text || ''));
}

function amountContext(line = '', match) {
  const index = match?.index || 0;
  const token = match?.[0] || '';
  const before = line.slice(Math.max(0, index - 20), index);
  const after = line.slice(index + token.length, Math.min(line.length, index + token.length + 24));
  return { before, after, near: `${before}${token}${after}` };
}

function amountLooksMonthly(ctx = {}) {
  return /(월\s*(?:최대|한도|액|지원|지급)?\s*$|매월\s*$|월별\s*$)/.test(ctx.before || '')
    || /^\s*(?:씩\s*)?(?:매월|월별|[/／]\s*월|원?\s*[/／]\s*월|월\s*지급|월\s*지원)/.test(ctx.after || '')
    || /월\s*마다|개월\s*마다/.test(`${ctx.before || ''}${ctx.after || ''}`);
}

function amountLooksAnnualOrOneTime(ctx = {}, amount = 0) {
  const around = `${ctx.before || ''}${ctx.after || ''}`;
  return /(연간|연\s*최대|매년|1년|12\s*개월|전년도|총액|총\s*지원|누적|일시|1회|한\s*번|까지\s*지원|한도)/.test(around)
    || /총\s*$|최대\s*$|한도\s*$/.test(ctx.before || '')
    || /^\s*(?:까지|한도|일시|1회|범위)/.test(ctx.after || '')
    || amount >= 1500000;
}

function toMonthlyEquivalent(amount, line = '', ctx = {}) {
  if (!amount) return { monthly: 0, period: 'unknown' };
  if (amountLooksMonthly(ctx)) return { monthly: amount, period: 'monthly' };
  if (amountLooksAnnualOrOneTime(ctx, amount) || (!isMonthlyContext(line) && isAnnualOrOneTimeContext(line))) {
    return { monthly: Math.round(amount / 12), period: 'monthly_equivalent' };
  }
  return { monthly: amount, period: 'unspecified_cash' };
}

function extractSupportAmountCandidate(text = '') {
  const t = String(text || '');
  const lines = t.split(/\r?\n|[。]/).map((line) => line.trim()).filter(Boolean);
  const candidates = [];
  const moneyRe = new RegExp(MONEY_AMOUNT_RE.source, 'g');
  lines.forEach((line, idx) => {
    const prev = lines[idx - 1] || '';
    const next = lines[idx + 1] || '';
    const context = `${prev}\n${line}\n${next}`;
    const positive = /(지원내용|지원금액|지원액|지급액|지원|지급|급여|장려금|수당|교육비|방과후|훈련비|포상금|바우처|이용권|보조|환급)/.test(context);
    if (!positive) return;
    if (hasLoanLikeContext(context)) return;
    for (const match of line.matchAll(moneyRe)) {
      const amount = moneyToWon(match[1], 'auto');
      if (!amount) continue;
      const start = Math.max(0, (match.index || 0) - 24);
      const end = Math.min(line.length, (match.index || 0) + match[0].length + 24);
      const near = line.slice(start, end);
      if (isCriteriaOnlyContext(near)) continue;
      const ctx = amountContext(line, match);
      const { monthly, period } = toMonthlyEquivalent(amount, line, ctx);
      candidates.push({ amount, monthly, period, source: line, confidence: period === 'monthly' ? 0.9 : 0.78 });
    }
  });
  return candidates.sort((a, b) => b.monthly - a.monthly)[0] || null;
}

function evidenceItem(field, label, value, source, confidence = 0.82) {
  return { field, label, value, source: String(source || '').trim(), confidence };
}

function compactPolicyLine(line = '') {
  return String(line || '').replace(/^[○●■□ㆍ·\-–—*\s]+/, '').trim();
}

function isPolicySectionHeading(line = '') {
  return /(지원\s*대상|대상자|신청\s*대상|신청\s*자격|선정\s*기준|지원\s*조건|자격\s*요건|소득\s*기준|거주\s*요건|연령\s*기준|수급\s*자격)/.test(compactPolicyLine(line));
}

function isNextPolicyHeading(line = '') {
  return /(지원\s*내용|신청\s*방법|신청\s*기간|제출\s*서류|구비\s*서류|문의|접수|소관|근거\s*법령|중복|유의\s*사항|처리\s*절차)/.test(compactPolicyLine(line));
}

function extractPolicySections(text = '', options = {}) {
  const { headingRe = isPolicySectionHeading, maxLines = 10 } = options;
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!headingRe(lines[i])) continue;
    const section = [lines[i]];
    for (let j = i + 1; j < lines.length && section.length <= maxLines; j += 1) {
      if (isPolicySectionHeading(lines[j]) || isNextPolicyHeading(lines[j])) break;
      section.push(lines[j]);
    }
    chunks.push(section.join('\n'));
  }
  return chunks.join('\n\n');
}

function eligibilityTextForPolicy(text = '') {
  const scoped = extractPolicySections(text, { maxLines: 14 });
  return scoped || '';
}

function supportContentTextForPolicy(text = '') {
  return extractPolicySections(text, {
    headingRe: (line) => /(지원\s*내용|지원\s*금액|지원\s*액|지급\s*액|급여\s*내용|서비스\s*내용|혜택\s*내용)/.test(compactPolicyLine(line)),
    maxLines: 12,
  }) || text;
}

function firstAgeRangeInEligibility(text = '') {
  const scoped = eligibilityTextForPolicy(text);
  if (!scoped) return null;
  const patterns = [
    /(?:만\s*)?(\d{1,2})\s*(?:세)?\s*(?:~|-|부터|이상)\s*(?:만\s*)?(\d{1,2})\s*세(?:\s*이하|까지)?/,
    /(?:만\s*)?(\d{1,2})\s*세\s*이상[^\n]{0,24}?(?:만\s*)?(\d{1,2})\s*세\s*이하/,
  ];
  for (const pattern of patterns) {
    const match = scoped.match(pattern);
    if (match) return { match, source: match[0] };
  }
  return null;
}

export function detectDocumentKind(text = '') {
  const t = String(text || '');
  const policySignals = [
    /지원\s*대상/, /지원\s*내용/, /신청\s*방법/, /신청\s*기간/, /제출\s*서류|구비\s*서류/,
    /문의\s*처|담당\s*부서/, /사업\s*개요/, /지급\s*규모/, /지원\s*조건/, /공고/, /복지로|정부24|행정복지센터/,
  ].filter((re) => re.test(t)).length;
  const profileSignals = [
    /신청자|성명|이름/, /주소|거주지/, /나이|연령|만\s*\d+\s*세/, /월\s*소득|월소득|근로소득/,
    /월세|임대료|차임/, /구직급여|실업급여/, /가구원\s*수|\d+\s*인\s*가구/,
  ].filter((re) => re.test(t)).length;
  if (policySignals >= 3 && policySignals >= profileSignals) return 'policy_notice';
  return 'applicant_document';
}

export function extractPolicySignalsFromText(text = '') {
  const t = String(text || '');
  const lines = t.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const evidence = [];
  const eligibilityText = eligibilityTextForPolicy(t);
  const supportText = supportContentTextForPolicy(t);
  const criteriaText = eligibilityText || t;
  const result = {
    title: lines.find((line) => /(지원|급여|사업|제도|공고|안내)/.test(line)) || lines[0] || '정책 문서',
    regions: REGIONS.filter((r) => t.includes(r)),
    age_range: null,
    rent_cap: null,
    deposit_cap: null,
    support_amount: null,
    income_percent_criteria: [],
    required_docs: [],
    application_methods: [],
    evidence,
  };

  const ageRange = firstAgeRangeInEligibility(t);
  if (ageRange?.match) {
    result.age_range = [Number(ageRange.match[1]), Number(ageRange.match[2])].sort((a, b) => a - b);
    evidence.push(evidenceItem('age_range', '연령 기준', `${result.age_range[0]}~${result.age_range[1]}세`, ageRange.source, 0.9));
  }
  const hasScopedEligibility = Boolean(eligibilityText);
  const capSuffix = '(?:이하|까지|미만|초과하지\\s*않|넘지\\s*않)';
  const rentPattern = hasScopedEligibility
    ? `(?:월세|임대료|차임)[^\n]{0,18}?${MONEY_AMOUNT_RE.source}\\s*(?:${capSuffix})?`
    : `(?:월세|임대료|차임)[^\n]{0,18}?${MONEY_AMOUNT_RE.source}\\s*${capSuffix}`;
  const rent = criteriaText.match(new RegExp(rentPattern));
  if (rent) {
    result.rent_cap = moneyToWon(rent[1], 'auto');
    evidence.push(evidenceItem('rent_cap', '월세 기준', result.rent_cap, rent[0], 0.88));
  }
  const depositPattern = hasScopedEligibility
    ? `(?:보증금|임차보증금|임대보증금)[^\n]{0,18}?${MONEY_AMOUNT_RE.source}\\s*(?:${capSuffix})?`
    : `(?:보증금|임차보증금|임대보증금)[^\n]{0,18}?${MONEY_AMOUNT_RE.source}\\s*${capSuffix}`;
  const deposit = criteriaText.match(new RegExp(depositPattern));
  if (deposit) {
    result.deposit_cap = moneyToWon(deposit[1], 'auto');
    evidence.push(evidenceItem('deposit_cap', '보증금 기준', result.deposit_cap, deposit[0], 0.88));
  }
  const support = extractSupportAmountCandidate(supportText);
  if (support) {
    result.support_amount = support.monthly;
    result.support_period = support.period || (isMonthlyContext(support.source) ? 'monthly' : 'monthly_equivalent');
    evidence.push(evidenceItem('support_amount', '월 환산 지원금', result.support_amount, support.source, support.confidence));
  }
  for (const match of criteriaText.matchAll(/(?:기준\s*)?중위소득\s*(\d{1,3})\s*%\s*이하/g)) {
    const value = Number(match[1]);
    if (!result.income_percent_criteria.includes(value)) result.income_percent_criteria.push(value);
    evidence.push(evidenceItem('income_percent_criteria', '소득 기준', `${value}% 이하`, match[0], 0.86));
  }
  const docNames = ['임대차계약서', '월세 이체내역', '월세납부 증빙', '주민등록등본', '가족관계증명서', '소득 증빙서류', '소득·재산 확인자료', '통장사본'];
  result.required_docs = docNames.filter((name) => t.includes(name));
  result.required_docs.forEach((name) => evidence.push(evidenceItem('required_docs', '필요서류', name, name, 0.8)));
  if (/복지로/.test(t)) result.application_methods.push('복지로 온라인 신청');
  if (/행정복지센터|주민센터/.test(t)) result.application_methods.push('주소지 행정복지센터 방문 신청');
  if (result.regions.length) evidence.push(evidenceItem('regions', '지역 언급', result.regions.join(', '), result.regions.join(', '), 0.72));
  return result;
}

async function fileToText(file) {
  return await file.text();
}

async function extractPdfText(file, options = {}) {
  const { useOcr = false, ocrPageLimit = 2 } = options;
  const buffer = await file.arrayBuffer();
  const pdfjs = await import('pdfjs-dist');
  // Vite/browser builds can resolve this worker at runtime. If unavailable, pdfjs still works in fake-worker mode.
  try {
    const worker = await import('pdfjs-dist/build/pdf.worker.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  } catch (_) {
    // no-op for verification/node or bundlers without worker url support
  }
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str || '').join(' ');
    fullText += `\n\n[PDF page ${i}]\n${text}`;
  }
  if (useOcr && fullText.trim().length < 50 && typeof document !== 'undefined') {
    const Tesseract = await import('tesseract.js');
    const max = Math.min(pdf.numPages, ocrPageLimit);
    for (let i = 1; i <= max; i += 1) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.8 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;
      const result = await Tesseract.recognize(canvas, 'kor+eng');
      fullText += `\n\n[OCR page ${i}]\n${result.data.text}`;
    }
  }
  return { text: fullText.trim(), pages: pdf.numPages, parser: useOcr ? 'pdfjs+optional-tesseract' : 'pdfjs-text-layer' };
}

async function extractDocxText(file) {
  const mammoth = await import('mammoth/mammoth.browser');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return { text: result.value || '', warnings: result.messages || [], parser: 'mammoth-docx' };
}

function stripXml(xml) {
  return String(xml || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function extractHwpLikeText(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const buffer = await file.arrayBuffer();
  if (ext === 'hwpx' || ext === 'owpml') {
    const JSZip = await import('jszip');
    const zip = await JSZip.default.loadAsync(buffer);
    const files = Object.values(zip.files).filter((f) => /Contents\/.*\.xml$|content.*\.xml$|section.*\.xml$/i.test(f.name));
    const chunks = [];
    for (const f of files) chunks.push(stripXml(await f.async('text')));
    return { text: chunks.join('\n'), parser: 'hwpx-zip-xml' };
  }
  // Binary .hwp is not a plain text format. This fallback extracts visible UTF-16/ASCII/Korean runs
  // and marks the result as low-confidence so the validation UI asks for human confirmation.
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder('utf-16le', { fatal: false });
  const utf16 = decoder.decode(bytes);
  const visible = utf16.match(/[가-힣A-Za-z0-9\s:：,._\-()]{3,}/g)?.join(' ') || '';
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const visibleUtf8 = utf8.match(/[가-힣A-Za-z0-9\s:：,._\-()]{3,}/g)?.join(' ') || '';
  const text = visible.length > visibleUtf8.length ? visible : visibleUtf8;
  return { text, parser: 'hwp-binary-visible-string-fallback', warnings: ['이 한글 파일은 일부 글자가 빠지거나 순서가 섞일 수 있습니다. 가능하면 HWPX 파일이나 PDF로 다시 올리고, 아래에서 읽어낸 정보를 직접 확인해 주세요.'] };
}

async function extractImageOcr(file) {
  const Tesseract = await import('tesseract.js');
  const result = await Tesseract.recognize(file, 'kor+eng');
  return { text: result.data.text || '', parser: 'tesseract-kor-eng', confidence: result.data.confidence };
}

export async function extractTextFromFile(file, options = {}) {
  const ext = file.name.split('.').pop().toLowerCase();
  const mime = file.type || '';
  if (ext === 'pdf' || mime.includes('pdf')) return extractPdfText(file, options);
  if (ext === 'docx' || mime.includes('wordprocessingml')) return extractDocxText(file);
  if (['hwp', 'hwpx', 'owpml'].includes(ext)) return extractHwpLikeText(file);
  if (/image\//.test(mime) || ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'].includes(ext)) return extractImageOcr(file);
  if (['txt', 'md', 'csv', 'json'].includes(ext) || mime.startsWith('text/')) return { text: await fileToText(file), parser: 'plain-text' };
  return { text: await fileToText(file), parser: 'fallback-text' };
}

export async function runDocumentPipeline(file, options = {}) {
  const extraction = await extractTextFromFile(file, options);
  const fields = extractFieldsFromText(extraction.text);
  const validation = validateExtraction(fields);
  const documentKind = detectDocumentKind(extraction.text);
  const policySignals = documentKind === 'policy_notice' ? extractPolicySignalsFromText(extraction.text) : null;
  const parserWarnings = [...(extraction.warnings || [])];
  if (documentKind === 'policy_notice') {
    parserWarnings.push('정책 공고/안내문으로 보입니다. 내 정보는 바꾸지 않고, 신청 대상과 지원 조건만 따로 정리했습니다.');
  }
  return {
    file: { name: file.name, size: file.size, type: file.type },
    parser: extraction.parser,
    parserWarnings,
    documentKind,
    policySignals,
    text: extraction.text,
    profile: validation.profile,
    evidence: validation.evidence,
    validation,
    rawExtraction: extraction,
  };
}

export function buildVerificationChecklist(pipelineResult) {
  const evidenceFields = new Set((pipelineResult.evidence || []).map((e) => e.field));
  return [
    { item: '나이', status: evidenceFields.has('age') ? '확인됨' : '확인 필요', reason: '대부분의 청년·주거·취업 지원은 나이 조건이 있습니다.' },
    { item: '지역', status: evidenceFields.has('region') ? '확인됨' : '확인 필요', reason: '지역별로 신청 가능한 지자체 혜택이 달라질 수 있습니다.' },
    { item: '소득', status: evidenceFields.has('monthly_income') ? '확인됨' : '확인 필요', reason: '소득 기준을 넘으면 받을 수 없는 혜택이 있을 수 있습니다.' },
    { item: '주거비', status: evidenceFields.has('rent') ? '확인됨' : '해당 시 확인', reason: '월세·주거급여 계열 혜택을 확인할 때 필요합니다.' },
    { item: '실업급여', status: evidenceFields.has('unemployment_benefit_receiving') || evidenceFields.has('unemployment_benefit_days_left') ? '확인됨' : '해당 시 확인', reason: '실업급여가 끝나는 시점에 따라 다음에 준비할 혜택이 달라질 수 있습니다.' },
  ];
}

export function profileToEditableRows(profile) {
  const p = normalizeProfile(profile);
  return Object.entries(FIELD_LABELS).map(([field, label]) => ({ field, label, value: p[field], help: FIELD_HELP_TEXT[field] || '' }));
}

export { FIELD_LABELS, FIELD_HELP_TEXT, HEADER_ALIASES, moneyToWon, extractSupportAmountCandidate };