---
title: "Workspace"
summary: "Per-agent workspace contract and chat SOT split for openboa runtime."
---

## Purpose

Define storage boundaries for openboa:

1. each agent has its own workspace
2. chat data has a separate source of truth (SOT)

---

## Scope

In scope:

- per-agent workspace topology
- required bootstrap/work files
- runtime artifact paths
- chat SOT vs session log responsibility split

Out of scope:

- centralized cloud workspace service
- mandatory external backup/storage infra

---

## Workspace Topology

Given a configured root:

- `<workspaceRoot>/`

openboa uses:

1. **Agent Workspace (isolated per agent)**
   - `<workspaceRoot>/agents/<agentId>/workspace/`

2. **Runtime Data Root (system-managed)**
   - `<workspaceRoot>/.openboa/`

3. **Chat SOT (shared by chats, not by agent workspace)**
   - `<workspaceRoot>/.openboa/chat/chats/<chatId>.jsonl`

---

## Required Files (per agent workspace)

Inside `<workspaceRoot>/agents/<agentId>/workspace/`:

Required:

- `AGENT.md`
- `PROFILE.md`
- `MANDATE.md`
- `TOOLS.md`
- `IDENTITY.md`
- `BOOTSTRAP.md` (one-time bootstrap flow)

Optional but recommended:

- `USER.md`
- `MEMORY.md`
- `memory/`
- `.learnings/`

---

## Runtime-Owned Paths

Under `<workspaceRoot>/.openboa/`:

### Per-agent runtime artifacts

- `agents/<agentId>/sessions/<sessionId>.jsonl`
- `agents/<agentId>/state/<sessionId>.json`
- `agents/<agentId>/prompts/<sessionId>.jsonl`
- `agents/<agentId>/context/<sessionId>.jsonl`

### Shared chat artifacts

- `chat/chats/<chatId>.jsonl`
- `chat/cursors/<chatId>/<agentId>.json`

### Audit

- `audit/YYYY-MM-DD.jsonl`

---

## SOT Split (critical)

### Chat SOT

- canonical message stream for 1:1 and group chat
- location: `chat/chats/<chatId>.jsonl`

### Session Log

- runtime execution log for one agent session
- location: `agents/<agentId>/sessions/<sessionId>.jsonl`
- stores turn metadata, tool references, recovery breadcrumbs

Session log does **not** replace chat SOT.

---

## File Behavior Rules

- missing optional files -> safe fallback behavior
- empty files -> treated as intentionally empty
- oversized files -> deterministic trim + truncation marker

Runtime should not perform destructive file operations by default.

---

## Local-First Guarantee

Core runtime must work with local files only:

- per-agent workspace files
- local runtime artifacts
- local chat SOT

No external DB/cache/broker is required for the baseline.

---

## Acceptance Criteria

- each agent has an isolated workspace path
- chat SOT path is separate from session logs
- required workspace files are validated per agent
- local startup/recovery works without external systems

---

## Reference Notes (inline)

- OpenClaw workspace/bootstrap behavior was referenced for practical local-file operation.
- openboa extends this with explicit **per-agent workspace + shared chat SOT** split.
