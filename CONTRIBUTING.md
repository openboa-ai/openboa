# Contributing to openboa

Thanks for contributing to openboa.

## Development Environment
- Node.js `>=22.12.0`
- pnpm `10.x` (via Corepack)
- Python 3 (for pre-commit tooling)

## Setup
```bash
corepack enable
pnpm install --frozen-lockfile
```

If you switch branches or pull changes that update tooling, rerun `pnpm install --frozen-lockfile` before trusting local `pnpm precommit:check` results. This keeps Biome and other repo-pinned CLIs aligned with CI.

## Pre-commit Setup
```bash
python3 -m pip install pre-commit detect-secrets
pre-commit install
pre-commit install --hook-type commit-msg
pre-commit run --all-files
```

## Mandatory Pre-commit Profile (v1)

`Core+Type` is the required baseline for every commit.

### Hard-block checks
- repository hygiene: trailing whitespace, EOF newline, YAML syntax, merge markers, private keys
- `pnpm precommit:check`
  - `pnpm format:check`
  - `pnpm lint`
  - `pnpm typecheck`

Rationale: these checks catch the highest-frequency local failures without pushing commit latency beyond the current v1 budget.

### Advisory checks
- `pnpm test`
- `pre-commit run --hook-stage manual advisory-test-profile`
- `pre-commit run --hook-stage manual detect-secrets`
- `pre-commit run --hook-stage manual actionlint`
- `pre-commit run --hook-stage manual zizmor`

Rationale: tests and heavier security/workflow scans remain important, but they are not part of the mandatory commit-time gate in v1.

## Verification

Single-command baseline verification:

```bash
pnpm precommit:check
```

## Standard Checks
```bash
pnpm check:policy
pnpm check
pnpm check:docs
pnpm docs:linkcheck
```

## CI Ownership And Exception SLA

- `.github/CODEOWNERS` must use real GitHub owners. Placeholder values are blocked in CI.
- Temporary CI/security exceptions live in `.github/ci-exceptions.json`.
- Each exception must include `id`, `owner`, `openedOn`, `expiresOn`, `reason`, and `trackingIssue`.
- Default SLA is 14 days. CI fails if an exception is expired or exceeds that SLA.

## Commit Convention

Commit subject format (required):

`type: description`

Examples:

- `docs: refine fundamentals chat contract`
- `feat: add runtime checkpoint recovery`

Enforced by pre-commit `commit-msg` hook (`scripts/validate-commit-msg.sh`).

## PR Convention

### Title format (required)

`type: description`

Examples:

- `docs: refine fundamentals chat contract`
- `feat: add runtime checkpoint recovery`

Dependabot compatibility:

- `dependabot[bot]` PRs may use generated dependency-update titles such as `Bump vite from 7.1.10 to 7.1.11`.
- Dependabot PR bodies are not required to include the human PR template sections.

### Body sections (required)

- `## Summary`
- `## Checklist`
- `## Validation`
- `## Related`

Use the PR template in `.github/pull_request_template.md`.

## PR Guidelines
- Keep changes focused and small.
- Explain what changed and why.
- Include tests or explain why tests are not needed.
- Call out security impact when relevant.
- Update documentation when behavior changes.

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
<<<<<<< HEAD
=======

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
>>>>>>> 1cf5506 (ci: define mandatory pre-commit baseline profile)
