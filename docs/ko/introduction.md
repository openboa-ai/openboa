---
title: "소개"
summary: "openboa가 무엇인지, 왜 필요한지, 그리고 어디서 시작하면 되는지"
read_when:
  - openboa를 처음 접할 때
  - 개념에서 기여까지 가장 짧은 경로가 필요할 때
---

**openboa**는 프로젝트이자 브랜드 이름입니다.  
핵심 개념은 **Business of Agents (BOA)**이며, 이를 *Business as Agent* 운영 모델로 구현합니다.

openboa는 거버넌스를 우선하는 런타임입니다. **Business**를 지속되는 운영 주체로 두고, Agent는 진화 가능한 실행 인력으로 다룹니다.

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
- **자율성 + 프로세스**를 함께 요구하는 실행 프레임워크
- 승인, 감사 가능성, 통제된 위임을 위한 거버넌스 기준선
- 구현 확장 전에 불변 조건을 먼저 정의하는 docs-first 접근

## 현재 단계에서 아닌 것

- 아직 프로덕션 규모 오케스트레이션 플랫폼은 아님
- 범용 챗봇 프레임워크가 목표는 아님
- 운영자 없이 완전 무인으로 돌아가는 시스템을 지향하지 않음
- 기능 개수 중심의 단기 확장을 우선하지 않음

## 권장 읽기 순서

1. **핵심 원칙 (Core Doctrine)** — 전략적 불변 조건과 의사결정 기준  
   [/ko/concepts/core-doctrine](/ko/concepts/core-doctrine)
2. **시스템 계약 (System Contracts)** — 철학을 집행 가능한 계약으로 변환  
   [/ko/concepts/system-contracts](/ko/concepts/system-contracts)
3. **Business as Agent** — 공통 모델과 표준 용어  
   [/ko/concepts/business-as-agent](/ko/concepts/business-as-agent)
4. **명시적 비목표 (Sharp Non-goals)** — 드리프트를 막기 위한 제외 항목  
   [/ko/help/non-goals](/ko/help/non-goals)
5. **개발 가이드 / 빠른 시작** — 로컬 작업 흐름과 기여 루프  
   [/ko/development](/ko/development), [/ko/quickstart](/ko/quickstart)

## 역할별 시작점

- **Operator / Founder**: Core Doctrine → Non-goals → Business as Agent
- **Architect / Builder**: System Contracts → Development → Quickstart
- **Contributor / Reviewer**: Core Doctrine → Development → docs/help pages

## 기여 전 체크

아래를 모두 만족하면 제안이 준비된 상태입니다.
- 실행 레버리지를 개선하거나 보호하는가
- Business 단위의 지속성을 해치지 않는가
- 자율성과 책임 프로세스가 함께 유지되는가
- 핵심 원칙에서 단기적인 이탈을 만들지 않는가
