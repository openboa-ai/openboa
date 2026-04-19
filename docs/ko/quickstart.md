---
title: "빠른 시작"
summary: "openboa 문서를 로컬에서 검증하는 최소 절차"
read_when:
  - 문서 변경 전/후 빠르게 체크하고 싶을 때
---

## 요구사항

- Node.js 22+
- pnpm 10.23.0

## 설치

```bash
pnpm install
```

## 기본 점검

```bash
pnpm check:docs
pnpm docs:linkcheck
```

## 문서 검증(Mintlify)

```bash
cd docs && pnpm dlx mintlify validate
```

## 참고

- 커밋 시 pre-commit hook이 문서 체크를 실행합니다.
- 실패하면 에러 메시지부터 해결한 뒤 커밋을 다시 시도하세요.
