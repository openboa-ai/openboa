# Chat Agent Runtime Port Contract

This page hardens the boundary between `Chat` and `Agent`.

Use it when:

- chat policy starts reaching into concrete agent runtime internals
- local and external agent participation need one cleaner contract
- the repo is ready to replace ad hoc runtime imports with a thinner port

This is a working contract, not yet the final canonical implementation design.

## Core thesis

`Chat` should depend on a thin runtime port, not on concrete agent setup and runner internals.

Reason:

- `Agent` must remain domain-agnostic
- `Chat` must remain a capability layer above `Agent`
- local runtimes and external runtimes should normalize behind one participation contract

If `Chat` imports runtime setup, bootstrap, config loading, auth resolution, and turn execution directly, the layer boundary is too weak.

## What `Chat` actually needs from `Agent`

`Chat` does not need the whole runtime.

It only needs a small set of participation-facing capabilities.

Likely needs:

- ensure a registered participant exists
- inspect high-level participant capability metadata
- deliver a chat-scoped wake or turn request
- receive a result or failure envelope

That is much smaller than:

- full provider config
- full bootstrap loading
- direct auth resolution
- direct runner orchestration

## Port responsibilities

The runtime port should probably be responsible for:

- normalizing local and external runtime identities
- validating that a participant can act as a chat participant
- accepting a chat-scoped delivery request
- returning a structured result envelope

The runtime port should not make `Chat` responsible for:

- provider-specific prompt assembly
- runtime-specific auth details
- workspace bootstrap internals
- model-specific execution orchestration

## Suggested port shape

This is not final API, but the contract should feel roughly like:

- `ensureParticipant(agentId)`
- `describeParticipant(agentId)`
- `deliverChatTurn(request)`

Where `deliverChatTurn(request)` can carry:

- participant id
- scope identity
- transcript or context envelope
- target audience metadata
- wake reason
- optional session correlation id

And returns something like:

- response text or structured outcome
- runtime session ref
- execution ref
- failure metadata if no reply was produced

## Why this matters now

The current repo already shows the gap.

`chat/policy/command-service.ts` currently knows about:

- agent config setup
- bootstrap config loading
- auth resolution
- concrete turn running

That works for a bootstrap phase, but it is not the long-term layer boundary.

If left as-is:

- `Chat` stays coupled to one runtime implementation style
- future local versus external runtime support gets harder
- capability-pack composition becomes less clean

## Local and external symmetry

The runtime port matters especially because openboa wants:

- local agents
- external or ACP-attached agents

`Chat` should not have one codepath that “really works” only for local agents and another ad hoc path for external ones.

The port should let `Chat` ask one high-level question:

- can this participant receive and act on a chat-scoped request?

The adapter under that port can then decide how.

## Relation to chat capability packs

The runtime port is not the same thing as a capability pack.

Different roles:

- capability pack
  - tells a generic agent how to behave in chat
- runtime port
  - gives `Chat` a clean way to deliver participation requests to the runtime layer

So the port preserves the layer boundary, while capability packs preserve the meaning boundary.

## Invariants

The following should remain true:

- `Agent` core does not learn room or thread semantics
- `Chat` does not own provider/runtime-specific execution details
- local and external chat participants normalize behind one thin runtime-facing port
- participation capability is explicit

## Next hardening questions

- What is the smallest delivery request `Chat` can send while still preserving scope and audience?
- Should the runtime port return only reply content, or also structured execution lineage?
- Which failures belong to `Chat` versus the runtime adapter?
- How should a future heartbeat or wake system intersect with chat-triggered delivery?
