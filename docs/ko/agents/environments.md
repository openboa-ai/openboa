---
title: "에이전트 환경"
summary: "session이 참조하는 reusable execution substrate로서의 Environment를 설명합니다."
---
# 에이전트 환경


`Environment`는 session이 참조하는 reusable execution substrate definition입니다.

이 페이지가 답하는 질문은 다음과 같습니다.

- environment는 무엇을 소유하는가
- 왜 session은 environment를 embed하지 않고 reference하는가
- execution substrate는 agent definition, session truth와 어떻게 다른가

## 왜 environment가 필요한가

environment는 다음 질문에 답합니다.

- 이 session은 어디서 실행되는가
- 어떤 sandbox posture가 적용되는가
- 기본적으로 어떤 workspace mount가 존재하는가

중요한 규칙은:

- session은 environment를 참조한다
- session이 environment definition 전체를 embed하지 않는다

그래서 많은 session이 하나의 environment definition을 재사용할 수 있습니다.

## 현재 shape

현재 environment contract는 대략 다음 필드를 포함합니다.

- `id`
- `name`
- `kind: "local"`
- `sandbox`
- `workspaceMountDefaults`
- `createdAt`
- `updatedAt`

## 현재 구현

현재 openboa는 `kind: "local"`만 제공합니다.

이건 의도적입니다.

지금 단계에서는 cloud container보다 public contract를 먼저 안정화하는 것이 중요합니다.

## 저장 위치

environment definition은 다음 경로에 저장됩니다.

```text
.openboa/environments/<environment-id>.json
```

기본 setup에서는 `local-default`를 seed합니다.

## Session과의 관계

session은 `environmentId`만 저장합니다.

런타임에서는:

1. session load
2. environment load
3. resource provisioning
4. harness run

순서로 동작합니다.

## 이 페이지가 다루지 않는 것

environment는 다음과 다릅니다.

- agent definition
- provider model choice
- full session snapshot

즉 이것은 execution substrate에 대한 문서입니다.

## 관련 문서

- [에이전트 런타임](../agent-runtime.md)
- [에이전트 세션](./sessions.md)
- [에이전트 샌드박스](./sandbox.md)
- [에이전트 리소스](./resources.md)
