# Agent Runtime Capability Pack Contract

This page hardens how openboa should compose a strong self-directed `Agent` runtime
from runtime-native services plus higher-level capability packs.

Use it when:

- the repo needs to decide what should be built into the `Agent` runtime by default
- `self-improving`, `proactive`, or `ontology` ideas need to be mapped into openboa-native runtime design

This is a working synthesis, not yet the final canonical architecture page.

## Design question

The question is not:

- "Which marketplace skills should we install?"

The deeper question is:

- "Which capabilities must be runtime-native for every openboa agent?"
- "Which capabilities should be default packs shipped with the runtime?"
- "Which capabilities should remain optional higher-layer packs?"

That split matters because some patterns are too fundamental to leave as prompt-only add-ons.

## Runtime needs

- Persist private state the agent can update and recover after context loss.
- Capture corrections, failures and durable lessons close to their run.
- Represent follow-through as activation, checkpoint and a bounded next action.
- Make typed shared state queryable through services when needed.

## What openboa should make runtime-native

These should not be optional marketplace-style skills.
They should be part of the base `Agent` runtime itself.

### 1. Activation + checkpoint core

This is the foundation.

Runtime-native responsibilities:

- activation intake
- checkpoint persistence
- bounded turn execution
- loop directive parsing
- follow-up scheduling
- no-op and runaway guards

Without this, there is no self-directed agent.

### 2. Session-state WAL

Runtime-native responsibilities:

- capture the current bounded objective
- capture the last important decisions before responding
- survive compaction or session restart
- distinguish active state from long-term memory

Recommended openboa split:

- `checkpoint.json`
  - machine-friendly runtime state
- `session-state.md`
  - human-readable active state summary
- `working-buffer.md`
  - high-churn danger-zone capture for long sessions

These are runtime files, not optional skills.

### 3. Learnings inbox

Runtime-native responsibilities:

- capture corrections
- capture runtime/tool errors
- capture strong reusable lessons
- avoid silent loss of execution-quality learning

Recommended openboa storage:

```text
.openboa/agents/<id>/learn/
  corrections.jsonl
  errors.jsonl
  lessons.jsonl
```

This should exist by default for every agent.
Promotion out of it can be optional and policy-driven.

### 4. Runtime steering bundle

Not all of those names should be reused literally, but the concept is correct:

- identity / principles
- tool gotchas
- heartbeat instructions
- current mission or role

Recommended openboa runtime-native steering files:

```text
.openboa/agents/<id>/steering/
  identity.md
  mission.md
  tools.md
  heartbeat.md
```

These should be loaded selectively by the runtime context engine, not blindly concatenated every turn.

## What openboa should ship as default capability packs

These are not lower-layer runtime primitives, but they should still be bundled and available by default.

### Pack A: `self-improvement`

Purpose:

- turn corrections and failures into compounding execution-quality improvements

Responsibilities:

- classify corrections
- classify errors
- suggest promotion candidates
- maintain a small active lesson set

Why this should be a default pack:

- it compounds runtime quality across sessions
- it stays domain-agnostic

Why it should not be core:

- promotion policy and memory-shaping rules can evolve independently from the runtime loop

### Pack B: `proactivity`

Purpose:

- convert the self-directed runtime into useful initiative

Responsibilities:

- detect candidate proactive follow-ups
- decide whether to stay quiet or surface something
- enforce "bounded helpfulness" instead of random initiative
- maintain check-in thresholds and quiet hours

Why this should be a default pack:

- openboa wants agents that act like owners, not passive tools

Why it should not be core:

- initiative thresholds are policy and product choices, not runtime invariants

### Pack C: `runtime-memory-hygiene`

Purpose:

- compact and curate private runtime memory safely

Responsibilities:

- summarize old session-state data
- compact the working buffer
- move stale learnings into archive
- refresh indexes and retention markers

This should be default because every long-lived agent needs hygiene.

