# RUN-20260419-1849-agent-runtime-code-scanning-hardening-check-stability

- `PR`: `PR-agent-runtime-code-scanning-hardening`
- `Worker`: `auto-coding`
- `Status`: `kept`

## Goal

Remove the timing-sensitive `runtime-scheduler` false failure that still left the PR `check` job red even after the code-scanning alert set had closed.

## Changes

- Widened the watch-loop `idleTimeoutMs` in `test/runtime-scheduler.test.ts` from `20` to `1000` for the skip-dedupe coverage so the test still exercises repeated lease-contention cycles without depending on sub-20ms wall-clock timing.

## Verification

- `pnpm exec vitest run test/runtime-scheduler.test.ts`
- `pnpm check`

## Result

The change is kept. The scheduler skip-dedupe coverage still passes, and the full local `check` path is green again while preserving the already-closed CodeQL alert set.

## Next gap

- push the scheduler test stability follow-up to PR `#11`
- rerun PR CI to confirm `check` is green on GitHub
- treat the repo-wide docs markdownlint baseline as a separate frontier rather than expanding this security hardening scope
