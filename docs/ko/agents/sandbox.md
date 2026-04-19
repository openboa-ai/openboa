---
title: "에이전트 샌드박스"
summary: "session-attached resource와 tool work를 위한 execution boundary인 Sandbox를 설명합니다."
---
# 에이전트 샌드박스


샌드박스는 session-attached resource와 tool work를 위한 execution boundary입니다.

이 페이지가 답하는 질문은 다음과 같습니다.

- execution hand는 실제로 무엇을 할 수 있는가
- mount boundary가 file / shell work에 어떤 제약을 거는가
- shell surface는 왜 이런 식으로 bounded되어 있는가
- sandbox와 tool은 무엇이 다른가

그 public contract는 intentionally 작습니다.

```ts
provision(resources)
describe()
execute(name, input)
```

## 왜 이 추상화가 중요한가

sandbox는 교체 가능해야 합니다.

현재는 local-only지만, 이후에는:

- remote container
- cloud worker
- 다른 isolated executor

로 바뀔 수 있습니다.

나머지 runtime이 `provision`과 `execute`만 의존하면, executor는 바뀌어도 contract는 유지됩니다.

## 현재 구현

현재 sandbox는:

- local
- workspace-backed
- resource-aware
- provisioned mount 기준으로 path-scoped

입니다.

즉 fake echo layer가 아니라 bounded filesystem hand에 가깝습니다.

## 현재 named action

대표 action은 다음과 같습니다.

- `list_dir`
- `read_text`
- `write_text`
- `append_text`
- `replace_text`
- `mkdir`
- `stat`
- `find_entries`
- `glob_entries`
- `grep_text`
- `run_command`
- `run_shell`
- `inspect_persistent_shell`
- `open_persistent_shell`
- `exec_persistent_shell`
- `close_persistent_shell`
- `inspect`

## Mount boundary

현재 action은 provisioned mount 안에서만 동작합니다.

예:

- `/workspace`
- `/workspace/agent`
- `/runtime`
- `/memory/learnings`
- `/vaults/<name>`

mounted root 밖은 deny됩니다.

read-only mount는 읽을 수는 있지만 쓸 수는 없습니다.
vault mount는 ordinary content read와 grep-style search가 더 강하게 막힙니다.

## Runtime catalog

`/workspace/.openboa-runtime/` 아래에는 현재 session을 file로 다시 읽을 수 있는 artifact가 materialize됩니다.

예:

- session/runtime posture
- managed tool contract
- permission posture
- environment / vault posture
- outcome / evaluation
- event feed / wake traces
- shell state / history / last output

즉 Agent는 prompt만이 아니라 filesystem에서도 자기 상태를 inspect할 수 있습니다.

## Command hand와 persistent shell

현재 shell surface는 세 가지 층으로 나뉩니다.

- `run_command`
  - bounded non-shell command hand
- `run_shell`
  - one-shot writable shell hand
- persistent shell actions
  - session-scoped multi-step shell continuity

아직 full PTY terminal은 아니지만, current runtime frontier에서는 충분히 concrete한 shell surface를 제공합니다.

## tools와의 관계

중요한 mental model은 다음과 같습니다.

- tool
  - intent와 policy를 설명
- sandbox
  - current environment와 mount 안에서 bounded execution을 수행

이 둘을 섞으면 execution policy와 execution mechanism을 동시에 설명해야 해서 구조가 흐려집니다.

## current non-goal

현재 sandbox는 아직 다음을 목표로 하지 않습니다.

- full PTY terminal emulator
- cloud container runtime
- full network policy engine
- multi-tenant production isolation layer

지금 목표는 explicit한 local contract를 잘 세우는 것입니다.

## 관련 문서

- [에이전트 런타임](../agent-runtime.md)
- [에이전트 환경](./environments.md)
- [에이전트 리소스](./resources.md)
- [에이전트 도구](./tools.md)
