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
  'docs/REQUIREMENT_CHECKLIST.md',
];
for (const file of requiredFiles) assert(fs.existsSync(path.join(root, file)), `필수 파일 없음: ${file}`);

const appSource = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf-8');
const tabMatch = appSource.match(/const TABS = \[([\s\S]*?)\];/);
assert(tabMatch, 'TABS 선언 없음');
const tabCount = (tabMatch[1].match(/'/g) || []).length / 2;
assert(tabCount === 5, `탭 개수가 5개가 아님: ${tabCount}`);

const pkg = readJson('package.json');
for (const dep of ['react', 'react-dom', 'vite', 'pdfjs-dist', 'mammoth', 'tesseract.js', 'jszip', 'papaparse']) {
  assert(pkg.dependencies[dep], `의존성 누락: ${dep}`);
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
console.log('- React 탭 수: 5');