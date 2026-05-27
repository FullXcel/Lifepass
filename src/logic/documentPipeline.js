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
  age: '나이',
  region: '지역',
  district: '시군구',
  household_size: '가구원 수',
  employment_status: '고용상태',
  monthly_income: '현재 월소득',
  expected_monthly_income: '예상 월소득',
  expected_income_start_month: '예상 소득 발생 월',
  rent: '월세',
  deposit: '보증금',
  assets_million: '자산(백만원)',
  unemployment_benefit_receiving: '실업급여 수급 여부',
  unemployment_benefit_days_left: '실업급여 잔여일',
  crisis_event: '위기사유',
  medical_expense_3m: '최근 3개월 의료비',
  credit_score: '신용점수',
  debt_monthly_payment: '월 대출상환액',
  is_basic_livelihood: '기초생활수급',
  is_near_poverty: '차상위',
  has_housing_contract: '임대차계약 여부',
  wants_job_training: '직업훈련 희망',
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
  expected_income_start_month: ['expected_income_start_month', '예상소득시작월', '소득발생월', '취업예정개월'],
  rent: ['rent', '월세', '임대료', '월 임대료'],
  deposit: ['deposit', '보증금', '임대보증금'],
  assets_million: ['assets_million', '자산', '재산', '자산백만원'],
  unemployment_benefit_receiving: ['unemployment_benefit_receiving', '실업급여', '구직급여', '실업급여수급'],
  unemployment_benefit_days_left: ['unemployment_benefit_days_left', '실업급여잔여일', '수급잔여일', '잔여일'],
  crisis_event: ['crisis_event', '위기사유', '긴급', '생계곤란'],
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

function matchSchemaKey(header) {
  const n = normalizeHeader(header);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some((a) => normalizeHeader(a) === n || n.includes(normalizeHeader(a)))) return field;
  }
  return null;
}

function moneyToWon(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Math.trunc(value);
  const text = String(value).replaceAll(',', '').trim();
  const m = text.match(/(-?\d+(?:\.\d+)?)\s*(억원|천만원|백만원|만원|천원|원)?/);
  if (!m) return numberInput(text, 0);
  const num = Number(m[1]);
  const unit = m[2] || '원';
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
  if (['monthly_income', 'expected_monthly_income', 'rent', 'deposit', 'medical_expense_3m', 'debt_monthly_payment'].includes(field)) return moneyToWon(value);
  if (field === 'assets_million') {
    const won = moneyToWon(value);
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

  const patterns = [
    ['age', /(?:만\s*)?(\d{2})\s*(?:세|살|연령)/, (m) => Number(m[1])],
    ['household_size', /(\d+)\s*인\s*가구/, (m) => Number(m[1])],
    ['monthly_income', /(?:월소득|소득|근로소득|월급|수입)\s*(?:은|이|:|：)?\s*(\d+(?:\.\d+)?\s*(?:만원|천원|원)?)/, (m) => moneyToWon(m[1])],
    ['expected_monthly_income', /(?:예상|예정)[^\n]{0,20}?(?:소득|월급|수입)\s*(?:은|이|:|：)?\s*(\d+(?:\.\d+)?\s*(?:만원|천원|원)?)/, (m) => moneyToWon(m[1])],
    ['rent', /(?:월세|임대료|차임)\s*(?:은|이|:|：)?\s*(\d+(?:\.\d+)?\s*(?:만원|천원|원)?)/, (m) => moneyToWon(m[1])],
    ['deposit', /(?:보증금|임대보증금)\s*(?:은|이|:|：)?\s*(\d+(?:\.\d+)?\s*(?:만원|천원|원)?)/, (m) => moneyToWon(m[1])],
    ['unemployment_benefit_days_left', /(?:실업급여|구직급여|수급)[^\n]{0,25}?(\d+)\s*일/, (m) => Number(m[1])],
    ['credit_score', /(?:신용점수|신용)\s*(?:은|이|:|：)?\s*(\d{3,4})/, (m) => Number(m[1])],
    ['debt_monthly_payment', /(?:월상환|대출상환|상환액)\s*(?:은|이|:|：)?\s*(\d+(?:\.\d+)?\s*(?:만원|천원|원)?)/, (m) => moneyToWon(m[1])],
    ['medical_expense_3m', /(?:의료비|병원비)\s*(?:은|이|:|：)?\s*(\d+(?:\.\d+)?\s*(?:만원|천원|원)?)/, (m) => moneyToWon(m[1])],
  ];

  for (const [field, regex, parser] of patterns) {
    const match = t.match(regex);
    if (match) {
      const value = parser(match);
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
  if (!profile.age || profile.age === DEFAULT_PROFILE.age) issues.push('나이가 문서에서 확실히 추출되지 않았습니다.'); else confirmations.push('나이 추출 확인');
  if (!profile.region || profile.region === DEFAULT_PROFILE.region) issues.push('지역이 기본값일 수 있습니다. 원문 근거를 확인하세요.'); else confirmations.push('지역 추출 확인');
  if (!profile.monthly_income && !/(소득 없음|무소득|월소득 0|소득 0)/.test(extraction.rawText || '')) issues.push('월소득이 0원으로 해석되었습니다. 실제 무소득인지 확인하세요.');
  if (profile.rent > 0 && !profile.has_housing_contract) issues.push('월세가 있으나 임대차계약 근거가 부족합니다.'); else if (profile.rent > 0) confirmations.push('월세/주거 정보 확인');
  const evidenceFields = new Set((extraction.evidence || []).map((x) => x.field));
  const missingEvidence = ['age', 'region', 'monthly_income', 'rent'].filter((f) => !evidenceFields.has(f));
  return { profile: safe, ok: issues.length === 0 || issues.length <= 2, issues, confirmations, missingEvidence, evidence: extraction.evidence || [] };
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
  return { text, parser: 'hwp-binary-visible-string-fallback', warnings: ['구형 .hwp 바이너리는 완전 파싱이 제한됩니다. HWPX로 변환하거나 OCR 검증을 권장합니다.'] };
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
  return {
    file: { name: file.name, size: file.size, type: file.type },
    parser: extraction.parser,
    parserWarnings: extraction.warnings || [],
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
    { item: '나이', status: evidenceFields.has('age') ? '확인' : '확인 필요', reason: '연령 조건 판정의 핵심 필드' },
    { item: '지역', status: evidenceFields.has('region') ? '확인' : '확인 필요', reason: '지자체 정책 매칭의 핵심 필드' },
    { item: '소득', status: evidenceFields.has('monthly_income') ? '확인' : '확인 필요', reason: '소득 기준 및 복지절벽 판정의 핵심 필드' },
    { item: '주거비', status: evidenceFields.has('rent') ? '확인' : '선택 확인', reason: '월세/주거급여 계열 정책 판정에 필요' },
    { item: '실업급여', status: evidenceFields.has('unemployment_benefit_receiving') || evidenceFields.has('unemployment_benefit_days_left') ? '확인' : '선택 확인', reason: '생애전환/실업급여 종료 위험 산정' },
  ];
}

export function profileToEditableRows(profile) {
  const p = normalizeProfile(profile);
  return Object.entries(FIELD_LABELS).map(([field, label]) => ({ field, label, value: p[field] }));
}

export { FIELD_LABELS, HEADER_ALIASES, moneyToWon };