## What openboa should keep optional

These should be available, but not loaded by default for every agent.

### 1. `ontology`

The ontology skill is valuable, but it should be treated as a structured runtime service or optional pack.

Why optional:

- not every agent needs typed graph memory
- the graph can become heavy and noisy
- it is best used when cross-skill/shared-state requirements justify it

Correct placement in openboa:

- built-in service available to the runtime
- optional capability pack that exposes entity/relation CRUD and query tools
- not an always-loaded prompt file

### 2. Domain packs

Examples:

- chat
- work
- observe

These sit above the runtime and must remain optional so the core stays domain-agnostic.

## Recommended openboa bundle model

The runtime should be composed in three layers.

### Layer 1: Runtime-native services

Always present:

- activation queue client
- scheduler contract
- checkpoint store
- session-state store
- working buffer
- learnings inbox
- steering loader
- tool/auth/sandbox/provider substrate

### Layer 2: Default bundled packs

Installed and available by default:

- `self-improvement`
- `proactivity`
- `runtime-memory-hygiene`

These are part of the standard openboa agent experience.

### Layer 3: Optional packs

Attach only when needed:

- `ontology`
- `chat`
- `work`
- `observe`
- domain-specific packs

## The key architectural correction

Do not treat every useful behavior as a "skill."

Some things are too fundamental to be mere prompt attachments.

For openboa:

- activation
- checkpointing
- session-state
- working buffer
- learnings capture

should be runtime surfaces.

Then packs can sit on top and remain composable.

## Runtime memory layers

The runtime should distinguish at least four memory layers:

### 1. Raw execution traces

Append-only, never rewritten.

Examples:

- raw session transcripts
- tool outputs
- activation history
- error events

### 2. Active working memory

High-churn, current-task state.

Examples:

- `checkpoint.json`
- `session-state.md`
- `working-buffer.md`

### 3. Compiled runtime knowledge

LLM-maintained summaries and stable runtime learnings.

Examples:

- distilled lessons
- stable tool gotchas
- proven workflow patterns
- compact agent-local memory that should survive beyond one task

### 4. Schema and steering

The rules that tell the agent how to maintain all of the above.

Examples:

- identity
- mission
- heartbeat rules
- pack-specific maintenance instructions

This means openboa should not store all runtime memory in a single `MEMORY.md`-style file.
Instead it should combine:

- append-only raw traces
- mutable active state
- LLM-maintained compiled learnings
- explicit steering/schema files

That layering is what makes self-directedness durable instead of fragile.

## Concrete filesystem recommendation

For each agent:

```text
.openboa/agents/<id>/
  agent.json
  workspace/
  sessions/
  runtime/
    activations.jsonl
    heartbeat.jsonl
    checkpoint.json
    session-state.md
    working-buffer.md
  learn/
    corrections.jsonl
    errors.jsonl
    lessons.jsonl
  steering/
    identity.md
    mission.md
    tools.md
    heartbeat.md
  packs/
    self-improvement/
    proactivity/
    runtime-memory-hygiene/
```

Optional services:

```text
.openboa/agents/<id>/knowledge/
  ontology/
    graph.jsonl
    schema.yaml
```

The ontology service should only be used when the attached packs or tasks require it.

## Runtime context loading rule

Do not always load every file.

Recommended order:

1. runtime-native checkpoint and session-state
2. steering files relevant to the activation
3. small active lessons set
4. only the packs relevant to the current activation reason
5. optional ontology queries on demand

This keeps context disciplined.

## Next implementation direction

The next openboa runtime slice should not directly implement all of these packs at once.

Recommended order:

1. activation queue + scheduler daemon
2. checkpoint + `session-state.md`
3. learnings inbox
4. bundled `self-improvement` pack
5. bundled `proactivity` pack
6. optional ontology service and pack

That order preserves a clean core while still moving toward a genuinely self-directed agent runtime.
