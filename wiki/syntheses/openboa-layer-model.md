# openboa Layer Model

This page is the working synthesis for openboa's large-scale system layers.

Use it when:

- the repo needs one durable place to refine the high-level system shape
- layer boundaries are still being hardened through discussion
- detailed per-layer meaning may arrive incrementally and should not be lost in chat history

This is not yet the canonical public architecture page.
Promote stable conclusions from here into `docs/` only after the layer model becomes durable enough.

## How to use this note

As new detail arrives, harden each layer with the same capture frame:

- purpose
- truth owned
- commands or actions exposed
- projections or surfaces produced
- adapters required
- boundary with adjacent layers
- unresolved questions

Do not promote a layer into `docs/` until the boundary and ownership feel durable.

## Current working thesis

openboa is not a single-agent app, a generic team-chat product, or a task board.
It is a Business as Agent system made of multiple product layers that work together:

1. `Agent`
2. `Chat`
3. `Work`
4. `Observe`

Adapters connect these layers to specific environments, runtimes, and storage systems.
UI surfaces render projections from these layers; they do not own truth.

## Current working layer stack

### `Agent`

Working definition:

- single worker runtime
- acts like one durable working entity
- can think, use tools, execute tasks, and produce results
- stays domain-agnostic by default
- becomes chat-capable or work-capable only when higher layers add capability packs

Current responsibilities:

- provider/runtime execution
- tool use
- workspace and sandbox boundary
- session and auth handling
- agent-local execution traces
- self-directed wake and follow-through loop
- context assembly and bootstrap-file ingestion

Questions to harden:

- what part of agent memory is strictly private versus promotable into shared truth?
- how should local agents and ACP-attached agents normalize into one runtime model?
- what is the minimum common interface for all agent runtimes?
- how should heartbeat, scheduled wake, and manual wake compose into one runtime contract?
- what should the agent do proactively when no external user message arrives?

### `Chat`

Working definition:

- durable coordination fabric
- protocol plus shared space
- append-only collaboration truth for humans and agents
- capability layer that makes a domain-agnostic agent chat-capable
- not a shell-only feature, but the shared collaboration substrate for humans and agents

Current responsibilities:

- channels, DMs, group DMs, threads
- membership and grants
- shared messages and cursors
- ordering and idempotent write semantics
- unread, mention, inbox, search, and transcript projections
- chat-specific tools, skills, prompts, and context packs layered on top of the agent core
- acting as the first independently believable product layer, even before `Work` and `Observe` ship

Chat should be viable without any product shell.
The shell is only one consumer of chat projections, not the reason chat exists.

Backend-first hardening points:

- `chat/core`
  - append-only truth and replay
  - durable scope model for channels, DMs, group DMs, and threads
  - idempotent message and system-event writes
  - scope-local ordering and revision tracking
- `chat/policy`
  - authorization, joins, leaves, grants, room settings, archive behavior
  - chat-capability wiring that turns a generic agent into a chat-capable participant
  - should depend on a thin agent-runtime port, not concrete agent runtime internals
- `chat/projections`
  - rebuildable read models for sidebar, transcript, inbox, unread, mentions, search, and activity
  - safe to discard and rebuild from truth

Chat invariants that should hold even with no UI:

- append-only truth is replayable into the same room state
- writes converge under retries and idempotency keys
- ordering guarantees are scope-local, not globally serialized
- threads are valid scoped sub-conversations, not ad hoc UI comments
- grants and membership are enforceable without shell code
- unread, inbox, and transcript are projections, never canonical truth
- a generic agent can participate only through chat capability packs, not by teaching the agent core about rooms

Questions to harden:

- what belongs in `chat/core` versus `chat/policy` versus `chat/projections`?
- how should thread semantics relate to rooms at the domain level?
- which adapters should be considered first-class for local and remote persistence?
- what is the smallest runtime port that `Chat` should depend on instead of reaching into agent internals?
- which chat capabilities belong in prompts/skills/tools versus durable chat truth?

