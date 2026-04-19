# Agent Scenario Debug Log

This log records each live runtime improvement loop for the 100-scenario agent validation pass.

## Loop 001

- Goal: stop read-only bootstrap quote scenarios from escalating into confirmation-gated `shell_run`.
- Live failure:
  - `bootstrap_quote` scenarios for `AGENTS.md` and `SOUL.md` sometimes stopped at `requires_action`
  - tool trace showed `shell_run`
  - no response body was produced
- Root cause:
  - runtime guidance downscoped generic file inspection, but it did not treat bootstrap quote/read requests as a distinct read-only intent
  - the model sometimes chose a writable shell path for a question that should have stayed in bootstrap context or `read`
- Structural fix:
  - added bootstrap read intent detection in [src/agents/runtime/harness.ts](/src/agents/runtime/harness.ts)
  - added explicit bootstrap read guidance in [src/agents/runtime/loop-directive.ts](/src/agents/runtime/loop-directive.ts)
  - improved scenario failure reporting in [src/agents/runtime/scenario-loop.ts](/src/agents/runtime/scenario-loop.ts)
- Verification:
  - `pnpm exec vitest run test/agent-runtime.test.ts test/system-prompt-structure.test.ts test/index.test.ts`
  - `pnpm openboa agent scenario-loop --agent scenario-loop-a3 --count 10 --output AGENT_SCENARIO_LOOP.md --model-timeout-ms 45000`
- Result:
  - quote smoke batch moved from `8/10` to `10/10`

## Loop 002

- Goal: make provider/tool-loop interrupts reliable in live Codex-backed runtime and make watch-mode execution inspectable.
- Live failures:
  - `always_ask` tool calls could surface as `Wake failed: failed to parse model response`
  - `orchestrator --watch` gave almost no visibility into what session, input, tool, or response just ran
  - live bootstrap/self-edit scenarios were hard to debug because provider/runtime boundaries were not explicit
- Root cause:
  - provider-specific catch blocks were reclassifying runtime interrupts such as confirmation-required pauses as generic invalid-response errors
  - watch mode only reported coarse activity counts instead of the executed event/tool surface
- Structural fix:
  - introduced provider-neutral runtime interrupt/error normalization in [src/agents/providers/provider-runtime-contract.ts](/src/agents/providers/provider-runtime-contract.ts)
  - moved `ToolConfirmationRequiredError` under a common runtime interrupt base in [src/agents/tools/runtime-tool.ts](/src/agents/tools/runtime-tool.ts)
  - refactored [src/agents/providers/codex-model-client.ts](/src/agents/providers/codex-model-client.ts) to preserve runtime interrupts instead of downgrading them into parse errors
  - upgraded watch-mode logging in [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts), [src/agents/runtime/wake-session.ts](/src/agents/runtime/wake-session.ts), and [src/index.ts](/src/index.ts) so session inputs, response previews, and event spans are visible during live runs
  - made session-state writes atomic in [src/agents/sessions/session-store.ts](/src/agents/sessions/session-store.ts) to reduce watch-loop write races
- Verification:
  - `pnpm exec vitest run test/codex-model-client.test.ts test/index.test.ts test/runtime-scheduler.test.ts test/system-prompt-structure.test.ts`
  - direct live watch-mode scenarios against Codex-backed sessions
- Result:
  - approval-required runs now stop as `requires_action` instead of surfacing as parse failures
  - watch mode became usable for live runtime debugging

## Loop 003

- Goal: stabilize live bootstrap quote/readback and writable-shell routing across the full 100-scenario batch.
- Live failures:
  - quote/read scenarios sometimes exhausted tool rounds because `read` received noisy `tailLines` or conflicting range arguments
  - shell/file scenarios could fail when the model referenced virtual mount paths like `/workspace/...` inside shell commands
  - fresh codex agents could expose the wrong tool catalog because scaffolded config still said `sandbox: off`
- Root cause:
  - the managed `read` surface was too literal about non-positive numeric args and did not absorb common model noise
  - shell execution did not consistently translate virtual mount paths into mounted host paths
  - default codex agent config drifted from the actual workspace-backed runtime contract
- Structural fix:
  - normalized non-positive `lineCount` / `tailLines` values in [src/agents/sandbox/sandbox.ts](/src/agents/sandbox/sandbox.ts) and [src/agents/tools/managed-runtime-tools.ts](/src/agents/tools/managed-runtime-tools.ts)
  - added shell virtual mount rewriting in [src/agents/sandbox/sandbox.ts](/src/agents/sandbox/sandbox.ts) for `/workspace`, `/workspace/agent`, and `/runtime`
  - aligned default codex agent setup with the real workspace sandbox in [src/agents/setup.ts](/src/agents/setup.ts) and [src/agents/agent-config.ts](/src/agents/agent-config.ts)
  - strengthened scenario-loop bootstrap quote prompts in [src/agents/runtime/scenario-loop.ts](/src/agents/runtime/scenario-loop.ts) so live scenarios explicitly use `read` on bootstrap mounts
- Verification:
  - `pnpm exec vitest run test/setup.test.ts test/sandbox.test.ts test/agent-runtime.test.ts test/system-prompt-structure.test.ts`
  - full live batch: `pnpm openboa agent scenario-loop --agent scenario-loop-a7 --count 100 --output AGENT_SCENARIO_LOOP.md --model-timeout-ms 45000`
- Result:
  - live batch improved to `98/100`
  - remaining failures were isolated to `IDENTITY.md` bootstrap promotion/readback

## Loop 004

- Goal: close the final bootstrap promotion bug and reach `100/100` live scenarios.
- Live failures:
  - `Promote - Scenario-PROMOTE-IDENTITY into IDENTITY.md` failed after approval with `resources_promote_to_substrate content precondition failed: expected ... but latest is none`
  - follow-up `IDENTITY.md` readback scenarios then failed because the promotion never landed
- Root cause:
  - promotion precondition checks used the raw requested `targetPath` for version-store lookup and live substrate reads
  - when the request used absolute mount paths like `/workspace/agent/IDENTITY.md`, the precondition path was not normalized through the shared-substrate attachment contract
  - this made bootstrap files with no prior substrate version history look like `latest is none` even though the live substrate file already existed
- Structural fix:
  - added shared-substrate target normalization in [src/agents/tools/managed-runtime-tools.ts](/src/agents/tools/managed-runtime-tools.ts) via `requireResourceAttachment(...)` + `resolveAttachedResourcePath(...)`
  - applied the same normalized path contract to both `resources_promote_to_substrate` and `resources_restore_version`
  - stored new promotion version records under the normalized relative substrate path
  - added regression coverage in [test/agent-runtime.test.ts](/test/agent-runtime.test.ts) for `absolute /workspace/agent/...` promotion with no prior substrate version
- Verification:
  - `pnpm exec vitest run test/agent-runtime.test.ts -t "resources_promote_to_substrate|absolute mount path|resources_restore_version"`
  - `pnpm exec tsc --noEmit`
  - full live batch: `pnpm openboa agent scenario-loop --agent scenario-loop-a8 --count 100 --output AGENT_SCENARIO_LOOP.md --model-timeout-ms 45000`
- Result:
  - `scenario-loop-a8` finished `100/100`
  - `IDENTITY.md` promotion and both `IDENTITY.md` readback scenarios are now green in live runtime

## Loop 005

- Goal: make provider/runtime behavior future-proof by formalizing a shared provider adapter contract and conformance suite.
- Risk addressed:
  - codex-specific regression tests alone were not enough to guarantee that future providers would preserve:
    - canonical provider-safe tool names
    - multi-round tool-loop continuation
    - runtime interrupt passthrough for approval-required tools
  - the runtime contract was structurally right, but the test surface was still provider-specific
- Structural fix:
  - introduced the provider-facing interface in [src/agents/providers/model-client.ts](/src/agents/providers/model-client.ts)
  - updated [src/agents/providers/codex-model-client.ts](/src/agents/providers/codex-model-client.ts) to implement that interface
  - updated [src/agents/runners/pi-adapter.ts](/src/agents/runners/pi-adapter.ts) to depend on the interface rather than the concrete codex client
  - added shared test harness [test/helpers/provider-model-client-conformance.ts](/test/helpers/provider-model-client-conformance.ts)
  - moved Codex responses-api and oauth-streaming adapter contract checks onto the shared conformance suite in [test/codex-model-client.test.ts](/test/codex-model-client.test.ts)
- Verification:
  - `pnpm exec vitest run test/codex-model-client.test.ts test/index.test.ts`
  - `pnpm exec tsc --noEmit`
  - live smoke: `pnpm openboa agent scenario-loop --agent scenario-loop-a9-smoke --count 5 --output /tmp/agent_scenario_smoke.md --model-timeout-ms 45000`
- Result:
  - shared provider conformance suite is green
  - live Codex-backed smoke remained `5/5`

## Loop 006

- Goal: align the orchestrator implementation with the activation-consumer model instead of scanning every session each cycle.
- Problem:
  - conceptually, the runtime had already moved to `event append -> activation -> wake(sessionId)`
  - implementation still did `listAgentSessions(agentId)` and attempted a wake on every session every cycle
  - that worked as a fallback, but it blurred the line between `session truth` and `activation work`
- Structural fix:
  - introduced [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts)
  - `LocalSessionActivationQueue` now derives ready work from:
    - immediate pending session events
    - due delayed wakes from the private wake queue
  - updated [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts) so the worker consumes `readyActivations` rather than iterating across all sessions
  - added scheduler regression coverage in [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) for:
    - pending events taking precedence over due wakes for the same session
    - activation ordering across immediate and delayed work
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/index.test.ts`
  - `pnpm exec tsc --noEmit`
  - live watch-mode smoke with:
    - `pnpm openboa agent orchestrator --agent activation-watch-smoke --watch --log --poll-interval-ms 200 --idle-timeout-ms 30000`
    - `pnpm openboa agent session send --session 019d7ee7-035a-7428-8c80-27562664f3b1 --message "What is your name?"`
- Result:
  - activation queue abstraction is green in tests
  - live watch-mode orchestrator consumed pending events through the activation path and produced the expected runtime log

## Loop 007

- Goal: stop scanning every session to find immediate work by using a maintained runnable-session index.
- Problem:
  - Loop 006 moved orchestration onto an activation queue, but immediate activation discovery still reopened every session to find pending user work
  - that meant the worker conceptually consumed activations while implementation still paid an all-session discovery cost for immediate events
- Structural fix:
  - added a runnable-session index in [src/agents/sessions/session-store.ts](/src/agents/sessions/session-store.ts)
  - `writeSession(...)` now keeps `runtime/runnable-sessions.json` in sync with `status === "rescheduling"`
  - added `getAgentSession(agentId, sessionId)` and `listRunnableSessionIds(agentId)` so activation discovery can stay agent-scoped and avoid global session lookup
  - updated [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts) so:
    - immediate activations come from `listRunnableSessionIds(agentId)`
    - delayed activations stay on the queued-wake path
    - pending events still win over delayed wakes for the same session
  - tightened [src/agents/sessions/session-store.ts](/src/agents/sessions/session-store.ts) `listAgentSessionIds(...)` so delayed wake discovery only needs directory ids instead of reading every session file
  - added regression coverage in [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) for runnable-session index creation and cleanup
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/index.test.ts`
  - `pnpm exec tsc --noEmit`
- Result:
  - immediate activation discovery now uses a maintained runnable-session index
  - focused scheduler and type checks stayed green
  - a live smoke exposed a separate idle-timeout boundary race, which became Loop 008

## Loop 008

- Goal: stop `orchestrator --watch` from idling out if new work becomes ready exactly at the idle-timeout boundary.
- Live failure:
  - watch smoke on `activation-loop-007` produced `executed: 0` even though the session had:
    - `status: rescheduling`
    - `pendingEvents: 1`
    - the session id present in `runtime/runnable-sessions.json`
  - root cause was not activation discovery but a timeout race:
    - the worker fetched `readyActivations`
    - saw none
    - crossed `idleTimeoutMs`
    - returned `idle_timeout` without one final lease check
  - if a user event landed between the last empty poll and the timeout branch, the worker could stop despite runnable work existing
- Structural fix:
  - updated [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts) to centralize activation execution in `executeReadyActivations(...)`
  - before returning `idle_timeout`, the worker now performs one final activation re-check and consumes any newly ready work instead of stopping prematurely
  - added regression coverage in [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) using a custom activation queue that returns work only on the timeout-boundary re-check
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/index.test.ts`
  - `pnpm exec tsc --noEmit`
  - live watch smoke:
    - `pnpm openboa agent spawn --name activation-loop-007`
    - `pnpm openboa agent session create --name activation-loop-007`
    - `pnpm openboa agent orchestrator --agent activation-loop-007 --watch --log --poll-interval-ms 200 --idle-timeout-ms 15000`
    - `pnpm openboa agent session send --session 019d7ef1-f398-77c3-a613-76b89eb89f4d --message "What is your name?"`
- Result:
  - live watch-mode worker consumed both the previously stuck session `019d7eee-b934-704d-8fea-3330a8d1a16e` and the new session `019d7ef1-f398-77c3-a613-76b89eb89f4d`
  - `responsePreview: My name is activation-loop-007.` was produced in both cases
  - idle-timeout no longer drops immediate work that becomes ready at the boundary

## Loop 009

- Goal: stop scanning all session ids to discover delayed work by giving queued wakes their own agent-level index.
- Problem:
  - Loop 007 removed the all-session scan for immediate work, but delayed activation discovery still depended on iterating every session id and then checking each session wake journal
  - that kept the delayed side of the activation consumer model half on the old scheduler shape
- Structural fix:
  - updated [src/agents/runtime/session-wake-queue.ts](/src/agents/runtime/session-wake-queue.ts) to maintain `runtime/pending-wake-sessions.json`
  - added `listSessionIdsWithPendingWakes(agentId)` so delayed discovery can start from the subset of sessions that still have any uncompleted wake
  - kept the index accurate on:
    - `enqueue(...)`
    - `consumeDue(...)`
    - `cancelPending(...)`
  - updated [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts) so delayed activation discovery uses `wakeQueue.listSessionIdsWithPendingWakes(agentId)` instead of scanning all session ids
  - added regression coverage:
    - [test/activation-queue.test.ts](/test/activation-queue.test.ts) now verifies the pending-wake session index is created and cleared correctly
    - [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) verifies delayed activation discovery no longer calls `listAgentSessionIds(...)`
- Verification:
  - `pnpm exec vitest run test/activation-queue.test.ts test/runtime-scheduler.test.ts test/index.test.ts`
  - `pnpm exec tsc --noEmit`
  - live delayed-wake smoke:
    - `pnpm openboa agent session create --name activation-loop-007`
    - `pnpm tsx -e '(async () => { ... queue.enqueue(...) })();'`
    - `pnpm openboa agent orchestrator --agent activation-loop-007 --watch --log --poll-interval-ms 200 --idle-timeout-ms 10000`
- Result:
  - live worker consumed the delayed wake for session `019d7efc-18a9-767f-8b5b-f5a8a82e7349`
  - watch log showed `input[1]: queued_wake: session.revisit (loop-009 delayed wake smoke)`
  - delayed activation discovery now starts from the pending-wake session subset instead of the full session set

## Loop 010

- Goal: avoid reopening future-wake session journals on every poll by carrying `nextDueAt` in the delayed-wake index.
- Problem:
  - Loop 009 reduced delayed discovery from “all sessions” to “sessions with any pending wake”
  - but the worker still reopened each indexed session journal every poll just to discover that some wakes were not due yet
- Structural fix:
  - upgraded [src/agents/runtime/session-wake-queue.ts](/src/agents/runtime/session-wake-queue.ts) `pending-wake-sessions.json` from a bare `sessionId[]` set into an indexed entry list:
    - `{ sessionId, nextDueAt }`
  - added `listSessionIdsWithDueWakes(agentId, at)` so delayed activation discovery starts from the due-session subset
  - kept backward compatibility by accepting the old string-array shape and rewriting it on confirmation
  - updated [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts) to use `listSessionIdsWithDueWakes(...)`
  - added regression coverage:
    - [test/activation-queue.test.ts](/test/activation-queue.test.ts) now verifies that due-session discovery excludes future wakes
    - [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) verifies future-wake sessions are not reopened through `listPending(...)`
- Verification:
  - `pnpm exec vitest run test/activation-queue.test.ts test/runtime-scheduler.test.ts test/index.test.ts`
  - `pnpm exec tsc --noEmit`
- Result:
  - delayed activation discovery now narrows from:
    - all sessions
    - to pending-wake sessions
    - to only due-wake sessions
  - future scheduled wakes are no longer reopened on every worker poll

## Loop 011

- Goal: remove the last redundant session-snapshot reopen from delayed activation discovery.
- Problem:
  - after Loop 010, delayed discovery already had a due-session subset
  - but [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts) still reopened session snapshots just to guard against overlap with immediate work
  - that guard was no longer necessary because delayed activations are merged with immediate activations by session id before execution
- Structural fix:
  - removed the extra `getAgentSession(...)` check from delayed activation discovery in [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts)
  - kept overlap handling in the existing `mergeActivations(...)` path, which is the correct ownership boundary for deduping immediate vs delayed work
  - added regression coverage in [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) to assert delayed activation discovery does not reopen session snapshots from the due-wake index path
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/activation-queue.test.ts`
  - `pnpm exec tsc --noEmit`
- Result:
  - delayed activation discovery now stays entirely on wake-queue data until an actual due session needs its wake journal reopened
  - the overlap rule remains correct through merge-time dedupe rather than pre-merge snapshot inspection

## Loop 012

- Goal: remove session-journal reopen from immediate activation discovery by enriching the runnable-session index.
- Problem:
  - after Loop 011, delayed discovery no longer reopened session snapshots unnecessarily
  - immediate discovery still used `listRunnableSessionIds(...)` and then reopened each runnable session journal only to recover the pending event type
