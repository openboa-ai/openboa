---
title: "소개"
summary: "openboa가 무엇인지, 왜 필요한지, 그리고 어디서 시작하면 되는지"
read_when:
  - openboa를 처음 접할 때
  - 개념에서 기여까지 가장 짧은 경로가 필요할 때
---
# 소개


**openboa**는 프로젝트이자 브랜드 이름입니다.  
핵심 개념은 **Business of Agents (BOA)**이며, 이를 *Business of Agents* 운영 모델로 구현합니다.

openboa는 **Business**를 지속되는 운영 주체로 두고, Agent를 진화 가능한 실행 인력으로 다룹니다.

제품 스택은 다음과 같습니다.

- `Agent`: worker runtime
- `Chat`: shared coordination
- `Work`: business execution
- `Observe`: governance and evidence

한 줄 요약: **openboa는 아이디어를 책임 있는 위임과 함께 지속 실행으로 연결합니다.**

<Note>
openboa는 아직 초기 단계(설계 우선 단계)입니다. 프로덕션 규모 오케스트레이션보다 원칙 정합성과 시스템 계약 정리를 먼저 우선합니다.
</Note>

## 왜 지금 필요한가

AI는 콘텐츠 생성 비용을 크게 낮췄습니다.  
하지만 비즈니스 실행의 지속성까지 자동으로 해결해주지는 못했습니다.

실제 병목은 운영 레버리지에 있습니다.
- 계속된 프롬프팅이 없으면 실행이 멈춘다
- 사람/Agent/툴 사이에서 컨텍스트가 쉽게 끊긴다
- 위임 속도는 빨라졌지만 책임 체계는 그만큼 따라오지 못한다

openboa는 이 문제를 시스템 문제로 다룹니다.

## openboa가 지향하는 것

- 인력/도구가 바뀌어도 유지되는 **Business 연속성** 런타임 모델
- `Agent / Chat / Work / Observe`로 이어지는 제품 스택
- **자율성 + 프로세스**를 함께 요구하는 실행 프레임워크
- 승인, 감사 가능성, 통제된 위임을 위한 거버넌스 기준선
- 구현 확장 전에 불변 조건을 먼저 정의하는 docs-first 접근

## 현재 단계에서 아닌 것

- 아직 프로덕션 규모 오케스트레이션 플랫폼은 아님
- 범용 챗봇 프레임워크가 목표는 아님
- 운영자 없이 완전 무인으로 돌아가는 시스템을 지향하지 않음
- 기능 개수 중심의 단기 확장을 우선하지 않음

## 제품 스택

### `Agent`

도메인 의미를 직접 갖지 않는 worker runtime입니다.

- session-first execution
- harness, tools, sandbox
- private workspace와 learnings

### `Chat`

shared office이자 현재 주 wedge입니다.

- channel, DM, group DM, thread
- durable transcript truth
- humans와 agents의 shared coordination fabric

### `Work`

chat 위의 business execution layer입니다.

- commitment
- ownership
- blocker, approval, result
- durable business execution state

### `Observe`

evidence와 governance layer입니다.

- linked execution evidence
- blocked / degraded visibility
- operator-facing explanation

## 현재 단계

네 surface가 모두 같은 성숙도를 가진 것은 아닙니다.

현재 코드 현실은 다음과 같습니다.

- `Agent`: real session-first runtime
- `Chat`: real shared backend truth와 projection
- `Work`: early shared model plus shell scaffolding
- `Observe`: early shared model plus shell scaffolding

현재 첫 shipping wedge는 여전히 다음입니다.

- **MVP-1: 믿을 수 있는 멀티에이전트 회사 채팅**

기여자 기준 기본 runtime surface는 아직 CLI-first입니다.
하지만 같은 shell에 대해 browser host와 첫 desktop packaging path도 이미 저장소에 들어와 있습니다.

## 권장 읽기 순서

1. **핵심 원칙 (Core Doctrine)** — 전략적 불변 조건과 의사결정 기준  
   [./concepts/core-doctrine.md](./concepts/core-doctrine.md)
2. **시스템 계약 (System Contracts)** — 철학을 집행 가능한 계약으로 변환  
   [./concepts/system-contracts.md](./concepts/system-contracts.md)
3. **Business of Agents** — 공통 모델과 표준 용어
   [./concepts/business-of-agents.md](./concepts/business-of-agents.md)
4. **명시적 비목표 (Sharp Non-goals)** — 드리프트를 막기 위한 제외 항목  
   [./help/non-goals.md](./help/non-goals.md)
5. **아키텍처** — 현재 레이어 모델과 코드 현실  
   [./architecture.md](./architecture.md)
6. **에이전트 / 채팅 / 워크 / 옵저브** — top-level product surface  
   [./agent.md](./agent.md), [./chat.md](./chat.md), [./work.md](./work.md), [./observe.md](./observe.md)
7. **개발 가이드 / 빠른 시작** — 로컬 작업 흐름과 기여 루프  
   [./development.md](./development.md), [./quickstart.md](./quickstart.md)

## 역할별 시작점

- **Operator / Founder**: Core Doctrine → Non-goals → Business of Agents
- **Architect / Builder**: System Contracts → 아키텍처 → 에이전트 → 채팅 → 개발 가이드
- **Contributor / Reviewer**: Core Doctrine → Development → docs/help pages

## 기여 전 체크

아래를 모두 만족하면 제안이 준비된 상태입니다.
- 실행 레버리지를 개선하거나 보호하는가
- Business 단위의 지속성을 해치지 않는가
- 자율성과 책임 프로세스가 함께 유지되는가
- 핵심 원칙에서 단기적인 이탈을 만들지 않는가
