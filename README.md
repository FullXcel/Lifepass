# LifePass React Lite

LifePass React Lite는 복지·주거·고용 지원정책을 사용자의 실제 상황과 연결해, **현재 받을 수 있는 혜택**, **앞으로 사라질 수 있는 혜택**, **신청을 위해 준비해야 할 일**을 한 흐름으로 보여주는 문서 기반 복지 의사결정 웹앱입니다.

이 프로젝트는 단순히 “혜택 목록”을 보여주는 앱이 아니라, 상담 메모·임대차 정보·정책 안내문처럼 정형화되지 않은 문서를 입력받아 구조화하고, 규칙 기반 판정 엔진으로 재현 가능한 결과를 산출하는 것을 목표로 합니다.

> 현재 포함된 정책 데이터는 데모/프로토타입 검증용입니다. 실제 서비스에서는 복지로, 정부24, 고용24, 지자체 공고 등 최신 원문과 기관 검수 절차를 반드시 연결해야 합니다.

---

## 주요 기능

### 1. 문서 기반 온보딩

사용자는 CSV를 직접 정리하지 않아도 됩니다. PDF, DOCX, HWPX, 이미지, TXT, 상담 메모를 업로드하거나 붙여넣으면 앱이 나이, 지역, 월소득, 월세, 보증금, 실업급여 잔여일, 주거계약 여부 같은 핵심 필드를 추출합니다.

지원 입력 형식은 다음과 같습니다.

| 입력 형식 | 처리 방식 |
|---|---|
| PDF | `pdfjs-dist` 텍스트 레이어 추출, 필요 시 OCR 보조 |
| DOCX | `mammoth` raw text 추출 |
| HWPX / OWPML | ZIP 내부 XML 텍스트 추출 |
| HWP | visible string fallback. 완전 파싱이 아니므로 검증 필요 |
| 이미지 | `tesseract.js` 기반 한국어/영어 OCR |
| TXT / MD / JSON | 일반 텍스트 추출 |
| CSV | 헤더 schema mapping 후 일괄 프로필 변환 |

### 2. 정책 문서와 신청자 문서 분리

정책 공고문과 신청자 개인 문서를 같은 방식으로 처리하면 오류가 발생할 수 있습니다. 예를 들어 정책 문서의 “만 19~34세”, “월세 70만원 이하”를 신청자의 실제 나이나 월세로 오해할 수 있습니다.

수정된 파이프라인은 문서 유형을 먼저 감지합니다.

- 신청자 문서: 프로필 필드를 추출하고 현재 프로필에 반영
- 정책 공고문: 연령 기준, 월세 기준, 보증금 기준, 지원금, 소득 기준, 필요서류, 신청방법을 별도 추출하며 현재 사용자 프로필을 자동 덮어쓰지 않음

### 3. 규칙 기반 자격 판정

자격 판정은 LLM 추측이 아니라 `src/data/benefits.json`의 JSON rule을 `src/logic/lifepassCore.js`의 deterministic rule engine으로 평가합니다.

각 정책에 대해 다음을 확인할 수 있습니다.

- 가능 / 불가능 여부
- 충족 조건
- 미충족 조건
- 월 환산효과
- 중복 또는 충돌되는 혜택
- 필요한 신청 서류

### 4. 복지절벽 시뮬레이션

현재 받을 수 있는 혜택만 보는 것이 아니라, 1개월·3개월·6개월·12개월 뒤의 상황 변화도 계산합니다.

예를 들어 다음 변화를 반영합니다.

- 실업급여 종료
- 예상 소득 발생
- 소득 증가로 인한 자격 상실
- 명목소득은 늘었지만 실제 순효과가 줄어드는 복지절벽 구간

### 5. 신청 로드맵과 신뢰성 리포트

선정된 혜택에 대해 신청 순서, 준비 서류, 알림 계획, 상담사 확인이 필요한 위험 신호를 제공합니다. 또한 조건 단위 trace와 audit score를 통해 왜 그런 결과가 나왔는지 확인할 수 있습니다.

---

