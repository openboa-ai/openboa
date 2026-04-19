---
title: "개발 가이드"
summary: "openboa 기여를 위한 핵심 명령과 작업 루프"
read_when:
  - 코드/문서 변경을 시작할 때
---

## 핵심 명령

```bash
pnpm dev
pnpm precommit:check
pnpm test
pnpm check
pnpm check:docs
pnpm docs:linkcheck
pnpm docs:validate
```

## 권장 작업 루프

1. 의도 정렬: Doctrine/Contracts 먼저 확인
2. 작은 단위로 구현
3. 로컬 검증 (`pnpm precommit:check`, 필요 시 `pnpm check`, docs checks)
4. 커밋/PR

## Git Hook

- 기준 파일: `.pre-commit-config.yaml`
- 필수 차단:
  - 저장소 hygiene 훅
  - `pnpm precommit:check`
- `pnpm precommit:check` 구성:
  - `pnpm format:check`
  - `pnpm lint`
  - `pnpm typecheck`
- 권고/수동:
  - `pnpm test`
  - `detect-secrets`
  - `actionlint`
  - `zizmor`

검증 명령:

```bash
pnpm precommit:check
```

## 품질 원칙

- 실행 가능한 결과 우선
- 트레이드오프를 명시
- 결정 이유를 문서화

## 머지 게이트 (main PR)

v1 머지 게이트는 `strict-required core only` 를 사용합니다.

- 필수 상태: `ci / required-ci`, `PR Convention / convention`
- 참고 상태: `codeql / analyze (javascript-typescript)` 와 `ci` 내부 개별 잡
- 기준 문서: [기여 가이드](./contribution-guide.md#머지-게이트-체크-매트릭스-v1)

필수 체크가 거짓 실패로 보이면 [기여 가이드](./contribution-guide.md#임시-우회-경로-오탐거짓-실패-전용) 의 단건 관리자 우회 절차를 사용합니다. 우회는 예외적이어야 하며, 기록 가능하고, 시간 제한이 있어야 합니다.
