# RUN-20260408-2018-openclaw-agent-runtime-design-pass

- `PR`: `PR-agent-runtime-heartbeat`
- `Goal`: Turn the OpenClaw source reading into a concrete openboa agent-runtime integration design without drifting away from the upstream `src/agents/` subsystem shape.
- `Baseline`: We had a first heartbeat tick implementation plus several syntheses, but the next slice boundary was still fuzzy: it was not yet explicit how self-direction should layer onto `agent-command`, `skills`, `sandbox`, `auth-profiles`, and the embedded runner.
- `Change`: Read upstream `src/agents/` source directly and wrote `openclaw-agents-source-reading.md` plus `openboa-agent-runtime-integration-design.md` to lock the real ingress, seam ownership, runtime add-on placement, activation model, scheduler role, memory split, and bundled-versus-optional capabilities.
- `Quality axis targeted`: structural clarity and implementation-direction quality for the openboa Agent subsystem
- `Evidence`:
  - upstream source reading anchored at commit `46480f531a37e3d22fb0d0f622c75db42770f108`
  - [openclaw-agents-source-reading.md](/wiki/syntheses/openclaw-agents-source-reading.md)
  - [openboa-agent-runtime-integration-design.md](/wiki/syntheses/openboa-agent-runtime-integration-design.md)
- `Measurement`: The design now answers the unresolved architectural question with a concrete path: self-direction is added above OpenClaw-aligned bounded execution through `runtime/` and `memory/`, while `agent-command`, `skills`, `sandbox`, `auth-profiles`, and the embedded runner remain first-class seams inside `src/agents/`.
- `Decision`: `keep`
- `Net quality delta`: The next implementation slice is now well-scoped. Instead of hand-wavy “scheduler vs chat decoupling” options, the subsystem has a stable direction: keep `agent-command` as the canonical bounded-turn ingress and add self-directed runtime through `runtime-ingress`, activation queue, scheduler, and private runtime memory.
- `Why this is not done yet`: This is still design and memory writeback only. The codebase does not yet have `activation-queue.ts`, `scheduler.ts`, `runtime-ingress.ts`, or the richer runtime-memory stores.
- `What quality gap remains`: The next gap is implementation, not architecture. We need to cut the first code slice that exposes a callable runtime ingress above `agent-command` without bypassing the existing skills/sandbox/auth/runner path.
- `Next recommended owner`: `auto-coding`
