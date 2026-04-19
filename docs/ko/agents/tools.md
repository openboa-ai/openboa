---
title: "에이전트 도구"
summary: "Agent tool의 stable contract, ownership model, permission policy semantics를 설명합니다."
---
# 에이전트 도구


`ToolDefinition`은 Agent tool의 stable callable contract입니다.

현재 runtime은 tool을 prompt 속 suggestion이 아니라 first-class runtime object로 다룹니다.

## tool이 아닌 것

모든 capability가 tool family여야 하는 것은 아닙니다.

대표적으로:

- `proactive`
  - 주로 loop directive와 wake queue에 속함
- `learning`
  - 주로 loop directive와 learn store에 속함

tool은 이 loop를 지원할 뿐, 그 자체를 정의하지는 않습니다.

이 구분이 중요한 이유는, runtime이 ad hoc tool name의 모음으로 무너지는 것을 막기 위해서입니다.

## 현재 shape

tool definition은 보통 다음을 가집니다.

- `name`
- `description`
- `inputSchema`
- `outputSchema`
- `ownership`
- `permissionPolicy`
- `effects`
- `readOnly`
- `destructive`
- `interruptBehavior`

## ownership

tool surface에서는 단순히 “무슨 일을 한다”보다, “누가 그 side effect를 소유하느냐”가 중요합니다.

그래서 runtime은:

- managed tool
- sandbox-backed tool
- custom tool

같은 ownership 차이를 드러내야 합니다.

## permission policy

permission policy는 metadata가 아니라 runtime contract입니다.

현재 중요한 posture는:

- read-first surface를 먼저 쓰도록 유도
- high-risk mutation은 confirmation 또는 evaluator gate 뒤로 미룸
- shared substrate mutation은 explicit promotion path만 허용

즉 permission은 단순 deny/allow가 아니라 execution posture를 shape하는 요소입니다.

## managed navigation / recall tool

현재 Agent는 tool을 통해:

- session navigation
- cross-session snapshot / event reread
- retrieval search
- memory read / write / promote
- outcome read / define / evaluate
- shell describe / exec / history / wait

등을 다룹니다.

중요한 원칙은:

- retrieval candidate는 hint
- session truth나 runtime artifact reread가 verification

라는 점입니다.

## learning 관련 tool surface

learning capture 자체는 harness가 담당합니다.

하지만 inspection과 promotion은 tool surface로 올라옵니다.

즉:

- capture
  - harness
- inspect / search / promote
  - tools

입니다.

## 이 페이지가 다루지 않는 것

이 페이지는 다음을 전부 다시 설명하지 않습니다.

- session lifecycle
- sandbox execution boundary
- context assembly
- bootstrap file 의미

그건 각각 별도 페이지가 다룹니다.

## 관련 문서

- [에이전트 런타임](../agent-runtime.md)
- [에이전트 하네스](./harness.md)
- [에이전트 샌드박스](./sandbox.md)
- [에이전트 컨텍스트](./context.md)
- [에이전트 메모리](./memory.md)
