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
pre-commit run --all-files
```

## Standard Checks
```bash
pnpm check
pnpm check:docs
pnpm docs:linkcheck
```

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
- required check: `ci / required-ci`
- at least 1 approving review
- dismiss stale approvals on new commits