- Structural fix:
  - upgraded [src/agents/sessions/session-store.ts](/src/agents/sessions/session-store.ts) runnable-session index entries from bare `sessionId[]` to:
    - `{ sessionId, pendingEventType }`
  - kept backward compatibility by reading legacy string arrays and normalizing them to entry objects
  - added `listRunnableSessions(agentId)` so activation discovery can consume index metadata directly
  - updated [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts) so immediate activations are derived from runnable-session index entries rather than reopening session snapshots
  - ensured `emitEvent(...)` writes the pending event type into the runnable-session index when a new runnable event arrives
  - added regression coverage:
    - [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) verifies immediate activation discovery does not call `getAgentSession(...)`
    - [test/activation-queue.test.ts](/test/activation-queue.test.ts) verifies runnable-session index entries preserve `pendingEventType`
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/activation-queue.test.ts`
  - `pnpm exec tsc --noEmit`
- Result:
  - immediate activation discovery now stays on maintained index data instead of reopening runnable session journals
  - both immediate and delayed activation discovery now operate on dedicated activation indexes before opening any session or wake journals

## Loop 013

- Goal: reduce duplicate global session lookups during actual wake execution, not just activation discovery.
- Problem:
  - even after Loops 007–012, `wakeSessionOnce(...)` still:
    - loaded a session snapshot
    - reloaded pending events through `getEvents(...)`
    - used session-id-only wake queue methods that internally resolved the session location again
  - the activation consumer path had become indexed, but the execution step still duplicated global lookup work
- Structural fix:
  - updated [src/agents/runtime/wake-session.ts](/src/agents/runtime/wake-session.ts) so `wakeSessionOnce(...)`:
    - derives pending events from the initial session snapshot
    - uses agent-scoped wake queue methods instead of session-id-only global lookups
  - extended [src/agents/runtime/session-wake-queue.ts](/src/agents/runtime/session-wake-queue.ts) with:
    - `listPendingForAgentSession(...)`
    - `consumeDueForAgentSession(...)`
    - `cancelPendingForAgentSession(...)`
    - agent-scoped wake journal path resolution
  - kept the existing session-id-only methods as thin compatibility wrappers
  - added direct regression coverage in [test/wake-session.test.ts](/test/wake-session.test.ts) to assert:
    - `getEvents(...)` is no longer called during wake execution
    - wake execution uses the agent-scoped wake queue methods instead of the global session-id-only ones
- Verification:
  - `pnpm exec vitest run test/wake-session.test.ts test/runtime-scheduler.test.ts test/activation-queue.test.ts`
  - `pnpm exec tsc --noEmit`
- Result:
  - the activation consumer path now stays agent-scoped from activation discovery through wake execution
  - actual wake execution no longer pays duplicate global session lookup costs just to re-read data it already has

## Loop 014

- Goal: stop reopening future-wake journals while deciding which delayed sessions are due right now.
- Problem:
  - Loop 010 introduced `nextDueAt` in the delayed-wake index, but `listSessionIdsWithDueWakes(...)` still reopened every indexed wake journal before deciding whether the session was due
  - that meant future wakes were still paying per-poll journal reads even though the index already knew they were not due yet
- Structural fix:
  - updated [src/agents/runtime/session-wake-queue.ts](/src/agents/runtime/session-wake-queue.ts) so `listSessionIdsWithDueWakes(...)` trusts indexed `nextDueAt` values for normal operation
  - added a targeted fallback path only for legacy/malformed entries with missing `nextDueAt`
  - kept backward compatibility by recalculating and rewriting index entries only when the indexed `nextDueAt` is unavailable
  - added regression coverage in [test/activation-queue.test.ts](/test/activation-queue.test.ts) to assert due-session filtering does not reopen future wake journals when `nextDueAt` is present
- Verification:
  - `pnpm exec vitest run test/activation-queue.test.ts test/runtime-scheduler.test.ts test/wake-session.test.ts`
  - `pnpm exec tsc --noEmit`
- Result:
  - delayed discovery now uses the wake index as an actual scheduling surface rather than a hint that still triggers journal reopens
  - future wakes remain indexed but no longer cost journal I/O until they are near execution or need repair

## Loop 015

- Goal: make watch-mode sleep respect both the next due wake and the remaining idle-timeout budget.
- Problem:
  - once delayed wakes were indexed, the worker still always slept for `pollIntervalMs` when idle unless a sooner due wake existed
  - that caused two issues:
    - the worker could oversleep past its own `idleTimeoutMs`
    - tests that expected shorter delayed-wake latency still waited for a long fixed poll interval after execution
- Structural fix:
  - extended [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts) with `peekNextDueAt(agentId)`
  - exposed `peekNextDueAt(agentId)` from [src/agents/runtime/session-wake-queue.ts](/src/agents/runtime/session-wake-queue.ts)
  - updated [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts) so watch-mode sleep is now:
    - bounded by `pollIntervalMs`
    - shortened to the next due wake when that is sooner
    - also capped by the remaining idle-timeout budget
  - added scheduler regression coverage in [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) proving:
    - near-future delayed wakes are handled before a long poll interval would have delayed them
    - custom activation queues explicitly implement the richer interface
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/activation-queue.test.ts test/wake-session.test.ts`
  - `pnpm exec tsc --noEmit`
- Result:
  - watch mode now behaves like a bounded scheduler rather than a pure fixed-interval poller
  - delayed wake latency is reduced, and the worker no longer oversleeps past its own idle-timeout budget

## Loop 016

- Goal: make the runnable-session index represent pending runnable events only, not generic `rescheduling` state.
- Problem:
  - after Loop 012, runnable-session discovery was fast, but the index was still updated from `writeSession(...)` based only on `status === "rescheduling"`
  - that was too broad because queued wakes and follow-up revisits can also set `rescheduling` without any pending user-side event
  - the wrong ownership boundary meant a session with only delayed work could leak into the immediate activation surface
- Structural fix:
  - moved runnable-session index ownership away from generic session writes and onto event lifecycle in [src/agents/sessions/session-store.ts](/src/agents/sessions/session-store.ts)
  - `emitEvent(...)` now explicitly inserts/updates runnable-session entries when a new runnable pending event arrives
  - `markProcessed(...)` now refreshes runnable-session index state from the session journal after processing markers land
  - `writeSession(...)` no longer mutates runnable-session index state based on coarse session status alone
  - added regression coverage in [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) to prove:
    - runnable-session entries clear when pending events are processed
    - queued-wake-only `rescheduling` does not show up as immediate runnable work
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/activation-queue.test.ts test/wake-session.test.ts`
  - `pnpm exec tsc --noEmit`
- Result:
  - immediate activation now means “there is actual pending runnable event work,” not merely “the session is rescheduling for any reason”
  - delayed wakes and immediate events now have cleanly separated ownership surfaces

## Loop 017

- Goal: make activation indexes self-healing without reintroducing poll-time journal scans.
- Problem:
  - after Loop 016, runnable-session ownership was correct, but a crash or interrupted write could still leave stale runnable entries behind
  - if the worker trusted such an entry, it could try an immediate activation for a session that no longer had pending runnable events
- Structural fix:
  - added [src/agents/sessions/session-store.ts](/src/agents/sessions/session-store.ts) `reconcileRunnableSession(agentId, sessionId)`
  - updated [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts) so when an immediate activation produces `executed: false`, the worker reconciles only that one runnable-session entry
  - this keeps the fast path index-driven while still healing stale immediate entries on demand instead of scanning journals every poll
  - added regression coverage in [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) by simulating a stale `runnable-sessions.json` entry and proving the worker prunes it after one empty activation attempt
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/activation-queue.test.ts test/wake-session.test.ts`
  - `pnpm exec tsc --noEmit`
- Result:
  - activation indexes now self-repair on the stale immediate path without giving up the index-first scheduling model
  - the worker remains cheap on the hot path and precise on the rare repair path

## Loop 018

- Goal: make the delayed-wake index self-healing when a due entry is stale, without reopening future wake journals on every poll.
- Problem:
  - after Loop 014, future delayed wakes no longer reopened their journals, but a stale due entry in `pending-wake-sessions.json` could still survive forever if its journal had already been cleared
  - that meant the worker would keep treating the session as potentially due even though no delayed work remained, and there was no targeted repair path for the delayed side of the activation surface
- Structural fix:
  - updated [src/agents/runtime/session-wake-queue.ts](/src/agents/runtime/session-wake-queue.ts) so `listSessionIdsWithDueWakes(...)` now splits delayed index handling into two cases:
    - future entries with indexed `nextDueAt` are trusted and do not reopen their journals
    - entries that are already due now are revalidated against the session wake journal and removed from the index if no delayed wake remains
  - kept the journal-reopen path only where it performs actual repair work, instead of using it as a normal scheduling dependency
  - added regression coverage in [test/activation-queue.test.ts](/test/activation-queue.test.ts) to simulate a stale due entry and prove the delayed index is rewritten back to empty
- Verification:
  - `pnpm exec vitest run test/activation-queue.test.ts test/runtime-scheduler.test.ts test/wake-session.test.ts`
  - `pnpm exec tsc --noEmit`
- Result:
  - delayed activation discovery stays cheap for future work and also repairs stale due entries automatically
  - both immediate and delayed activation indexes now have explicit self-healing paths instead of relying on coarse full rescans

## Loop 019

- Goal: make watch mode event-driven in-process and cross-process, instead of relying only on fixed sleep windows.
- Problem:
  - after Loop 018, activation discovery was cheap, but watch mode still slept on a fixed timeout and only used polling to notice new immediate events
  - a local worker should wake as soon as runtime indexes change, while still preserving a timeout fallback for delayed wakes and environments where file watching is noisy
- Structural fix:
  - extended [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts) with `waitForChange(...)`
  - updated [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts) so watch mode no longer calls a generic `delay(...)`; it now waits on activation-queue change signals bounded by the existing scheduler timeout
  - added in-process runtime-index event emitters to:
    - [src/agents/sessions/session-store.ts](/src/agents/sessions/session-store.ts) for runnable-session index writes
    - [src/agents/runtime/session-wake-queue.ts](/src/agents/runtime/session-wake-queue.ts) for pending-wake index writes
  - kept `fs.watch(...)` as a cross-process fallback in the activation queue, but narrowed it to runtime-index file families (`runnable-sessions*`, `pending-wake-sessions*`) so temp-file atomic writes still wake the worker
  - added regression coverage in [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) proving:
    - delayed wakes still trigger without manual wake
    - background user events still trigger without explicit wake
    - long poll intervals do not delay immediate work once the runnable index changes
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/activation-queue.test.ts test/wake-session.test.ts`
  - `pnpm exec tsc --noEmit`
  - live cross-process smoke:
    - `pnpm openboa agent orchestrator --agent activation-loop-019 --watch --log --poll-interval-ms 1000 --idle-timeout-ms 5000`
    - `pnpm openboa agent session send --session 019d7f15-44c3-729a-98cf-8411a5faab26 --message "What is your name?"`
- Result:
  - watch mode now has a real activation signal surface instead of behaving like a pure fixed-interval poller
  - same-process writes wake immediately through runtime-index events, and separate CLI processes wake through runtime-dir file changes

## Loop 020

- Goal: remove the last per-cycle session reopen from immediate activation discovery.
- Problem:
  - after Loop 019, watch mode woke promptly, but `listRunnableSessions(...)` still reopened each indexed session JSON to confirm `status === "rescheduling"`
  - that check duplicated ownership that had already been moved into event lifecycle and stale-entry reconciliation in Loops 016 and 017
- Structural fix:
  - updated [src/agents/sessions/session-store.ts](/src/agents/sessions/session-store.ts) so `listRunnableSessions(...)` now trusts `runnable-sessions.json` directly on the hot path
  - kept correctness by relying on the existing targeted repair path:
    - stale runnable entries are still pruned by `reconcileRunnableSession(...)` when an immediate activation produces no work
  - added regression coverage in [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) proving immediate activation discovery no longer calls the private `readSessionIfPresent(...)` helper at all
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/activation-queue.test.ts test/wake-session.test.ts`
  - `pnpm exec tsc --noEmit`
- Result:
  - immediate activation discovery is now fully index-driven on the hot path
  - session-journal reads are reserved for actual execution or targeted stale-entry repair, not routine worker polling

## Loop 021

- Goal: remove duplicate due-wake journal reads between delayed activation discovery and execution.
- Problem:
  - delayed activation discovery already reopened the due wake journal to build a `queued_wake` activation
  - when that activation actually executed, [src/agents/runtime/wake-session.ts](/src/agents/runtime/wake-session.ts) reopened the same journal again through `listPendingForAgentSession(...)` / `consumeDueForAgentSession(...)`
  - this doubled I/O on the due-wake path without adding new information
- Structural fix:
  - extended [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts) so `SessionActivation` now carries `dueWakes`
  - added [src/agents/runtime/session-wake-queue.ts](/src/agents/runtime/session-wake-queue.ts) `consumeKnownForAgentSession(...)` to complete already-known due wakes without re-listing them
  - updated [src/agents/runtime/wake-session.ts](/src/agents/runtime/wake-session.ts) so queued-wake execution reuses prefetched due wakes from activation discovery, while still falling back to live listing when no activation snapshot exists
  - added regression coverage in [test/wake-session.test.ts](/test/wake-session.test.ts) proving prefetched due wakes avoid the second journal read
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/activation-queue.test.ts test/wake-session.test.ts`
  - `pnpm exec tsc --noEmit`
- Result:
  - delayed activation discovery and execution now share the same due-wake snapshot
  - the hot path pays one journal read per due session instead of two

## Loop 022

- Goal: add execution lease semantics so multiple workers cannot run the same session concurrently.
- Problem:
  - the activation consumer was now cheap and fast, but there was still no reservation/lease step between “session is ready” and “wake begins”
  - two workers could both consume the same activation and duplicate execution if they overlapped closely enough
- Structural fix:
  - added per-session wake leases to [src/agents/sessions/session-store.ts](/src/agents/sessions/session-store.ts) via `acquireWakeLease(...)`
  - updated [src/agents/runtime/wake-session.ts](/src/agents/runtime/wake-session.ts) so every wake attempt acquires a lease before reading pending events or due wakes and releases it in `finally`
  - left execution semantics unchanged for the winning worker, while contention now returns a non-executed wake result instead of racing
  - added regression coverage in [test/wake-session.test.ts](/test/wake-session.test.ts) proving concurrent wake attempts only execute one harness run
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/activation-queue.test.ts test/wake-session.test.ts`
  - `pnpm exec tsc --noEmit`
  - live contention smoke:
    - two concurrent `orchestrator --watch --log` workers on the same pending session for `activation-loop-019`
    - only one worker produced `orchestrator: activity`; the other exited with `executed: 0`
- Result:
  - the activation consumer now has actual lease semantics instead of assuming a single worker
  - duplicate session execution is blocked at the wake entrypoint, not left to timing luck

## Loop 023

- Goal: make lease/contention and other non-executed activation outcomes visible in watch logs.
- Problem:
  - after Loop 022, contention was correctly blocked, but the losing worker only stopped with `executed: 0`
  - there was no runtime surface telling an operator whether a session was skipped because of lease contention, stale activation repair, or some other non-executed path
- Structural fix:
  - extended [src/agents/runtime/wake-session.ts](/src/agents/runtime/wake-session.ts) result objects with `skippedReason`
  - extended [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts) with `AgentOrchestratorSkipActivity` and `onSkip(...)`
  - updated [src/index.ts](/src/index.ts) so `orchestrator --watch --log` prints `orchestrator: skipped` blocks with cycle, session, activation kind, and reason
  - added regression coverage in [test/index.test.ts](/test/index.test.ts) and [test/wake-session.test.ts](/test/wake-session.test.ts)
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/activation-queue.test.ts test/wake-session.test.ts test/index.test.ts`
  - `pnpm exec tsc --noEmit`
  - live contention smoke confirmed skipped visibility for the losing worker
- Result:
  - watch-mode logs now explain why a non-executed activation happened
  - contention is debuggable from the CLI instead of only being inferable from missing activity

## Loop 024

- Goal: suppress duplicate skip-noise when a session stays lease-contended across multiple watch cycles.
- Problem:
  - once Loop 023 surfaced skipped activations, a losing worker could emit the same `lease_contended` log line on every cycle while another worker still held the lease
  - this made watch logs noisy without adding new information
- Structural fix:
  - updated [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts) to track `reportedSkipReasons` per session inside a watch run
  - identical repeated skip reasons are now logged once until the session either executes successfully or changes skip reason
  - added regression coverage in [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) proving repeated `lease_contended` skips across cycles only produce one `onSkip(...)` callback
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/activation-queue.test.ts test/wake-session.test.ts test/index.test.ts`
  - `pnpm exec tsc --noEmit`
  - live two-worker smoke confirmed the losing worker now prints a single `orchestrator: skipped ... lease_contended` block instead of repeated spam
- Result:
  - watch-mode contention remains visible but no longer overwhelms the operator with duplicate lines
  - non-executed activation telemetry is now high signal rather than repetitive

## Loop 025

- Goal: prevent crashed workers from leaving sessions permanently deadlocked behind stale wake leases.
- Problem:
  - Loop 022 introduced `wake.lock` files for execution leases, but if a worker crashed before releasing the lock the session could remain blocked forever
  - a lease system without stale-lock recovery is operationally unsafe even if duplicate execution is prevented
- Structural fix:
  - extended [src/agents/sessions/session-store.ts](/src/agents/sessions/session-store.ts) with persisted lease records and a stale-lease TTL check
  - `acquireWakeLease(...)` now:
    - reads an existing lease file when acquisition fails
    - removes it only if the recorded `acquiredAt` is older than the stale-lease threshold
    - retries acquisition once after cleanup
  - added regression coverage in [test/wake-session.test.ts](/test/wake-session.test.ts) proving a stale `wake.lock` no longer deadlocks session execution
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/activation-queue.test.ts test/wake-session.test.ts test/index.test.ts`
  - `pnpm exec tsc --noEmit`
- Result:
  - wake leases now cover both safety properties:
    - no duplicate concurrent execution
    - no permanent deadlock after a crashed worker

## Loop 026

- Goal: keep legitimate long-running wakes from being mistaken for stale leases.
- Problem:
  - Loop 025 added stale-lease recovery, but a long-running harness execution could still outlive the stale-lease TTL and be incorrectly reclaimed by another worker
  - stale cleanup without lease renewal only works when every valid wake always finishes well before the stale threshold
- Structural fix:
  - extended [src/agents/sessions/session-store.ts](/src/agents/sessions/session-store.ts) `SessionWakeLease` with `renew()`
  - added lease-record rewrite support so the active owner can refresh `acquiredAt` without dropping the lock
  - updated [src/agents/runtime/wake-session.ts](/src/agents/runtime/wake-session.ts) to start a heartbeat interval for the acquired wake lease and clear it in `finally`
  - added regression coverage in [test/wake-session.test.ts](/test/wake-session.test.ts) proving `renew()` advances the persisted lease timestamp
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/activation-queue.test.ts test/wake-session.test.ts test/index.test.ts`
  - `pnpm exec tsc --noEmit`
- Result:
  - wake leases are now safe in both directions:
    - stale crashed leases can be reclaimed
    - active long-running leases stay fresh and are not reclaimed incorrectly

## Loop 027

- Goal: stop the losing worker from even attempting wake execution once a fresh lease already exists.
- Problem:
  - after Loop 026, duplicate execution was blocked, but a second worker could still discover the same ready activation and only learn about contention at the wake entrypoint
  - that still paid unnecessary wake overhead and produced one skip-path per contended session
- Structural fix:
  - added [src/agents/sessions/session-store.ts](/src/agents/sessions/session-store.ts) `hasActiveWakeLease(agentId, sessionId)`
  - updated [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts) so both immediate and delayed activation discovery now filter out sessions with a fresh active wake lease
  - stale lock cleanup still happens through the same stale-lease logic, so filtering does not introduce permanent starvation
  - added regression coverage in [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) proving leased runnable sessions are excluded from immediate activation discovery
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/activation-queue.test.ts test/wake-session.test.ts test/index.test.ts`
  - `pnpm exec tsc --noEmit`
  - live two-worker smoke on `activation-loop-019`
- Result:
  - wake contention is now mostly resolved at activation discovery instead of being pushed down into execution
  - only the true first-race window remains, which is then handled by the execution lease itself

## Loop 028

- Goal: remove an unnecessary global session lookup from delayed activation discovery.
- Problem:
  - [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts) already knew `agentId`, but `listDelayedActivations(...)` still called `wakeQueue.listPending(sessionId, at)`
  - that path resolved session location again even though the activation queue already had agent-scoped context
- Structural fix:
  - updated delayed activation discovery to use `listPendingForAgentSession(agentId, sessionId, at)` directly
  - updated regression coverage in [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) so it now asserts the agent-scoped wake-queue path is used instead of the global one
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/activation-queue.test.ts test/wake-session.test.ts test/index.test.ts`
  - `pnpm exec tsc --noEmit`
