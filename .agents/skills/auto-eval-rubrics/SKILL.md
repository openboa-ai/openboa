---
name: auto-eval-rubrics
description: Shared scoring and stop rubric for project harness workers. Use when a worker needs a consistent way to judge PM clarity, code quality, QA outcomes, UI quality, or whether to keep, reroute, or discard a run.
---

# Auto Eval Rubrics

## Role

`auto-eval-rubrics` is the shared scoring and stop language.

## When to use

Use it when a worker needs a consistent way to judge PM clarity, code quality, QA outcomes, UI quality, or whether to keep, reroute, or discard a run.

## What it optimizes for

- explicit scoring
- stable stop language
- honest reroute decisions

## Required outputs

- the active rubric axis
- pass or fail against that axis
- the remaining quality gap when the bar is not met

## Stop condition

Stop when the worker can say whether the current axis passed, failed, or should be rerouted.

## Handoff expectation

Return the rubric judgment to the active worker or `auto-project`.

## Hard boundaries

- if evidence does not improve an explicit axis, do not keep the change
- PM rubric: goal, metric, quality-target, boundary, acceptance, next-owner clarity
- Coding rubric: correctness, runtime health, CI health, complexity delta, boundary safety
- QA rubric: scenario coverage, regression exposure, edge-case pressure, severity clarity, veto correctness
- UI rubric: hierarchy clarity, spacing rhythm, density, list vs card discipline, interaction affordance
- reroute or escalate when evidence gets worse twice in a row, the best next change is outside the current boundary, or a safety risk appears
