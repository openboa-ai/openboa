# RUN-20260408-1948-agent-self-enqueue-pass

- `PR`: `PR-agent-runtime-heartbeat`
- `Goal`: Let the agent runtime itself request future queue entries instead of relying only on a scheduler-generated follow-up path.
- `Baseline`: The proactive runtime could enqueue one runtime-generated follow-up when the loop directive returned `continue`, but the agent could not explicitly write its own bounded revisit requests into the activation queue.
- `Change`: Extended the loop directive contract in `src/agents/runtime/heartbeat.ts` with `queuedActivations`, taught the scheduler to enqueue those runtime-emitted requests, persisted them into runtime continuity files, and added tests for both runtime parsing and scheduler behavior.
- `Quality axis targeted`: self-directedness and runtime-native planning
- `Evidence`:
  - [heartbeat.ts](/src/agents/runtime/heartbeat.ts)
  - [scheduler.ts](/src/agents/runtime/scheduler.ts)
  - [runtime-memory-store.ts](/src/agents/memory/runtime-memory-store.ts)
  - [agent-runtime.test.ts](/test/agent-runtime.test.ts)
  - [runtime-scheduler.test.ts](/test/runtime-scheduler.test.ts)
- `Measurement`: The runtime can now sleep after a bounded turn while still emitting one or more durable future self-activations into the queue. This makes the scheduler a transport layer rather than the place where all follow-up intent is invented.
- `Decision`: `keep`
- `Net quality delta`: The agent is more credibly proactive. The queue is no longer only a scheduler convenience; it is now also a runtime-owned planning output.
- `Why this is not done yet`: Richer learnings memory and more real activation producers are still separate next-frontier work.
- `What quality gap remains`: The runtime can now enqueue its own future activations, but those activations still rely on prompt-shaped JSON rather than a richer structured planning contract.
- `Next recommended owner`: `auto-coding`
