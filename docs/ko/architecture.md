---
title: "아키텍처"
summary: "openboa의 현재 코드 현실과 레이어 경계: Agent, Chat, Work, Observe, 그리고 shell adapter."
read_when:
  - 현재 코드 구조를 product surface 기준으로 이해하고 싶을 때
  - shell과 domain truth의 경계를 빠르게 확인하고 싶을 때
---

openboa 아키텍처는 먼저 product surface 기준으로 읽어야 합니다.
폴더 구조는 그 다음입니다.

안정적인 개념 스택은 다음과 같습니다.

```text
Agent -> Chat -> Work -> Observe
                 \
                  -> shell adapter
```

shell은 중요하지만 truth owner는 아닙니다.
위 레이어가 가진 truth와 projection을 렌더하는 downstream adapter로 읽어야 합니다.

## 레이어 스택

### `Agent`

도메인 의미를 직접 갖지 않는 worker runtime입니다.

소유하는 것:

- session
- harness execution
- sandbox와 tools
- worker-local runtime memory
- private workspace와 learnings

직접 소유하지 않는 것:

- chat transcript truth
- business commitment
- operator-facing evidence meaning

### `Chat`

shared office이자 durable coordination fabric입니다.

소유하는 것:

- room, DM, group DM, thread
- participant binding과 access rule
- append-only transcript truth
- unread, mention, inbox, transcript projection

직접 소유하지 않는 것:

- generic agent execution internals
- work commitment semantics
- observe evidence semantics

### `Work`

chat 위의 business execution layer입니다.

소유하는 것:

- explicit business commitment
- owner와 participant assignment
- blocker, approval, result, execution state semantics
- chat lineage를 durable business execution object로 올리는 publication

### `Observe`

work와 execution 위의 governance and evidence layer입니다.

소유하는 것:

- execution ref와 session linkage
- operator-facing evidence stitching
- blocked, degraded, risk visibility
- audit-friendly execution explanation

## 현재 코드 현실

현재 저장소는 네 레이어가 모두 같은 성숙도로 구현되어 있지는 않습니다.

지금 실제 성숙도는 다음과 같습니다.

1. `Agent`
   - `src/agents/` 아래에 session-first runtime이 실질적으로 구현됨
2. `Chat`
   - `src/chat/` 아래에 shared backend truth와 projection이 실질적으로 구현됨
3. `Work`
   - mostly `shared model + shell scaffolding`
4. `Observe`
   - mostly `shared model + shell scaffolding`

이 차이를 솔직하게 보는 것이 중요합니다.
코드 성숙도는 uneven해도, 아키텍처 경계는 long-term 기준으로 유지해야 합니다.

## 현재 안정적인 코드 레이아웃

```text
src/agents/
src/chat/core/
src/chat/policy/
src/chat/projections/
src/shared/
src/shell/
```

반대로 현재 저장소가 stable architecture root로 취급하지 않는 것은 다음입니다.

```text
src/application/
src/transports/
src/control-plane/
```

## 저장소 매핑

### `src/agents/`

`Agent` 레이어에 해당합니다.

핵심 runtime object:

- `AgentDefinition`
- `Environment`
- `Session`
- `SessionEvent`
- `wake(sessionId)`
- `Harness`
- `Sandbox`
- `ToolDefinition`

### `src/chat/core/`

chat truth를 소유합니다.

- room
- DM / group DM
- thread scope
- membership
- grant
- message
- reaction
- cursor
- append-only ordering

### `src/chat/policy/`

chat-local command와 access behavior를 담당합니다.

- join / leave
- room command
- role evaluation
- grant / membership flow
- room setting / archive behavior

### `src/chat/projections/`

chat truth 위의 rebuildable read model을 담당합니다.

- unread
- mention
- latest activity
- transcript shaping
- sidebar discovery
- DM grouping

### `src/shared/`

cross-cutting protocol type과 shared company model을 둡니다.

현재 `Work`와 `Observe`의 초기 shape도 여기에 있습니다.
예를 들면:

- `TopLevelSurfaceState = "chat" | "work" | "observe"`
- `CompanyWorkSurface`
- `CompanyObserveSurface`
- execution ref, work card, observe evidence, linked chat context

### `src/shell/`

browser / desktop adapter가 product surface를 렌더합니다.

현재 shell에는 이미 다음이 있습니다.

- chat surface rendering
- work surface rendering
- observe surface rendering

하지만 shell은 business truth owner가 아니라 adapter layer로 읽어야 합니다.

## 의존 방향

의도된 dependency direction은 다음과 같습니다.

```text
entrypoints -> agents/runtime -> agents/sessions + agents/environment + agents/tools + agents/sandbox + shared
entrypoints -> chat/policy -> chat/core -> shared
entrypoints -> chat/projections -> chat/core + shared
shell adapters -> chat/projections + chat/policy + shared
shell adapters -> work/observe projections encoded in shared model + shell controllers
agents -> shared
```

규칙:

1. shell adapter가 parallel truth를 만들면 안 됩니다
2. `chat/core`는 UI-specific behavior 아래로 내려가면 안 됩니다
3. `chat/projections`가 rebuildable view를 담당합니다
4. agent-private journal이 자동으로 shared truth가 되면 안 됩니다
5. `Work`, `Observe`를 shell-only UI concept로 다시 축소하면 안 됩니다
6. provider backend는 harness seam 뒤에 남아야 합니다

## Truth 배치

### Agent-private truth

private execution evidence는 여기 있습니다.

```text
.openboa/agents/<agent-id>/workspace/
.openboa/agents/<agent-id>/sessions/
.openboa/agents/<agent-id>/learn/
```

여기에는 다음이 포함됩니다.

- workspace substrate file
- session event log
- runtime checkpoint / working buffer
- reusable per-agent learnings

### Shared company truth

shared company truth는 append-only ledger에 있습니다.

```text
.openboa/runtime/company-ledger.jsonl
```

현재 이 ledger는 shared chat truth와 early work-shaped shared record의 주요 durable home입니다.

### Work / Observe의 현재 상태

`Work`와 `Observe`는 이미 아키텍처 일부이지만, durable backend contract는 아직 `Agent`, `Chat`보다 덜 굳었습니다.

지금은 주로 다음 형태로 나타납니다.

- `src/shared/company-model.ts` 안의 shared company model type
- `chat`, `work`, `observe` top-level shell tab
- `src/shell/web/` 안의 demo / frame-state scaffolding

그래서 문서에서는 두 레이어를 first-class product surface로 다루되, backend domain은 아직 hardening 중이라고 명시해야 합니다.

## Shell rule

shell은 domain truth의 downstream consumer입니다.

- `Agent`가 worker execution을 소유합니다
- `Chat`이 coordination truth를 소유합니다
- `Work`가 business execution meaning을 소유합니다
- `Observe`가 evidence / governance meaning을 소유합니다
- shell은 projection을 렌더하고 command를 내보냅니다

어떤 surface가 shell이 지금 그려주기 때문에만 존재한다면, 그 surface는 아직 충분히 harden되지 않은 것입니다.

## 성숙도 요약

현재 성숙도는 다음과 같습니다.

- `Agent`: real runtime
- `Chat`: real shared backend truth
- `Work`: early shared model plus shell scaffolding
- `Observe`: early shared model plus shell scaffolding

이 상태 자체는 괜찮습니다.
문제는 temporary shell scaffolding가 long-term layer model을 다시 정의하게 두는 것입니다.

## 관련 문서

- [에이전트](./agent.md)
- [채팅](./chat.md)
- [워크](./work.md)
- [옵저브](./observe.md)
- [개발 가이드](./development.md)
