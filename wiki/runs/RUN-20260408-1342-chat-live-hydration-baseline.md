# RUN-20260408-1342-chat-live-hydration-baseline

- `PR`: `PR-chat-live-hydration`
- `Triggered by`: `auto-project`
- `Owner skill`: `auto-pm`
- `Baseline`: The chat shell is visually credible but still reads active conversation and transcript state directly from static demo exports inside `App`, `ChatWorkspace`, `TranscriptPane`, `ThreadPane`, and `SurfaceRail`.
- `Hypothesis`: Moving active chat selection and transcript view construction into a small App-owned runtime module will unlock the next hydration frontier without widening into full ledger integration.
- `Single bounded change`: Lock a new frontier around App-owned sidebar selection, chat runtime derivation, and prop-based chat surface reads.
- `Measurement`: The shell should switch active conversations from one selected sidebar item, hide the thread pane when the selected view has no active thread, and keep the existing runtime tests green.
- `Evidence`: `git grep` and direct file inspection show direct demo imports across the chat surface before the change.
- `Quality axis targeted`: runtime state ownership and resumable PR memory
- `Net quality delta`: `baseline captured`
- `Decision`: `keep`
- `Next recommended owner`: `auto-coding`
