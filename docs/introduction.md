---
title: "Introduction"
summary: "What openboa is, why it exists, and how to move from doctrine to implementation."
read_when:
  - You are new to openboa
  - You want the shortest path from concept to contribution
---

**openboa** is the project and brand.
Its core concept is **Business of Agents (BOA)**, implemented through the *Business as Agent* operating model.

openboa keeps the **Business** as the durable operating subject and treats agents as an evolvable workforce.

The product stack is:

- `Agent` for the worker runtime
- `Chat` for shared coordination
- `Work` for business execution
- `Observe` for governance and evidence

In one line: **openboa turns ideas into sustained execution with accountable delegation.**

<Note>
openboa is in an early, design-first phase. We prioritize doctrinal clarity and system contracts before production-scale orchestration.
</Note>

## Why now

AI made content generation cheap.
It did not make business execution durable.

The real bottleneck is operational leverage:
- work stalls without continuous prompting
- context breaks across people/agents/tools
- delegation scales faster than accountability

openboa addresses this as a systems problem.

## What openboa is

- A runtime model for **Business continuity** across changing workers and tools.
- A product stack where humans and agents coordinate through shared rooms, DMs, threads, work objects, and evidence surfaces.
- A framework that requires **autonomy + process** together.
- A governance baseline for approvals, auditability, and controlled delegation.
- A docs-first project that defines invariants before implementation scale.

## What openboa is not (current stage)

- Not a production-scale orchestration platform yet.
- Not a generic chatbot framework.
- Not a no-operator fully autonomous system.
- Not feature-count-first product development.

## Product stack

### `Agent`

The domain-agnostic worker runtime:

- session-first execution
- harness, tools, and sandbox
- private workspace and learnings

### `Chat`

The shared office and current primary wedge:

- channels, DMs, group DMs, and threads
- durable transcript truth
- chat-capable humans and agents in one shared fabric

### `Work`

The business execution layer above chat:

- commitments
- ownership
- blockers, approvals, and results
- durable business execution state

### `Observe`

The evidence and governance layer:

- linked execution evidence
- blocked and degraded visibility
- operator-facing explanation of what happened

## Current stage

The surfaces are not all equally mature yet.

Current code reality is:

- `Agent`: real session-first runtime
- `Chat`: real shared backend truth and projections
- `Work`: early shared model plus shell scaffolding
- `Observe`: early shared model plus shell scaffolding

The current first shipping wedge is still:

- **MVP-1: Credible Multi-Agent Company Chat**

The contributor-default runtime for that wedge remains CLI-first.
The repo also already carries a browser host and a first desktop packaging path for the same shell.

## Read in this order

1. **Core Doctrine** — strategic invariants and decision baseline  
   [./concepts/core-doctrine.md](./concepts/core-doctrine.md)
2. **System Contracts** — philosophy translated into enforceable contracts  
   [./concepts/system-contracts.md](./concepts/system-contracts.md)
3. **Business as Agent** — shared model and canonical terms  
   [./concepts/business-as-agent.md](./concepts/business-as-agent.md)
4. **Sharp Non-goals** — explicit exclusions to prevent drift  
   [./help/non-goals.md](./help/non-goals.md)
5. **Architecture** — the current layer model and code reality
   [./architecture.md](./architecture.md)
6. **Agent / Chat / Work / Observe** — the top-level product surfaces
   [./agent.md](./agent.md), [./chat.md](./chat.md), [./work.md](./work.md), [./observe.md](./observe.md)
7. **Agent Runtime** — the detailed session-first Agent runtime and execution seams
   [./agent-runtime.md](./agent-runtime.md)
8. **Development / Quickstart** — local workflow and contribution loop
   [./development.md](./development.md), [./quickstart.md](./quickstart.md)

## Start by role

- **Operator / Founder**: Core Doctrine → Non-goals → Business as Agent
- **Architect / Builder**: System Contracts → Architecture → Agent → Chat → Development
- **Contributor / Reviewer**: Core Doctrine → Development → docs/help pages

## Contribution gate (before implementation)

A proposal is ready only if all are true:
- Improves or protects execution leverage
- Preserves Business-level durability
- Keeps autonomy and accountable process co-existing
- Adds no short-term drift against doctrine
