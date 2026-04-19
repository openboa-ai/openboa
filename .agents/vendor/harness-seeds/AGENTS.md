# AGENTS.md

## Purpose

`.agents/vendor/harness-seeds/` holds distilled external seed material that informs the generic
harness `auto-*` skills.

This subtree is not a direct routing surface.

## Rules

- do not invoke these files directly from user requests
- do not treat them as repo truth
- use them only when a repo-local `auto-*` skill explicitly points here
- keep these seed notes smaller than the repo-local wrappers
- preserve license and provenance inside this subtree only
