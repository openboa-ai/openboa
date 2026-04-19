# AGENTS.md

## Purpose

`.agents/skills/` contains the generic project harness skill surface.

This directory is the canonical behavior layer for the harness.

## Core registry

### Orchestrator

- `auto-project`
  - PR lifecycle owner, loop scheduler, and final-signoff gatekeeper

### Lead workers

- `auto-pm`
  - frontier definition, scope lock, metric lock, quality-target lock, acceptance lock
- `auto-coding`
  - correctness, runtime behavior, reliability, architecture, CI, and runtime-gap closure
- `auto-qa`
  - functional evaluation, regression discovery, edge-case probing, and promotion veto
- `auto-ui`
  - hierarchy, density, spacing, interaction, visual clarity, and design-gap closure
- `auto-wiki`
  - writeback, synthesis, promotion, memory integrity, and stop-reason capture

### Shared foundations

- `auto-loop-protocol`
- `auto-handoff-protocol`
- `auto-eval-rubrics`
- `auto-run-memory`
- `auto-promotion-protocol`
- `auto-garbage-collection`

### Specialists

- `auto-pm-scope-slicer`
- `auto-pm-contract-locker`
- `auto-pm-handoff-reconciler`
- `auto-coding-implement-loop`
- `auto-coding-test-loop`
- `auto-coding-recovery-loop`
- `auto-coding-ci-loop`
- `auto-coding-interface-guard`
- `auto-qa-scenario-probe`
- `auto-qa-regression-veto`
- `auto-ui-capture-loop`
- `auto-ui-rubric`
- `auto-ui-compare-and-revert`
- `auto-ui-surface-polish`
- `auto-wiki-ingest`
- `auto-wiki-synthesis`
- `auto-wiki-promotion`

## Routing rules

Use this order:

1. `auto-project` for any full-loop autonomous PR work
2. the relevant lead worker when a single stage is explicitly requested
3. foundation or specialist skills only as companions to a lead worker
4. non-harness project-specific skills only when the task is outside the generic harness

## Boundary summary

### `auto-pm` vs `auto-coding`

- `auto-pm` chooses the frontier and locks the PR page
- `auto-coding` changes code to improve correctness or runtime behavior until the runtime bar is met

### `auto-coding` vs `auto-ui`

- both may edit code
- `auto-coding` optimizes for correctness and behavior
- `auto-ui` optimizes for visual and interaction quality
- if the target metric is unclear, route through `auto-project` or `auto-pm`

### `auto-qa` vs `auto-ui`

- `auto-qa` asks whether it works correctly
- `auto-ui` asks whether it reads and feels correct
- both can block promotion when their bar is not met

### `auto-wiki`

- every completed worker pass must end with `auto-wiki` writeback
- no state transition is complete until the wiki is current
- final-signoff readiness must also be written back

## Optional utility skills

These are allowed to coexist with the harness when a task is outside the generic loop:

- `brain-openboa`
- `forge`
- `ci-recovery`
- `harness-skill-audit`
