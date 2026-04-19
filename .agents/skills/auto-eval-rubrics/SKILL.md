---
name: auto-eval-rubrics
description: Shared scoring and stop rubric for project harness workers. Use when a worker needs a consistent way to judge PM clarity, code quality, QA outcomes, UI quality, or whether to keep, reroute, or discard a run.
---

# Auto Eval Rubrics

If evidence does not improve an explicit axis, do not keep the change.
If the relevant bar is not yet met, the PR is not done.

## PM rubric

- goal clarity
- metric clarity
- quality-target clarity
- boundary clarity
- acceptance clarity
- next-owner clarity

Pass threshold:

- the next worker can continue without inventing scope or the quality bar

## Coding rubric

- correctness
- runtime health
- CI health
- complexity delta
- boundary safety

Pass threshold:

- targeted checks are green
- the runtime gap is smaller than the baseline
- no new severe regression is introduced

## QA rubric

- scenario coverage
- regression exposure
- edge-case pressure
- severity clarity
- veto correctness

Pass threshold:

- the primary flow is trustworthy
- no open critical defect remains
- open risks are explicit and proportionate

## UI rubric

- hierarchy clarity
- spacing rhythm
- density
- list vs card discipline
- interaction affordance

Pass threshold:

- the surface reads clearly against `docs/DESIGN.md`
- the new state is clearly better than baseline on the targeted axis
- no major alignment, spacing, or hierarchy regression remains

## Escalation

Escalate or reroute when:

- evidence gets worse twice in a row
- the best next change is outside the current boundary
- safety risk appears
