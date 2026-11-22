# Job Researcher

잡코리아·원티드의 백엔드·풀스택 공고를 모으고, 로컬에서 회사별로 검토하는 도구.

## 실행

Node.js 24 이상과 Git이 필요합니다.

```sh
npm ci
npx playwright install chromium
npm run dev
```

[로컬 화면](http://127.0.0.1:4317)에서 공고를 확인하고 출발역을 설정합니다.

## 주요 기능

- 회사별 공고 추천과 신규·수정 구분
- 회사 스킵·관심·지원 완료 기록
- 통근 시간 기록과 개인 상태 백업·복원
- GitHub Actions 정기 수집: 매일 한국시간 04:00

## 설계 원칙

- DB 서버와 LLM API 없이 JSON 파일로 저장하고 규칙으로 추천합니다.
- 백엔드·풀스택을 우선 선별하고, Go·Python·PHP·Java/Spring·Vue 등 공개 기술 프로필로 추천합니다.
- 일반 개발자 공고는 본문의 API·서버 업무와 기술 근거를 함께 확인합니다. 독립적인 프론트엔드·DevOps·인프라·데이터 직무는 제외합니다.
- 공개 공고는 `data/`, 수집 결과는 `reports/`에 보관합니다.
- 출발역과 개인 기록은 Git에서 제외한 `.local/`에만 저장합니다.
- 수집 실패 시 기존 데이터를 보존하고, 목록 누락만으로 마감 처리하지 않습니다.

## 점검

```sh
npm run collect  # 수집
npm run check    # 테스트·빌드·개인정보 검사
```

최근 수집 결과는 [reports/collection.json](reports/collection.json), 개발 규칙은 [AGENTS.md](AGENTS.md), 디자인 규칙은 [docs/design.md](docs/design.md)를 확인합니다.

## 현재 제한

- 두 사이트의 목록·상세 제한 수집을 검증했습니다. 전체 수집 검증은 남아 있습니다.
- 원티드는 수집기를 명시한 브라우저 요청을 사용합니다. 사이트 접근 정책에 따라 수집이 제한될 수 있습니다.
- 이미지 공고의 텍스트 추출, 통근 시간 자동 계산, 모바일 원격 접속은 지원하지 않습니다.
