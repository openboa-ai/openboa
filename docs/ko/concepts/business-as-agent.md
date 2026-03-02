---
title: "Business as Agent"
summary: "openboa 전반에서 사용하는 BOA 핵심 정의와 런타임 구성 블록"
read_when:
  - 기능 설계 전에 기본 개념이 필요할 때
  - 운영자/에이전트/기여자 간 용어를 정렬하고 싶을 때
---

Business as Agent(BOA)는 비즈니스를 지속 가능한 단위로, 에이전트를 진화 가능한 워크포스로 다룹니다.
핵심 약속은 연속성입니다. 작업자, 도구, 워크플로우가 바뀌어도 비즈니스 정체성과 거버넌스는 유지되어야 합니다.

<Tip>
BOA는 “에이전트를 무조건 더 늘리는 것”이 아닙니다. 지속 가능한 컨텍스트와 책임 추적이 가능한 통제된 위임입니다.
</Tip>

## 왜 BOA인가

- 에이전트 구성 변화 속에서도 연속성을 유지합니다.
- 정책 통제를 잃지 않고 역할 특화 위임을 수행합니다.
- 메모리와 감사 이력을 개인이 아닌 비즈니스 단위에 고정합니다.

## 핵심 구성 블록

<CardGroup cols={2}>
  <Card title="boa">
    비즈니스의 지속 런타임 정체성과 장기 상태.
  </Card>
  <Card title="Operator">
    목표, 정책, 승인 경계를 설정하는 인간 거버너.
  </Card>
  <Card title="Agent">
    범위화된 책임을 실행하고 시간에 따라 진화하는 작업 단위.
  </Card>
  <Card title="Skill">
    실행 품질을 표준화하는 재사용 운영 플레이북.
  </Card>
  <Card title="Protocol">
    할당/보고/승인/에스컬레이션을 위한 구조화된 상호작용 계약.
  </Card>
  <Card title="Governance Boundary">
    권한, 격리, 리스크 통제를 위한 강제 가능한 경계.
  </Card>
  <Card title="Audit Trail">
    책임성을 위한 검증 가능한 의사결정/행동 이력.
  </Card>
</CardGroup>

<Note>
이 페이지는 개념 기준선입니다. 구현 상세는 별도 가이드/스펙에서 확장됩니다.
</Note>
