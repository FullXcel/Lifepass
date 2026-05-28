import fs from 'node:fs';
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

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf-8'));
const benefits = readJson('src/data/benefits.json');
const samples = readJson('src/data/sample_profiles.json');

function assert(condition, message) {
  if (!condition) throw new Error(`VERIFY FAILED: ${message}`);
}

const requiredFiles = [
  'package.json',
  'README.md',
  'IMPLEMENTATION_SUMMARY.md',
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
const tabMatch = appSource.match(/const TABS = \[([\s\S]*?)\];/);
assert(tabMatch, 'TABS 선언 없음');
const tabCount = (tabMatch[1].match(/'/g) || []).length / 2;
assert(tabCount === 5, `탭 개수가 5개가 아님: ${tabCount}`);
assert(!/['\"]\d+\.\s/.test(tabMatch[1]), '탭 이름에 숫자 접두사가 남아 있음');
assert(!appSource.includes('텍스트 직접 입력</h3>'), '텍스트 직접 입력 창구가 아직 남아 있음');
assert(!appSource.includes('onClick={applyText}'), '텍스트 입력 적용 버튼이 아직 남아 있음');
assert(appSource.includes('approvedPolicies') && appSource.includes('setApprovedPolicies'), '승인된 외부 정책을 혜택 매칭에 합치는 로직이 없음');
assert(appSource.includes('x-admin-token'), '관리자 API 호출에 x-admin-token 헤더를 보내는 로직이 없음');

const envSource = fs.readFileSync(path.join(root, 'server/config/env.js'), 'utf-8');
assert(envSource.includes('dotenv.config'), '.env를 로드하는 dotenv 설정이 없음');
assert(envSource.includes('getPolicyApiConfig'), '정책 API 환경변수 설정 함수가 없음');
const sourceConfig = fs.readFileSync(path.join(root, 'server/config/policySources.js'), 'utf-8');
for (const sourceId of ['bokjiro-central-welfare', 'bokjiro-local-welfare', 'gov24-benefits', 'youth-policy', 'local-notice-allowlist']) {
  assert(sourceConfig.includes(sourceId), `정책 수집 소스 누락: ${sourceId}`);
}
assert(sourceConfig.includes('authParam') && sourceConfig.includes('detailUrlEnv'), 'API별 인증 파라미터 또는 상세 URL 설정이 없음');
const httpSource = fs.readFileSync(path.join(root, 'server/lib/httpClient.js'), 'utf-8');
assert(httpSource.includes('withApiParams'), 'API별 인증 파라미터를 처리하는 withApiParams 함수가 없음');
assert(httpSource.includes('parseXmlRecords'), 'XML 응답을 record로 변환하는 로직이 없음');
const runnerSource = fs.readFileSync(path.join(root, 'server/lib/ingestionRunner.js'), 'utf-8');
assert(runnerSource.includes('enrichRecords') && runnerSource.includes('looksLikeDataPortalDocPage'), '상세조회 보강 또는 data.go.kr 문서 URL 방어 로직이 없음');

const pkg = readJson('package.json');
for (const dep of ['react', 'react-dom', 'vite', 'pdfjs-dist', 'mammoth', 'tesseract.js', 'jszip', 'papaparse', 'dotenv']) {
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
assert(policySignals.income_percent_criteria.includes(60) && policySignals.income_percent_criteria.includes(100), '정책 소득 기준 추출 실패');
const generatedRule = generateRuleFromPolicySignals(policySignals);
assert(generatedRule.all.some((rule) => rule.field === 'age'), '정책 룰 생성기 연령 조건 누락');
assert(generatedRule.all.some((rule) => rule.field === 'rent'), '정책 룰 생성기 월세 조건 누락');
const normalizedPolicy = normalizePolicyRecord({ title: '청년월세 지원 테스트', description: policyText, url: 'https://example.test/policy' }, { id: 'verify-source', label: '검증 소스', strategy: 'official_api', priority: 100 });
assert(normalizedPolicy.benefit.rule.all.length >= 3, '외부 정책 record 정규화/룰 생성 실패');
assert(normalizedPolicy.ingestion.content_hash?.length === 64, '정책 변경 감지용 hash 생성 실패');
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
console.log(`- 월환산효과: ${money(plan.total_monthly_value)}`);
console.log(`- 타임라인 체크포인트: ${timeline.length}`);
console.log(`- 복지절벽 경고 시나리오: ${cliffs.filter((row) => row.warnings.length > 0).length}`);
console.log(`- 문서 추출 근거: ${extraction.evidence.length}`);
console.log(`- schema coverage: ${Math.round(mapping.coverage * 100)}%`);
console.log(`- audit score: ${audit.audit_score}`);
console.log(`- 신청 준비 할 일: ${applicationWorkflow.tasks.length}`);
console.log('- React 탭 수: 5, 숫자 접두사 없음');
console.log('- 정책 자동 수집 백엔드/정규화/룰 생성 검증 완료');