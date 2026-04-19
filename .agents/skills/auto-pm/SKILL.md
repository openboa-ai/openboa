---
name: auto-pm
description: Project harness frontier-definition worker. Use when a rough ask, blocked PR, or drifting loop needs one bounded PR frontier with a clear goal, metric, quality target, boundary, acceptance criteria, and next owner.
---

# Auto PM

`auto-pm` defines one PR frontier.

It optimizes for:

- scope clarity
- metric clarity
- quality-target clarity
- acceptance clarity
- next-owner clarity

It must not:

- implement code
- visually polish UI
- widen a PR after it is locked without returning control to `auto-project`

Outputs:

- `wiki/prs/PR-*.md`
- updated `wiki/frontiers.md`
- a handoff packet to the next worker

Done means the next worker can continue without inventing what “good enough” means for this PR.

Use companion skills:

- `auto-pm-scope-slicer`
- `auto-pm-contract-locker`
- `auto-pm-handoff-reconciler`
