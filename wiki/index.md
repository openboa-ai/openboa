# Wiki Index

This is the internal working-memory hub for the repository.

Use `wiki/` for material that is:

- internal
- still changing
- PR-specific
- run-specific
- not ready to be promoted into public docs

Use `docs/` for material that is:

- public
- canonical
- externally meaningful
- stable enough to explain the system to readers without internal context

## What this directory is for

`wiki/` exists so the repository can keep reasoning, frontier state, and accumulated internal conclusions without polluting public docs.

This directory is the right place for:

- syntheses
- PR memory
- run logs
- frontier ordering
- internal design rules

It is not the right place for polished product explanations meant for public docs readers.

## Main entry pages

- `frontiers.md`
  - current frontier ordering
- `harness.md`
  - internal project harness memory
- `log.md`
  - append-only chronology of meaningful wiki changes
- `syntheses/docs-authoring-boundary.md`
  - internal rule for keeping public docs separate from internal authoring notes
- `prs/`
  - PR-level memory
- `runs/`
  - run-level evidence and chronology
- `syntheses/`
  - durable internal conclusions

## Promotion rule

Use this rule:

- if the idea is still being sharpened, keep it in `wiki/`
- if the idea is stable and public-facing, promote it to `docs/`
- if the content is raw source material, keep it in `raw/`

## Current active syntheses

Start here when the team is still hardening meaning or architecture before promotion into `docs/`.

- `syntheses/openboa-layer-model.md`
  - working system-layer model for `Agent`, `Chat`, `Work`, `Observe`, adapters, and truth/projection/controller/UI boundaries
- `syntheses/agent-runtime-self-direction-contract.md`
  - deeper working contract for self-directed Agent runtime behavior
- `syntheses/agent-runtime-capability-pack-contract.md`
  - deeper working contract for runtime-native services, bundled packs, and optional packs
- `syntheses/openboa-agent-architecture-contract.md`
  - deeper working contract for the `src/agents/` subsystem layout
- `syntheses/agent-runtime-primitive-discipline.md`
  - internal rule for when Agent work should stay inside existing seams versus when a new primitive is justified
- `syntheses/agent-docs-information-architecture.md`
  - internal design for how the public Agent docs should be structured and read
- `syntheses/openclaw-agents-source-reading.md`
  - source-first reading of upstream OpenClaw `src/agents/`
- `syntheses/openboa-agent-runtime-integration-design.md`
  - design for adding self-direction while preserving the OpenClaw-aligned agents subsystem shape
- `syntheses/claude-managed-agents-reverse-engineering.md`
  - reverse engineering of Claude Managed Agents and resulting adaptation points
- `syntheses/claude-managed-agents-gap-analysis.md`
  - internal frontier-tracking comparison between Claude Managed Agents and the current openboa Agent runtime

## Working principle

Do not use `wiki/` as a second public docs tree.

`wiki/` is where the project thinks.
`docs/` is where the project explains.