- Result:
  - delayed activation discovery no longer performs a redundant session-location resolution on the due-wake path
  - wake-queue ownership is more consistently agent-scoped throughout the scheduler

## Loop 029

- Goal: remove the remaining global session lookup from delayed due-index repair.
- Problem:
  - [src/agents/runtime/session-wake-queue.ts](/src/agents/runtime/session-wake-queue.ts) `listSessionIdsWithDueWakes(...)` still called `computeNextDueAt(sessionId)` for due entries
  - that helper reopened the wake journal through a global session-id path even though `agentId` was already known in the same function
- Structural fix:
  - replaced the global helper with `computeNextDueAtForAgentSession(agentId, sessionId)`
  - kept the journal reopen only for due-entry confirmation/repair, but made it agent-scoped end-to-end
  - updated [test/activation-queue.test.ts](/test/activation-queue.test.ts) so it asserts the due session is reopened through `readForAgentSession("alpha", dueSession.id)` and that future indexed wakes are still not reopened
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/activation-queue.test.ts test/wake-session.test.ts test/index.test.ts`
  - `pnpm exec tsc --noEmit`
- Result:
  - delayed due-index repair is now fully agent-scoped
  - the scheduler no longer falls back to global session resolution anywhere on the delayed hot path

## Loop 030

- Goal: move wake-lease timing policy out of hardcoded runtime constants and into the agent runtime config.
- Problem:
  - the wake lease stale TTL and heartbeat interval were hardcoded in scheduler/storage code
  - that made the behavior harder to tune per agent and broke the separation between durable runtime policy and storage mechanics
- Structural fix:
  - extended [src/agents/agent-config.ts](/src/agents/agent-config.ts) with `runtime.wakeLease.staleAfterSeconds` and `runtime.wakeLease.heartbeatSeconds`
  - added `resolveWakeLeasePolicy(...)` so runtime code consumes milliseconds while config stays human-readable in seconds
  - updated [src/agents/setup.ts](/src/agents/setup.ts) so newly spawned agents are scaffolded with explicit wake-lease defaults
  - kept [src/agents/sessions/session-store.ts](/src/agents/sessions/session-store.ts) storage-oriented by taking an optional `staleAfterMs` policy instead of reading agent config directly
  - threaded the runtime policy through [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts), [src/agents/runtime/wake-session.ts](/src/agents/runtime/wake-session.ts), and [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts)
  - added coverage in [test/agent-config.test.ts](/test/agent-config.test.ts), [test/setup.test.ts](/test/setup.test.ts), and [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts)
- Verification:
  - `pnpm exec vitest run test/agent-config.test.ts test/setup.test.ts test/runtime-scheduler.test.ts test/wake-session.test.ts`
  - `pnpm exec tsc --noEmit`
  - live watch smoke on `activation-loop-030`
- Result:
  - wake-lease timing is now a declared runtime policy rather than hidden scheduler/storage magic
  - agent scaffolds, config loading, activation discovery, and wake execution all agree on the same policy surface

## Loop 031

- Goal: reload wake-lease policy when `agent.json` changes during the lifetime of a long-running orchestrator.
- Problem:
  - Loop 030 introduced a wake-lease policy cache in [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts)
  - without invalidation, a running worker would keep using stale lease timings until restart even if the agent runtime config changed on disk
- Structural fix:
  - exported `agentConfigPath(...)` from [src/agents/agent-config.ts](/src/agents/agent-config.ts) so config-path resolution stays canonical
  - changed the orchestrator wake-lease cache to be mtime-aware instead of eternal
  - on each policy lookup, the orchestrator now compares the current `agent.json` `mtimeMs` against the cached value and reloads only when the file changed
  - added a regression in [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) proving the same `AgentOrchestration` instance picks up a tighter `wakeLease` policy after `agent.json` is rewritten
- Verification:
  - `pnpm exec vitest run test/agent-config.test.ts test/setup.test.ts test/runtime-scheduler.test.ts test/wake-session.test.ts`
  - `pnpm exec tsc --noEmit`
- Result:
  - runtime policy updates no longer require worker restart to affect wake-lease behavior
  - the cache still avoids unnecessary reloads when the config file is unchanged

## Loop 032

- Goal: remove per-session wake-lock reads from the activation hot path by indexing active wake leases at the agent runtime layer.
- Problem:
  - after Loop 027, activation discovery still called `hasActiveWakeLease(...)` once per runnable or due-wake session
  - that reintroduced per-session filesystem reads on the hot path and left lease release invisible to watch-mode wakeups unless the generic poll timeout expired
- Structural fix:
  - added an `active-wake-leases.json` runtime index in [src/agents/sessions/session-store.ts](/src/agents/sessions/session-store.ts)
  - `acquireWakeLease(...)`, `renew()`, and `release()` now update that index alongside the lock file
  - added `listActiveWakeLeaseSessionIds(...)` with stale-entry cleanup so activation discovery can fetch the active lease set once per cycle
  - updated [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts) to:
    - load the leased-session set once
    - filter immediate and delayed activations through that set instead of per-session lock-file probes
    - wake `waitForChange(...)` on `active-wake-leases*` index mutations
  - extended [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) so the leased-session activation test now asserts index usage instead of `hasActiveWakeLease(...)`, and added a `waitForChange(...)` regression for active-lease index updates
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/wake-session.test.ts`
  - `pnpm exec tsc --noEmit`
  - live watch smoke re-run on `activation-loop-030` confirmed the pending session still executed normally after the index refactor
- Result:
  - activation discovery is back to agent-level index reads on the hot path
  - active lease acquire/release now participates in the same watch wakeup surface as runnable-session and pending-wake updates

## Loop 033

- Goal: remove the second delayed-session journal reopen from activation discovery.
- Problem:
  - even after the earlier delayed-index cleanups, the scheduler still reopened each due session twice:
    - once in [src/agents/runtime/session-wake-queue.ts](/src/agents/runtime/session-wake-queue.ts) to confirm the indexed wake was still due
    - again in [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts) to fetch the due wakes for the activation payload
  - that left unnecessary duplicated filesystem I/O on the delayed hot path
- Structural fix:
  - added `listDueSessionWakes(agentId, at)` to [src/agents/runtime/session-wake-queue.ts](/src/agents/runtime/session-wake-queue.ts)
  - the queue now confirms/repairs due indexed sessions and builds the due-wake batch in the same journal read
  - `listSessionIdsWithDueWakes(...)` now delegates to that richer batch method instead of being the primary delayed discovery entrypoint
- Verification:
  - `pnpm exec vitest run test/activation-queue.test.ts test/runtime-scheduler.test.ts`
  - `pnpm exec tsc --noEmit`
- Result:
  - delayed discovery now has a single source of truth for “which sessions are due and which wakes belong to them”
  - the queue layer, not the activation layer, owns the due-batch construction

## Loop 034

- Goal: switch delayed activation discovery to the new due-session batch API and prove the second reopen is gone.
- Problem:
  - after Loop 033, the queue could already return due batches, but the activation queue still had to be updated to consume them directly
  - without that follow-through, the new queue API would exist but the scheduler hot path would not actually improve
- Structural fix:
  - updated [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts) so delayed activations now come straight from `listDueSessionWakes(...)`
  - removed the follow-up `listPendingForAgentSession(...)` reopen from delayed activation construction
  - updated [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) so the delayed activation regression now asserts:
    - `listDueSessionWakes(...)` is called
    - `listSessionIdsWithDueWakes(...)` is not called
    - `listPendingForAgentSession(...)` is not called
  - updated [test/activation-queue.test.ts](/test/activation-queue.test.ts) so it verifies the queue returns rich due-session batches, not just session ids
- Verification:
  - `pnpm exec vitest run test/activation-queue.test.ts test/runtime-scheduler.test.ts`
  - `pnpm exec tsc --noEmit`
  - live watch smoke on `activation-loop-030` confirmed the pending `AGENTS.md` read request was consumed successfully and produced the expected tool-backed response
- Result:
  - the delayed scheduler path no longer pays a second per-session reopen to build its activation payload
  - the activation queue is now a pure consumer of queue-provided due batches instead of reconstructing them itself

## Loop 035

- Goal: make approval-required turns explicit in `orchestrator --watch` output instead of forcing operators to infer them from raw events.
- Problem:
  - the runtime already preserved pending tool confirmation requests in session state, but watch-mode activity output only showed a generic response preview
  - operators still had to inspect `session status` or raw event logs to discover the request id, tool name, and confirmation command
- Structural fix:
  - extended [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts) activity payloads with `pendingToolConfirmation`
  - updated [src/index.ts](/src/index.ts) so `orchestrator --watch` now prints:
    - `approvalRequired: true`
    - `pendingTool`
    - `pendingToolRequestId`
    - `pendingToolPermission`
    - ready-to-copy `confirmAllow` / `confirmDeny` CLI commands
  - added CLI coverage in [test/index.test.ts](/test/index.test.ts)
- Verification:
  - `pnpm exec vitest run test/index.test.ts test/runtime-scheduler.test.ts`
  - `pnpm exec tsc --noEmit`
- Result:
  - approval-gated turns are now visible as first-class runtime state in watch mode
  - the operator no longer has to reconstruct confirmation commands by hand

## Loop 036

- Goal: surface non-executed manual wake reasons directly in the CLI output.
- Problem:
  - `openboa agent wake --session ...` already knew whether a no-op wake was idle, lease-contended, or something else through `skippedReason`
  - the CLI discarded that detail and only printed the session status/stop reason, which weakened manual recovery debugging
- Structural fix:
  - updated [src/index.ts](/src/index.ts) so manual `wake: no-op` output now includes `skippedReason`
  - added CLI regression coverage in [test/index.test.ts](/test/index.test.ts)
- Verification:
  - `pnpm exec vitest run test/index.test.ts`
  - `pnpm exec tsc --noEmit`
- Result:
  - manual wake diagnostics now preserve the scheduler’s exact reason for not executing
  - lease contention is visible without needing raw session event inspection

## Loop 037

- Goal: expose full approval detail in `session status`, not just the tool name and request id.
- Problem:
  - `session status` surfaced that a tool confirmation was pending, but it still hid the confirmation policy and request timestamp
  - this made it harder to correlate a pending approval with the corresponding runtime event or decide whether it was stale
- Structural fix:
  - extended [src/index.ts](/src/index.ts) `runAgentSessionStatus(...)` output with:
    - `pendingToolPermission`
    - `pendingToolRequestedAt`
  - added a focused CLI regression in [test/index.test.ts](/test/index.test.ts) that injects a pending confirmation request into `session.json` and verifies the new status lines
- Verification:
  - `pnpm exec vitest run test/index.test.ts`
  - `pnpm exec tsc --noEmit`
- Result:
  - approval state is now inspectable from both:
    - long-running watch output
    - direct `session status`
  - runtime approval debugging is materially shorter and less guessy

## Loop 038

- Goal: close the `watch` race where a session can already be runnable when the worker arms its wait path, but no new filesystem change arrives afterward.
- Problem:
  - live repros showed a worker could stay asleep until timeout even though:
    - `session status` was already `rescheduling`
    - `runnable-sessions.json` already contained the session
    - a direct activation-queue probe would have returned a ready activation
  - the blind window was between:
    - the orchestrator’s empty `listReadyActivations(...)` scan
    - `waitForChange(...)` arming its watchers
  - if the runnable state already existed by the time the wait arm completed, and no further index mutation happened, the worker had nothing left to wake it up except the next timeout
- Structural fix:
  - extended [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts) `waitForChange(...)` options with `wakeLeaseStaleAfterMs`
  - after watcher/subscription setup completes, `waitForChange(...)` now performs an immediate readiness probe via `listReadyActivations(...)`
  - updated [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts) so the worker passes the active wake-lease staleness policy into that readiness probe
  - added a regression to [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) proving `waitForChange(...)` resolves quickly when a runnable activation already exists before the wait path finishes arming
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts`
  - `pnpm exec tsc --noEmit`
  - live smoke on `activation-loop-038`:
    - restarted the worker against a session that was still `rescheduling`
    - observed immediate consumption on cycle 1 and a concrete response (`My name is activation-loop-038.`)
    - sent a new `AGENTS.md` read request while the worker stayed up and observed normal live consumption with a managed `read` tool call
- Result:
  - the wait path now rechecks readiness after it becomes observable, not only before
  - existing runnable work no longer depends on a second mutation or a full timeout to be noticed

## Loop 039

- Goal: make long-running manual runtime testing viable without repeatedly restarting `orchestrator --watch` between user messages and confirmation events.
- Problem:
  - approval-gated flows were correct, but a tester could still lose the active worker between:
    - the initial request
    - the confirmation command
  - because the worker stopped on idle timeout, the operator had to manually restart the watch process just to consume `user.tool_confirmation`
- Structural fix:
  - updated [src/index.ts](/src/index.ts) so `openboa agent orchestrator --watch --idle-timeout-ms 0` is interpreted as “no idle timeout”
  - normalized non-positive idle-timeout values through a dedicated helper instead of passing `0` through as a real timeout
  - updated CLI usage text to advertise `--idle-timeout-ms <n|0>`
  - added regression coverage in [test/index.test.ts](/test/index.test.ts) asserting:
    - watch output prints `idleTimeoutMs: none`
    - the orchestrator receives `idleTimeoutMs: undefined`
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/index.test.ts`
  - `pnpm exec tsc --noEmit`
  - live approval scenario on `activation-loop-038`:
    - requested `Add '- Happy' to SOUL.md.`
    - observed first-class approval state in `orchestrator --watch --log`
    - confirmed the request with `session confirm-tool`
    - resumed the worker and observed successful promotion
    - verified shared [SOUL.md](/.openboa/agents/activation-loop-038/workspace/SOUL.md) now includes `- Happy`
  - live no-timeout watch smoke:
    - ran `orchestrator --watch --idle-timeout-ms 0`
    - appended `What is your name now?`
    - observed live activity and response without the worker stopping itself
- Result:
  - manual scenario testing no longer requires arbitrary timeout tuning
  - approval-gated and multi-step live sessions can now stay attached to a single watch process until the operator interrupts it

## Loop 040

- Goal: verify the confirmation-deny path in the real runtime, not just the approval-success path.
- Scenario:
  - reused live agent `activation-loop-038`
  - kept a no-timeout watch worker attached
  - sent `Add '- Excited' to SOUL.md.`
  - observed first-class `requires_action` output for `resources_promote_to_substrate`
  - denied the request with `pnpm openboa agent session confirm-tool --allowed false`
- Verification:
  - live watch output showed:
    - `input[1]: user.tool_confirmation ... allowed=false`
    - response preview: `Understood. Promotion was denied...`
    - final `stopReason: idle`
  - shared [SOUL.md](/.openboa/agents/activation-loop-038/workspace/SOUL.md) remained unchanged except for the previously approved `- Happy` line; no `- Excited` line was added
  - final `session status` returned to `idle` with `pendingEvents: 0`
- Result:
  - deny semantics are correct in the live runtime:
    - staged work may exist in the session hand
    - shared substrate is not mutated when promotion is denied
  - this loop did not require a code change; it closed a real capability scenario against the current runtime

## Loop 041

- Goal: make `orchestrator --watch --idle-timeout-ms 0` interrupt cleanly instead of bubbling an `ELIFECYCLE 130` shell error.
- Problem:
  - after Loop 039, no-timeout watch mode was useful, but stopping it with `Ctrl-C` still exited through the shell’s default signal path
  - that produced noisy `^C` / lifecycle error output even though the operator was performing an expected stop action
- Structural fix:
  - updated [src/index.ts](/src/index.ts) so watch mode now:
    - creates an `AbortController`
    - registers `SIGINT` and `SIGTERM` handlers
    - passes the signal into `runAgentLoop(...)`
    - tears down the signal handlers after the loop returns
  - kept the behavior local to watch mode so one-shot CLI commands remain unchanged
  - added CLI regression coverage in [test/index.test.ts](/test/index.test.ts) to assert a mocked `SIGINT` produces `stopReason: interrupted`
- Verification:
  - `pnpm exec vitest run test/index.test.ts`
  - `pnpm exec tsc --noEmit`
  - live smoke:
    - ran `pnpm openboa agent orchestrator --agent activation-loop-038 --watch --log --poll-interval-ms 200 --idle-timeout-ms 0`
    - sent `Ctrl-C`
    - observed clean exit:
      - `orchestrator: stopped`
      - `stopReason: interrupted`
      - process exit code `0`
- Result:
  - no-timeout watch mode is now usable as a long-lived operator console
  - interrupting the worker is treated as a normal runtime stop, not as a shell failure

## Loop 042

- Goal: make delayed user requests map more reliably onto explicit queued wakes instead of depending on implicit timing or manual restarts.
- Problem:
  - earlier delayed-reminder probing showed ambiguous behavior:
    - a later answer was observed
    - but the session wake journal did not prove that a queued wake had actually been scheduled
  - the harness guidance only said “If the session should be revisited later, request queuedWakes,” which was weaker than the concrete user intent of “remind me in N seconds”
- Structural fix:
  - tightened [src/agents/runtime/loop-directive.ts](/src/agents/runtime/loop-directive.ts) with an explicit rule:
    - if the user asks for a reminder, follow-up, or revisit after a delay, emit `queuedWakes`
  - added prompt regression coverage in [test/system-prompt-structure.test.ts](/test/system-prompt-structure.test.ts)
- Verification:
  - `pnpm exec vitest run test/system-prompt-structure.test.ts test/index.test.ts`
  - `pnpm exec tsc --noEmit`
  - live queued-wake scenario on fresh session `019d7f8f-bacf-722b-a41c-00ba97b10337`:
    - sent `In 2 seconds, tell me your name again without waiting for another user message.`
    - first activity showed:
      - `stopReason: rescheduling`
      - `queuedWakes: 1`
      - summary: the immediate wake answered now and scheduled a follow-up in 2 seconds
    - second activity showed:
      - `input[1]: queued_wake: Repeat agent name as requested (...)`
      - `responsePreview: My name is activation-loop-038.`
      - final `stopReason: idle`
- Result:
  - delayed follow-up intent is now explicitly modeled as a scheduling behavior in the prompt contract
  - queued wakes are proven working in the live runtime, not just in tests or synthetic scheduler fixtures

## Loop 043

- Goal: make proactive scheduling visible in `orchestrator --watch --log` without forcing operators to inspect raw wake journals.
- Problem:
  - after Loop 042, queued wakes were working, but watch mode only showed:
    - `queuedWakes: <count>`
  - that was enough to prove “something was scheduled,” but not enough to answer:
    - when is it due?
    - why was it scheduled?
    - which priority did it use?
