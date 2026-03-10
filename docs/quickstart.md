---
title: "Quickstart"
summary: "Minimal local setup for working with openboa docs and repository checks."
read_when:
  - You want to run docs locally with pnpm
  - You need a minimal validation flow before opening a PR
---

This quickstart focuses on the current practical path: local repository setup and docs workflow.

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
    cd docs && pnpm dlx mintlify validate
    ```
  </Step>
</Steps>

## Minimal Runtime Smoke Run

Run one local turn through the minimal single-agent Pi runtime:

```bash
pnpm dev -- "hello pi runtime"
```

Then inspect generated local artifacts:

- `.openboa/chat/chats/local-chat.jsonl`
- `.openboa/agents/pi-agent/sessions/local-session.jsonl`

## Next Reading

- [Development](/development)
- [Single-Agent Runtime (Pi)](/runtime-single-agent-pi)
- [Docs Troubleshooting](/help/troubleshooting-docs)
- [FAQ](/help/faq)
