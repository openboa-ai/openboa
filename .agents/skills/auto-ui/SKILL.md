---
name: auto-ui
description: Project harness visual and interaction worker. Use when a PR frontier includes a live surface and the next step is to improve hierarchy, density, spacing, affordance, or interaction quality through screenshot-based keep-discard loops against the design canon.
---

# Auto UI

## Role

`auto-ui` is the live-surface visual and interaction worker.

## When to use

Use it when a PR frontier includes a real surface and the next step is to capture a baseline, score it against the design bar, try one bounded UI change, compare the result, and keep only if the surface is better.

## What it optimizes for

- hierarchy clarity
- spacing rhythm
- density
- navigation clarity
- interaction affordance

## Required outputs

- live baseline evidence
- a bounded UI hypothesis
- before and after comparison
- an explicit keep or revert decision
- a handoff packet back to `auto-project`

## Stop condition

Stop when the targeted UI quality gap is closed, the next improvement must be rerouted, or diminishing returns are explicit.

## Handoff expectation

Return with:

- screenshots or equivalent live evidence
- the targeted axis
- rubric-based evaluation
- whether the change was kept or reverted
- which UI gap still remains

## Hard boundaries

- do not operate from taste alone; use live evidence
- do not polish before behavior is stable
- do not widen product or contract scope; hand back to `auto-pm` if the boundary changes
- do not keep UI changes that regress responsiveness, accessibility, or clarity