- Structural fix:
  - extended [src/agents/runtime/wake-session.ts](/src/agents/runtime/wake-session.ts) with `WakeSummary`
  - `wakeSessionOnce(...)` now returns both:
    - `queuedWakeIds`
    - `queuedWakeSummaries` containing `id`, `dueAt`, `reason`, `note`, and `priority`
  - extended [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts) activity payloads with those summaries
  - updated [src/index.ts](/src/index.ts) watch output to print one line per queued wake:
    - `queuedWake[n]: dueAt=... priority=... reason=... note=...`
  - expanded [test/index.test.ts](/test/index.test.ts) so watch-mode CLI output asserts the new queued-wake detail line
- Verification:
  - `pnpm exec vitest run test/index.test.ts test/runtime-scheduler.test.ts`
  - `pnpm exec tsc --noEmit`
  - live proactive scenario on fresh session `019d7f92-96bd-718c-8f42-1a564a666a95`:
    - sent `In 2 seconds, tell me your name again without waiting for another user message.`
    - first watch activity showed:
      - `queuedWakes: 1`
      - `queuedWake[1]: dueAt=... priority=normal reason=Repeat my name after the requested delay note=Tell the user my name again without waiting for another user message.`
    - second watch activity showed the resulting `queued_wake: ...` input being consumed and completed
- Result:
  - proactive scheduling is now visible at the same level as input events, tool calls, and approval pauses
  - operators can understand what future work was scheduled without leaving the watch console
## Loop 044

- Goal: make custom-tool pause state visible and actionable from the public CLI and watch console.
- Problem:
  - watch mode surfaced approval pauses, but custom tool pauses only showed a generic requires_action state.
  - `session status` exposed only `pendingCustomTool: <name>` with no request id, input payload, or copyable follow-up command.
  - there was no first-class CLI ingress for `user.custom_tool_result`, so live roundtrips required raw file/event manipulation instead of the canonical session CLI.
- Structural fix:
  - extended [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts) activity payloads with `pendingCustomTool`.
  - extended [src/index.ts](/src/index.ts) to:
    - print `pendingCustomToolRequestId`, `pendingCustomToolRequestedAt`, and `pendingCustomToolInput` in `agent session status`
    - print `customToolRequired: true` plus a copyable `custom-tool-result` command in `orchestrator --watch` output
    - add `openboa agent session custom-tool-result --session ... --request ... --output ...` as the canonical CLI ingress for `user.custom_tool_result`
    - include custom tool request input and custom tool result output in `agent session events` rendering
  - added CLI regressions in [test/index.test.ts](/test/index.test.ts) for:
    - pending custom tool status visibility
    - custom tool result event append
    - watch-mode custom tool instructions
- Verification:
  - `pnpm exec vitest run test/index.test.ts test/agent-runtime.test.ts -t "custom tool|pending custom tool|watch activity"`
  - `pnpm exec tsc --noEmit`
  - live session `019d7fa9-c6c6-7259-8aea-3f25f3a7da7c` on agent `activation-loop-044`:
    - watch output showed `customToolRequired: true`, request id, input payload, and a copyable `custom-tool-result` command
    - `pnpm openboa agent session status --session 019d7fa9-c6c6-7259-8aea-3f25f3a7da7c` showed the same details
    - `pnpm openboa agent session custom-tool-result --session 019d7fa9-c6c6-7259-8aea-3f25f3a7da7c --request 019d7faa-5aed-70b6-a7a0-e7c3bd7886a9 --output "spec contents from live roundtrip"` appended the canonical `user.custom_tool_result` event
- Result:
  - custom-tool pauses are now as inspectable and operable as approval pauses from the public CLI surface.
  - live runtime no longer requires ad hoc event injection to resume a custom-tool-blocked session.

## Loop 045

- Goal: verify that the new custom-tool result CLI path works end to end with actual returned content, not just a placeholder string.
- Problem:
  - Loop 044 proved that custom-tool pauses were visible and operable, but the first live result payload was only a placeholder string (`spec contents from live roundtrip`).
  - that did not prove the model could actually consume and summarize real returned content through the resumed session wake.
- Live scenario:
  - kept the existing no-timeout worker running:
    - `pnpm openboa agent orchestrator --agent activation-loop-044 --watch --log --poll-interval-ms 200 --idle-timeout-ms 0`
  - created fresh session `019d7fac-ad64-70de-9bbf-5ddbd13a8c85`
  - sent:
    - `Do not answer directly. Pause and request a custom tool result named fetch_spec with input {"path":"spec.md"}.`
  - observed live custom-tool pause with request id `019d7fad-15ce-7069-93e3-1c0607a43991`
  - submitted actual spec text through the new CLI path:
    - `pnpm openboa agent session custom-tool-result --session 019d7fac-ad64-70de-9bbf-5ddbd13a8c85 --request 019d7fad-15ce-7069-93e3-1c0607a43991 --output "# Spec
- Title: Activation Queue
- Goal: Execute ready work without scanning every session
- Constraints: Respect leases and surface approval pauses clearly"`
- Verification:
  - watch output showed resumed input:
    - `input[1]: user.custom_tool_result: fetch_spec request=019d7fad-15ce-7069-93e3-1c0607a43991 output=# Spec...`
  - watch output showed grounded answer:
    - `Spec received.`
    - `- Title: Activation Queue`
    - `- Goal: Execute ready work without scanning every session`
    - `- Constraints: Respect leases / Surface approval pauses clearly`
  - `pnpm openboa agent session events --session 019d7fac-ad64-70de-9bbf-5ddbd13a8c85 --limit 20` showed the full `user.custom_tool_result` event and the grounded `agent.message`
  - `pnpm openboa agent session status --session 019d7fac-ad64-70de-9bbf-5ddbd13a8c85` ended at:
    - `status: idle`
    - `stopReason: idle`
    - `pendingEvents: 0`
- Result:
  - custom-tool roundtrip is now proven end to end in the live Codex-backed runtime:
    - request custom tool
    - surface request id and input
    - submit result through canonical CLI
    - resume automatically through watch worker
    - consume actual returned content and answer from it

## Loop 046

- Goal: make blocked sessions surface `requires_action` as a first-class session status instead of showing `status: idle` with only `stopReason: requires_action`.
- Problem:
  - live approval and custom-tool pauses were structurally blocked, but the public CLI still reported `status: idle` for those sessions.
  - that made operator-facing state inconsistent: a blocked session looked quiescent unless the user also inspected `stopReason`.
- Structural fix:
  - extended [src/agents/schema/runtime.ts](/src/agents/schema/runtime.ts) with `SessionStatus = "requires_action"`.
  - updated [src/agents/runtime/harness.ts](/src/agents/runtime/harness.ts) so:
    - confirmation-gated tool pauses set `session.status = "requires_action"`
    - custom-tool pauses also set `session.status = "requires_action"`
  - updated [src/agents/tools/managed-runtime-tools.ts](/src/agents/tools/managed-runtime-tools.ts) to accept and filter `requires_action` in session-listing tool schemas and status filters.
  - updated blocked-session regressions in [test/agent-runtime.test.ts](/test/agent-runtime.test.ts) to use the new canonical status.
- Verification:
  - `pnpm exec vitest run test/index.test.ts test/agent-runtime.test.ts -t "requires-action|pending custom tool|custom tool|pending tool confirmation"`
  - `pnpm exec tsc --noEmit`
- Result:
  - blocked sessions now have a first-class lifecycle status that matches their actual operator posture.
  - public session status, watch output, and same-agent session filtering can distinguish idle sessions from action-blocked sessions without relying on `stopReason` alone.

- Live note: the first requires_action status check after Loop 046 still showed `status: idle` because the long-running `activation-loop-044` worker was an old process started before the patch. Restarted the worker before re-running the live check.

- Live verification: after restarting the worker with the new code, fresh session `019d7fb6-2496-755b-a833-2fdfc539dba2` now reports `status: requires_action` and emits `session.status_changed running->requires_action` during the custom-tool pause.

## Loop 047

- Goal: rerun the full live 100-scenario batch after Loops 044–046 to verify the current runtime surface stays clean across the whole catalog.
- Live batch:
  - `pnpm openboa agent scenario-loop --agent activation-loop-047 --count 100 --output /tmp/activation_loop_047.md --model-timeout-ms 45000`
- Result:
  - executed: `100`
  - passed: `100`
  - failed: `0`
- Coverage confirmed in the live Codex-backed runtime:
  - bootstrap quote scenarios
  - introspection scenarios
  - managed tool surface scenarios
  - continuity scenarios
  - watch-consumer scenarios
  - scratch write allow/deny scenarios
  - bootstrap promotion and readback scenarios
- Outcome:
  - after the custom-tool visibility work and the requires_action status fix, the full existing scenario catalog is again green on a fresh agent.
  - the next structural gap is not current catalog failure; it is catalog coverage. The scenario loop should now absorb the newer custom-tool and delayed-wake paths so the 100-scenario baseline includes those capabilities by default.

## Loop 048

- Goal: replace duplicate readback scenarios with real baseline coverage for custom-tool roundtrip and delayed queued-wake consumption.
- Problem:
  - the last four baseline scenarios were redundant readbacks:
    - `SOUL.md` marker readback twice
    - `IDENTITY.md` marker readback twice
  - that left the baseline 100 green but under-represented two runtime capabilities that now exist live:
    - custom-tool pause/resume
    - delayed queued-wake consumption in watch mode
- Structural fix:
  - updated [src/agents/runtime/scenario-loop.ts](/src/agents/runtime/scenario-loop.ts) to:
    - add `ScenarioContext.emitCustomToolResult(...)`
    - add `ScenarioContext.enqueueDelayedWake(...)`
    - add `customToolRoundtripScenario(...)`
    - add `delayedWakeScenario(...)`
    - reduce duplicated readback targets from four to two
    - replace the freed slots with:
      - `099 Complete a custom tool roundtrip`
      - `100 Consume a delayed queued wake in watch mode`
  - kept the baseline size fixed at exactly `100` scenarios.
- Verification:
  - `pnpm exec tsc --noEmit`
  - `pnpm exec vitest run test/index.test.ts -t "scenario-loop"`
  - live batch:
    - `pnpm openboa agent scenario-loop --agent activation-loop-048 --count 100 --output /tmp/activation_loop_048.md --model-timeout-ms 45000`
- Live result:
  - scenarios `001`–`099` passed
  - scenario `100` failed:
    - `Expected delayed wake response to include delayed-wake-token-01, received: No new work is pending.`
- Root cause:
  - the first delayed-wake scenario assumed that a dormant session with only a prior user instruction would continue meaningful work on a later queued wake.
  - live events for session `019d7fd1-713a-7617-8383-a8694f22c6ed` showed the opposite:
    - the delayed wake was consumed
    - the wake summary was `Wake reason=session.revisit note=delayed-wake-token-01`
    - but the model replied `No new work is pending.`
  - this was not a runtime scheduling failure. It was a scenario design mismatch: delayed revisits in this runtime are meaningful when they continue an active bounded objective, not when they revive a context-less dormant instruction.
- Outcome:
  - baseline coverage was widened successfully.
  - one new scenario exposed a contract mismatch in the scenario itself, not in the queue or watch worker.

## Loop 049

- Goal: realign the new baseline scenarios with the runtime's actual contract and rerun the full 100-scenario batch.
- Problem:
  - Loop 048 proved the delayed-wake scenario was too weakly anchored in session intent.
- Structural fix:
  - updated [src/agents/runtime/scenario-loop.ts](/src/agents/runtime/scenario-loop.ts) to:
    - define an explicit active outcome before the delayed wake
    - require the delayed revisit to satisfy that active outcome
    - wrap the new custom-tool and delayed-wake scenario functions in `ScenarioExecutionError` handling so failures preserve session id, stop reason, and previews in the scenario report
  - the delayed-wake scenario now verifies the intended contract:
    - acknowledge current turn with `scheduled`
    - keep a bounded active outcome alive
    - enqueue a delayed `session.revisit`
    - confirm that the watch worker consumes the delayed wake and answers against the active outcome
- Verification:
  - `pnpm exec tsc --noEmit`
  - `pnpm exec vitest run test/index.test.ts -t "scenario-loop"`
  - live batch:
    - `pnpm openboa agent scenario-loop --agent activation-loop-049 --count 100 --output /tmp/activation_loop_049.md --model-timeout-ms 45000`
- Live result:
  - scenario `100` now passed
  - scenario `099` failed:
    - `Expected custom tool response to include Respect leases, received: ...`
- Root cause:
  - live response content was correct and grounded in the custom tool result.
  - the only mismatch was scenario strictness:
    - expected token: `Respect leases`
    - actual response: `respect leases`
  - this was again a scenario contract issue, not a runtime or provider bug.
- Outcome:
  - the delayed-wake path is now validated live inside the baseline.
  - the remaining failure reduced to assertion strictness on the custom-tool scenario.

## Loop 050

- Goal: make the custom-tool baseline assertion semantic instead of case-fragile and recover the full 100/100 live batch.
- Problem:
  - Loop 049 showed the custom-tool roundtrip response was grounded and correct, but the scenario still failed on capitalization/formatting differences in one expected token.
- Structural fix:
  - updated [src/agents/runtime/scenario-loop.ts](/src/agents/runtime/scenario-loop.ts) so `customToolRoundtripScenario(...)` matches expected tokens case-insensitively.
  - kept the assertion semantic:
    - the response must still mention the expected grounded concepts
    - it no longer fails because of casing or bullet formatting
- Verification:
  - `pnpm exec tsc --noEmit`
  - `pnpm exec vitest run test/index.test.ts -t "scenario-loop"`
  - live batch:
    - `pnpm openboa agent scenario-loop --agent activation-loop-050 --count 100 --output /tmp/activation_loop_050.md --model-timeout-ms 45000`
- Live result:
  - executed: `100`
  - passed: `100`
  - failed: `0`
  - final scenarios:
    - `099 Complete a custom tool roundtrip` — pass
    - `100 Consume a delayed queued wake in watch mode` — pass
- Outcome:
  - the default 100-scenario live batch now covers:
    - bootstrap reads
    - introspection
    - managed tools
    - continuity
    - watch consumption
    - scratch write allow/deny
    - bootstrap promotion/readback
    - custom-tool roundtrip
    - delayed queued-wake consumption

## Loop 051

- Goal: make scenario reports retain the evidence that matters for the two newest baseline capabilities:
  - custom-tool usage
  - queued-wake consumed input
- Problem:
  - after Loop 050 the live runtime was green, but the scenario report still hid some of the most important evidence:
    - `collectToolNames(...)` ignored `agent.custom_tool_use`, so scenario `099` did not visibly record the custom tool request in `toolNames`
    - `ScenarioResult` did not retain `consumedInputs`, so scenario `100` did not persist the `queued_wake: ...` activation string in the markdown/json report
- Structural fix:
  - updated [src/agents/runtime/scenario-loop.ts](/src/agents/runtime/scenario-loop.ts) to:
    - extend `ScenarioResult` with `consumedInputs`
    - extend `WakeRunSummary` with `consumedInputs`
    - capture watch-mode consumed inputs through `runAgentLoop(..., { onActivity })`
    - render `Consumed Inputs` in the scenario markdown detail block
    - treat `agent.custom_tool_use` as first-class scenario evidence via `custom:<toolName>` entries in `toolNames`
- Verification:
  - `pnpm exec tsc --noEmit`
  - `pnpm exec vitest run test/index.test.ts -t "scenario-loop"`
- Outcome:
  - the scenario baseline remains behaviorally unchanged, but future reports now preserve the evidence that proves:
    - a custom tool was actually requested
    - a delayed queued wake was actually the consumed activation for the revisit

## Loop 052

- Goal: harden resume ingress at the session-store boundary so stale or duplicate approval/custom-tool events cannot be journaled during cross-process races.
- Problem:
  - `runAgentSessionConfirmTool(...)` and `runAgentSessionCustomToolResult(...)` already checked the current pending request at the CLI layer.
  - that was not enough for multi-process or provider-agnostic ingress:
    - another process could append the same resume event first
    - a stale client could still attempt to append the same `requestId` later
    - session mutations (`emitEvent`, `updateSession`, `markProcessed`) were not serialized against each other
- Structural fix:
  - updated [src/agents/sessions/session-store.ts](/src/agents/sessions/session-store.ts) to:
    - add a per-session mutation lock around `emitEvent(...)`, `markProcessed(...)`, and `updateSession(...)`
    - validate `user.tool_confirmation` against the current pending confirmation request inside that lock
    - validate `user.custom_tool_result` against the current pending custom tool request inside that lock
    - reject duplicate resume events for the same `requestId` if one is already in the journal
  - added [test/session-store.test.ts](/test/session-store.test.ts) to cover:
    - stale tool confirmation with no pending request
    - duplicate tool confirmations under concurrent ingress
    - stale custom tool result with mismatched request
    - duplicate custom tool results under concurrent ingress
- Verification:
  - `pnpm exec vitest run test/session-store.test.ts test/runtime-scheduler.test.ts test/index.test.ts -t "SessionStore resume ingress|scenario-loop|session orchestration"`
  - `pnpm exec tsc --noEmit`
  - live full batch:
    - `pnpm openboa agent scenario-loop --agent activation-loop-052 --count 100 --output /tmp/activation_loop_052.md --model-timeout-ms 45000`
- Live result:
  - full batch remained green:
    - executed: `100`
    - passed: `100`
    - failed: `0`
  - confirmed report evidence still includes:
    - scenario `099` custom tool usage via `custom:fetch_spec`
    - scenario `100` delayed wake consumed input via `queued_wake: session.revisit (...)`
- Focused live race probes:
  - approval duplicate ingress:
    - created agent `activation-dup-052`
    - drove `SOUL.md` promotion to a real `requires_action` pause on `resources_promote_to_substrate`
    - sent two `confirm-tool` commands for the same `requestId`
    - first append succeeded
    - second command failed and no second confirmation event was journaled
    - worker resumed and promoted `- RaceProbe` into shared [SOUL.md](/.openboa/agents/activation-dup-052/workspace/SOUL.md)
  - custom tool duplicate ingress:
    - drove a real custom tool pause on `fetch_spec`
    - sent two `custom-tool-result` commands for the same `requestId`
    - first append succeeded
    - second command failed and no duplicate custom-tool-result event was journaled
    - worker resumed and summarized the first result only
- Outcome:
  - resume ingress is now protected at the canonical storage boundary instead of relying on CLI-local checks
  - duplicate/stale approval and custom-tool responses no longer pollute the journal
  - the live Codex-backed runtime still passes the full 100-scenario batch after the race fix

## Loop 053

- Goal: prove the new session mutation lock prevents lost updates when a state mutation and a new inbound event hit the same session at the same time.
- Problem:
  - once `emitEvent(...)` and `updateSession(...)` were both wrapped in the same lock, the remaining question was whether we could still lose fields under concurrent mutation, especially metadata or runnable-state updates.
- Structural fix:
  - extended [test/session-store.test.ts](/test/session-store.test.ts) with a concurrent `Promise.all([...])` case that runs:
    - `updateSession(...)` to set `metadata.lastModel = "race-model"`
    - `emitEvent(...)` to append a new `user.message`
  - asserted that the final session preserves both:
    - the metadata mutation
    - the runnable state / pending event / runnable-session index entry
