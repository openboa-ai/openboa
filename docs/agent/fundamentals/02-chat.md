---
title: "Chat"
summary: "Unified WebSocket chat contract for Agent↔Human and Agent↔Agent in openboa."
---

## Purpose

Define the chat contract for openboa fundamentals.

This document makes one rule explicit:

> **Agent ↔ Human and Agent ↔ Agent must use the same wire protocol.**

No separate protocol by participant type.

---

## Scope

In scope:

- Real-time WebSocket chat
- DM and basic group room model
- Unified event envelope and ack/replay semantics
- Local-first durability using JSONL

Out of scope:

- Required external infra (Kafka/Redis/Postgres)
- Advanced room governance (enterprise federation, org-wide ACL engine)
- Planner/scheduler style multi-agent coordination logic

---

## Core Chat Principles

1. **Single Protocol, All Agents**
   - Same event schema for all participants
   - Runtime does not branch by sender type

2. **Agent Identity, Not Agent Category**
   - Sender is represented as agent identity only
   - Do not encode `human|agent` type for runtime branching

3. **Local-First Durability**
   - Chat history is append-only JSONL
   - Replay/catch-up works without external services

4. **Chat-Centric Ordering**
   - Ordering is per chat via monotonic `seq`
   - Timestamps are metadata, not ordering authority

---

## Chat Model

### Agent Participant

A participant in chat is modeled as an agent identity.

- Required: `agentId`
- Optional: `instanceId`, `channelRef`

> Human users are represented as gateway-mapped external agents (identity only), so runtime handling stays unified.

### Chat

A stream boundary for ordered messages.

- `dm` (1:1)
- `group` (N participants)
- `channel` (reserved seam for wider audience)

### Message Semantics

- `chat.message` (final text/message payload)
- `chat.delta` + `chat.commit` (streaming)
- `control.error` (structured failures)
- `chat.ack` (delivery/processing progress)

---

## WebSocket Session Contract

### Connection

Single endpoint shape (example):

- `ws://<host>/ws/chat?agentId=...&sessionId=...&token=...`

Handshake and auth flow are identical for all agents.

### Lifecycle

1. connect
2. subscribe (chat + cursor)
3. send/receive events
4. ack
5. replay on reconnect

---

## Unified Event Envelope

```json
{
  "eventId": "evt_...",
  "chatId": "chat_...",
  "seq": 1042,
  "timestampMs": 1760000000000,
  "type": "chat.message",
  "sender": {
    "agentId": "agent.alice",
    "instanceId": "alice-1",
    "channelRef": "discord:channel:..."
  },
  "idempotencyKey": "req-...",
  "traceId": "tr_...",
  "correlationId": "turn-55",
  "payload": {}
}
```

Notes:

- `sender` has identity only; no sender-type branching field
- `idempotencyKey` is required for safe retries

---

## Delivery, ACK, Replay

### Delivery Semantics

- Baseline: at-least-once
- Dedup key: `(chatId, sender.agentId, idempotencyKey)`

### ACK Levels

- `delivered` (received by client)
- `processed` (applied by runtime/client)

### Replay

- Client subscribes with `fromSeq`
- Gateway replays missing events from local JSONL journal

---

## Local Persistence Layout (default)

- chat log:
  - `.openboa/chat/chats/<chatId>.jsonl`
- agent cursor:
  - `.openboa/chat/cursors/<chatId>/<agentId>.json`
- chat audit lines:
  - `.openboa/audit/chat/YYYY-MM-DD.jsonl`

This keeps core chat fully runnable without external infra.

---

## Gateway Responsibilities (Chat)

`boa-gateway` must:

- normalize inbound channel payloads into unified envelope
- allocate/validate chat sequence (`seq`)
- enforce minimal membership/policy gates
- append before fanout (durability-first)
- deliver push and replay from same contract

---

## Group/Team Expansion Readiness

Even in single-agent-first implementation, chat keeps these seams ready:

- room membership table/contract
- mention/audience routing (`direct | mention | room`)
- room policy hooks (join/send)

So team and multi-agent growth can be added without protocol fork.

---

## Acceptance Criteria

- Agent↔Human and Agent↔Agent use identical event schema
- Runtime path has no sender-type branch
- Reconnect replay works via `fromSeq`
- Duplicate sends are idempotent
- Core chat works with local files only
