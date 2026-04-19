# RUN-20260408-2028-runtime-ingress-pass

- `PR`: `PR-agent-runtime-heartbeat`
- `Goal`: Add the first OpenClaw-aligned runtime seam above the bounded heartbeat engine so future scheduler work can reuse one canonical runtime path instead of creating a second execution engine.
- `Baseline`: The runtime could execute one heartbeat tick directly through `SelfDirectedAgentRuntime`, but there was no explicit ingress layer and no open activation model that could grow into a scheduler queue later.
- `Change`: Added `src/agents/runtime/activation-intent.ts` and `src/agents/runtime/runtime-ingress.ts`, taught `SelfDirectedAgentRuntime` to run a durable `ActivationIntent`, persisted activation data in heartbeat records, and moved the CLI heartbeat path onto the new ingress.
- `Quality axis targeted`: architectural seam quality and future scheduler-readiness inside the Agent runtime
- `Evidence`:
  - [activation-intent.ts](/src/agents/runtime/activation-intent.ts)
  - [runtime-ingress.ts](/src/agents/runtime/runtime-ingress.ts)
  - [self-directed-runtime.ts](/src/agents/runtime/self-directed-runtime.ts)
  - [heartbeat-store.ts](/src/agents/runtime/heartbeat-store.ts)
  - [agent-runtime.test.ts](/test/agent-runtime.test.ts)
- `Measurement`: Agent runtime now has a stable programmatic ingress that accepts an open semantic reason plus a smaller closed operational origin, while preserving the existing bounded heartbeat engine underneath. The CLI no longer talks directly to the runtime engine.
- `Decision`: `keep`
- `Net quality delta`: The runtime is less ad hoc and more scheduler-ready. We now have a clean place to attach activation queue and scheduler work without bypassing the current bounded-turn engine.
- `Why this is not done yet`: There is still no durable activation queue, no scheduler daemon, and no richer runtime memory beyond heartbeat/session persistence.
- `What quality gap remains`: The next slice is still missing the queue/lease path. Activations can now be described and ingressed cleanly, but they are not yet persisted and consumed asynchronously.
- `Next recommended owner`: `auto-coding`
