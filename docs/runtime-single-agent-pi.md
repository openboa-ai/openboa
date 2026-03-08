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

Optional auth source override (avoid fixed local assumptions):

```bash
OPENBOA_CODEX_AUTH_FILE=/path/to/codex-auth.json pnpm dev -- codex-login
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

## Recovery / Triage

- Storage locations:
  - chat: `.openboa/chat/chats/<chatId>.jsonl`
  - session: `.openboa/agents/<agentId>/sessions/<sessionId>.jsonl`
- Missing file behavior:
  - treated as empty history (no crash)
- Error split:
  - malformed payload / missing required fields / invalid participant kind => `invalid turn envelope`
  - unsupported protocol version => `unsupported protocol: <value>`
- Malformed file behavior:
  - malformed trailing line is skipped (tolerated)
  - malformed non-trailing line fails fast for integrity
- Quick inspection commands:
  - `tail -n 20 .openboa/chat/chats/<chatId>.jsonl`
  - `tail -n 20 .openboa/agents/<agentId>/sessions/<sessionId>.jsonl`
  - `tail -n 20 .openboa/chat/chats/<chatId>.jsonl | jq -c .`

Participant kind constraints:
- `sender.kind` and `recipient.kind` must be one of: `human`, `agent`
- Other values are rejected as `invalid turn envelope`

Invalid protocol quick example:

```json
{
  "protocol": "boa.turn.v0",
  "chatId": "local-chat",
  "sessionId": "local-session",
  "agentId": "pi-agent",
  "sender": { "kind": "human", "id": "operator" },
  "recipient": { "kind": "agent", "id": "pi-agent" },
  "message": "status check"
}
```

Expected error: `unsupported protocol: boa.turn.v0`

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

## CI / PR Triage (Issue #16 scope)

For this runtime track, CI intentionally splits runtime checks from docs-only changes:

- `check` job runs format/lint/type/test when non-doc files changed
- `docs` job runs markdown + link checks when docs changed
- `required-ci` is the single gate expected by branch protection

Quick local parity commands:

```bash
pnpm check
pnpm check:docs
pnpm docs:linkcheck
```

## PR Reviewer Quick-Verify

- `pnpm check`
  - expected: format/lint/type/test all pass
- `pnpm check:docs`
  - expected: markdown/docs checks pass
- `pnpm -s vitest run test/runtime.single-agent.test.ts test/runtime.gateway.validation.test.ts`
  - expected: runtime core + gateway contract tests pass

If fail, check this first: run in repo root and ensure Node/pnpm deps are installed (`pnpm install --frozen-lockfile`).

## AC to Test Matrix (Issue #16)

| Acceptance Criteria | Evidence |
| --- | --- |
| Single-agent e2e turn path | `test/runtime.single-agent.test.ts` |
| Restart recovery (checkpoint) | `test/runtime.single-agent.test.ts` |
| Protocol/gateway input safety | `test/runtime.gateway.validation.test.ts` |
| Context budget trimming boundary | `test/runtime.context-builder.test.ts` |
| Runtime flow + triage docs | `docs/runtime-single-agent-pi.md` |

## Verification Targets

- Local single-agent startup without external infrastructure
- End-to-end turn execution with persisted chat/session logs
- Single protocol route for Agent ↔ Human and Agent ↔ Agent
- Checkpoint chain available for restart recovery

## Validation Matrix

| Acceptance Criteria | Evidence |
| --- | --- |
| Agent setup + runtime turn success | `test/runtime.single-agent.test.ts` |
| Baseline runtime harness health | `test/smoke.test.ts` |
| Runtime docs + link integrity | `pnpm check:docs` |

Run commands:

```bash
pnpm check
pnpm check:docs
pnpm -s vitest run test/runtime.single-agent.test.ts test/smoke.test.ts
```
