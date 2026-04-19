# AGENTS.md

## Operating Thesis

This repository uses a generic project harness.

The harness is PR-centric, evidence-driven, and resumable.

Core rules:

- `PR` is the unit of work
- `run` is the unit of iteration
- `wiki` is the unit of memory
- humans define product direction, quality bar, and final signoff
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
10. the active `wiki/prs/PR-*.md`
11. the latest relevant `wiki/runs/RUN-*.md`
12. project-specific architecture or product docs as needed

## Knowledge Layers

| Layer | Purpose | Default use |
| --- | --- | --- |
| `raw/` | immutable sources and evidence | provenance, screenshots, logs, imported artifacts |
| `wiki/` | working memory | active PR pages, run pages, synthesis, chronology |
| `.agents/` | operating schema | skills, templates, handoff rules, worker behavior |
| `docs/` | stable canon and explanation | product direction, design bar, quality bar, contributor docs |

Rules:

- `raw/` is append-oriented and evidence-first
- `wiki/` is the live internal memory
- `.agents/` is the canonical behavior source
- `docs/` is for stable human-facing canon and explanation, not active run state

## System Topology

### Orchestrator

- `auto-project`
  - owns PR lifecycle
  - decides next worker
  - enforces ownership lock
  - enforces keep/discard
  - transitions PRs into `final-signoff`, `ready-to-land`, or `discarded`

### Workers

- `auto-pm`
  - defines PR frontier, metric, quality target, boundary, acceptance
- `auto-coding`
  - improves correctness, runtime behavior, reliability, architecture, and CI until the runtime gap is closed
- `auto-qa`
  - probes scenarios, finds regressions, and vetoes promotion with severity and confidence when needed
- `auto-ui`
  - improves hierarchy, spacing, density, affordance, and interaction quality until the design bar is met
- `auto-wiki`
  - records runs, updates PR pages, compiles synthesis, keeps memory resumable, and records why the loop stopped

### Shared protocols

- `auto-loop-protocol`
- `auto-handoff-protocol`
- `auto-eval-rubrics`
- `auto-run-memory`
- `auto-promotion-protocol`
- `auto-garbage-collection`

## Default Loop

```text
resume or open one PR
  -> lock goal, metric, quality target, boundary, acceptance
  -> record baseline
  -> one bounded change
  -> evaluate against the relevant quality axis
  -> keep or discard
  -> write back memory
  -> continue, reroute, request final signoff, land, or discard
```

`auto-project` is the only loop scheduler.
Workers never self-schedule indefinitely.

## Ownership Rules

- only one worker may be the active writer at a time
- every worker pass must end with a handoff or completion signal
- every state transition must be written back by `auto-wiki`
- every kept change must have explicit evidence

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
- active frontier state -> `wiki/frontiers.md`
- PR working memory -> `wiki/prs/`
- run-by-run evidence summary -> `wiki/runs/`
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
- use `auto-garbage-collection` to fight drift, duplication, and stale docs
