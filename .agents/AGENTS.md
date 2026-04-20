# AGENTS.md

## Operating Thesis

This repository uses a generic project harness.

The harness is PR-centric, evidence-driven, resumable, and intentionally small.

Core rules:

- `PR` is the unit of work
- `run` is the unit of iteration
- `wiki` is the unit of memory
- humans define product direction, taste, and final signoff
- one worker writes at a time
- keep only measured improvements
- escalate immediately for safety-critical situations

## Read Order

Before planning, editing, or reviewing:

1. `AGENTS.md`
2. `.agents/AGENTS.md`
3. nearest `AGENTS.md`
4. `docs/harness.md`
5. `docs/PRODUCT.md`
6. `docs/DESIGN.md`
7. `docs/QUALITY.md`
8. `docs/development.md`
9. `wiki/frontiers.md`
10. the active `wiki/prs/PR-*.md` when a frontier is already open
11. the latest relevant `wiki/runs/RUN-*.md` when prior runs exist
12. project-specific architecture or product docs as needed

## Knowledge Layers

| Layer | Purpose | Default use |
| --- | --- | --- |
| `raw/` | immutable evidence | provenance, screenshots, logs, imported artifacts |
| `wiki/` | internal working memory | frontier map, PR pages, run pages, synthesis |
| `.agents/` | behavior and routing | skills, templates, handoff rules, worker behavior |
| `docs/` | stable canon | product direction, design bar, quality bar, contributor docs |

Rules:

- `raw/` owns immutable evidence
- `wiki/` owns internal working memory
- `.agents/` owns behavior and routing only
- `docs/` owns stable canon and explanation

## Active Harness Surface

### Root constitution

- `.agents/AGENTS.md`

### Core workers

- `auto-project`
- `auto-pm`
- `auto-coding`
- `auto-qa`
- `auto-ui`
- `auto-wiki`

### Shared protocols

- `auto-loop-protocol`
- `auto-handoff-protocol`
- `auto-run-memory`
- `auto-promotion-protocol`
- `auto-eval-rubrics`
- `auto-garbage-collection`

### Optional utilities

- `brain-openboa`
- `forge`
- `ci-recovery`
- `harness-skill-audit`

Specialist loops are not separate skills anymore.
Their useful behavior lives inside the relevant core worker body.

## Routing Contract

`auto-project` is the only scheduler.

Every task should route to exactly one of these buckets:

1. a core worker
2. a shared protocol
3. an optional utility

Default routing:

- full-loop or ambiguous work -> `auto-project`
- frontier definition -> `auto-pm`
- implementation, runtime, reliability, CI -> `auto-coding`
- functional evaluation and veto -> `auto-qa`
- live-surface visual and interaction work -> `auto-ui`
- memory writeback and synthesis -> `auto-wiki`
- common keep/discard, handoff, recovery, promotion, rubric, or cleanup rules -> shared protocols
- repo-specific framing or forge utilities -> optional utilities

## Default Loop

```text
resume or open one PR
  -> define one bounded frontier
  -> record baseline
  -> make one bounded change
  -> measure against the active quality axis
  -> keep or discard
  -> write back memory
  -> continue, reroute, request final signoff, land, or discard
```

Workers do not self-schedule indefinitely.
Ownership returns to `auto-project` after every run.

## Ownership Rules

- only one worker may be the active writer at a time
- every worker pass must end with a handoff or completion signal
- every state transition must be written back by `auto-wiki`
- every kept change must have explicit evidence
- after a PR is opened or updated, the active worker retains ownership through review and CI follow-through until merge or explicit human handoff
- push is not the end of the loop; the worker must keep checking comments, review threads, code scanning, and CI, address actionable feedback, and push again until the PR is green
- merge once the PR is green and blocking feedback is resolved, unless a human explicitly asks to hold, keep draft, or reserve final signoff

Required handoff packet:

- `Goal`
- `Current truth`
- `Owned boundary`
- `Attempt log`
- `Evidence`
- `Remaining quality gap`
- `Why this is not done yet`
- `Open risks`
- `Recommended next owner`

## Keep / Discard Discipline

Never accumulate speculative changes.

Each run must:

1. establish a baseline
2. change one bounded variable
3. measure the result against the target quality axis
4. keep only if better
5. revert or discard if not better
6. continue until the relevant bar is met, cleanly rerouted, or proven to have diminishing returns

Discard threshold:

- 3 non-improving runs in a row by the same worker on the same axis

At that point:

- reroute to a different worker, or
- discard the PR

## Light Wiki Memory

`wiki/` is light internal memory, not an always-populated archive.

Use these surfaces when the work actually needs them:

- `wiki/frontiers.md` for the current frontier map
- `wiki/prs/` for active PR working memory
- `wiki/runs/` for run-by-run evidence summaries
- `wiki/syntheses/` for reusable internal synthesis

Do not assume a PR page or run page already exists.
Create or update only the minimum state needed to keep the harness resumable.

## Human Role

Humans are responsible for:

- setting product direction
- setting taste and quality expectations
- giving final signoff before landing

Immediate human escalation exists for:

- destructive git or history operations
- secrets, privacy, security, or billing risk
- irreversible publication or release

## Placement Rules

- new evidence -> `raw/evidence/`
- imported materials -> `raw/sources/`
- stable direction and non-goals -> `docs/PRODUCT.md`
- stable design and interaction bar -> `docs/DESIGN.md`
- stable quality and acceptance bar -> `docs/QUALITY.md`
- current frontier map -> `wiki/frontiers.md`
- PR working memory when needed -> `wiki/prs/`
- run evidence summary when needed -> `wiki/runs/`
- evolving internal synthesis -> `wiki/syntheses/`
- reusable behavior rules -> `.agents/skills/`
- stable contributor docs -> `docs/`

## Maintenance Rules

- do not document external product or UI references in maintained project docs
- do not treat chat history as memory
- do not create a new PR frontier when the current one can be continued safely
- do not move a PR to `ready-to-land` without explicit final signoff readiness
- do not land without latest QA approval
- do not land UI-scope work without latest UI pass
- keep generic worker guidance in `.agents/AGENTS.md` or the concrete skill body
- use `auto-garbage-collection` to fight drift, duplication, and stale docs
