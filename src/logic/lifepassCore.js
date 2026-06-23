// LifePass deterministic core ported from the original Python/Streamlit project.
// The functions intentionally stay framework-free so they can be unit-verified in Node and reused by React.

export const REGIONS = ['서울', '경기', '인천', '부산', '대구', '대전', '광주', '울산', '세종', '전북', '전남', '충북', '충남', '경북', '경남', '강원', '제주'];
export const EMPLOYMENT_STATUSES = ['unemployed', 'job_seeker', 'part_time', 'employed', 'freelancer', 'student'];
export const DEFAULT_CHECKPOINTS = [0, 1, 3, 6, 12];
export const DEFAULT_INCOME_SCENARIOS = [0, 600000, 800000, 1200000, 1800000, 2300000, 3000000];

export const DEFAULT_PROFILE = {
  age: 27,
  region: '서울',
  district: '',
  household_size: 1,
  employment_status: 'unemployed',
  monthly_income: 0,
  expected_monthly_income: 0,
  expected_income_start_month: 3,
  rent: 0,
  deposit: 0,
  assets_million: 0,
  income_percent_median: null,
  unemployment_benefit_receiving: false,
  unemployment_benefit_days_left: 0,
  crisis_event: false,
  medical_expense_3m: 0,
  credit_score: 750,
  debt_monthly_payment: 0,
  is_basic_livelihood: false,
  is_near_poverty: false,
  has_housing_contract: true,
  wants_job_training: true,
  has_recent_unemployment: false,
  guardian_mode: false,
  notes: '',
};

export function asProfile(payload = {}) {
  return { ...DEFAULT_PROFILE, ...payload };
}

export function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function money(value) {
  return `${Math.round(Number(value || 0)).toLocaleString('ko-KR')}원`;
}

export function numberInput(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const cleaned = String(value)
    .replaceAll(',', '')
    .replace(/[원만천백억세살명개월일]/g, '')
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const MEDIAN_INCOME = { 1: 2228000, 2: 3682000, 3: 4715000, 4: 5729000, 5: 6695000 };
const REGION_ALIASES = {
  서울시: '서울', 서울특별시: '서울', 경기도: '경기', 인천광역시: '인천', 부산광역시: '부산', 대구광역시: '대구', 대전광역시: '대전', 광주광역시: '광주', 울산광역시: '울산', 세종특별자치시: '세종', 전라북도: '전북', 전북특별자치도: '전북', 전라남도: '전남', 충청북도: '충북', 충청남도: '충남', 경상북도: '경북', 경상남도: '경남', 강원특별자치도: '강원', 강원도: '강원', 제주특별자치도: '제주',
};

export function normalizeRegion(region = '') {
  const clean = String(region || '').trim();
  return REGION_ALIASES[clean] || clean;
}

export function estimateIncomePercent(monthlyIncome, householdSize) {
  const size = Math.min(Math.max(Number(householdSize || 1), 1), 5);
  const median = MEDIAN_INCOME[size] || MEDIAN_INCOME[1];
  return Math.round((Number(monthlyIncome || 0) / median) * 1000) / 10;
}

export function normalizeProfile(profile) {
  const p = asProfile(clone(profile));
  p.region = normalizeRegion(p.region);
  p.age = Math.trunc(numberInput(p.age, DEFAULT_PROFILE.age));
  p.household_size = Math.max(1, Math.trunc(numberInput(p.household_size, 1)));
  p.monthly_income = Math.max(0, Math.trunc(numberInput(p.monthly_income, 0)));
  p.expected_monthly_income = Math.max(0, Math.trunc(numberInput(p.expected_monthly_income, 0)));
  p.expected_income_start_month = Math.max(0, Math.trunc(numberInput(p.expected_income_start_month, 0)));
  p.rent = Math.max(0, Math.trunc(numberInput(p.rent, 0)));
  p.deposit = Math.max(0, Math.trunc(numberInput(p.deposit, 0)));
  p.assets_million = Math.max(0, numberInput(p.assets_million, 0));
  p.unemployment_benefit_days_left = Math.max(0, Math.trunc(numberInput(p.unemployment_benefit_days_left, 0)));
  p.medical_expense_3m = Math.max(0, Math.trunc(numberInput(p.medical_expense_3m, 0)));
  p.credit_score = Math.max(0, Math.min(1000, Math.trunc(numberInput(p.credit_score, 750))));
  p.debt_monthly_payment = Math.max(0, Math.trunc(numberInput(p.debt_monthly_payment, 0)));
  if (p.income_percent_median === null || p.income_percent_median === undefined || p.income_percent_median === '') {
    p.income_percent_median = estimateIncomePercent(p.monthly_income, p.household_size);
  } else {
    p.income_percent_median = numberInput(p.income_percent_median, estimateIncomePercent(p.monthly_income, p.household_size));
  }
  if (!EMPLOYMENT_STATUSES.includes(p.employment_status)) p.employment_status = DEFAULT_PROFILE.employment_status;
  return p;
}

export function validateProfile(profile) {
  const p = normalizeProfile(profile);
  const warnings = [];
  if (p.age < 0 || p.age > 120) warnings.push('나이는 0~120 범위로 입력해야 합니다.');
  if (!REGIONS.includes(p.region)) warnings.push(`알 수 없는 지역입니다: ${p.region}`);
  if (p.rent > 0 && !p.has_housing_contract) warnings.push('월세가 있으나 임대차계약 여부가 꺼져 있습니다.');
  if (p.monthly_income === 0 && p.employment_status === 'employed') warnings.push('고용상태가 employed인데 현재 월소득이 0원입니다.');
  if (p.unemployment_benefit_receiving && p.unemployment_benefit_days_left <= 0) warnings.push('실업급여 수급 중이면 잔여일을 1일 이상 입력하는 것이 자연스럽습니다.');
  if (p.debt_monthly_payment > 0 && p.credit_score < 650) warnings.push('저신용·대출상환 부담이 있어 정책금융 상담 우선도가 높을 수 있습니다.');
  return [p, warnings];
}

export function projectProfile(profile, month) {
  const p = normalizeProfile(profile);
  const projected = clone(p);
  if (projected.unemployment_benefit_receiving && projected.unemployment_benefit_days_left <= month * 30) {
    projected.unemployment_benefit_receiving = false;
    projected.unemployment_benefit_days_left = 0;
    projected.has_recent_unemployment = true;
    if (projected.employment_status === 'unemployed') projected.employment_status = 'job_seeker';
  } else if (projected.unemployment_benefit_receiving) {
    projected.unemployment_benefit_days_left = Math.max(0, projected.unemployment_benefit_days_left - month * 30);
  }
  if (projected.expected_monthly_income && month >= projected.expected_income_start_month) {
    projected.monthly_income = projected.expected_monthly_income;
    if (['unemployed', 'job_seeker'].includes(projected.employment_status)) {
      projected.employment_status = projected.expected_monthly_income < 1800000 ? 'part_time' : 'employed';
    }
  }
  projected.income_percent_median = estimateIncomePercent(projected.monthly_income, projected.household_size);
  return projected;
}

function normalizeMoneyText(text) {
  return String(text || '')
    .replaceAll(',', '')
    .replace(/(\d)\s*(억|천\s*만|백\s*만|만|천)\s*원/g, (_, n, unit) => `${n}${unit.replace(/\s+/g, '')}원`)
    .replace(/\s+/g, ' ')
    .trim();
}

function inferUnit(num, unit, defaultUnit) {
  if (unit) return unit.replace(/\s+/g, '');
  if (defaultUnit && defaultUnit !== 'auto') return defaultUnit;
  return Math.abs(num) > 0 && Math.abs(num) < 10000 ? '만원' : '원';
}

function moneyToInt(text, defaultUnit = '원') {
  const cleaned = normalizeMoneyText(text);
  if (/^(없음|무|무소득|해당없음|없다)$/i.test(cleaned)) return 0;
  const match = cleaned.match(/(-?\d+(?:\.\d+)?)\s*(억원|천만원|백만원|만원|천원|원)?/);
  if (!match) return 0;
  const value = Number(match[1]);
  const unit = inferUnit(value, match[2], defaultUnit);
  if (unit === '억원') return Math.trunc(value * 100000000);
  if (unit === '천만원') return Math.trunc(value * 10000000);
  if (unit === '백만원') return Math.trunc(value * 1000000);
  if (unit === '만원') return Math.trunc(value * 10000);
  if (unit === '천원') return Math.trunc(value * 1000);
  return Math.trunc(value);
}


const SECRET_QUERY_PARAMS = new Set(['servicekey', 'oc', 'authkey', 'openapivlak', 'apikey', 'key']);
const MONEY_AMOUNT_RE = /(-?\d[\d,]*(?:\.\d+)?\s*(?:억원|천\s*만\s*원|천만원|백\s*만\s*원|백만원|만\s*원|만원|천\s*원|천원|원))/g;

function isApiTraceUrlObject(url) {
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  if (host.includes('apis.data.go.kr') || host.includes('api.odcloud.kr')) return true;
  if (pathname.includes('/drf/lawsearch.do') || pathname.includes('/drf/lawservice.do')) return true;
  if (pathname.includes('/opi/') && /openapivlak|authkey|servicekey/i.test(url.search)) return true;
  return [...url.searchParams.keys()].some((key) => SECRET_QUERY_PARAMS.has(key.toLowerCase()));
}

function sanitizeBenefitUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!/^https?:$/.test(url.protocol)) return '';
    if (isApiTraceUrlObject(url)) return '';
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return '';
  }
}

