# AGENTS.md

This repository uses a PR-centric autonomous harness.

Read in this order before doing work:

1. `.agents/AGENTS.md`
2. `docs/harness.md`
3. `docs/PRODUCT.md`
4. `docs/DESIGN.md`
5. `docs/QUALITY.md`
6. `docs/development.md`
7. `wiki/frontiers.md`
8. the active `wiki/prs/PR-*.md`
9. the latest relevant `wiki/runs/RUN-*.md`

Core rules:

- `PR` is the unit of work
- `run` is the unit of iteration
- `wiki` is the unit of memory
- humans set direction, taste, and the final signoff bar
- only one worker writes at a time
- keep only measured improvements
- escalate immediately for safety-critical situations

PR follow-through rule:

- after opening or updating a PR, the active worker owns review and CI follow-through until the PR is merged or explicitly handed back to a human
- do not stop at push; keep checking PR comments, review threads, code scanning, and CI, fix actionable issues, push updates, and re-check the PR state
- merge once the PR is green and there is no remaining blocking feedback, unless the human explicitly asks to hold, keep the PR in draft, or reserve final signoff
