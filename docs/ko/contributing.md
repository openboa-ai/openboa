---
title: "기여 가이드"
summary: "openboa 문서 기여를 위한 기본 규칙과 네이밍 기준"
---

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

## 네이밍 예시

- ✅ `runtime-architecture.md`
- ✅ `access-control.md`
- ❌ `RuntimeArchitecture.md`
- ❌ `runtime_architecture.md`
