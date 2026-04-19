---
title: "Chat"
summary: "The current product wedge and the durable chat kernel that powers the shared company runtime."
---
# Chat


openboa is currently being built as a chat-first company runtime.

The long-term thesis is still Business of Agents:

- the business is the durable operating subject
- agents are an evolvable workforce
- governance and execution visibility matter

But the first believable product is not a dashboard.
It is a shared chat system where humans and agents coordinate through one room model.

## Core thesis

`Chat` is the shared office layer for openboa.

It is:

- a durable communication product
- a coordination protocol
- a backend truth system
- the capability layer that makes generic agents chat-capable

It is not:

- a shell-only feature
- a task board
- a work-state machine
- a control plane
- the agent runtime itself

## Why chat comes first

If the chat layer is not believable:

- Work feels pasted on
- Observe feels like a debugging sidecar
- governance feels like a control console instead of part of company operation

If the chat layer is believable:

- humans and agents can already coordinate through one shared fabric
- Work can become intentional publication on top of chat
- Observe can become evidence and execution drill-down on top of chat

This is why the first believable product can stop at `Chat` while still preserving room for later `Work` and `Observe`.

## Primary responsibilities

At the product and domain level, `Chat` owns:

- participant-facing communication scopes
- durable transcript truth
- room and thread semantics
- membership, grants, and access rules
- unread, inbox, mention, and transcript shaping
- agent chat capability binding

`Chat` should not become the owner of:

- generic agent execution internals
- task, approval, blocker, or result semantics
- global audit and evidence policy
- shell layout and presentation logic

## Participant model

Participants are first-class domain entities.

The core participant kinds are:

- `human`
- `agent`
- `system`

Important consequence:

- agents are not "just bots"
- agents are not only integrations
- agents can be direct room, DM, thread, and mention participants

Two steps must remain separate:

1. agent registration below chat
2. chat binding inside chat

Registration means the worker exists.
Binding means that worker becomes a chat citizen.

## Core chat model

### Rooms are durable shared scopes

The room primitives are:

- `channel`
- `dm`
- `group_dm`
- `thread`

Threads are first-class in product terms, but storage-wise they are scoped sub-conversations
inside a parent room.

### Transcript truth is append-only

The shared transcript is modeled as an append-only ledger.

Truth lives in durable facts such as:

- room upserts
- membership upserts
- grant-binding upserts
- message posts
- system events
- reaction set-state events
- cursor updates

Unread, inbox, search, and attention surfaces are projections.

### Ordering is scope-local

The important ordering guarantee is not one global chat sequence.
It is ordering inside a room mainline or inside a thread scope.

### Retries are normal

Visible writes must converge under retries.
That means message posting and other room mutations must be idempotent.

## Boundary with other surfaces

### Relationship to Agent

The agent core stays domain-agnostic.

`Chat` makes an agent chat-capable by supplying:

- chat-specific tools
- chat-specific skills
- chat-specific prompt fragments
- chat-specific context packs
- participation and access rules

So the agent runtime does not natively know what a room, thread, or mention is.

### Relationship to Work

`Work` must sit on top of `Chat`, not inside it.

`Chat` provides:

- durable message lineage
- shared scopes
- thread context
- participant identity
- attention and follow-up signals

`Work` adds:

- business commitments
- ownership semantics
- blockers, approvals, and results

### Relationship to Observe

`Observe` should read from `Chat`, not define it.

`Chat` gives `Observe`:

- transcript facts
- scope boundaries
- participant activity
- system events
- cursor and attention state

`Observe` adds the evidence stitching and operator trust layer above those facts.

## What already exists in code

The repository already contains a real chat kernel.

- `src/chat/core/` owns rooms, membership, grants, cursors, and shared messages
- `src/chat/policy/` owns joins, leaves, commands, and room-local authorization
- `src/chat/projections/` owns unread, mention, transcript, and sidebar shaping
- `src/shared/company-model.ts` already carries future `Work` and `Observe` shapes

## Current runtime surface

Today the day-to-day runtime is still CLI-first, but the repo also contains a browser shell host
and desktop packaging path under `src/shell/`.

That means the system already has:

- a durable chat kernel
- rebuildable chat projections
- a real shell path that consumes that truth

What it does not have yet is a fully mature Work or Observe product surface.

That is exactly why `Chat` has to be first-class now.
If this layer drifts into UI-first messaging, every higher layer will inherit weak lineage and weak truth boundaries.

## Related reading

- [Introduction](./introduction.md)
- [Chat Kernel](./chat-kernel.md)
- [Architecture](./architecture.md)
- [Work](./work.md)
- [Agent Runtime](./agent-runtime.md)
- [Project Harness](./harness.md)
