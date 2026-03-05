---
title: "System Prompt"
summary: "System prompt assembly contract for openboa single-agent runtime."
---

## Purpose

Define how openboa builds the system prompt for each turn.

Focus:

- predictable assembly sequence
- bootstrap/workspace file injection behavior
- local traceability for replay/debug

---

## Scope

In scope:

- turn-time system prompt assembly
- source order and composition rules
- bootstrap-file injection rules
- prompt safety and audit traceability

Out of scope:

- provider-specific prompt optimization
- dynamic policy editor UI
- required external policy service

---

## OpenClaw Reference (applied, not copied)

This document follows OpenClaw runtime ideas for practical bootstrap injection:

- workspace bootstrap files are injected into context
- blank files are skipped
- missing files inject safe marker text
- large files are trimmed with truncation marker

openboa adaptation:

- use openboa bootstrap set (`PROFILE`, `MANDATE`, etc.)
- keep Local-First defaults and openboa runtime contracts

---

## Prompt Sources and Assembly Sequence

For each turn, runtime composes prompt from these sources in order:

1. **Runtime Header**
   - non-negotiable runtime safety/operation clauses

2. **Agent Core Files**
   - `PROFILE.md`
   - `MANDATE.md`
   - `IDENTITY.md`

3. **Workspace Operation Files**
   - `AGENT.md`
   - `TOOLS.md`

4. **Chat Context**
   - recent message window
   - short memory pointers
   - queued summary (if exists)

5. **Current Input Event**
   - current chat payload

No separate assembly path for Agent↔Human vs Agent↔Agent.

---

## Bootstrap File Consumption

Required for system prompt build:

- `PROFILE.md`
- `MANDATE.md`
- `IDENTITY.md`
- `AGENT.md`
- `TOOLS.md`

Behavior:

- missing file -> inject safe default marker
- empty file -> skip
- oversized file -> deterministic trim + truncation marker

Detailed file definitions are specified in `05-bootstrap.md`.

---

## Prompt Build Artifact

Each turn emits a compiled prompt artifact:

- `promptHash`
- `sourceDigest[]`
- `compiledText`
- `timestampMs`

Suggested local trace path:

- `.openboa/agents/<agentId>/prompts/<sessionId>.jsonl`

This keeps prompt debugging replayable without external infra.

---

## Safety Baseline

1. inbound chat content is untrusted by default
2. tool instructions execute only through runtime policy gate
3. user text cannot override runtime header clauses
4. all prompt builds are traceable in local artifacts

---

## Acceptance Criteria

- prompt assembly sequence is deterministic and testable
- bootstrap file behavior (missing/empty/trim) is defined and implemented
- compiled prompt artifact is locally traceable
- Agent↔Human and Agent↔Agent turns use the same prompt assembly path

---

## Reference Notes (inline)

- **OpenClaw agent runtime docs** were used for bootstrap injection behavior patterns.
- openboa keeps independent file taxonomy and runtime contracts.
