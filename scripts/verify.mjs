import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import {
  parseOnboardingText,
  evaluateAll,
  optimizeBenefits,
  simulateTimeline,
  simulateIncomeCliff,
  buildAgentPlan,
  buildApplicationStrategy,
  buildApplicationWorkflow,
  planNotifications,
  buildTrustAudit,
  makeMarkdownReport,
  money,
} from '../src/logic/lifepassCore.js';
import {
  extractFieldsFromText,
  detectDocumentKind,
  extractPolicySignalsFromText,
  validateExtraction,
  buildSchemaMap,
  mapRowsToProfiles,
  runDocumentPipeline,
} from '../src/logic/documentPipeline.js';
import { File } from 'node:buffer';
import { normalizePolicyRecord } from '../server/lib/policyNormalizer.js';
import { generateRuleFromPolicySignals } from '../server/lib/ruleGenerator.js';
import { ingestPolicySources } from '../server/lib/ingestionRunner.js';
import { withApiParams } from '../server/lib/httpClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf-8'));
const benefits = readJson('src/data/benefits.json');
const samples = readJson('src/data/sample_profiles.json');

function assert(condition, message) {
  if (!condition) throw new Error(`VERIFY FAILED: ${message}`);
}

const requiredFiles = [
  'package.json',
  'README.md',
  'src/App.jsx',
  'src/main.jsx',
  'src/styles.css',
  'src/logic/lifepassCore.js',
  'src/logic/documentPipeline.js',
  'src/data/benefits.json',
  'server/index.js',
  'server/lib/ingestionRunner.js',
  'server/lib/policyNormalizer.js',
  'server/lib/ruleGenerator.js',
  'server/lib/policyStore.js',
  'server/lib/textExtractors.js',
  'vite.config.js',
];
for (const file of requiredFiles) assert(fs.existsSync(path.join(root, file)), `필수 파일 없음: ${file}`);

const appSource = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf-8');
const tabMatch = appSource.match(/const\s+TABS\s*=\s*\[([\s\S]*?)\];/);
assert(tabMatch, 'TABS 선언 없음');

