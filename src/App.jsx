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
  '1. 내 정보 불러오기',
  '2. 받을 수 있는 혜택',
  '3. 앞으로 달라질 혜택',
  '4. 신청 준비하기',
  '5. 판정 근거 확인하기',
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
              <option value="unemployed">현재 소득 없음/실직</option>
              <option value="job_seeker">구직 중</option>
              <option value="part_time">아르바이트/파트타임</option>
              <option value="employed">재직 중</option>
              <option value="freelancer">프리랜서</option>
              <option value="student">학생</option>
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
      parserWarnings: documentKind === 'policy_notice' ? ['정책 안내문으로 보입니다. 내 정보는 바꾸지 않고, 신청 대상과 지원 조건만 따로 정리했습니다.'] : [],
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
          <div className="eyebrow">LifePass · 복지 혜택 길잡이</div>
          <h1>내 상황을 입력하면 받을 수 있는 혜택과 신청 순서를 한눈에 확인할 수 있습니다</h1>
          <p>상담 메모, 임대차계약 정보, 정책 안내문, CSV 파일을 넣으면 필요한 정보를 읽어 현재 받을 수 있는 혜택, 앞으로 놓칠 수 있는 혜택, 먼저 준비해야 할 서류를 차례대로 안내합니다.</p>
        </div>
        <div className="hero-card">
          <Metric label="확인 가능한 혜택" value={`${benefits.length}개`} note="현재 등록된 정책 기준" />
          <Metric label="우선 신청 후보" value={`${derived.plan.selected.length}개`} note={money(derived.plan.total_monthly_value)} />
          <Metric label="도움 필요도" value={`${derived.agent.priority_score}점`} note={derived.agent.priority_grade} />
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((tab, idx) => (
          <button key={tab} className={activeTab === idx ? 'active' : ''} onClick={() => setActiveTab(idx)}>{tab}</button>
        ))}
      </nav>

      {activeTab === 0 && (
        <main className="tab-panel">
          <Section title="내 정보 불러오기" subtitle="상담 메모, 임대차계약서, 정책 안내문, 이미지 파일, CSV 파일을 올리거나 직접 입력하세요. 읽어낸 정보는 바로 적용하지 말고 아래에서 한 번 확인하는 것을 권장합니다.">
            <div className="two-col">
              <div>
                <h3>문서 파일 올리기</h3>
                <input className="file-input" type="file" accept=".pdf,.docx,.hwp,.hwpx,.owpml,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.txt,.md,.csv,.json" onChange={handleDocument} />
                <p className="muted">PDF, 워드 문서, 한글 문서, 이미지, 텍스트 파일을 올릴 수 있습니다. 스캔본이나 사진처럼 글자를 바로 읽기 어려운 파일은 시간이 조금 더 걸릴 수 있으니, 결과가 나오면 나이·지역·소득·월세 정보가 맞는지 꼭 확인하세요.</p>
                {docLoading && <p className="status-line">문서에서 필요한 정보를 읽고 있습니다. 페이지가 많거나 이미지가 큰 파일은 잠시 기다려 주세요.</p>}
                {docError && <p className="error-line">{docError}</p>}
              </div>
              <div>
                <h3>텍스트 직접 입력</h3>
                <TextArea value={inputText} onChange={setInputText} placeholder="예: 저는 서울에 사는 27세 1인가구이고, 월소득은 없고 월세는 55만 원입니다. 실업급여는 45일 남았습니다." />
                <button className="primary" onClick={applyText}>입력한 내용으로 내 상황 확인하기</button>
              </div>
            </div>
          </Section>

          {docResult && (
            <Section title="읽어낸 정보 확인하기" subtitle={`${docResult.file?.name || '직접 입력한 내용'}에서 찾은 정보를 보여드립니다. 실제 신청 전에는 아래 값을 직접 확인하고 필요한 부분을 고쳐 주세요.`}>
              <div className="metrics-row">
                <Metric label="찾은 정보" value={`${docResult.evidence?.length || 0}개`} />
                <Metric label="확인할 항목" value={`${docResult.validation?.issues?.length || 0}개`} />
                <Metric label="원문 길이" value={`${docResult.text?.length || 0}자`} />
                <Metric label="문서 유형" value={docResult.documentKind === 'policy_notice' ? '정책 공고' : '신청자 문서'} />
              </div>
              {!!docResult.parserWarnings?.length && <div className="warn-box">{docResult.parserWarnings.map((w, i) => <p key={i}>{w}</p>)}</div>}
              {docResult.documentKind === 'policy_notice' && docResult.policySignals && (
                <div className="info-box">
                  <strong>정책 안내문에서 확인한 주요 조건</strong>
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
                  <p className="muted">이 파일은 신청자 정보가 아니라 정책 안내문으로 보입니다. 따라서 내 나이·소득·월세 정보는 바꾸지 않고, 신청 대상과 지원 조건만 따로 정리했습니다. 내 정보와 비교해 신청 가능성을 확인하세요.</p>
                </div>
              )}
              <div className="two-col">
                <div>
                  <h3>어디에서 찾았나요?</h3>
                  <SimpleTable rows={(docResult.evidence || []).map((e) => ({ 필드: e.label, 값: valueText(e.value), 근거: e.source, 신뢰도: Math.round(e.confidence * 100) + '%' }))} />
                  <h3>꼭 확인할 내용</h3>
                  <SimpleTable rows={verificationChecklist.map((x) => ({ 항목: x.item, 상태: x.status, 이유: x.reason }))} />
                </div>
                <div>
                  <h3>내 정보 확인하고 고치기</h3>
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
                <summary>문서에서 읽은 원문 보기</summary>
                <pre className="raw-text">{docResult.text}</pre>
              </details>
            </Section>
          )}

          <Section title="여러 명 정보를 CSV로 한 번에 확인하기" subtitle="상담 대상자 목록처럼 표로 정리된 파일이 있다면 CSV를 올려 여러 사람의 혜택 가능성을 한 번에 살펴볼 수 있습니다. 열 이름은 연령, 거주지, 월소득, 월세처럼 알아보기 쉽게 적어 주세요.">
            <input className="file-input" type="file" accept=".csv" onChange={handleBatchCsv} />
            {batchRows.length > 0 && (
              <>
                <div className="metrics-row">
                  <Metric label="확인한 사람" value={`${batchRows.length}명`} />
                  <Metric label="인식된 열 비율" value={`${Math.round(buildSchemaMap(Object.keys(batchRows[0].original)).coverage * 100)}%`} />
                </div>
                <SimpleTable rows={batchAnalysis} limit={8} />
              </>
            )}
          </Section>
        </main>
      )}

      {activeTab === 1 && (
        <main className="tab-panel">
          <Section title="현재 받을 수 있는 혜택" subtitle="위에서 확인한 내 정보를 기준으로 신청 가능성이 높은 혜택을 먼저 보여드립니다. 실제 신청 전에는 각 기관의 최신 공고와 세부 조건을 함께 확인하세요.">
            <div className="metrics-row">
              <Metric label="가능 혜택" value={`${derived.evaluations.filter((e) => e.eligible).length}개`} />
              <Metric label="우선 신청" value={`${derived.plan.selected.length}개`} />
              <Metric label="월 환산효과" value={money(derived.plan.total_monthly_value)} />
              <Metric label="함께 신청 가능한 조합" value={derived.portfolio.conflict_free ? '예' : '확인 필요'} />
            </div>
            <div className="selected-list">
              {derived.plan.selected.map((b) => (
                <article key={b.benefit_id} className="benefit-card">
                  <div className="card-top"><Badge tone="good">우선 확인</Badge><strong>{b.name}</strong></div>
                  <p>{b.description}</p>
                  <p><b>{money(b.monthly_value)}</b> · {b.domain} · 신청 우선도 {b.priority}</p>
                </article>
              ))}
            </div>
            <h3>전체 혜택별 가능 여부</h3>
            <SimpleTable rows={eligibleRows} />
          </Section>

          <Section title="같이 받을 수 없는 혜택 안내" subtitle="비슷한 목적의 혜택은 동시에 받을 수 없을 수 있습니다. 이 영역에서는 함께 신청하기 어려운 혜택을 제외하고, 먼저 확인하면 좋은 조합을 보여드립니다.">
            <ul className="clean-list">{derived.plan.explanation.map((line, idx) => <li key={idx}>{line}</li>)}</ul>
            <SimpleTable rows={derived.plan.rejected_due_to_conflict.map((b) => ({ 제외혜택: b.name, 분야: b.domain, 월환산: money(b.monthly_value) }))} />
          </Section>
        </main>
      )}

      {activeTab === 2 && (
        <main className="tab-panel">
          <Section title="앞으로 달라질 혜택 살펴보기" subtitle="실업급여가 끝나거나, 아르바이트를 시작하거나, 소득이 늘어나는 경우 받을 수 있는 혜택이 달라질 수 있습니다. 지금 신청해야 할 혜택과 나중에 다시 확인할 혜택을 함께 살펴보세요.">
            <div className="metrics-row">
              <Metric label="현재 순효과" value={money(derived.timeline[0]?.net_effect || 0)} />
              <Metric label="3개월 후 순효과" value={money(derived.timeline.find((x) => x.month === 3)?.net_effect || 0)} />
              <Metric label="변화 알림" value={`${derived.events.length}개`} />
            </div>
            <h3>시간에 따른 변화</h3>
            <SimpleTable rows={timelineRows} />
            <h3>소득이 달라질 때의 혜택 변화</h3>
            <SimpleTable rows={cliffRows} />
          </Section>

          <Section title="상황을 바꿔 비교하기" subtitle="소득이 생기거나 월세가 없어지는 등 조건이 달라졌을 때 예상 지원 효과가 어떻게 변하는지 비교합니다.">
            <SimpleTable rows={derived.counterfactuals.map((r) => ({ 시나리오: r.scenario, 월환산효과: money(r.월환산효과), 변화: r.delta_label, 선택혜택: r.selected }))} />
          </Section>
        </main>
      )}

      {activeTab === 3 && (
        <main className="tab-panel">
          <Section title="신청 준비하기" subtitle="받을 가능성이 높은 혜택부터 서류 준비, 신청, 결과 확인 순서로 할 일을 정리했습니다. 기한은 예시이므로 실제 접수 기간은 각 기관 안내문에서 다시 확인하세요.">
            <div className="metrics-row">
              <Metric label="신청 후보" value={`${derived.plan.selected.length}개`} />
              <Metric label="할 일" value={`${derived.workflow.tasks.length}개`} />
              <Metric label="알림 예정" value={`${derived.notifications.length}개`} />
            </div>
            <h3>신청 할 일</h3>
            <SimpleTable rows={derived.workflow.tasks.map((t) => ({ 혜택: t.benefit, 할일: t.task, 기한: t.due, 상태: t.status }))} />
            <h3>준비 서류 체크리스트</h3>
            {Object.entries(derived.strategy).map(([benefit, items]) => (
              <div className="check-block" key={benefit}>
                <strong>{benefit}</strong>
                <ul>{items.map((item, idx) => <li key={idx}>{item}</li>)}</ul>
              </div>
            ))}
          </Section>

          <Section title="추가 상담이 필요한지 확인하기" subtitle="소득 공백, 실업급여 종료, 주거비 부담처럼 놓치면 위험한 신호가 있으면 상담사나 담당자에게 먼저 확인하도록 안내합니다.">
            <div className="metrics-row">
              <Metric label="도움 필요도" value={`${derived.agent.priority_score}점`} />
              <Metric label="등급" value={derived.agent.priority_grade} />
              <Metric label="상담사 확인" value={derived.agentWorkflow.human_review_required ? '필요' : '선택'} />
            </div>
            <ul className="clean-list">{derived.agent.reasons.map((r, idx) => <li key={idx}>{r}</li>)}</ul>
          </Section>
        </main>
      )}

      {activeTab === 4 && (
        <main className="tab-panel">
          <Section title="판정 근거 확인하기" subtitle="왜 이 혜택이 가능하거나 어려운지, 어떤 정보가 판단에 쓰였는지 한 화면에서 확인할 수 있습니다. 상담 기록이나 제출 전 확인용으로 리포트를 저장할 수 있습니다." right={<button className="primary" onClick={exportReport}>리포트 파일 저장</button>}>
            <div className="metrics-row">
              <Metric label="점검 점수" value={`${derived.audit.audit_score}점`} />
              <Metric label="상태" value={derived.audit.status} />
              <Metric label="확인 필요" value={`${derived.validationWarnings.length}개`} />
            </div>
            <h3>안전하게 확인했나요?</h3>
            <SimpleTable rows={derived.audit.controls.map((c) => ({ 확인항목: c.control, 상태: c.status, 근거: c.evidence }))} />
            <h3>판정 과정 요약</h3>
            <SimpleTable rows={derived.agentWorkflow.steps.map((s) => ({ 단계: s.step, 확인내용: s.action, 결과: s.result }))} />
          </Section>

          <Section title="혜택별 조건 자세히 보기" subtitle="각 혜택을 펼치면 어떤 조건은 충족했고 어떤 조건은 부족한지 확인할 수 있습니다. 부족한 조건은 신청 전 보완하거나 담당 기관에 문의하세요.">
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
