# LifePass React Lite 구현 요약

## 생성한 결과물

새 디렉토리:

```text
lifepass_react_lite
```

압축 파일:

```text
lifepass_react_lite.zip
```

## 요구사항 반영 여부

| 요구사항 | 반영 상태 | 구현 위치 |
|---|---:|---|
| 첨부 디렉토리의 로직을 React 버전으로 재구성 | 반영 | `src/logic/lifepassCore.js`, `src/App.jsx` |
| Streamlit이 아니라 React 웹앱으로 구현 | 반영 | `package.json`, `index.html`, `src/main.jsx`, `src/App.jsx` |
| README를 React용으로 수정 | 반영 | `README.md` |
| 기존 대시보드 항목을 필수 내용만 남기고 경량화 | 반영 | Streamlit 17개 탭 → React 5개 탭 |
| 서비스 차별점이 드러나는 항목만 유지 | 반영 | 문서 온보딩, 현재 판정, 복지절벽, 신청 로드맵, 신뢰성 리포트 |
| PDF 파서 추가 | 반영 | `src/logic/documentPipeline.js`의 `extractPdfText` |
| DOCX 파서 추가 | 반영 | `extractDocxText`, `mammoth` 사용 |
| HWP/HWPX 파서 추가 | 부분 반영 | HWPX XML 파싱, 구형 HWP 바이너리 visible string fallback |
| OCR 추가 | 반영 | `extractImageOcr`, PDF OCR fallback, `tesseract.js` 사용 |
| 필드 추출기 추가 | 반영 | `extractFieldsFromText` |
| schema mapper 추가 | 반영 | `buildSchemaMap`, `mapRowToProfile`, `mapRowsToProfiles` |
| 검증 UI 추가 | 반영 | `ProfileEditor`, `buildVerificationChecklist`, validation issue UI |
| 문서 자체만 넣어도 작동 | 반영 | 문서 업로드 → 추출 → 프로필 → 판정 흐름 |
| 탭을 5개 정도로 축소 | 반영 | `TABS` 배열 5개 |
| 자체 검증 수행 | 반영 | `scripts/verify.mjs`, 실행 로그 확인 |

## React Lite의 5개 탭

1. 문서 온보딩
2. 현재 판정
3. 복지절벽 시뮬레이션
4. 신청 로드맵
5. 신뢰성·근거 리포트

## 추가한 파일

```text
package.json
index.html
README.md
IMPLEMENTATION_SUMMARY.md
docs/REQUIREMENT_CHECKLIST.md
docs/ORIGINAL_ARCHITECTURE_REFERENCE.md
scripts/verify.mjs
src/main.jsx
src/App.jsx
src/styles.css
src/logic/lifepassCore.js
src/logic/documentPipeline.js
src/data/benefits.json
src/data/sample_profiles.json
src/data/profile_batch_template.csv
src/data/policy_feed_template.csv
```

## 수정한 파일

원본 디렉토리의 파일을 직접 수정하지 않고, 새 React 디렉토리를 만들었습니다.

원본의 Python/Streamlit 파일은 변경하지 않았습니다. 대신 핵심 로직을 React용 JS 모듈로 포팅했습니다.

## 축소/삭제한 화면 단위 기능

아래 Streamlit 탭들은 React Lite에서 독립 화면으로 유지하지 않았습니다.

- 정책 수집
- DB/신청관리
- 전략·API
- 운영자
- 공공 API Gateway
- 고급 AI/신뢰성의 일부 실험 기능
- v4 운영플랫폼
- v4 데이터지능
- v4 품질/API
- v5 실시간·정책트윈
- v5 보안·인과·품질
- 실서비스화

삭제/축소 사유:

- 심사용·시연용 서비스에서는 운영 인프라보다 사용자 문제 해결 흐름이 중요합니다.
- 탭이 많으면 “문서 입력만으로 복지절벽을 예측한다”는 차별점이 약해집니다.
- 필요한 신뢰성/검증 기능은 `신뢰성·근거 리포트` 탭으로 병합했습니다.

## 유지한 핵심 로직

- 자연어/문서 프로필 파싱
- 정책 룰 기반 자격 판정
- 조건별 trace
- 혜택 충돌 제거
- 최적 혜택 조합 산정
- 생애전환 타임라인
- 소득별 복지절벽 탐지
- 신청 서류/신청 workflow
- 상담 우선도 산정
- human review 트리거
- audit/trust controls
- markdown report 생성

## 문서 파이프라인

```text
PDF/DOCX/HWP/HWPX/이미지/텍스트/CSV
→ extractTextFromFile
→ extractFieldsFromText
→ buildSchemaMap / mapRowToProfile
→ validateExtraction
→ ProfileEditor에서 사람 검증
→ evaluateAll / optimizeBenefits / simulateTimeline
```

## 자체 검증 결과

검증 스크립트:

```bash
npm run verify
```

검증 항목:

- 규칙 기반 현재 판정
- 최적 조합 충돌 제거
- 생애전환 타임라인
- 복지절벽 시뮬레이션
- 문서 텍스트 필드 추출
- validation issue 생성
- schema mapper
- CSV batch mapping
- audit score
- React 5-tab 선언
- 필수 파일 존재 여부

검증 결과는 `scripts/verify.mjs` 실행 시 콘솔에 출력됩니다.
