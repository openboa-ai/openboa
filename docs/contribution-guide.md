---
title: "Contributing"
summary: "Contribution baseline for the generic PR-centric harness used in this repository."
---
# Contributing


## Documentation Conventions

- Keep canonical product and system docs under `docs/`
- Use lowercase kebab-case file names
- Keep thread/PR/ticket context out of official doc body
- Keep technical references in technical docs, not in acknowledgements
- Prefer updating an existing page over creating a new page unless a clearly bounded new subject exists
- Do not preserve legacy document structure only for compatibility

## Knowledge-System Layers

The repository maintains four knowledge layers.

- `raw/`
  - immutable raw sources, screenshots, logs, and evidence
- `wiki/`
  - active PR pages, run pages, synthesis, and chronology
- `.agents/`
  - harness schema, skills, templates, and routing rules
- `docs/`
  - canonical explanation

Contribution rule of thumb:

- if the content is immutable input or evidence, put it in `raw/`
- if it captures active PR state or evolving synthesis, put it in `wiki/`
- if it defines agent behavior, put it in `.agents/`
- if future readers should read it as the canonical explanation, put it in `docs/`

## Documentation Workflow

This repository uses a generic PR-centric harness.

Practical meaning:

- `PR` is the unit of work
- `run` is the unit of iteration
- `wiki` is the unit of memory
- `auto-project` owns scheduling
- `auto-wiki` owns durable writeback
- humans are only the safety gate

When in doubt, start from `docs/README.md`, `.agents/AGENTS.md`, and the active `wiki/` surfaces such as `wiki/frontiers.md`.

## PR Workflow

Every bounded frontier should have:

- one PR page in `wiki/prs/`
- one or more run pages in `wiki/runs/`
- explicit goal, metric, owned boundary, and acceptance criteria

Execution rule of thumb:

- open one PR frontier
- establish a baseline
- change one bounded variable
- measure explicitly
- keep only if better
- record the result in `wiki/`

## Documentation Risk Summary

Use the shared risk bands when changing docs:

- `low`
  - typo, dead link, non-semantic rename
- `medium`
  - metadata, ownership, cross-links, index/log updates
- `high`
  - routing rules, lifecycle rules, promotion rules, durable record changes
- `very high`
  - top-level operating-program changes or cross-subsystem meaning shifts

## Index and Log Hygiene

When a documentation change materially affects structure or navigation:

- update the relevant `wiki/` page if active working state changes
- update `docs/README.md` when discoverability changes
- update `docs/README.md` or the relevant internal `wiki/` synthesis when docs structure or ownership changes

## Commit Convention

- Commit subject format: `type: description`
- Examples:
  - `docs: refine chat contract tree`
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
