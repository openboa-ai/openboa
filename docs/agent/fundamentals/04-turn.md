---
title: "Turn"
summary: "Single-chat turn model for openboa."
---

## Purpose

Define the single-chat turn model.

A turn is one chat unit:

- one inbound chat event
- one runtime execution path
- one outbound result (or denial/failure)

---

## Turn Identity

Required:

- `turnId`
- `sessionId`
- `chatId`
- `traceId`
- `correlationId`

Optional:

- `idempotencyKey`
- `causationId`

---

## Single-Chat Turn Model

```text
1) Receive
2) Understand
3) Decide
4) Execute (optional tools)
5) Respond
6) Record
```

### 1) Receive

- gateway forwards normalized chat event
- runtime validates required fields
- runtime acquires per-session turn lock

### 2) Understand

- load current context (recent messages + workspace contracts + memory pointers)
- build minimal objective for this turn

### 3) Decide

- run model inference through pi adapter
- choose response path:
  - direct response
  - tool-assisted response
  - deny/fail with reason

### 4) Execute (optional tools)

- run approved tool calls (if needed)
- feed tool results back to model
- keep execution bounded by timeout/call limits

### 5) Respond

- emit one terminal result:
  - `completed`
  - `failed`
  - `denied`
- include `reason` and `nextAction` when not completed

### 6) Record

- append events and terminal result to JSONL
- update checkpoint/cursor
- release turn lock

---

## Runtime Invariants

1. Exactly one terminal status per turn
2. No sender-type branch (same path for all `sender.agentId`)
3. Bounded execution (token/tool/time limits)
4. Persist-before-finish (record succeeds before turn closes)
5. Restart-recoverable from local files only

---

## Tool Execution Rules

- All tools pass policy + schema validation first
- Tool failures are structured (`tool_runtime_error`)
- Tool loop is bounded (`maxToolCallsPerTurn`, timeout caps)

If bounds are exceeded:

- turn ends as `failed`
- `nextAction` must suggest recovery

---

## Queue Behavior During Active Turn

Default:

- new events are queued (`collect`) for next turn

Optional:

- `steer` policy can inject after safe boundary

In both modes:

- current turn must end with terminal status
- partial/half-committed turn is invalid

---

## Failure Classes

- `invalid_input`
- `policy_denied`
- `tool_runtime_error`
- `timeout`
- `provider_error`
- `report_missing`

---

## Local-First Recovery

On restart:

1. load last checkpoint
2. inspect last turn entry in JSONL
3. if last turn is non-terminal, close as recovered failure
4. continue from next inbound event

No external DB/broker required.

---

## Acceptance Criteria

- Turn follows the 6-step single-chat model
- One terminal status is always emitted
- Same runtime path is used for Agent↔Human and Agent↔Agent
- JSONL + checkpoint recovery works locally