- Verification:
  - `pnpm exec vitest run test/session-store.test.ts`
  - `pnpm exec tsc --noEmit`
- Outcome:
  - the session mutation lock now has a direct lost-update regression
  - concurrent session metadata updates and inbound user events preserve both sides of state instead of whichever write lands last

## Loop 054

- Goal: verify precedence when a blocked session receives both a tool confirmation and a user interrupt before the next wake.
- Problem:
  - after Loop 052, stale/duplicate resume ingress was blocked at the store boundary.
  - the next race question was precedence:
    - if a valid `user.tool_confirmation` is already pending
    - and then the user interrupts before the next wake
    - does the runtime still honor the stale approval, or does the interrupt cancel the blocked path?
- Structural fix:
  - added a focused regression to [test/agent-runtime.test.ts](/test/agent-runtime.test.ts) that:
    - starts from `requires_action`
    - appends a valid `user.tool_confirmation`
    - appends a later `user.interrupt`
    - appends a follow-up `user.message`
    - verifies the runner sees the interrupt cue and does not see a still-open pending confirmation
- Verification:
  - `pnpm exec vitest run test/agent-runtime.test.ts -t "interrupt override|clears pending blocked state when a user interrupt arrives before the next wake"`
  - `pnpm exec tsc --noEmit`
- Outcome:
  - current precedence is correct:
    - `interrupt` wins
    - the blocked request is cleared before the next run
    - the old confirmation event is processed as stale context, not as an active approval

## Loop 055

- Goal: verify that the new session mutation lock also protects the runnable-session index when old work is marked processed at the same time new work arrives.
- Problem:
  - `markProcessed(...)` refreshes the runnable-session index from the journal.
  - without serialization, a concurrent new `user.message` could arrive while the old event was being marked processed, and the final index refresh could incorrectly clear the session from the runnable set.
- Structural fix:
  - extended [test/session-store.test.ts](/test/session-store.test.ts) with a concurrent `Promise.all([...])` case that runs:
    - `markProcessed(session.id, ["event-old"], ...)`
    - `emitEvent(session.id, user.message "event-new")`
  - asserted that the final state preserves:
    - `event-old` processed
    - `event-new` still pending
    - the runnable-session index still containing the session
    - session status `rescheduling`
- Verification:
  - `pnpm exec vitest run test/session-store.test.ts -t "markProcessed races with a new inbound event|serializes updateSession and emitEvent"`
  - `pnpm exec tsc --noEmit`
- Outcome:
  - the session mutation lock now covers the hot activation-consumer race where old work is acked while new work arrives
  - the worker will keep seeing the session as runnable instead of accidentally dropping it from the activation surface

## Loop 056

- Goal: make retryable provider failures resume as deferred work instead of collapsing into idle, and prove the new backoff semantics do not regress the live 100-scenario batch.
- Problem:
  - `handleRunFailure(...)` still forced every runner/provider failure into:
    - session status `idle`
    - stop reason `idle`
    - no queued retry wake
  - this was wrong for transient provider failures such as `model_timeout` and `model_http_error`.
  - live runs had already shown the practical consequence:
    - a bounded write flow could stage/edit/compare
    - then end in a transient model timeout
    - and the runtime would forget that there was still deferred work to continue.
- Structural fix:
  - updated [src/agents/runtime/harness.ts](/src/agents/runtime/harness.ts) so retryable provider failures now split into two paths:
    - if pending user-side events still exist, the session moves back to `rescheduling` and the runnable-session index gets a `deferUntil` backoff
    - if the failure happened while consuming a queued wake and there are no pending events, the runtime emits a short retry queued wake instead of dropping to idle
  - added `buildRecoverableRetryWake(...)` so retry wakes are explicit, dedupable, and carry the original wake reason plus retry context
  - aligned [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts) with this by comparing `deferUntil` against the same reference time used for activation discovery instead of raw `Date.now()`
  - aligned [src/agents/schema/runtime.ts](/src/agents/schema/runtime.ts) so `HarnessRunResult.queuedWakes` matches the resolved queued-wake shape used by runtime memory and wake enqueue paths
- Regression coverage:
  - added a harness-level retryable-failure regression to [test/agent-runtime.test.ts](/test/agent-runtime.test.ts)
    - pending `user.message`
    - runner throws `{ code: "model_timeout" }`
    - expect session `rescheduling`, checkpoint outcome `continue`, and runnable index `deferUntil`
  - added activation/backoff regressions to [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts)
    - deferred immediate activations stay hidden before `deferUntil` and become visible after it
    - queued-wake-only retryable failure re-enqueues a short retry wake instead of idling out
- Verification:
  - `pnpm exec vitest run test/agent-runtime.test.ts test/runtime-scheduler.test.ts`
  - `pnpm exec tsc --noEmit`
  - live batch:
    - `pnpm openboa agent scenario-loop --agent activation-loop-056 --count 100 --output /tmp/activation_loop_056.md --model-timeout-ms 45000`
    - result: `100/100` pass
    - artifacts:
      - [/tmp/activation_loop_056.md](/tmp/activation_loop_056.md)
      - [/tmp/activation_loop_056.md.json](/tmp/activation_loop_056.md.json)
- Outcome:
  - transient provider failures now preserve deferred work instead of flattening it into idle
  - activation discovery now has deterministic `deferUntil` semantics
  - the live Codex-backed 100-scenario baseline remained green after the retry/backoff change

## Loop 057

- Goal: make staged shared-substrate drafts resumable across retries instead of failing on a second stage attempt after partial side effects.
- Problem:
  - `resources_stage_from_substrate` behaved like a one-shot copy.
  - if a run staged `/workspace/agent/SOUL.md` into `/workspace/drafts/SOUL.md`, edited the draft, then timed out before compare/promote, the next wake could issue the same stage call again and hit:
    - `already exists in the session workspace; pass overwrite=true to replace it`
  - this meant partial progress was not resumable even when the existing target file was clearly the same staged working copy.
- Structural fix:
  - added a staged-substrate manifest under `/workspace/.openboa-runtime/staged-substrate.json` in [src/agents/resources/resource-access.ts](/src/agents/resources/resource-access.ts)
  - `stageSubstrateArtifactToSessionWorkspace(...)` now records:
    - substrate source path
    - target path
    - content hashes
  - when the same substrate source is staged to the same target again with `overwrite=false`, the runtime now:
    - reuses the existing staged draft
    - reports whether the draft diverged from the current substrate content
    - keeps rejecting unrelated pre-existing files that were never staged from that source
  - surfaced the new semantics through [src/agents/tools/managed-runtime-tools.ts](/src/agents/tools/managed-runtime-tools.ts) with:
    - `reusedExisting`
    - `divergedFromSource`
    - `sourceContentHash`
    - `targetContentHash`
- Regression coverage:
  - added focused regressions to [test/resource-access.test.ts](/test/resource-access.test.ts)
    - same-source retry reuses the staged draft and reports divergence
    - unrelated existing target still fails without `overwrite=true`
- Verification:
  - `pnpm exec vitest run test/resource-access.test.ts test/runtime-scheduler.test.ts`
  - `pnpm exec tsc --noEmit`
  - live probe, no divergence:
    - agent `runtime-artifact-probe-057`
    - session `019d8059-67b4-7139-9527-9950f4b0e0e4`
    - second stage reported `reused existing draft: yes`, `diverged: no`
  - live probe, with divergence:
    - agent `runtime-artifact-probe-057`
    - session `019d805a-7a61-731e-9345-42217affad76`
    - staged `SOUL.md`, appended `- Stage-Diverged`, staged again, and the second stage reported `reused existing draft: yes`, `diverged: yes`
  - full live batch after the change:
    - `pnpm openboa agent scenario-loop --agent activation-loop-057 --count 100 --output /tmp/activation_loop_057.md --model-timeout-ms 45000`
    - result: `99/100` pass
    - remaining failure: scenario `038` runtime artifact mount introspection returned `/workspace`
- Outcome:
  - staged shared-substrate files now behave like durable session-local working drafts
  - retry/resume no longer depends on blindly restaging or overwriting the draft
  - the only remaining post-change regression was an introspection ambiguity unrelated to the draft manifest itself

## Loop 058

- Goal: remove the `/runtime` vs `/workspace/.openboa-runtime` ambiguity from runtime introspection and restore the live `100/100` baseline after Loop 057.
- Problem:
  - scenario `038` asked where runtime artifacts were materialized.
  - the runtime exposes both:
    - `/runtime` as the mounted session runtime state
    - `/workspace/.openboa-runtime` as a mirrored reread catalog inside the writable hand
  - the model sometimes answered `/workspace`, which showed the distinction was not stated sharply enough in the system guidance.
  - when this assertion failed, the scenario report also dropped the actual response preview, which made diagnosis slower.
- Structural fix:
  - clarified the runtime contract in [src/agents/runtime/loop-directive.ts](/src/agents/runtime/loop-directive.ts):
    - `/runtime` is the primary mounted session runtime state
    - `/workspace/.openboa-runtime` is only a mirrored reread catalog, not a replacement mount
  - mirrored the same distinction in the session runtime guide generated by [src/agents/resources/default-resources.ts](/src/agents/resources/default-resources.ts)
  - tightened scenario `038` in [src/agents/runtime/scenario-loop.ts](/src/agents/runtime/scenario-loop.ts) so it explicitly asks for the exact runtime mount path and explicitly excludes `/workspace` and `/workspace/.openboa-runtime`
  - wrapped introspection scenarios in `ScenarioExecutionError` so failing introspection runs now preserve the actual response preview in the report instead of dropping it to `none`
- Regression coverage:
  - `pnpm exec vitest run test/loop-directive.test.ts test/system-prompt-structure.test.ts test/index.test.ts -t "buildHarnessSystemPromptAppendix|agent system prompt structure|scenario-loop"`
  - `pnpm exec tsc --noEmit`
- Live verification:
  - fresh probe session:
    - agent `runtime-artifact-probe-057`
    - session `019d806d-47ef-733f-86e9-52cdbcc48f62`
    - prompt: `Which exact mount path is reserved for session runtime artifacts and continuity state? ...`
    - response: `/runtime`
  - full live batch:
    - `pnpm openboa agent scenario-loop --agent activation-loop-058 --count 100 --output /tmp/activation_loop_058.md --model-timeout-ms 45000`
    - result: `100/100` pass
    - artifacts:
      - [/tmp/activation_loop_058.md](/tmp/activation_loop_058.md)
      - [/tmp/activation_loop_058.md.json](/tmp/activation_loop_058.md.json)
- Outcome:
  - the runtime mount contract is now explicit enough that the live model answers `/runtime` consistently
  - introspection failure reports keep the real response preview for future debugging
  - the live Codex-backed baseline is back to `100/100`

## Loop 059

- Goal: make the activation consumer re-evaluate readiness between executions instead of draining one stale snapshot per cycle.
- Problem:
  - `runAgentLoop(...)` previously took one `listReadyActivations(...)` snapshot at the start of a cycle and drained it in order.
  - if the first executed activation caused a different session to become newly ready with higher priority, the orchestrator still finished the old snapshot first and only noticed the new work on the next cycle.
  - this was functionally acceptable, but it was the wrong scheduling shape for an event-consumer runtime because it delayed fresher higher-priority work behind older snapshot entries.
- Structural fix:
  - extended [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts) with `nextReadyActivation(...)`
    - keeps `listReadyActivations(...)` for bulk inspection
    - adds a queue-like single-item selector with `excludeSessionIds`
  - refactored [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts) so one cycle now:
    - asks the activation queue for the next ready activation
    - executes it
    - re-queries the queue
    - repeats until no more activations remain for that cycle
  - the cycle keeps an `attemptedSessionIds` set so the same session is not re-selected repeatedly within one bounded cycle, while still allowing newly ready work from other sessions to preempt the remaining backlog
