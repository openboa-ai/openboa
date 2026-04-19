---
title: "에이전트 하네스"
summary: "한 session run을 위한 bounded brain loop인 Harness를 설명합니다."
---
# 에이전트 하네스


Harness는 한 session run을 위한 bounded execution loop입니다.

이 페이지가 답하는 질문은 다음과 같습니다.

- 한 번의 bounded run은 실제로 무엇을 하는가
- provider output은 어디서 durable runtime progress가 되는가
- proactive continuation과 learning capture는 왜 여기서 runtime behavior가 되는가
- 무엇이 harness 바깥에 남는가

## Harness가 하는 일

한 번의 bounded run에서 harness는 보통 다음을 수행합니다.

1. session load
2. pending event 읽기
3. environment와 attached resource load
4. session runtime memory load
5. context assembly
6. provider backend 호출
7. loop directive 해석
8. session event append
9. session state와 runtime memory 갱신

즉 harness는:

- orchestration
- provider runner
- sandbox / tool execution
- session storage

사이의 bounded loop입니다.

## Harness가 하지 않는 일

harness는 다음을 소유하지 않습니다.

- public scheduling API
- application-specific routing
- external publication semantics
- session 바깥의 broader truth
- reusable environment definition

즉 harness는 whole runtime이 아니라 one-wake bounded loop입니다.

## orchestration과의 관계

public orchestration seam은 단순히:

```ts
wake(sessionId)
```

입니다.

orchestration은:

- 지금 이 session을 돌릴지
- revisit를 queue에 둘지

를 결정합니다.

harness는:

- 이번 run이 무슨 의미인지
- 어떤 event를 append할지
- session이 sleep / requires_action / reschedule / done 중 어디로 가는지

를 결정합니다.

## proactive behavior가 여기서 현실이 된다

provider는 timer를 직접 스케줄하지 않습니다.

대신 loop directive 안에서 `queuedWakes`를 emit하고, harness가 그것을 durable revisit request로 해석합니다.

즉 proactive loop는:

1. provider가 `queuedWakes`를 제안
2. harness가 validate / resolve
3. wake scheduling을 durable하게 기록
4. orchestration이 나중에 due wake를 실행

입니다.

## provider와의 관계

Codex나 Claude 같은 provider backend는 swappable brain입니다.

즉:

- provider-specific runner는 implementation detail
- harness가 stable runtime contract
- session model은 brain이 바뀌어도 유지되어야 함

입니다.

## Loop directive

현재 harness는 provider 결과를 대략 다음 field로 해석합니다.

- plain-text response
- durable summary
- sleep or continue
- optional queued wakes
- optional learnings
- optional custom tool pause

이 중 특히 중요한 것은:

- `queuedWakes`
  - proactive continuation
- `learnings`
  - runtime improvement

입니다.

## Learning capture도 여기서 이뤄진다

learning loop는 다음과 같습니다.

1. provider가 `learnings` emit
2. harness가 normalize / dedupe
3. learn store에 기록
4. 선택된 learning은 `MEMORY.md` 등으로 promotion 가능

즉 learning은 prompt에만 남는 것이 아니라 harness에서 durable runtime state로 바뀝니다.

## 설계 원칙

만약 변경이:

- context assembly
- pending event 해석
- provider result를 durable runtime progress로 변환하는 문제

라면 harness에 속할 가능성이 큽니다.

반대로:

- public session API
- wake scheduling policy
- external routing / publication semantics

라면 harness 바깥일 가능성이 큽니다.

## 관련 문서

- [에이전트 런타임](../agent-runtime.md)
- [에이전트 세션](./sessions.md)
- [에이전트 샌드박스](./sandbox.md)
- [에이전트 도구](./tools.md)
