# AGENTS.md

## Purpose

`.agents/skills/` contains the generic harness skill surface.

Only three buckets are active here:

1. core workers
2. shared protocols
3. optional utilities

Specialist loops are absorbed into the core worker bodies.

## Active Registry

### Core workers

- `auto-project`
  - the only scheduler
- `auto-pm`
  - frontier definition and PR lock
- `auto-coding`
  - bounded implementation and verification
- `auto-qa`
  - functional evaluation and veto
- `auto-ui`
  - live-surface visual and interaction quality
- `auto-wiki`
  - memory writeback and synthesis

### Shared protocols

- `auto-loop-protocol`
- `auto-handoff-protocol`
- `auto-run-memory`
- `auto-promotion-protocol`
- `auto-eval-rubrics`
- `auto-garbage-collection`

### Optional utilities

- `brain-openboa`
- `forge`
- `ci-recovery`
- `harness-skill-audit`

## Routing Rules

Use this order:

1. `auto-project` for full-loop autonomous PR work or when the next owner is unclear
2. the relevant core worker when one stage is explicitly requested
3. a shared protocol when the active worker or owner needs a common contract
4. an optional utility when the task is outside the default harness loop

Do not route through deleted specialist skills.
If a task sounds like scope slicing, PR locking, scenario probing, screenshot comparison, synthesis, or promotion, route to the parent core worker and use its built-in instructions.

## Boundary Summary

### `auto-project`

- owns scheduling
- chooses exactly one next owner
- enforces keep/discard and wiki writeback

### `auto-pm`

- defines one bounded frontier
- does not implement

### `auto-coding`

- changes code to close a correctness, runtime, reliability, architecture, or CI gap
- verification is required before a change is kept

### `auto-qa`

- judges whether the product works
- may veto promotion

### `auto-ui`

- judges whether the live surface reads and feels right
- works from screenshots and live evidence

### `auto-wiki`

- compiles the latest truth back into repo memory
- no state transition is complete until writeback is current

## Memory Model

The harness assumes light wiki memory:

- `wiki/frontiers.md` tracks current frontier state
- `wiki/prs/` exists when a PR page is needed
- `wiki/runs/` exists when run evidence needs to persist

These surfaces are created and updated as needed.
They are not treated as a permanently populated archive.
