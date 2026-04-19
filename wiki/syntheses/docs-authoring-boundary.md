# Docs Authoring Boundary

## Purpose

This note defines the separation between public documentation and internal documentation work.

It exists because `docs/` is a published surface. Repo-local authoring rules must not appear there.

## Canonical split

- `docs/`
  - public, canonical explanation
  - written for external readers and new contributors
  - safe to publish
- `wiki/`
  - internal working memory
  - design reasoning, PR memory, run memory, authoring rules, unstable syntheses
- `raw/`
  - imported source material and immutable evidence

## Rule

`docs/**/AGENTS.md` must not exist.

Why:

- `AGENTS.md` is an internal operating-contract format
- published docs should explain the product, not the maintainer workflow
- public readers should not see repo-local editing instructions

## Public docs guidance

Use these files to understand the published docs surface:

- `docs/README.md`
  - public docs information architecture and reading order
- `docs/index.md`
  - public docs landing page
- `docs/docs.json`
  - Mintlify navigation structure

These files may describe the public docs surface, but they should not include internal operating rules.

## Internal authoring guidance

When changing docs:

1. start from `wiki/AGENTS.md`
2. read this note
3. inspect the active PR and run memory in `wiki/`
4. update `docs/README.md` when public docs IA changes
5. keep internal rationale in `wiki/`, not in `docs/`

## Language rule

- English public docs belong in `docs/`
- Korean public docs belong in `docs/ko/`
- internal wiki language may follow the working context, but public language boundaries must remain clean

## Promotion rule

- stable public explanation -> `docs/`
- internal reasoning or authoring process -> `wiki/`
- source evidence -> `raw/`
