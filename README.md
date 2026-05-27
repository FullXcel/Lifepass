# LifePass React Lite

## 문서 기반 청년 복지 절벽 방지·생애전환 의사결정 웹앱

이 디렉토리는 기존 Streamlit 기반 `lifepass` 프로젝트를 **React 웹앱**으로 경량화한 버전입니다. 기존 MVP의 핵심 로직은 JavaScript로 포팅했고, Streamlit에 흩어져 있던 다수의 탭은 서비스 차별점이 잘 드러나는 **5개 탭**으로 재구성했습니다.

핵심 방향은 다음입니다.

1. 사용자가 CSV를 정제해서 올리지 않아도, PDF/DOCX/HWP/HWPX/이미지/텍스트 문서를 업로드하면 프로필 필드를 추출합니다.
2. 추출된 필드는 schema mapper를 거쳐 LifePass `UserProfile` 구조로 변환됩니다.
3. 검증 UI에서 추출 근거, 누락 필드, 확인 필요 항목을 보여줍니다.
4. 자격 판정은 LLM이 아니라 기존 `benefits.json`과 규칙 기반 rule engine으로 수행합니다.
5. 단순 현재 추천이 아니라 복지절벽, 생애전환, 신청 로드맵, 신뢰성 검증까지 이어집니다.

> 주의: 정책 DB의 기준값은 원본 프로젝트와 동일하게 데모/대회용 데이터입니다. 실제 서비스에서는 복지로·정부24·고용24 등 최신 공고/API와 기관 검증 절차가 필요합니다.

---

## 1. 실행 방법

```bash
cd lifepass_react_lite
npm install
npm run dev
```

접속 주소:

```text
http://localhost:5173
```

프로덕션 빌드:

```bash
npm run build
npm run preview
```

자체 검증:

```bash
npm run verify
```

---

## 2. 5개 핵심 탭

기존 Streamlit 앱은 `AI Agent`, `온보딩/프로필`, `현재 판정`, `생애전환/절벽`, `CSV 일괄분석`, `정책 수집`, `DB/신청관리`, `전략·API`, `운영자`, `공공 API Gateway`, `고급 AI/신뢰성`, `v4`, `v5`, `실서비스화` 등 여러 탭이 있었습니다.

React Lite에서는 심사/시연에서 차별점이 약한 부가 운영 기능을 제거하거나 내부 로직으로 흡수하고, 다음 5개 탭만 남겼습니다.

### 1. 문서 온보딩

- PDF 텍스트 레이어 추출
- 이미지 기반 문서 OCR
- DOCX 텍스트 추출
- HWPX XML 추출
- 구형 HWP 바이너리 visible string fallback
- 텍스트 직접 입력
- CSV 보조 업로드
- 필드 추출기
- schema mapper
- 검증 UI
- 추출 근거 표시

### 2. 현재 판정

- `benefits.json` 기반 규칙 판정
- 가능/불가능 조건 추적
- 중복/충돌 혜택 제거
- 월 환산효과 기준 최적 조합

### 3. 복지절벽 시뮬레이션

- 현재, 1개월, 3개월, 6개월, 12개월 변화
- 실업급여 종료 반영
- 예상 소득 발생 반영
- 소득별 복지절벽 시뮬레이션
- Counterfactual 상황 비교

### 4. 신청 로드맵

- 추천 혜택별 준비 서류
- 신청 workflow
- 알림 outbox 계획
- 상담사 개입 우선순위
- human review 트리거

### 5. 신뢰성·근거 리포트

- deterministic eligibility 감사
- conflict handling 감사
- human review 감사
- agent workflow trace
- 조건 단위 판정 근거
- Markdown 리포트 저장

---

## 3. 문서 업로드 동작 방식

지원 입력:

| 형식 | 처리 방식 |
|---|---|
| PDF | `pdfjs-dist`로 텍스트 레이어 추출, 텍스트가 부족하면 OCR 옵션 사용 |
| DOCX | `mammoth`로 raw text 추출 |
| HWPX/OWPML | `jszip`으로 XML 내부 텍스트 추출 |
| HWP | 바이너리 visible string fallback. 완전 파싱이 아니므로 검증 UI에서 확인 필요 표시 |
| 이미지 | `tesseract.js` OCR, 한국어+영어 |
| TXT/MD | 일반 텍스트 추출 |
| CSV | schema mapper로 일괄 프로필 변환 |

