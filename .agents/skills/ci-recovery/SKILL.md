---
name: "ci-recovery"
description: "Harness-aligned CI recovery utility. Use when a PR has failing GitHub Actions checks and the next step is to inspect runs, extract actionable failure evidence, and hand a bounded fix packet back to the current worker."
---

# CI Recovery

Use `gh` to locate failing PR checks, fetch GitHub Actions logs, summarize the actionable failure,
and return a bounded recovery packet.

This skill is a utility for `auto-coding`, `auto-qa`, or `auto-project`.
It is not a replacement for the PR loop.

Prerequisite: authenticate with GitHub CLI once and confirm with `gh auth status`.

## Inputs

- `repo`: path inside the repo, default `.`
- `pr`: PR number or URL, optional when the current branch already has a PR
- working `gh` authentication for the repo host

## Quick start

```bash
python "<path-to-skill>/scripts/inspect_pr_checks.py" --repo "." --pr "<number-or-url>"
```

Add `--json` when machine-readable output is easier to process.

## Workflow

1. Verify `gh` authentication with `gh auth status`.
2. Resolve the current PR.
   - prefer `gh pr view --json number,url`
   - or use the explicit PR number/URL
3. Inspect failing checks.
   - preferred:
     ```bash
     python "<path-to-skill>/scripts/inspect_pr_checks.py" --repo "." --pr "<number-or-url>"
     ```
   - fallback:
     ```bash
     gh pr checks <pr> --json name,state,bucket,link,startedAt,completedAt,workflow
     gh run view <run-id> --log-failed
     ```
4. Treat non-GitHub Actions checks as external and report only the details URL.
5. Return a recovery packet containing:
   - failing check name
   - run URL
   - smallest actionable root-cause summary
   - recommended next owner
6. If the current worker owns the boundary, fix and recheck immediately.
7. Re-run relevant tests and `gh pr checks` to confirm recovery.

## Bundled resource

### `scripts/inspect_pr_checks.py`

Fetch failing PR checks, pull GitHub Actions logs, and extract a failure snippet.
It exits non-zero when failures remain so the calling worker can keep the loop honest.
