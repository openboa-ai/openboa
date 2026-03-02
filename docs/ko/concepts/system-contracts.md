---
title: "System Contracts"
summary: "Business(지속성) 축과 Agent(자율성) 축에서 철학을 스펙으로 내린 계약"
read_when:
  - 런타임 프리미티브를 설계할 때 doctrinal alignment가 필요할 때
  - 아키텍처 의사결정의 계약 경계를 명시해야 할 때
---

이 페이지는 BOA-0 철학을 강제 가능한 시스템 계약으로 변환합니다.

## A) Business Axis (Durability)

### Identity Contract
시스템의 기준 주체는 개인 계정이 아니라 Business입니다.

- 위반: 비즈니스 핵심 권한이 단일 사용자 정체성에 종속됨
- 기대 동작: 인력/도구 변경 후에도 Business 정체성이 유지됨

### Continuity Contract
목표, 컨텍스트, 결정 이력은 Business 단위로 축적·이전됩니다.

- 위반: 작업자 교체 시 핵심 운영 컨텍스트가 초기화됨
- 기대 동작: 후임 작업자가 필요한 비즈니스 컨텍스트를 승계함

### Governance Contract
통제 경계는 Business 레벨에 존재하고 확장 가능해야 합니다.

- 위반: 거버넌스가 사람 의존적인 임시 운영에 머묾
- 기대 동작: Business 정체성 재정의 없이 경계를 진화시킬 수 있음

## B) Agent Axis (Autonomy)

### Autonomy Contract
에이전트는 할당된 역할 범위 안에서 자율 실행합니다.

- 위반: 모든 작업이 인간의 직접 마이크로관리 필요
- 기대 동작: 지속 프롬프트 없이도 범위 내 작업을 전진시킴

### Delegation Contract
위임은 허용되되 책임 추적 가능성은 유지되어야 합니다.

- 위반: 위임된 결과의 책임 주체를 특정할 수 없음
- 기대 동작: 실행 경로를 결정 수준에서 리뷰 가능함

### Process Contract
자율 실행은 공유 운영 프로세스와 호환되어야 합니다.

- 위반: 각 에이전트가 서로 호환되지 않는 루프/핸드오프를 사용함
- 기대 동작: 공통 프로세스 백본 위에서 자율성이 표현됨

## Decision Rule

구현 트레이드오프가 생기면:

1. Business 지속성 계약을 먼저 보존
2. 프로세스 책임성을 다음으로 보존
3. 그 경계 안에서 Agent 자율성을 최대화
4. 두 축을 깨는 지름길은 거부
