---
name: auto-garbage-collection
description: Drift control for the project harness. Use when stale runs, duplicate syntheses, dead PR pages, or outdated docs accumulate and the harness needs cleanup to stay readable and resumable.
---

# Auto Garbage Collection

## Role

`auto-garbage-collection` is the shared drift-control protocol.

## When to use

Use it when stale PR pages, duplicate syntheses, dead run records, or outdated docs make the harness hard to read or resume.

## What it optimizes for

- readability
- resumability
- low drift

## Required outputs

- explicit cleanup decisions
- removed or consolidated stale artifacts
- `auto-wiki` writeback for the final kept truth

## Stop condition

Stop when the remaining memory surface is current, non-duplicated, and readable.

## Handoff expectation

Return the cleanup result to `auto-project` or `auto-wiki`.

## Hard boundaries

- prefer deleting dead scaffolding over preserving clutter
- keep only the latest durable explanation
- clean stale PR pages, duplicate syntheses, dead run records, stale docs, and duplicated patterns that drift from current conventions
- write back every cleanup decision through `auto-wiki`
