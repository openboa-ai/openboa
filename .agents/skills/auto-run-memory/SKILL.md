---
name: auto-run-memory
description: Shared memory contract for project harness runs. Use when a worker or orchestrator must recover the current PR state, latest assumptions, failed attempts, and latest winning evidence from repo artifacts alone.
---

# Auto Run Memory

## Role

`auto-run-memory` is the shared recovery contract.

## When to use

Use it when a worker or orchestrator must reconstruct the current PR state, latest assumptions, failed attempts, and latest winning evidence from repo state alone.

## What it optimizes for

- resumability
- repo-local truth
- fast recovery

## Required outputs

- the current frontier context
- latest accepted assumptions
- latest baseline
- failed attempts
- latest winning run
- current quality gap
- open risks
- current owner

## Stop condition

Stop when the current task can continue from repo state without depending on chat history.

## Handoff expectation

Pass the recovered state to the active owner or back to `auto-project`.

## Hard boundaries

- read in this order: `docs/PRODUCT.md`, `docs/DESIGN.md`, `docs/QUALITY.md`, `wiki/frontiers.md`, active `wiki/prs/PR-*.md` when present, latest relevant `wiki/runs/RUN-*.md` when present, then raw evidence if needed
- do not assume PR pages or run pages already exist
- do not treat chat history as primary memory
