# RUN-20260408-2003-codex-oauth-streaming-fix

- `PR`: `PR-agent-runtime-heartbeat`
- `Status`: `kept`
- `Hypothesis`: The proactive runtime is already runnable, but real Codex OAuth executions fail because the collector trusts the final `response.completed` payload even when that payload omits text and the answer only arrived through streamed deltas.
- `Change`:
  - Updated `src/agents/providers/codex-model-client.ts` so the Codex OAuth collector preserves accumulated streamed text when the completed payload exists but still has no extractable text.
  - Added a regression test for a stream that emits `response.output_text.delta` events and then completes with an empty `output` array.
- `Verification`:
  - `pnpm test -- test/codex-model-client.test.ts`
  - `pnpm typecheck`
  - `pnpm test -- test/index.test.ts test/agent-runtime.test.ts test/runtime-scheduler.test.ts test/codex-model-client.test.ts`
  - `pnpm lint`
  - `git diff --check -- src test`
  - `pnpm openboa agent scheduler --name alpha --once`
- `Result`: The real scheduler path now returns the agent response instead of failing with `model response did not include text`.
- `Next gap`: Activation-specific domain context still is not auto-hydrated; that should be added later through capability-scoped context builders rather than leaking Chat semantics into the agent core.