### `Work`

Working definition:

- business execution layer
- turns coordination into explicit business commitment and execution
- gives multi-agent activity a work-shaped semantic model
- promotes business-relevant execution into durable company-owned commitments, results, and assets

Current responsibilities:

- commitment publication
- task / proposal / approval / blocker / result semantics
- owner and participant assignment
- source conversation / thread / message linkage
- next-action and execution-state shaping
- moving business intent from “discussion” to “owned commitment”
- preventing important execution outputs from remaining trapped in private agent workspaces

Important MVP note:

- first and second product milestones may still stop at `Chat`
- `Work` and `Observe` still matter now because their long-term shape should influence how chat truth, lineage, and agent binding are designed
- the chat-first MVP should be a strong foundation for later commitment publication, not a dead-end messaging shell

Questions to harden:

- what are the canonical `Work` objects and state transitions?
- which parts of `Work` are projections over chat truth and which require their own domain records?
- how tightly should approvals, blockers, and results be modeled in v1?
- where is the exact promotion boundary between private execution artifacts and durable business assets?

### `Observe`

Working definition:

- governance and evidence layer
- makes execution visible, accountable, and explainable

Current responsibilities:

- execution refs and session linkage
- auditability
- policy visibility
- risk and blocked-state visibility
- evidence surfaces for operator trust

Questions to harden:

- what belongs to Observe itself versus lower-layer enforcement?
- how should approvals, policy, audit, and execution traces compose into one operator-facing layer?
- what is the minimum useful Observe surface before it becomes “too much control plane”?

## Cross-cutting adapters

Adapters are not the product core.
They connect core layers to concrete environments.

Current working adapter categories:

- `Agent adapters`
  - local runtimes
  - ACP-attached runtimes
  - provider-specific execution
- `Chat adapters`
  - local ledger / file / database
  - future sync and transport seams
- `UI adapters`
  - web
  - desktop
  - future mobile
- `Observe / integration adapters`
  - audit sinks
  - metrics / traces / evidence sinks

Questions to harden:

- which adapter boundaries must exist from day one?
- which adapters should stay swappable versus intentionally openboa-specific?

## Truth, projection, controller, UI

Current working rule:

- truth lives below the shell
- projections reshape truth for product surfaces
- controllers decide what projection to show and how to open it
- UI only renders projections and emits commands

Working split:

- `truth`
  - domain records and append-only events
- `projection`
  - sidebar, transcript, thread, inbox, queue, evidence views
- `controller`
  - selection, open intent, thread visibility, client-local shell state
- `UI`
  - shadcn-composed presentation layer

This rule should remain true across `Chat`, `Work`, and `Observe`.

## Current repo mapping

Current approximate mapping to the codebase:

- `src/agents/` -> `Agent`
- `src/chat/core/`, `src/chat/policy/`, `src/chat/projections/` -> `Chat`
- `src/shared/company-model.ts` and future work/event records -> early `Work` / `Observe` semantics
- `src/shell/chat/` -> shell controller layer
- `src/shell/web/`, `src/shell/desktop/` -> UI adapters

This mapping is still being hardened.

## What still needs clarification

The next useful hardening passes are:

1. precise `Work` domain objects and transitions
2. precise `Observe` boundary versus lower-layer governance enforcement
3. adapter rules for local, ACP, and future storage/runtime seams
4. which parts of the current `company-model` belong to stable domain truth versus temporary product shaping

## Pending detailed input

Capture new detail here as it arrives:

