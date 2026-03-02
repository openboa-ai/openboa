---
title: "FAQ"
summary: "openboa 범위, 성숙도, docs-first 개발 접근에 대한 자주 묻는 질문"
read_when:
  - openboa가 현재 무엇을 지원하는지 빠르게 파악하고 싶을 때
  - 개념 문서를 깊게 읽기 전 요약 답변이 필요할 때
---

<AccordionGroup>
  <Accordion title="openboa는 무엇인가요?">
    openboa는 Business as Agent(BOA)를 위한 오픈소스 런타임입니다. 인간 운영자가 거버넌스를 유지한 채, 자율 에이전트가 비즈니스 실행을 담당합니다.
  </Accordion>
  <Accordion title="지금 당장 무엇을 할 수 있나요?">
    아직 초기 design-first 단계입니다. 현재 가치는 공통 개념 모델, 거버넌스 프레임, 문서 기반 토대에 있습니다.
  </Accordion>
  <Accordion title="아직 없는 것은 무엇인가요?">
    프로덕션 준비 런타임 스택, 성숙한 오케스트레이션 레이어, 완성된 CLI 워크플로우는 아직 공개되지 않았습니다.
  </Accordion>
  <Accordion title="누구를 위한 프로젝트인가요?">
    정책 통제, 메모리 연속성, 감사 가능성을 유지하며 에이전트 기반 실행을 운영하려는 빌더를 위한 프로젝트입니다.
  </Accordion>
  <Accordion title="왜 docs first인가요?">
    구현 복잡도가 커지기 전에 프리미티브, 제약, 용어를 먼저 정렬하기 위해서입니다.
  </Accordion>
  <Accordion title="범용 챗봇 프레임워크인가요?">
    아닙니다. openboa는 단일 대화형 봇이 아니라 비즈니스를 지속 가능한 제품 단위로 다룹니다.
  </Accordion>
  <Accordion title="인간이 항상 통제하나요?">
    네. 승인, 정책 경계, 안전 의사결정에서 인간 거버넌스는 핵심 요구사항입니다.
  </Accordion>
  <Accordion title="어디부터 읽으면 좋나요?">
    BOA 개념 → Doctrine/Contracts → 운영/트러블슈팅 순서를 권장합니다.
  </Accordion>
</AccordionGroup>

## 읽기 시작

<CardGroup cols={2}>
  <Card title="문서 홈" href="/ko/index">
    역할 기반 진입점과 빠른 탐색 경로.
  </Card>
  <Card title="Business as Agent" href="/ko/concepts/business-as-agent">
    BOA 핵심 모델과 구성 블록.
  </Card>
  <Card title="Network" href="/ko/network">
    거버넌스 관점의 네트워크 문서 허브.
  </Card>
  <Card title="문서 트러블슈팅" href="/ko/help/troubleshooting-docs">
    검증 실패 원인과 해결 절차.
  </Card>
</CardGroup>
