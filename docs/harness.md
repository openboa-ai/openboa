---
title: "Project Harness"
summary: "PR-centric autonomous workflow where humans set direction and taste while workers close the quality gap."
---
# Project Harness


This repository uses a generic autonomous project harness.

The harness is project-agnostic. It is designed to work for any codebase that can adopt the
same repository structure, worker roles, and evidence discipline.

## Core model

- `PR` is the unit of work.
- `run` is the unit of iteration inside a PR.
- `wiki` is the unit of memory.
- humans define product direction, taste, and the final signoff bar.

Every PR is a bounded frontier.
Every run tries one bounded hypothesis.
Every kept change must improve an explicit metric.
Workers continue until the relevant quality bar is met, the work is cleanly rerouted, or the PR is discarded.

## Canon inputs

Every harnessed repository needs three stable canon docs.

- [Product Canon](./PRODUCT.md)
  - user value, target users, product direction, and non-goals
- [Design Canon](./DESIGN.md)
  - taste, interaction principles, and UI quality expectations
- [Quality Canon](./QUALITY.md)
  - testing posture, severity language, and the bar for final signoff

Workers should read those docs before interpreting an active PR page.

## Worker model

The harness has one orchestrator and five workers.

- `auto-project`
  - PR lifecycle owner, loop scheduler, and final-signoff gatekeeper
- `auto-pm`
  - locks goal, metric, quality target, boundary, and acceptance
- `auto-coding`
  - improves correctness, runtime behavior, architecture, reliability, and CI until the runtime gap is closed
- `auto-qa`
  - probes scenarios, finds regressions, and can veto promotion with explicit severity and confidence
- `auto-ui`
  - improves hierarchy, density, spacing, affordance, and visual clarity against the design canon
- `auto-wiki`
  - writes back memory, compiles synthesis, keeps the knowledge system resumable, and records why the loop stopped

## PR lifecycle

- `proposed`
- `open`
- `looping`
- `final-signoff`
- `ready-to-land`
- `discarded`
- `landed`

`final-signoff` is the point where the workers believe the bar is met and a human should confirm taste and direction before landing.

## Filesystem contract

- `raw/`
  - immutable sources and evidence
- `wiki/`
  - PR pages, run pages, frontier map, and chronology
- `.agents/`
  - operating schema, skill behavior, and templates
- `docs/`
  - stable product, design, quality, and contributor documentation

## Keep/discard discipline

The harness never accumulates speculative changes.

Each run must:

1. establish a baseline
2. make one bounded change
3. measure the result against the relevant quality axis
4. keep the change only if it is better
5. revert or discard if it is not better
6. continue until the relevant bar is closed or explicitly rerouted

## Human role

Humans do not micromanage normal progress.
Humans do set:

- product direction
- taste and interaction standards
- the bar for final signoff

Immediate escalation exists for:

- destructive git or history operations
- secrets, privacy, security, or billing risk
- irreversible publication or release

## Required records

Each active PR has a page in `wiki/prs/`.
Each iteration has a page in `wiki/runs/`.

Those pages are the durable working memory that lets the harness resume after interruptions.
The stable canon docs in `docs/` explain what “good enough” means before a PR moves into `final-signoff`.