function publicUrlFromBenefit(benefit = {}) {
  const candidates = [benefit.apply_url, benefit.detail_url, benefit.source?.original_url].filter(Boolean);
  for (const href of candidates) {
    const safe = sanitizeBenefitUrl(href);
    if (safe) return safe;
  }
  return '';
}

function hasLoanLikeBenefitText(text = '') {
  return /(융자|대출|담보|원리금|상환|거치|균분상환|금리|연리|이차보전|이자차이|대출금|보증료|신용보증|보증지원|보증한도)/.test(String(text || ''));
}

function hasMonthlyBenefitContext(text = '') {
  return /(월\s*(최대|한도|마다|별|액|지원|지급)?|매월|월별|개월\s*마다|[/／]\s*월)/.test(String(text || ''));
}

function hasAnnualOrOneTimeContext(text = '') {
  return /(연간|연\s*최대|매년|1년|12\s*개월|전년도|총액|총\s*지원|누적|장려금|일시|1회|한\s*번|포상금|컨설팅|까지\s*지원|한도)/.test(String(text || ''));
}

function isBusinessOrProviderSupport(text = '') {
  return /(시설장|종사자|기관|법인|단체|사업자|기업|소상공인|중소기업|중견기업|농가|어업인|수산업\s*경영인|공동생활가정|그룹홈|어린이집|학교|센터|운영비|인건비|컨설팅|사업체|창업기업)/.test(String(text || ''));
}

function amountContextForBenefit(line = '', match) {
  const index = match?.index || 0;
  const token = match?.[0] || '';
  const before = line.slice(Math.max(0, index - 20), index);
  const after = line.slice(index + token.length, Math.min(line.length, index + token.length + 24));
  return { before, after, near: `${before}${token}${after}` };
}

function benefitAmountLooksMonthly(ctx = {}) {
  return /(월\s*(?:최대|한도|액|지원|지급)?\s*$|매월\s*$|월별\s*$)/.test(ctx.before || '')
    || /^\s*(?:씩\s*)?(?:매월|월별|[/／]\s*월|원?\s*[/／]\s*월|월\s*지급|월\s*지원)/.test(ctx.after || '')
    || /월\s*마다|개월\s*마다/.test(`${ctx.before || ''}${ctx.after || ''}`);
}

function benefitAmountLooksAnnualOrOneTime(ctx = {}, amount = 0) {
  const around = `${ctx.before || ''}${ctx.after || ''}`;
  return /(연간|연\s*최대|매년|1년|12\s*개월|전년도|총액|총\s*지원|누적|일시|1회|한\s*번|까지\s*지원|한도)/.test(around)
    || /총\s*$|최대\s*$|한도\s*$/.test(ctx.before || '')
    || /^\s*(?:까지|한도|일시|1회|범위)/.test(ctx.after || '')
    || amount >= 1500000;
}

function toBenefitMonthlyEquivalent(amount, line = '', ctx = {}) {
  if (!amount) return 0;
  if (benefitAmountLooksMonthly(ctx)) return amount;
  if (benefitAmountLooksAnnualOrOneTime(ctx, amount) || (!hasMonthlyBenefitContext(line) && hasAnnualOrOneTimeContext(line))) return Math.round(amount / 12);
  return amount;
}

function supportAmountFromText(text = '') {
  if (hasLoanLikeBenefitText(text)) return 0;
  const lines = String(text || '').split(/\r?\n|[。]/).map((line) => line.trim()).filter(Boolean);
  const candidates = [];
  lines.forEach((line, idx) => {
    const context = `${lines[idx - 1] || ''}\n${line}\n${lines[idx + 1] || ''}`;
    if (!/(지원내용|지원금액|지원액|지급액|지원|지급|급여|장려금|수당|교육비|방과후|훈련비|포상금|바우처|이용권|보조|환급)/.test(context)) return;
    if (hasLoanLikeBenefitText(context)) return;
    for (const match of line.matchAll(MONEY_AMOUNT_RE)) {
      const amount = moneyToInt(match[1], 'auto');
      if (!amount) continue;
      const ctx = amountContextForBenefit(line, match);
      if (!/(지원|지급|급여|장려금|수당|교육비|훈련비|포상금|바우처|이용권|보조|환급)/.test(ctx.near) && /(소득|재산|자산|보증금|월세금|월세|임차보증금|총\s*급여|선정기준|기준|이하|미만|초과)/.test(ctx.near)) continue;
      candidates.push(toBenefitMonthlyEquivalent(amount, line, ctx));
    }
  });
  return candidates.length ? Math.max(...candidates) : 0;
}

function normalizeBenefitMonthlyValue(benefit = {}) {
  const raw = Number(benefit.estimated_monthly_value || 0);
  const text = [benefit.name, benefit.description, benefit.target, benefit.source?.label].filter(Boolean).join('\n');
  if (hasLoanLikeBenefitText(text) || isBusinessOrProviderSupport(text)) return 0;
  if (raw > 0) {
    if (['monthly', 'monthly_equivalent', 'unspecified_cash'].includes(benefit.estimated_value_period)) return raw;
    if (hasMonthlyBenefitContext(text)) return raw;
    if (hasAnnualOrOneTimeContext(text) || raw >= 1500000) return Math.round(raw / 12);
    return raw;
  }
  return supportAmountFromText(text);
}

function normalizeBenefitPriority(benefit = {}, monthlyValue = 0) {
  const base = Number(benefit.priority || 0) || 50;
  let score = base;
  const domain = benefit.domain || '기타';
  const text = [benefit.name, benefit.description, benefit.target].filter(Boolean).join('\n');
  const domainBonus = { 주거: 8, 고용: 6, 의료: 6, 금융: 3, 교육: 4, 청년: 5, 생활지원: 2, 법령근거: -5, 기타: 0 };
  score += domainBonus[domain] || 0;
  if (monthlyValue > 0) score += Math.min(12, Math.ceil(monthlyValue / 100000));
  if (/(기초생활|차상위|저소득|생계|실업|장애|한부모|청년)/.test(text)) score += 5;
  if (hasLoanLikeBenefitText(text)) score -= 8;
  if (isBusinessOrProviderSupport(text)) score -= 12;
  const publicUrl = publicUrlFromBenefit(benefit);
  if (!publicUrl && (benefit.apply_url || benefit.source?.original_url)) score -= 3;
  return Math.max(30, Math.min(98, Math.round(score)));
}

function spanReplace(text, start, end) {
  return `${text.slice(0, start)}${text.slice(end)}`;
}

export function parseOnboardingText(text) {
  const t = String(text || '').trim();
  const profile = {};
  const moneyAmount = '-?\\d[\\d,]*(?:\\.\\d+)?\\s*(?:억원|천\\s*만\\s*원|천만원|백\\s*만\\s*원|백만원|만\\s*원|만원|천\\s*원|천원|원)?';
  const age = t.match(/(?:나이|연령|신청자)?\s*(?:은|는|:|：)?\s*(?:만\s*)?(\d{1,3})\s*(?:세|살)(?!\s*(?:이상|이하|~|-|부터|까지))/);
  if (age && !/[~-]/.test(t.slice(Math.max(0, age.index - 2), age.index))) profile.age = Number(age[1]);
  for (const region of REGIONS) {
    if (t.includes(region)) { profile.region = normalizeRegion(region); break; }
  }
  const household = t.match(/(?:(\d+)\s*인\s*가구|가구원\s*수\s*(?:은|는|:|：)?\s*(\d+)\s*명?|가구\s*수\s*(?:은|는|:|：)?\s*(\d+)\s*명?)/);
  if (household) profile.household_size = Number(household[1] || household[2] || household[3]);
  else if (/(혼자|자취|1인가구)/.test(t)) profile.household_size = 1;

  if (/(실업급여|구직급여)/.test(t)) { profile.unemployment_benefit_receiving = true; profile.employment_status = 'unemployed'; }
  if (/(실직|퇴사|무직)/.test(t)) { profile.employment_status = 'unemployed'; profile.has_recent_unemployment = true; }
  if (/(취준|구직)/.test(t)) profile.employment_status = 'job_seeker';
  if (/(알바|아르바이트|파트타임)/.test(t)) profile.employment_status = 'part_time';
  if (/(프리랜서|프리)/.test(t)) profile.employment_status = 'freelancer';
  if (/(직장인|정규직|계약직)/.test(t)) profile.employment_status = 'employed';
  if (/(학생|대학생|휴학생)/.test(t)) profile.employment_status = 'student';

  const daysLeft = t.match(/(?:실업급여|구직급여|수급)[^,.。\n]{0,20}?(\d+)\s*일/);
  if (daysLeft) profile.unemployment_benefit_days_left = Number(daysLeft[1]);
  const monthLeft = t.match(/(?:실업급여|구직급여|수급)[^,.。\n]{0,20}?(\d+)\s*개월/);
  if (monthLeft && profile.unemployment_benefit_days_left === undefined) profile.unemployment_benefit_days_left = Number(monthLeft[1]) * 30;

  let currentText = t;
  const futureIncome = t.match(new RegExp(`(\\d+)\\s*개월\\s*(?:뒤|후)[^,.。\\n]{0,50}?(?:월소득|소득|수입|월급|월)?\\s*(${moneyAmount})`));
  if (futureIncome) {
    profile.expected_income_start_month = Number(futureIncome[1]);
    profile.expected_monthly_income = moneyToInt(futureIncome[2], '만원');
    currentText = spanReplace(t, futureIncome.index, futureIncome.index + futureIncome[0].length);
  }
  const income = currentText.match(new RegExp(`(?:현재\\s*)?(?:월\\s*소득|월소득|근로소득|수입|월급)\\s*(?:은|는|이|가|:|：)?\\s*(${moneyAmount})(?!\\s*%)`));
  if (income) profile.monthly_income = moneyToInt(income[1], '만원');
  else if (/(월\s*소득|월소득|소득|수입|월급)\s*(?:은|는|이|가|:|：)?\s*(?:없|없음|무소득|0\s*원?)/.test(currentText) || /(소득 없음|소득없음|무소득|월소득 0|소득 0)/.test(currentText)) profile.monthly_income = 0;

  if (profile.expected_monthly_income === undefined) {
    const expected = t.match(new RegExp(`(?:예정|예상|시작)[^,.。\\n]{0,40}?(${moneyAmount})`));
    if (expected) profile.expected_monthly_income = moneyToInt(expected[1], '만원');
  }
  const expectedMonth = t.match(/(\d+)\s*개월\s*(?:뒤|후).*?(?:알바|취업|소득|수입|월급)/);
  if (expectedMonth && profile.expected_income_start_month === undefined) profile.expected_income_start_month = Number(expectedMonth[1]);

  const rent = t.match(new RegExp(`(?:월세|임대료|차임)\\s*(?:은|는|이|가|:|：)?\\s*(${moneyAmount})`));
  if (rent) { profile.rent = moneyToInt(rent[1], '만원'); profile.has_housing_contract = true; }
  const deposit = t.match(new RegExp(`(?:보증금|임대보증금)\\s*(?:은|는|이|가|:|：)?\\s*(${moneyAmount})`));
  if (deposit) profile.deposit = moneyToInt(deposit[1], '만원');
  const medical = t.match(new RegExp(`(?:의료비|병원비)\\s*(?:은|는|이|가|:|：)?\\s*(${moneyAmount})`));
  if (medical) profile.medical_expense_3m = moneyToInt(medical[1], '만원');
  const credit = t.match(/(?:신용점수|신용)\s*(?:는|이|:)?\s*(\d{3,4})/);
  if (credit) profile.credit_score = Number(credit[1]);
  const debt = t.match(new RegExp(`(?:상환|대출상환|월상환)\\s*(?:은|는|이|가|:|：)?\\s*(${moneyAmount})`));
  if (debt) profile.debt_monthly_payment = moneyToInt(debt[1], '만원');
  if (/(위기|생계곤란|긴급|월세밀림|연체)/.test(t)) profile.crisis_event = true;
  if (/(기초생활|수급자)/.test(t)) profile.is_basic_livelihood = true;
  if (/차상위/.test(t)) profile.is_near_poverty = true;
  if (/(훈련|교육|직업훈련|자격증)/.test(t)) profile.wants_job_training = true;
  if (profile.unemployment_benefit_receiving && [undefined, 'part_time', 'employed', 'freelancer'].includes(profile.employment_status)) profile.employment_status = 'unemployed';
  profile.notes = t;
  return validateProfile(asProfile(profile))[0];
}

