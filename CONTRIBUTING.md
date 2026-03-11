# Contributing to openboa

Thanks for contributing to openboa.

## Development Environment
- Node.js `>=22.12.0`
- pnpm `10.x` (via Corepack)
- Python 3 (for pre-commit tooling)

## Setup
```bash
corepack enable
pnpm install
```

## Pre-commit Setup
```bash
python3 -m pip install pre-commit detect-secrets
pre-commit install
pre-commit install --hook-type pre-push
pre-commit install --hook-type commit-msg
pre-commit run --all-files
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

## Branch Protection (Main)
Repository admins should enforce:
- pull request required
- force-push disabled
- required checks:
  - `ci / required-ci`
  - `PR Convention / convention`
- at least 1 approving review
- dismiss stale approvals on new commits