- Regression coverage:
  - updated custom queue stubs in [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) to implement the new `nextReadyActivation(...)` contract
  - added a focused scheduler regression proving mid-cycle reprioritization:
    - cycle starts with `first` then `second`
    - after `first` executes, a new high-priority `third` activation appears
    - expected execution order becomes `first -> third -> second`
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts`
  - `pnpm exec tsc --noEmit`
  - full live batch:
    - `pnpm openboa agent scenario-loop --agent activation-loop-059 --count 100 --output /tmp/activation_loop_059.md --model-timeout-ms 45000`
    - result: `100/100` pass
    - artifacts:
      - [/tmp/activation_loop_059.md](/tmp/activation_loop_059.md)
      - [/tmp/activation_loop_059.md.json](/tmp/activation_loop_059.md.json)
- Outcome:
  - the orchestrator is now closer to a real activation consumer than a snapshot drainer
  - newly ready higher-priority work can be picked within the same cycle instead of waiting for the next one
  - the live Codex-backed 100-scenario baseline remained green after the scheduling change

## Loop 060

- Goal: promote activation ownership from implicit wake-side locking to an explicit activation lease/ack contract.
- Problem:
  - even after Loop 059, activation discovery and wake execution still split ownership awkwardly:
    - the activation queue decided what was ready
    - `wakeSessionOnce(...)` independently acquired the wake lease later
  - this meant activation ownership was still implicit, and the queue could not explicitly surface:
    - `leased`
    - `blocked`
    - `none`
  - structurally, that is the gap between a good scheduler and a real queue consumer.
- Structural fix:
  - extended [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts) with:
    - `LeasedSessionActivation`
    - `LeaseNextActivationResult`
    - `leaseNextActivation(...)`
  - `LocalSessionActivationQueue` now:
    - picks the next ready activation
    - acquires the session wake lease itself
    - returns one of:
      - `status: "leased"`
      - `status: "blocked"` with `reason: "lease_contended"`
      - `status: "none"`
  - refactored [src/agents/runtime/wake-session.ts](/src/agents/runtime/wake-session.ts) so `wakeSessionOnce(...)` can run under an externally leased activation instead of always owning lease acquisition itself
  - refactored [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts) to consume leased activations directly and treat contention as an activation-level outcome instead of a hidden wake-side side effect
- Regression coverage:
  - added a real lease contention + ack regression to [test/activation-queue.test.ts](/test/activation-queue.test.ts):
    - first lease succeeds
    - second worker sees `blocked`
    - `ack()` releases the activation lease
    - the next worker can lease again
  - updated queue stubs in [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) for the new contract
  - preserved the Loop 059 mid-cycle reprioritization regression under the leased activation flow
- Verification:
  - `pnpm exec vitest run test/activation-queue.test.ts test/runtime-scheduler.test.ts`
  - `pnpm exec tsc --noEmit`
  - full live batch:
    - `pnpm openboa agent scenario-loop --agent activation-loop-060 --count 100 --output /tmp/activation_loop_060.md --model-timeout-ms 45000`
    - result: `100/100` pass
    - artifacts:
      - [/tmp/activation_loop_060.md](/tmp/activation_loop_060.md)
      - [/tmp/activation_loop_060.md.json](/tmp/activation_loop_060.md.json)
- Outcome:
  - activation ownership is now an explicit runtime contract instead of an orchestration convention
  - the queue can say whether work was leased, blocked by contention, or absent
  - wake execution now operates under a queue-owned activation lease rather than silently re-acquiring ownership later

## Loop 061

- Goal: make activation lease outcomes durable so operator/debug tooling can inspect activation lifecycle after the fact instead of inferring it only from session events.
- Problem:
  - after Loop 060, activation ownership was explicit at runtime, but it still disappeared once a wake finished.
  - there was no durable runtime file answering:
    - which activation was leased
    - which lease attempt was blocked
    - which activation was acked
    - which activation was abandoned
  - that left a gap between queue semantics and operator observability, especially for long-running workers and contention debugging.
- Structural fix:
  - added [src/agents/runtime/activation-journal.ts](/src/agents/runtime/activation-journal.ts)
    - writes durable JSONL records to `.openboa/agents/<agentId>/runtime/activation-events.jsonl`
    - exposes explicit record kinds:
      - `activation.leased`
      - `activation.blocked`
      - `activation.acked`
      - `activation.abandoned`
  - updated [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts) so queue-side lease acquisition records:
    - blocked contention attempts
    - successful leases
    - final ack/abandon outcomes through the leased activation closure
  - updated [src/agents/runtime/wake-session.ts](/src/agents/runtime/wake-session.ts) so `wakeSessionOnce(...)` passes structured ack/abandon metadata into the leased activation:
    - `wakeId`
    - `stopReason`
    - `queuedWakeIds`
    - `processedEventIds`
    - or an explicit abandon reason/error message on failure or idle race
  - ensured journal append failures do not strand wake leases by releasing the lease in a `finally` block inside the activation close path
- Regression coverage:
  - extended [test/activation-queue.test.ts](/test/activation-queue.test.ts) so the queue now proves:
    - `leased -> blocked -> acked` records are appended with structured metadata
    - `activation.abandoned` is appended when leased work is given up before execution
  - kept [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) green under the new journalized lease contract
- Verification:
  - `pnpm exec vitest run test/activation-queue.test.ts test/runtime-scheduler.test.ts`
  - `pnpm exec tsc --noEmit`
  - full live batch:
    - `pnpm openboa agent scenario-loop --agent activation-loop-061 --count 100 --output /tmp/activation_loop_061.md --model-timeout-ms 45000`
    - result: `100/100` pass
    - artifacts:
      - [/tmp/activation_loop_061.md](/tmp/activation_loop_061.md)
      - [/tmp/activation_loop_061.md.json](/tmp/activation_loop_061.md.json)
      - [.openboa/agents/activation-loop-061/runtime/activation-events.jsonl](/.openboa/agents/activation-loop-061/runtime/activation-events.jsonl)
- Outcome:
  - activation lifecycle is now a durable runtime surface rather than an ephemeral scheduler side effect
  - operator tooling can inspect queue contention and activation completion directly from runtime files
  - queued-wake activations and pending-event activations now share the same durable lease/ack audit trail

## Loop 062

- Goal: expose the new activation journal through the public operator CLI so activation lifecycle can be inspected without opening raw JSONL files manually.
- Problem:
  - after Loop 061, the durable journal existed at `.openboa/agents/<agentId>/runtime/activation-events.jsonl`, but only engineers reading raw files could use it.
  - that left a gap in the operator surface:
    - session events were inspectable through `openboa agent session events`
    - activation lifecycle was not
- Structural fix:
  - extended [src/index.ts](/src/index.ts) with:
    - new command: `openboa agent activation-events --agent <agent-id> [--limit <n>]`
    - `renderActivationJournalEvent(...)`
    - `runAgentActivationEvents(...)`
  - the CLI now reads [src/agents/runtime/activation-journal.ts](/src/agents/runtime/activation-journal.ts) and prints:
    - `activation.leased`
    - `activation.blocked`
    - `activation.acked`
    - `activation.abandoned`
    with the activation kind, owner, stop reason, wake id, processed-event count, and queued-wake count when relevant
- Regression coverage:
  - extended [test/index.test.ts](/test/index.test.ts) with:
    - a dedicated `activation-events` CLI output test
    - updated legacy-command expectations for the new public command surface
  - kept [test/activation-queue.test.ts](/test/activation-queue.test.ts) and [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) green alongside the CLI addition
- Verification:
  - `pnpm exec vitest run test/activation-queue.test.ts test/runtime-scheduler.test.ts test/index.test.ts`
  - `pnpm exec tsc --noEmit`
  - live CLI probe:
    - `pnpm openboa agent activation-events --agent activation-loop-061 --limit 4`
    - confirmed recent `pending_events` and `queued_wake` lifecycle lines print correctly from the durable journal
- Outcome:
  - activation lifecycle is now a first-class operator surface, not just a hidden runtime file
  - queue ownership and completion can be inspected with the same CLI ergonomics as session events
  - operator debugging now has both:
    - `session events` for conversation/runtime messages
    - `activation events` for scheduler/lease lifecycle

## Loop 063

- Goal: make the live 100-scenario batch idempotent on rerun against the same agent, especially for bootstrap promotion scenarios that may encounter preexisting shared-substrate markers.
- Problem:
  - repeated live runs against `activation-loop-062` left `SOUL.md` and `IDENTITY.md` already containing:
    - `- Scenario-PROMOTE-SOUL`
    - `- Scenario-PROMOTE-IDENTITY`
  - the scenario evaluator still required `resources_promote_to_substrate` unconditionally, so scenarios `095` and `096` could fail even when the agent correctly:
    - staged the shared file
    - compared it against substrate
    - detected no intentional diff remained
    - avoided duplicating the marker
  - that was a scenario-accounting bug, not a runtime bug
- Structural fix:
  - updated [src/agents/runtime/scenario-loop.ts](/src/agents/runtime/scenario-loop.ts) so bootstrap promotion scenarios now:
    - read the shared substrate before the run
    - detect whether the marker already exists
    - instruct the model not to duplicate the marker on rerun
    - require `resources_compare_with_substrate` for all promotion paths
    - require `resources_promote_to_substrate` only when the marker was not already present before the run
    - assert exact line-count behavior:
      - first run must add exactly one marker line
      - rerun must keep the marker count unchanged
  - updated failure partials to retain aggregated tool/input/approval evidence across the full approval loop instead of only the last wake
- Regression coverage:
  - kept [test/index.test.ts](/test/index.test.ts) scenario-loop CLI coverage green
  - validated the stricter evaluator through a full live rerun against the same agent state rather than only a fresh-agent happy path
- Verification:
  - `pnpm exec tsc --noEmit`
  - `pnpm exec vitest run test/index.test.ts -t "scenario-loop"`
  - live idempotence rerun:
    - `pnpm openboa agent scenario-loop --agent activation-loop-062 --count 100 --output /tmp/activation_loop_062.md --model-timeout-ms 45000`
    - result: `100/100` pass
    - JSON verification: `fails 0`
    - artifacts:
      - [/tmp/activation_loop_062.md](/tmp/activation_loop_062.md)
      - [/tmp/activation_loop_062.md.json](/tmp/activation_loop_062.md.json)
- Outcome:
  - the 100-scenario live batch is now rerunnable against the same agent without false fails from already-promoted bootstrap markers
  - bootstrap promotion scenarios now distinguish correctly between:
    - first-time substrate mutation
    - idempotent verification of already-correct shared state
  - scenario evidence is stricter and more realistic:
    - no duplicate marker lines allowed
    - compare-step proof is required

## Loop 064

- Goal: raise operator/runtime observability so `session status` and `orchestrator --watch --log` show retry/backoff, queued wake backlog, and lease ownership directly without opening raw runtime files.
- Problem:
  - after Loops 056, 061, and 062, the runtime already had:
    - deferred immediate retries in the runnable-session index
    - queued wake backlog in per-session wake journals
    - durable activation lease journal records
  - but the main operator surfaces still hid most of that state:
    - `openboa agent session status` did not show `deferUntil`, queued wake backlog, or active lease ownership
    - `orchestrator --watch --log` did not show next retry timing or who currently owned a contended lease
- Structural fix:
  - extended [src/agents/sessions/session-store.ts](/src/agents/sessions/session-store.ts) with:
    - `SessionExecutionRuntimeState`
    - `getSessionExecutionRuntimeState(...)`
    - `getSessionExecutionRuntimeStateForAgentSession(...)`
    - stale-safe `readActiveWakeLeaseForAgentSession(...)`
  - extended [src/agents/runtime/session-wake-queue.ts](/src/agents/runtime/session-wake-queue.ts) with:
    - `SessionPendingWakeState`
    - `inspectPending(...)`
    - `inspectPendingForAgentSession(...)`
  - updated [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts) so watch activity/skip callbacks now carry:
    - `runnablePendingEventType`
    - `deferUntil`
    - `pendingWakeCount`
    - `nextQueuedWakeAt`
    - `activeWakeLease` on contended skips
  - updated [src/index.ts](/src/index.ts) so:
    - `openboa agent session status` prints:
      - `runnablePendingEvent`
      - `nextRetryAt`
      - `pendingQueuedWakes`
      - `nextQueuedWakeAt`
      - `activeWakeLeaseOwner`
      - `activeWakeLeaseAcquiredAt`
    - `orchestrator --watch --log` prints the same retry/backlog surface
    - skipped activation lines now expose the lease owner and acquisition time when contention happens
- Regression coverage:
  - extended [test/index.test.ts](/test/index.test.ts) to lock:
    - session-status retry/queued-wake/lease fields
    - watch activity retry/backlog fields
    - skipped activation lease owner output
  - kept [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) green under the richer orchestration surface
- Verification:
  - `pnpm exec vitest run test/index.test.ts test/runtime-scheduler.test.ts`
  - `pnpm exec tsc --noEmit`
  - live status probe:
    - `pnpm openboa agent spawn --name status-probe-064`
    - `pnpm openboa agent session create --name status-probe-064`
    - `pnpm openboa agent session send --session 019d813e-9ce7-769b-b6f5-28cd3e6cedac --message "probe status fields"`
    - `pnpm openboa agent session status --session 019d813e-9ce7-769b-b6f5-28cd3e6cedac`
    - confirmed live output includes:
      - `runnablePendingEvent: user.message`
      - `nextRetryAt: none`
      - `pendingQueuedWakes: 0`
      - `nextQueuedWakeAt: none`
      - `activeWakeLeaseOwner: none`
  - full live batch:
    - `pnpm openboa agent scenario-loop --agent activation-loop-064 --count 100 --output /tmp/activation_loop_064.md --model-timeout-ms 45000`
    - result: `100/100` pass
    - artifacts:
      - [/tmp/activation_loop_064.md](/tmp/activation_loop_064.md)
      - [/tmp/activation_loop_064.md.json](/tmp/activation_loop_064.md.json)
- Outcome:
  - operator-facing status now reflects the real runtime state instead of only the session headline
  - retry/backoff, wake backlog, and lease contention can be diagnosed from the primary CLI surface
  - the richer observability did not regress live runtime behavior: the full 100-scenario Codex-backed batch remained green

## Loop 065

- Goal: make activation retry/requeue state explicit in the durable activation journal and operator CLI instead of hiding it behind `activation.acked`.
- Problem:
  - after Loop 064, retry/backoff and queued wake backlog were visible from session status and watch output
  - but the durable activation journal still only told operators that an activation was `acked`
  - when an activation ended in `rescheduling`, there was no durable activation-level record saying whether it also produced:
    - an immediate retry window via `deferUntil`
    - a future queued wake
- Structural fix:
  - extended [src/agents/runtime/activation-journal.ts](/src/agents/runtime/activation-journal.ts) with:
    - `ActivationRequeueJournalInput`
    - `ActivationRequeuedRecord`
    - `recordRequeued(...)`
  - updated [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts) so `ack(...)` now:
    - preserves optional `requeue` details on the ack input
    - emits `activation.requeued` when the requeue details are meaningful
  - updated [src/agents/runtime/wake-session.ts](/src/agents/runtime/wake-session.ts) so `wakeSessionOnce(...)` computes activation requeue details on `stopReason === "rescheduling"` by reading:
    - immediate retry state from the runnable-session index
    - pending queued wake state from the wake queue
    - newly enqueued wake ids from the current wake result
  - updated [src/index.ts](/src/index.ts) so `openboa agent activation-events` renders:
    - `activation.requeued`
    - `immediateRetryAt`
    - `nextQueuedWakeAt`
    - queued wake count
- Regression coverage:
  - extended [test/activation-queue.test.ts](/test/activation-queue.test.ts) so a leased activation ack with requeue details records:
    - `activation.leased`
    - `activation.blocked`
    - `activation.acked`
    - `activation.requeued`
  - extended [test/wake-session.test.ts](/test/wake-session.test.ts) so a real `wakeSessionOnce(...)` run ending in `rescheduling` records `activation.requeued` with both:
    - `immediateRetryAt`
    - `nextQueuedWakeAt`
  - extended [test/index.test.ts](/test/index.test.ts) so `agent activation-events` CLI output must render `activation.requeued` fields
- Verification:
  - `pnpm exec vitest run test/activation-queue.test.ts test/wake-session.test.ts test/index.test.ts`
  - `pnpm exec tsc --noEmit`
  - full live batch:
    - `pnpm openboa agent scenario-loop --agent activation-loop-065 --count 100 --output /tmp/activation_loop_065.md --model-timeout-ms 45000`
    - result: `100/100` pass
    - JSON verification: `fails 0`
    - artifacts:
      - [/tmp/activation_loop_065.md](/tmp/activation_loop_065.md)
      - [/tmp/activation_loop_065.md.json](/tmp/activation_loop_065.md.json)
- Outcome:
  - activation journaling now distinguishes:
    - work that completed with no follow-up execution state
    - work that completed while explicitly requeuing follow-up runtime work
  - operator tooling has a durable activation-level place to answer:
    - did this activation only ack?
    - or did it also schedule retry/requeue work?
  - the additional journal fidelity did not regress the full live Codex-backed 100-scenario batch

## Loop 066

- Goal: surface activation requeue state directly in the primary wake/watch output instead of forcing operators to cross-reference the activation journal.
- Problem:
  - after Loop 065, `activation.requeued` existed durably in the activation journal
  - but the primary execution surfaces still only showed:
    - `stopReason`
    - `nextRetryAt`
    - `nextQueuedWakeAt`
  - that meant operators still had to infer whether the just-finished activation itself created follow-up work, or whether they were only looking at ambient session state
- Structural fix:
  - extended [src/agents/runtime/wake-session.ts](/src/agents/runtime/wake-session.ts) so `WakeSessionResult` now carries:
    - `requeue`
    - normalized from the same activation requeue details used by Loop 065 journaling
  - extended [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts) so `AgentOrchestratorActivity` also carries `requeue`
  - updated [src/index.ts](/src/index.ts) with shared `renderWakeRequeueLines(...)` output for:
    - `openboa agent wake`
    - `openboa agent orchestrator --watch`
  - the CLI now renders:
    - `activationRequeued`
    - `activationImmediateRetryAt`
    - `activationNextQueuedWakeAt`
    - `activationQueuedWakeIds`
- Regression coverage:
  - extended [test/index.test.ts](/test/index.test.ts) so:
    - normal `agent wake` output must show `activationRequeued: false`
    - watch-mode activity with requeue details must show the activation requeue lines explicitly
  - updated [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) mock wake results to include the new `requeue` contract
  - kept Loop 065 regressions green:
    - [test/activation-queue.test.ts](/test/activation-queue.test.ts)
    - [test/wake-session.test.ts](/test/wake-session.test.ts)
- Verification:
  - `pnpm exec vitest run test/index.test.ts test/runtime-scheduler.test.ts test/activation-queue.test.ts test/wake-session.test.ts`
  - `pnpm exec tsc --noEmit`
  - full live batch:
    - `pnpm openboa agent scenario-loop --agent activation-loop-066 --count 100 --output /tmp/activation_loop_066.md --model-timeout-ms 45000`
    - result: `100/100` pass
    - artifacts:
      - [/tmp/activation_loop_066.md](/tmp/activation_loop_066.md)
      - [/tmp/activation_loop_066.md.json](/tmp/activation_loop_066.md.json)
- Outcome:
  - primary operator surfaces now answer not only “what is the session state now?” but also “did this activation itself create follow-up execution work?”
  - the richer wake/watch output did not regress the live Codex-backed 100-scenario batch

## Loop 067

- Goal: make `openboa agent session status` show the latest activation outcome for the session, not only the current runtime state.
- Problem:
  - after Loops 065-066, activation lifecycle was durable and visible through:
    - `activation-events`
    - `wake`
    - `orchestrator --watch`
  - but `session status` still only answered:
    - what is pending now?
    - what retry or queued wake state exists now?
  - it did not answer:
    - what did the last activation actually do?
    - did the last activation requeue, abandon, or ack work?
- Structural fix:
  - extended [src/agents/runtime/activation-journal.ts](/src/agents/runtime/activation-journal.ts) with:
    - `listForSession(agentId, sessionId)`
    - `latestForSession(agentId, sessionId)`
  - updated [src/index.ts](/src/index.ts) so `runAgentSessionStatus(...)` now loads the latest activation record for the session and renders:
    - `lastActivationKind`
    - `lastActivationAt`
    - `lastActivationReason`
    - `lastActivationLeaseOwner`
  - added kind-specific status lines for:
    - `activation.acked`
      - `lastActivationStopReason`
      - `lastActivationProcessedEvents`
      - `lastActivationQueuedWakes`
    - `activation.requeued`
      - `lastActivationImmediateRetryAt`
      - `lastActivationNextQueuedWakeAt`
      - `lastActivationQueuedWakeIds`
    - `activation.abandoned`
      - `lastActivationAbandonReason`
      - `lastActivationError`
    - `activation.blocked`
      - `lastActivationBlockedReason`
- Regression coverage:
  - extended [test/index.test.ts](/test/index.test.ts) with session-status assertions for:
    - latest `activation.requeued`
    - latest `activation.abandoned`
- Verification:
  - `pnpm exec vitest run test/index.test.ts`
  - `pnpm exec tsc --noEmit`
- Outcome:
  - `session status` now combines:
    - current runtime state
    - latest activation outcome
  - operators can answer both:
    - what is the session waiting on now?
    - what did the most recent activation actually do?

## Loop 068

- Goal: make activation leasing behave more like a real queue consumer by skipping already leased or race-contended sessions and continuing to the next ready activation in the same call.
- Problem:
  - `leaseNextActivation(...)` previously rebuilt ready activations without excluding active leases up front
  - if the first candidate was already leased or lost a race on `acquireWakeLease(...)`, the call stopped immediately with `blocked`
  - that meant one contended session could prevent the queue from leasing another ready activation behind it
- Structural fix:
  - updated [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts) so `leaseNextActivation(...)` now:
    - loads active leased session ids up front and excludes them from discovery
    - loops over ready activations instead of stopping at the first candidate
    - records `activation.blocked` for a true acquire race
    - keeps searching for another ready activation after a blocked candidate
    - only returns `blocked` when contention happened and no other ready activation could be leased
    - otherwise returns `none` when everything remaining is already leased or excluded
- Regression coverage:
  - updated [test/activation-queue.test.ts](/test/activation-queue.test.ts) so:
    - a second lease attempt against an already leased session now returns `none`
    - a synthetic acquire race on the first session still records `activation.blocked` and then leases the second ready session in the same call
- Verification:
  - `pnpm exec vitest run test/activation-queue.test.ts test/runtime-scheduler.test.ts`
  - `pnpm exec tsc --noEmit`
- Outcome:
  - activation discovery is now closer to a broker-like queue consumer:
    - active ownership is respected at discovery time
    - transient contention on one session no longer starves other ready work

## Loop 069

- Goal: fail closed when a long-running wake loses the ability to renew its wake lease heartbeat.
- Problem:
  - [src/agents/runtime/wake-session.ts](/src/agents/runtime/wake-session.ts) previously swallowed `lease.renew()` failures in the heartbeat interval
  - that meant a long-running activation could keep executing after lease renewal had already failed
  - in the worst case, another worker could later treat the lease as stale and execute the same session again without the first worker surfacing the lease-loss condition
- Structural fix:
  - updated [src/agents/runtime/wake-session.ts](/src/agents/runtime/wake-session.ts) so heartbeat renewal errors are captured and no longer ignored
  - after `runHarness(...)` returns, `wakeSessionOnce(...)` now checks whether lease renewal failed during execution
  - if it did, the wake now fails closed:
    - `ack` is not emitted
    - the leased activation is `abandon`ed instead
    - the abandon reason is recorded as `wake_lease_renew_failed`
    - the renewal error is rethrown to the caller
  - also tightened the outer catch so precomputed abandon reasons are not overwritten by the generic `wake_failed` fallback
- Regression coverage:
  - extended [test/wake-session.test.ts](/test/wake-session.test.ts) with a long-running activation scenario where:
    - the leased activation heartbeat renew path throws
    - `wakeSessionOnce(...)` rejects
    - `ack` is not called
    - `abandon({ reason: "wake_lease_renew_failed", ... })` is called
  - kept [test/activation-queue.test.ts](/test/activation-queue.test.ts) green to ensure the heartbeat change did not regress activation queue ownership behavior
- Verification:
  - `pnpm exec vitest run test/wake-session.test.ts test/activation-queue.test.ts`
  - `pnpm exec tsc --noEmit`
- Outcome:
  - long-running wakes no longer silently continue after losing lease renewal
  - the runtime now fails closed and surfaces lease-loss as a first-class execution failure instead of allowing hidden duplicate-execution risk

## Loop 070

- Goal: ensure delayed queued wakes are not silently lost when wake execution fails after consuming them.
- Problem:
  - [src/agents/runtime/wake-session.ts](/src/agents/runtime/wake-session.ts) consumes due wakes before `runHarness(...)`
  - if execution then throws, those due wakes were already marked completed
  - that meant a failed wake could drop delayed follow-up work on the floor instead of restoring it for a later retry
- Structural fix:
  - updated [src/agents/runtime/wake-session.ts](/src/agents/runtime/wake-session.ts) so consumed due wakes are tracked across the whole wake
  - on any failure path, consumed wakes are now restored through `SessionWakeQueue.enqueue(...)` with their original:
    - `sessionId`
    - `dueAt`
    - `reason`
    - `note`
    - `dedupeKey`
    - `priority`
  - added local helper logic to restore each consumed wake at most once per failing wake
- Regression coverage:
  - extended [test/wake-session.test.ts](/test/wake-session.test.ts) with a scenario where:
    - a due queued wake is consumed
    - `runHarness(...)` throws
    - the queued wake is visible again afterward with the same wake semantics
  - kept [test/activation-queue.test.ts](/test/activation-queue.test.ts) green so restore logic does not regress lease/ownership behavior
- Verification:
  - `pnpm exec vitest run test/wake-session.test.ts test/activation-queue.test.ts`
  - `pnpm exec tsc --noEmit`
- Outcome:
  - delayed work is now replay-safe across wake failures
  - a failing wake no longer drops already-consumed queued wakes, which closes a real reliability gap in long-running orchestrated execution

## Loop 071

- Goal: keep the orchestrator alive after a single activation fails, instead of aborting the whole watch loop.
- Problem:
  - [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts) previously let a thrown `wake(...)` error escape the per-activation execution loop
  - that meant one bad activation could stop the worker before it reached the next ready session
  - operator output also lost the actual failure reason unless someone dug into deeper traces
- Structural fix:
  - updated [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts) so `executeReadyActivationsForCycle(...)` catches per-activation `wake(...)` failures
  - on failure, the orchestrator now:
    - reconciles the runnable-session index for `pending_events` activations
    - emits `onSkip` with `reason: "wake_failed"` and the concrete `errorMessage`
    - preserves any current lease-owner context on the skip activity
    - continues to the next ready activation in the same cycle instead of aborting the worker
  - updated skip dedupe so repeated `wake_failed` logs are keyed by both reason and error message, preventing noisy duplicates without hiding distinct failures
  - updated [src/index.ts](/src/index.ts) so `orchestrator --watch --log` prints the concrete `error:` line for skipped wake failures
- Regression coverage:
  - extended [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) with a scenario where:
    - the first leased activation throws `lease renew failed`
    - the second ready activation still executes successfully in the same loop
    - `onSkip` captures `reason: "wake_failed"` and the exact error message
  - extended [test/index.test.ts](/test/index.test.ts) so watch/log output renders:
    - `reason: wake_failed`
    - `error: lease renew failed`
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/index.test.ts`
  - `pnpm exec tsc --noEmit`