const OPS = new Set(['==', '!=', '>', '>=', '<', '<=', 'between', 'in', 'not_in', 'exists', 'contains']);
function valueOf(profile, field) { return profile[field]; }
function compare(actual, op, expected) {
  if (!OPS.has(op)) throw new Error(`Unsupported operator: ${op}`);
  if (op === 'exists') return actual !== null && actual !== undefined && actual !== '';
  if (actual === null || actual === undefined) return false;
  if (op === '==') return actual === expected;
  if (op === '!=') return actual !== expected;
  if (op === '>') return actual > expected;
  if (op === '>=') return actual >= expected;
  if (op === '<') return actual < expected;
  if (op === '<=') return actual <= expected;
  if (op === 'between') return expected[0] <= actual && actual <= expected[1];
  if (op === 'in') return expected.includes(actual);
  if (op === 'not_in') return !expected.includes(actual);
  if (op === 'contains') return String(actual).includes(String(expected));
  return false;
}

function hasEffectiveRule(rule) {
  if (!rule || typeof rule !== 'object') return false;
  if (rule.field) return true;
  if (Array.isArray(rule.all)) return rule.all.length > 0 && rule.all.some(hasEffectiveRule);
  if (Array.isArray(rule.any)) return rule.any.length > 0 && rule.any.some(hasEffectiveRule);
  if (rule.not) return hasEffectiveRule(rule.not);
  return false;
}

function flattenRuleNodes(rule, out = []) {
  if (!rule || typeof rule !== 'object') return out;
  if (rule.field) out.push(rule);
  if (Array.isArray(rule.all)) rule.all.forEach((node) => flattenRuleNodes(node, out));
  if (Array.isArray(rule.any)) rule.any.forEach((node) => flattenRuleNodes(node, out));
  if (rule.not) flattenRuleNodes(rule.not, out);
  return out;
}

function benefitText(benefit = {}) {
  return [benefit.name, benefit.description, benefit.target, benefit.domain].filter(Boolean).join(' ');
}

function isLikelyPreschoolPolicy(benefit = {}) {
  return /(유아|영유아|누리과정|유치원|어린이집|보육|방과후과정|3~5세|3-5세)/.test(benefitText(benefit));
}

function isLikelyChildOrCaregiverPolicy(benefit = {}) {
  return /(유아|영유아|아동|어린이|보육|유치원|초등|자녀|부양자녀|양육|출산|임신|보호자|가족돌봄|청소년)/.test(benefitText(benefit));
}

function suspiciousRuleWarning(benefit = {}) {
  const nodes = flattenRuleNodes(benefit.rule);
  if (!nodes.length) return '';
  const ageNodes = nodes.filter((node) => node.field === 'age' && node.op === 'between' && Array.isArray(node.value));
  const hasPreschoolAge = ageNodes.some((node) => Number(node.value[0]) <= 5 && Number(node.value[1]) <= 7);
  if (hasPreschoolAge && !isLikelyPreschoolPolicy(benefit)) {
    return '정책 내용과 만 3~5세 연령 조건이 맞지 않아 자동 판정을 보류했습니다. 정부24 상세정보가 다른 정책과 섞였을 가능성이 있습니다.';
  }
  const hasChildAge = ageNodes.some((node) => Number(node.value[1]) < 19);
  if (hasChildAge && !isLikelyChildOrCaregiverPolicy(benefit)) {
    return '정책 내용과 아동·청소년 연령 조건이 맞지 않아 자동 판정을 보류했습니다. 수집 상세정보가 다른 정책과 섞였을 가능성이 있습니다.';
  }
  return '';
}

export function evaluateRule(rule, profile) {
  const p = normalizeProfile(profile);
  const traces = [];
  function walk(node) {
    if (node.all) return node.all.map(walk).every(Boolean);
    if (node.any) return node.any.map(walk).some(Boolean);
    if (node.not) {
      const result = !walk(node.not);
      traces.push({ label: node.label || 'NOT condition', passed: result, detail: 'negated group' });
      return result;
    }
    const { field, op } = node;
    const expected = node.value;
    const actual = valueOf(p, field);
    const passed = compare(actual, op, expected);
    traces.push({ label: node.label || `${field} ${op} ${expected}`, passed, detail: `actual=${JSON.stringify(actual)}, expected=${JSON.stringify(expected)}` });
    return passed;
  }
  return [walk(rule), traces];
}

export function evaluateBenefit(benefit, profile) {
  const ruleWarning = suspiciousRuleWarning(benefit);
  const autoRuleReady = hasEffectiveRule(benefit.rule) && !ruleWarning;
  const [eligible, trace] = autoRuleReady ? evaluateRule(benefit.rule, profile) : [false, []];
  const matched = trace.filter((t) => t.passed).map((t) => t.label);
  const unmet = ruleWarning
    ? [ruleWarning]
    : (autoRuleReady
      ? trace.filter((t) => !t.passed).map((t) => t.label)
      : ['자격 조건을 자동 판정할 규칙이 부족해 추천 조합에서 제외했습니다.']);
  const warnings = ruleWarning ? [ruleWarning] : [];
  if (benefit.warning_rule) {
    const [warningPassed, warningTrace] = evaluateRule(benefit.warning_rule, profile);
    if (warningPassed) warnings.push(...warningTrace.filter((t) => t.passed).map((t) => t.label));
  }
  const monthlyValue = normalizeBenefitMonthlyValue(benefit);
  const publicUrl = publicUrlFromBenefit(benefit);
  const hadNonPublicUrl = Boolean(benefit.apply_url || benefit.source?.original_url);
  return {
    benefit_id: benefit.id,
    name: benefit.name,
    eligible,
    monthly_value: monthlyValue,
    domain: benefit.domain || '기타',
    priority: normalizeBenefitPriority(benefit, monthlyValue),
    unmet,
    matched,
    trace,
    warnings,
    conflict_group: benefit.exclusive_group || null,
    conflicts_with: benefit.conflicts_with || [],
    conflict_group_label: benefit.exclusive_group_label || benefit.conflict_group_label || '',
    conflict_reason: benefit.exclusive_group_reason || benefit.conflict_reason || '',
    required_docs: benefit.required_docs || [],
    apply_url: publicUrl,
    link_status: publicUrl ? 'ok' : (benefit.link_status || (hadNonPublicUrl ? 'api_trace_only' : 'missing')),
    link_reason: publicUrl ? '' : (benefit.link_reason || (hadNonPublicUrl ? 'API 호출 URL은 사용자용 링크가 아니므로 숨겼습니다.' : '공개 신청·상세 링크 없음')),
    source: benefit.source || null,
    source_label: benefit.source?.label || benefit.source_label || '',
    description: benefit.description || '',
    target: benefit.target || '',
  };
}

