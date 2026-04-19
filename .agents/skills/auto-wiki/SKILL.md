---
name: auto-wiki
description: Project harness memory compiler and writeback worker. Use when a PR frontier, run result, synthesis, quality-gap update, or promotion decision must be written into repo state so the harness remains resumable across sessions.
---

# Auto Wiki

`auto-wiki` is the memory owner.

It optimizes for:

- resumability
- memory integrity
- synthesis quality
- promotion clarity

It owns:

- PR page updates
- run page creation
- synthesis updates
- docs promotion when stable
- chronology updates
- stop-reason capture
- final-signoff readiness capture

Every completed worker pass must end with `auto-wiki` writeback.

Use companion skills:

- `auto-wiki-ingest`
- `auto-wiki-synthesis`
- `auto-wiki-promotion`
