---
title: "Context"
summary: "Context construction contract for openboa single-agent runtime."
---

## Purpose

Define how openboa builds runtime context for one turn.

Context must be:

- predictable
- bounded
- replayable from local files

---

## Scope

In scope:

- turn-time context composition
- context size budgeting and trimming
- local persistence and recovery behavior
- same context path for Agent↔Human and Agent↔Agent

Out of scope:

- required vector DB / external memory service
- long-term autonomous memory optimization
- cross-tenant shared memory federation

---

## Context Sources (assembly order)

For each turn, runtime assembles context from these sources:

1. **Recent Chat Window**
   - latest messages from current chat
   - includes both inbound and outbound events

2. **Session Runtime State**
   - last checkpoint summary
   - pending queue summary (if exists)
   - last terminal status

3. **Agent Working Memory Pointers**
   - short memory notes relevant to current chat
   - workspace memory references only (local-first)

4. **Tool/Skill Result Snippets**
   - recent tool outputs needed for continuity
   - compacted summaries, not full raw dumps by default

5. **Current Input Event**
   - current event payload (always included)

---

## Context Budget Rules

Runtime uses bounded context windows.

Required controls:

- `maxContextTokens`
- `maxRecentMessages`
- `maxToolSnippetTokens`

When over budget:

1. trim oldest chat items first
2. compact tool outputs to summaries
3. keep current input and latest checkpoint summary

Rules:

- trimming must be deterministic
- runtime should emit a context-trim note in trace data

---

## Context Snapshot (local)

Each turn may emit a compact context snapshot for replay/debug:

```json
{
  "sessionId": "sess_...",
  "turnId": "turn_...",
  "contextHash": "ctx_...",
  "sourceCounts": {
    "messages": 18,
    "memoryPointers": 3,
    "toolSnippets": 2
  },
  "trimmed": true,
  "timestampMs": 1760000000000
}
```

Suggested local path:

- `.openboa/agents/<agentId>/context/<sessionId>.jsonl`

---

## Context Consistency Rules

1. **Single path rule**
   - Agent↔Human and Agent↔Agent use the same context builder

2. **No sender-type branch**
   - sender category does not change context logic

3. **Deterministic replay**
   - same session log + same config => same context hash for same turn

4. **Local-first fallback**
   - if optional connectors are unavailable, local context flow still works

---

## Failure Handling

If context build fails:

- classify as `context_build_error`
- emit terminal `failed`
- include `nextAction` with recovery step
- append failure record to session/audit logs

---

## Acceptance Criteria

- context is assembled from defined source order
- over-budget behavior is deterministic and traceable
- context snapshots are locally replayable
- no external store is required for core context path
- same context contract works for Agent↔Human and Agent↔Agent

---

## Reference Notes (inline)

- **OpenClaw runtime/session docs** were referenced for practical local session + context handling patterns.
- openboa keeps its own context schema and local-first contracts.
