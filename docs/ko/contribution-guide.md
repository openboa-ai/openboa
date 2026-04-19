---
title: "기여 가이드"
summary: "openboa 문서 기여를 위한 기본 규칙과 네이밍 기준"
---
# 기여 가이드


## 문서 규칙

- 공식 문서는 `docs/` 하위에 작성
- 파일명은 lowercase kebab-case
- 스레드/PR 맥락은 공식 문서 본문에 넣지 않음
- 기술 근거 링크는 기술 문서에 배치

## 커밋 컨벤션

- 커밋 제목 형식: `type: description`
- 예시:
  - `docs: refine fundamentals chat contract`
  - `feat: add runtime checkpoint recovery`
- 강제 검사: pre-commit `commit-msg` 훅 (`scripts/validate-commit-msg.sh`)

## PR 컨벤션

- PR 제목 형식: `type: description`
- PR 본문 필수 섹션:
  - `## Summary`
  - `## Checklist`
  - `## Validation`
  - `## Related`
- 템플릿: `.github/pull_request_template.md`
- 강제 검사: `.github/workflows/pr-convention.yml`

## 머지 게이트 체크 매트릭스 (v1)

v1 게이트 모드는 `strict-required core only` 입니다.

| 상태 체크 | 필수 여부 | 적용 범위 | 머지 통과 의미 | 비고 |
| --- | --- | --- | --- | --- |
| `ci / required-ci` | 필수 | `main` 대상 모든 PR | 반드시 `success` | `.github/workflows/ci.yml` 의 집계 게이트입니다. 범위 밖이라 의도적으로 건너뛴 하위 잡을 제외하고 필요한 하위 잡이 모두 통과해야 합니다. |
| `PR Convention / convention` | 필수 | `main` 대상 모든 PR | 반드시 `success` | `.github/workflows/pr-convention.yml` 에서 PR 제목/본문 섹션 규칙을 검사합니다. |
| `codeql / analyze (javascript-typescript)` | 선택 | `main` PR 및 push | v1 머지 게이트에서는 참고용 | 보안 판단에는 활용하지만 브랜치 보호 필수 체크로 지정하지 않습니다. |
| `check`, `docs`, `secrets`, `gitleaks` 개별 잡 상태 | 선택 | `ci` 워크플로 내부 | 브랜치 보호 기준에서는 참고용 | 브랜치 보호는 개별 잡이 아니라 `ci / required-ci` 하나만 요구합니다. |

리뷰어 머지 체크리스트:
- `ci / required-ci` 가 green 인가
- `PR Convention / convention` 이 green 인가
- 필수 리뷰 수가 충족됐는가
- 참고용 체크에서 미해결 보안 우려가 남아 있지 않은가

## 브랜치 보호 (main)

저장소 관리자는 다음 기준을 적용해야 합니다.

- pull request 필수
- force-push 비활성화
- required checks:
  - `ci / required-ci`
  - `PR Convention / convention`
- 최소 1명 승인 리뷰
- 새 커밋 푸시 시 기존 승인 해제

정렬 원칙:
- merge 전에 required status checks 통과를 강제합니다.
- v1 에서는 `codeql / analyze (javascript-typescript)` 를 required check 로 지정하지 않습니다.
- `check`, `docs`, `secrets`, `gitleaks` 를 별도 required check 로 중복 지정하지 않습니다.
- bypass 권한은 저장소 관리자에게만 부여합니다.

## 임시 우회 경로 (오탐/거짓 실패 전용)

필수 체크가 툴링이나 플랫폼 문제로 거짓 실패했다고 판단될 때만 사용합니다. 제품 위험이나 테스트 실패가 남아 있으면 우회하면 안 됩니다.

필수 조건:
- 실패한 run URL 을 PR 대화에 남길 것
- 왜 거짓 실패라고 판단했는지 승인자가 기록할 것
- merge 전 후속 이슈 또는 incident 링크를 남길 것
- 저장소 관리자가 승인할 것
- 우회는 해당 PR 1건에만 적용할 것

시간 제한:
- merge 직후 일반 required-check 강제를 복구할 것
- 원인이 아직 열려 있으면 연결한 후속 이슈에서 추적하고, 추가 우회가 필요하면 매번 새 관리자 리뷰를 받을 것

## 네이밍 예시

- ✅ `runtime-architecture.md`
- ✅ `access-control.md`
- ❌ `RuntimeArchitecture.md`
- ❌ `runtime_architecture.md`
