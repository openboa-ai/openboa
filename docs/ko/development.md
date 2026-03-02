---
title: "개발 가이드"
summary: "openboa 기여를 위한 핵심 명령과 작업 루프"
read_when:
  - 코드/문서 변경을 시작할 때
---

## 핵심 명령

```bash
pnpm dev
pnpm test
pnpm check
pnpm check:docs
pnpm docs:linkcheck
```

## 권장 작업 루프

1. 의도 정렬: Doctrine/Contracts 먼저 확인
2. 작은 단위로 구현
3. 로컬 검증 (`pnpm check`, docs checks)
4. 커밋/PR

## Git Hook

- 경로: `.githooks/pre-commit`
- 동작:
  - `gitleaks` staged scan
  - `pnpm check:docs`
  - 코드 변경 시 `pnpm check`

## 품질 원칙

- 실행 가능한 결과 우선
- 트레이드오프를 명시
- 결정 이유를 문서화
