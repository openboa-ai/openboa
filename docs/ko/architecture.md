# 아키텍처

## 문서 목적

이 문서는 의도적으로 러프(rough)하게 유지합니다.
목표는 구현 고정이 아니라, 고려 항목/근거/후속 상세화 포인트를 정리하는 것입니다.

---

## 참조 기반

### 1) 이벤트 기반 아키텍처
- Martin Fowler: [https://martinfowler.com/articles/201701-event-driven.html](https://martinfowler.com/articles/201701-event-driven.html)
- Microsoft: [https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/event-driven](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/event-driven)

#### 왜 필요한가 (이벤트 기반)
- 비동기/장기 실행 작업에 적합

#### openboa 적용 방향 (이벤트 기반)
- 라이프사이클 이벤트 중심 런타임

### 2) 워크플로우 엔진 원칙
- Temporal: [https://temporal.io/blog/workflow-engine-principles](https://temporal.io/blog/workflow-engine-principles)

#### 왜 필요한가 (워크플로우 엔진)
- 실패/재시작 상황 복구 필요

#### openboa 적용 방향 (워크플로우 엔진)
- run을 내구성 워크플로우로 취급

### 3) RBAC 표준 모델
- NIST RBAC: [https://www.nist.gov/publications/nist-model-role-based-access-control-towards-unified-standard](https://www.nist.gov/publications/nist-model-role-based-access-control-towards-unified-standard)

#### 왜 필요한가 (RBAC)
- 권한 경계/거버넌스 필요

#### openboa 적용 방향 (RBAC)
- 역할 기반 권한 + RoleBinding

### 4) Policy as Code
- OPA: [https://www.openpolicyagent.org/docs/latest/](https://www.openpolicyagent.org/docs/latest/)

#### 왜 필요한가 (정책 코드화)
- 정책 변경을 런타임 코드와 분리

#### openboa 적용 방향 (정책 코드화)
- 정책 결정/집행 분리

### 5) 툴링 프로토콜 기반
- MCP: [https://modelcontextprotocol.io/introduction](https://modelcontextprotocol.io/introduction)

#### 왜 필요한가 (MCP)
- 툴 인터페이스 표준화

#### openboa 적용 방향 (MCP)
- 가능한 범위에서 MCP 정렬

### 6) 에이전트 간 상호운용 기반
- A2A: [https://github.com/a2aproject/A2A](https://github.com/a2aproject/A2A)

#### 왜 필요한가 (A2A)
- 멀티에이전트 통신 계약 필요

#### openboa 적용 방향 (A2A)
- 내부 메시징을 A2A 개념과 정렬

---

## 아키텍처 고려 체크리스트

## 1) Control Plane `[ref: event-driven]`
## 2) Event-Driven Runtime `[ref: event-driven]`
## 3) Run/Session Lifecycle `[ref: workflow-engine]`
## 4) Queue & Concurrency `[ref: workflow-engine, event-driven]`
## 5) Runtime vs Business Boundary `[ref: architecture-principle]`
## 6) Policy & Access `[ref: nist-rbac, opa]`
## 7) Organization Context `[ref: nist-rbac, opa]`
## 8) Messages `[ref: event-driven]`
## 9) Tools `[ref: mcp]`
## 10) Memory `[ref: architecture-principle]`
## 11) Skills `[ref: architecture-principle]`
## 12) A2A Communication `[ref: a2a]`
## 13) Observability & Audit `[ref: event-driven, workflow-engine]`
## 14) Reliability `[ref: workflow-engine]`
