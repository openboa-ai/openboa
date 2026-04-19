# RUN-20260419-1219-agent-runtime-capability-ingress-pass

- `PR`: `PR-agent-runtime-capability-ingress`
- `Worker`: `auto-project`
- `Status`: `kept`

## Goal

Isolate the next post-resilience Agent frontier around capability-aware session ingress, managed resources, retrieval, outcomes, traces, and soak tooling, then prove that the staged boundary passes its narrow verification bar as a self-contained slice.

## Changes

- Opened `PR-agent-runtime-capability-ingress` as the follow-on frontier after resilience.
- Isolated one staged boundary around:
  - managed runtime tools
  - session-attached resources and retrieval
  - provider runtime contract and Codex conformance
  - session context/search/traces
  - activation journal plus soak runners
  - sandbox/resource/runtime boundary handling
- Added the missing agent-boundary helper script and aligned `chat-delivery` with the new Agent `BuiltContext` type so the staged runtime surface can verify in isolation.
- Verified that the branch-wide TypeScript blocker sat outside this frontier in the legacy web chat runtime shim, then removed that shim in the preceding cleanup commit `47654dd`.

## Verification

- `pnpm exec vitest run test/agent-import-boundary.test.ts test/codex-model-client.test.ts test/loop-directive.test.ts test/memory-version-store.test.ts test/resource-access.test.ts test/resource-version-store.test.ts test/retrieval-query.test.ts test/retrieval-search.test.ts test/runtime-tool-definition.test.ts test/sandbox.test.ts test/scenario-soak.test.ts test/session-context-builder.test.ts test/session-id.test.ts test/session-store.test.ts test/session-traces.test.ts test/system-prompt-structure.test.ts test/wake-session.test.ts`
- `pnpm exec tsc --noEmit --pretty false`

## Result

The capability-ingress boundary is now isolated well enough to stand on its own narrow verification bar. The remaining gap is not boundary drift or compilation breakage; it is follow-up live Codex soak evidence and human review of the new managed capability surfaces.

## Next gap

- rerun live Codex-backed soak coverage for the capability-ingress boundary
- then request review on the bounded frontier instead of the whole dirty branch
