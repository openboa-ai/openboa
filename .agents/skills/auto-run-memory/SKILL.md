---
name: auto-run-memory
description: Shared memory contract for project harness runs. Use when a worker or orchestrator must recover the current PR state, latest assumptions, failed attempts, and latest winning evidence from repo artifacts alone.
---

# Auto Run Memory

The harness must be resumable from repo state only.

Read state in this order:

1. `docs/PRODUCT.md`
2. `docs/DESIGN.md`
3. `docs/QUALITY.md`
4. `wiki/frontiers.md`
5. active `wiki/prs/PR-*.md`
6. latest relevant `wiki/runs/RUN-*.md`
7. raw evidence when needed

Track at minimum:

- accepted assumptions
- latest baseline
- failed attempts
- latest winning run
- current quality gap
- open risks
- current owner

Never rely on chat history as the primary memory source.