- Outcome:
  - a single broken activation no longer kills the long-running orchestrator
  - operator output now surfaces wake failures directly while the worker keeps draining other ready work

## Loop 072

- Goal: add a short failure cooldown so repeated `wake_failed` activations do not hot-loop on every poll.
- Problem:
  - after Loop 071, the orchestrator stayed alive after a single activation failure
  - but a failed `pending_events` activation could still remain immediately runnable on the next poll
  - and a failed `queued_wake` activation was restored with its original already-due timestamp, which could trigger immediate re-execution churn
- Structural fix:
  - updated [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts) so a failed `pending_events` activation now:
    - reconciles the runnable-session index
    - sets a short `deferUntil` cooldown before the session becomes ready again
  - updated [src/agents/runtime/wake-session.ts](/src/agents/runtime/wake-session.ts) so restored consumed queued wakes now come back with a short retry delay when the original wake was already due
  - both paths use the same small backoff window so generic wake failures stop behaving like tight retry loops
- Regression coverage:
  - extended [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) so a failed `pending_events` activation:
    - gets `deferUntil`
    - is hidden during the cooldown
    - becomes ready again after the cooldown expires
  - extended [test/wake-session.test.ts](/test/wake-session.test.ts) so a consumed queued wake restored after failure:
    - is not immediately due at the failure timestamp
    - becomes due again only after the retry delay
- Verification:
  - `pnpm exec vitest run test/runtime-scheduler.test.ts test/wake-session.test.ts`
  - `pnpm exec tsc --noEmit`
- Outcome:
  - generic wake failures now fail closed without turning into hot retry churn
  - both immediate and delayed activation paths get a consistent short cooldown before the next attempt

## Loop 073

- Goal: replace the fixed failure cooldown with per-session exponential backoff so repeated failing work is deprioritized during long soak.
- Problem:
  - Loop 072 stopped immediate hot retries, but every generic `wake_failed` still retried after the same short delay
  - in long-running multi-worker operation, a chronically failing session could keep reappearing at a flat cadence and compete with healthier work
- Structural fix:
  - updated [src/agents/sessions/session-store.ts](/src/agents/sessions/session-store.ts) so the runnable-session index now carries `failureStreak`
  - added `backoffRunnableSession(...)` that:
    - increments the session-local failure streak
    - computes exponential retry delay from that streak
    - writes both `deferUntil` and `failureStreak` back into the runtime index
  - successful journal refreshes and new runnable events still reset the streak to `0`
  - updated [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts) so `wake_failed` on `pending_events` now uses `backoffRunnableSession(...)` instead of a flat defer
  - updated [src/index.ts](/src/index.ts) so `session status` and `orchestrator --watch --log` now show `retryStreak`
- Regression coverage:
  - extended [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) so a failed `pending_events` activation is hidden during the backoff window and becomes ready again after it expires
  - updated [test/index.test.ts](/test/index.test.ts) and [test/activation-queue.test.ts](/test/activation-queue.test.ts) for the new `failureStreak` runtime surface
  - kept [test/session-store.test.ts](/test/session-store.test.ts) and [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts) green under the widened contract
- Verification:
  - `pnpm exec vitest run test/session-store.test.ts test/runtime-scheduler.test.ts test/index.test.ts test/activation-queue.test.ts`
  - `pnpm exec tsc --noEmit`
- Outcome:
  - repeated `wake_failed` sessions now back off progressively instead of retrying at a fixed cadence
  - operator surfaces can see both `nextRetryAt` and `retryStreak`, which makes long-soak behavior easier to reason about

## Loop 074

- Goal: add a live multi-worker soak runner and use it to catch cross-session shared-index races under real contention.
- Problem:
  - the runtime had strong per-session mutation locking, but the new soak runner immediately exposed that two agent-level shared indexes were still vulnerable to lost updates:
    - `runnable-sessions.json`
    - `pending-wake-sessions.json`
  - concurrent `emitEvent(...)` calls on different sessions could overwrite one another in the runnable index
  - concurrent delayed wake enqueue on different sessions could overwrite one another in the pending wake index
  - the result was a realistic failure mode:
    - only one of several ready sessions would appear runnable
    - only one delayed wake session would survive into the shared pending index
- Structural fix:
  - added [src/agents/runtime/scenario-soak.ts](/src/agents/runtime/scenario-soak.ts) and wired it through [src/index.ts](/src/index.ts) as:
    - `openboa agent scenario-soak --agent <id> --workers <n> --sessions <n> --delayed-sessions <n>`
  - the soak runner now executes two real phases against the same agent:
    - concurrent immediate `user.message` ingress across multiple sessions
    - concurrent delayed queued wakes consumed by multiple workers
  - added an agent-level runtime index lock to [src/agents/sessions/session-store.ts](/src/agents/sessions/session-store.ts) and moved both of these shared read-modify-write paths under it:
    - `syncRunnableSessionIndex(...)`
    - `syncActiveWakeLeaseIndex(...)`
    - plus stale active-wake lease pruning in `listActiveWakeLeaseSessionIds(...)`
  - added a pending wake index lock to [src/agents/runtime/session-wake-queue.ts](/src/agents/runtime/session-wake-queue.ts) and moved both of these shared read-modify-write paths under it:
    - `syncPendingWakeSessionIndex(...)`
    - `listDueSessionWakes(...)` when it repairs stale `nextDueAt` entries
  - updated [src/agents/runtime/scenario-soak.ts](/src/agents/runtime/scenario-soak.ts) so the report merges immediate and delayed phase summaries correctly instead of leaving delayed ack counts at `0`
- Regression coverage:
  - added [test/scenario-soak.test.ts](/test/scenario-soak.test.ts) for the bounded soak helper and its markdown/json report
  - extended [test/index.test.ts](/test/index.test.ts) for the new `scenario-soak` CLI surface
  - extended [test/session-store.test.ts](/test/session-store.test.ts) so concurrent `emitEvent(...)` on different sessions preserves every runnable entry
  - extended [test/activation-queue.test.ts](/test/activation-queue.test.ts) so concurrent wake enqueue on different sessions preserves every pending wake session entry
- Verification:
  - `pnpm exec vitest run test/session-store.test.ts test/activation-queue.test.ts test/scenario-soak.test.ts test/index.test.ts`
  - `pnpm exec tsc --noEmit`
  - `pnpm openboa agent scenario-soak --agent activation-soak-074 --workers 3 --sessions 6 --delayed-sessions 3 --output /tmp/activation_soak_074.md --model-timeout-ms 45000`
- Outcome:
  - the new live soak runner completed with:
    - `blockedActivations: 4`
    - `immediatePassed: 6`
    - `delayedPassed: 3`
    - `failed: 0`
  - refreshed artifacts:
  - [/tmp/activation_soak_074.md](/tmp/activation_soak_074.md)
  - [/tmp/activation_soak_074.md.json](/tmp/activation_soak_074.md.json)
  - the runtime now survives concurrent cross-session ingress without losing shared runnable or delayed-wake index entries

## Loop 075

- Goal: add a live mixed-load soak runner that exercises approval, custom tool, delayed wake, interrupt, and ordinary immediate work together under a shared worker pool.
- Problem:
  - `scenario-soak` proved the runtime under immediate+delayed contention, but it still left a gap:
    - approval-gated shell work
    - custom tool pauses
    - interrupt-based blocked-work cancellation
    were only verified in isolated single-scenario runs
  - the runtime needed one bounded CLI that could drive all of those activation shapes concurrently against the same agent and worker pool
- Structural fix:
  - added [src/agents/runtime/scenario-mixed-soak.ts](/src/agents/runtime/scenario-mixed-soak.ts)
  - wired it through [src/index.ts](/src/index.ts) as:
    - `openboa agent scenario-mixed-soak --agent <id> --workers <n> --immediate-sessions <n> --delayed-sessions <n> --approval-sessions <n> --custom-tool-sessions <n> --interrupt-sessions <n>`
  - the mixed soak runner now creates separate session groups and drives them concurrently:
    - immediate message sessions
    - delayed queued-wake sessions
    - approval-required `shell_run` sessions
    - custom tool roundtrip sessions
    - interrupt sessions that cancel a blocked approval before any write lands
  - each group is validated from durable runtime state:
    - session stop reason
    - pending request state
    - activation journal ack counts
    - workspace file side effects where relevant
  - writes markdown/json reports:
    - `/tmp/activation_mixed_075.md`
    - `/tmp/activation_mixed_075.md.json`
- Regression coverage:
  - extended [test/index.test.ts](/test/index.test.ts) with CLI surface coverage for `scenario-mixed-soak`
  - updated legacy command expectation strings in [test/index.test.ts](/test/index.test.ts) for the widened agent command surface
- Verification:
  - `pnpm exec vitest run test/index.test.ts`
  - `pnpm exec tsc --noEmit`
  - `pnpm openboa agent scenario-mixed-soak --agent activation-mixed-075 --workers 3 --immediate-sessions 2 --delayed-sessions 2 --approval-sessions 2 --custom-tool-sessions 2 --interrupt-sessions 2 --output /tmp/activation_mixed_075.md --model-timeout-ms 45000`
- Outcome:
  - live mixed soak completed with:
    - `blockedActivations: 1`
    - `immediatePassed: 2`
    - `delayedPassed: 2`
    - `approvalPassed: 2`
    - `customToolPassed: 2`
    - `interruptPassed: 2`
    - `failed: 0`
  - the runtime now has a first-class live CLI for mixed activation shapes instead of only isolated single-capability probes

## Loop 076

- Goal: pressure the new mixed soak runner with a heavier batch and fix any structural false failures it exposes.
- Problem:
  - a heavier live run with:
    - `workers: 4`
    - `immediate: 4`
    - `delayed: 4`
    - `approval: 3`
    - `custom_tool: 3`
    - `interrupt: 3`
    initially completed with `failed: 2`
  - both failures were delayed sessions that had actually succeeded in runtime state:
    - session events showed the queued wake response
    - activation journal showed `activation.acked` for `queued_wake`
  - root cause:
    - [src/agents/runtime/scenario-mixed-soak.ts](/src/agents/runtime/scenario-mixed-soak.ts) used a fixed per-session timeout of `30s`
    - that value was lower than the configured live `modelTimeoutMs=45000`, so the runner could declare failure before a valid delayed second activation finished under heavier contention
- Structural fix:
  - updated [src/agents/runtime/scenario-mixed-soak.ts](/src/agents/runtime/scenario-mixed-soak.ts) so the default per-session wait budget is now model-aware
  - the runner computes timeout from:
    - configured `modelTimeoutMs`
    - total session count
    - worker count
  - current default logic guarantees mixed soak waits at least:
    - `2 * modelTimeoutMs`
    - or a larger contention-aware floor when needed
  - this makes the soak helper consistent with the actual runtime contract instead of baking in a smaller hidden deadline
- Regression coverage:
  - re-ran [test/index.test.ts](/test/index.test.ts)
  - re-ran `tsc --noEmit`
- Verification:
  - failing pressure run before the fix:
    - `pnpm openboa agent scenario-mixed-soak --agent activation-mixed-076 --workers 4 --immediate-sessions 4 --delayed-sessions 4 --approval-sessions 3 --custom-tool-sessions 3 --interrupt-sessions 3 --output /tmp/activation_mixed_076.md --model-timeout-ms 45000`
    - result:
      - `failed: 2`
      - both failures were delayed-session false negatives
  - passing pressure run after the fix:
    - `pnpm openboa agent scenario-mixed-soak --agent activation-mixed-077 --workers 4 --immediate-sessions 4 --delayed-sessions 4 --approval-sessions 3 --custom-tool-sessions 3 --interrupt-sessions 3 --output /tmp/activation_mixed_077.md --model-timeout-ms 45000`
- Outcome:
  - heavy mixed soak now closes with:
    - `blockedActivations: 2`
    - `immediatePassed: 4`
    - `delayedPassed: 4`
    - `approvalPassed: 3`
    - `customToolPassed: 3`
    - `interruptPassed: 3`
    - `failed: 0`
  - refreshed artifacts:
    - [/tmp/activation_mixed_076.md](/tmp/activation_mixed_076.md)
    - [/tmp/activation_mixed_076.md.json](/tmp/activation_mixed_076.md.json)
    - [/tmp/activation_mixed_077.md](/tmp/activation_mixed_077.md)
    - [/tmp/activation_mixed_077.md.json](/tmp/activation_mixed_077.md.json)

## Loop 077

- Goal: extend mixed soak across multiple rounds and remove a delayed-wake false negative that only appeared under the wider batch.
- Structural change:
  - updated [src/agents/runtime/scenario-mixed-soak.ts](/src/agents/runtime/scenario-mixed-soak.ts) so `scenario-mixed-soak` supports `--rounds <n>`
  - each round now creates fresh immediate, delayed, approval, custom-tool, and interrupt sessions with round-qualified tokens/tool names/file names
  - the report now includes:
    - top-level `Rounds`
    - per-round pass/fail summaries
    - per-session `round=<n>` rows
- Problem discovered in live 3-round run:
  - `activation-mixed-079` completed with `failed: 1`
  - the failed session was a delayed scenario whose runtime state had actually succeeded:
    - session events contained the final delayed response with the exact token and `"queued wake"`
    - activation journal contained `activation.acked` for `queued_wake`
  - root cause:
    - the delayed mixed-soak verifier was requiring an exact `record.reason === reason` match on the queued-wake activation
    - under real runtime behavior, the consumed delayed activation can merge or be superseded by model-produced revisit wakes, so the final `queued_wake` ack still represents the correct delayed continuation even when the exact reason string differs
- Structural fix:
  - changed delayed mixed-soak validation in [src/agents/runtime/scenario-mixed-soak.ts](/src/agents/runtime/scenario-mixed-soak.ts) to align with runtime semantics:
    - require the final response to include the delayed token
    - require the final response to mention `"queued wake"`
    - require at least one `queued_wake` activation ack
  - this matches the single-scenario delayed-wake verifier and removes dependence on a fragile exact reason string
- Regression/verification:
  - `pnpm exec vitest run test/index.test.ts -t "scenario-mixed-soak"`
  - `pnpm exec tsc --noEmit`
  - failing multi-round run before the verifier fix:
    - `pnpm openboa agent scenario-mixed-soak --agent activation-mixed-079 --workers 4 --rounds 3 --immediate-sessions 3 --delayed-sessions 3 --approval-sessions 2 --custom-tool-sessions 2 --interrupt-sessions 2 --output /tmp/activation_mixed_079.md --model-timeout-ms 45000`
    - result:
      - `immediatePassed: 9`
      - `delayedPassed: 8`
      - `approvalPassed: 6`
      - `customToolPassed: 6`
      - `interruptPassed: 6`
      - `failed: 1`
  - passing multi-round run after the verifier fix:
    - `pnpm openboa agent scenario-mixed-soak --agent activation-mixed-080 --workers 4 --rounds 3 --immediate-sessions 3 --delayed-sessions 3 --approval-sessions 2 --custom-tool-sessions 2 --interrupt-sessions 2 --output /tmp/activation_mixed_080.md --model-timeout-ms 45000`
- Outcome:
  - the 3-round mixed soak now closes with:
    - `blockedActivations: 1`
    - `immediatePassed: 9`
    - `delayedPassed: 9`
    - `approvalPassed: 6`
    - `customToolPassed: 6`
    - `interruptPassed: 6`
    - `failed: 0`
  - refreshed artifacts:
    - [/tmp/activation_mixed_079.md](/tmp/activation_mixed_079.md)
    - [/tmp/activation_mixed_079.md.json](/tmp/activation_mixed_079.md.json)
    - [/tmp/activation_mixed_080.md](/tmp/activation_mixed_080.md)
    - [/tmp/activation_mixed_080.md.json](/tmp/activation_mixed_080.md.json)

## Loop 078

- Goal: pressure the mixed activation runtime under a longer sustained batch after the multi-round verifier fix, without changing the runtime contract again.
- Verification run:
  - `pnpm openboa agent scenario-mixed-soak --agent activation-mixed-081 --workers 4 --rounds 5 --immediate-sessions 3 --delayed-sessions 3 --approval-sessions 2 --custom-tool-sessions 2 --interrupt-sessions 2 --output /tmp/activation_mixed_081.md --model-timeout-ms 45000`
- Outcome:
  - the longer mixed chaos soak closed with:
    - `blockedActivations: 4`
    - `immediatePassed: 15`
    - `delayedPassed: 15`
    - `approvalPassed: 10`
    - `customToolPassed: 10`
    - `interruptPassed: 10`
    - `failed: 0`
  - this means the current activation queue / lease / retry / delayed wake / approval / custom tool / interrupt runtime still stays coherent under 60 live sessions spread across 5 rounds and 4 workers
- Artifacts:
  - [/tmp/activation_mixed_081.md](/tmp/activation_mixed_081.md)
  - [/tmp/activation_mixed_081.md.json](/tmp/activation_mixed_081.md.json)

## Loop 079

- Goal: improve partial side-effect resume quality by making staged substrate drafts operator-visible and reconciling successful promotions back into the staged-draft manifest.
- Structural change:
  - updated [src/agents/resources/resource-access.ts](/src/agents/resources/resource-access.ts)
    - added `listStagedSubstrateDrafts(...)`
    - staged drafts now report:
      - `status`
      - `sourceChangedSinceStage`
      - `draftChangedSinceStage`
      - current draft/substrate content hashes
    - successful `promoteSessionWorkspaceArtifact(...)` now reconciles the staged draft manifest entry so a promoted draft becomes `in_sync` with the new shared substrate baseline instead of remaining an ambiguous stale draft
  - updated [src/agents/tools/managed-runtime-tools.ts](/src/agents/tools/managed-runtime-tools.ts)
    - added `resources_list_staged_drafts`
  - updated [src/index.ts](/src/index.ts)
    - `openboa agent session status` now surfaces:
      - `stagedSubstrateDrafts`
      - up to 5 `stagedDraft[...]` summary lines
- Regression coverage:
  - [test/resource-access.test.ts](/test/resource-access.test.ts)
    - promotion now leaves the staged draft manifest entry reconciled and `in_sync`
  - [test/index.test.ts](/test/index.test.ts)
    - session status prints staged draft count/details