export function evaluateAll(benefits, profile) { return benefits.map((b) => evaluateBenefit(b, profile)); }
export function eligibleOnly(evaluations) { return evaluations.filter((ev) => ev.eligible); }

function isExplicitConflict(a, b) {
  return (a.conflicts_with || []).includes(b.benefit_id) || (b.conflicts_with || []).includes(a.benefit_id);
}

function isGroupConflict(a, b) {
  return Boolean(a.conflict_group && b.conflict_group && a.conflict_group === b.conflict_group);
}

function isConflicting(a, b) {
  return isGroupConflict(a, b) || isExplicitConflict(a, b);
}
function hasConflict(items) {
  for (let i = 0; i < items.length; i += 1) for (let j = i + 1; j < items.length; j += 1) if (isConflicting(items[i], items[j])) return true;
  return false;
}

function benefitObjectiveScore(item) {
  return Number(item.monthly_value || 0) * 1000 + Number(item.priority || 0);
}

function formatWon(value) {
  return `${Number(value || 0).toLocaleString('ko-KR')}원`;
}

function conflictBasis(a, b) {
  const basis = [];
  if (isGroupConflict(a, b)) {
    const label = a.conflict_group_label || b.conflict_group_label || a.conflict_group;
    const reason = a.conflict_reason || b.conflict_reason || '같은 중복수급 제한 묶음으로 분류되었습니다.';
    basis.push(`동일 중복수급 묶음(${label}): ${reason}`);
  }
  if (isExplicitConflict(a, b)) {
    basis.push('정책 데이터의 conflicts_with 필드에 서로 동시에 선택하기 어렵다고 명시되어 있습니다.');
  }
  if (!basis.length) basis.push('선택된 혜택과 명시적 충돌 조건이 감지되었습니다.');
  return basis;
}

function describeConflict(rejected, selected) {
  const blockers = selected.filter((s) => isConflicting(rejected, s));
  const primary = blockers
    .slice()
    .sort((a, b) => benefitObjectiveScore(b) - benefitObjectiveScore(a))[0];
  const basis = blockers.flatMap((b) => conflictBasis(rejected, b));
  const uniqueBasis = [...new Set(basis)];
  const comparison = primary
    ? `선택된 '${primary.name}'의 월환산 ${formatWon(primary.monthly_value)}, 중요도 ${primary.priority}점 / 제외된 '${rejected.name}'의 월환산 ${formatWon(rejected.monthly_value)}, 중요도 ${rejected.priority}점`
    : `제외된 '${rejected.name}'의 월환산 ${formatWon(rejected.monthly_value)}, 중요도 ${rejected.priority}점`;
  return {
    benefit_id: rejected.benefit_id,
    benefit_name: rejected.name,
    blockers: blockers.map((b) => ({ benefit_id: b.benefit_id, name: b.name, monthly_value: b.monthly_value, priority: b.priority })),
    reason: uniqueBasis.join(' / '),
    comparison,
  };
}

function explainRejectedByConflict(conflictDetails) {
  return conflictDetails.map((detail) => {
    const blockerNames = detail.blockers.map((b) => b.name).join(', ') || '선택된 다른 혜택';
    return `${detail.benefit_name}은(는) ${blockerNames}와 중복/충돌되어 제외했습니다. 사유: ${detail.reason}. 비교: ${detail.comparison}.`;
  });
}

function sortByObjectiveDesc(a, b) {
  const scoreDiff = benefitObjectiveScore(b) - benefitObjectiveScore(a);
  if (scoreDiff !== 0) return scoreDiff;
  const valueDiff = Number(b.monthly_value || 0) - Number(a.monthly_value || 0);
  if (valueDiff !== 0) return valueDiff;
  const priorityDiff = Number(b.priority || 0) - Number(a.priority || 0);
  if (priorityDiff !== 0) return priorityDiff;
  return String(a.name || '').localeCompare(String(b.name || ''), 'ko-KR');
}

function optimizeBenefitsExact(eligible) {
  let best = [];
  let bestScore = -1;
  const dfs = (idx, picked, score) => {
    if (idx === eligible.length) {
      if (score > bestScore || (score === bestScore && picked.length > best.length)) {
        bestScore = score;
        best = [...picked];
      }
      return;
    }
    dfs(idx + 1, picked, score);
    const candidate = eligible[idx];
    if (!picked.some((p) => isConflicting(p, candidate))) {
      dfs(idx + 1, [...picked, candidate], score + benefitObjectiveScore(candidate));
    }
  };
  dfs(0, [], 0);
  return best;
}

function componentIsCompleteGraph(component) {
  for (let i = 0; i < component.length; i += 1) {
    for (let j = i + 1; j < component.length; j += 1) {
      if (!isConflicting(component[i], component[j])) return false;
    }
  }
  return true;
}

function conflictComponents(eligible) {
  const visited = new Set();
  const components = [];
  for (const item of eligible) {
    if (visited.has(item.benefit_id)) continue;
    const stack = [item];
    const component = [];
    visited.add(item.benefit_id);
    while (stack.length) {
      const current = stack.pop();
      component.push(current);
      for (const other of eligible) {
        if (visited.has(other.benefit_id)) continue;
        if (isConflicting(current, other)) {
          visited.add(other.benefit_id);
          stack.push(other);
        }
      }
    }
    components.push(component);
  }
  return components;
}

function optimizeBenefitsByConflictComponents(eligible) {
  const EXACT_COMPONENT_LIMIT = 22;
  const selected = [];
  const modes = [];
  for (const component of conflictComponents(eligible)) {
    if (component.length === 1) {
      selected.push(component[0]);
      continue;
    }
    if (component.length <= EXACT_COMPONENT_LIMIT) {
      selected.push(...optimizeBenefitsExact(component));
      modes.push(`충돌군 ${component.length}건 정확 탐색`);
      continue;
    }
    if (componentIsCompleteGraph(component)) {
      selected.push([...component].sort(sortByObjectiveDesc)[0]);
      modes.push(`상호배타 충돌군 ${component.length}건 중 최고 금액 1건 선택`);
      continue;
    }
    const greedySelected = [];
    for (const candidate of [...component].sort(sortByObjectiveDesc)) {
      if (!greedySelected.some((p) => isConflicting(p, candidate))) greedySelected.push(candidate);
    }
    selected.push(...greedySelected);
    modes.push(`대형 복합 충돌군 ${component.length}건 휴리스틱 탐색`);
  }
  return { selected, modes };
}

export function optimizeBenefits(evaluations) {
  const eligible = evaluations.filter((ev) => ev.eligible);
  if (!eligible.length) {
    return {
      selected: [],
      rejected_due_to_conflict: [],
      conflict_details: [],
      total_monthly_value: 0,
      explanation: ['현재 조건에서 확정적으로 선택 가능한 혜택이 없습니다.'],
      optimization_mode: 'none',
    };
  }

  // 가능 혜택 수가 많아도 전체 2^n 탐색으로 브라우저를 멈추지 않도록,
  // 충돌 그래프를 독립 컴포넌트로 나눈 뒤 컴포넌트별로 정확 탐색한다.
  // 서로 충돌하지 않는 컴포넌트끼리는 독립이므로 각 컴포넌트의 최선 선택을 합치면 전체 최선이다.
  const { selected: best, modes } = optimizeBenefitsByConflictComponents(eligible);

  const selectedIds = new Set(best.map((b) => b.benefit_id));
  const rejected = eligible.filter((ev) => !selectedIds.has(ev.benefit_id) && best.some((s) => isConflicting(ev, s)));
  const conflictDetails = rejected.map((ev) => describeConflict(ev, best));
  const total = best.reduce((s, b) => s + b.monthly_value, 0);
  const explanation = explainRejectedByConflict(conflictDetails);
  if (modes.length) {
    explanation.unshift(`최적 조합 탐색: ${[...new Set(modes)].join(', ')}.`);
  }
  if (!explanation.length) explanation.push('선택된 혜택 간 명시적 충돌이 없습니다.');
  return {
    selected: best.sort(sortByObjectiveDesc),
    rejected_due_to_conflict: rejected,
    conflict_details: conflictDetails,
    total_monthly_value: total,
    explanation,
    optimization_mode: modes.some((m) => m.includes('휴리스틱')) ? 'component_heuristic' : 'component_exact',
  };
}

export function evaluateMonth(profile, benefits, month) {
  const projected = projectProfile(profile, month);
  const evaluations = evaluateAll(benefits, projected);
  const plan = optimizeBenefits(evaluations);
  const warnings = [];
  evaluations.filter((ev) => ev.eligible).forEach((ev) => warnings.push(...ev.warnings));
  return {
    label: month ? `${month}개월 후` : '현재',
    month,
    income: projected.monthly_income,
    benefit_value: plan.total_monthly_value,
    net_effect: projected.monthly_income + plan.total_monthly_value,
    selected_benefits: plan.selected.map((b) => b.name),
    gained: [], lost: [], warnings: [...new Set(warnings)].sort(),
  };
}

export function simulateTimeline(profile, benefits, checkpoints = DEFAULT_CHECKPOINTS) {
  const results = checkpoints.map((m) => evaluateMonth(profile, benefits, m));
  let prevSet = new Set(results[0]?.selected_benefits || []);
  results.forEach((result, idx) => {
    if (idx === 0) return;
    const current = new Set(result.selected_benefits);
    result.gained = [...current].filter((x) => !prevSet.has(x)).sort();
    result.lost = [...prevSet].filter((x) => !current.has(x)).sort();
    prevSet = current;
  });
  return results;
}

