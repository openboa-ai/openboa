---
name: auto-loop-protocol
description: Shared keep-discard loop for project harness work. Use when a worker must establish a baseline, try one bounded change, measure it, and decide whether to keep or discard the result.
---

# Auto Loop Protocol

## Role

`auto-loop-protocol` is the shared keep/discard contract.

## When to use

Use it whenever a worker must establish a baseline, try one bounded change, measure it, and decide whether to keep or discard the result.

## What it optimizes for

- bounded experimentation
- evidence quality
- honest keep/discard decisions

## Required outputs

- baseline
- one bounded hypothesis
- measurement evidence
- keep or discard decision

## Stop condition

Stop when the targeted quality axis is improved enough, the work should be rerouted, or diminishing returns are explicit.

## Handoff expectation

Return control to `auto-project` with the result of one bounded attempt.

## Hard boundaries

- do not accumulate speculative changes
- do not claim improvement without evidence
- do not self-schedule indefinitely
- do not widen scope during a run
