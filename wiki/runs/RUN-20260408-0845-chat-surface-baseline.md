# RUN-20260408-0845-chat-surface-baseline

- `PR`: `PR-chat-surface-credibility`
- `Triggered by`: Human direction to apply the new harness properly and to improve the chat surface through a design-system-first loop instead of ad hoc local patching.
- `Owner skill`: `auto-pm`
- `Baseline`: The chat surface already improved beyond the earlier dashboard-like layout, but there was no active PR page or run record for the work. Micro-defects kept recurring across badges, headers, composer chrome, and row alignment, which suggested that the shared design system was not yet stable enough.
- `Hypothesis`: If the frontier is explicitly locked as a chat-surface credibility PR and the design canon states a foundation-first rule, the next UI loops will converge faster because they will target shared patterns before local exceptions.
- `Single bounded change`: Create the active frontier record, create the PR working-memory page, create a baseline run page, and update the design canon to state that repeated micro-defects must be solved at the shared-pattern level before surface-specific polish.
- `Measurement`: The harness can now resume this work from repo memory alone, and the active frontier explicitly defines the quality target as shared-pattern credibility plus component-level polish.
- `Evidence`:
  - `docs/DESIGN.md`
  - `wiki/frontiers.md`
  - `wiki/prs/PR-chat-surface-credibility.md`
  - `wiki/runs/RUN-20260408-0845-chat-surface-baseline.md`
- `Quality axis targeted`: Memory clarity and design-system-first UI execution
- `Net quality delta`: positive
- `Decision`: keep
- `Next recommended owner`: `auto-ui`
