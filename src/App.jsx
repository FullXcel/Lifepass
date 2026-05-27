import React, { useEffect, useMemo, useState } from 'react';
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
  profileToEditableRows,
} from './logic/documentPipeline.js';

const TABS = [
  '내 정보 불러오기',
  '받을 수 있는 혜택',
  '복지절벽 미리보기',
  '신청 준비하기',
  '판정 근거 확인하기',
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
  const [docResult, setDocResult] = useState(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState('');
  const [batchRows, setBatchRows] = useState([]);
  const [batchAnalysis, setBatchAnalysis] = useState([]);
  const [policyAdmin, setPolicyAdmin] = useState({ sources: [], enabled: [], drafts: [], policies: [] });
  const [policyAdminLoading, setPolicyAdminLoading] = useState(false);
  const [policyAdminMessage, setPolicyAdminMessage] = useState('');
  const derived = useDerived(profile, benefits);

  const loadPolicyAdmin = async () => {
    setPolicyAdminLoading(true);
    setPolicyAdminMessage('');
    try {
      const [sourcesRes, draftsRes, policiesRes] = await Promise.all([
        fetch('/api/sources'),
        fetch('/api/admin/review'),
        fetch('/api/policies'),
      ]);
      if (!sourcesRes.ok) throw new Error('정책 수집 서버에 연결할 수 없습니다. 먼저 npm run server를 실행해 주세요.');
      const sources = await sourcesRes.json();
      const drafts = draftsRes.ok ? await draftsRes.json() : { drafts: [] };
      const policies = policiesRes.ok ? await policiesRes.json() : { policies: [] };
      setPolicyAdmin({
        sources: sources.sources || [],
        enabled: sources.enabled || [],
        drafts: drafts.drafts || [],
        policies: policies.policies || [],
      });
    } catch (error) {
      setPolicyAdminMessage(error?.message || String(error));
    } finally {
      setPolicyAdminLoading(false);
    }
  };

  const runPolicyIngestion = async () => {
    setPolicyAdminLoading(true);
    setPolicyAdminMessage('정책 수집을 시작했습니다. API 키와 수집 URL이 설정되어 있어야 실제 데이터가 들어옵니다.');
    try {
      const res = await fetch('/api/ingest/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ forceReview: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '정책 수집 실행 실패');
      setPolicyAdminMessage(`수집 완료: 검수 후보 ${data.drafts_created}건, 저장 정책 ${data.summary?.policies || 0}건`);
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
      const res = await fetch(`/api/admin/review/${encodeURIComponent(draftId)}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reviewer: 'local-admin' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '검수 처리 실패');
      setPolicyAdminMessage(action === 'approve' ? '정책 후보를 승인했습니다.' : '정책 후보를 반려했습니다.');
      await loadPolicyAdmin();
    } catch (error) {
      setPolicyAdminMessage(error?.message || String(error));
    } finally {
      setPolicyAdminLoading(false);
    }
  };

  useEffect(() => {
    loadPolicyAdmin();
  }, []);

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
  const applicationStrategyEntries = Object.entries(derived.strategy || {});
  const agentReasons = Array.isArray(derived.agent?.reasons) && derived.agent.reasons.length
    ? derived.agent.reasons
    : (derived.agent?.actions || []).map((a) => `${a.액션} — ${a.이유}`).filter(Boolean);
  const taskStatusText = { todo: '준비 전', planned: '예정', done: '완료' };

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <div className="eyebrow">LifePass · 문서 기반 복지 혜택 안내</div>
          <h1>내 상황에 맞는 복지 혜택과 신청 준비 순서를 한 번에 확인하세요</h1>
          <p>상담 메모나 정책 문서를 넣으면 현재 받을 수 있는 혜택, 앞으로 달라질 가능성, 먼저 준비할 서류를 순서대로 정리해 줍니다.</p>
        </div>
        <div className="hero-card">
          <Metric label="정책 룰" value={`${benefits.length}개`} note="등록된 정책 기준" />
          <Metric label="최적 조합" value={`${derived.plan.selected.length}개`} note={money(derived.plan.total_monthly_value)} />
          <Metric label="확인 우선도" value={`${derived.agent.priority_score}점`} note={derived.agent.priority_grade} />
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((tab, idx) => (
          <button key={tab} className={activeTab === idx ? 'active' : ''} onClick={() => setActiveTab(idx)}>{tab}</button>
        ))}
      </nav>

      {activeTab === 0 && (
        <main className="tab-panel">
          <Section title="내 정보 불러오기" subtitle="문서나 상담 메모에서 나이, 거주지역, 소득, 월세처럼 판정에 필요한 정보를 읽어옵니다.">
            <div className="two-col">
              <div>
                <h3>문서 파일 올리기</h3>
                <input className="file-input" type="file" accept=".pdf,.docx,.hwp,.hwpx,.owpml,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.txt,.md,.csv,.json" onChange={handleDocument} />
                <p className="muted">상담 메모, 임대차계약 관련 파일, 정책 안내문을 올릴 수 있습니다. 파일을 올리지 않아도 오른쪽의 직접 수정 영역에서 나이, 지역, 소득, 월세 같은 핵심 수치를 바로 조정할 수 있습니다.</p>
                {docLoading && <p className="status-line">문서를 읽고 있습니다. 큰 이미지나 PDF는 잠시 시간이 걸릴 수 있습니다.</p>}
                {docError && <p className="error-line">{docError}</p>}
              </div>
              <div className="info-box">
                <strong>텍스트 직접 입력은 제거했습니다</strong>
                <p>같은 정보가 파일 입력과 텍스트 입력에서 다르게 들어오면 사용자가 오히려 혼란스러울 수 있습니다. 이제 정보 입력은 파일 업로드와 아래의 직접 수정 영역으로 단순화했습니다.</p>
                <p className="muted">파일에 없는 추가 정보가 있다면 문서를 읽은 뒤 오른쪽의 숫자·선택 항목을 직접 고치면 됩니다.</p>
              </div>
            </div>
          </Section>

          {docResult && (
            <Section title="읽어낸 정보 확인하기" subtitle={`parser=${docResult.parser} / file=${docResult.file?.name}`}>
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
                  <h3>내 정보 확인·수정하기</h3>
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

          <Section title="CSV 일괄 분석은 보조 기능으로 축소" subtitle="핵심은 내 정보 불러오기이지만, 기관용 정제 데이터가 있을 때만 간단히 사용할 수 있게 남겼습니다.">
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
          <Section title="현재 받을 수 있는 혜택" subtitle="입력한 정보를 등록된 정책 조건과 비교해 지금 신청 가능성이 높은 혜택을 보여줍니다.">
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

          <Section title="동시에 받기 어려운 혜택 확인" subtitle="같은 성격의 혜택을 중복으로 받을 수 없는 경우, 더 유리한 조합을 우선 보여줍니다.">
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
          <Section title="신청 준비하기" subtitle="받을 가능성이 높은 혜택부터 서류 준비, 신청, 결과 확인 순서로 정리합니다.">
            <div className="metrics-row">
              <Metric label="신청 흐름" value={derived.workflow.workflow_id} />
              <Metric label="준비할 일" value={`${derived.workflow.tasks.length}개`} />
              <Metric label="알림 예정" value={`${derived.notifications.length}개`} />
            </div>
            <h3>먼저 할 일</h3>
            <SimpleTable rows={derived.workflow.tasks.map((t) => ({ 혜택: t.benefit, 할일: t.task, 기한: t.due, 상태: taskStatusText[t.status] || t.status }))} />
            <h3>혜택별 준비 방법</h3>
            {applicationStrategyEntries.map(([benefit, items]) => (
              <div className="check-block" key={benefit}>
                <strong>{benefit}</strong>
                <ul>{items.map((item, idx) => <li key={idx}>{item}</li>)}</ul>
              </div>
            ))}
          </Section>

          <Section title="추가 확인이 필요한 부분" subtitle="입력한 정보만으로 자동 판단하기 어려운 부분이 있으면 여기에서 확인할 수 있습니다.">
            <div className="metrics-row">
              <Metric label="확인 우선도" value={`${derived.agent.priority_score}점`} />
              <Metric label="상태" value={derived.agent.priority_grade} />
              <Metric label="상담사 확인" value={derived.agentWorkflow.human_review_required ? '권장' : '선택'} />
            </div>
            <ul className="clean-list">{agentReasons.map((r, idx) => <li key={idx}>{r}</li>)}</ul>
          </Section>
        </main>
      )}

      {activeTab === 4 && (
        <main className="tab-panel">
          <Section title="판정 근거 확인하기" subtitle="어떤 조건 때문에 가능 또는 불가능으로 판단했는지 확인할 수 있습니다." right={<button className="primary" onClick={exportReport}>리포트 저장</button>}>
            <div className="metrics-row">
              <Metric label="점검 점수" value={`${derived.audit.audit_score}점`} />
              <Metric label="상태" value={derived.audit.status} />
              <Metric label="검증 경고" value={`${derived.validationWarnings.length}개`} />
            </div>
            <h3>안전 확인 항목</h3>
            <SimpleTable rows={derived.audit.controls.map((c) => ({ 통제항목: c.control, 상태: c.status, 근거: c.evidence }))} />
            <h3>판정 과정 요약</h3>
            <SimpleTable rows={derived.agentWorkflow.steps.map((s) => ({ 단계: s.step, 노드: s.node, 작업: s.action, 결과: s.result }))} />
          </Section>

          <Section title="정책 수집 관리" subtitle="공식 API로 수집한 정책 후보를 검수하고 승인하는 운영자용 화면입니다. 실제 운영에서는 백엔드 서버와 관리자 토큰을 반드시 설정해야 합니다.">
            <div className="metrics-row">
              <Metric label="수집 소스" value={`${policyAdmin.sources.length}개`} note={`${policyAdmin.enabled.length}개 활성`} />
              <Metric label="검수 대기" value={`${policyAdmin.drafts.length}건`} />
              <Metric label="승인 정책" value={`${policyAdmin.policies.length}건`} />
              <Metric label="서버 상태" value={policyAdminMessage && policyAdminMessage.includes('연결할 수 없습니다') ? '확인 필요' : '연결 시도'} />
            </div>
            <button className="primary" onClick={loadPolicyAdmin} disabled={policyAdminLoading}>상태 새로고침</button>
            <button className="primary secondary-action" onClick={runPolicyIngestion} disabled={policyAdminLoading}>공식 API 정책 수집 실행</button>
            {policyAdminMessage && <div className={policyAdminMessage.includes('실패') || policyAdminMessage.includes('연결할 수 없습니다') ? 'warn-box' : 'info-box'}>{policyAdminMessage}</div>}
            <h3>수집 소스</h3>
            <SimpleTable rows={policyAdmin.sources.map((s) => ({ 소스: s.label, 방식: s.strategy === 'official_api' ? '공식 API' : '허용 URL 보조 수집', 우선순위: s.priority, 상태: policyAdmin.enabled.includes(s.id) ? '활성' : '비활성', 설명: s.note }))} />
            <h3>검수 대기 정책 후보</h3>
            {policyAdmin.drafts.length === 0 ? <p className="muted">검수 대기 중인 정책 후보가 없습니다. API 키와 엔드포인트를 설정한 뒤 수집을 실행하세요.</p> : (
              <div className="trace-list">
                {policyAdmin.drafts.slice(0, 6).map((draft) => (
                  <details key={draft.id} open>
                    <summary>{draft.benefit?.name || draft.id}</summary>
                    <SimpleTable rows={[
                      { 항목: '출처', 값: draft.source?.label || draft.source?.id },
                      { 항목: '변경유형', 값: draft.change_type || 'new' },
                      { 항목: '지원금', 값: draft.benefit?.estimated_monthly_value ? money(draft.benefit.estimated_monthly_value) : '확인 필요' },
                      { 항목: '검수 사유', 값: draft.ingestion?.review_reasons?.join(', ') || '확인 필요' },
                    ]} />
                    <button className="primary" onClick={() => reviewPolicyDraft(draft.id, 'approve')} disabled={policyAdminLoading}>승인</button>
                    <button className="primary danger-action" onClick={() => reviewPolicyDraft(draft.id, 'reject')} disabled={policyAdminLoading}>반려</button>
                  </details>
                ))}
              </div>
            )}
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
