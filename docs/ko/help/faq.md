---
title: "FAQ"
summary: "openboa 범위, 성숙도, docs-first 개발 접근에 대한 자주 묻는 질문"
read_when:
  - openboa가 현재 무엇을 지원하는지 빠르게 파악하고 싶을 때
  - 개념 문서를 깊게 읽기 전 요약 답변이 필요할 때
---
# FAQ


<AccordionGroup>
  <Accordion title="openboa는 무엇인가요?">
    openboa는 Business of Agents(BOA) 시스템입니다. Business를 지속되는 운영 주체로 두고, Agent를 진화 가능한 실행 인력으로 다룹니다.
  </Accordion>
  <Accordion title="openboa는 어떻게 구성되나요?">
    제품 스택은 `Agent -> Chat -> Work -> Observe` 입니다. Agent는 worker runtime, Chat은 shared coordination, Work는 business execution, Observe는 governance and evidence를 맡습니다.
  </Accordion>
  <Accordion title="현재 wedge는 무엇인가요?">
    현재 첫 believable wedge는 Chat입니다. openboa는 chat-first company runtime으로 만들고 있고, Work와 Observe는 1급 product surface이지만 구현 성숙도는 아직 더 이른 단계입니다.
  </Accordion>
  <Accordion title="지금 실제로 구현된 것은 무엇인가요?">
    현재 코드 현실은 일부러 uneven합니다. Agent는 real session-first runtime이고, Chat은 real shared truth와 projection이 있으며, Work와 Observe는 주로 shared model type과 shell scaffolding 형태로 존재합니다.
  </Accordion>
  <Accordion title="범용 챗봇 프레임워크인가요?">
    아닙니다. Chat이 현재 wedge이긴 하지만 openboa는 “그냥 채팅”이 아닙니다. coordination, execution, evidence가 바뀌는 worker와 tool 위에서도 durable하게 남는 business operating system을 지향합니다.
  </Accordion>
  <Accordion title="누구를 위한 프로젝트인가요?">
    정책 통제, 메모리 연속성, 감사 가능성, 명시적 business ownership을 유지하면서 agent-based execution을 운영하려는 빌더를 위한 프로젝트입니다.
  </Accordion>
  <Accordion title="인간이 항상 통제하나요?">
    네. 인간은 여전히 방향, 승인 경계, 품질 기준, 최종 signoff를 맡습니다. openboa는 no-operator fully autonomous model을 지향하지 않습니다.
  </Accordion>
  <Accordion title="왜 docs first인가요?">
    autonomous implementation complexity가 커지기 전에 product meaning, architecture boundary, design taste, quality expectation을 먼저 정렬하기 위해서입니다.
  </Accordion>
  <Accordion title="기여자는 지금 무엇을 전제로 봐야 하나요?">
    임시 구현 편의보다 surface boundary를 더 중요하게 봐야 합니다. Agent, Chat, Work, Observe는 일부 레이어가 아직 scaffold 상태여도 개념적으로 분리되어 있어야 합니다.
  </Accordion>
  <Accordion title="어디부터 읽으면 좋나요?">
    Introduction, Business of Agents, Core Doctrine, Architecture 순으로 읽고, 그 다음 Agent, Chat, Work, Observe surface 문서를 읽는 것을 권장합니다.
  </Accordion>
</AccordionGroup>

## 읽기 시작

<CardGroup cols={2}>
  <Card title="소개" href="/ko/introduction">
    openboa가 무엇인지, 왜 필요한지, 현재 성숙도 차이를 가장 짧게 설명합니다.
  </Card>
  <Card title="Business of Agents" href="/ko/concepts/business-of-agents">
    BOA 핵심 모델과 구성 블록.
  </Card>
  <Card title="아키텍처" href="/ko/architecture">
    surface-first architecture, code reality, truth boundary를 설명합니다.
  </Card>
  <Card title="에이전트 / 채팅 / 워크 / 옵저브" href="/ko/agent">
    top-level product surface와 서로의 관계를 설명합니다.
  </Card>
  <Card title="개발 가이드" href="/ko/development">
    로컬 작업 루프와 검증 명령을 설명합니다.
  </Card>
</CardGroup>
