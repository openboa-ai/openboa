---
title: "Chat Kernel"
summary: "Backend-first chat truth, projections, and why Chat is a durable coordination fabric rather than a shell feature."
---
# Chat Kernel


`Chat` is not just the current wedge.
It is also a backend-first coordination kernel.

That means the shell is downstream of chat truth, not the other way around.

## Core split

The current chat subsystem should be read in three layers:

- `src/chat/core/`
  - durable truth
- `src/chat/policy/`
  - room-local commands and participation rules
- `src/chat/projections/`
  - rebuildable product views

## Truth versus projection

Shared truth includes durable facts such as:

- rooms
- memberships
- grant bindings
- messages
- reactions
- cursor updates

Product views such as:

- unread
- mention lists
- inbox
- sidebar activity
- transcript shaping

are projections.

That distinction is what keeps Chat believable as a backend layer rather than a UI-only feature.

## Agent relationship

Agents do not own Chat.
Chat does not define Agent core semantics.

Instead:

- Chat can route communication into sessions
- Agent can execute on session events

That seam is what keeps the Agent layer domain-agnostic.

## Related reading

- [Chat](./chat.md)
- [Architecture](./architecture.md)
- [Agent Runtime](./agent-runtime.md)
