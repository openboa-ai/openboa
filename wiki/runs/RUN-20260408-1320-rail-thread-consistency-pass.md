# RUN-20260408-1320-rail-thread-consistency-pass

- `PR`: `PR-chat-surface-credibility`
- `Triggered by`: `auto-project`
- `Owner skill`: `auto-ui`
- `Baseline`: `RUN-20260408-1315-single-line-row-alignment-pass`
- `Hypothesis`: If the surface rail stops treating counts as floating overlays and instead treats them as fixed control metadata, and if the thread pane gets a slightly tighter compact-message rhythm, the remaining “less resolved than the sidebar” feeling will drop meaningfully.
- `Single bounded change`: Reworked surface-rail tabs into a fixed icon-plus-count stack instead of absolute badge overlays, then tightened compact thread metadata and room-pulse type rhythm so the narrow pane reads more deliberately.
- `Measurement`: Compare the updated live capture to the previous alignment audit, focusing on whether the rail counts now feel anchored to the control system and whether thread metadata looks calmer and easier to scan. Re-run focused checks, web build, and the shell test suite.
- `Evidence`:
  - `/tmp/openboa-chat-rail-thread-pass.png`
  - `pnpm exec biome check src/shell/web/components/chrome/surface-rail.tsx src/shell/web/components/chat/message-row.tsx src/shell/web/components/chat/thread-pane.tsx`
  - `pnpm build:web`
  - `pnpm test -- test/company-shell-web.test.ts test/company-app.test.ts test/company-shell-desktop.test.ts test/company-shell-vite-config.test.ts`
- `Quality axis targeted`: `consistency`, `hierarchy`, `navigation clarity`
- `Net quality delta`: `positive` — the rail now uses a more intentional control grammar, and the thread pane’s compact metadata no longer feels as visually noisy relative to the rest of the shell.
- `Decision`: `keep`
- `Next recommended owner`: `auto-ui`
