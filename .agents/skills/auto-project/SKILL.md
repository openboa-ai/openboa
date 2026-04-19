---
name: auto-project
description: Project harness orchestrator. Use when a PR must be opened or resumed, workers must be scheduled, ownership must be enforced, keep-discard decisions must be honored, and the loop should continue autonomously until final-signoff, ready-to-land, discarded, or safety-blocked.
---

# Auto Project

## Role

`auto-project` is the only scheduler in the harness.

## When to use

Use it when a PR must be opened or resumed, the next owner is unclear, or the loop should continue autonomously until reroute, final-signoff, ready-to-land, or discard.

## What it optimizes for

- clear ownership
- bounded progress
- keep/discard discipline
- clean worker routing
- promotion readiness

## Required outputs

- one active frontier
- one next owner
- an explicit keep, discard, reroute, final-signoff, ready-to-land, or discarded decision
- `auto-wiki` writeback after every completed run

## Stop condition

Stop when the next owner is assigned and the current PR state has been explicitly advanced, rerouted, parked for final-signoff, or discarded.

## Handoff expectation

Route to exactly one core worker, shared protocol, or optional utility.
Require the current worker to return a handoff packet before the next step continues.

## Hard boundaries

- do not implement code directly unless the user explicitly overrides the harness
- do not allow multiple active writers
- do not skip `auto-wiki` after a completed run
- do not self-schedule workers indefinitely
- do not move a PR toward landing without current evidence