## 실행 방법

### 요구 환경

- Node.js 18 이상 권장
- npm

### 설치 및 개발 서버 실행

```bash
cd lifepass_react_lite
npm install
npm run dev
```

브라우저에서 다음 주소로 접속합니다.

```text
http://localhost:5173
```

### 프로덕션 빌드

```bash
npm run build
npm run preview
```

### 자체 검증

```bash
npm run verify
```

검증 스크립트는 다음 항목을 확인합니다.

- 정책 JSON rule 평가
- 최적 혜택 조합 계산
- 복지절벽 시뮬레이션
- 자연어/문서 필드 추출
- CSV schema mapper
- 실제 정책 안내문 형태의 테스트 문서 파싱
- React 5개 탭 구조

---

## 디렉토리 구조

```text
lifepass_react_lite/
├── package.json
├── index.html
├── README.md
├── IMPLEMENTATION_SUMMARY.md
├── docs/
│   ├── ORIGINAL_ARCHITECTURE_REFERENCE.md
│   ├── REQUIREMENT_CHECKLIST.md
│   └── test_inputs/
│       └── youth_rent_policy_notice_2026.txt
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

## 핵심 파일 설명

| 파일 | 역할 |
|---|---|
| `src/App.jsx` | React UI. 문서 온보딩, 현재 판정, 복지절벽, 신청 로드맵, 신뢰성 리포트 5개 탭 구성 |
| `src/logic/lifepassCore.js` | 프로필 정규화, 자연어 파싱, 정책 rule 평가, 최적화, 시뮬레이션, 리포트 생성 |
| `src/logic/documentPipeline.js` | PDF/DOCX/HWPX/OCR/TXT 추출, 필드 추출, 정책 문서 감지, schema mapping |
| `src/data/benefits.json` | 데모 정책 카탈로그와 eligibility rule |
| `scripts/verify.mjs` | Node 기반 자체 검증 스크립트 |
| `docs/test_inputs/youth_rent_policy_notice_2026.txt` | 정책 문서 파싱 검증용 테스트 입력 |

---

## 사용 흐름

```text
문서 업로드 또는 텍스트 입력
→ 문서 유형 감지
→ 신청자 문서이면 프로필 필드 추출
→ 정책 문서이면 정책 기준만 별도 추출
→ 추출 근거와 검증 이슈 확인
→ 사용자가 필요한 값 수정
→ 규칙 기반 혜택 판정
→ 중복/충돌 제거 후 최적 조합 계산
→ 복지절벽·생애전환 시뮬레이션
→ 신청 로드맵·신뢰성 리포트 확인
```

---

## 설계 원칙

1. **추측보다 근거**  
   추출된 값마다 원문 근거와 confidence를 함께 보여줍니다.

2. **LLM 판정 금지**  
   자격 판정은 JSON rule과 deterministic engine으로 수행합니다. LLM은 설명 보조 역할에만 적합합니다.

3. **정책 문서 오인 방지**  
   정책 공고의 기준값을 사용자의 실제 개인정보로 덮어쓰지 않습니다.

4. **현재 추천에서 끝나지 않기**  
   실업급여 종료, 소득 발생, 자격 상실 가능성까지 시간축으로 계산합니다.

5. **사람이 검증 가능한 결과**  
   검증 UI, 조건 trace, audit score, human review 신호를 제공합니다.

---

## 알려진 한계

- 구형 `.hwp`는 브라우저에서 완전한 구조 파싱이 어렵습니다. HWPX 변환 또는 OCR 검증을 권장합니다.
- OCR 품질은 이미지 해상도, 스캔 각도, 글꼴에 영향을 받습니다.
- 현재 프로젝트는 브라우저 중심 경량 MVP이며 서버 DB, 인증, 개인정보 암호화 저장, 실제 공공 API 연동은 포함하지 않습니다.
- `benefits.json`의 정책 기준은 데모용입니다. 실제 서비스화 단계에서는 최신 정책 원문 수집, 변경 감지, 기관 검수, 배포 승인 프로세스가 필요합니다.
