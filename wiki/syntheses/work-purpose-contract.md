# Work Purpose Contract

This page hardens the reason `Work` exists before the repo locks in lifecycle tables,
approval authority, or board-style state models.

Use it when:

- `Work` risks being defined too quickly as a board, queue, or status system
- the repo needs a durable explanation of why `Work` exists even while MVP remains chat-first
- backend design needs to know what long-term business meaning `Chat` must leave room for

This is a working contract, not yet the final canonical product spec.

## MVP framing

The first and second implementation milestones can still be chat-only.

That does not make `Work` optional in the architecture.

`Work` and `Observe` matter before they ship because:

- long-term product direction changes how `Chat` should be modeled
- backend truth and lineage decisions made during the chat phase are expensive to unwind later
- a chat-only MVP can still be designed as the front edge of a larger business system

So the right framing is:

- MVP surface: `Chat`
- long-term product shape: `Agent -> Chat -> Work -> Observe`
- current implementation focus: make `Chat` strong enough that `Work` can later emerge cleanly on top

## Core thesis

`Work` exists because `Chat` preserves coordination, but coordination alone is not enough for a business.

Businesses do not only need:

- what was said
- who said it
- where it was discussed

They also need:

- what the company is now committed to
- who owns that commitment
- what execution has happened against it
- what decision or approval is required
- what result or deliverable was produced
- what durable asset the business now owns

So the deeper job of `Work` is:

- turn selected coordination into explicit business commitments
- connect those commitments to execution
- connect execution to decisions, results, and durable assets

This means `Work` is not just assetization and not just status tracking.

It is:

- commitment capture
- execution shaping
- decision and authority tracking
- result publication
- assetization of business-relevant output

## Why `Chat` alone is not enough

`Chat` is necessary, but not sufficient.

`Chat` can tell the system:

- what conversation happened
- which participants were present
- where the conversation lived
- which message or thread triggered follow-up

But `Chat` alone cannot durably answer:

- what the business has explicitly committed to do
- who is now accountable for that commitment
- whether the commitment is active, blocked, awaiting decision, or complete
- what execution lineage counts toward that commitment
- what output became a company-owned artifact

If those meanings stay only inside chat:

- responsibility remains implicit
- execution scrolls away with the transcript
- private agent workspaces keep the most valuable output trapped
- the company fails to compound what its humans and agents already did

So `Work` is the layer that turns “conversation happened” into “the business now owns this line of execution.”

## Work's true unit

The deepest unit of `Work` is probably not a card.

It is closer to a `business commitment`.

A business commitment is a durable statement that:

- something now matters to the company
- someone or some group is responsible for moving it forward
- there is an expected next action, decision, or result
- the business wants the execution and outcome to remain durable

This is why `Work` should feel different from generic project management.

Generic PM tools often start from:

- task list
- assignee
- status column

But openboa `Work` should start from:

- coordination lineage
- business commitment
- execution linkage
- decision authority
- durable result or asset

The existing `WorkItem` can still be the carrier object, but it should be understood as the container for a commitment, not merely as a card on a board.

## What `Work` adds on top of `Chat`

`Chat` already gives:

- room, DM, group DM, and thread scopes
- participant identity and audience
- transcript lineage
- follow-up and attention signals

`Work` adds:

- explicit commitment publication
- ownership and participation for execution
- execution references and lineage stitching
- decision and approval semantics
- blocker semantics
- result publication
- durable asset promotion

So the layering should be:

- `Chat`: where coordination happens
- `Work`: where some coordination becomes explicit business execution

## What `Work` adds on top of `Agent`

`Agent` already gives:

- private runtime
- private workspace
- tools
- self-directed execution loop
- private scratch and intermediate outputs

`Work` adds:

- the rule for which execution becomes company-visible
- the durable object that represents that execution to the business
- lineage between private execution and shared business truth
- ownership, approval, and result semantics around that execution

So `Agent` produces execution, but `Work` decides what execution becomes durable business state.

## What `Work` is not

`Work` is not:

- the reason `Chat` exists
- a shell-only board feature
- the same thing as approval workflow software
- the same thing as audit or observability
- a dump of every private agent artifact

If `Work` becomes only a board:

- it loses the assetization and execution lineage thesis

If `Work` becomes only assetization:

- it loses ownership, commitment, and active execution meaning

If `Work` becomes only approval workflow:

- it loses the broader business-execution model

## Relation to `Observe`

`Work` and `Observe` should not collapse into one layer.

`Work` answers:

- what is the business committed to
- who owns it
- what execution is attached to it
- what result or asset has been produced

`Observe` answers:

- why should I trust that execution
- what evidence supports it
- what policy boundary applied
- what risk or governance concern exists

So:

- `Work` is execution and commitment truth
- `Observe` is evidence and governance truth

## Why this matters during the chat-first MVP

Even if implementation stops at `Chat` for now, the chat backend should still leave room for `Work`.

That means chat should preserve:

- durable conversation lineage
- durable participant identity
- thread-safe scoped sub-conversations
- agent binding distinct from agent registration
- system events and references that can later support publication into `Work`
- clean separation between truth and projection

Without this long-term framing, a chat-first MVP easily drifts into:

- UI-first messaging
- weak lineage
- implicit ownership
- no clear promotion boundary into business execution

The purpose of defining `Work` early is not to overbuild it now.

It is to make sure the chat-first MVP is the right foundation for the business system openboa is trying to become.

## The five durable questions `Work` must answer

Any future `Work` model should be able to answer:

1. Why does this business commitment exist?
2. Where did it come from in chat or execution lineage?
3. Who owns it now?
4. What execution, decision, or blocker is currently attached to it?
5. What durable result or asset has the business gained from it?

If a proposed state machine or data model cannot answer those five questions, it is probably too shallow.

## Next hardening questions

Do not lock the full lifecycle until these are clearer:

- Is `business commitment` the right primary concept, or does openboa need a more precise term?
- Should one `WorkItem` carry commitment, execution, approval, and result, or should some of these become linked sub-objects?
- What is the exact promotion boundary between private execution artifact, proposed result, and durable business asset?
- What authority is required for publication, approval, and asset promotion?
- Which parts of `Work` must exist in the very first backend implementation, even before a dedicated work UI ships?
