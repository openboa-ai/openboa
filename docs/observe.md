---
title: "Observe"
summary: "The governance and evidence surface that makes execution visible, accountable, and explainable."
---

`Observe` is the operator-facing evidence layer in openboa.

It is not the primary shipped wedge today, but it is still a first-class product surface.
If it is treated as an afterthought, execution trust collapses into private runtime logs and anecdotal status updates.

## Core thesis

`Observe` is the governance and evidence surface for openboa.

It is:

- the operator-facing explanation layer for execution
- the place where work status becomes accountable
- the surface that turns raw traces into believable evidence

It is not:

- the agent runtime itself
- the source of work commitment truth
- a generic monitoring dashboard disconnected from business context

## Why Observe matters

Without a real Observe layer:

- work can look healthy while execution reality stays hidden
- agent status becomes private runtime trivia instead of shared accountability
- governance turns into raw logs instead of believable operator visibility

With a real Observe layer:

- active execution becomes inspectable
- blocked or risky work becomes visible early
- linked chat context and execution evidence stay connected
- operators can review what happened without entering the worker runtime itself

## Primary responsibilities

Observe exists to make business execution visible and explainable.

That includes:

- linked work items and execution references
- operator-facing evidence and recent runtime events
- blocked, waiting, and degraded-state visibility
- conversation context that explains why the work exists
- audit-friendly presentation of what happened and when

At a stable product boundary, `Observe` should own:

- execution refs and session linkage
- operator-facing evidence stitching
- risk and blocked-state visibility
- auditability and policy visibility

`Observe` should not own:

- chat transcript truth
- work commitment truth
- low-level runtime execution mechanics
- policy enforcement that belongs below the surface itself

## Relationship to Work

`Work` defines the commitment and execution object.

`Observe` does not replace that layer.
It reads from `Work` and explains execution around it:

- what is active
- what is blocked
- what evidence exists
- which agent sessions are relevant

So:

- `Work` is execution and commitment truth
- `Observe` is evidence and governance truth

## Relationship to Chat

`Observe` should read from `Chat`, not redefine it.

`Chat` provides:

- transcript facts
- scope boundaries
- participant activity
- recent shared context around a work item

Observe uses those facts to explain execution in business context instead of showing isolated logs.

## Relationship to Agent

`Agent` owns session mechanics and local worker execution.

`Observe` should not take over the runtime.
It turns relevant execution traces into operator-facing accountability and trust signals.

## Current code shape

The current repo already contains early Observe scaffolding:

- `src/shared/company-model.ts` defines `observe` as a top-level shell surface
- `src/shared/company-model.ts` already carries linked work summaries, linked chat context, and agent evidence structures
- `src/shell/web/components/observe/` contains a first Observe workspace
- the shared shell model already links work summaries, chat context, and agent evidence

So Observe is not just a future note.
It already influences how the shell and shared company model are shaped.

## Related reading

- [Architecture](./architecture.md)
- [Chat](./chat.md)
- [Work](./work.md)
- [Agent](./agent.md)
- [Agent Runtime](./agent-runtime.md)
