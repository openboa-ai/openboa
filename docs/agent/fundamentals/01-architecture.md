---
title: "Architecture"
summary: "Single-agent fundamentals architecture for openboa (Local-First, Pi-adapted, chat-ready)."
---

## Purpose

Define the architecture backbone for implementing one production-grade openboa agent.

This document is the top-level contract for all fundamentals docs:

- 02 Chat
- 03 Runtime
- 04 Turn
- 05 Bootstrap
- 06 System Prompt
- 07 Context
- 08 Workspace
- 09 Ouath

---

## Scope

In scope:

- Single agent execution runtime
- Agent ↔ Human real-time chat path (WebSocket)
- Agent ↔ Agent real-time chat path (WebSocket)
- Local-first persistence and recovery
- Clear seams for future group/team expansion

Out of scope:

- Required external infra (Postgres/Kafka/Redis)
- Advanced multi-agent coordination logic (planner/scheduler/arbiter class)
- Enterprise federation/cross-business routing

---

## Unified Chat Protocol Contract

Agent ↔ Human and Agent ↔ Agent must use the **same protocol**.

- One WebSocket event envelope for all participants
- Same message types, sequencing, ack semantics, and error model
- Runtime treats sender as an opaque agent identity (no human/agent branching)
- No separate “human protocol” or “agent protocol” at wire level

Gateway adapters may normalize provider-specific payloads, but internal protocol contract remains identical.

---

## Global Principles (openboa)

### 1) Local-First / Zero External Dependency

- openboa core must run right after install on one machine.
- Core runtime must not require external DB/message broker/cache.

### 2) Core vs Connector Boundary

- Core provides default local implementations.
- External systems are optional connectors, not runtime prerequisites.

### 3) Reference, not replica

- OpenClaw/Kubernetes/Kafka patterns are references.
- openboa keeps independent naming, ownership boundaries, and contracts.

---

## Architectural Layers

### A. Control Surface

Owns operator-facing control and lifecycle intent.

Primary component:

- `boa-apiserver`
  - configuration load/validate
  - runtime start/stop/status
  - auth/session bootstrap endpoints

### B. Chat Edge

Owns real-time chat ingress/egress.

Primary component:

- `boa-gateway`
  - WebSocket handshake/session binding
  - inbound message normalization
  - outbound event delivery
  - room/session routing keys

### C. Agent Execution Core

Owns single-agent turn execution.

Primary components:

- `boa-runtime`
  - turn lifecycle
  - system prompt + context assembly
  - tool/skill execution pipeline
- `runtime-adapter-pi`
  - pi session bridge
  - streaming bridge
  - tool callback bridge

### D. Local Durability

Owns append-only history + restart recovery.

Primary components:

- `boa-journal` (JSONL event append)
- `boa-state` (cursor/checkpoint snapshots)
- `boa-audit` (decision/action audit lines)

---

## Pi Integration (inside Architecture)

Pi is embedded as execution substrate, while orchestration responsibility remains in openboa.

### Adapter responsibilities

- open/create/close pi session
- execute prompt turn with streaming
- normalize tool-call and tool-result events
- map terminal states into openboa contract (`completed | failed | denied`)

### openboa-owned responsibilities

- turn policy gates
- bootstrap/system message assembly
- context windowing and memory injection policy
- final result reporting contract
- audit/trace writeback

---

## Runtime Flow

1. Receive normalized chat event from gateway (agent sender)
2. Build execution context (`PROFILE`, `MANDATE`, workspace context, recent history)
3. Open/reuse pi session through adapter
4. Assemble final system prompt (openboa policy first)
5. Resolve tools/skills and apply safety gates
6. Run turn (streaming events back to gateway)
7. Commit terminal result (`success|failure|denied` + reason + next action)
8. Append JSONL journal + update cursor/state

---

## Data and Event Baseline

### Event envelope (core fields)

- `eventId`
- `sessionId`
- `turnId`
- `seq`
- `timestampMs`
- `type`
- `sender` (`agentId`, `instanceId?`, `channelRef?`)
- `traceId`
- `correlationId`
- `payload`

### Local persistence

- chat SOT: `.openboa/chat/chats/<chatId>.jsonl`
- session log: `.openboa/agents/<agentId>/sessions/<sessionId>.jsonl`
- state checkpoint: `.openboa/agents/<agentId>/state/<sessionId>.json`
- audit line: `.openboa/audit/YYYY-MM-DD.jsonl`

---

## Expansion Awareness (designed now, implemented later)

Even in single-agent scope, architecture keeps these seams:

- room abstraction (`dm | group | channel`)
- audience targeting (`direct | mention | room`)
- optional connector slots for external log/store/bus

This allows future group/team growth and advanced coordination without re-architecting the core.

---

## Reliability Contract

For every terminal turn state, report must be emitted:

- `completed` → success summary
- `failed` → failure reason + next action
- `denied` → denial reason + required approval/path

If missing, classify as `report_missing` incident.

---

## Reference Notes (why these references)

- **OpenClaw Agent Runtime / Gateway**: practical baseline for pi-adapted runtime + WS event handling
- **Kubernetes architecture/controller model**: clear separation of control intent vs runtime reconciliation
- **Kafka design semantics**: append-only event thinking, ordering/idempotency/replay mindset

Adoption rule in this document:

- adopt pattern intent,
- modify for local-first constraints,
- keep openboa-owned contracts as final authority.
