---
name: auto-handoff-protocol
description: Shared ownership and handoff contract for the project harness. Use when work moves from one worker to another or when a worker finishes a run and must return control to the orchestrator.
---

# Auto Handoff Protocol

## Role

`auto-handoff-protocol` is the shared ownership and handoff contract.

## When to use

Use it whenever work moves from one worker to another or a worker finishes a run and must return control to the orchestrator.

## What it optimizes for

- ownership clarity
- resumability
- clean worker transitions

## Required outputs

- `Goal`
- `Current truth`
- `Owned boundary`
- `Attempt log`
- `Evidence`
- `Remaining quality gap`
- `Why this is not done yet`
- `Open risks`
- `Recommended next owner`

## Stop condition

Stop when the next owner can continue without guessing the latest truth.

## Handoff expectation

Ownership returns to `auto-project` after every run unless the next owner is explicitly named.

## Hard boundaries

- one writer at a time
- no worker may continue indefinitely without orchestration
- if the next owner is unclear, route to `auto-project`
