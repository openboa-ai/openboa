---
title: "Quickstart"
summary: "Minimal local setup for docs workflow, the CLI-first contributor runtime, and the current shell build paths."
read_when:
  - You want to run docs locally with pnpm
  - You need a minimal validation flow before opening a PR
  - You want a truthful quickstart for the current runtime surface
---

This quickstart focuses on the current practical path: local repository setup, docs workflow, the current CLI-first runtime, and the shell build entrypoints that now exist in the repo.

<Warning>
The project is still early-stage. Treat this as a contributor quickstart, not a production runtime deployment guide.
</Warning>

## Prerequisites

- Node.js `>=22.12.0`
- pnpm `10.x`

## Start In 3 Steps

<Steps>
  <Step title="Install dependencies">
    ```bash
    pnpm install
    ```
  </Step>
  <Step title="Run docs locally">
    ```bash
    pnpm docs:local
    ```
    Open the local preview URL shown in the terminal.
  </Step>
  <Step title="Validate before PR">
    ```bash
    pnpm check:docs
    pnpm docs:linkcheck
    pnpm docs:validate
    ```
  </Step>
</Steps>

## Current Runtime Reality

The current runtime surface is still **CLI-first** for day-to-day contributor work.

The repo now also contains:

- a browser host build under `src/shell/web/`
- a first desktop packaging path under `src/shell/desktop/`

Current harness state is tracked in:

- `wiki/frontiers.md`
- `wiki/prs/`
- `wiki/runs/`

## Minimal CLI Surface Check

Use only the current CLI entrypoints that exist in `src/index.ts`.

```bash
pnpm openboa help
pnpm openboa auth status
```

## Shell Build Checks

You can also validate the product shell paths that now exist:

```bash
pnpm build:web
pnpm build:desktop
```

`pnpm build:desktop` is currently the first-target desktop path and is intended for macOS packaging.
On non-macOS contributors machines, use the CI artifact from the packaging PR instead of expecting a local desktop bundle.

The shared chat ledger still lives at:

- `.openboa/runtime/company-ledger.jsonl`

Agent-private state now lives under:

- `.openboa/agents/<agent-id>/workspace/`
- `.openboa/agents/<agent-id>/sessions/`
- `.openboa/agents/<agent-id>/learn/`

Each agent workspace is now seeded with bootstrap files aligned with the OpenClaw reference shape:

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`
- `MEMORY.md`

## Provider-backed Agent Runs

The session-first Agent runtime uses a provider/runtime split:

- `openai-codex` -> Codex-backed runtime path
- `claude-cli` -> local Claude CLI-backed runtime path

Recommended setup flow:

```bash
pnpm openboa setup --default-provider openai-codex --auth codex
# or
pnpm openboa setup --default-provider claude-cli --auth claude-cli
```

You can also authenticate both up front:

```bash
pnpm openboa setup --default-provider openai-codex --auth both
```

Create both kinds of agents explicitly:

```bash
pnpm openboa agent spawn --name codex-agent --provider openai-codex
pnpm openboa agent spawn --name claude-agent --provider claude-cli
pnpm openboa agent list
```

## Session-First Runtime Check

Create a reusable session for an agent:

```bash
pnpm openboa agent session create --name codex-agent
pnpm openboa agent session create --name claude-agent
```

Each session is a durable runtime object with:

- a UUID v7 `sessionId`
- an attached `environment`
- attached `resources`
- append-only `events`
- isolated runtime memory under its own `runtime/` directory

Send a user message into a session:

```bash
pnpm openboa agent session send \
  --session <uuid-v7> \
  --message "Summarize the current chat contract."
```

For one manual debug run, wake that session once:

```bash
pnpm openboa agent wake --session <uuid-v7>
```

For normal proactive operation, run the worker loop and let it consume new events plus queued revisits:

```bash
pnpm openboa agent orchestrator --agent codex-agent --watch --poll-interval-ms 1000 --idle-timeout-ms 30000
```

Inspect the current session state:

```bash
pnpm openboa agent session status --session <uuid-v7>
pnpm openboa agent session events --session <uuid-v7> --limit 10
```

Run the bounded one-shot orchestrator loop for every session owned by an agent:

```bash
pnpm openboa agent orchestrator --agent codex-agent --stop-when-idle --max-cycles 12
```

The public runtime contract is now:

- `Session`
- `Environment`
- `ResourceAttachment`
- `SessionEvent`
- `wake(sessionId)`
- `Harness`
- `Sandbox`
- `ToolDefinition`

Internally, orchestration may still queue revisits, but the public surface is session-first rather than activation-first.

The runtime will now maintain these session-local artifacts:

- `.openboa/agents/<agent-id>/sessions/<session-id>/session.json`
- `.openboa/agents/<agent-id>/sessions/<session-id>/events.jsonl`
- `.openboa/agents/<agent-id>/sessions/<session-id>/runtime/checkpoint.json`
- `.openboa/agents/<agent-id>/sessions/<session-id>/runtime/session-state.md`
- `.openboa/agents/<agent-id>/sessions/<session-id>/runtime/working-buffer.md`

Agent-level learnings remain shared across sessions:

- `.openboa/agents/<agent-id>/learn/lessons.jsonl`
- `.openboa/agents/<agent-id>/learn/corrections.jsonl`
- `.openboa/agents/<agent-id>/learn/errors.jsonl`

Every new session automatically attaches default local resources:

- the writable session execution workspace mounted at `/workspace`
- the shared agent substrate mounted at `/workspace/agent`
- the shared read-only agent learnings store
- the session runtime directory
- any discovered vault mounts under `/vaults/<name>`

The writable session hand and shared substrate are intentionally separate:

- inspect reusable substrate in `/workspace/agent`
- stage durable substrate files into `/workspace` through `resources_stage_from_substrate`
- compare staged session files against the shared substrate through `resources_compare_with_substrate`
- create and revise work in `/workspace`
- promote selected session files back into the shared substrate through `resources_promote_to_substrate`

The harness also loads the seeded workspace markdown into the runtime system prompt, so these files are now part of the actual agent substrate rather than dead scaffolding.

If the agent emits reusable learnings in its loop contract, openboa now captures them under
`learn/` and promotes the marked ones into the managed runtime section of
`.openboa/agents/<agent-id>/workspace/MEMORY.md`.

If you want a chat-mediated DM with shared sender identity and company-ledger routing, use the chat surface instead:

```bash
pnpm openboa chat --agent codex-agent --sender-id founder --message "Summarize the current chat contract."
```

For Claude-backed agents, make sure the `claude` CLI already works in your shell.

You can re-run auth later without re-running setup:

```bash
pnpm openboa auth login
pnpm openboa auth login --provider codex
pnpm openboa auth login --provider claude-cli
pnpm openboa auth login --provider both
pnpm openboa auth status
```

`openboa auth login` uses the company default provider chosen during `setup`, so the default path stays the same across setup, auth, and spawn. The auth command accepts `codex` as the primary OpenAI target and also accepts `openai-codex` as an alias.

## Next Reading

- [Agent Runtime](./agent-runtime.md)
- [Chat](./chat.md)
- [Development](./development.md)
- [Docs Troubleshooting](./help/troubleshooting-docs.md)
- [FAQ](./help/faq.md)
