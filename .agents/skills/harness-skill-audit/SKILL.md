---
name: harness-skill-audit
description: Audit a repository's local skill surface against the current harness model. Use when a user wants to know which skills should exist, which should be removed, or which existing skills should be rewritten to fit the current harness.
---

# Harness Skill Audit

## Role

`harness-skill-audit` is an optional utility for auditing a repo's local skill surface against the current harness model.

## When to use

Use it when the user wants to know which skills should exist, which should be removed, or which existing skills should be rewritten.

## What it optimizes for

- evidence-based skill recommendations
- low-surface harness design
- workflow-aligned skill updates

## Required outputs

1. `Existing skills`
2. `Suggested updates`
3. `Suggested new skills`
4. `Priority order`

## Stop condition

Stop when the skill surface has a clear audit result grounded in current repo workflows.

## Handoff expectation

If the user asks to create or update a skill, hand off to [$skill-creator](/Users/sangjoon/.codex/skills/.system/skill-creator/SKILL.md).

## Hard boundaries

- optional utility only; not part of the default harness loop
- audit recurring workflows, not repeated topics
- recommend updates before new skills when an existing skill is already the right bucket
- use external memory only if repo-local `wiki/` is insufficient
