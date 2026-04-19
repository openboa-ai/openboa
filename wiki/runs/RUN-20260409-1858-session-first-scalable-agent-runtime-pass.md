# RUN-20260409-1858-session-first-scalable-agent-runtime-pass

- `PR`: `PR-scalable-agent-runtime`
- `Worker`: `auto-project`
- `Status`: `kept`

## Goal

Replace the public activation-centric Agent runtime with a session-first scalable runtime centered on `Session`, `Environment`, `ResourceAttachment`, `SessionEvent`, `wake(sessionId)`, `Harness`, `Sandbox`, and `ToolDefinition`, while keeping the whole implementation inside `src/agents/`.

## Changes

- Added canonical public runtime types under [src/agents/schema/runtime.ts](../../src/agents/schema/runtime.ts):
  - `AgentDefinition`
  - `Environment`
  - `Session`
  - `SessionEvent`
  - `ResourceAttachment`
  - `Sandbox`
  - `Harness`
  - `ToolDefinition`
- Added [src/agents/environment/environment-store.ts](../../src/agents/environment/environment-store.ts) and seeded a reusable local default environment during setup.
- Added [src/agents/agent-definition.ts](../../src/agents/agent-definition.ts) so provider/model/runner remain swappable brain details behind a durable agent definition shape.
- Rebuilt [src/agents/sessions/session-store.ts](../../src/agents/sessions/session-store.ts) into a real session state machine store with:
  - `session.json`
  - `events.jsonl`
  - session-local `runtime/` files
  - legacy migration from flat transcript and old per-agent runtime files
- Rebuilt [src/agents/memory/runtime-memory-store.ts](../../src/agents/memory/runtime-memory-store.ts) so runtime continuity is isolated per session instead of per agent.
- Rebuilt [src/agents/memory/learnings-store.ts](../../src/agents/memory/learnings-store.ts) so agent-level learnings survive across sessions and continue to promote into workspace `MEMORY.md`.
- Added [src/agents/runtime/harness.ts](../../src/agents/runtime/harness.ts) as the new bounded session runner:
  - loads session + pending events
  - loads environment + resources
  - builds context
  - runs the provider brain
  - appends `agent.*` and `session.*` events
- Added [src/agents/runtime/orchestration.ts](../../src/agents/runtime/orchestration.ts) with the public `wake(sessionId)` seam and an agent-level orchestrator loop.
- Added [src/agents/runtime/session-wake-queue.ts](../../src/agents/runtime/session-wake-queue.ts) as a private internal revisit queue keyed by session.
- Added [src/agents/runtime/loop-directive.ts](../../src/agents/runtime/loop-directive.ts) to parse session-harness loop outcomes, queued wakes, learnings, and custom-tool pause requests.
- Added [src/agents/sandbox/sandbox.ts](../../src/agents/sandbox/sandbox.ts) with a local-only `Sandbox` implementation using provision/execute semantics.
- Expanded [src/agents/tools/runtime-tool.ts](../../src/agents/tools/runtime-tool.ts) so tools now carry explicit ownership and Anthropic-style permission policies.
- Replaced the public CLI in [src/index.ts](../../src/index.ts):
  - `openboa agent session create`
  - `openboa agent session send`
  - `openboa agent session status`
  - `openboa agent session events`
  - `openboa agent wake`
  - `openboa agent orchestrator`
- Removed legacy public Agent commands:
  - `agent activate`
  - `agent scheduler`
  - `agent scheduler-status`
  - `agent daemon`
  - `agent heartbeat`
  - `agent chat`
- Updated canonical docs:
  - [docs/quickstart.md](../../docs/quickstart.md)
  - [docs/architecture.md](../../docs/architecture.md)

## Verification

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test -- test/agent-runtime.test.ts test/runtime-scheduler.test.ts test/activation-queue.test.ts test/index.test.ts test/runtime-tool-definition.test.ts`
- `pnpm check:docs`
- `git diff --check -- src test docs wiki`

## Result

The public Agent runtime now reads like a scalable session/resource/event system rather than an activation-driven prompt loop. `Session` is the primary runtime object, `wake(sessionId)` is the orchestration seam, environments and resource attachments are first-class, and provider backends stay behind the harness seam as swappable brains.

## Next gap

The next frontier should not revisit the session-first contract itself. The meaningful gaps now sit above it:

- capability-aware session ingress from Chat and later Work
- richer resource attachment beyond the local-only environment skeleton
- broader session event sources and custom-tool/result flows