- Verification:
  - `pnpm exec vitest run test/resource-access.test.ts test/index.test.ts`
  - `pnpm exec tsc --noEmit`
  - full live rerun:
    - `pnpm openboa agent scenario-loop --agent activation-loop-082 --count 100 --output /tmp/activation_loop_082.md --model-timeout-ms 45000`
- Outcome:
  - the staged-draft/status work did not regress bootstrap edit or promotion behavior
  - the full live Codex-backed 100-scenario batch closed with:
    - `executed: 100`
    - `passed: 100`
    - `failed: 0`
- Artifacts:
  - [/tmp/activation_loop_082.md](/tmp/activation_loop_082.md)
  - [/tmp/activation_loop_082.md.json](/tmp/activation_loop_082.md.json)

## Loop 080

- Goal: make each activation lease attempt traceable as one durable runtime object instead of inferring it from adjacent journal rows.
- Structural change:
  - updated [src/agents/runtime/activation-journal.ts](/src/agents/runtime/activation-journal.ts)
    - every activation journal row now carries a `claimId`
    - `activation.leased`, `activation.acked`, `activation.requeued`, `activation.abandoned`, and `activation.blocked` can all be correlated to the same lease attempt
  - updated [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts)
    - `leaseNextActivation(...)` now creates one `claimId` per lease attempt and threads it through every later journal write for that activation
    - leased activations now carry `claimId` and `leaseOwner`
  - updated [src/index.ts](/src/index.ts)
    - `session status` now prints `lastActivationClaimId`
    - `activation-events` output now includes `claim=<id>` on each line
- Regression coverage:
  - [test/activation-queue.test.ts](/test/activation-queue.test.ts)
    - one leased attempt keeps the same `claimId` across leased/acked/requeued/abandoned journal rows
  - [test/wake-session.test.ts](/test/wake-session.test.ts)
    - queued-wake execution preserves claim identity through the full activation lifecycle
  - [test/index.test.ts](/test/index.test.ts)
    - operator surfaces print claim ids
- Verification:
  - `pnpm exec vitest run test/activation-queue.test.ts test/wake-session.test.ts test/index.test.ts`
  - `pnpm exec tsc --noEmit`
  - full live rerun:
    - `pnpm openboa agent scenario-loop --agent activation-loop-083 --count 100 --output /tmp/activation_loop_083.md --model-timeout-ms 45000`
- Outcome:
  - activation lease identity is now explicit instead of reconstructed from timestamps and session ids
  - the claim-id change did not regress the Codex-backed runtime; the live 100-scenario batch closed with:
    - `executed: 100`
    - `passed: 100`
    - `failed: 0`
- Artifacts:
  - [/tmp/activation_loop_083.md](/tmp/activation_loop_083.md)
  - [/tmp/activation_loop_083.md.json](/tmp/activation_loop_083.md.json)

## Loop 081

- Goal: make the new activation claim contract actually operable by letting operators inspect one session or one claim directly from the CLI.
- Structural change:
  - updated [src/agents/runtime/activation-journal.ts](/src/agents/runtime/activation-journal.ts)
    - added `listForClaim(...)`
  - updated [src/index.ts](/src/index.ts)
    - `openboa agent activation-events` now accepts:
      - `--session <session-id>`
      - `--claim <claim-id>`
    - the command header now prints the active filter so the output is self-describing
- Regression coverage:
  - [test/index.test.ts](/test/index.test.ts)
    - CLI output is filtered correctly for one session
    - CLI output is filtered correctly for one claim
- Verification:
  - `pnpm exec vitest run test/index.test.ts`
  - `pnpm exec tsc --noEmit`
  - full live rerun:
    - `pnpm openboa agent scenario-loop --agent activation-loop-084 --count 100 --output /tmp/activation_loop_084.md --model-timeout-ms 45000`
  - live CLI probe:
    - `pnpm openboa agent activation-events --agent activation-loop-084 --session 019d868f-f7a4-718c-9a27-9b1023477966 --limit 10`
    - `pnpm openboa agent activation-events --agent activation-loop-084 --claim 019d8690-050b-7495-b52a-abdea78cabee --limit 10`
- Outcome:
  - the operator can now pivot directly from a session failure or a claim id in watch/status output to the exact activation lifecycle rows that matter
  - the filtered activation-events surface worked live against a real delayed queued-wake activation from the Codex-backed runtime
  - the additional CLI work did not regress the runtime; the live 100-scenario batch closed with:
    - `executed: 100`
    - `passed: 100`
    - `failed: 0`
- Artifacts:
  - [/tmp/activation_loop_084.md](/tmp/activation_loop_084.md)
  - [/tmp/activation_loop_084.md.json](/tmp/activation_loop_084.md.json)

## Loop 082

- Goal: make live watch-mode output directly pivotable into activation journal inspection by surfacing the active `claimId` in orchestrator activity and skip logs.
- Structural change:
  - updated [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts)
    - `leaseNextActivation(...)` blocked results now carry the same `claimId` that was journaled for that blocked lease attempt
  - updated [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts)
    - `AgentOrchestratorActivity` now includes `activationClaimId`
    - `AgentOrchestratorSkipActivity` now includes `activationClaimId`
    - activity/skip callbacks now receive the exact claim id attached to the leased or blocked activation
  - updated [src/index.ts](/src/index.ts)
    - `orchestrator --watch` now prints `activationClaimId`
    - `orchestrator --watch --log` skipped lines now also print `activationClaimId`
- Regression coverage:
  - [test/index.test.ts](/test/index.test.ts)
    - watch-mode activity prints the claim id
    - watch-mode skipped lines print the claim id
  - [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts)
    - scheduler activity/skip typing stays coherent after the new claim field
- Verification:
  - `pnpm exec vitest run test/index.test.ts test/runtime-scheduler.test.ts`
  - `pnpm exec tsc --noEmit`
  - full live rerun:
    - `pnpm openboa agent scenario-loop --agent activation-loop-085 --count 100 --output /tmp/activation_loop_085.md --model-timeout-ms 45000`
  - live watch probe:
    - created agent/session:
      - `watch-claim-085`
      - `019d86a0-84d2-71b9-8177-cc37de6ba9b7`
    - ran:
      - `pnpm openboa agent orchestrator --agent watch-claim-085 --watch --log --poll-interval-ms 200 --idle-timeout-ms 0`
      - `pnpm openboa agent session send --session 019d86a0-84d2-71b9-8177-cc37de6ba9b7 --message "what is your name"`
    - observed live output:
      - `activationClaimId: 019d86a2-3533-77dd-b5c4-f6aace703e00`
      - `responsePreview: My name is watch-claim-085.`
- Outcome:
  - the operator can now watch a live activation, copy its claim id directly from the watch log, and pivot to `activation-events --claim <id>` without guessing
  - the watch-surface change did not regress the Codex-backed runtime; the live 100-scenario batch closed with:
    - `executed: 100`
    - `passed: 100`
    - `failed: 0`
- Artifacts:
  - [/tmp/activation_loop_085.md](/tmp/activation_loop_085.md)
  - [/tmp/activation_loop_085.md.json](/tmp/activation_loop_085.md.json)

## Loop 083

- Goal: reduce steady-state live verification cost by replacing the default `scenario-loop` batch with a curated suite that keeps capability coverage while avoiding the token/runtime cost of rerunning all 100 scenarios on every pass.
- Structural change:
  - updated [src/agents/runtime/scenario-loop.ts](/src/agents/runtime/scenario-loop.ts)
    - introduced `ScenarioSuite = "curated" | "full"`
    - changed the default suite to `curated`
    - kept the full 100-scenario catalog intact behind `--suite full`
    - added a coverage-preserving curated selection of 30 scenarios spanning:
      - bootstrap substrate quoting
      - introspection
      - managed tools
      - continuity
      - watch-mode immediate ingress
      - approval allow/deny
      - bootstrap promotion + readback
      - custom tool roundtrip
      - delayed queued wake
    - added assertions so the curated suite must stay exactly 30 scenarios and must retain all required categories
    - scenario markdown output now records the active suite
  - updated [src/index.ts](/src/index.ts)
    - `openboa agent scenario-loop` now documents `--suite <curated|full>`
    - CLI output now prints:
      - `suite`
      - `available`
  - updated [test/index.test.ts](/test/index.test.ts)
    - CLI forwarding/output now covers the new suite surface
- Verification:
  - `pnpm exec vitest run test/index.test.ts`
  - `pnpm exec tsc --noEmit --pretty false`
- Outcome:
  - steady-state verification can now use the cheaper curated 30-scenario suite by default without deleting the full 100-scenario regression catalog
  - operators can still opt into the original full batch explicitly with `--suite full`
  - a fresh post-change live rerun is still pending explicit approval because the unrestricted Codex-backed CLI path is currently escalation-blocked

## Loop 084

- Goal: make `Resilience` a first-class runtime policy instead of only a documentation concept by surfacing it in agent config, runtime catalogs, orchestration behavior, and operator status output.
- Structural change:
  - updated [src/agents/agent-config.ts](/src/agents/agent-config.ts)
    - added a top-level `resilience` config contract with:
      - `profile`
      - `retry.recoverableWakeRetryDelayMs`
      - `retry.wakeFailureReplayDelayMs`
      - `retry.pendingEventBackoffBaseMs`
      - `retry.pendingEventBackoffMaxMs`
    - default agent config now seeds a resilient posture
  - updated [src/agents/setup.ts](/src/agents/setup.ts)
    - newly spawned Codex and Claude agents now persist the resilience block into `agent.json`
  - updated [src/agents/resources/default-resources.ts](/src/agents/resources/default-resources.ts)
    - `writeSessionRuntimeCatalog(...)` now records resilience posture and guarantees in `agent-setup.json` and `agent-setup.md`
  - updated [src/agents/runtime/harness.ts](/src/agents/runtime/harness.ts)
    - recoverable wake retry timing now comes from agent resilience config instead of a hardcoded runtime constant
  - updated [src/agents/runtime/wake-session.ts](/src/agents/runtime/wake-session.ts)
    - failure replay of consumed queued wakes now accepts resilience-controlled replay delay
  - updated [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts)
    - wake execution now passes resilience replay policy into `wakeSessionOnce(...)`
    - pending-event wake failures now use configured base/max backoff when re-scheduling runnable sessions
  - updated [src/index.ts](/src/index.ts)
    - `openboa agent session status` now prints:
      - `resilienceProfile`
      - `resilienceRecoverableWakeRetryDelayMs`
      - `resilienceWakeFailureReplayDelayMs`
      - `resiliencePendingEventBackoffBaseMs`
      - `resiliencePendingEventBackoffMaxMs`
- Regression coverage:
  - [test/setup.test.ts](/test/setup.test.ts)
    - seeded agent config now includes resilience defaults
  - [test/agent-config.test.ts](/test/agent-config.test.ts)
    - resilience overrides load correctly from `agent.json`
  - [test/index.test.ts](/test/index.test.ts)
    - session status now exposes resilience posture
  - [test/agent-runtime.test.ts](/test/agent-runtime.test.ts)
    - `agent_describe_setup` now includes resilience policy and guarantees
- Verification:
  - `pnpm exec vitest run test/setup.test.ts test/agent-config.test.ts test/index.test.ts test/agent-runtime.test.ts`
  - `pnpm exec tsc --noEmit --pretty false`
  - live CLI probe:
    - `pnpm openboa agent session create --name pi-agent`
    - `pnpm openboa agent session status --session <session-id>`
    - observed:
      - `resilienceProfile: resilient`
      - `resilienceRecoverableWakeRetryDelayMs: 5000`
      - `resilienceWakeFailureReplayDelayMs: 2000`
      - `resiliencePendingEventBackoffBaseMs: 2000`
      - `resiliencePendingEventBackoffMaxMs: 30000`
- Outcome:
  - `Resilience` is now a named runtime contract, not just docs language
  - agent setup artifacts, scheduler behavior, and operator-facing status output all expose the same resilience posture

## Loop 085

- Goal: close two live regressions discovered immediately after the resilience contract promotion:
  - legacy config-only agents could fail wake paths because shared workspace bootstrap files were never backfilled
  - watch-mode scenario verification could hang or false-fail when unrelated stale sessions under the same agent polluted the agent-level consumer
- Live failures reproduced:
  - `pi-agent` resilience probe initially failed with:
    - `Wake failed: ENOENT ... /workspace/MEMORY.md`
  - curated rerun with `activation-loop-085` exposed:
    - delayed wake verifier false fail
  - fresh rerun with `activation-loop-086` exposed:
    - watch scenario `079` could stall with the target session left in `rescheduling` because the watch consumer was not scoped to the target session
- Structural change:
  - updated [src/agents/workspace/bootstrap-files.ts](/src/agents/workspace/bootstrap-files.ts)
    - bootstrap reads/writes now self-heal by seeding missing shared workspace files before accessing them
  - updated [src/agents/memory/learnings-store.ts](/src/agents/memory/learnings-store.ts)
    - `readWorkspaceMemory(...)` now backfills shared bootstrap before reading `MEMORY.md`
  - updated [src/index.ts](/src/index.ts)
    - `agent session create` now backfills agent config/workspace before creating a session
  - updated [src/agents/runtime/scenario-loop.ts](/src/agents/runtime/scenario-loop.ts)
    - delayed wake verifier no longer relies on incorrect cross-wake message-count comparison
    - watch scenarios now run with `allowedSessionIds: [targetSessionId]`
  - updated [src/agents/runtime/orchestration.ts](/src/agents/runtime/orchestration.ts)
    - `runAgentLoop(...)` now accepts `allowedSessionIds`
    - activation discovery and wait paths are scoped to the requested session set
  - updated [src/agents/runtime/session-activation-queue.ts](/src/agents/runtime/session-activation-queue.ts)
    - activation listing, leasing, `peekNextReadyAt(...)`, and `waitForChange(...)` now all honor an allowed-session filter
  - updated [src/agents/runtime/session-wake-queue.ts](/src/agents/runtime/session-wake-queue.ts)
    - `peekNextDueAt(...)` now supports the same session scoping used by watch-mode activation polling
- Regression coverage:
  - [test/workspace-memory-bootstrap.test.ts](/test/workspace-memory-bootstrap.test.ts)
    - legacy agent missing `workspace/MEMORY.md` now self-heals
  - [test/index.test.ts](/test/index.test.ts)
    - session creation backfills missing shared workspace bootstrap files
  - [test/activation-queue.test.ts](/test/activation-queue.test.ts)
    - activation queue honors `allowedSessionIds`
  - [test/runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts)
    - watch-mode orchestration can target one session even when another session is already runnable
- Verification:
  - `pnpm exec vitest run test/activation-queue.test.ts test/runtime-scheduler.test.ts test/index.test.ts test/workspace-memory-bootstrap.test.ts`
  - `pnpm exec tsc --noEmit --pretty false`
  - live legacy backfill probe:
    - `pnpm openboa agent session create --name pi-agent`
    - `pnpm openboa agent session send --session <id> --message "Use agent_describe_setup and report the exact resilience retry values ..."`
    - `pnpm openboa agent wake --session <id>`
    - observed:
      - no `ENOENT`
      - `agent.tool_use agent_describe_setup`
      - exact values:
        - `5000 ms`
        - `2000 ms`
        - `2000 ms`
        - `30000 ms`
  - fresh live curated rerun:
    - `pnpm openboa agent scenario-loop --agent activation-loop-088 --suite curated --output /tmp/activation_loop_088_curated.md --model-timeout-ms 45000`
    - result:
      - `executed: 30`
      - `passed: 30`
      - `failed: 0`
- Outcome:
  - legacy agents now self-heal into the current shared bootstrap contract instead of failing on missing `MEMORY.md`
  - watch-mode scenario verification is now session-scoped and no longer contaminated by unrelated stale sessions under the same agent
  - curated live verification is green again after the resilience contract changes
- Artifacts:
  - [/tmp/activation_loop_088_curated.md](/tmp/activation_loop_088_curated.md)
  - [/tmp/activation_loop_088_curated.md.json](/tmp/activation_loop_088_curated.md.json)

## Loop 086

- Goal: remove title-string coupling from curated scenario selection so the scenario catalog can evolve without silently dropping coverage.
- Structural change:
  - updated [src/agents/runtime/scenario-loop.ts](/src/agents/runtime/scenario-loop.ts)
    - `ScenarioDefinition` now carries explicit suite membership metadata
    - curated selection now reads per-scenario metadata instead of matching `category:title` strings after the catalog is built
    - curated coverage is now declared at scenario definition time across bootstrap quotes, introspection, tools, continuity, watch, approval allow/deny, promotion, readback, custom-tool, and delayed-wake paths
  - updated [test/index.test.ts](/test/index.test.ts)
    - added CLI regression for default `scenario-loop` behavior to confirm it still defaults to the curated suite and reports the curated counts
- Verification:
  - `pnpm exec vitest run test/index.test.ts`
  - `pnpm exec tsc --noEmit --pretty false`
  - live curated rerun with default suite:
    - `pnpm openboa agent scenario-loop --agent activation-loop-089 --output /tmp/activation_loop_089_curated.md --model-timeout-ms 45000`
    - result:
      - `suite: curated`
      - `available: 30`
      - `executed: 30`
      - `passed: 30`
      - `failed: 0`
- Outcome:
  - curated scenario selection is now catalog-owned metadata instead of a fragile post-hoc string filter
  - renaming a scenario title no longer risks silently dropping it from the curated suite
  - the default live `scenario-loop` surface still executes the curated suite and closes cleanly at `30/30`
- Artifacts:
  - [/tmp/activation_loop_089_curated.md](/tmp/activation_loop_089_curated.md)
  - [/tmp/activation_loop_089_curated.md.json](/tmp/activation_loop_089_curated.md.json)

## Loop 087

- Goal: make curated suite coverage explicit at the scenario-catalog level, not just suite membership level.
- Structural change:
  - updated [src/agents/runtime/scenario-loop.ts](/src/agents/runtime/scenario-loop.ts)
    - `ScenarioDefinition` now carries `coverage` tags in addition to `suites`
    - curated scenarios declare their coverage at definition time
    - curated selection validation now checks `CURATED_REQUIRED_COVERAGE` rather than category strings
    - added `curatedScenario(...)` helper so suite membership and coverage stay co-located in the catalog
- Expected outcome:
  - curated coverage now encodes the functional bar directly in the catalog
  - future title/category refactors should not silently weaken curated coverage guarantees
- Verification:
  - `pnpm exec vitest run test/index.test.ts`
  - `pnpm exec tsc --noEmit --pretty false`
  - live curated rerun with default suite:
    - `pnpm openboa agent scenario-loop --agent activation-loop-090 --output /tmp/activation_loop_090_curated.md --model-timeout-ms 45000`
    - result:
      - `suite: curated`
      - `available: 30`
      - `executed: 30`
      - `passed: 30`
      - `failed: 0`
- Artifacts:
  - [/tmp/activation_loop_090_curated.md](/tmp/activation_loop_090_curated.md)
  - [/tmp/activation_loop_090_curated.md.json](/tmp/activation_loop_090_curated.md.json)
