---
title: "Single-Agent Runtime (Pi)"
summary: "Minimal local-first single-agent runtime flow implemented for issue #16."
read_when:
  - You need to run the minimal Pi-backed runtime locally
  - You want to inspect chat/session storage boundaries
---

This page documents the minimal runtime path added for the single-agent Pi implementation.

## CLI-first bootstrap (OpenClaw-style)

Use the repo-local CLI via `pnpm openboa ...`:

## Global install (next-step, CLI-first)

If you want the same ergonomics as `openclaw` (install once, run anywhere):

- build once:
  - `pnpm build`
- install from source tree:
  - `pnpm install -g .` (or package-specific publish flow)
- then run directly:
  - `openboa setup`
  - `openboa agent spawn --name <agent_id>`
  - `openboa agent chat --name <agent_id>`

Current repository state currently exposes a local CLI entry (`pnpm openboa`).
Global install + Homebrew formula generation is planned once packaging policy is finalized.

- `pnpm openboa setup`
  - creates `.openboa` workspace scaffold (`bootstrap/runtime.json`, `system/base.prompt`, required folders)
- `pnpm openboa agent spawn --name <agent_id>`
  - creates agent runtime config under `.openboa/agents/<agent_id>/agent.json`
- `pnpm openboa agent list`
  - lists configured agents
- `pnpm openboa agent chat --name <agent_id>`
  - starts interactive chat with that agent
- `pnpm openboa setup-codex-pi-agent <agent_id>`
  - legacy alias of `agent spawn`
- `pnpm openboa codex-login`
  - launches oauth flow and writes `.openboa/auth/codex.oauth.json`

Deprecated/compat path (still available):
- `pnpm dev -- "hello pi runtime"` for one-shot turn with default agent
- `pnpm dev -- tui [agentId]` for direct TUI

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

## New quick flow (recommended)

```bash
pnpm openboa setup
pnpm openboa agent spawn --name agent_1
pnpm openboa agent chat --name agent_1
```

Example:

```bash
# first-time setup
pnpm openboa setup

# optional: use env key per shell
export CODEX_API_KEY=...

# create one isolated agent runtime
pnpm openboa agent spawn --name agent_1

# start a persistent interactive session
pnpm openboa agent chat --name agent_1
# type 'exit' to quit
```

Notes:
- Agent config is created with `auth.required: true` by default.
- If code key is unavailable, use `pnpm openboa codex-login` first.
- No secrets are printed or committed.

## API Mode (Pi, API-key only)

Start API server:

```bash
export OPENAI_API_KEY="<your-openai-api-key>"
pnpm dev -- serve
```

Health check:

```bash
curl -s http://127.0.0.1:8787/health
```

Chat call:

```bash
curl -s http://127.0.0.1:8787/chat \
  -H 'content-type: application/json' \
  -d '{"message":"hello from pi"}'
```

Notes:
- API key is env-only (`OPENAI_API_KEY`), never committed in files.
- `/chat` enforces request size limit and timeout with normalized error responses.
- Session continuity is preserved through default ids (`api-chat` / `api-session`) or caller-provided ids.

## Operation Modes (Pi)

- One-loop (single turn):
  - `pnpm dev -- "hello pi runtime"`
- Forever (HTTP service):
  - `pnpm dev -- serve`

Minimal `systemd` service sketch:

```ini
[Unit]
Description=openboa pi chat api
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/openboa
Environment=CODEX_API_KEY=REDACTED
Environment=OPENBOA_API_HOST=0.0.0.0
Environment=OPENBOA_API_PORT=8787
ExecStart=/usr/bin/env pnpm dev -- serve
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

## Failure Modes / Quick Triage

- Auth required but missing:
  - `run 'openboa codex-login' for oauth`
  - or set `CODEX_API_KEY`
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

## Validation Matrix (Canonical)

| Acceptance Criteria | Evidence (file) | Verify command |
| --- | --- | --- |
| CLI bootstrap + agent lifecycle | `src/index.ts`, `src/runtime/setup.ts`, `docs/runtime-single-agent-pi.md` | `pnpm openboa setup && pnpm openboa agent spawn --name agent_1 && pnpm openboa agent list` |
| Single-agent e2e turn path | `test/runtime.single-agent.test.ts` | `pnpm -s vitest run test/runtime.single-agent.test.ts` |
| Restart recovery (checkpoint) | `test/runtime.single-agent.test.ts` | `pnpm -s vitest run test/runtime.single-agent.test.ts -t "checkpoint"` |
| Protocol/gateway input safety | `test/runtime.gateway.validation.test.ts` | `pnpm -s vitest run test/runtime.gateway.validation.test.ts` |
| Context budget trimming boundary | `test/runtime.context-builder.test.ts` | `pnpm -s vitest run test/runtime.context-builder.test.ts` |
| Agent setup + runtime turn success | `test/runtime.single-agent.test.ts` | `pnpm -s vitest run test/runtime.single-agent.test.ts` |
| Baseline runtime harness health | `test/smoke.test.ts` | `pnpm -s vitest run test/smoke.test.ts` |
| Runtime flow + triage docs | `docs/runtime-single-agent-pi.md` | `pnpm check:docs && pnpm docs:linkcheck` |

Run commands:

```bash
pnpm check
pnpm check:docs
pnpm -s vitest run test/runtime.single-agent.test.ts test/runtime.gateway.validation.test.ts test/runtime.context-builder.test.ts test/smoke.test.ts
```

If fail, check this first: run commands from repo root (`openboa/`) and ensure Node/pnpm deps are installed (`pnpm install --frozen-lockfile`).
