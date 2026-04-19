# Chat Participant Binding Contract

This page hardens how participants become chat citizens.

Use it when:

- participant modeling risks staying human-only or bot-like
- agent registration and chat participation are getting conflated
- room access, mentionability, or DM reachability rules need a durable home

This is a working contract, not yet the final canonical product spec.

## Core thesis

`Chat` should not create agents.

`Chat` should bind already-registered participants into durable communication scopes.

So there are two separate steps:

1. `registration`
   - happens below `Chat`
   - proves that a runnable participant exists
2. `binding`
   - happens inside `Chat`
   - makes that participant reachable and governable inside company communication

This split is mandatory.

If registration and binding collapse together:

- `Chat` becomes too dependent on agent runtime internals
- runtime onboarding and room participation get tangled
- the system cannot cleanly support multiple runtime kinds later

## Participant kinds

`Chat` should treat three participant kinds as first-class:

- `human`
- `agent`
- `system`

Important implication:

- agents are not sidecar integrations
- agents are not UI-only bots
- agents can be direct participants in channels, DMs, group DMs, and threads

## Registration boundary

Registration belongs below `Chat`.

Registration should answer:

- does this participant exist?
- what is its stable identity?
- what runtime kind exists behind it?
- what protocol or adapter family does it use?
- what high-level capabilities can it expose?

For agents, registration metadata may include:

- participant id
- runtime kind
- protocol
- capability list
- display name

But that metadata does not by itself grant any chat rights.

Registration means:

- the participant can be referenced

It does not mean:

- the participant can read a room
- the participant can post
- the participant can be mentioned everywhere
- the participant can receive DMs

## Binding boundary

Binding belongs to `Chat`.

Binding should answer:

- can this participant join a scope?
- can this participant be invited?
- can this participant be mentioned?
- can this participant receive direct audience?
- what role and grant shape applies inside this scope?

Binding creates chat citizenship.

That citizenship may be:

- company-wide for discovery or admin scopes
- conversation-scoped for ordinary participation
- restricted to observer behavior

## What binding should enable

When a registered participant is bound into `Chat`, the system may grant:

- membership in a room
- DM reachability
- mentionability
- thread participation
- room-local roles
- visibility rights
- posting rights

Those should be modeled as chat facts and policy decisions, not UI settings.

## Binding is not the same as membership

Binding and membership are related, but not identical.

Recommended distinction:

- binding
  - says this participant is eligible to act as a chat citizen in some scope
- membership
  - says this participant is currently joined to a specific conversation

That distinction matters because a participant may be:

- registered but not bound
- bound at the company level but not joined to a room
- bound and joined but limited to observer behavior

## Role and grant model

`Chat` should own participation rights, not the runtime layer.

At minimum, binding should compose with:

- participant kind
- room membership
- room-local roles
- company-level roles
- visibility and posting policy

This keeps access control below the shell and above the runtime core.

## DMs and reachability

Direct communication needs special care.

Questions `Chat` must answer:

- which participants are DM-addressable?
- can a human open a DM with any registered agent?
- can agents open DMs with each other?
- can a participant be visible in search but not directly reachable?

The likely long-term answer is:

- registration exposes potential reachability
- chat binding and policy decide actual reachability

## Mentionability and audience

Mentionability should be treated as a chat capability, not a UI trick.

The system should be able to tell:

- whether a participant can be targeted by direct audience
- whether a participant can be explicitly mentioned
- whether mass-mention semantics apply in a given scope

This matters more for agents than humans because mention semantics become one of the cleanest wake signals for chat-capable agents.

## Agent-specific implications

For agents, binding must not leak room semantics into the agent core.

So the correct flow is:

- the agent runtime is registered below `Chat`
- `Chat` binds that participant into communication scopes
- chat capability packs later tell the runtime how to behave once it is addressed

That means:

- `Chat` knows the participant id and capability metadata
- `Agent` still does not know what a room or thread is in its core contract

## Current repo implications

The current repo already points in this direction:

- `participant.upserted` exists for agents
- runtime kind and protocol are attached to participant records
- chat capability is explicit
- grants and memberships are separate records

But current gaps remain:

- humans and systems are still more implicit than agents
- command handling still reaches into concrete agent runtime setup
- the durable meaning of DM reachability versus room binding is not yet fully locked

## Invariants

The following should remain true:

- registration stays below `Chat`
- binding stays inside `Chat`
- membership is not the same as registration
- a participant can exist without being room-bound
- access and participation rules stay enforceable without the shell
- agent participation does not require teaching the agent core about rooms

## Next hardening questions

- What is the minimal participant record shape that `Chat` needs from registration?
- Which chat rights should come from company-level binding versus room-level membership?
- Should DM reachability be explicit policy or derived from participant kind and grants?
- How should observer-style bindings differ from full participant bindings for agents?
