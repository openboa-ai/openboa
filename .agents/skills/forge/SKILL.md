---
name: forge
description: "Forge utility for PR-centric repos. Use when the harness or a user needs `gh` CLI help for pull requests, workflow runs, issues, or API reads inside the current repository."
---

# Forge

## Role

`forge` is an optional utility for `gh`-based repo, PR, workflow, issue, and API inspection.

## When to use

Use it when the harness or the user needs GitHub metadata or API reads that are outside the default worker loop.

## What it optimizes for

- fast forge inspection
- reliable PR and workflow lookup
- low-friction GitHub API access

## Required outputs

- the requested forge state
- links, metadata, or API results relevant to the current task

## Stop condition

Stop when the current worker has the GitHub state it needs.

## Handoff expectation

Return the retrieved forge state to the active worker or user.

## Hard boundaries

- optional utility only; not part of the default harness loop
- prefer running inside the current repo so branch and PR resolution are automatic
- if the task is specifically CI failure recovery, route through `ci-recovery`
