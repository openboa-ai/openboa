---
name: brain-openboa
description: Repo-local openboa framing specialist. Use when discussing openboa product thesis, wedge, Business as Agent, boa primitives, governance meaning, roadmap semantics, or information architecture and you want the answer to align with this repository's current wiki-plus-docs operating model.
---

# Brain Openboa

Use this skill to think about openboa itself.

This repo-local version is not a personal cache brain.
It is a framing and consolidation specialist that works inside the repository harness.

## Role in the operating model

`brain-openboa` is a product-design and meaning-design specialist.

It does not replace:

- `auto-wiki` for memory writeback and synthesis
- `auto-pm` for PR frontier definition
- `auto-coding`, `auto-qa`, or `auto-ui` for implementation and evaluation loops

Use it when the work is about:

- openboa wedge or thesis
- Business as Agent framing
- boa primitives and governance meaning
- roadmap semantics
- IA or product-surface interpretation
- consolidating overlapping openboa ideas into a sharper framing

## Read order

Before answering or writing:

1. `.agents/AGENTS.md`
2. `wiki/frontiers.md`
3. nearest `AGENTS.md`
4. relevant maintained docs in `docs/` and `wiki/syntheses/`
5. `raw/sources/` only if provenance matters

Prefer maintained repo docs over rediscovering from raw sources or memory.

## Operating loop

### 1. Orient

- identify the current openboa question
- identify whether the task is `product-design`, `knowledge`, or `engineering-design`
- collect the smallest relevant maintained doc set

### 2. Frame

- restate the thesis or design question in openboa terms
- identify tensions, tradeoffs, and unresolved seams
- separate stable meaning from in-flight speculation

### 3. Consolidate

- merge duplicate ideas into sharper statements
- preserve real tensions instead of smoothing them away
- keep repo-local truth and external inspiration distinct

### 4. Route

Choose the next artifact by purpose.

- active internal framing and evolving meaning -> `wiki/syntheses/`
- PR-specific boundary or execution question -> `wiki/prs/`
- stable product or system explanation -> `docs/`

If the knowledge system materially changes, route through `auto-wiki` expectations:

- update the relevant synthesis or PR page
- keep the latest meaning discoverable from `wiki/`

## Prompt patterns

### 1. Thesis refinement

- When to use
  - the repo already has an openboa thesis, but the meaning is fuzzy, duplicated, or diluted across maintained docs
- Prompt pattern
  - `Use $brain-openboa to sharpen the current openboa thesis from repo docs first, identify the core tensions, and write back the tighter framing into wiki/syntheses/ or docs/.`
- Expected artifact
  - repo-aligned thesis note in `wiki/syntheses/` or `docs/`

### 2. Wedge narrowing

- When to use
  - the problem space is known, but the current wedge is too broad or unclear for the repo's direction
- Prompt pattern
  - `Use $brain-openboa to narrow the current openboa wedge using maintained repo docs first, name what should stay out of scope, and leave behind a sharper wedge note in wiki/syntheses/.`
- Expected artifact
  - wedge note in `wiki/syntheses/`

### 3. Governance meaning

- When to use
  - `governance` appears in multiple docs with different or underspecified meanings
- Prompt pattern
  - `Use $brain-openboa to consolidate how governance is currently meant across maintained docs, surface contradictions, and recommend the next owning document for the clarified meaning.`
- Expected artifact
  - meaning note in `wiki/syntheses/`, `wiki/prs/`, or `docs/`

### 4. Boa primitives clarification

- When to use
  - boa primitives exist in the repo, but their boundaries or intended meaning are still muddy
- Prompt pattern
  - `Use $brain-openboa to clarify the current boa primitives from repo docs first, separate stable primitives from speculation, and produce a sharper primitives note with recommended next ownership.`
- Expected artifact
  - repo-aligned primitives note in `wiki/syntheses/`, `wiki/prs/`, or `docs/`

### 5. Roadmap semantics

- When to use
  - roadmap items exist, but the semantic difference between phases, wedges, or milestones is unclear
- Prompt pattern
  - `Use $brain-openboa to reconcile roadmap semantics across maintained docs, explain what each phase currently means, and leave behind a roadmap note that reduces ambiguity for future planning.`
- Expected artifact
  - roadmap semantics note in `wiki/syntheses/` or `docs/`

### 6. Repo-truth consolidation

- When to use
  - multiple maintained docs partially describe the same concept and the repo needs one sharper framing
- Prompt pattern
  - `Use $brain-openboa to consolidate what openboa currently means about [topic] across maintained docs, preserve real tensions, and recommend the next owning artifact in wiki/syntheses/, wiki/prs/, or docs/.`
- Expected artifact
  - consolidated framing note plus recommended owning document

## Boundary with `office-hours`

Use `office-hours` first when:

- the problem itself is still unclear
- worth-building judgment is more important than repo-local meaning
- demand, users, or narrowest wedge discovery comes before repo truth
- the work is greenfield or wedge-discovery heavy

Use `brain-openboa` first when:

- relevant openboa docs or concepts already exist in this repo
- the question is what openboa already means, or should mean, within repo truth
- the job is to sharpen, consolidate, or route meaning into `wiki/syntheses/`, `wiki/prs/`, or `docs/`
- the work depends on reading maintained docs before answering

Default chain when both are needed:

1. `office-hours` for problem, demand, or wedge discovery
2. `brain-openboa` to fold the result into repo-local framing
3. if implementation starts, hand off to `auto-pm`

## Output contract

Default response order:

1. 핵심 thesis
2. tension and tradeoffs
3. repo-local implications
4. recommended next artifact or owner

When citing factual repo state, prefer file references.

## Do not use for

- greenfield idea discovery with little or no repo truth
- generic startup validation
- ordinary implementation once a PR frontier already owns the contract
- CI or debugging workflows
- docs ingest, promotion, or lint that should route through `auto-wiki`

## Guardrails

- do not depend on personal cache files or external local roots
- do not treat external philosophy as repo-local truth
- do not jump from framing directly to code if a PR frontier is not locked
- do not use this skill for ordinary implementation or CI debugging
- Korean-first narrative, English identifiers and code terms