export function simulateIncomeCliff(profile, benefits, incomes = DEFAULT_INCOME_SCENARIOS) {
  const base = normalizeProfile(profile);
  const results = [];
  let prev = null;
  for (const income of incomes) {
    let status = base.employment_status;
    if (income > 0 && ['unemployed', 'job_seeker'].includes(status)) status = income < 1800000 ? 'part_time' : 'employed';
    const scenarioProfile = normalizeProfile({ ...base, monthly_income: income, employment_status: status, unemployment_benefit_receiving: income > 0 ? false : base.unemployment_benefit_receiving, income_percent_median: estimateIncomePercent(income, base.household_size) });
    const plan = optimizeBenefits(evaluateAll(benefits, scenarioProfile));
    const result = { label: `월소득 ${money(income)}`, month: 0, income, benefit_value: plan.total_monthly_value, net_effect: income + plan.total_monthly_value, selected_benefits: plan.selected.map((b) => b.name), gained: [], lost: [], warnings: [] };
    if (prev) {
      const currSet = new Set(result.selected_benefits);
      const prevSet = new Set(prev.selected_benefits);
      result.gained = [...currSet].filter((x) => !prevSet.has(x)).sort();
      result.lost = [...prevSet].filter((x) => !currSet.has(x)).sort();
      const incomeGain = result.income - prev.income;
      const netGain = result.net_effect - prev.net_effect;
      if (incomeGain > 0 && netGain < 0) result.warnings.push(`복지 절벽 감지: 명목소득은 ${money(incomeGain)} 증가했지만 순효과는 ${money(Math.abs(netGain))} 감소`);
      else if (result.lost.length && netGain < incomeGain * 0.5) result.warnings.push('혜택 상실로 순증가분이 크게 줄어듭니다.');
    }
    results.push(result);
    prev = result;
  }
  return results;
}

export function generateTimelineEvents(profile, benefits) {
  const timeline = simulateTimeline(profile, benefits, [0, 1, 3, 6, 12]);
  const events = [];
  const now = timeline[0];
  if (profile.unemployment_benefit_receiving && profile.unemployment_benefit_days_left <= 45) {
    events.push({ month: 0, title: '실업급여 종료 전환 준비', description: '실업급여 종료 전 국민취업지원제도·직업훈련 전환 가능성을 점검합니다.', action_items: ['구직활동 자료 정리', 'Work24 신청 가능 일정 확인', '실업급여 종료일 기준 대체 혜택 예약'], risk_level: 'warning' });
  }
  if (now?.selected_benefits?.length) {
    events.push({ month: 0, title: '현재 가능한 혜택 신청', description: `${now.selected_benefits.slice(0, 3).join(', ')} 중심으로 즉시 신청 우선순위를 잡습니다.`, action_items: ['필수 서류 준비', '중복/충돌 혜택 제외', '신청 URL 확인'], risk_level: 'success' });
  }
  timeline.slice(1).forEach((r) => {
    if (r.lost.length || r.warnings.length) events.push({ month: r.month, title: '자격 변동·복지 절벽 감지', description: `${r.lost.join(', ') || '일부 혜택'} 상실 가능성이 있습니다.`, action_items: ['소득 발생 시점 조정 검토', '대체 혜택 사전 신청', '상담사 검토 큐 등록'], risk_level: 'danger' });
    else if (r.gained.length) events.push({ month: r.month, title: '신규 혜택 가능성', description: `${r.gained.join(', ')} 신청 가능성이 생깁니다.`, action_items: ['소득증빙 준비', '신규 자격 신청 일정 확인'], risk_level: 'info' });
  });
  if (!events.length) events.push({ month: 1, title: '정기 재점검', description: '현재 조건에서는 급격한 자격 변동이 보이지 않습니다.', action_items: ['1개월 후 소득·주거 정보 갱신'], risk_level: 'info' });
  return events;
}

function riskGrade(score) {
  if (score >= 70) return '긴급';
  if (score >= 45) return '주의';
  return '안정';
}

export function computeProfileInsights(profile, benefits) {
  const p = normalizeProfile(profile);
  const evaluations = evaluateAll(benefits, p);
  const plan = optimizeBenefits(evaluations);
  const timeline = simulateTimeline(p, benefits, [0, 1, 3, 6, 12]);
  const cliff = simulateIncomeCliff(p, benefits);
  const warnings = cliff.flatMap((row) => row.warnings);
  const lostNext = [...new Set(timeline.slice(1, 3).flatMap((row) => row.lost))].sort();
  const gainedNext = [...new Set(timeline.slice(1, 3).flatMap((row) => row.gained))].sort();
  const rentBurden = Math.round((p.rent / Math.max(1, p.monthly_income + plan.total_monthly_value)) * 1000) / 10;
  const cashBuffer = p.monthly_income + plan.total_monthly_value - p.rent - p.debt_monthly_payment;
  let score = 0;
  const reasons = [];
  if (p.monthly_income === 0) { score += 18; reasons.push('현재 소득 공백'); }
  if (p.unemployment_benefit_receiving && p.unemployment_benefit_days_left <= 60) { score += 22; reasons.push(`실업급여 종료 D-${p.unemployment_benefit_days_left}`); }
  if (rentBurden >= 45) { score += 18; reasons.push(`주거비 부담 ${rentBurden}%`); }
  if (p.credit_score && p.credit_score < 650) { score += 10; reasons.push('낮은 신용점수'); }
  if (lostNext.length) { score += 18; reasons.push('1~3개월 내 상실 가능 혜택 존재'); }
  if (warnings.length) { score += 24; reasons.push('복지 절벽 경고 발생'); }
  if (p.crisis_event) { score += 15; reasons.push('위기사유 입력'); }
  score = Math.min(100, score);
  const recommendedActions = recommendNextActions(p, plan.selected, lostNext, warnings);
  return {
    priority_score: score,
    priority_grade: riskGrade(score),
    reasons: reasons.length ? reasons : ['즉시 감지된 고위험 신호는 낮음'],
    current_support: plan.total_monthly_value,
    selected_count: plan.selected.length,
    eligible_count: evaluations.filter((e) => e.eligible).length,
    rent_burden_percent: rentBurden,
    cash_buffer: cashBuffer,
    lost_next: lostNext,
    gained_next: gainedNext,
    cliff_warning_count: warnings.length,
    recommended_actions: recommendedActions,
  };
}

