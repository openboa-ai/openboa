---
title: "에이전트 리소스"
summary: "session에 attach되는 durable input과 mount semantics, 그리고 session-local state와 agent-level memory의 경계를 설명합니다."
---

`ResourceAttachment`는 session이 durable input을 보는 방식입니다.

이 페이지가 답하는 질문은 다음과 같습니다.

- 무엇을 prompt text가 아니라 mounted resource로 다뤄야 하는가
- session hand와 shared substrate는 어떻게 다른가
- writeback과 promotion은 어떻게 이뤄지는가

## 현재 resource kind

현재 public kind는 다음과 같습니다.

- `session_workspace`
- `agent_workspace_substrate`
- `local_file`
- `learnings_memory_store`
- `session_runtime_memory`
- `vault`

## 기본 resource

새 session은 보통 다음 resource를 자동으로 받습니다.

- session execution workspace
- shared agent workspace substrate
- agent learnings store
- session runtime directory
- discovered vault mount

즉 harness는 기본적으로:

- shared substrate
- isolated execution hand
- reusable learning surface
- isolated session continuity

를 동시에 갖게 됩니다.

## 왜 learning이 resource인가

learning store는 hidden database detail이 아니라 Agent의 durable operating surface이기 때문입니다.

즉:

- 여러 session에서 재사용되고
- inspectable하며
- session-local scratch와 분리돼야 합니다

## 왜 이 split이 중요한가

가장 중요한 구분은 세 가지입니다.

- session-local
  - current runtime scratch
  - session-specific checkpoint와 working buffer
  - writable execution workspace
- agent-level
  - reusable learning
  - durable workspace substrate
  - stable steering file
- vault-protected
  - read-only secret-bearing mount

## Access model

resource는 보통 다음 정보를 가집니다.

- `sourceRef`
- `mountPath`
- `access`
- optional `metadata.prompt`

즉 contract의 핵심은:

- 그것이 무엇인지
- 어디에 mount되는지
- 얼마나 writable한지

입니다.

## Writeback path

shared substrate는 normal sandbox hand에서 read-only입니다.

그래서 writeback은 managed tool을 통해 explicit하게 이뤄집니다.

대표적으로:

- `resources_stage_from_substrate`
- `resources_compare_with_substrate`
- `resources_promote_to_substrate`

즉 흐름은:

1. shared substrate를 `/workspace`로 stage
2. current substrate와 compare
3. `/workspace`에서 mutate
4. outcome / evaluator posture를 본다
5. promote

## 설계 원칙

다음 순서로 질문하면 됩니다.

1. 이것이 session을 넘어 durable해야 하는가
2. 이것이 session마다 isolated해야 하는가
3. harness가 이것을 mounted input으로 봐야 하는가

`durable + isolated + execution에 직접 유용함`이면 resource가 될 가능성이 큽니다.

## 관련 문서

- [에이전트 런타임](../agent-runtime.md)
- [에이전트 워크스페이스](./workspace.md)
- [에이전트 메모리](./memory.md)
- [에이전트 부트스트랩](./bootstrap.md)
- [에이전트 샌드박스](./sandbox.md)
