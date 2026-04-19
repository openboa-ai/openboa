---
title: "Work"
summary: "The future execution and assetization layer above Chat, documented now so the current runtime does not drift."
---

`Work` is not the current primary wedge, but it is already part of the product architecture.

The important point is:

- `Work` is not a board pasted onto Chat
- `Work` is the business execution layer above Chat

## Core thesis

`Work` turns selected coordination into explicit business commitment and execution.

It is:

- a business publication layer
- an execution semantics layer
- the place where commitment becomes owned action
- the layer where transient execution becomes company-owned durable state and assets

It is not:

- the reason `Chat` exists
- the agent runtime
- the global governance plane
- just a board UI

## Why it matters now

Even before Work ships as a primary product surface, it already affects how lower layers should be built.

If Chat and Agent are designed without Work in mind:

- important execution commitments become hard to publish durably
- session outputs become transient instead of company-owned assets
- approval and blocker semantics get bolted on too late

So Work matters now as an architectural target, even if it is not the current wedge.

## Primary responsibilities

Work exists to turn coordination into durable business execution objects.

That includes:

- commitments
- execution state
- blockers
- approvals
- results
- promoted business assets

At the backend level, `Work` should own:

- business execution objects
- work-specific lifecycle and transitions
- ownership and participation for execution
- publication from chat lineage into work lineage
- execution references into agent runs
- durable result and asset promotion markers

`Work` should not own:

- room, DM, or thread truth
- generic agent runtime behavior
- global audit and evidence semantics
- shell-specific board layout

## The five durable questions Work must answer

Any future `Work` model should be able to answer:

1. Why does this business commitment exist?
2. Where did it come from in chat or execution lineage?
3. Who owns it now?
4. What execution, decision, or blocker is attached to it?
5. What durable result or asset has the business gained from it?

## Relationship to Chat

Chat answers:

- what was said
- where it was said
- who was participating

Work answers:

- what business commitment now exists
- who owns it
- what state it is in
- what result or asset was published

This is why `Work` should usually be downstream publication, not the place where the original conversation is invented.

## Relationship to Agent

Agent answers:

- how a bounded session executes
- what events were processed
- what tools were used
- what local runtime state changed

Work is higher-level than that.
It is about durable business execution meaning, not session mechanics.

`Agent` may create files, results, proposals, or execution traces inside a private workspace.
`Work` is the layer that prevents business-relevant outputs from remaining trapped there.

## Relationship to Observe

`Work` and `Observe` should not collapse into one layer.

`Work` answers:

- what the business is committed to
- who owns it
- what execution is attached to it
- what result or asset now exists

`Observe` answers:

- why that execution should be trusted
- what evidence supports it
- what policy boundary applied
- what risk or governance concern exists

## Current status

Work is intentionally documented ahead of full implementation.

That is a feature, not a bug.

The current wedge remains chat-first, but Work is already part of the long-term product shape.

The repo already carries early `Work` shape in `src/shared/company-model.ts` through work item records, work lanes, ownership fields, blocker state, approval requirements, and execution references.

## Related reading

- [Product Canon](./PRODUCT.md)
- [Chat](./chat.md)
- [Chat Kernel](./chat-kernel.md)
- [Observe](./observe.md)
- [Agent](./agent.md)
- [Agent Runtime](./agent-runtime.md)
