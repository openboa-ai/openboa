# openboa Agent Runtime Integration Design

This page turns the upstream OpenClaw source reading into a concrete openboa design.

It answers one question:

- how should openboa add a stronger self-directed agent runtime while staying structurally close to OpenClaw?

Use this page when:

- implementing the next agent-runtime slice
- deciding where activation queue, scheduler, runtime memory, skills, tools, and sandbox belong
- reviewing whether a proposed change is preserving or breaking OpenClaw alignment

## Design thesis

openboa should **not** replace the OpenClaw-aligned `agents` subsystem.

Instead it should:

- preserve the OpenClaw-aligned ingress and execution flow
- add self-direction as a runtime layer inside `src/agents/`
- keep domain semantics out of the agent core
- attach chat/work/observe behavior through capability bindings, not through core runtime ownership

So the right design is:

- **OpenClaw-aligned agent subsystem**
- plus **openboa self-directed runtime add-on inside that same subsystem**

## Non-goals

This design does **not** do the following:

- move agent concerns into new top-level trees outside `src/agents/`
- turn `skills/` into the self-directed runtime
- let `Chat` or `Work` redefine the agent core
- bypass `agent-command` with a totally separate daemon-only execution engine

## What must remain OpenClaw-aligned

The following should stay conceptually intact:

1. `agent-command` remains the canonical command ingress
2. `agent-scope` remains the effective agent-definition resolver
3. `workspace/bootstrap` remains the durable local substrate
4. `skills/` remains discovery + gating + prompt packaging infrastructure
5. `sandbox/` remains the execution-boundary subsystem
6. `auth-profiles/` remains the credential-state and reliability subsystem
7. `embedded runner` remains the actual turn engine

This means openboa should add new runtime behavior without inventing a second unrelated command architecture.

## The core design move

The key move is:

- keep **single-turn execution** on the existing command path
- add **multi-turn self-direction** as a layer above that path

In other words:

- OpenClaw already knows how to run one real turn
- openboa should add a system that decides **when** and **why** that turn should happen again

So the real openboa addition is:

- activation modeling
- runtime checkpointing
- self-follow-up scheduling
- private runtime continuity

not a brand-new agent execution engine

## Canonical execution path

The canonical path should become:

```text
external trigger
-> runtime activation queue
-> runtime scheduler
-> runtime ingress
-> agent-command
-> command/*
-> embedded runner or CLI runner
-> sessions + runtime memory writeback
-> maybe schedule next activation
```

The most important choice here is:

- `agent-command` remains the one true bounded execution ingress for an agent turn

The scheduler does not replace it.

The scheduler only decides when to call it.

## Recommended `src/agents/` structure

```text
src/agents/
  agent-config.ts
  setup.ts
  agent-command.ts
  agent-scope.ts

  command/
  skills/
  sandbox/
  auth-profiles/
  pi-embedded-runner/
  pi-embedded-helpers/
  workspace/
  schema/
  pi-hooks/

  runtime/
    activation-intent.ts
    activation-queue.ts
    scheduler.ts
    runtime-ingress.ts
    self-directed-runtime.ts
    directive.ts

  memory/
    checkpoint-store.ts
    session-state-store.ts
    working-buffer-store.ts
    learnings-store.ts
    runtime-summary-store.ts

  capabilities/
    self-improvement/
    proactivity/
    runtime-memory-hygiene/
    ontology/
    chat-binding/
    work-binding/
    observe-binding/
```

Important rule:

- new openboa layers still belong under `src/agents/`
- but they must attach at explicit seams instead of leaking into every existing folder

## Runtime seam placement

### `runtime/`

Purpose:

- decide if and when a new bounded turn should happen
- schedule or queue that turn
- remember runtime-local continuity

This is where openboa becomes more self-directed than vanilla OpenClaw.

### `memory/`

Purpose:

- store private runtime continuity that is not the same as session transcript history

This includes:

- checkpoint
- current objective sketch
- working buffer
- learnings inbox
- runtime summaries

This is **not** Chat truth and **not** Work truth.

### `capabilities/`

Purpose:

- attach higher-level behavior bundles without polluting the core

This is where:

- self-improvement
- proactivity
- ontology
- later `chat-binding`, `work-binding`, `observe-binding`

should live

## Activation model

The runtime should not model every semantic reason as a closed enum.

Instead use:

- a **small closed operational class**
- a **large open semantic reason**

Recommended shape:

```ts
type ActivationOrigin = "manual" | "external" | "self" | "scheduled"

type ActivationIntent = {
  id: string
  agentId: string
  origin: ActivationOrigin
  reason: string
  dueAt: string
  note?: string
  correlationId?: string
  dedupeKey?: string
  priority?: "low" | "normal" | "high"
  payload?: Record<string, unknown>
}
```

Why this shape is right:

- `origin` is small enough for runtime and scheduler logic
- `reason` stays open so Chat/Work/Observe can add new reasons later
- the agent core stays domain-agnostic

Examples of valid `reason` values:

