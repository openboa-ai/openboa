---
title: "Runtime"
summary: "Execution runtime contract for one openboa agent (Pi-adapted, local-first, chat-native)."
---

## Purpose

Define how a single openboa agent actually runs at turn level.

This document specifies runtime responsibilities, state transitions, and reliability guarantees.

---

## Runtime Boundary

`boa-runtime` is responsible for execution.

It is **not** responsible for:

- transport protocol ownership (gateway owns)
- external infra operation (connectors are optional)
- organization-level governance policy authoring

It **is** responsible for:

- turn lifecycle control
- system prompt/context assembly
- tool/skill invocation pipeline
- terminal result contract (`completed | failed | denied`)
- session append + checkpoint writeback

---

## Runtime Components

1. **Turn Executor**
   - runs one turn from input event to terminal report

2. **Context Assembler**
   - loads runtime context from workspace + recent session history
   - applies token/window budget policy

3. **Prompt Builder**
   - composes final system prompt from openboa contracts
   - ensures policy/system clauses are first-priority

4. **Tool & Skill Bridge**
   - resolves tool definitions
   - validates schema + permission before execution

5. **Pi Adapter Client** (`runtime-adapter-pi`)
   - open/reuse session
   - stream model events
   - normalize runtime outputs to openboa event model

6. **State Writer**
   - append JSONL events
   - update cursor/checkpoint files
   - emit audit lines

---

## Runtime Input Contract

Runtime consumes normalized chat events from gateway.

Minimum input fields:

- `eventId`
- `chatId`
- `seq`
- `sender.agentId`
- `type`
- `payload`
- `traceId`
- `correlationId`

Runtime must treat all senders uniformly as `agentId` identities.
No human/agent branch at runtime path.

---

## Session Model

### Session Key

Default key basis:

- `agentId`
- `chatId`

### Turn Concurrency

Default:

- one active turn per session key
- new events during active turn are queued by gateway/runtime queue policy

### Persistence Paths

- session append: `.openboa/agents/<agentId>/sessions/<sessionId>.jsonl`
- state checkpoint: `.openboa/agents/<agentId>/state/<sessionId>.json`
- runtime audit: `.openboa/audit/runtime/YYYY-MM-DD.jsonl`

### Storage Role Split (critical)

- **Chat SOT**: `.openboa/chat/chats/<chatId>.jsonl`
  - canonical chat message stream (1:1 and group)
- **Session log**: `.openboa/agents/<agentId>/sessions/<sessionId>.jsonl`
  - runtime turn metadata, tool/results references, recovery breadcrumbs

Session log is not the source of truth for chat messages.

---

## Turn Lifecycle

```text
idle
 -> preparing
 -> running
 -> waiting_tool (optional, repeatable)
 -> committing
 -> completed | failed | denied
```

### Step details

1. **preparing**
   - load context
   - build system prompt
   - resolve tools/skills

2. **running**
   - execute prompt via pi adapter
   - stream deltas/events

3. **waiting_tool**
   - validate and execute tool calls
   - return tool result events back to runtime

4. **committing**
   - finalize assistant output
   - emit terminal status payload
   - persist journal/checkpoint/audit

---

## Tool & Skill Execution Rules

1. All tool calls pass policy gate before execution.
2. Input schema validation failure returns structured error; no blind execution.
3. Tool runtime exceptions are captured as `tool_runtime_error` terminal or intermediate errors.
4. Skills are runtime hints/recipes; execution authority remains in runtime policy + tool contracts.

---

## Reliability Contract

For every turn, runtime must emit exactly one terminal status:

- `completed`
- `failed`
- `denied`

Terminal payload must include:

- `status`
- `reason` (for failed/denied)
- `nextAction` (recovery hint)
- `traceId`
- `correlationId`

Missing terminal report is `report_missing` incident.

---

## Error Classes

- `invalid_input`
- `policy_denied`
- `tool_runtime_error`
- `timeout`
- `auth_error`
- `provider_error`
- `report_missing`

---

## Local-First Runtime Guarantee

Runtime must boot and execute with local defaults only:

- local file-backed journal/state/audit
- embedded pi adapter
- no required external DB or broker

External connectors may replace storage or event backends later, but runtime contract stays unchanged.

---

## Acceptance Criteria

- Runtime executes one turn end-to-end through pi adapter
- Tool pipeline enforces validation + policy gates
- One terminal report is always emitted
- Session recovery works from local checkpoint + JSONL append
- Agent↔Human and Agent↔Agent events share same runtime path
