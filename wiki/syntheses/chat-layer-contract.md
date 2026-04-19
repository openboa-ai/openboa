# Chat Layer Contract

This page hardens what `Chat` means in openboa before the details are promoted into `docs/`.

Use it when:

- the repo needs a durable definition of `Chat` that is deeper than the current product summary
- backend and product work risk drifting into “UI-first chat” thinking
- future `Work` and `Observe` design should remain clearly downstream of chat

This is a working contract, not yet the final canonical product spec.

## Core thesis

`Chat` is the shared office layer for openboa.

It is:

- a durable communication product
- a coordination protocol
- a backend truth system
- a capability layer that makes generic agents chat-capable

It is not:

- a shell feature
- a task board
- a work-state machine
- a control plane
- an agent runtime

The right mental model is:

- each agent has its own private workspace and local runtime loop
- `Chat` is the shared office where registered humans and agents become first-class participants
- `Work` is optional business publication on top of that office, not the reason the office exists

This is why the first believable product can stop at `Chat` while still preserving room for later `Work` and `Observe`.
`Chat` is not a temporary wedge to throw away later.
It is the first durable product layer.

## Product position

If `Chat` is not independently believable, the rest of openboa will always feel pasted on.

`Chat` must stand on its own as:

- a credible team communication product
- the first durable place where humans and agents coordinate
- the first surface where Business as Agent feels real instead of theoretical

This means `Chat` should be understandable and operable even before `Work` or `Observe` are mature.

See also: `wiki/syntheses/chat-purpose-contract.md`

## Primary responsibilities

`Chat` owns:

- participant-facing communication scopes
- durable transcript truth
- room and thread semantics
- participation and access rules
- attention and follow-up mechanics
- agent chat capability binding

`Chat` does not own:

- generic agent execution internals
- task, approval, blocker, or result semantics
- global audit and evidence policy
- shell layout and presentation logic

## Participant model

`Chat` must treat participants as first-class domain entities.

Participant kinds:

- `human`
- `agent`
- `system`

Important consequence:

- agents are not “just bots”
- agents are not only integrations
- agents can be direct participants in rooms, DMs, threads, mentions, and presence-like views

Two distinct steps must remain separate:

1. `Agent registration`
   - happens below chat
   - creates or exposes a runnable agent identity with runtime metadata
2. `Chat binding`
   - happens in chat
   - grants that registered agent room participation, direct-message reachability, mentionability, and role-based access

So:

- registration means an agent exists
- binding means that agent becomes a chat citizen

## Scope model

`Chat` should be built around durable scopes, not around screens.

Core scopes:

- `channel`
- `dm`
- `group_dm`
- `thread`

Rules:

- channels are durable shared company rooms
- DMs are durable private coordination scopes
- group DMs are durable small-team coordination scopes
- threads are scoped sub-conversations inside a parent room, not UI-only comment trees

Thread semantics matter because they decide:

- which ordering guarantees apply
- which unread state applies
- which followers are attached
- which context gets shown to a chat-capable agent

## Truth model

`Chat` must be backend-first.

Canonical truth should remain append-only and replayable.

Examples of chat truth:

- conversation upserts
- membership upserts
- grant-binding upserts
- message posts
- chat-native system events
- reaction set-state events
- cursor updates
- thread or scope attachments/follows

The shell must never become the source of truth for these facts.

## Projection model

Most of what users see in a chat client is not truth.

Projections should be rebuildable from append-only truth:

- sidebar
- inbox
- transcript
- thread view
- unread counts
- mention counts
- search results
- recent activity indicators

This is important because it keeps `Chat` viable without the UI that currently renders those projections.

## Command model

`Chat` needs a stable command surface even before `Work` exists.

Canonical chat commands should cover:

- create room
- bind participant
- invite participant
- join room
- leave room
- grant or revoke room access
- read room
- post message
- open thread / follow thread
- defer contribution
- update cursor
- archive room
- search transcript

These are chat semantics, not work semantics.

## Agent capability model

The agent core must remain domain-agnostic.

`Chat` makes an agent chat-capable by supplying:

- chat-specific tools
- chat-specific skills
- chat-specific prompt fragments
- chat-specific context packs
- chat-specific participation rules

That means:

- the agent does not natively know what a room is
- the agent does not natively know what a thread is
- the agent does not natively know how mentions work
- chat participation emerges only when the chat layer injects those capabilities

## Backend contract

`Chat` should work even if no product shell exists.

Minimum backend contract:

- replay append-only truth into the same room state
- enforce read/post/manage access without shell code
- converge writes under retries and idempotency keys
- keep ordering scope-local
- support durable thread scopes
- expose rebuildable projections for any future UI

If any of these require the current web shell to exist, the chat layer is not yet strong enough.

For MVP purposes, this backend contract matters more than visual completeness.
The shell can iterate later, but weak scope, lineage, participant, or projection contracts will poison later layers.

## Relation to Work

`Work` must sit on top of `Chat`, not inside it.

What `Chat` provides to `Work`:

- shared communication scopes
- durable message lineage
- thread context
- participant identity and role context
- attention signals and follow-up mechanics

What `Work` adds on top:

- execution semantics
- publication of business objects
- explicit task / approval / blocker / result meaning

`Chat` may reference work identifiers in messages, but that does not make work state part of chat truth.

## Relation to Observe

`Observe` should read from `Chat`, not define it.

What `Chat` gives `Observe`:

- transcript facts
- scope boundaries
- participant activity
- system events
- cursor and attention state

What `Observe` adds:

- evidence stitching
- audit views
- risk visibility
- policy and execution explanation

## Invariants

The following should stay true as the repo evolves:

- `Chat` remains valuable even if `Work` is disabled
- `Chat` remains operable even if no shell is loaded
- `Chat` does not require teaching the agent core about domain room semantics
- transcript truth is append-only
- projections are rebuildable
- thread semantics are domain semantics, not presentation hacks
- access control is enforceable below UI
- participant binding is separate from agent registration

## Current repo implications

The current code already points in the right direction:

- `src/chat/core/` owns durable truth and replay
- `src/chat/policy/` owns authorization and room mutations
- `src/chat/projections/` owns rebuildable read models

But one important hardening gap remains:

- current `chat/policy/command-service.ts` still knows concrete agent runtime details
- long-term, chat should depend on a thin agent-runtime port for participation and delivery instead of importing concrete runner/config logic

## Non-goals

`Chat` should not become:

- a general business state machine
- a work board in disguise
- a governance console
- a provider-specific bot framework
- a web-shell-shaped backend

## Open questions

- what is the minimal runtime port between `Chat` and `Agent`?
- what should count as a chat-native system event versus an upper-layer event shown in chat?
- how should thread follow, attachment, and unread semantics interact?
- what is the minimal local-first persistence contract before sync enters the picture?
- which presence or activity semantics belong in chat truth versus projection?

## Related working contracts

- `wiki/syntheses/chat-purpose-contract.md`
- `wiki/syntheses/chat-participant-binding-contract.md`
- `wiki/syntheses/chat-thread-semantics-contract.md`
- `wiki/syntheses/chat-attention-contract.md`
- `wiki/syntheses/chat-agent-runtime-port-contract.md`
