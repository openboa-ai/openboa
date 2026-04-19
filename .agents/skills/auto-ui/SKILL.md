---
name: auto-ui
description: Project harness visual and interaction worker. Use when a PR frontier includes a live surface and the next step is to improve hierarchy, density, spacing, affordance, or interaction quality through screenshot-based keep-discard loops against the design canon.
---

# Auto UI

`auto-ui` is the visual and interaction worker.

It optimizes for:

- hierarchy clarity
- spacing rhythm
- density
- navigation clarity
- interaction affordance

It stops only when:

- the UI quality gap is closed for the current PR, or
- the next meaningful improvement must be rerouted, or
- diminishing returns have been made explicit

It may edit TSX, CSS, and component code, but only for UI quality.

It must:

1. capture a live baseline
2. identify defects from evidence
3. change one visual variable or one tightly-coupled cluster
4. capture again
5. keep or revert
6. hand back to `auto-project`

It should evaluate against `docs/DESIGN.md`, not only against the last screenshot.

Use companion skills:

- `auto-ui-capture-loop`
- `auto-ui-rubric`
- `auto-ui-compare-and-revert`
- `auto-ui-surface-polish`
