# RUN-20260408-1015-transcript-thread-density-pass

- `PR`: `PR-chat-surface-credibility`
- `Triggered by`: `auto-project`
- `Owner skill`: `auto-ui`
- `Baseline`: `RUN-20260408-0945-chat-ui-audit`
- `Hypothesis`: Flattening the composer into the pane, widening the thread, and solving the low-message transcript layout at the scroll-container level will close the most visible remaining chat-credibility gaps.
- `Single bounded change`: Introduced an embedded composer variant, widened the thread column, reworked room-pulse density, and fixed the transcript scroll-area structure so low-volume conversations anchor near the composer instead of leaving a dead void below the messages.
- `Measurement`: Compare the full chat surface after the pass against the previous component-level captures and the PR-level quality gap.
- `Evidence`:
  - `/tmp/openboa-chat-ds-pass5-full.png`
  - `/tmp/openboa-chat-ds-pass3-composer.png`
  - `/tmp/openboa-chat-ds-pass3-thread-pane.png`
- `Quality axis targeted`: `density`, `hierarchy`, `consistency`
- `Net quality delta`: `positive` — the main pane now behaves like a live chat surface at low message volume, the composer reads as part of the transcript rather than a separate card, and the thread feels less cramped.
- `Decision`: `keep`
- `Next recommended owner`: `auto-ui`
