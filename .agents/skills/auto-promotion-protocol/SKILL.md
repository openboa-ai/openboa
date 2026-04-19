---
name: auto-promotion-protocol
description: Shared promotion contract for project harness PRs. Use when deciding whether a frontier can move from looping to final-signoff, ready-to-land, or should be rerouted or discarded.
---

# Auto Promotion Protocol

## Role

`auto-promotion-protocol` is the shared promotion contract.

## When to use

Use it when deciding whether a frontier can move from `looping` to `final-signoff`, `ready-to-land`, reroute, or discard.

## What it optimizes for

- honest promotion readiness
- explicit gatekeeping
- current evidence

## Required outputs

- a promotion decision
- the evidence supporting that decision
- the blocking gap if promotion is denied

## Stop condition

Stop when the PR is clearly kept in `looping`, promoted to `final-signoff`, promoted to `ready-to-land`, rerouted, or discarded.

## Handoff expectation

Return the promotion decision to `auto-project` and require `auto-wiki` writeback if state changed.

## Hard boundaries

- `final-signoff` requires: acceptance met, current quality gap recorded as closed, latest QA pass green, latest UI pass acceptable when UI is in scope, latest wiki writeback current, no open safety risk
- `ready-to-land` requires: explicit final-signoff readiness, final checklist complete, latest QA still green, latest UI still acceptable when UI is in scope, latest wiki writeback current, no open safety risk
- do not promote when the latest winning run is stale, the current owner is unclear, or regressions are open
