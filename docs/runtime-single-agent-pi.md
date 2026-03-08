---
title: "Single-Agent Runtime (Pi)"
summary: "Minimal local-first single-agent runtime flow implemented for issue #16."
read_when:
  - You need to run the minimal Pi-backed runtime locally
  - You want to inspect chat/session storage boundaries
---

This page documents the minimal runtime path added for the single-agent Pi implementation.

## What It Includes

- Unified turn envelope protocol for both Agent ↔ Human and Agent ↔ Agent:
  - `protocol: "boa.turn.v1"`
- Minimal gateway WebSocket route handler:
  - `BoaGateway.handleWebSocketMessage(rawJson)`
- Runtime turn loop:
  - inbound persist -> context build -> adapter stream -> outbound persist -> checkpoint append
- Local JSONL boundaries:
  - Chat source of truth: `.openboa/chat/chats/<chatId>.jsonl`
  - Session metadata/checkpoints: `.openboa/agents/<agentId>/sessions/<sessionId>.jsonl`
- Bootstrap/system prompt/context path:
  - `.openboa/bootstrap/runtime.json` (`tokenBudget`)
  - `.openboa/system/base.prompt`
  - `.openboa/system/agents/<agentId>.prompt`
- Minimal Codex auth reference path:
  - `CODEX_API_KEY` env first
  - fallback `.openboa/auth/codex.oauth.json`

## Run Locally

```bash
pnpm dev -- "hello pi runtime"
```

This executes one local turn with the minimal runtime and writes JSONL artifacts under `.openboa/`.

## Agent Setup: Codex Auth + Pi Runtime

Quick setup command:

```bash
pnpm dev -- setup-codex-pi-agent [agentId]
```

Run Codex browser login + workspace OAuth sync:

```bash
pnpm dev -- codex-login
```

Default auth method is `oauth-browser` and default UI mode is `tui`.

Run interactive TUI chat:

```bash
pnpm dev -- tui [agentId]
```

Create `.openboa/agents/pi-agent/agent.json`:

```json
{
  "runtime": "pi",
  "auth": {
    "provider": "codex",
    "required": true
  }
}
```

Auth resolution order:
- `CODEX_API_KEY` env
- fallback `.openboa/auth/codex.oauth.json` (valid/unexpired `accessToken`)

When `required: true`, turns fail fast until a Codex token is configured.

## Failure Modes / Quick Triage

- Auth required but missing:
  - `run 'codex login' to open browser oauth first`
  - then run `pnpm dev -- codex-login`
- Token lookup order to verify quickly:
  - `CODEX_API_KEY` -> `.openboa/auth/codex.oauth.json`
- Inspect runtime artifacts:
  - `.openboa/chat/chats/*.jsonl`
  - `.openboa/agents/*/sessions/*.jsonl`

## Protocol Envelope Example

```json
{
  "protocol": "boa.turn.v1",
  "chatId": "local-chat",
  "sessionId": "local-session",
  "agentId": "pi-agent",
  "sender": { "kind": "human", "id": "operator" },
  "recipient": { "kind": "agent", "id": "pi-agent" },
  "message": "status check"
}
```

## Verification Targets

- Local single-agent startup without external infrastructure
- End-to-end turn execution with persisted chat/session logs
- Single protocol route for Agent ↔ Human and Agent ↔ Agent
- Checkpoint chain available for restart recovery