export function makeDocumentChecklist(selected) {
  const docs = new Map();
  selected.forEach((benefit) => {
    const required = benefit.required_docs?.length ? benefit.required_docs : ['본인확인', '소득자료'];
    required.forEach((doc) => {
      if (!docs.has(doc)) docs.set(doc, []);
      docs.get(doc).push(benefit.name);
    });
  });
  return [...docs.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ko-KR')).map(([doc, names]) => ({ 서류: doc, '관련 혜택': names.join(', '), 상태: '준비 필요' }));
}

export function recommendNextActions(profile, selected, lostNext = [], cliffWarnings = []) {
  const actions = [];
  if (selected.length) actions.push({ 우선순위: 1, 액션: `${selected[0].name} 신청 서류부터 준비`, 이유: '최적 조합에서 월 환산효과·우선순위가 높은 혜택입니다.' });
  if (profile.unemployment_benefit_receiving && profile.unemployment_benefit_days_left <= 45) actions.push({ 우선순위: 2, 액션: '실업급여 종료 전 고용지원 전환 상담 예약', 이유: '종료 후 국민취업지원제도·훈련 혜택으로 연결하기 위함입니다.' });
  if (lostNext.length) actions.push({ 우선순위: 3, 액션: `${lostNext.slice(0, 2).join(', ')} 상실 조건 점검`, 이유: '3개월 내 자격 변동 가능성이 있습니다.' });
  if (cliffWarnings.length) actions.push({ 우선순위: 4, 액션: '소득 발생 시점별 순효과 비교', 이유: '명목소득 증가와 순효과 감소가 동시에 발생할 수 있습니다.' });
  if (profile.rent > 0) actions.push({ 우선순위: 5, 액션: '임대차계약서·월세 이체내역 준비', 이유: '주거 지원 계열 신청 공통 서류입니다.' });
  return actions.slice(0, 5);
}

export function buildApplicationStrategy(profile, benefits) {
  const evaluations = evaluateAll(benefits, profile);
  const plan = optimizeBenefits(evaluations);
  const strategy = {};
  if (!plan.selected.length) {
    strategy['신청 전 확인'] = [
      '현재 입력한 정보만으로는 바로 신청할 수 있는 혜택이 뚜렷하게 확인되지 않습니다.',
      '나이, 거주지역, 월소득, 월세, 보증금, 실업급여 수급 여부를 다시 확인해 주세요.',
      '정책 공고문이나 임대차계약서처럼 근거가 되는 문서를 추가로 올리면 더 정확하게 다시 판정할 수 있습니다.',
    ];
    return strategy;
  }
  plan.selected.forEach((b, idx) => {
    strategy[b.name] = [
      `${idx + 1}순위로 신청하면 좋습니다. 예상 월 환산효과는 ${money(b.monthly_value)}입니다.`,
      `먼저 준비할 서류: ${(b.required_docs || []).slice(0, 4).join(', ') || '본인확인 서류와 소득 확인 자료'}`,
      b.apply_url ? `신청 전 이 안내 페이지에서 세부 조건을 한 번 더 확인하세요: ${b.apply_url}` : '신청 페이지가 아직 연결되지 않았습니다. 주민센터, 고용센터, 복지로, 정부24 등 실제 접수 기관의 최신 안내를 확인해 주세요.',
      b.warnings?.length ? `주의할 점: ${b.warnings.join(', ')}` : '현재 입력 정보 기준으로는 큰 주의 신호가 없습니다. 다만 실제 접수 전에는 최신 공고문과 제출 서류를 다시 확인해야 합니다.',
    ];
  });
  return strategy;
}

export function buildAgentPlan(profile, benefits, question = '') {
  const p = normalizeProfile(profile);
  const evaluations = evaluateAll(benefits, p);
  const plan = optimizeBenefits(evaluations);
  const insights = computeProfileInsights(p, benefits);
  const timeline = simulateTimeline(p, benefits, [0, 3]);
  const cliff = simulateIncomeCliff(p, benefits);
  const docs = makeDocumentChecklist(plan.selected);
  const actions = recommendNextActions(p, plan.selected, timeline[1]?.lost || [], cliff.flatMap((r) => r.warnings));
  const evidence = plan.selected.slice(0, 5).map((b) => ({ title: b.name, source: b.apply_url || 'local-catalog', text: b.description || b.name }));
  const answer = [
    `<strong>상담 우선도:</strong> ${insights.priority_score}점(${insights.priority_grade})`,
    `<br/><strong>현재 최적 월 환산효과:</strong> ${money(plan.total_monthly_value)}`,
    `<br/><strong>우선 신청:</strong> ${plan.selected.slice(0, 3).map((b) => b.name).join(', ') || '해당 없음'}`,
    timeline[1]?.lost?.length ? `<br/><strong>3개월 뒤 상실 위험:</strong> ${timeline[1].lost.join(', ')}` : '<br/><strong>3개월 뒤 상실 위험:</strong> 큰 변동 없음',
    `<br/><strong>질문 반영:</strong> ${question || '현재 프로필 기준 자동 분석'}`,
  ].join('');
  return {
    priority_score: insights.priority_score,
    priority_grade: insights.priority_grade,
    monthly_support: plan.total_monthly_value,
    selected_benefits: plan.selected.map((b) => b.name),
    actions,
    reasons: insights.reasons?.length ? insights.reasons : ['현재 입력 정보만으로는 긴급하게 상담사 확인이 필요한 신호가 크지 않습니다.'],
    evidence,
    answer_markdown: answer,
    tool_trace: [
      { tool: '입력 정보 정리', status: '확인 완료', detail: `${p.region}/${p.age}세/${p.household_size}인가구` },
      { tool: '혜택 조건 비교', status: '확인 완료', detail: `${evaluations.length}개 정책 판정, 가능 ${evaluations.filter((e) => e.eligible).length}개` },
      { tool: '유리한 혜택 조합 찾기', status: '확인 완료', detail: `선택 ${plan.selected.length}개, 월 ${money(plan.total_monthly_value)}` },
      { tool: '앞으로의 변화 미리보기', status: '확인 완료', detail: `3개월 상실 ${timeline[1]?.lost?.length || 0}건` },
      { tool: '준비 서류 정리', status: '확인 완료', detail: `서류 ${docs.length}종` },
    ],
  };
}

export function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((x) => x.trim().length);
  if (!lines.length) return [];
  const split = (line) => {
    const out = []; let cur = ''; let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur); return out.map((x) => x.trim());
  };
  const headers = split(lines[0]);
  return lines.slice(1).map((line) => Object.fromEntries(split(line).map((v, i) => [headers[i], v])));
}

function firstValue(row, keys, fallback = undefined) {
  for (const k of keys) if (row[k] !== undefined && row[k] !== '') return row[k];
  return fallback;
}
function toBool(v, def = false) { if (v === undefined || v === null || v === '') return def; return ['true', '1', 'yes', 'y', '예', '있음', '수급'].includes(String(v).trim().toLowerCase()); }
function toMoney(v, def = 0) { if (v === undefined || v === null || v === '') return def; if (/[만원천원원]/.test(String(v))) return moneyToInt(String(v), '만원'); return Math.trunc(numberInput(v, def)); }

export function profileFromRow(row) {
  const name = firstValue(row, ['name', '이름', '사용자', 'user_id'], 'anonymous');
  const profile = asProfile({
    age: Math.trunc(numberInput(firstValue(row, ['age', '나이', '만나이'], 27), 27)),
    region: normalizeRegion(firstValue(row, ['region', '지역', '거주지역'], '서울')),
    household_size: Math.trunc(numberInput(firstValue(row, ['household_size', '가구원수', '가구'], 1), 1)),
    employment_status: firstValue(row, ['employment_status', '고용상태'], 'unemployed'),
    monthly_income: toMoney(firstValue(row, ['monthly_income', '월소득', '소득'], 0)),
    expected_monthly_income: toMoney(firstValue(row, ['expected_monthly_income', '예상월소득'], 0)),
    expected_income_start_month: Math.trunc(numberInput(firstValue(row, ['expected_income_start_month', '예상소득발생월'], 3), 3)),
    rent: toMoney(firstValue(row, ['rent', '월세', '월임대료', 'housing_cost'], 0)),
    deposit: toMoney(firstValue(row, ['deposit', '보증금'], 0)),
    unemployment_benefit_receiving: toBool(firstValue(row, ['unemployment_benefit_receiving', '실업급여수급'], false)),
    unemployment_benefit_days_left: Math.trunc(numberInput(firstValue(row, ['unemployment_benefit_days_left', '실업급여잔여일'], 0), 0)),
    crisis_event: toBool(firstValue(row, ['crisis_event', '위기사유'], false)),
    medical_expense_3m: toMoney(firstValue(row, ['medical_expense_3m', '의료비'], 0)),
    credit_score: Math.trunc(numberInput(firstValue(row, ['credit_score', '신용점수'], 750), 750)),
    debt_monthly_payment: toMoney(firstValue(row, ['debt_monthly_payment', '월상환'], 0)),
    is_basic_livelihood: toBool(firstValue(row, ['is_basic_livelihood', '기초생활수급'], false)),
    is_near_poverty: toBool(firstValue(row, ['is_near_poverty', '차상위'], false)),
    wants_job_training: toBool(firstValue(row, ['wants_job_training', '직업훈련희망'], true), true),
  });
  const [clean, warnings] = validateProfile(profile);
  return [String(name), clean, warnings];
}

export function analyzeProfiles(rows, benefits) {
  const profiles = [];
  const resultRows = rows.map((row, idx) => {
    const [name, profile, warnings] = profileFromRow(row);
    profiles.push(profile);
    const insights = computeProfileInsights(profile, benefits);
    const plan = optimizeBenefits(evaluateAll(benefits, profile));
    return {
      순번: idx + 1,
      이름: name,
      지역: profile.region,
      나이: profile.age,
      상담우선도: insights.priority_score,
      등급: insights.priority_grade,
      가능혜택수: insights.eligible_count,
      선택혜택수: plan.selected.length,
      월환산효과: plan.total_monthly_value,
      최우선혜택: plan.selected[0]?.name || '',
      경고: [...warnings, ...insights.reasons].join(' / '),
    };
  });
  return [resultRows.sort((a, b) => b.상담우선도 - a.상담우선도), profiles];
}

export function templateCsv() {
  return 'name,age,region,household_size,employment_status,monthly_income,expected_monthly_income,expected_income_start_month,rent,deposit,unemployment_benefit_receiving,unemployment_benefit_days_left,credit_score,wants_job_training\n서울 실업급여 청년,27,서울,1,unemployed,0,800000,3,550000,5000000,true,45,690,true\n경기 파트타임 청년,24,경기,1,part_time,900000,1400000,6,450000,0,false,0,720,true';
}

export function buildCounterfactuals(profile, benefits) {
  const base = normalizeProfile(profile);
  const basePlan = optimizeBenefits(evaluateAll(benefits, base));
  const scenarios = [
    ['실업급여 종료 후 구직자 전환', { unemployment_benefit_receiving: false, unemployment_benefit_days_left: 0, employment_status: 'job_seeker' }],
    ['월소득 80만원 근로 시작', { monthly_income: 800000, employment_status: 'part_time', unemployment_benefit_receiving: false, income_percent_median: null }],
    ['직업훈련 희망 끄기', { wants_job_training: false }],
    ['위기사유 발생', { crisis_event: true }],
    ['월세 0원으로 변경', { rent: 0 }],
  ];
  return scenarios.map(([scenario, patch]) => {
    const p = normalizeProfile({ ...base, ...patch });
    const plan = optimizeBenefits(evaluateAll(benefits, p));
    const delta = plan.total_monthly_value - basePlan.total_monthly_value;
    return { scenario, 월환산효과: plan.total_monthly_value, delta, delta_label: money(delta), selected: plan.selected.map((b) => b.name).join(', ') };
  }).sort((a, b) => b.delta - a.delta);
}

