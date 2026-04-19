# RUN-20260419-1702-agent-runtime-code-scanning-hardening-pass

- `PR`: `PR-agent-runtime-code-scanning-hardening`
- `Worker`: `auto-coding`
- `Status`: `kept`

## Goal

Close the currently open CodeQL alerts in the agent runtime hardening boundary by removing the underlying TOCTOU, insecure temp-file, and incomplete sanitization patterns instead of suppressing findings.

## Changes

- Reworked `src/agents/resources/resource-access.ts` to avoid `stat -> use` races in substrate promotion/restore flows by reading source artifacts through file descriptors and writing targets through secure create-or-overwrite helpers instead of pre-checking file paths.
- Kept staged substrate content aligned with the previously hashed source bytes by writing the descriptor-read content directly into the session workspace instead of re-copying by path.
- Hardened `src/agents/sessions/session-store.ts` lease acquisition so stale lock takeover no longer uses `rm(lockPath)` followed by `open(lockPath, "wx")`; takeover now happens through the existing lock file handle and renewal/release only proceeds when ownership still matches.
- Updated `src/agents/runtime/scenario-loop.ts` to escape backslashes and pipes consistently for markdown table cells.
- Aligned directly affected lock-fixture tests with secure `wx` + `0600` lock-file creation semantics and kept sandbox file-handle overwrites position-safe after earlier hardening.

## Verification

- `git diff --check`
- `gh api repos/openboa-ai/openboa/code-scanning/alerts/{12,11,7,6,5,4,3,2,1}` to confirm the exact open production alert messages and locations before patching
- `pnpm install --frozen-lockfile --ignore-scripts`
- `pnpm exec vitest run test/resource-access.test.ts test/sandbox.test.ts`

## Result

The bounded hardening changes are kept. The directly affected `resource-access` and `sandbox` tests now run and pass in this worktree after installing dependencies, but this frontier is not ready for signoff yet because the external acceptance surface is still a fresh GitHub CodeQL pass on the new branch state.

## Next gap

- run GitHub CodeQL on the hardening branch and confirm the current `12`-alert set closes
- run narrow session-store coverage for the stale-lease rewrite now that local Vitest execution is available
