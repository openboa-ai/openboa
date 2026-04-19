---
name: auto-wiki-ingest
description: Source and evidence ingest specialist for the project harness. Use inside `auto-wiki` when new artifacts must be placed into `raw/` and linked into the correct PR or run records.
---

# Auto Wiki Ingest

Route artifacts by purpose:

- immutable sources -> `raw/sources/`
- screenshots, logs, and CI outputs -> `raw/evidence/`
- run interpretation -> `wiki/runs/`