export function buildAdminMetrics(profiles, benefits) {
  const rows = profiles.map((p) => ({ profile: normalizeProfile(p), insights: computeProfileInsights(p, benefits), plan: optimizeBenefits(evaluateAll(benefits, p)) }));
  const topMap = new Map();
  rows.forEach(({ plan }) => plan.selected.forEach((b) => topMap.set(b.name, (topMap.get(b.name) || 0) + 1)));
  const regionMap = new Map();
  rows.forEach(({ profile, plan, insights }) => {
    const cur = regionMap.get(profile.region) || { 지역: profile.region, 사용자수: 0, 평균지원: 0, 고위험: 0 };
    cur.사용자수 += 1; cur.평균지원 += plan.total_monthly_value; if (insights.priority_score >= 60) cur.고위험 += 1;
    regionMap.set(profile.region, cur);
  });
  const region_summary = [...regionMap.values()].map((r) => ({ ...r, 평균지원: Math.round(r.평균지원 / r.사용자수) }));
  return {
    total_profiles: profiles.length,
    high_cliff_risk: rows.filter((r) => r.insights.priority_score >= 60).length,
    average_monthly_support: Math.round(rows.reduce((s, r) => s + r.plan.total_monthly_value, 0) / Math.max(1, rows.length)),
    top_benefits: [...topMap.entries()].map(([혜택, 추천수]) => ({ 혜택, 추천수 })).sort((a, b) => b.추천수 - a.추천수).slice(0, 10),
    region_summary,
    pending_actions: rows.map(({ profile, insights, plan }, idx) => ({ id: idx + 1, 지역: profile.region, 나이: profile.age, 우선도: insights.priority_score, 등급: insights.priority_grade, 최우선혜택: plan.selected[0]?.name || '' })).sort((a, b) => b.우선도 - a.우선도),
  };
}

export function searchPolicies(query, benefits, topK = 8) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return benefits.map((b) => {
    const blob = `${b.name} ${b.domain} ${b.description} ${b.target}`.toLowerCase();
    const score = terms.reduce((s, t) => s + (blob.includes(t) ? 1 : 0), 0) + (b.priority || 0) / 1000;
    return { id: b.id, name: b.name, domain: b.domain, score: Math.round(score * 1000) / 1000, snippet: b.description };
  }).sort((a, b) => b.score - a.score).slice(0, topK);
}

export function buildTrustAudit(profile, benefits, agentPlan) {
  const p = normalizeProfile(profile);
  const controls = [
    { control: '조건별 자격 확인', status: '확인 완료', evidence: '등록된 정책 조건과 입력 정보를 비교했습니다.' },
    { control: '중복 신청 가능성 확인', status: '확인 완료', evidence: '동시에 받기 어려운 혜택을 제외하고 조합했습니다.' },
    { control: '상담사 확인 필요 여부', status: agentPlan.priority_score >= 60 ? '추가 확인 필요' : '확인 완료', evidence: `확인 우선도 ${agentPlan.priority_score}점` },
    { control: '개인정보 최소 사용', status: p.guardian_mode ? '추가 확인 필요' : '확인 완료', evidence: '화면에서 필요한 정보만 입력해 판정합니다.' },
    { control: '판정 근거 제공', status: agentPlan.evidence.length ? '확인 완료' : '추가 확인 필요', evidence: `${agentPlan.evidence.length}개 근거` },
  ];
  const auditScore = 100 - controls.filter((c) => c.status === '추가 확인 필요').length * 12;
  return { audit_score: auditScore, status: auditScore >= 85 ? '확인 완료' : '추가 확인 필요', controls };
}

export function buildAgentWorkflow(profile, benefits, question = '') {
  const plan = buildAgentPlan(profile, benefits, question);
  const audit = buildTrustAudit(profile, benefits, plan);
  const steps = [
    { step: 1, node: '정보 확인', action: '입력 정보 정리', result: `${profile.region}/${profile.age}` },
    { step: 2, node: '자격 확인', action: '혜택 조건 비교', result: `${plan.selected_benefits.length}개 최적 선택` },
    { step: 3, node: '변화 확인', action: '앞으로 달라질 수 있는 혜택 확인', result: `${plan.actions.length}개 액션` },
    { step: 4, node: '추가 확인', action: '상담사 확인 필요 여부 판단', result: audit.audit_score >= 85 ? '자동 확인 가능' : '상담사 확인 권장' },
  ];
  return { human_review_required: audit.audit_score < 85 || plan.priority_score >= 60, audit_score: audit.audit_score, steps };
}

export function buildApplicationWorkflow(profile, selected = []) {
  const tasks = [];
  selected.forEach((b, idx) => {
    tasks.push({ id: `wf-${idx + 1}-docs`, benefit: b.name, task: '서류 준비', due: 'D+3', status: 'todo' });
    tasks.push({ id: `wf-${idx + 1}-submit`, benefit: b.name, task: '신청 제출', due: 'D+7', status: 'todo' });
    tasks.push({ id: `wf-${idx + 1}-check`, benefit: b.name, task: '결과 확인', due: 'D+21', status: 'todo' });
  });
  if (!tasks.length) {
    tasks.push({ id: 'wf-profile-review', benefit: '내 정보 확인', task: '나이·지역·소득·주거 정보를 다시 확인하기', due: '오늘', status: 'todo' });
    tasks.push({ id: 'wf-document-upload', benefit: '근거 문서 추가', task: '정책 공고문 또는 신청 관련 서류를 추가로 올리기', due: '필요 시', status: 'todo' });
  }
  return { workflow_id: `wf-${profile.region}-${profile.age}-${selected.length}`, tasks };
}

export function planNotifications(profile, workflow) {
  return (workflow.tasks || []).map((t, idx) => ({ id: `noti-${idx + 1}`, channel: profile.guardian_mode ? '보호자 안내' : '앱 알림', title: `${t.benefit} · ${t.task}`, schedule: t.due, status: 'planned' }));
}

export function solveBenefitPortfolio(evaluations, maxItems = 6) {
  const plan = optimizeBenefits(evaluations);
  const selected = plan.selected.slice(0, maxItems).map((b) => ({ benefit: b.name, domain: b.domain, monthly_value: b.monthly_value, priority: b.priority, source: b.source_label || b.source?.label || '' }));
  return { selected, conflict_free: !hasConflict(plan.selected), conflict_details: plan.conflict_details || [], breakdown: { monthly_value: plan.total_monthly_value, priority_score: plan.selected.reduce((s, b) => s + b.priority, 0), objective_score: plan.total_monthly_value * 1000 + plan.selected.reduce((s, b) => s + b.priority, 0), max_items: maxItems, optimization_mode: plan.optimization_mode } };
}

export function extractPolicyFacts(text) {
  const t = String(text || '');
  const name = t.match(/정책명\s*[:：]\s*([^\n]+)/)?.[1]?.trim() || t.split('\n')[0]?.trim() || '업로드 정책';
  const age = t.match(/(\d{2})\s*세\s*[~\-]\s*(\d{2})\s*세/);
  const support = t.match(/(?:매월|월)?\s*(\d+(?:\.\d+)?)\s*만원/);
  const docs = t.match(/서류\s*[:：]\s*([^\n]+)/)?.[1]?.split(/[,，]/).map((x) => x.trim()).filter(Boolean) || [];
  const region = REGIONS.find((r) => t.includes(r));
  return { name, age_min: age ? Number(age[1]) : null, age_max: age ? Number(age[2]) : null, monthly_value: support ? Number(support[1]) * 10000 : 0, docs, region: region || '' };
}

export function draftBenefitFromText(text, sourceUrl = 'uploaded://policy-doc') {
  const facts = extractPolicyFacts(text);
  const rules = [];
  if (facts.age_min && facts.age_max) rules.push({ field: 'age', op: 'between', value: [facts.age_min, facts.age_max], label: `만 ${facts.age_min}~${facts.age_max}세` });
  if (facts.region) rules.push({ field: 'region', op: 'in', value: [facts.region], label: `${facts.region} 거주` });
  if (!rules.length) rules.push({ field: 'age', op: '>=', value: 0, label: '운영자 검수 필요' });
  return { id: `draft_${facts.name.replace(/\s+/g, '_').slice(0, 18)}`, name: facts.name, domain: /월세|주거|전월세/.test(text) ? '주거' : '기타', estimated_monthly_value: facts.monthly_value, priority: 50, description: String(text).slice(0, 180), required_docs: facts.docs, apply_url: sourceUrl, review_status: 'draft_requires_human_review', rule: { all: rules } };
}

export function buildEligibilityGraph(profile, evaluations) {
  const p = normalizeProfile(profile);
  const nodes = [{ id: 'profile', type: 'profile', label: `${p.region} ${p.age}세` }];
  const edges = [];
  evaluations.forEach((ev) => {
    nodes.push({ id: ev.benefit_id, type: 'benefit', label: ev.name });
    edges.push({ source: 'profile', target: ev.benefit_id, relation: ev.eligible ? 'eligible_for' : 'not_eligible_for', detail: ev.eligible ? ev.matched.slice(0, 2).join(', ') : ev.unmet.slice(0, 2).join(', ') });
  });
  return { nodes, edges };
}

export function graphRows(graph) {
  return [...graph.nodes.map((n) => ({ kind: 'node', ...n })), ...graph.edges.map((e) => ({ kind: 'edge', ...e }))];
}

