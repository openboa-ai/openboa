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

## Naming

- ✅ `runtime-architecture.md`
- ✅ `access-control.md`
- ❌ `RuntimeArchitecture.md`
- ❌ `runtime_architecture.md`

Allowed uppercase convention files:
- `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE`
