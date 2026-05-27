import React, { useMemo, useState } from 'react';
import Papa from 'papaparse';
import benefitsSeed from './data/benefits.json';
import sampleProfiles from './data/sample_profiles.json';
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
} from './logic/lifepassCore.js';
import {
  FIELD_LABELS,
  runDocumentPipeline,
  buildVerificationChecklist,
  mapRowsToProfiles,
  buildSchemaMap,
  extractFieldsFromText,
  detectDocumentKind,
  extractPolicySignalsFromText,
  profileToEditableRows,
} from './logic/documentPipeline.js';

const TABS = [
  '1. 문서 온보딩',
  '2. 현재 판정',
  '3. 복지절벽 시뮬레이션',
  '4. 신청 로드맵',
  '5. 신뢰성·근거 리포트',
];

function valueText(value) {
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  if (typeof value === 'number' && value >= 10000) return money(value);
  return String(value ?? '');
}

function Badge({ children, tone = 'neutral' }) {
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
          <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr key={idx}>{columns.map((c) => <td key={c}>{Array.isArray(row[c]) ? row[c].join(', ') : String(row[c] ?? '')}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TextArea({ value, onChange, placeholder }) {
  return <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

function ProfileEditor({ profile, onChange }) {
  const rows = profileToEditableRows(profile);
  const update = (field, raw) => {
    let value = raw;
    if (typeof DEFAULT_PROFILE[field] === 'number') value = Number(String(raw).replaceAll(',', ''));
    if (typeof DEFAULT_PROFILE[field] === 'boolean') value = raw === 'true';
    onChange(normalizeProfile({ ...profile, [field]: value }));
  };
  return (
    <div className="profile-grid">
      {rows.map(({ field, label, value }) => (
        <label key={field} className="field-row">
          <span>{label}</span>
          {typeof DEFAULT_PROFILE[field] === 'boolean' ? (
            <select value={String(Boolean(value))} onChange={(e) => update(field, e.target.value)}>
              <option value="true">예</option>
              <option value="false">아니오</option>
            </select>
          ) : field === 'employment_status' ? (
            <select value={value || ''} onChange={(e) => update(field, e.target.value)}>
              <option value="unemployed">unemployed</option>
              <option value="job_seeker">job_seeker</option>
              <option value="part_time">part_time</option>
              <option value="employed">employed</option>
              <option value="freelancer">freelancer</option>
              <option value="student">student</option>
            </select>
          ) : (
            <input value={value ?? ''} onChange={(e) => update(field, e.target.value)} />
          )}
        </label>
      ))}
    </div>
  );
}

function useDerived(profile, benefits) {
  return useMemo(() => {
    const [safeProfile, validationWarnings] = validateProfile(asProfile(profile));
    const evaluations = evaluateAll(benefits, safeProfile);
    const plan = optimizeBenefits(evaluations);
    const portfolio = solveBenefitPortfolio(evaluations, 6);
    const timeline = simulateTimeline(safeProfile, benefits, [0, 1, 3, 6, 12]);
    const cliffs = simulateIncomeCliff(safeProfile, benefits);
    const events = generateTimelineEvents(safeProfile, benefits);
    const strategy = buildApplicationStrategy(safeProfile, benefits);
    const workflow = buildApplicationWorkflow(safeProfile, plan.selected);
    const notifications = planNotifications(safeProfile, workflow);
    const agent = buildAgentPlan(safeProfile, benefits, '현재 가능한 혜택과 향후 상실 위험을 설명해줘');
    const agentWorkflow = buildAgentWorkflow(safeProfile, benefits, '상담 흐름');
    const audit = buildTrustAudit(safeProfile, benefits, agent);
    const counterfactuals = buildCounterfactuals(safeProfile, benefits);
    return { safeProfile, validationWarnings, evaluations, plan, portfolio, timeline, cliffs, events, strategy, workflow, notifications, agent, agentWorkflow, audit, counterfactuals };
  }, [profile, benefits]);
}

export default function App() {
  const [activeTab, setActiveTab] = useState(0);
  const [benefits] = useState(benefitsSeed);
  const [profile, setProfile] = useState(normalizeProfile(sampleProfiles[0]?.profile || DEFAULT_PROFILE));
  const [inputText, setInputText] = useState('저는 서울에 사는 27세 1인가구이고, 월소득은 없고 월세는 55만 원입니다. 실업급여는 45일 남았습니다. 3개월 뒤 알바로 월 80만 원을 벌 예정입니다. 임대차계약서가 있습니다.');
  const [docResult, setDocResult] = useState(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState('');
  const [batchRows, setBatchRows] = useState([]);
  const [batchAnalysis, setBatchAnalysis] = useState([]);
  const derived = useDerived(profile, benefits);

  const applyText = () => {
    const result = extractFieldsFromText(inputText);
    const documentKind = detectDocumentKind(inputText);
    const policySignals = documentKind === 'policy_notice' ? extractPolicySignalsFromText(inputText) : null;
    setDocResult({
      file: { name: '직접 입력 텍스트', size: inputText.length, type: 'text/plain' },
      parser: 'regex+profile_parser',
      documentKind,
      policySignals,
      text: inputText,
      profile: result.profile,
      evidence: result.evidence,
      validation: { ...result, issues: result.warnings || [], confirmations: [] },
      parserWarnings: documentKind === 'policy_notice' ? ['정책 공고/안내문으로 감지했습니다. 사용자 프로필을 자동 덮어쓰지 않고 정책 기준만 추출합니다.'] : [],
    });
    if (documentKind !== 'policy_notice') setProfile(result.profile);
  };

  const handleDocument = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setDocLoading(true);
    setDocError('');
    try {
      const result = await runDocumentPipeline(file, { useOcr: true });
      setDocResult(result);
      if (result.documentKind !== 'policy_notice') setProfile(result.profile);
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
    const [summary] = analyzeProfiles(mapped.map((m) => m.profile), benefits);
    setBatchRows(mapped);
    setBatchAnalysis(summary);
  };

  const exportReport = () => {
    const report = makeMarkdownReport(profile, benefits);
    downloadText('lifepass_report.md', report, 'text/markdown');
  };

  const verificationChecklist = docResult ? buildVerificationChecklist(docResult) : [];
  const eligibleRows = derived.evaluations.map((ev) => ({
    혜택: ev.name,
    분야: ev.domain,
    판정: ev.eligible ? '가능' : '불가',
    월환산: money(ev.monthly_value),
    충족조건: ev.matched.slice(0, 3).join(', '),
    미충족조건: ev.unmet.slice(0, 3).join(', '),
  }));
  const timelineRows = derived.timeline.map((r) => ({
    시점: r.label,
    월소득: money(r.income),
    선택혜택수: r.selected_benefits.length,
    월환산효과: money(r.benefit_value),
    순효과: money(r.net_effect),
    신규: r.gained?.join(', ') || '없음',
    상실: r.lost?.join(', ') || '없음',
  }));
  const cliffRows = derived.cliffs.map((r) => ({ 소득시나리오: r.label, 혜택: money(r.benefit_value), 순효과: money(r.net_effect), 경고: r.warnings.join(' / ') }));

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <div className="eyebrow">LifePass React Lite · Document-first Welfare Cliff Agent</div>
          <h1>문서만 넣어도 판정·시뮬레이션·신청 로드맵까지 이어지는 경량 웹앱</h1>
          <p>Streamlit의 17개 탭을 5개 핵심 탭으로 압축하고, 기존 규칙 기반 판정·최적화·복지절벽 로직은 React/JavaScript로 유지했습니다.</p>
        </div>
        <div className="hero-card">
          <Metric label="정책 룰" value={`${benefits.length}개`} note="benefits.json 기반" />
          <Metric label="최적 조합" value={`${derived.plan.selected.length}개`} note={money(derived.plan.total_monthly_value)} />
          <Metric label="상담 우선도" value={`${derived.agent.priority_score}점`} note={derived.agent.priority_grade} />
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((tab, idx) => (
          <button key={tab} className={activeTab === idx ? 'active' : ''} onClick={() => setActiveTab(idx)}>{tab}</button>
        ))}
      </nav>

      {activeTab === 0 && (
        <main className="tab-panel">
          <Section title="문서 온보딩" subtitle="PDF/DOCX/HWP/HWPX/이미지/OCR/텍스트/CSV를 받아 프로필 스키마로 변환합니다.">
            <div className="two-col">
              <div>
                <h3>문서 파일 업로드</h3>
                <input className="file-input" type="file" accept=".pdf,.docx,.hwp,.hwpx,.owpml,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.txt,.md,.csv,.json" onChange={handleDocument} />
                <p className="muted">PDF는 텍스트 레이어 우선, 이미지 문서는 Tesseract OCR을 사용합니다. 구형 .hwp 바이너리는 가시 문자열 추출 fallback 후 검증 UI에서 확인하도록 표시합니다.</p>
                {docLoading && <p className="status-line">문서 파싱/OCR 중입니다. 큰 이미지나 PDF는 시간이 걸릴 수 있습니다.</p>}
                {docError && <p className="error-line">{docError}</p>}
              </div>
              <div>
                <h3>텍스트 직접 입력</h3>
                <TextArea value={inputText} onChange={setInputText} placeholder="상담 메모나 문서에서 복사한 텍스트를 붙여넣으세요." />
                <button className="primary" onClick={applyText}>텍스트에서 프로필 추출</button>
              </div>
            </div>
          </Section>

          {docResult && (
            <Section title="필드 추출기 · Schema Mapper · 검증 UI" subtitle={`parser=${docResult.parser} / file=${docResult.file?.name}`}>
              <div className="metrics-row">
                <Metric label="추출 근거" value={`${docResult.evidence?.length || 0}개`} />
                <Metric label="검증 이슈" value={`${docResult.validation?.issues?.length || 0}개`} />
                <Metric label="원문 길이" value={`${docResult.text?.length || 0}자`} />
                <Metric label="문서 유형" value={docResult.documentKind === 'policy_notice' ? '정책 공고' : '신청자 문서'} />
              </div>
              {!!docResult.parserWarnings?.length && <div className="warn-box">{docResult.parserWarnings.map((w, i) => <p key={i}>{w}</p>)}</div>}
              {docResult.documentKind === 'policy_notice' && docResult.policySignals && (
                <div className="info-box">
                  <strong>정책 문서 추출 결과</strong>
                  <SimpleTable rows={[
                    { 항목: '정책명/제목', 값: docResult.policySignals.title },
                    { 항목: '지역 언급', 값: docResult.policySignals.regions?.join(', ') || '전국/미확인' },
                    { 항목: '연령 기준', 값: docResult.policySignals.age_range ? `${docResult.policySignals.age_range[0]}~${docResult.policySignals.age_range[1]}세` : '미확인' },
                    { 항목: '월세 기준', 값: docResult.policySignals.rent_cap ? money(docResult.policySignals.rent_cap) : '미확인' },
                    { 항목: '보증금 기준', 값: docResult.policySignals.deposit_cap ? money(docResult.policySignals.deposit_cap) : '미확인' },
                    { 항목: '지원금', 값: docResult.policySignals.support_amount ? money(docResult.policySignals.support_amount) : '미확인' },
                    { 항목: '소득 기준', 값: docResult.policySignals.income_percent_criteria?.length ? docResult.policySignals.income_percent_criteria.map((x) => `중위소득 ${x}% 이하`).join(', ') : '미확인' },
                    { 항목: '필요서류', 값: docResult.policySignals.required_docs?.join(', ') || '미확인' },
                    { 항목: '신청방법', 값: docResult.policySignals.application_methods?.join(', ') || '미확인' },
                  ]} />
                  <p className="muted">정책 문서는 사용자 개인정보가 아니므로 현재 프로필을 자동 변경하지 않습니다. 정책 기준은 카탈로그 갱신이나 상담 근거 확인에 사용하세요.</p>
                </div>
              )}
              <div className="two-col">
                <div>
                  <h3>추출 근거</h3>
                  <SimpleTable rows={(docResult.evidence || []).map((e) => ({ 필드: e.label, 값: valueText(e.value), 근거: e.source, 신뢰도: Math.round(e.confidence * 100) + '%' }))} />
                  <h3>검증 체크리스트</h3>
                  <SimpleTable rows={verificationChecklist.map((x) => ({ 항목: x.item, 상태: x.status, 이유: x.reason }))} />
                </div>
                <div>
                  <h3>추출 프로필 직접 검증/수정</h3>
                  <ProfileEditor profile={profile} onChange={setProfile} />
                </div>
              </div>
              {docResult.validation?.issues?.length > 0 && (
                <div className="warn-box">
                  <strong>확인 필요:</strong>
                  <ul>{docResult.validation.issues.map((issue, idx) => <li key={idx}>{issue}</li>)}</ul>
                </div>
              )}
              <details>
                <summary>원문 추출 결과 보기</summary>
                <pre className="raw-text">{docResult.text}</pre>
              </details>
            </Section>
          )}

          <Section title="CSV 일괄 분석은 보조 기능으로 축소" subtitle="핵심은 문서 온보딩이지만, 기관용 정제 데이터가 있을 때만 간단히 사용할 수 있게 남겼습니다.">
            <input className="file-input" type="file" accept=".csv" onChange={handleBatchCsv} />
            {batchRows.length > 0 && (
              <>
                <div className="metrics-row">
                  <Metric label="매핑 사용자" value={`${batchRows.length}명`} />
                  <Metric label="Schema coverage" value={`${Math.round(buildSchemaMap(Object.keys(batchRows[0].original)).coverage * 100)}%`} />
                </div>
                <SimpleTable rows={batchAnalysis} limit={8} />
              </>
            )}
          </Section>
        </main>
      )}

      {activeTab === 1 && (
        <main className="tab-panel">
          <Section title="현재 자격 판정" subtitle="LLM이 아니라 benefits.json의 JSON rule과 rule_engine 로직으로 재현 가능한 판정을 수행합니다.">
            <div className="metrics-row">
              <Metric label="가능 혜택" value={`${derived.evaluations.filter((e) => e.eligible).length}개`} />
              <Metric label="최적 선택" value={`${derived.plan.selected.length}개`} />
              <Metric label="월 환산효과" value={money(derived.plan.total_monthly_value)} />
              <Metric label="충돌 없는 조합" value={derived.portfolio.conflict_free ? '예' : '아니오'} />
            </div>
            <div className="selected-list">
              {derived.plan.selected.map((b) => (
                <article key={b.benefit_id} className="benefit-card">
                  <div className="card-top"><Badge tone="good">선택</Badge><strong>{b.name}</strong></div>
                  <p>{b.description}</p>
                  <p><b>{money(b.monthly_value)}</b> · {b.domain} · priority {b.priority}</p>
                </article>
              ))}
            </div>
            <h3>전체 룰 판정표</h3>
            <SimpleTable rows={eligibleRows} />
          </Section>

          <Section title="중복/충돌 처리" subtitle="exclusive_group과 conflicts_with를 그대로 사용해 동시에 받을 수 없는 혜택을 제외합니다.">
            <ul className="clean-list">{derived.plan.explanation.map((line, idx) => <li key={idx}>{line}</li>)}</ul>
            <SimpleTable rows={derived.plan.rejected_due_to_conflict.map((b) => ({ 제외혜택: b.name, 분야: b.domain, 월환산: money(b.monthly_value) }))} />
          </Section>
        </main>
      )}

      {activeTab === 2 && (
        <main className="tab-panel">
          <Section title="생애전환·복지절벽 시뮬레이션" subtitle="실업급여 종료, 소득 발생, 소득 구간 변화에 따라 혜택 신규/상실을 보여주는 LifePass의 핵심 차별점입니다.">
            <div className="metrics-row">
              <Metric label="현재 순효과" value={money(derived.timeline[0]?.net_effect || 0)} />
              <Metric label="3개월 후 순효과" value={money(derived.timeline.find((x) => x.month === 3)?.net_effect || 0)} />
              <Metric label="이벤트" value={`${derived.events.length}개`} />
            </div>
            <h3>시간축 변화</h3>
            <SimpleTable rows={timelineRows} />
            <h3>소득별 복지절벽</h3>
            <SimpleTable rows={cliffRows} />
          </Section>

          <Section title="Counterfactual 비교" subtitle="같은 사용자가 다른 선택/상황을 맞았을 때 월환산효과가 어떻게 바뀌는지 비교합니다.">
            <SimpleTable rows={derived.counterfactuals.map((r) => ({ 시나리오: r.scenario, 월환산효과: money(r.월환산효과), 변화: r.delta_label, 선택혜택: r.selected }))} />
          </Section>
        </main>
      )}

      {activeTab === 3 && (
        <main className="tab-panel">
          <Section title="신청 로드맵" subtitle="추천에서 끝나지 않고 서류 준비, 제출, 결과 확인, 알림 outbox까지 연결합니다.">
            <div className="metrics-row">
              <Metric label="workflow" value={derived.workflow.workflow_id} />
              <Metric label="할 일" value={`${derived.workflow.tasks.length}개`} />
              <Metric label="알림 예정" value={`${derived.notifications.length}개`} />
            </div>
            <h3>신청 태스크</h3>
            <SimpleTable rows={derived.workflow.tasks.map((t) => ({ 혜택: t.benefit, 할일: t.task, 기한: t.due, 상태: t.status }))} />
            <h3>준비 서류 체크리스트</h3>
            {Object.entries(derived.strategy).map(([benefit, items]) => (
              <div className="check-block" key={benefit}>
                <strong>{benefit}</strong>
                <ul>{items.map((item, idx) => <li key={idx}>{item}</li>)}</ul>
              </div>
            ))}
          </Section>

          <Section title="상담사 개입 우선순위" subtitle="자동 결정이 아니라, 고위험 사용자는 human review 대상으로 올립니다.">
            <div className="metrics-row">
              <Metric label="우선도" value={`${derived.agent.priority_score}점`} />
              <Metric label="등급" value={derived.agent.priority_grade} />
              <Metric label="human review" value={derived.agentWorkflow.human_review_required ? '필요' : '선택'} />
            </div>
            <ul className="clean-list">{derived.agent.reasons.map((r, idx) => <li key={idx}>{r}</li>)}</ul>
          </Section>
        </main>
      )}

      {activeTab === 4 && (
        <main className="tab-panel">
          <Section title="신뢰성·근거 리포트" subtitle="규칙 기반 판정, 충돌 처리, human review, 문서 근거를 한 화면에서 검증합니다." right={<button className="primary" onClick={exportReport}>Markdown 리포트 저장</button>}>
            <div className="metrics-row">
              <Metric label="Audit score" value={`${derived.audit.audit_score}점`} />
              <Metric label="상태" value={derived.audit.status} />
              <Metric label="검증 경고" value={`${derived.validationWarnings.length}개`} />
            </div>
            <h3>Trust controls</h3>
            <SimpleTable rows={derived.audit.controls.map((c) => ({ 통제항목: c.control, 상태: c.status, 근거: c.evidence }))} />
            <h3>Agent workflow trace</h3>
            <SimpleTable rows={derived.agentWorkflow.steps.map((s) => ({ 단계: s.step, 노드: s.node, 작업: s.action, 결과: s.result }))} />
          </Section>

          <Section title="판정 근거 상세" subtitle="사용자에게 왜 가능/불가능한지 조건 단위로 설명할 수 있습니다.">
            <div className="trace-list">
              {derived.evaluations.slice(0, 8).map((ev) => (
                <details key={ev.benefit_id}>
                  <summary>{ev.eligible ? '✅' : '❌'} {ev.name}</summary>
                  <SimpleTable rows={ev.trace.map((t) => ({ 조건: t.label, 통과: t.passed ? 'Y' : 'N', 상세: t.detail }))} limit={20} />
                </details>
              ))}
            </div>
          </Section>
        </main>
      )}
    </div>
  );
}
