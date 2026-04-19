# RUN-20260409-1905-agent-runtime-doc-flow-pass

- `PR`: `PR-scalable-agent-runtime`
- `Worker`: `auto-project`
- `Status`: `kept`

## Goal

Make the session-first Agent runtime understandable from the docs alone by adding one canonical runtime page and reconnecting the main docs flow around it.

## Changes

- Added [docs/agent-runtime.md](../../docs/agent-runtime.md) as the canonical explanation of:
  - `AgentDefinition`
  - `Environment`
  - `Session`
  - `SessionEvent`
  - `ResourceAttachment`
  - `wake(sessionId)`
  - `Harness`
  - `Sandbox`
  - `ToolDefinition`
- Updated [docs/index.md](../../docs/index.md) so `Agent Runtime` appears in the main start path.
- Updated [docs/docs.json](../../docs/docs.json) navigation to include the new page.
- Updated [docs/development.md](../../docs/development.md) so contributors touching `src/agents/` are sent to the canonical runtime page first.
- Updated [docs/quickstart.md](../../docs/quickstart.md) and [docs/architecture.md](../../docs/architecture.md) to link to the new runtime page as the primary detailed explanation.

## Verification

- `pnpm check:docs`
- `cd docs && pnpm dlx mintlify validate`
- `git diff --check -- docs wiki`

## Result

The docs now have a cleaner flow:

- `index` tells readers where to start
- `quickstart` tells them how to run the system
- `architecture` tells them where code and boundaries live
- `agent-runtime` tells them exactly how the current Agent layer works end to end

## Next gap

If the English docs remain stable, the next documentation gap is parity: the Korean docs do not yet reflect the new session-first Agent runtime surface.
