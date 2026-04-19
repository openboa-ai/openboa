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
  - concrete design for adding self-direction to openboa while preserving the OpenClaw-aligned `agents` subsystem shape and canonical bounded-turn path
- `syntheses/claude-managed-agents-synthesis.md`
  - source-first synthesis of Claude Managed Agents as a scalable session/resource/event runtime and the resulting adaptation points for the next openboa agent frontier
- `syntheses/claude-managed-agents-gap-analysis.md`
  - internal frontier-tracking comparison between Claude Managed Agents and the current openboa Agent runtime
- `syntheses/chat-layer-contract.md`
  - detailed working contract for `Chat` as a backend-first coordination layer and product surface independent of `Work`
- `syntheses/chat-purpose-contract.md`
  - purpose-first working contract for `Chat` as the first believable product layer and AI-native shared office, even while MVP remains chat-first
- `syntheses/chat-participant-binding-contract.md`
  - deeper working contract for how registered participants become chat citizens through binding, membership, reachability, and room-local rights
- `syntheses/chat-thread-semantics-contract.md`
  - deeper working contract for thread as a real scoped sub-conversation, not a shell-only comment pattern
- `syntheses/chat-attention-contract.md`
  - deeper working contract for cursor, follow, unread, mention, and inbox semantics as a durable attention model
- `syntheses/chat-agent-runtime-port-contract.md`
  - deeper working contract for the thin boundary `Chat` should depend on instead of concrete agent runtime internals
- `syntheses/work-layer-contract.md`
  - detailed working contract for `Work` as the business execution layer that publishes durable action objects on top of `Chat`
- `syntheses/work-purpose-contract.md`
  - purpose-first working contract for why `Work` exists even in a chat-first MVP, centered on business commitment and execution publication
- `syntheses/work-assetization-contract.md`
  - detailed working contract for the promotion boundary between private agent execution and durable business-owned work assets

## Working principle

Do not use `wiki/` as a second public docs tree.

`wiki/` is where the project thinks.
`docs/` is where the project explains.