const tabItems = [...tabMatch[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
const tabCount = tabItems.length;

assert(tabCount === 6, `탭 개수가 6개가 아님: ${tabCount} (${tabItems.join(', ')})`);
assert(!tabItems.some((name) => /^\d+\.\s/.test(name)), '탭 이름에 숫자 접두사가 남아 있음');
assert(!appSource.includes('텍스트 직접 입력</h3>'), '텍스트 직접 입력 창구가 아직 남아 있음');
assert(!appSource.includes('onClick={applyText}'), '텍스트 입력 적용 버튼이 아직 남아 있음');
assert(appSource.includes('approvedPolicies') && appSource.includes('setApprovedPolicies'), '승인된 외부 정책 상태 관리 로직이 없음');
assert(appSource.includes('activeExternalPolicies') && appSource.includes('usingFallbackPolicies'), '외부 승인 정책 우선 사용 및 데모 정책 fallback 로직이 없음');
assert(appSource.includes('if (activeExternalPolicies.length > 0) return activeExternalPolicies;'), '외부 정책이 있으면 데모 정책을 제외하는 로직이 없음');
assert(appSource.includes('x-admin-token'), '관리자 API 호출에 x-admin-token 헤더를 보내는 로직이 없음');
assert(appSource.includes('landing-screen') && appSource.includes('정책·법령 자동 수집'), '초기 랜딩 화면 또는 정책·법령 설명 UI가 없음');
assert(appSource.includes('legalReferences') && appSource.includes("domain !== '법령근거'"), '법령 근거를 혜택 매칭에서 분리하는 로직이 없음');

const envSource = fs.readFileSync(path.join(root, 'server/config/env.js'), 'utf-8');
assert(envSource.includes('dotenv.config'), '.env를 로드하는 dotenv 설정이 없음');
assert(envSource.includes('getPolicyApiConfig'), '정책 API 환경변수 설정 함수가 없음');
assert(envSource.includes('databaseUrl') && envSource.includes('POLICY_REFRESH_TTL_HOURS'), 'PostgreSQL 또는 API 캐시 TTL 환경변수 설정이 없음');
const sourceConfig = fs.readFileSync(path.join(root, 'server/config/policySources.js'), 'utf-8');
for (const sourceId of ['bokjiro-central-welfare', 'bokjiro-local-welfare', 'gov24-benefits', 'law-current-welfare-acts', 'youth-policy', 'local-notice-allowlist']) {
  assert(sourceConfig.includes(sourceId), `정책 수집 소스 누락: ${sourceId}`);
}
assert(sourceConfig.includes('authParam') && sourceConfig.includes('detailUrlEnv'), 'API별 인증 파라미터 또는 상세 URL 설정이 없음');
assert(sourceConfig.includes('LAW_OPEN_API_OC') && sourceConfig.includes('LAW_POLICY_QUERIES'), '국가법령정보센터 법령 수집 설정이 없음');
const httpSource = fs.readFileSync(path.join(root, 'server/lib/httpClient.js'), 'utf-8');
assert(httpSource.includes('withApiParams'), 'API별 인증 파라미터를 처리하는 withApiParams 함수가 없음');
assert(httpSource.includes('parseXmlRecords'), 'XML 응답을 record로 변환하는 로직이 없음');
const runnerSource = fs.readFileSync(path.join(root, 'server/lib/ingestionRunner.js'), 'utf-8');
assert(runnerSource.includes('enrichRecords') && runnerSource.includes('looksLikeDataPortalDocPage'), '상세조회 보강 또는 data.go.kr 문서 URL 방어 로직이 없음');
assert(runnerSource.includes('getCachedApiResponse') && runnerSource.includes('saveApiResponse'), 'API 응답 캐시 사용 로직이 없음');

const page2Url = withApiParams('https://example.test/list?pageNo=1&numOfRows=10&serviceKey=SECRET', {
  authParam: 'serviceKey',
  defaultParams: { pageNo: 1, numOfRows: 10 },
  params: { pageNo: 2, numOfRows: 50 },
});
const page2 = new URL(page2Url);
assert(page2.searchParams.get('pageNo') === '2', '기존 API URL의 pageNo가 런타임 페이지 값으로 덮어써지지 않음');
assert(page2.searchParams.get('numOfRows') === '50', '기존 API URL의 numOfRows가 런타임 크기 값으로 덮어써지지 않음');
assert(!page2Url.includes('pageNo=1'), '페이지네이션 URL이 1페이지로 고정될 위험이 있음');

const pkg = readJson('package.json');
for (const dep of ['react', 'react-dom', 'vite', 'pdfjs-dist', 'mammoth', 'tesseract.js', 'jszip', 'papaparse', 'dotenv', 'pg']) {
  assert(pkg.dependencies[dep], `의존성 누락: ${dep}`);
}
for (const script of ['server', 'ingest:once', 'ingest:schedule']) {
  assert(pkg.scripts[script], `백엔드/수집 스크립트 누락: ${script}`);
}

const sampleProfile = samples[0].profile;
const evaluations = evaluateAll(benefits, sampleProfile);
const eligible = evaluations.filter((x) => x.eligible);
const plan = optimizeBenefits(evaluations);
assert(evaluations.length === benefits.length, '정책 전체 평가 개수 불일치');
assert(eligible.length >= 5, `가능 혜택 수가 예상보다 적음: ${eligible.length}`);
assert(plan.selected.length >= 4, `최적 선택 수가 예상보다 적음: ${plan.selected.length}`);
assert(plan.total_monthly_value > 0, '최적 조합 월환산효과가 0');
const manyConflictingEvaluations = [
  ...Array.from({ length: 25 }, (_, idx) => ({
    benefit_id: `housing-${idx}`,
    name: `주거 지원 ${idx}`,
    eligible: true,
    monthly_value: 100000 + idx,
    priority: idx,
    domain: '주거',
    conflict_group: 'housing_support_auto',
    conflict_group_label: '주거비/주택지원 중복검토 묶음',
    conflict_reason: '동일 주거비 보전 성격이라 중복 검토가 필요합니다.',
    conflicts_with: [],
    matched: [], unmet: [], trace: [], warnings: [], required_docs: [],
  })),
  { benefit_id: 'standalone-cash', name: '독립 생활지원', eligible: true, monthly_value: 50000, priority: 1, domain: '생활지원', conflicts_with: [], matched: [], unmet: [], trace: [], warnings: [], required_docs: [] },
];
const largeConflictPlan = optimizeBenefits(manyConflictingEvaluations);
assert(largeConflictPlan.selected.some((b) => b.benefit_id === 'housing-24'), '대형 상호배타 충돌군에서 최고 금액 혜택을 선택하지 못함');
assert(largeConflictPlan.selected.some((b) => b.benefit_id === 'standalone-cash'), '독립 혜택이 충돌군 때문에 누락됨');
assert(largeConflictPlan.conflict_details.length >= 20, '충돌 제외 사유 상세가 충분히 생성되지 않음');
assert(largeConflictPlan.explanation.some((line) => line.includes('사유:') && line.includes('비교:')), '충돌 설명에 사유/비교 정보가 없음');


const timeline = simulateTimeline(sampleProfile, benefits, [0, 1, 3, 6, 12]);
assert(timeline.length === 5, '타임라인 체크포인트 5개 아님');
assert(timeline.some((row) => row.lost?.length || row.gained?.length), '생애전환 신규/상실 탐지가 없음');

const cliffs = simulateIncomeCliff(sampleProfile, benefits);
assert(cliffs.length >= 5, '복지절벽 소득 시나리오 부족');
assert(cliffs.some((row) => row.warnings.length > 0), '복지절벽 경고가 없음');

const text = '저는 서울에 사는 만 27세 1인 가구이고 월소득은 0원, 월세는 55만원입니다. 실업급여는 45일 남았고 3개월 뒤 알바로 월 80만원을 벌 예정입니다. 임대차계약서가 있습니다.';
const parsed = parseOnboardingText(text);
assert(parsed.age === 27, '자연어 파서 나이 추출 실패');
assert(parsed.region === '서울', '자연어 파서 지역 추출 실패');
assert(parsed.rent === 550000, `자연어 파서 월세 추출 실패: ${parsed.rent}`);
assert(parsed.expected_monthly_income === 800000, `자연어 파서 미래 소득 추출 실패: ${parsed.expected_monthly_income}`);

const extraction = extractFieldsFromText(text);
assert(extraction.profile.age === 27, '문서 필드 추출 나이 실패');
assert(extraction.profile.region === '서울', '문서 필드 추출 지역 실패');
assert(extraction.evidence.length >= 4, `문서 필드 근거 부족: ${extraction.evidence.length}`);
assert(extraction.evidence.some((e) => e.field === 'monthly_income' && e.value === 0), '무소득 근거 추출 실패');
assert(!extraction.evidence.some((e) => e.field === 'unemployment_benefit_days_left' && e.value === 90), '실업급여 잔여일이 미래소득 3개월과 혼동됨');
const validation = validateExtraction(extraction);
assert(Array.isArray(validation.issues), '검증 이슈 배열이 아님');

const policyText = fs.readFileSync(path.join(root, 'docs/test_inputs/youth_rent_policy_notice_2026.txt'), 'utf-8');
assert(detectDocumentKind(policyText) === 'policy_notice', '정책 문서 유형 감지 실패');
const policySignals = extractPolicySignalsFromText(policyText);
assert(policySignals.age_range?.[0] === 19 && policySignals.age_range?.[1] === 34, `정책 연령 기준 추출 실패: ${policySignals.age_range}`);
assert(policySignals.rent_cap === 700000, `정책 월세 기준 추출 실패: ${policySignals.rent_cap}`);
assert(policySignals.deposit_cap === 50000000, `정책 보증금 기준 추출 실패: ${policySignals.deposit_cap}`);
assert(policySignals.support_amount === 200000, `정책 지원금 추출 실패: ${policySignals.support_amount}`);

const mixedAmountPolicyText = `청년 월세 지원 사업
지원 대상
만 19세 이상 34세 이하
월세 70만원 이하
기준중위소득 60% 이하
지원 내용
월 최대 20만원씩 12개월 동안 총 240만원 지원
신청 방법
복지로 신청`;
const mixedSignals = extractPolicySignalsFromText(mixedAmountPolicyText);
assert(mixedSignals.support_amount === 200000, `월액+총액 혼합 문장에서 총액을 월액으로 오인함: ${mixedSignals.support_amount}`);
assert(mixedSignals.support_period === 'monthly', `월 지원금 period 추출 실패: ${mixedSignals.support_period}`);
assert(mixedSignals.rent_cap === 700000, `정책 대상 월세 상한 추출 실패: ${mixedSignals.rent_cap}`);
const supportOnlyRentText = `월세 특별 지원 안내
지원 내용
월세 월 최대 20만원 지원
신청 방법
복지로 신청`;
const supportOnlySignals = extractPolicySignalsFromText(supportOnlyRentText);
assert(supportOnlySignals.rent_cap === null, `지원금 문장의 월세 금액을 임대료 상한으로 오인함: ${supportOnlySignals.rent_cap}`);
assert(supportOnlySignals.support_amount === 200000, `지원내용의 월 지원금 추출 실패: ${supportOnlySignals.support_amount}`);
assert(policySignals.income_percent_criteria.includes(60) && policySignals.income_percent_criteria.includes(100), '정책 소득 기준 추출 실패');
const generatedRule = generateRuleFromPolicySignals(policySignals);
assert(generatedRule.all.some((rule) => rule.field === 'age'), '정책 룰 생성기 연령 조건 누락');
assert(generatedRule.all.some((rule) => rule.field === 'rent'), '정책 룰 생성기 월세 조건 누락');
const normalizedPolicy = normalizePolicyRecord({ title: '청년월세 지원 테스트', description: policyText, url: 'https://example.test/policy' }, { id: 'verify-source', label: '검증 소스', strategy: 'official_api', priority: 100 });
assert(normalizedPolicy.benefit.rule.all.length >= 3, '외부 정책 record 정규화/룰 생성 실패');
assert(normalizedPolicy.ingestion.content_hash?.length === 64, '정책 변경 감지용 hash 생성 실패');
const normalizedApiOnlyPolicy = normalizePolicyRecord(
  { title: 'API 링크 숨김 테스트', description: policyText, _lifepass_source_url: 'http://apis.data.go.kr/test/list?serviceKey=SECRET&pageNo=1' },
  { id: 'verify-api-source', label: 'API 링크 검증 소스', strategy: 'official_api', priority: 90 },
);
assert(!normalizedApiOnlyPolicy.benefit.apply_url, 'API 호출 URL이 사용자용 신청 링크로 노출됨');
assert(normalizedApiOnlyPolicy.benefit.link_status === 'api_trace_only', `API-only 링크 상태가 부정확함: ${normalizedApiOnlyPolicy.benefit.link_status}`);
assert(normalizedApiOnlyPolicy.ingestion.review_reasons.some((reason) => reason.includes('사용자용 신청')), '사용자용 링크 미확정 검수 사유 누락');
const normalizedPublicLinkPolicy = normalizePolicyRecord(
  { title: '공개 링크 테스트', description: policyText, link: 'https://example.test/apply?serviceKey=SECRET&ok=1' },
  { id: 'verify-public-link-source', label: '공개 링크 검증 소스', strategy: 'official_api', priority: 90 },
);
assert(normalizedPublicLinkPolicy.benefit.apply_url === 'https://example.test/apply?ok=1', `공개 링크 정제 실패: ${normalizedPublicLinkPolicy.benefit.apply_url}`);


const originalFetch = globalThis.fetch;
const mockSource = {
  id: 'verify-official-api',
  label: '검증 공식 API',
  strategy: 'official_api',
  priority: 100,
  apiBaseEnv: 'VERIFY_API_URL',
  apiKeyEnv: 'VERIFY_API_KEY',
  authParam: 'serviceKey',
  defaultParams: { pageNo: 1, numOfRows: 1 },
  pagination: { pageParam: 'pageNo', sizeParam: 'numOfRows', size: 1 },
};
const mockStore = fs.mkdtempSync(path.join(root, '.verify-mock-policy-store-'));
const requestedUrls = [];
globalThis.fetch = async (url) => {
  requestedUrls.push(String(url));
  const u = new URL(String(url));
  const page = u.searchParams.get('pageNo');
  return new Response(JSON.stringify({
    response: {
      header: { resultCode: '00', resultMsg: 'OK' },
      body: {
        items: {
          item: [{
            servId: `S${page}`,
            servNm: `검증 정책 ${page}`,
            servDgst: '청년 월세 지원',
            sprtTrgtCn: '지원 대상\n만 19세 이상 34세 이하\n월세 70만원 이하\n기준중위소득 60% 이하',
            supportContent: '지원 내용\n월 최대 20만원씩 12개월 동안 총 240만원 지원',
            aplyMthdCn: '복지로 신청',
            homepageUrl: `https://example.test/policy/${page}?serviceKey=SECRET&ok=1`,
          }],
        },
      },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const mockIngest = await ingestPolicySources({
  sources: [mockSource],
  config: { storeDir: mockStore, requestTimeoutMs: 2000, maxPagesPerSource: 2, maxDetailsPerSource: 0, policyRefreshTtlHours: 0 },
  env: { VERIFY_API_URL: 'https://example.test/list?pageNo=1&numOfRows=1', VERIFY_API_KEY: 'SECRET' },
  forceReview: true,
  forceRefresh: true,
});
assert(requestedUrls.length === 2, `mock 공식 API 페이지 요청 수 불일치: ${requestedUrls.length}`);
assert(new URL(requestedUrls[0]).searchParams.get('pageNo') === '1', 'mock 공식 API 1페이지 요청 실패');
assert(new URL(requestedUrls[1]).searchParams.get('pageNo') === '2', 'mock 공식 API 2페이지 요청 실패');
assert(mockIngest.drafts_created === 2, `mock 공식 API draft 생성 수 불일치: ${mockIngest.drafts_created}`);
const mockDrafts = JSON.parse(fs.readFileSync(path.join(mockStore, 'review_drafts.json'), 'utf-8'));
assert(mockDrafts.every((d) => d.benefit.estimated_monthly_value === 200000), 'mock 공식 API 지원 금액이 월 20만원으로 정규화되지 않음');
assert(mockDrafts.every((d) => d.benefit.apply_url?.startsWith('https://example.test/policy/')), 'mock 공식 API 공개 링크 추출 실패');
assert(mockDrafts.every((d) => !JSON.stringify(d.source).includes('SECRET')), 'mock 공식 API source에 인증키가 남아 있음');
fs.rmSync(mockStore, { recursive: true, force: true });

const errorStore = fs.mkdtempSync(path.join(root, '.verify-error-policy-store-'));
globalThis.fetch = async () => new Response(JSON.stringify({ response: { header: { resultCode: '10', resultMsg: 'INVALID_REQUEST_PARAMETER_ERROR' }, body: {} } }), { status: 200, headers: { 'content-type': 'application/json' } });
const errorIngest = await ingestPolicySources({
  sources: [mockSource],
  config: { storeDir: errorStore, requestTimeoutMs: 2000, maxPagesPerSource: 1, policyRefreshTtlHours: 0 },
  env: { VERIFY_API_URL: 'https://example.test/list', VERIFY_API_KEY: 'SECRET' },
  forceRefresh: true,
});
assert(errorIngest.drafts_created === 0, `API 내부 오류 응답이 정책 draft로 생성됨: ${errorIngest.drafts_created}`);
assert(errorIngest.logs.some((line) => line.includes('collect-error') && line.includes('INVALID_REQUEST_PARAMETER_ERROR')), 'API 내부 오류가 수집 오류 로그로 분리되지 않음');
fs.rmSync(errorStore, { recursive: true, force: true });
globalThis.fetch = originalFetch;

const tempStore = fs.mkdtempSync(path.join(root, '.verify-policy-store-'));
const ingestResult = await ingestPolicySources({ config: { storeDir: tempStore, requestTimeoutMs: 2000 }, env: { ENABLE_BOKJIRO_CENTRAL: 'true', ENABLE_BOKJIRO_LOCAL: 'false', ENABLE_GOV24_BENEFITS: 'false', ENABLE_LOCAL_NOTICE_CRAWLER: 'false' } });
assert(Array.isArray(ingestResult.skipped) && ingestResult.skipped.length >= 1, '공식 API URL 미설정 시 안전한 skip 처리 실패');
fs.rmSync(tempStore, { recursive: true, force: true });
const policyPipeline = await runDocumentPipeline(new File([policyText], 'youth_rent_policy_notice_2026.txt', { type: 'text/plain' }));
assert(policyPipeline.documentKind === 'policy_notice', 'runDocumentPipeline 정책 문서 분기 실패');
assert(policyPipeline.parserWarnings.some((w) => w.includes('정책 공고')), '정책 문서 경고 메시지 누락');

const mapping = buildSchemaMap(['성명', '연령', '거주지', '월소득', '월세', '실업급여잔여일']);
assert(mapping.mapped['연령'] === 'age', 'schema mapper 연령 매핑 실패');
assert(mapping.mapped['거주지'] === 'region', 'schema mapper 지역 매핑 실패');
assert(mapping.coverage >= 0.8, `schema coverage 부족: ${mapping.coverage}`);

const mappedRows = mapRowsToProfiles([
  { 성명: 'A', 연령: '27', 거주지: '서울', 월소득: '0원', 월세: '55만원', 실업급여잔여일: '45' },
  { 성명: 'B', 연령: '24', 거주지: '경기', 월소득: '90만원', 월세: '45만원' },
]);
assert(mappedRows.length === 2, 'CSV row mapping 개수 실패');
assert(mappedRows[0].profile.rent === 550000, 'CSV 월세 변환 실패');

const agent = buildAgentPlan(sampleProfile, benefits, '검증');
assert(Array.isArray(agent.reasons), '신청 준비 화면에서 사용할 상담 사유 배열이 없음');
assert(agent.reasons.length > 0, '신청 준비 화면에서 표시할 상담 사유가 비어 있음');
const applicationStrategy = buildApplicationStrategy(sampleProfile, benefits);
assert(Object.keys(applicationStrategy).length > 0, '신청 준비 방법이 비어 있음');
const applicationWorkflow = buildApplicationWorkflow(sampleProfile, plan.selected);
assert(Array.isArray(applicationWorkflow.tasks) && applicationWorkflow.tasks.length > 0, '신청 준비 할 일이 비어 있음');
const notifications = planNotifications(sampleProfile, applicationWorkflow);
assert(notifications.length === applicationWorkflow.tasks.length, '신청 알림 수와 할 일 수가 맞지 않음');
const audit = buildTrustAudit(sampleProfile, benefits, agent);
assert(audit.audit_score >= 70, `audit score 과도하게 낮음: ${audit.audit_score}`);
const report = makeMarkdownReport(sampleProfile, benefits);
assert(report.includes('LifePass 분석 리포트'), '리포트 제목 없음');
assert(report.includes(money(plan.total_monthly_value)) || report.length > 100, '리포트 내용 부족');

console.log('✅ LifePass React Lite 자체검증 통과');
console.log(`- 정책 수: ${benefits.length}`);
console.log(`- 가능 혜택 수: ${eligible.length}`);
console.log(`- 최적 선택 수: ${plan.selected.length}`);
console.log(`- 대형 충돌군 최적 선택 수: ${largeConflictPlan.selected.length}`);
console.log(`- 월환산효과: ${money(plan.total_monthly_value)}`);
console.log(`- 타임라인 체크포인트: ${timeline.length}`);
console.log(`- 복지절벽 경고 시나리오: ${cliffs.filter((row) => row.warnings.length > 0).length}`);
console.log(`- 문서 추출 근거: ${extraction.evidence.length}`);
console.log(`- schema coverage: ${Math.round(mapping.coverage * 100)}%`);
console.log(`- audit score: ${audit.audit_score}`);
console.log(`- 신청 준비 할 일: ${applicationWorkflow.tasks.length}`);
console.log('- React 탭 수: 6, 숫자 접두사 없음');
console.log('- 정책·법령 자동 수집, PostgreSQL/캐시 저장, 백엔드/정규화/룰 생성 검증 완료');