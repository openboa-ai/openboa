---
title: "문서 트러블슈팅"
summary: "PR 머지 전 깨진 링크, 마크다운 오류, 문서 구조 드리프트를 해결하는 절차"
read_when:
  - 로컬/CI에서 문서 체크가 실패할 때
  - 문서 변경 표준 검증 순서가 필요할 때
---

## 빠른 점검

```bash
pnpm check:docs
pnpm docs:linkcheck
pnpm docs:validate
```

<Note>
명시적으로 `docs`로 이동하는 명령이 아니면 저장소 루트에서 실행하세요.
</Note>

## 자주 발생하는 이슈

<AccordionGroup>
  <Accordion title="상대 링크 깨짐">
증상: 링크 체크가 파일 누락을 보고함.

해결: Mintlify 라우트(`/path`)를 사용하고, `docs/docs.json` 네비게이션과 경로를 일치시키며, 페이지 이동/이름 변경 후 오래된 경로를 제거합니다.
  </Accordion>
  <Accordion title="네비게이션에 페이지 미노출">
증상: 파일은 있는데 사이드바/탭에 표시되지 않음.

해결: `docs/docs.json`에 페이지 라우트를 추가하고 `mintlify validate`로 구조 무결성을 확인합니다.
  </Accordion>
  <Accordion title="Markdown lint 실패">
증상: `pnpm check:docs`가 포맷/헤딩 규칙으로 실패함.

해결: linter 출력 라인 기준으로 수정하고, 헤딩 계층/리스트 형식을 일관되게 유지하며, 가능한 Mintlify 기본 컴포넌트를 사용합니다.
  </Accordion>
  <Accordion title="Mintlify 검증 실패">
증상: markdownlint는 통과했는데 `mintlify validate` 실패.

해결: 지원되지 않는 컴포넌트 문법, `docs/docs.json`의 탭/그룹/페이지 매핑, 존재하지 않는 라우트 링크를 점검합니다.
  </Accordion>
  <Accordion title="페이지는 있는데 Mintlify 500 에러가 뜸">
증상: 라우트는 존재하는데 `Page not found!` 와 unexpected error 페이지가 렌더링됨.

해결: frontmatter를 `title`, `summary` 중심의 보수적인 형태로 줄이고, 지원되는 Markdown/Mintlify 컴포넌트만 남긴 뒤 `pnpm docs:routecheck --base-url <preview-or-site-url>` 로 실제 렌더링을 확인합니다.
  </Accordion>
</AccordionGroup>

## PR 체크리스트

<Steps>
  <Step title="포맷/링크 검증">
    `pnpm check:docs`와 `pnpm docs:linkcheck` 실행
  </Step>
  <Step title="Mintlify 라우팅/구조 검증">
    `pnpm docs:validate` 실행
  </Step>
  <Step title="실제 라우트 렌더링 스모크 테스트">
    로컬 프리뷰나 배포 호스트를 대상으로 `pnpm docs:routecheck --base-url http://localhost:3000` 실행
  </Step>
  <Step title="핵심 경로 스팟체크">
    [문서 홈](../index.md), [FAQ](./faq.md), [Business as Agent](../concepts/business-as-agent.md) 접근 확인
  </Step>
</Steps>
