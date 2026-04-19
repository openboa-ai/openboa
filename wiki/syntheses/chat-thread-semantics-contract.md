# Chat Thread Semantics Contract

This page hardens what a thread means in openboa.

Use it when:

- thread handling risks becoming a presentation hack
- reply flows, follow behavior, or unread semantics are being designed
- the repo needs a durable answer to how thread scope differs from room mainline

This is a working contract, not yet the final canonical product spec.

## Core thesis

A thread is a durable scoped sub-conversation inside a parent room.

It is not:

- a comment widget
- a UI accordion
- an alternate rendering of the same room stream

If threads are not real domain scopes, agent participation and unread semantics will become fragile.

## Root and reply model

The current direction should remain:

- a thread starts from a top-level root message in a room mainline
- replies belong to the thread scope
- the root stays in the room mainline
- thread replies do not become top-level room messages

This implies:

- the room mainline and the thread are related but distinct scopes
- the root message bridges them

## No nested threads

Nested threads should remain out of scope.

Reason:

- they complicate audience, unread, and context semantics quickly
- they make agent context windows harder to reason about
- they weaken the clarity of “room mainline vs focused follow-up”

So the durable rule should be:

- only top-level room messages can be thread roots
- replies cannot become new thread roots

## Scope-local ordering

Ordering should be scope-local.

That means:

- room mainline has its own scope order
- each thread has its own scope order

This is stronger and cleaner than pretending one global message order is what matters.

For users and agents, the important question is:

- what happened next in this scope?

not:

- what was globally appended next somewhere in the ledger?

## Thread as agent context boundary

This is one of the most important reasons thread semantics matter.

A chat-capable agent should be able to tell:

- am I acting in the room mainline?
- am I acting in a specific focused follow-up scope?
- what root message defines the thread context?
- which participants are implicitly relevant to this thread?

So thread is not just for human reading comfort.
It is one of the main context boundaries that lets machine participants behave coherently.

## Follow and attachment semantics

Thread following should be treated as durable chat truth.

At minimum, the system should be able to record:

- whether a participant is attached to the room mainline
- whether a participant is attached to a given thread

This matters because:

- unread should depend on whether the participant is following the scope
- inbox and follow-up surfaces should reflect that scope attachment
- agents may need explicit thread follow state to know when they should continue paying attention

## Thread unread semantics

Unread in a thread should not be the same as unread in the room mainline.

The durable rule should be:

- unread is scoped
- room unread is about the room mainline
- thread unread is about replies under that root

This allows:

- a room to stay “read enough” while a followed thread still needs attention
- a participant to ignore most of a room but follow one thread closely

## Thread history and lineage

A thread should inherit context from its parent room, but it is not identical to the room.

The system should always be able to answer:

- which room owns this thread?
- which root message created this thread?
- which replies belong to this thread?
- what room-level lineage is still relevant when opening the thread?

This is especially important for search, transcript reconstruction, and agent context assembly.

## UI implications that should not leak into truth

The shell may choose to render threads as:

- a right pane
- a stacked view
- a mobile push screen

But those are presentation choices.

The backend truth should stay the same regardless of shell layout.

If thread meaning changes when the shell changes, thread semantics are not yet strong enough.

## Current repo implications

The current repo already suggests the right constraints:

- `threadId` points to an existing top-level root message
- replies cannot be nested
- cursors and attachments are already scope-aware by `(conversationId, threadId)`

That is a strong start.

The remaining work is to make those semantics more explicit and less shell-shaped.

## Invariants

The following should remain true:

- a thread is a real backend scope
- the root message belongs to the room mainline
- replies belong to the thread scope
- replies cannot start nested threads
- follow and unread are scope-aware
- thread semantics stay stable even if the shell presentation changes

## Next hardening questions

- What exactly should “following a thread” guarantee?
- Should thread audience be inherited entirely from the room, or can it narrow further?
- Which system events are room-native versus thread-native?
- What is the minimum thread context a chat-capable agent must receive before replying?
