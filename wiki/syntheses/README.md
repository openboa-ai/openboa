# Syntheses

Store durable internal conclusions here.

These pages condense repeated findings from multiple runs or PRs.

Current active synthesis:

- `openboa-layer-model.md`
  - working note for the large-scale `Agent` / `Chat` / `Work` / `Observe` model before the boundary decisions are stable enough for `docs/`
- `agent-runtime-self-direction-contract.md`
  - deeper working contract for the domain-agnostic `Agent` runtime as a self-directed worker engine with activation intents, a scheduler daemon, checkpoints, and capability packs
- `agent-runtime-capability-pack-contract.md`
  - deeper working contract for runtime-native services, default bundled packs, and optional packs such as ontology in the openboa `Agent` runtime
- `openboa-agent-architecture-contract.md`
  - deeper working contract for keeping the entire agent subsystem under `src/agents/` while explicitly separating runtime, memory, steering, skills, tools, sandbox, providers, auth, runners, workspace, and capabilities
- `agent-runtime-primitive-discipline.md`
  - internal decision rule for when Agent runtime work should stay inside existing seams versus when a truly new openboa primitive can be justified
- `agent-docs-information-architecture.md`
  - internal design for how the public Agent docs should be structured so meaning, capability model, runtime contract, architecture, and references stay separated and readable
- `openclaw-agents-source-reading.md`
  - source-first reading of upstream OpenClaw `src/agents/`, capturing the actual runtime ingress, bootstrap/skills/sandbox/auth seams, and how the embedded runner is assembled before translating anything into openboa
- `openboa-agent-runtime-integration-design.md`
  - concrete design for layering openboa self-direction onto the OpenClaw-aligned `agents` subsystem without replacing `agent-command`, `skills`, `sandbox`, `auth-profiles`, or the embedded runner
- `chat-layer-contract.md`
  - deeper working contract for `Chat` as the shared office layer, backend truth system, and capability layer above the agent core
- `chat-purpose-contract.md`
  - purpose-first working contract for `Chat`, clarifying why chat is the first believable openboa product layer and what the MVP must prove
- `chat-participant-binding-contract.md`
  - deeper working contract for agent registration versus chat binding, plus membership, mentionability, reachability, and scope rights
- `chat-thread-semantics-contract.md`
  - deeper working contract for thread as a durable backend scope with root, reply, follow, and unread semantics
- `chat-attention-contract.md`
  - deeper working contract for cursor, follow, unread, mention, and inbox behavior
- `chat-agent-runtime-port-contract.md`
  - deeper working contract for the thin runtime port between `Chat` and `Agent`
- `work-layer-contract.md`
  - deeper working contract for `Work` as the execution semantics and business publication layer above `Chat`
- `work-purpose-contract.md`
  - purpose-first working contract for `Work`, clarifying why chat-first implementation still needs a long-term business-commitment layer
- `work-assetization-contract.md`
  - deeper working contract for what gets promoted out of private agent execution into durable business assets
