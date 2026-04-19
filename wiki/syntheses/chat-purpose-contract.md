# Chat Purpose Contract

This page hardens why `Chat` exists before the repo locks in more command families,
event shapes, or shell behavior.

Use it when:

- `Chat` risks being reduced to a UI wedge instead of a durable product layer
- MVP planning needs to stay chat-first without forgetting the larger `Work` and `Observe` system
- backend design needs a sharper answer to what `Chat` is actually for

This is a working contract, not yet the final canonical product spec.

## MVP framing

The first believable openboa product can still stop at `Chat`.

That does not mean `Chat` is “just the first tab.”

It means:

- `Chat` is the first independently believable product layer
- `Work` and `Observe` are still part of the long-term system shape
- the chat-first MVP must be built so those later layers can emerge cleanly on top

So the right framing is:

- near-term product surface: `Chat`
- long-term product stack: `Agent -> Chat -> Work -> Observe`
- current implementation obligation: make `Chat` strong enough that openboa already feels like a real company runtime, not a fake shell waiting for later features

## Core thesis

`Chat` exists to make company coordination durable, shared, and agent-native.

More precisely:

`Chat` is the AI-native shared office layer where registered humans and agents become first-class participants in one durable communication fabric.

This matters because a business needs a place where:

- humans can talk to agents naturally
- agents can talk to each other naturally
- shared conversation does not disappear with one model turn or private workspace
- the company can accumulate coordination history over time

Without `Chat`, the system has:

- isolated agent runtimes
- private workspaces
- private outputs
- no durable shared office

That means the business never really “exists” as a collaborative operating subject.

## Why `Chat` comes before `Work`

`Work` is important, but `Chat` must come first.

Reason:

- if humans and agents cannot coordinate credibly in one shared office, then `Work` feels pasted on
- if the chat layer is weak, any later work object or governance surface feels bureaucratic rather than native
- if the transcript, thread, room, and participant model are wrong, `Work` will inherit weak lineage and weak context

So `Chat` is not an appetizer for `Work`.

It is the first layer that makes Business as Agent feel real.

`Work` later turns selected coordination into explicit business commitments, but `Chat` is the place where that coordination becomes durable enough to promote at all.

## What `Chat` makes possible

`Chat` should make these things possible even before `Work` ships:

- a human can bring a registered agent into a room
- an agent can be directly addressed in shared company scopes
- an agent can observe thread context and reply into the correct scope
- multiple agents can coordinate in one transcript without leaving the system
- a thread can carry scoped follow-up without being a UI-only comment trick
- unread, mention, inbox, and transcript continuity make sense over time

If these do not work, openboa is not yet a believable shared office.

## The shared office model

The strongest mental model is:

- each human and each agent has a private working environment
- `Chat` is the public or shared office they step into together
- communication in that office is durable enough to matter to the company

This leads to three distinct truths:

### 1. Private runtime truth

Owned below `Chat`.

Examples:

- agent-local scratch
- private prompts
- provider-specific execution details
- temporary local files

### 2. Shared communication truth

Owned by `Chat`.

Examples:

- rooms
- threads
- membership
- grants
- messages
- cursors
- chat-native system events

### 3. Published business truth

Owned later by `Work` or `Observe`.

Examples:

- commitments
- approvals
- blockers
- results
- evidence and governance views

This separation is critical.

If `Chat` collapses private execution into transcript truth, it becomes noisy.

If `Chat` tries to own business commitments directly, it becomes overfit to `Work`.

## Chat's real product promise

The promise is not:

- “send messages”

The promise is:

- “humans and agents can work in one durable company conversation space”

That is a much stronger product statement.

It implies that `Chat` must support:

- first-class agent participation
- durable scopes
- scoped context
- reply discipline
- attention discipline
- safe access control
- local-first backend truth

This is why `Chat` should be compared to something like Slack in product position, but not translated mechanically.

Slack is human-first collaboration software with bots attached.

openboa `Chat` should be:

- human + agent native
- backend-first
- thread- and scope-aware for machine participants
- designed so the business can later grow `Work` and `Observe` on top without replacing the communication kernel

## What must be true for `Chat` to be believable

Before the product can claim that `Chat` works, the system should already support:

### Durable scope

- `channel`, `dm`, `group_dm`, and `thread` are real backend scopes
- thread is not a presentation hack

### First-class participants

- human, agent, and system can all appear as participants
- registered agents can be bound into chat scopes without teaching the agent core about rooms

### Backend truth

- transcript truth is append-only
- writes are idempotent under retries
- room and thread state can be replayed without the shell

### Attention model

- unread and mention semantics are coherent
- cursor movement is durable
- follow-up can remain scoped to a room or thread

### Projection discipline

- sidebar, inbox, transcript, thread view, and search are projections
- UI never becomes the truth owner

### Chat-native commands

- post, invite, bind, join, leave, follow, read, archive, search
- these commands remain chat semantics, not work semantics

## What `Chat` must not become

`Chat` must not become:

- a work board in disguise
- an approval system in disguise
- a governance console in disguise
- a provider-specific bot framework
- a shell-shaped backend

The most dangerous failure mode is:

- using chat as the temporary place for business meaning that really belongs to `Work`

That would make the MVP feel productive in the short term, but would weaken the long-term layer model.

## Why Chat needs stronger backend discipline than ordinary chat apps

Because the participants are not only humans.

Agents need:

- clean scope boundaries
- explicit audience
- thread-safe context windows
- durable lineage
- predictable access rules
- capability injection without domain leakage into the agent core

That means openboa `Chat` needs to be more protocol-rigorous than ordinary human chat apps.

The shell can still feel familiar, but the backend contract has to be stronger.

## What this means for the chat-first MVP

The MVP can stop at `Chat`, but it cannot be a thin demo shell.

The MVP should already prove:

- agent registration and chat binding are separate
- chat truth is backend-owned
- threads are real scopes
- projections are rebuildable
- agent participation works through injected chat capability packs
- the shell is only a renderer and controller over chat projections

If the MVP proves those things, it is already building the right foundation for `Work` and `Observe`.

If it does not, later layers will force a redesign.

## The five durable questions `Chat` must answer

Any mature `Chat` model should be able to answer:

1. Who are the first-class participants in this scope?
2. What durable scope does this conversation belong to?
3. What append-only transcript truth created the current view?
4. What attention state should each participant see next?
5. How can a generic agent participate without the agent core learning chat-specific meaning?

If a proposed chat model cannot answer those five questions cleanly, it is probably still too UI-first.

## Next hardening questions

Do not treat the chat layer as done until these are sharper:

- What is the minimal runtime port between `Chat` and `Agent`?
- Which system events are truly chat-native versus future `Work` or `Observe` events shown in chat?
- What is the precise contract for thread follow, unread, mention, and cursor interactions?
- Which persistence guarantees are mandatory for a local-first chat backend?
- Which parts of presence and activity should live in durable truth versus projection?
