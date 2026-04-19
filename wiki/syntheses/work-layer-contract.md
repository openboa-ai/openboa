# Work Layer Contract

This page hardens what `Work` means in openboa before the details are promoted into `docs/`.

Use it when:

- the repo needs a durable definition of `Work` beyond “future board UI”
- product or backend work risks collapsing `Work` into generic task-management software
- `Chat` coordination and `Observe` evidence need a cleaner business-execution layer between them

This is a working contract, not yet the final canonical product spec.

## Core thesis

`Work` is the business execution layer for openboa.

It sits on top of `Chat` and turns selected coordination into durable execution objects.

More strongly, `Work` is the layer that turns selected coordination into explicit business commitments and then carries those commitments through execution, decision, result, and durable assetization.

Assetization is one of its jobs, but not the whole point.

It is:

- a business publication layer
- an execution semantics layer
- a stateful backend domain
- the place where conversation becomes explicit business commitment
- the place where commitment becomes owned action
- the layer where execution stops being ephemeral agent activity and becomes company-owned durable state and assets

It is not:

- the reason `Chat` exists
- a generic project-management product
- the agent runtime
- the global governance plane
- just a board UI

The right mental model is:

- `Chat` is the shared office where humans and agents coordinate
- `Work` is where some of that coordination gets promoted into explicit business commitment and execution
- `Observe` is where that action becomes accountable and explainable

The strongest version of this model is:

- agents execute inside private workspaces
- but the business should not lose the value created there
- `Work` is the commitment and assetization layer that promotes relevant execution into durable company-owned value

## Product position

If `Work` is added too early or too broadly, it feels pasted on top of chat.

If `Work` is added correctly:

- important chat coordination can become durable business action
- that action can become an explicit owned commitment
- agents can move from “talking” to “owning execution”
- founders can see what is active, blocked, waiting for approval, or recently completed

So `Work` should be framed as:

- optional publication on top of chat
- not every message becomes work
- not every company needs a heavy board
- but durable businesses do need a way to promote conversation into execution objects

And more importantly:

- openboa is not interesting if agent execution stays trapped in private workspaces
- openboa becomes meaningful when business-relevant execution is captured as reusable company commitments, execution history, and assets

## Primary responsibilities

`Work` owns:

- business execution objects
- work-specific lifecycle and transitions
- ownership and participation for execution
- approval and blocker semantics
- execution references into agent runs
- publication from chat lineage into work lineage
- assetization of relevant execution outputs into durable business state

`Work` does not own:

- room, DM, or thread truth
- generic agent runtime behavior
- global audit/evidence semantics
- shell layout and board presentation

## Core concept: commitment publication

The core action in `Work` is not “create card.”

It is:

- publish a business commitment object from existing coordination

That means a work object should usually know:

- where it came from
- why it exists
- who owns it
- what is expected next
- what execution has happened
- what decision or result is pending

This is why `Work` should remain downstream of `Chat`.

See also: `wiki/syntheses/work-purpose-contract.md`

## Core concept: assetization

The business should benefit from agent work even after:

- the agent session ends
- the model changes
- the workspace is reset
- the original chat context scrolls away

So `Work` is not only about tracking status.
It is about turning transient execution into durable business assets.

Examples of assets that may be promoted through `Work`:

- approved proposals
- completed results
- structured next actions
- blocker records
- execution references with provenance
- decision history
- linked deliverables created inside agent workspaces

Important distinction:

- not every scratch note or intermediate file should become canonical business truth
- but business-relevant outputs, decisions, and execution lineage should not remain trapped in private agent state

## Work as a backend

`Work` must exist as a backend domain even if no work UI is loaded.

That means the shell is only one consumer of work state.

The backend must be able to:

- receive publication commands
- persist work truth
- attach execution lineage
- answer queries about ownership, status, blockers, approvals, and outcomes
- expose rebuildable projections for any shell

If `Work` only exists as queue cards or board lanes in the shell, it is not yet real.

## Truth model

`Work` must have its own durable truth.

It cannot remain only a projection over chat messages.

Examples of work truth:

- work item publication
- owner assignment
- participant assignment
- approval requested
- approval granted or rejected
- blocker raised
- blocker cleared
- execution reference attached
- result published
- lifecycle transition
- business-asset promotion markers
- links to relevant deliverables or execution artifacts

The current repo already has an early durable shape:

- `work.item.upserted`

But long term, `Work` likely needs to evolve from one upsert record into a richer event family.

That richer event family probably needs to distinguish between:

- execution state
- decision state
- asset promotion state
- delivery/result state

## Object model

Current code points toward one generic `WorkItem` with:

- `itemType`
- `state`
- source conversation/thread/message linkage
- owner and participants
- next action
- blocker reason
- approval requirement
- execution refs

