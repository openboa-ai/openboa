# AGENTS.md

## Purpose

`wiki/` is the internal working memory system for this repository.

It is not a public docs surface.

This directory is for:

- active syntheses
- PR memory
- run logs
- frontier ordering
- internal design rules
- unstable or in-progress explanations that are not ready for public docs

## What belongs here

- material that compounds internal repo knowledge
- design reasoning that is still being sharpened
- PR-specific and run-specific state
- internal rules for how the harness should keep memory and docs coherent

## What does not belong here

- public product explanations meant for docs readers
- polished canonical pages that should live in `docs/`
- raw imported reference material that should live in `raw/`

## Directory guide

- `syntheses/`
  - durable internal conclusions
- `prs/`
  - PR-level memory and scope contracts
- `runs/`
  - run-level evidence and chronology
- `frontiers.md`
  - active frontier ordering
- `log.md`
  - append-only chronology of meaningful wiki changes

## Promotion rule

- if a concept is still changing, keep it in `wiki/`
- if a concept is stable and externally meaningful, promote it to `docs/`
- if a note is raw evidence, keep it in `raw/`
