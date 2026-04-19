---
name: auto-wiki
description: Project harness memory compiler and writeback worker. Use when a PR frontier, run result, synthesis, quality-gap update, or promotion decision must be written into repo state so the harness remains resumable across sessions.
---

# Auto Wiki

## Role

`auto-wiki` is the memory compiler and writeback owner.

## When to use

Use it when a PR frontier, run result, evidence update, synthesis, promotion decision, or stop reason must be written into repo state so the harness remains resumable.

## What it optimizes for

- resumability
- memory integrity
- synthesis quality
- promotion clarity

## Required outputs

- current `wiki/frontiers.md` state
- updated `wiki/prs/` or `wiki/runs/` records when needed
- synthesis updates when repeated runs have produced reusable truth
- docs promotion when internal knowledge has become stable canon

## Stop condition

Stop when the current run or frontier state is legible from repo memory alone and the next worker can resume without chat history.

## Handoff expectation

Return control to `auto-project` after writeback.
No state transition is complete until memory is current.

## Hard boundaries

- do not leave active work only in chat history
- do not overpopulate `wiki/`; write the minimum durable truth needed
- do not promote unstable internal knowledge into `docs/`
- do not skip writeback after a completed worker pass
