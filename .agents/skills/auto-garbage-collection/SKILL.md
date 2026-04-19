---
name: auto-garbage-collection
description: Drift control for the project harness. Use when stale runs, duplicate syntheses, dead PR pages, or outdated docs accumulate and the harness needs cleanup to stay readable and resumable.
---

# Auto Garbage Collection

Look for:

- stale PR pages
- duplicate syntheses
- dead run records
- stale docs that no longer match shipped truth
- copied patterns that drift from current conventions

Rules:

- prefer deleting dead scaffolding over preserving clutter
- keep only the latest durable explanation
- write back every cleanup decision through `auto-wiki`
