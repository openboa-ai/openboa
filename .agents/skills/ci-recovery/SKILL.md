---
name: "ci-recovery"
description: "Harness-aligned CI recovery utility. Use when a PR has failing GitHub Actions checks and the next step is to inspect runs, extract actionable failure evidence, and hand a bounded fix packet back to the current worker."
---

# CI Recovery

## Role

`ci-recovery` is an optional utility for extracting actionable CI failure evidence.

## When to use

Use it when a PR has failing GitHub Actions checks and the next step is to inspect runs, summarize the failure, and hand a bounded recovery packet back to the current worker.

## What it optimizes for

- actionable root-cause summaries
- fast CI triage
- bounded recovery packets

## Required outputs

- failing check name
- run URL
- smallest actionable root-cause summary
- recommended next owner

## Stop condition

Stop when the current worker has enough CI evidence to fix, reroute, or escalate.

## Handoff expectation

Hand back to `auto-coding`, `auto-qa`, or `auto-project`.

## Hard boundaries

- optional utility only; not part of the default harness loop
- requires working `gh` authentication
- inspect CI, do not replace the PR loop itself
- treat non-GitHub Actions checks as external and report their details URL
