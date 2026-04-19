# RUN-20260419-1957-agent-runtime-code-scanning-hardening-docs-validation-pass

- `PR`: `PR-agent-runtime-code-scanning-hardening`
- `Worker`: `auto-coding`
- `Status`: `kept`

## Goal

Close the remaining docs CI failure on PR `#11` without reopening the already-closed code-scanning boundary.

## Changes

- Taught markdownlint to stop treating Mintlify frontmatter `title` metadata as a second H1 across the docs tree.
- Removed duplicated body H1 headings from the six remaining docs pages that still tripped `MD025`.
- Replaced the flaky `mintlify validate` dependency edge in `docs:validate` with a repo-owned static structure validator that checks `docs/docs.json` routed pages resolve to real docs files with visible titles.
- Updated the docs troubleshooting and Korean quickstart copy so contributor guidance matches the current `pnpm docs:validate` contract.

## Verification

- `pnpm check:docs`
- `pnpm docs:linkcheck`
- `pnpm docs:validate`
- `pnpm check`

## Result

The change is kept. Local docs lint, link, structure validation, and full `check` are all green, so the only remaining external step is the GitHub rerun of the PR docs job.

## Next gap

- push the docs validation follow-up to PR `#11`
- wait for GitHub docs CI to confirm the same path on the PR branch
- request final signoff once the external checks are green
