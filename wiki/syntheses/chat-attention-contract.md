# Chat Attention Contract

This page hardens how `Chat` models attention.

Use it when:

- unread, mention, inbox, cursor, or follow semantics are drifting
- the repo needs a durable split between attention truth and attention projections
- agent wake or follow-up behavior depends on chat attention semantics

This is a working contract, not yet the final canonical product spec.

## Core thesis

`Chat` is not only transcript storage.

It also has to answer:

- what should each participant pay attention to next?

That is the job of the attention model.

The most important distinction is:

- some attention state belongs in durable truth
- some attention state is a rebuildable projection

If those are mixed together, the system becomes brittle.

## Attention truth versus attention projection

Durable truth should likely include:

- participant cursors
- scope attachments or follow state
- durable mention facts already embedded in messages

Rebuildable projection should include:

- unread counts
- mention counts
- inbox ordering
- activity badges
- thread follow-up lists

Rule of thumb:

- if the fact is a participant's durable relationship to a scope, it belongs closer to truth
- if the fact is a derived “what to show next” view, it belongs in projection

## Cursor semantics

A cursor is not a visual scroll position.

It is a durable statement about what a participant has observed in a scope.

The current shape is directionally right:

- cursor is scoped by conversation and optional thread
- it records last observed sequence for that scope
- it can separately note last contributed sequence

This means the system can rebuild unread state without the shell remembering UI offsets.

## Attachment and follow semantics

Attention is not only about what was read.

It is also about what a participant is attached to.

Examples:

- following a room mainline
- following a specific thread
- explicitly attaching to a scope because it matters

This matters because:

- unread only matters relative to followed scopes
- inbox needs durable signals for what still deserves attention
- agents may need stable follow state to support proactive wake behavior

## Mention semantics

Mention is a message fact, not an inbox projection.

That means:

- mention parsing or explicit mention lists should become durable message truth
- mention count is then derived from message truth plus participant attention state

This is important because mentions are not merely decorative.

For agents, they may become one of the cleanest wake and routing signals in the system.

## Inbox as projection

Inbox should stay a projection.

It may combine:

- direct audience
- mentions
- followed-thread activity
- future work or approval-related signals

But the inbox itself should not become the source of truth for those categories.

This matters because inbox behavior will likely evolve product-wise, while the underlying attention facts should remain durable.

## Agent implications

Agents make attention more demanding than ordinary human chat.

Why:

- an agent may need to decide whether to wake, defer, or reply
- an agent may need to distinguish room chatter from direct audience
- an agent may need to follow a thread without “reading” every room message

So the attention model must be durable and explicit enough for machine participants, not just visually plausible for humans.

## Current repo implications

The repo already has strong ingredients:

- cursor records scoped by conversation and thread
- attachment records scoped by conversation and thread
- mention ids on messages
- rebuildable inbox, thread, and unread projections

That is the right direction.

The next hardening step is to define what guarantees those pieces are meant to provide, especially for proactive agents.

## Invariants

The following should remain true:

- cursor is durable truth, not shell state
- follow/attachment is durable truth, not shell state
- unread and inbox are projections
- mention counts are derived from message truth and participant attention state
- attention always remains scope-aware

## Next hardening questions

- What should count as “observed” for a participant or agent?
- Should following a thread imply any inherited room attention semantics?
- What attention facts should be enough to trigger a future agent heartbeat wake?
- Which parts of presence belong here versus some separate activity model?