문서 파이프라인:

```text
파일 업로드
→ text extraction / OCR
→ field extractor
→ schema mapper
→ profile validation
→ 사용자가 검증 UI에서 확인/수정
→ rule engine 판정
→ optimizer / simulator / workflow / audit
```

---

## 4. 기존 로직과 React 포팅 매핑

| 원본 Python/Streamlit | React Lite |
|---|---|
| `app.py` | `src/App.jsx` |
| `core/rule_engine.py` | `src/logic/lifepassCore.js`의 `evaluateRule`, `evaluateBenefit`, `evaluateAll` |
| `core/optimizer.py` | `optimizeBenefits` |
| `core/constraint_solver.py` | `solveBenefitPortfolio` |
| `core/simulator.py` | `simulateTimeline`, `simulateIncomeCliff`, `generateTimelineEvents` |
| `core/profile_parser.py` | `parseOnboardingText` |
| `core/batch.py`, `core/smart_mapper.py` | `documentPipeline.js`의 `buildSchemaMap`, `mapRowsToProfiles` |
| `core/document_parser.py` | `documentPipeline.js`의 `extractTextFromFile`, `runDocumentPipeline` |
| `core/agent.py`, `agent_workflow.py` | `buildAgentPlan`, `buildAgentWorkflow` |
| `core/application_review.py`, `notifications.py` | `buildApplicationWorkflow`, `planNotifications` |
| `core/audit.py`, `privacy.py` | `buildTrustAudit`, validation/audit screen |
| `core/report.py` | `makeMarkdownReport` |

---

## 5. 제거/축소한 비핵심 기능

다음 기능은 React Lite에서 화면 탭으로 분리하지 않았습니다.

- DB/신청관리의 실제 SQLite/PostgreSQL 저장소 UI
- 운영자 관리 탭
- 공공 API Gateway 탭
- v4/v5 실시간 이벤트 mesh, policy twin, 보안/인과/품질 실험용 탭
- 전략/API 문서성 탭
- 정책 수집 대시보드 전체 화면
- 고급 AI/RAG/embedding 화면

삭제 이유:

- 대회 시연에서 핵심 차별점은 “문서 기반 입력 → 규칙 기반 판정 → 복지절벽 시뮬레이션 → 신청 로드맵 → 신뢰성 검증” 흐름입니다.
- 운영/인프라/실험성 탭이 너무 많으면 서비스의 핵심 가치가 흐려집니다.
- 필요한 기능 일부는 내부 로직이나 리포트 화면으로 흡수했습니다.

---

## 6. 디렉토리 구조

```text
lifepass_react_lite/
├── package.json
├── index.html
├── README.md
├── IMPLEMENTATION_SUMMARY.md
├── docs/
│   ├── ORIGINAL_ARCHITECTURE_REFERENCE.md
│   └── REQUIREMENT_CHECKLIST.md
├── scripts/
│   └── verify.mjs
└── src/
    ├── App.jsx
    ├── main.jsx
    ├── styles.css
    ├── data/
    │   ├── benefits.json
    │   ├── sample_profiles.json
    │   ├── profile_batch_template.csv
    │   └── policy_feed_template.csv
    └── logic/
        ├── lifepassCore.js
        └── documentPipeline.js
```

---

## 7. 한계와 다음 단계

- 브라우저 단독 웹앱이므로 실제 기관 연동, 인증, 서버 DB 저장, 문서 보관은 포함하지 않았습니다.
- 구형 `.hwp` 바이너리는 완전 파싱이 어렵기 때문에 HWPX 변환 또는 OCR 검증을 권장합니다.
- OCR 품질은 이미지 해상도, 스캔 각도, 글꼴에 영향을 받습니다. 검증 UI에서 사람이 확인하도록 설계했습니다.
- 실제 배포 시에는 서버 측 파일 스캔, 개인정보 암호화, 접근 권한, 감사 로그, 정책 데이터 최신화 파이프라인이 필요합니다.
