---
title: "Architecture"
summary: "Current code reality and layer boundaries for the openboa product stack: Agent, Chat, Work, Observe, and shell adapters."
---
# Architecture


openboa architecture should be read through the product stack first, not through folder names first.

The stable conceptual stack is:

```text
Agent -> Chat -> Work -> Observe
                 \
                  -> shell adapters
```

The shell is important, but it is downstream.
It renders projections from those layers and should not become the owner of truth.

## Layer stack

### `Agent`

The domain-agnostic worker runtime.

It owns:

- sessions
- harness execution
- sandbox and tools
- worker-local runtime memory
- private workspace and learnings

It does not own:

- chat transcript truth
- business commitments
- operator-facing evidence meaning

### `Chat`

The shared office and durable coordination fabric.

It owns:

- rooms, DMs, group DMs, and threads
- participant binding and access rules
- append-only transcript truth
- rebuildable unread, mention, inbox, and transcript projections

It does not own:

- generic agent execution internals
- work commitment semantics
- observe evidence semantics

### `Work`

The business execution layer above chat.

It owns:

- explicit business commitments
- owner and participant assignment
- blocker, approval, result, and execution state semantics
- promotion from chat lineage into durable business execution objects

### `Observe`

The governance and evidence layer above work and execution.

It owns:

- execution refs and session linkage
- operator-facing evidence stitching
- blocked, degraded, and risk visibility
- audit-friendly execution explanation

## Current code reality

The current repository is not yet implemented as four equally mature backend domains.

Today the real code maturity is:

1. `Agent`
   - substantial, session-first runtime under `src/agents/`
2. `Chat`
   - substantial backend truth and projections under `src/chat/`
3. `Work`
   - early product/domain shape carried mostly in shared model types and shell scaffolding
4. `Observe`
   - early product/domain shape carried mostly in shared model types and shell scaffolding

That distinction matters.
The architecture should preserve the long-term boundaries even when the code maturity is uneven.

## Current stable code layout

```text
src/agents/
src/chat/core/
src/chat/policy/
src/chat/projections/
src/shared/
src/shell/
```

The repository does not currently treat these as stable architecture roots:

```text
src/application/
src/transports/
src/control-plane/
```

## Repo mapping

### `src/agents/`

Maps to the `Agent` layer.

Important runtime objects include:

- `AgentDefinition`
- `Environment`
- `Session`
- `SessionEvent`
- `wake(sessionId)`
- `Harness`
- `Sandbox`
- `ToolDefinition`

### `src/chat/core/`

Owns chat truth:

- rooms
- DMs and group DMs
- thread scopes
- membership
- grants
- messages
- reactions
- cursors
- append-only ordering

### `src/chat/policy/`

Owns chat-local command and access behavior:

- joins and leaves
- room commands
- role evaluation
- grant and membership flow
- room settings and archive behavior

### `src/chat/projections/`

Owns rebuildable read models over chat truth:

- unread
- mentions
- latest activity
- transcript shaping
- sidebar discovery
- DM grouping

### `src/shared/`

Holds cross-cutting protocol types and the current shared company model.

This is where early `Work` and `Observe` shapes currently appear.
For example:

- `TopLevelSurfaceState = "chat" | "work" | "observe"`
- `CompanyWorkSurface`
- `CompanyObserveSurface`
- execution refs, work cards, observe evidence, and linked chat context

### `src/shell/`

Holds browser and desktop adapters that render product surfaces.

Current shell code already includes:

- chat surface rendering
- work surface rendering
- observe surface rendering

But the shell should still be read as an adapter layer, not as the owner of business truth.

## Dependency direction

The intended dependency direction is:

```text
entrypoints -> agents/runtime -> agents/sessions + agents/environment + agents/tools + agents/sandbox + shared
entrypoints -> chat/policy -> chat/core -> shared
entrypoints -> chat/projections -> chat/core + shared
shell adapters -> chat/projections + chat/policy + shared
shell adapters -> work/observe projections encoded in shared model + shell controllers
agents -> shared
```

Rules:

1. shell adapters do not invent parallel truth
2. `chat/core` stays below UI-specific behavior
3. `chat/projections` owns rebuildable chat views
4. agent-private journals do not become shared truth automatically
5. `Work` and `Observe` should not be collapsed back into shell-only UI concepts
6. provider backends remain runtime implementations behind the harness seam

## Truth placement

### Agent-private truth

Private execution evidence lives under:

```text
.openboa/agents/<agent-id>/workspace/
.openboa/agents/<agent-id>/sessions/
.openboa/agents/<agent-id>/learn/
```

This includes:

- workspace substrate files
- session event logs
- runtime checkpoints and working buffers
- reusable per-agent learnings

### Shared company truth

Shared company truth lives in an append-only ledger:

```text
.openboa/runtime/company-ledger.jsonl
```

Today that ledger is the main durable home for shared chat truth and early work-shaped shared records.

### Work and Observe today

`Work` and `Observe` are already part of the architecture, but their durable backend contract is still earlier than `Agent` and `Chat`.

Right now they show up mainly through:

- shared company model types in `src/shared/company-model.ts`
- top-level shell tabs for `chat`, `work`, and `observe`
- demo and frame-state scaffolding in `src/shell/web/`

So the architecture should treat them as first-class product surfaces, while also being honest that their backend domains are still being hardened.

## Shell rule

The shell is downstream of domain truth.

- `Agent` owns worker execution
- `Chat` owns coordination truth
- `Work` owns business execution meaning
- `Observe` owns evidence and governance meaning
- the shell renders projections and emits commands

If a surface only exists because the shell currently renders it, that surface is not hardened enough yet.

## Maturity summary

The current maturity split is:

- `Agent`: real runtime
- `Chat`: real shared backend truth
- `Work`: early shared model plus shell scaffolding
- `Observe`: early shared model plus shell scaffolding

That is acceptable as long as the boundaries remain clear.
The main architectural mistake would be to let temporary shell scaffolding redefine the long-term layer model.

## Related reading

- [Agent](./agent.md)
- [Agent Runtime](./agent-runtime.md)
- [Chat](./chat.md)
- [Work](./work.md)
- [Observe](./observe.md)
- [Development](./development.md)
