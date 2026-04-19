# RUN-20260408-1950-workspace-bootstrap-substrate-pass

- `PR`: `PR-agent-runtime-heartbeat`
- `Goal`: Move openboa closer to the OpenClaw agent workspace model by seeding per-agent bootstrap markdown files and making the runtime actually consume them.
- `Baseline`: Agents already had `workspace/`, `runtime/`, and `learn/` directories, but the workspace had no standard bootstrap files and the runtime system prompt only loaded `.prompt` files plus runtime-generated sections.
- `Change`: Added `src/agents/workspace/bootstrap-files.ts`, taught setup to seed workspace files aligned with the OpenClaw reference shape (`AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, `MEMORY.md`), and extended `buildSystemPrompt` so the runtime actually loads those workspace markdown sections into its prompt substrate.
- `Quality axis targeted`: OpenClaw alignment and durable agent-facing memory substrate
- `Evidence`:
  - [bootstrap-files.ts](/src/agents/workspace/bootstrap-files.ts)
  - [setup.ts](/src/agents/setup.ts)
  - [bootstrap.ts](/src/agents/environment/bootstrap.ts)
  - [setup.test.ts](/test/setup.test.ts)
  - [agent-runtime.test.ts](/test/agent-runtime.test.ts)
- `Measurement`: Newly spawned agents now get a recognizable OpenClaw-aligned workspace substrate, and runtime execution visibly consumes those markdown files as part of the system prompt rather than leaving them as inert scaffolding.
- `Decision`: `keep`
- `Net quality delta`: openboa is now materially closer to the OpenClaw workspace model while preserving its newer runtime JSON/JSONL continuity surfaces.
- `Why this is not done yet`: `memory/YYYY-MM-DD.md` style daily memory flows, richer learnings promotion, and dedicated memory tools are still future work.
- `What quality gap remains`: Workspace bootstrap is present and consumed, but long-term memory behavior is still shallower than OpenClaw because only `MEMORY.md` is seeded today.
- `Next recommended owner`: `auto-coding`
