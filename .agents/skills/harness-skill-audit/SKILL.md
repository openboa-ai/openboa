---
name: harness-skill-audit
description: Audit a repository's local skill surface against the current harness model. Use when a user wants to know which skills should exist, which should be removed, or which existing skills should be rewritten to fit the current harness.
---

# Harness Skill Audit

Audit the repository's real recurring workflows before recommending skills.
Prefer evidence from the current harness docs, wiki state, existing local skills, and recent work
patterns over generic brainstorming.

Recommend updates before new skills when an existing skill is already close to the needed behavior.

## Workflow

1. Map the current harness surface.
   Read:
   - `AGENTS.md`
   - `.agents/AGENTS.md`
   - `wiki/frontiers.md`
   - the most relevant `wiki/prs/` and `wiki/runs/`

2. Scan the local skill surface.
   Check:
   - `.agents/skills`
   - `.codex/skills`
   - `skills`

3. Compare local skills against recurring work.
   Look for:
   - repeated validation sequences
   - repeated failure shields
   - recurring ownership boundaries
   - repeated root-cause categories
   - workflows that repeatedly require the same repo-local context

4. Separate `new skill` from `update existing skill`.
   Recommend an update when a skill is already the right bucket but has stale triggers,
   missing guardrails, outdated paths, or incomplete scope.

5. Use external memory only if repo-local `wiki/` is not enough.

## Analysis rules

- a candidate `new skill` should correspond to a repeated workflow, not just a repeated topic
- a candidate `skill update` should correspond to a workflow already covered by a local skill whose triggers, guardrails, or validation instructions no longer match the harness
- prefer concrete evidence such as repeated validation sequences, repeated ownership confusion, or repeated recovery flows

## What to scan

- `wiki/frontiers.md`
- relevant `wiki/prs/`
- relevant `wiki/runs/`
- optional `$CODEX_HOME` memories only if repo-local state is insufficient
- `./.agents/skills/*/SKILL.md`
- `./.agents/skills/*/agents/openai.yaml`
- `AGENTS.md`
- `README.md`
- architecture, product, or validation docs

## Output expectations

Return a compact audit with:

1. `Existing skills`
2. `Suggested updates`
3. `Suggested new skills`
4. `Priority order`

## Follow-up

If the user asks to actually create or update one of the recommended skills, switch to [$skill-creator](/Users/sangjoon/.codex/skills/.system/skill-creator/SKILL.md) and implement the chosen skill rather than continuing the audit.
