# RUN-20260409-1920-docs-agent-chat-work-ia-pass

- `PR`: `PR-scalable-agent-runtime`
- `Worker`: `auto-project`
- `Status`: `kept`

## Goal

Reorganize the docs information architecture so readers can navigate the product and runtime through larger top-level categories: `Agent`, `Chat`, and `Work`, while expanding Agent documentation into a deeper set of detailed pages.

## Changes

- Reworked docs navigation in [docs/docs.json](../../docs/docs.json) to add top-level tabs:
  - `Agent`
  - `Chat`
  - `Work`
- Added detailed Agent docs under `docs/agents/`:
  - [sessions.md](../../docs/agents/sessions.md)
  - [environments.md](../../docs/agents/environments.md)
  - [resources.md](../../docs/agents/resources.md)
  - [harness.md](../../docs/agents/harness.md)
  - [sandbox.md](../../docs/agents/sandbox.md)
  - [tools.md](../../docs/agents/tools.md)
- Added:
  - [docs/chat-kernel.md](../../docs/chat-kernel.md)
  - [docs/work.md](../../docs/work.md)
- Updated the main docs flow in:
  - [docs/index.md](../../docs/index.md)
  - [docs/introduction.md](../../docs/introduction.md)
  - [docs/chat.md](../../docs/chat.md)
  - [docs/README.md](../../docs/README.md)

## Verification

- `pnpm check:docs`
- `cd docs && pnpm dlx mintlify validate`
- `git diff --check -- docs`

## Result

The docs no longer read as a flat “start/help/foundation only” set.
They now expose the actual product/runtime shape directly through top-level `Agent`, `Chat`, and `Work` categories, with the Agent area deep enough to explain the current session-first runtime in detail.
