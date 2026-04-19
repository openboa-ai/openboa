# RUN-20260408-1315-single-line-row-alignment-pass

- `PR`: `PR-chat-surface-credibility`
- `Triggered by`: `auto-project`
- `Owner skill`: `auto-ui`
- `Baseline`: `RUN-20260408-1015-transcript-thread-density-pass`
- `Hypothesis`: The remaining “looks a bit off” feeling in the sidebar is partly caused by metrics-unaware vertical alignment in single-line rows. If the shared row pattern automatically centers rows with no detail and preserves title-first alignment only for rows with detail, the chat navigation will feel more deliberate and fewer one-off fixes will be needed.
- `Single bounded change`: Reworked the shared `ListRowContent` primitive so rows without secondary detail use centered vertical alignment, while detail rows stay top-aligned; then applied the new rule to sidebar section rows and gave single-line sidebar items a stable minimum control height instead of ad hoc padding.
- `Measurement`: Compare the refreshed live sidebar capture against the previous state and verify that selected and unselected single-line rows feel centered inside their rectangle without local offsets. Re-run focused checks, web build, and the shell test suite.
- `Evidence`:
  - `/tmp/openboa-chat-alignment-audit.png`
  - `pnpm exec biome check src/shell/web/components/system/list-row-content.tsx src/shell/web/components/chrome/sidebar-section-list.tsx`
  - `pnpm build:web`
  - `pnpm test -- test/company-shell-web.test.ts test/company-app.test.ts test/company-shell-desktop.test.ts test/company-shell-vite-config.test.ts`
- `Quality axis targeted`: `alignment`, `consistency`, `design-system stability`
- `Net quality delta`: `positive` — the selected channel row and other single-line list items now sit visually centered inside their rectangle, and the fix lives in the shared row grammar instead of another local offset tweak.
- `Decision`: `keep`
- `Next recommended owner`: `auto-ui`
