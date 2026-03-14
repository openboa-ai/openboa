---
title: "Contributing"
summary: "Documentation conventions and contribution baseline for openboa docs."
---

## Documentation Conventions

- Keep docs under `docs/`
- Use lowercase kebab-case file names
- Keep thread/PR/ticket context out of official doc body
- Keep technical references in technical docs (not acknowledgements)

## Commit Convention

- Commit subject format: `type: description`
- Examples:
  - `docs: refine fundamentals chat contract`
  - `feat: add runtime checkpoint recovery`
- Enforcement: pre-commit `commit-msg` hook (`scripts/validate-commit-msg.sh`)

## PR Convention

- PR title format: `type: description`
- PR body must include:
  - `## Summary`
  - `## Checklist`
  - `## Validation`
  - `## Related`
- Template: `.github/pull_request_template.md`
- Enforcement: `.github/workflows/pr-convention.yml`

## Merge-Gate Check Matrix (v1)

Gate mode for v1 is `strict-required core only`.

| Status check | Required | Applies to | Merge-pass semantics | Notes |
| --- | --- | --- | --- | --- |
| `ci / required-ci` | yes | every PR targeting `main` | must be `success` | Aggregate gate from `.github/workflows/ci.yml`. It passes only when scoped sub-jobs are successful or intentionally skipped because they are out of scope. |
| `PR Convention / convention` | yes | every PR targeting `main` | must be `success` | Validates PR title and required body sections from `.github/workflows/pr-convention.yml`. |
| `codeql / analyze (javascript-typescript)` | no | PRs and pushes on `main` | advisory only for merge-gate v1 | Security findings still require reviewer judgment, but this status is not branch-protected in v1. |
| `check`, `docs`, `secrets`, `gitleaks` job statuses | no | emitted inside `ci` workflow | advisory only for branch protection | These jobs are owned by `ci / required-ci` and should not be duplicated as separate required checks. |

Reviewer merge checklist:
- `ci / required-ci` is green.
- `PR Convention / convention` is green.
- Required review count is satisfied.
- No unresolved security concern remains from advisory checks.

## Branch Protection (Main)

Repository admins should enforce:

- pull request required
- force-push disabled
- required checks:
  - `ci / required-ci`
  - `PR Convention / convention`
- at least 1 approving review
- dismiss stale approvals on new commits

Alignment rules:
- Require status checks to pass before merging.
- Do not mark `codeql / analyze (javascript-typescript)` as required in v1.
- Do not mark `check`, `docs`, `secrets`, or `gitleaks` as separate required checks; `ci / required-ci` is the only CI gate.
- Restrict bypass permission to repository admins only.

## Temporary Bypass Path (False Failures Only)

Use a bypass only when a required check is believed to be a tooling or platform false failure, not when product or test risk is unresolved.

Required conditions:
- the failing run URL is linked in the PR discussion
- an approver documents why the failure is believed to be false
- a follow-up issue or incident is linked before merge
- the bypass is approved by a repository admin
- the bypass applies to a single PR only

Time bound:
- restore normal required-check enforcement immediately after the merge
- if the root cause is still open, track it in the linked follow-up issue and avoid repeating bypasses without fresh admin review

## Naming

- ✅ `runtime-architecture.md`
- ✅ `access-control.md`
- ❌ `RuntimeArchitecture.md`
- ❌ `runtime_architecture.md`

Allowed uppercase convention files:
- `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE`
