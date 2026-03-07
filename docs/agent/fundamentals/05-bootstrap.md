---
title: "Bootstrap"
summary: "Per-agent bootstrap file contract for openboa single-agent runtime."
---

## Purpose

Define the bootstrap files required to initialize and run one openboa agent.

Bootstrap files are the agent’s stable operating inputs for:

- identity
- behavior
- mandate
- workspace operating rules

---

## Scope

In scope:

- required bootstrap file set
- per-file role/responsibility
- missing/empty/oversized handling
- first-run bootstrap flow

Out of scope:

- GUI bootstrap editors
- centralized profile registry service
- mandatory external storage for bootstrap files

---

## Location

Bootstrap files are per-agent and live in:

- `<workspaceRoot>/agents/<agentId>/workspace/`

They are **not** shared across agents.

---

## Required Bootstrap Files

1. `AGENT.md`
2. `PROFILE.md`
3. `MANDATE.md`
4. `TOOLS.md`
5. `IDENTITY.md`
6. `BOOTSTRAP.md` (first-run only)

Recommended optional files:

- `USER.md`
- `MEMORY.md`
- `memory/`
- `.learnings/`

---

## File Roles

### `AGENT.md`

Operational rules for how this agent works:

- workflow rules
- reporting style
- execution boundaries

### `PROFILE.md`

Behavior/persona baseline:

- tone
- response style
- default behavioral preferences

### `MANDATE.md`

Responsibility contract:

- scope
- success criteria
- non-goals and boundaries

### `TOOLS.md`

Environment/tool notes:

- local tool conventions
- command gotchas
- machine-specific usage hints

### `IDENTITY.md`

Identity metadata:

- name
- short descriptor
- symbolic identity fields (optional)

### `BOOTSTRAP.md`

First-run initialization script-like guidance:

- used when workspace is first initialized
- can be removed after initialization is completed

---

## Runtime Consumption Rules

For each turn, runtime may read these files when assembling prompt/context.

Handling policy:

- missing required file -> inject safe marker + continue
- empty file -> skip
- oversized file -> deterministic trim + truncation marker

This keeps runtime resilient and deterministic.

---

## First-Run Flow

1. create agent workspace if missing
2. create default bootstrap file templates if missing
3. execute first-run guidance from `BOOTSTRAP.md`
4. persist initialization status in runtime state
5. subsequent runs treat `BOOTSTRAP.md` as optional legacy artifact

---

## Bootstrap and Chat Boundary

Bootstrap files are agent-local configuration inputs.

They are separate from chat data:

- bootstrap source: `agents/<agentId>/workspace/*`
- chat SOT: `.openboa/chat/chats/<chatId>.jsonl`

Runtime must keep this boundary intact.

---

## Acceptance Criteria

- required bootstrap file set is validated per agent
- file-role responsibilities are documented and enforced
- missing/empty/oversized behavior is deterministic
- first-run bootstrap can complete without external systems
- bootstrap inputs and chat SOT remain clearly separated

---

## Reference Notes (inline)

- OpenClaw bootstrap-file injection behavior was referenced as practical baseline.
- openboa uses its own file taxonomy (`PROFILE`, `MANDATE`, `AGENT`) and per-agent workspace boundary.
