# Work Assetization Contract

This page deepens the `Work` layer around one core question:

How does openboa turn transient execution inside private agent workspaces into durable business assets?

Use it when:

- the repo needs a sharper promotion boundary between private execution and company-owned truth
- work modeling feels too close to board UI or generic task tracking
- implementation is about to define work commands or events

This is a working contract, not yet the final canonical spec.

## Core thesis

`Work` is not only about tracking status.

Its deeper job is:

- identify business-relevant execution
- promote it out of private runtime state
- store it as durable company-owned truth

Without this layer:

- agent work stays trapped in private sessions and workspaces
- chat coordination scrolls away
- the business does not compound what agents do

## Assetization boundary

The most important modeling boundary in `Work` is:

- what stays private to an agent runtime
- what becomes a durable business asset

This boundary must be explicit.

If it is too loose:

- the company truth becomes noisy
- raw scratch artifacts pollute the business record

If it is too strict:

- valuable work disappears with the session
- the business cannot build durable execution memory

## Artifact classes

The current model should distinguish at least five classes of artifact.

### 1. Scratch artifact

Examples:

- temporary notes
- intermediate prompts
- experimental files
- discarded partial outputs

Rules:

- stays private to the agent runtime
- not visible as business truth
- may be useful for local recovery, but not for company memory

### 2. Execution artifact

Examples:

- patch generated during a run
- temporary report draft
- console output
- intermediate analysis result

Rules:

- still belongs primarily to the agent workspace or runtime history
- may be linkable by reference
- not automatically a business asset

### 3. Execution reference

Examples:

- agent session id
- task/run id
- conversation/thread linkage
- a stable pointer to a deliverable path or generated artifact

Rules:

- durable enough to support traceability
- may be attached to work items
- does not by itself mean the underlying artifact is canonical business truth

### 4. Proposed business asset

Examples:

- proposed release checklist
- approval request
- structured decision note
- blocker statement
- proposed final response or deliverable

Rules:

- now enters `Work`
- should carry source lineage
- may require approval, ownership, or review before becoming final

### 5. Durable business asset

Examples:

- approved proposal
- accepted result
- confirmed blocker record
- canonical next action
- accepted deliverable link
- decision history entry

Rules:

- becomes company-owned state
- must be durable and queryable
- should survive session resets, provider swaps, and workspace cleanup

## Promotion criteria

An artifact should be promotable when it is:

- business-relevant
- attributable
- understandable outside the original session
- linked to source lineage
- actionable or decision-bearing
- durable enough that the business benefits from keeping it

An artifact should usually not be promoted when it is:

- raw scratch
- redundant with already promoted truth
- too ambiguous without the full private session
- purely low-level runtime noise

## Publication flow

The expected flow is:

1. coordination happens in `Chat`
2. execution happens inside one or more agent runtimes
3. a worker decides that some output or state change is business-relevant
4. a `Work` command publishes or promotes it
5. `Work` records durable truth
6. `Observe` later reads that truth with evidence and lineage

## Canonical command families

`Work` should not rely on one coarse upsert forever.

Likely command families:

### Publication

- `publish_work_item_from_chat`
- `publish_work_item_from_execution`
- `reframe_work_item`

### Ownership

- `assign_work_owner`
- `add_work_participant`
- `remove_work_participant`
- `claim_work_item`

### Lifecycle

- `start_work_item`
- `pause_work_item`
- `complete_work_item`
- `archive_work_item`

### Approval

- `request_work_approval`
- `approve_work_item`
- `reject_work_item`

### Blockers

- `raise_work_blocker`
- `clear_work_blocker`

### Results and assets

- `publish_work_result`
- `promote_business_asset`
- `attach_deliverable_link`

### Evidence

- `attach_execution_ref`
- `attach_supporting_context`

## Event family model

The current `work.item.upserted` event is useful as a bootstrap shape, but it is too coarse for a mature domain.

The likely event family should separate concerns.

### Work item lifecycle

- `work.item.published`
- `work.item.reframed`
- `work.lifecycle.transitioned`

### Ownership and participation

- `work.owner.assigned`
- `work.participant.added`
- `work.participant.removed`

### Approval

- `work.approval.requested`
- `work.approval.granted`
- `work.approval.rejected`

### Blockers

- `work.blocker.raised`
- `work.blocker.cleared`

### Execution lineage

- `work.execution.ref.attached`
- `work.execution.ref.detached`

### Assetization

- `work.asset.proposed`
- `work.asset.promoted`
- `work.asset.superseded`

### Results and delivery

- `work.result.published`
- `work.deliverable.linked`

This separation matters because:

- status changes are not the same as approval changes
- approval changes are not the same as result publication
- result publication is not the same as asset promotion

## Work item shape

The likely durable shape is:

- one canonical `WorkItem`
- event history attached to that item
- optional linked assets and deliverables
- execution refs for traceability

The work item should answer:

- why does this exist?
- where did it come from?
- who owns it?
- who is participating?
- what state is it in?
- what approval is pending or resolved?
- what blockers exist?
- what result or asset has been promoted?

## State separation

Future modeling should separate at least four things:

- lifecycle state
- board lane or queue view
- item type
- assetization state

Example:

- lifecycle: `active`
- board lane: `needs_decision`
- item type: `approval`
- assetization state: `proposed`

This is more precise than overloading one state field.

## Proposed assetization states

One possible assetization axis:

- `none`
- `candidate`
- `proposed`
- `approved`
- `canonical`
- `superseded`

This axis is separate from execution state.

For example:

- a work item could be `in_progress` but already have one `approved` asset attached
- a result could be published but not yet canonical

## Promotion authority

Not every participant should be able to promote assets in the same way.

Likely authority rules:

- agents can create candidates or proposals
- owners can publish or advance execution state
- designated approvers can approve decision-bearing assets
- the business operator or delegated authority can mark something canonical when needed

This keeps business truth governed without forcing all work through one human bottleneck.

## Minimal backend contract

Even with no work UI, the backend should be able to answer:

- what active work exists?
- what is blocked?
- what needs decision?
- which outputs are still only proposals?
- which outputs became durable business assets?
- which agent sessions contributed to this item?
- what changed most recently?

## Current repo gap

The current repo already has:

- `WorkItemRecord`
- `ExecutionRef`
- lineage back to conversation/thread/message
- shell board projections

But it does not yet have:

- explicit publication commands
- explicit approval/blocker/result event families
- explicit assetization states
- explicit promotion authority model

So the next real implementation step should not be “make the board prettier.”
It should be “define the Work command/event model clearly enough that the board becomes just one projection.”

## Open questions

- what exact artifact kinds deserve first-class promotion in v1?
- should approvals attach to assets, work items, or both?
- when does a proposed result become canonical business truth?
- how should supersession work when a better output replaces an older one?
- how much of deliverable storage belongs in `Work` versus other layers or adapters?
