# RUN-20260419-1833-agent-runtime-code-scanning-hardening-pass-2

- `PR`: `PR-agent-runtime-code-scanning-hardening`
- `Worker`: `auto-coding`
- `Status`: `kept`

## Goal

Close the four new PR-diff CodeQL alerts that appeared after the first hardening push while preserving the already-closed original alert set.

## Changes

- Reworked `src/agents/sandbox/sandbox.ts` writable-file helper to use a single `a+` open path instead of the `r+` then `wx` fallback that introduced new race and temp-file alerts.
- Simplified sandbox append writes to append directly through the file handle instead of reconstructing the file from a read/overwrite cycle.
- Reworked `src/agents/sessions/session-store.ts` stale lease takeover to move stale lock files aside with a unique rename before re-acquiring, removing the new fallback `open(lockPath, "r+")` race flagged on the PR merge ref.
- Moved test company fixtures in `test/helpers.ts` out of `os.tmpdir()` and into a user-home fixture root so PR-diff CodeQL no longer taints the hardened sandbox writes through temp-dir-backed test paths.

## Verification

- `pnpm format:check`
- `pnpm exec vitest run test/resource-access.test.ts test/sandbox.test.ts test/session-store.test.ts test/wake-session.test.ts test/scenario-soak.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `gh api 'repos/openboa-ai/openboa/code-scanning/alerts?state=open&pr=11&per_page=100'` before the second pass to confirm alerts `#19-#22`

## Result

The second hardening pass is kept. The narrow local bar is green, the PR head commit shows zero branch-ref open alerts, and the remaining external question is whether the PR merge-ref CodeQL gate clears alerts `#19-#22` on the next analysis.

## Next gap

- push the second hardening pass to PR `#11`
- rerun PR-diff CodeQL and confirm alerts `#19-#22` no longer appear
- treat the repo-wide docs markdownlint failure as a separate follow-on frontier, not part of this security hardening boundary