- `runtime.manual`
- `runtime.follow-up`
- `chat.mention`
- `chat.thread.follow-up`
- `work.assignment.created`
- `observe.policy.alert`

## Scheduler design

The scheduler must **not** be a glorified cron job.

It should be:

- reason-driven
- checkpoint-aware
- dedupe-capable
- lease-based

Minimum responsibilities:

1. load due `ActivationIntent`s
2. acquire a lease for an agent activation
3. coalesce duplicate or redundant intents
4. call runtime ingress once
5. persist the result
6. enqueue any requested follow-up activation

Important rule:

- many triggers
- one queue type
- one bounded runtime ingress

## Runtime ingress design

Introduce a thin ingress such as:

- `runtime/runtime-ingress.ts`

Purpose:

- accept one `ActivationIntent`
- load the runtime checkpoint
- translate the activation into one bounded agent run
- call `agent-command` or an extracted callable equivalent
- persist runtime memory and directive outcome

This layer should be the bridge between:

- runtime scheduling world
- existing OpenClaw-aligned command execution world

It should **not** reimplement session resolution, skills loading, sandbox creation, or model execution.

## Agent-command integration

The design recommendation is:

- keep `agent-command` as the canonical bounded-turn engine
- refactor it just enough so runtime ingress can call it programmatically

That means:

- extract a stable callable command service boundary from `agent-command.ts`
- let CLI and scheduler both use that same boundary

Do **not** create:

- one engine for CLI/manual use
- another engine for scheduler/daemon use

That would drift quickly.

## Runtime memory model

Separate runtime memory from session transcript history.

### `sessions/`

Owns:

- transcript
- provider session ids
- turn-by-turn persisted execution history

### `memory/`

Owns:

- last activation
- current unresolved objective
- bounded next-step note
- follow-up counters
- learnings inbox
- distilled runtime summary

Recommended files per agent:

```text
.openboa/agents/<id>/
  sessions/
  runtime/
    activations.jsonl
    checkpoint.json
    session-state.md
    working-buffer.md
  learn/
    corrections.jsonl
    errors.jsonl
    lessons.jsonl
```

This follows the stronger pattern seen across OpenClaw-aligned runtime design, ClawHub self-improving/proactive patterns, and Karpathy-style compiled memory.

## Where `skills`, `tools`, and `sandbox` fit in the design

### `skills/`

Role:

- tell the runtime what workflow-shaped knowledge is available

In the new design:

- keep using snapshots and precedence
- keep using eligibility gates
- let the runtime choose which bundled behaviors are active

Do **not** turn skills into the scheduler or checkpoint store.

### `tools/`

Role:

- define callable action surfaces

In the new design:

- runtime and capabilities may affect which tools are exposed
- but tool definitions and registry logic still belong to `tools/`

### `sandbox/`

Role:

- enforce execution boundary for the actual turn

In the new design:

- scheduler never bypasses sandbox
- runtime ingress still enters the same sandbox resolution path used by normal command execution

This preserves OpenClaw's strongest architectural advantage:

- there is still one actual execution boundary

## Default bundled capabilities

These should ship with openboa agents by default, but still as add-ons:

- `self-improvement`
- `proactivity`
- `runtime-memory-hygiene`

Why these are not core:

- they are behavior packs, not fundamental execution plumbing

Why they should still be default:

- they are central to the openboa agent personality and operating quality

## Optional capabilities

These should be attachable later:

- `ontology`
- `chat-binding`
- `work-binding`
- `observe-binding`

This preserves the rule:

- agent core does not know Chat or Work
- but the agent subsystem can still host the bindings

## Design phases

### Phase 1: finish the runtime ingress seam

Goal:

- make `agent-command` callable through one stable runtime ingress

Deliverables:

- `runtime/runtime-ingress.ts`
- shared bounded execution path for CLI and scheduler

### Phase 2: add activation queue

Goal:

- persist `ActivationIntent`s and consume them safely

Deliverables:

- `activation-intent.ts`
- `activation-queue.ts`

### Phase 3: add scheduler daemon

Goal:

- support follow-up and event-driven re-entry without cron-style repetition

Deliverables:

- `scheduler.ts`
- lease, dedupe, due activation polling

### Phase 4: add runtime memory

Goal:

- separate session transcript from private runtime continuity

Deliverables:

- `checkpoint-store.ts`
- `session-state-store.ts`
- `working-buffer-store.ts`
- `learnings-store.ts`

### Phase 5: attach default bundled capabilities

Goal:

- make the runtime feel proactive and self-improving without polluting the core

Deliverables:

- default bundled capability loading
- learnings promotion rules
- bounded follow-through rules

## The most important design choice

The single most important choice is this:

**openboa should add self-direction above OpenClaw-aligned bounded execution, not instead of it.**

That means:

- the scheduler does not own agent execution details
- the runtime does not replace `skills/`, `sandbox/`, or `auth-profiles/`
- `Chat` and `Work` do not leak into the core

If openboa preserves that boundary, it can become more autonomous without losing the shape that already makes OpenClaw's `agents` subsystem coherent.
