---
name: auto-handoff-protocol
description: Shared ownership and handoff contract for the project harness. Use when work moves from one worker to another or when a worker finishes a run and must return control to the orchestrator.
---

# Auto Handoff Protocol

One writer at a time.

Every worker handoff must include:

- `Goal`
- `Current truth`
- `Owned boundary`
- `Attempt log`
- `Evidence`
- `Remaining quality gap`
- `Why this is not done yet`
- `Open risks`
- `Recommended next owner`

Rules:

- ownership returns to `auto-project` after every run
- no worker may continue indefinitely without orchestration
- if the next owner is unclear, route to `auto-project`