- `Agent`
  - purpose:
    - provide a durable single-worker runtime that can be reused by many upper-layer products
    - keep execution self-directed, not only request-response
  - truth owned:
    - agent config
    - agent-local workspace state
    - private session history
    - heartbeat/task checkpoint state
    - private execution traces before promotion into shared truth
  - commands/actions:
    - wake
    - build context
    - run one loop
    - call tools
    - persist local state
    - emit promotable outputs or events upward
  - projections/surfaces:
    - none as a product surface
    - exposes runtime status, local checkpoints, and execution outputs to upper layers
  - adapters:
    - provider/model adapters
    - local runtime adapters
    - ACP-attached runtime adapters
    - auth/oauth adapters
    - sandbox/workspace adapters
  - boundary notes:
    - `Agent` must not know `Chat`, `Work`, or `Observe` domain meaning directly
    - higher layers make an agent chat-capable, work-capable, or observe-capable by adding tools, skills, prompts, and context packs
    - the openboa-specific differentiator is not domain knowledge inside the agent core, but a stronger self-directed runtime contract around heartbeat, wake, and follow-through
  - unresolved questions:
    - what is the canonical heartbeat contract for openboa agents?
    - which wake sources are first-class: timer, assignment, mention, approval, manual invoke, system event?
    - what local checkpoint model is enough to let an agent resume proactive work safely?
    - what should count as promotable output versus private scratch activity?
- `Chat`
  - purpose:
    - provide the durable coordination fabric where humans and agents share one collaboration truth
    - make a generic agent chat-capable by supplying chat-specific tools, context, and interaction rules
  - truth owned:
    - conversations
    - scope-local ordering
    - memberships
    - grants
    - cursors
    - attachments/follows
    - messages and chat-native system events
  - commands/actions:
    - create room
    - join or leave room
    - grant room access
    - open or follow thread
    - post message
    - defer contribution
    - search transcript
    - update cursor
  - projections/surfaces:
    - sidebar
    - inbox
    - transcript
    - thread
    - unread and mention views
    - search results
    - activity indicators
  - adapters:
    - local append-only ledger adapters
    - future remote persistence/sync adapters
    - agent capability packs that inject chat tools, context, and prompt fragments
  - boundary notes:
    - `Chat` sits above `Agent` and should not redefine the agent core
    - `Chat` can make an agent chat-capable, but the agent runtime itself must remain domain-agnostic
    - UI is downstream of chat projections; chat truth must remain below shell code
    - the current repo still has a hardening gap because `chat/policy` knows some concrete agent runtime details instead of depending on a thinner agent-runtime port
  - unresolved questions:
    - what should the agent-runtime port look like for chat participation and message delivery?
    - which chat behaviors should be native truth versus rebuildable projection?
    - how should room/thread/follow semantics compose for future Work publication?
    - what is the minimal local-first persistence contract before remote sync exists?
- `Work`
  - purpose:
    - turn selected coordination into explicit business execution
    - promote business-relevant outputs from private execution into company-owned durable assets
  - truth owned:
    - work items
    - ownership and participation
    - approvals, blockers, and results
    - execution references
    - asset-promotion state for relevant outcomes
  - commands/actions:
    - publish work
    - assign or claim work
    - request, grant, or reject approval
    - mark blocked or unblock
    - publish result
    - attach execution refs
    - promote relevant outputs into durable business assets
  - projections/surfaces:
    - queue
    - board lanes
    - spotlight detail
    - owner and conversation filters
    - execution summary views
  - adapters:
    - chat lineage readers
    - agent execution reference adapters
    - future delivery/output storage adapters
  - boundary notes:
    - `Work` must stay downstream of `Chat`
    - `Work` is not a UI board first; it is a backend execution domain
    - `Work` should not absorb all raw workspace artifacts, only business-relevant promoted outputs
  - unresolved questions:
    - what is the canonical lifecycle distinct from board lanes?
    - what should count as a promotable business asset?
    - how should approvals, blockers, and results be modeled: item types, events, or facets?
- `Observe`
  - purpose: pending
  - truth owned: pending
  - commands/actions: pending
  - projections/surfaces: pending
  - adapters: pending
  - boundary notes: pending
  - unresolved questions: pending
- `Adapters`
  - purpose: pending
  - truth owned: pending
  - commands/actions: pending
  - projections/surfaces: pending
  - adapters: pending
  - boundary notes: pending
  - unresolved questions: pending
