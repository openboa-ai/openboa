# RUN-20260419-1127-agent-runtime-resilience-pass

- `PR`: `PR-agent-runtime-resilience`
- `Worker`: `auto-project`
- `Status`: `kept`

## Goal

Promote Agent runtime resilience into an explicit contract that is visible in config, setup, scheduler behavior, operator status, and live verification, while shrinking default live verification from the full `100` scenario sweep to a curated `30/30` suite with explicit catalog-owned coverage.

## Changes

- Added explicit resilience config in [src/agents/agent-config.ts](../../src/agents/agent-config.ts):
  - named resilience profile
  - recoverable wake retry delay
  - wake-failure replay delay
  - pending-event backoff base/max
- Closed auth entry-surface naming drift so `auth login` accepts both the auth target and the canonical runtime provider id:
  - [src/agents/auth/provider-auth-plan.ts](../../src/agents/auth/provider-auth-plan.ts)
  - [src/index.ts](../../src/index.ts)
  - [docs/quickstart.md](../../docs/quickstart.md)
  - [test/provider-auth-plan.test.ts](../../test/provider-auth-plan.test.ts)
- Seeded resilience defaults during setup in [src/agents/setup.ts](../../src/agents/setup.ts).
- Exposed resilience posture through runtime setup artifacts and bounded wake handling:
  - [src/agents/runtime/harness.ts](../../src/agents/runtime/harness.ts)
  - [src/agents/runtime/orchestration.ts](../../src/agents/runtime/orchestration.ts)
  - [src/agents/runtime/wake-session.ts](../../src/agents/runtime/wake-session.ts)
- Hardened legacy bootstrap recovery in:
  - [src/agents/workspace/bootstrap-files.ts](../../src/agents/workspace/bootstrap-files.ts)
  - [src/agents/memory/learnings-store.ts](../../src/agents/memory/learnings-store.ts)
- Added the public resilience docs surface:
  - [docs/agents/resilience.md](../../docs/agents/resilience.md)
  - [docs/ko/agents/resilience.md](../../docs/ko/agents/resilience.md)
  - [docs/docs.json](../../docs/docs.json)
- Rebuilt the live scenario verifier around a curated suite in [src/agents/runtime/scenario-loop.ts](../../src/agents/runtime/scenario-loop.ts):
  - default suite is curated
  - curated suite membership is explicit scenario metadata
  - curated required coverage is explicit scenario metadata
  - watch-mode verification is scoped to the target session
- Added and updated regression coverage in:
  - [test/agent-config.test.ts](../../test/agent-config.test.ts)
  - [test/setup.test.ts](../../test/setup.test.ts)
  - [test/agent-runtime.test.ts](../../test/agent-runtime.test.ts)
  - [test/activation-queue.test.ts](../../test/activation-queue.test.ts)
  - [test/runtime-scheduler.test.ts](../../test/runtime-scheduler.test.ts)
  - [test/index.test.ts](../../test/index.test.ts)
  - [test/workspace-memory-bootstrap.test.ts](../../test/workspace-memory-bootstrap.test.ts)

## Verification

- `pnpm exec vitest run test/setup.test.ts test/agent-config.test.ts test/index.test.ts test/agent-runtime.test.ts`
- `pnpm exec vitest run test/activation-queue.test.ts test/runtime-scheduler.test.ts test/index.test.ts test/workspace-memory-bootstrap.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- live resilience probe:
  - `pnpm openboa agent session create --name pi-agent`
  - `pnpm openboa agent session send --session <id> --message "Use agent_describe_setup and report the exact resilience retry values ..."`
  - `pnpm openboa agent wake --session <id>`
  - observed exact resilience timings through the managed runtime surface
- live curated scenario reruns:
  - `pnpm openboa agent scenario-loop --agent activation-loop-089 --output /tmp/activation_loop_089_curated.md --model-timeout-ms 45000`
  - `pnpm openboa agent scenario-loop --agent activation-loop-090 --output /tmp/activation_loop_090_curated.md --model-timeout-ms 45000`
  - both completed with:
    - `suite: curated`
    - `available: 30`
    - `executed: 30`
    - `passed: 30`
    - `failed: 0`

## Result

Agent runtime resilience is now a named runtime contract instead of scattered defensive behavior. Operators can inspect the current resilience posture directly, legacy agents recover into the current bootstrap contract instead of failing on missing files, and the default live runtime bar is a curated `30/30` suite whose membership and coverage are owned by the scenario catalog itself.

## Next gap

The runtime and verifier are green. The remaining gap is review isolation, not more runtime behavior:

- isolate only the resilience frontier's owned boundary from the broader dirty branch
- rerun the narrow checks against that isolated file set
- request final signoff on the bounded resilience PR
