# RUN-20260419-1329-chat-surface-test-discovery-pass

- `PR`: `PR-chat-surface-test-discovery`
- `Worker`: `auto-project`
- `Status`: `kept`

## Goal

Make Vitest discover the existing chat `.test.tsx` files and fix the sidebar section icon mapping for followed threads and viewer recents.

## Changes

- expanded `vitest.config.ts` discovery from only `test/**/*.test.ts` to both `test/**/*.test.ts` and `test/**/*.test.tsx`
- fixed `sectionIcon()` so:
  - `followed` maps to `MessageSquareText`
  - `viewer-recents` maps to `Eye`

## Verification

- `pnpm exec vitest run`
- `pnpm exec tsc --noEmit --pretty false`

## Result

The branch now runs the full existing chat `.tsx` suite instead of silently skipping it, and the sidebar presentation layer no longer flattens followed-thread and viewer-recents sections into the generic default icon.