export function runBenchmark(benefits) {
  const cases = [
    { name: '실업급여 서울 청년', profile: { age: 27, region: '서울', household_size: 1, employment_status: 'unemployed', monthly_income: 0, rent: 550000, unemployment_benefit_receiving: true, unemployment_benefit_days_left: 45, wants_job_training: true }, gold: ['실업급여', '주거'] },
    { name: '근로 저소득 청년', profile: { age: 31, region: '인천', household_size: 1, employment_status: 'employed', monthly_income: 1800000, rent: 600000, wants_job_training: true }, gold: ['근로장려', '내일'] },
    { name: '위기 저신용', profile: { age: 30, region: '대전', household_size: 1, employment_status: 'job_seeker', monthly_income: 200000, rent: 400000, crisis_event: true, credit_score: 620, debt_monthly_payment: 350000, is_near_poverty: true }, gold: ['긴급', '금융'] },
  ];
  const rows = cases.map((c) => {
    const plan = optimizeBenefits(evaluateAll(benefits, asProfile(c.profile)));
    const selected = plan.selected.map((b) => b.name);
    const hits = c.gold.filter((g) => selected.some((s) => s.includes(g))).length;
    return { case: c.name, selected: selected.join(', '), precision_proxy: hits / Math.max(1, selected.length), recall_proxy: hits / c.gold.length, conflict_violation: hasConflict(plan.selected) ? 1 : 0 };
  });
  return { metrics: { cases: cases.length, precision_proxy_avg: Number((rows.reduce((s, r) => s + r.precision_proxy, 0) / rows.length).toFixed(3)), recall_proxy_avg: Number((rows.reduce((s, r) => s + r.recall_proxy, 0) / rows.length).toFixed(3)), conflict_violation_rate: Number((rows.reduce((s, r) => s + r.conflict_violation, 0) / rows.length).toFixed(3)) }, rows };
}

export function validateStructuredPayload(payload, schemaName = 'UserProfile') {
  const [clean, warnings] = validateProfile(asProfile(payload));
  const errors = [];
  if (!Number.isFinite(Number(clean.age))) errors.push('age는 숫자여야 합니다.');
  if (!REGIONS.includes(clean.region)) errors.push('region은 지원 지역 목록 중 하나여야 합니다.');
  return { schema: schemaName, ok: errors.length === 0, errors, warnings, clean_payload: clean };
}

export function eventOpsDashboard(profile) {
  const p = normalizeProfile(profile);
  const events = [
    { event_id: `evt-${p.region}-${p.age}-profile`, event_type: 'profile.updated', subject_id: `${p.region}-${p.age}`, source: 'lifepass-react', payload: { age: p.age, region: p.region, income: p.monthly_income } },
    { event_id: `evt-${p.region}-${p.age}-eligibility`, event_type: 'eligibility.recalculated', subject_id: `${p.region}-${p.age}`, source: 'lifepass-react', payload: { rent: p.rent, employment_status: p.employment_status } },
  ];
  if (p.unemployment_benefit_receiving && p.unemployment_benefit_days_left <= 45) events.push({ event_id: `evt-${p.region}-${p.age}-cliff`, event_type: 'cliff_risk.detected', subject_id: `${p.region}-${p.age}`, source: 'lifepass-react', payload: { days_left: p.unemployment_benefit_days_left } });
  const rows = events.map((e, idx) => ({ id: idx + 1, topic: e.event_type, status: 'ready', event_id: e.event_id }));
  return { metrics: { events_generated: events.length, event_types: new Set(events.map((e) => e.event_type)).size, outbox_ready: rows.length, dead_letter: 0 }, events, outbox: { rows }, consumers: [{ consumer: 'eligibility-worker', topic: 'profile.updated' }, { consumer: 'notification-worker', topic: 'cliff_risk.detected' }, { consumer: 'audit-worker', topic: '*' }] };
}

export function simulatePolicyImpact(profiles, benefits, ageUpper = 39, valueMultiplier = 1) {
  const scenarioBenefits = clone(benefits).map((b) => {
    const patched = clone(b);
    if (/청년/.test(patched.name)) {
      patched.estimated_monthly_value = Math.round((patched.estimated_monthly_value || 0) * valueMultiplier);
      const patchRule = (node) => {
        if (node.all) node.all.forEach(patchRule);
        if (node.any) node.any.forEach(patchRule);
        if (node.field === 'age' && node.op === 'between' && Array.isArray(node.value)) node.value[1] = ageUpper;
      };
      patchRule(patched.rule);
    }
    return patched;
  });
  const rows = profiles.map((p, idx) => {
    const base = optimizeBenefits(evaluateAll(benefits, p));
    const next = optimizeBenefits(evaluateAll(scenarioBenefits, p));
    return { id: idx + 1, region: p.region, age: p.age, before: base.total_monthly_value, after: next.total_monthly_value, delta: next.total_monthly_value - base.total_monthly_value, newly_supported: base.total_monthly_value === 0 && next.total_monthly_value > 0 ? 'Y' : 'N' };
  });
  const monthlyDelta = rows.reduce((s, r) => s + r.delta, 0);
  return { scenario: { age_upper: ageUpper, value_multiplier: valueMultiplier }, metrics: { profiles_simulated: profiles.length, newly_supported: rows.filter((r) => r.newly_supported === 'Y').length, monthly_budget_delta: monthlyDelta, annualized_budget_delta: monthlyDelta * 12 }, rows, decision_use: '청년 정책 연령·지원금 변경 전 예산 영향과 신규 지원 규모를 시뮬레이션합니다.' };
}

export function checkAccess(role, action, purpose, fields) {
  const allowedByRole = { citizen: ['age', 'region', 'household_size'], counselor: ['age', 'region', 'household_size', 'monthly_income', 'rent', 'deposit', 'credit_score'], supervisor: ['age', 'region', 'household_size', 'monthly_income', 'rent', 'deposit', 'credit_score', 'medical_expense_3m'], auditor: ['age', 'region', 'household_size'], admin: ['age', 'region', 'household_size', 'monthly_income', 'rent', 'deposit', 'credit_score', 'medical_expense_3m'] };
  const allowed = allowedByRole[role] || [];
  const deniedFields = [...fields].filter((f) => !allowed.includes(f));
  const purposeOk = ['eligibility_screening', 'application_support', 'audit', 'analytics'].includes(purpose);
  return { role, action, purpose, requested_fields: [...fields], decision: deniedFields.length || !purposeOk ? 'deny' : 'allow', denied_fields: deniedFields, reason: deniedFields.length ? 'role field scope exceeded' : 'purpose and role scope ok' };
}

export function privacySecurityPack(profile) {
  const access = checkAccess('counselor', 'read:assigned', 'eligibility_screening', ['age', 'region', 'monthly_income', 'rent', 'deposit']);
  const synthetic = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, age: Math.max(19, profile.age + (i % 5) - 2), region: REGIONS[(REGIONS.indexOf(profile.region) + i + REGIONS.length) % REGIONS.length], monthly_income: Math.max(0, profile.monthly_income + (i - 3) * 100000), rent: Math.max(0, profile.rent + (i % 3 - 1) * 50000) }));
  return { access_decision: access, dp_demo: { epsilon: 1, noisy_count: synthetic.length + 1 }, privacy_budget: [{ purpose: 'eligibility_screening', epsilon: 0.2, status: 'ok' }, { purpose: 'analytics', epsilon: 0.5, status: 'ok' }, { purpose: 'debugging', epsilon: 0.0, status: 'blocked' }], synthetic_profiles: synthetic };
}

export function estimateInterventionEffects(profile) {
  const p = normalizeProfile(profile);
  const baseRisk = Math.min(1, Math.max(0.05, (p.rent + p.debt_monthly_payment - p.monthly_income) / 1500000 + (p.unemployment_benefit_days_left <= 45 && p.unemployment_benefit_receiving ? 0.25 : 0)));
  const interventions = [
    ['서류 준비 체크리스트 자동 알림', 0.09, 1200],
    ['상담사 전화 팔로업', 0.14, 9000],
    ['실업급여 종료 전 전환상담 예약', p.unemployment_benefit_receiving ? 0.19 : 0.05, 5000],
    ['월세지원 증빙 자동 점검', p.rent > 0 ? 0.12 : 0.03, 2000],
  ].map(([intervention, uplift, cost]) => ({ intervention, uplift, cost, roi_proxy: Number(((uplift * 50000) / cost).toFixed(2)), risk_after: Number(Math.max(0, baseRisk - uplift).toFixed(2)) })).sort((a, b) => b.roi_proxy - a.roi_proxy);
  return { base_dropoff_risk: Number(baseRisk.toFixed(2)), recommended_interventions: interventions };
}

export function qualityOpsPack() {
  return { data_contract: { required_fields: ['age', 'region', 'monthly_income', 'rent'], freshness_sla_hours: 24, pii_policy: 'minimize' }, model_card: { model: 'deterministic rule engine', llm_role: 'explanation only', eligibility_source: 'benefits.json' }, sla_playbook: [{ incident: '정책 원문 변경', severity: 'high', action: 'catalog diff review' }, { incident: 'API 수집 실패', severity: 'medium', action: 'cached mode + retry' }, { incident: '추천 충돌 감지', severity: 'high', action: 'human review' }] };
}

export function makeMarkdownReport(profile, benefits) {
  const p = normalizeProfile(profile);
  const plan = optimizeBenefits(evaluateAll(benefits, p));
  const timeline = simulateTimeline(p, benefits, [0, 3, 6, 12]);
  return `# LifePass 분석 리포트\n\n## 프로필\n- 나이: ${p.age}\n- 지역: ${p.region}\n- 월소득: ${money(p.monthly_income)}\n- 월세: ${money(p.rent)}\n\n## 현재 최적 조합\n${plan.selected.map((b) => `- ${b.name}: ${money(b.monthly_value)}`).join('\n') || '- 해당 없음'}\n\n## 미래 시뮬레이션\n${timeline.map((r) => `- ${r.label}: 소득 ${money(r.income)}, 혜택 ${money(r.benefit_value)}, 순효과 ${money(r.net_effect)}`).join('\n')}\n`;
}

export function downloadText(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}