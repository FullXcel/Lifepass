# 요구사항 체크리스트

| 번호 | 사용자 요구 | 구현 결과 | 파일 |
|---:|---|---|---|
| 1 | 기존 디렉토리의 로직을 그대로 사용 | 원본 deterministic core를 JS로 포팅하고 React에서 호출 | `src/logic/lifepassCore.js` |
| 2 | Streamlit이 아니라 React 버전 | Vite + React 구조로 생성 | `src/App.jsx`, `src/main.jsx` |
| 3 | React용 README | 실행법, 5개 탭, 문서 파이프라인, 제한사항 정리 | `README.md` |
| 4 | 비핵심 기능 삭제/경량화 | 17개 탭을 5개 탭으로 재구성 | `src/App.jsx` |
| 5 | 차별점만 부각 | 문서 온보딩, 복지절벽, 신청 로드맵, 신뢰성 검증 중심 | `src/App.jsx` |
| 6 | PDF 파서 | PDF 텍스트 레이어 + OCR fallback | `documentPipeline.js` |
| 7 | DOCX 파서 | mammoth raw text extraction | `documentPipeline.js` |
| 8 | HWP/HWPX 파서 | HWPX XML 파싱, HWP fallback | `documentPipeline.js` |
| 9 | OCR | tesseract.js 한국어+영어 | `documentPipeline.js` |
| 10 | 필드 추출기 | 나이, 지역, 소득, 월세, 실업급여 등 정규식/NLP 추출 | `documentPipeline.js` |
| 11 | schema mapper | 임의 헤더를 LifePass schema로 매핑 | `documentPipeline.js` |
| 12 | 검증 UI | 추출근거/확인필요/직접수정 UI | `src/App.jsx` |
| 13 | 문서 자체만 넣어도 작동 | 업로드 → 추출 → 프로필 → 판정 자동 연결 | `src/App.jsx` |
| 14 | 자체검증 | Node verification script | `scripts/verify.mjs` |
| 15 | 추가/수정 파일 정리 | 구현 요약 문서 작성 | `IMPLEMENTATION_SUMMARY.md` |

## 정직한 한계

- 구형 `.hwp`는 완전한 구조 파서가 아니라 visible string fallback입니다. HWPX 변환 또는 OCR 확인을 권장합니다.
- 브라우저 OCR은 대용량 문서에서 느릴 수 있습니다.
- 서버 저장소, 인증, 실제 공공 API 연동은 경량화 대상에서 제외했습니다.