This is a good starting shape, but it is not yet fully hardened.

The likely stable direction is:

- one canonical `WorkItem`
- optional specialized facets such as:
  - proposal
  - approval
  - blocker
  - result
- separate lifecycle state from board-lane presentation

Important warning:

The current code likely mixes:

- domain lifecycle
- board lanes

For example:

- `inbox`
- `needs_decision`
- `in_progress`
- `blocked`
- `done_recently`

These are useful views, but they may not be the final canonical lifecycle model.

## State model

`Work` needs a true execution state machine, not just lane buckets.

The canonical questions are:

- has this been published?
- who owns it?
- is it waiting for a decision?
- is it actively being worked?
- is it blocked?
- is it complete?
- was a result published?

So the future hardening should probably separate:

- lifecycle state
- urgency/priority
- view lane
- item type

This is one of the biggest open modeling gaps right now.

## Relation to Chat

`Work` depends on `Chat`, but should not distort it.

What `Work` receives from `Chat`:

- source conversation
- source thread
- source message
- participant identities
- room context
- follow-up signals

What `Work` adds:

- explicit execution semantics
- ownership
- approval semantics
- blocker semantics
- result semantics
- durable “what should happen next”
- a path from conversation into business-owned assets

Rules:

- `Chat` remains valuable without `Work`
- `Work` should never become a requirement for ordinary conversation
- chat messages may reference work ids, but work state is not chat truth

## Relation to Agent

The agent core must remain domain-agnostic.

`Work` makes an agent work-capable by supplying:

- work-specific tools
- work-specific skills
- work-specific context packs
- work-specific prompt fragments
- work-specific state transition rules

That means:

- the agent does not natively know what an approval is
- the agent does not natively know what a blocker is
- the agent does not natively know how to claim work
- work participation emerges only when the work layer injects those capabilities

But once those capabilities are injected, the expected behavior changes:

- the agent should not only “do work”
- it should also help publish meaningful outputs back into durable business state

## Relation to Observe

`Observe` should read from `Work`, not define it.

What `Work` gives `Observe`:

- execution objects
- lifecycle history
- owner and participant context
- approval and blocker context
- execution refs
- next-action and result context

What `Observe` adds:

- evidence stitching
- audit views
- operator-facing trust surfaces
- degraded-state explanation
- policy and execution accountability

## Backend contract

`Work` should work even if no Work board UI exists.

Minimum backend contract:

- publish work from chat lineage
- assign or reassign owners
- track participants
- transition lifecycle state safely
- attach execution refs
- express approvals and blockers
- record which outputs became business assets
- link work items to durable deliverables or promoted results
- list active work by filters such as owner, state, and conversation
- rebuild board-style projections from truth

If any of these require the current shell board to exist, the work layer is not yet strong enough.

## Projection model

Board views are projections, not truth.

Likely work projections:

- lane board
- queue sidebar
- owner filter
- conversation filter
- spotlight detail
- “needs decision” and “blocked” summaries

This matters because `Work` should be operable from CLI or other shells before its full visual surface is mature.

## Invariants

The following should stay true as the repo evolves:

- `Work` remains downstream of `Chat`
- not every chat message becomes work
- work truth is durable and queryable without the shell
- board lanes are not the only meaning of work state
- approvals, blockers, and results are execution semantics, not decoration
- execution refs connect work to real agent runtime activity
- agents become work-capable through injected work capabilities, not by teaching the agent core about business tasks
- business-relevant outputs should be promotable out of private agent execution into company-owned work truth

## Current repo implications

The current repo already contains promising early structure:

- `WorkItemRecord` and `ExecutionRef` in [company-model.ts](/src/shared/company-model.ts)
- `work.item.upserted` persistence in [ledger.ts](/src/chat/core/ledger.ts)
- early lane/detail surfaces in the web shell

But several hardening gaps remain:

- work truth currently lives too close to shared shell shaping
- one upsert event may be too coarse for a mature work history
- current state names may be mixing lifecycle semantics with board view semantics
- policy and command boundaries for work are not yet explicit enough
- the assetization model is still implicit instead of explicitly encoded in the work domain

## Non-goals

`Work` should not become:

- a generic kanban board
- a replacement for all conversation
- a UI-first feature without backend semantics
- a domain that drags `Chat` under it
- a place where agent runtime internals leak upward

It should also not become:

- a dump of every raw workspace artifact
- a replacement for proper business judgment about what deserves promotion

## Open questions

- what is the canonical work lifecycle, separate from board lanes?
- should approvals, blockers, and results be item types, events, or facets?
- when does a chat message qualify for work publication?
- what is the exact command surface for claim, assign, publish result, block, unblock, and request approval?
- how should execution refs be modeled so Observe can trust them later?
- what is the exact promotion boundary between private agent workspace artifacts and durable business assets?
