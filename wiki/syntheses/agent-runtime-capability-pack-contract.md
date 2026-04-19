# Agent Runtime Capability Pack Contract

This page hardens how openboa should compose a strong self-directed `Agent` runtime
from runtime-native services plus higher-level capability packs.

Use it when:

- the repo needs to decide what should be built into the `Agent` runtime by default
- external skill references risk being translated too literally instead of mapped into openboa structure
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

## Strong pattern extraction from the four ClawHub skills

Across the referenced skills, four repeatable ideas show up.

### 1. Runtime continuity requires files that the agent itself updates

Seen in:

- self-improving memory tiers and heartbeat state
- proactive-agent `SESSION-STATE.md`, `memory/working-buffer.md`, `HEARTBEAT.md`
- ontology append-only graph files

Common pattern:

- prompt files alone are not enough
- the runtime needs private persistent artifacts it can update during work
- the runtime must recover from compaction or context loss by reading those artifacts

Implication for openboa:

- `Agent` needs runtime-owned files and stores, not only one static system prompt

### 2. Self-improvement is partly runtime-native, not just a skill

Seen in:

- self-improving correction logging and tiered memory
- self-improving-agent `.learnings/` plus promotion into workspace steering files
- proactive-agent WAL protocol and post-task reflection rules

Common pattern:

- the agent needs a place to capture corrections, failures, and better patterns
- some of that can later be promoted into longer-lived steering
- the capture must happen close to the runtime loop, not only through manual user prompting

Implication for openboa:

- correction/error/learning capture should be runtime-adjacent by default
- promotion can still be a higher-level capability

### 3. Proactivity only works when state and follow-through are explicit

Seen in:

- proactive-agent `SESSION-STATE.md`
- working buffer and compaction recovery
- heartbeat checklists
- reminder hooks in self-improving-agent

Common pattern:

- "be proactive" is not enough as a personality instruction
- the runtime needs explicit active-state persistence
- it needs to know what was in progress
- it needs a bounded follow-up mechanism

Implication for openboa:

- proactivity must be modeled as activation + checkpoint + bounded next move
- not as a vague instruction in `SOUL.md`

### 4. Structured shared state should be available, but not always injected

Seen in:

- ontology typed graph, append-only graph log, relation schema, validation, and skill contracts

Common pattern:

- freeform notes are not enough for all memory
- some agent work benefits from typed, queryable, validated state
- but that state should remain a tool/service, not always-on prompt clutter

Implication for openboa:

- ontology-like structured memory should be available as an optional runtime service
- it should not be treated as a default prompt dump

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

Inspired by proactive-agent's `SESSION-STATE.md` and working buffer.

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

Inspired by self-improving and self-improving-agent.

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

Inspired by proactive-agent `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `USER.md`, `HEARTBEAT.md`.

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

## Karpathy `llm-wiki` implication

Karpathy's `llm-wiki` pattern adds an important memory-layering correction.

Source:

- [Karpathy `llm-wiki`](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)

The key pattern is:

- immutable raw sources
- an LLM-maintained compiled wiki
- a schema layer that tells the LLM how to maintain that wiki
- index and log files for navigation and chronology

For openboa `Agent`, that means runtime memory should not collapse into one file.

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
