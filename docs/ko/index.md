---
title: "openboa 문서"
summary: "Business of Agents (BOA)를 위한 거버넌스 중심 런타임 문서"
---
# openboa 문서


openboa는 **Business of Agents (BOA)** 프로젝트입니다.
운영 모델은 *Business of Agents*이며, 자율성과 통제를 함께 유지하는 실행 시스템을 지향합니다.

문서는 먼저 제품 표면을 분리해서 봅니다.

- `에이전트`
- `채팅`
- `워크`
- `옵저브`

그리고 이를 보조하는 문서가 있습니다.

- `개요`
- `빌드`
- `도움말`: FAQ와 문서 문제 해결

## 제품 표면

<CardGroup cols={2}>
  <Card title="에이전트" href="/ko/agents">
    에이전트 허브에서 의미, 기능, 런타임, 워크스페이스, 메모리, 컨텍스트를 순서대로 읽습니다.
  </Card>
  <Card title="채팅" href="/ko/chat">
    현재 wedge인 shared chat fabric과 제품 의미를 먼저 이해합니다.
  </Card>
  <Card title="워크" href="/ko/work">
    대화를 business execution으로 올리는 레이어를 확인합니다.
  </Card>
  <Card title="옵저브" href="/ko/observe">
    실행을 visible, accountable, explainable하게 만드는 evidence surface를 봅니다.
  </Card>
</CardGroup>

## 보조 문서

<CardGroup cols={3}>
  <Card title="개요" href="/ko/introduction">
    프로젝트 방향, doctrine, 현재 구조를 빠르게 훑습니다.
  </Card>
  <Card title="빌드" href="/ko/development">
    로컬 검증, 개발 흐름, 기여 기준을 확인합니다.
  </Card>
  <Card title="도움말" href="/ko/help/faq">
    자주 묻는 질문과 문서 문제 해결 경로를 확인합니다.
  </Card>
</CardGroup>

## 추천 읽기 순서

<Steps>
  <Step title="처음 보는 경우">
    [소개](./introduction.md) -> [Business of Agents](./concepts/business-of-agents.md) -> [아키텍처](./architecture.md)
  </Step>
  <Step title="제품 표면을 파악하려는 경우">
    [에이전트 허브](./agents/index.md) -> [채팅](./chat.md) -> [워크](./work.md) -> [옵저브](./observe.md)
  </Step>
  <Step title="기여 전에 기준을 맞추는 경우">
    [핵심 원칙](./concepts/core-doctrine.md) -> [시스템 계약](./concepts/system-contracts.md) -> [문서 트러블슈팅](./help/troubleshooting-docs.md)
  </Step>
</Steps>

## 구조 안내

<Tabs>
  <Tab title="개요">
    - [문서 홈](./index.md)
    - [소개](./introduction.md)
    - [감사의 글](./acknowledgements.md)
    - [아키텍처](./architecture.md)
    - [Business of Agents](./concepts/business-of-agents.md)
    - [핵심 원칙](./concepts/core-doctrine.md)
    - [시스템 계약](./concepts/system-contracts.md)
    - [명시적 비목표](./help/non-goals.md)
    - [네트워크](./network.md)
  </Tab>
  <Tab title="에이전트">
    - [에이전트 허브](./agents/index.md)
    - [에이전트](./agent.md)
    - [에이전트 기능](./agents/capabilities.md)
    - [에이전트 런타임](./agent-runtime.md)
    - [에이전트 워크스페이스](./agents/workspace.md)
    - [에이전트 메모리](./agents/memory.md)
    - [에이전트 컨텍스트](./agents/context.md)
    - [에이전트 부트스트랩](./agents/bootstrap.md)
    - [에이전트 아키텍처](./agents/architecture.md)
    - [에이전트 세션](./agents/sessions.md)
    - [에이전트 환경](./agents/environments.md)
    - [에이전트 리소스](./agents/resources.md)
    - [에이전트 하네스](./agents/harness.md)
    - [에이전트 샌드박스](./agents/sandbox.md)
    - [에이전트 도구](./agents/tools.md)
  </Tab>
  <Tab title="채팅">
    - [채팅](./chat.md)
  </Tab>
  <Tab title="워크">
    - [워크](./work.md)
  </Tab>
  <Tab title="옵저브">
    - [옵저브](./observe.md)
  </Tab>
  <Tab title="빌드">
    - [빠른 시작](./quickstart.md)
    - [개발 가이드](./development.md)
    - [기여 가이드](./contribution-guide.md)
    - [Color Foundation](./foundation/colors.md)
  </Tab>
  <Tab title="도움말">
    - [FAQ](./help/faq.md)
    - [문서 트러블슈팅](./help/troubleshooting-docs.md)
  </Tab>
</Tabs>
