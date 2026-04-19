# RUN-20260419-1318-docs-public-boundary-ia-pass

- `PR`: `PR-docs-public-boundary-ia`
- `Worker`: `auto-project`
- `Status`: `kept`

## Goal

Isolate the remaining public docs IA sweep into a standalone frontier, keep internal authoring rules out of `docs/`, and verify that the published docs tree stays separate from `wiki/` and `raw/`.

## Changes

- removed `docs/**/AGENTS.md` from the public docs tree
- added the missing public Agent pages for:
  - `hub`
  - `capabilities`
  - `workspace`
  - `memory`
  - `context`
  - `bootstrap`
  - `architecture`
- reorganized the public docs IA and reading order around `Agent`, `Chat`, `Work`, and `Observe`
- updated Mintlify navigation in `docs/docs.json` to match the published docs surface
- added `scripts/check-doc-public-boundary.mjs` and wired it into `pnpm check:docs`
- moved docs authoring guidance into internal wiki syntheses instead of published docs

## Verification

- `pnpm check:docs`
- `pnpm docs:linkcheck`
- `pnpm docs:validate`
- `git diff --check`

## Result

The public docs now read as a coherent published surface with a forward Agent reading order, and the repo now enforces that internal authoring notes do not live under `docs/` or leak from public docs into `wiki/` or `raw/`.
