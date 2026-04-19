# openboa Agent Architecture Contract

This page hardens the internal shape of `src/agents/` for openboa.

Use it when:

- the repo wants to stay structurally close to OpenClaw
- the team needs a durable answer for where runtime, memory, skills, tools, sandbox, and capabilities should live
- future implementation work risks scattering agent concerns across top-level directories

This is a working contract, not yet the final canonical architecture page.

## Primary design rule

The openboa `Agent` subsystem should stay under `src/agents/`.

Do not split major agent concerns into unrelated top-level trees if they are still part of the agent runtime.

That means:

- self-directed runtime belongs under `src/agents/`
- runtime memory belongs under `src/agents/`
- steering/bootstrap belongs under `src/agents/`
- skills loading belongs under `src/agents/`
- tools and sandbox belong under `src/agents/`
- domain capability bindings still belong under `src/agents/`, even if they point upward to `Chat`, `Work`, or `Observe`

This preserves an OpenClaw-aligned subsystem boundary while still allowing openboa-specific layers.

## OpenClaw-aligned principle

OpenClaw already groups its agent concerns under one subsystem:

- scope and config resolution
- workspace/bootstrap files
- skill loading and filtering
- runtime command orchestration
- auth, CLI, provider, and session concerns

So openboa should extend that pattern rather than breaking it.

The key difference should be:

- OpenClaw-aligned agent subsystem shape
- openboa-specific self-directed runtime and capability layering inside that subsystem

## Recommended `src/agents/` structure

```text
src/agents/
  agent-config.ts
  setup.ts

  scope/
    agent-scope.ts
    agent-paths.ts
    runtime-config.ts

  runtime/
    activation-intent.ts
    activation-queue.ts
    scheduler.ts
    self-directed-runtime.ts
    heartbeat.ts
    heartbeat-store.ts
    runtime-port.ts

  memory/
    checkpoint-store.ts
    session-state-store.ts
    working-buffer-store.ts
    learnings-store.ts
    runtime-summary-store.ts

  steering/
    bootstrap.ts
    bootstrap-hooks.ts
    steering-loader.ts
    identity.ts
    mission.ts
    heartbeat-steering.ts
    tools-steering.ts

  skills/
    local-loader.ts
    workspace.ts
    filter.ts
    runtime-config.ts
    registry.ts
    bundled/
      self-improvement/
      proactivity/
      runtime-memory-hygiene/
      ontology/

  tools/
    runtime-tool.ts
    tool-policy.ts
    registry.ts
    adapters/
    guards/

  sandbox/
    sandbox-policy.ts
    sandbox-runtime.ts
    workspace-boundary.ts

  providers/
    provider-capabilities.ts
    codex-model-client.ts
    anthropic-model-client.ts
    acp-adapter.ts

  auth/
    codex-auth.ts
    oauth.ts
    auth-profiles.ts

  runners/
    agent-runner.ts
    cli-runner.ts
    embedded-runner.ts
    pi-adapter.ts

  sessions/
    session-store.ts
    cli-session.ts
    transcript.ts

  workspace/
    workspace.ts
    workspace-template.ts
    workspace-files.ts

  capabilities/
    self-improvement/
    proactivity/
    runtime-memory-hygiene/
    ontology/
    chat-binding/
    work-binding/
    observe-binding/
```

## Responsibility by folder

### `scope/`

Purpose:

- resolve what an agent is
- normalize ids, paths, defaults, and effective config

Owns:

- agent identity resolution
- agent workspace path resolution
- effective runtime/provider/model selection
- skills/tools/sandbox config overlays

This is the agent-definition layer.

### `runtime/`

Purpose:

- execute one bounded self-directed activation

Owns:

- `ActivationIntent`
- activation queue reads and writes
- scheduler orchestration
- heartbeat/activation directive parsing
- follow-up scheduling
- runtime port used by higher layers

This is the self-directed engine.

### `memory/`

Purpose:

- store private runtime continuity

Owns:

- checkpoint store
- session-state
- working buffer
- learnings inbox
- compact runtime summaries

This is private runtime memory, not `Chat` or `Work` truth.

### `steering/`

Purpose:

- load and manage the runtime's operating instructions

Owns:

- bootstrap file discovery
- steering file loading
- identity/mission/tool gotcha instructions
- heartbeat maintenance instructions

This is the schema layer for the agent runtime itself.

### `skills/`

Purpose:

- discover, filter, load, and serialize skills

Owns:

- local skill loading
- bundled skill discovery
- plugin skill discovery
- skill prompt formatting
- runtime skill configuration and eligibility

Important rule:

- `skills/` is the loading and packaging machinery
- specific built-in behavioral packs can still live under `skills/bundled/` or `capabilities/`

OpenClaw-aligned rules:

- workspace-local skills should override user-global skills
- user-global skills should override bundled defaults
- extra skill directories should stay lower-priority than explicit local/project skills
- eligibility gates such as required binaries, required env, or required config should be checked before a skill becomes activatable
- skill snapshots may be session-scoped for performance, so refresh behavior should be explicit rather than implicit

This keeps `skills/` as discovery and gating infrastructure, not business semantics.

### `tools/`

Purpose:

- expose executable actions to the runtime

Owns:

- tool definitions
- tool registry
- tool policy
- adapter-specific execution
- common tool guards

This is where tool shape lives.

Important rule:

- `tools/` owns the callable contract, registry, guards, and execution adapters
- `skills/` may teach the runtime when or why to use a tool, but should not become the tool execution substrate
- `capabilities/` may bundle tools together, but should not replace the registry and policy machinery

So:

- tool discovery and filtering stays in `tools/`
- tool prompt exposure may be influenced by `skills/`
- higher-level behavior composition may live in `capabilities/`

### `sandbox/`

Purpose:

- enforce execution boundaries

Owns:

- workspace access mode
- network policy hooks
- path guard logic
- sandbox runtime policy

This is the enforcement layer around tools and providers.

Important rule:

- `sandbox/` must sit between runtime intent and actual side effects
- `sandbox/` should constrain both tool execution and provider/runtime execution where relevant
- `sandbox/` should not live inside individual tools because the safety boundary must be centrally enforceable

This keeps policy and execution boundaries coherent across the subsystem.

### `providers/`

Purpose:

- normalize model-provider integration

Owns:

- provider capability declarations
- model clients
- ACP/runtime bridges
- provider-specific constraints

This is the provider abstraction layer.

### `auth/`

Purpose:

- resolve credentials and authentication state

Owns:

- OAuth resolution
- profile selection
- auth health
- auth rotation or sync helpers

This is auth substrate, not business logic.

### `runners/`

Purpose:

- bridge runtime decisions into actual model/tool execution backends

Owns:

- embedded runner
- CLI runner
- Pi/OpenCode adapter
- future ACP runner adapters

This is execution plumbing, not higher-level orchestration.

### `sessions/`

Purpose:

- persist and resume session-level execution history

Owns:

- turn transcript persistence
- CLI session binding
- session metadata

This is separate from long-lived runtime memory because sessions are not the same thing as checkpoints.

### `workspace/`

Purpose:

- own the agent-local filesystem contract

Owns:

- workspace resolution
- template or file seeding
- agent-local bootstrap file presence

This is the runtime's local home surface.

### `capabilities/`

Purpose:

- attach higher-level behavior or domain bindings without polluting the core

Owns:

- default bundled behaviors
- optional structured-memory support
- domain bindings for chat/work/observe

This is the right place for openboa-specific extension inside the `agents` subsystem.

## Where `skills`, `tools`, and `capabilities` differ

These three must not collapse into one.

### `skills`

- prompt-shaping and workflow-shaped knowledge bundles
- discovered and loaded into runtime context

### `tools`

- executable functions and adapters
- callable by the runtime

### `capabilities`

- packaged behavior slices that may combine:
  - steering
  - memory rules
  - tools
  - skills
  - runtime hooks

So:

- a capability can use skills
- a capability can expose tools
- but the loading machinery for skills and tools should remain separate

## Where `tools` and `sandbox` differ

These two also must not collapse into one.

### `tools`

- define what can be called
- normalize arguments and outputs
- route to the correct adapter or implementation

### `sandbox`

- decides whether the call is allowed
- constrains filesystem, network, and workspace boundaries
- enforces policy consistently regardless of which tool or runner tries to act

So:

- `tools/` defines action surfaces
- `sandbox/` defines execution boundaries

They collaborate, but they are not the same subsystem.

## Recommended execution path inside `src/agents/`

The agent runtime should read almost like a pipeline:

1. `scope/`
   - resolve the effective agent definition
2. `steering/`
   - load bootstrap, identity, mission, and runtime steering
3. `skills/`
   - discover eligible knowledge and workflow packs for the current environment
4. `runtime/`
   - create one bounded activation or turn
5. `tools/`
   - expose callable surfaces for that turn
6. `sandbox/`
   - enforce whether those calls are actually permitted
7. `providers/` and `runners/`
   - execute model and tool work through concrete backends
8. `sessions/` and `memory/`
   - persist session traces and private runtime continuity

This is the most important structural reading order:

- `scope` decides what this agent is
- `steering` decides how it should think
- `skills` decide what workflow-shaped knowledge is available
- `tools` decide what it can do
- `sandbox` decides what is allowed
- `runners/providers` decide how execution actually happens
- `sessions/memory` decide what continuity survives the turn

## Current config surface to preserve

The current local config shape already points in the right direction:

- `runtime`
- `model`
- `auth`
- `tools`
- `sandbox`
- `skills`
- `session`
- `heartbeat`

That means future refactors should avoid scattering these concerns into unrelated top-level systems.

If a concern is configured as part of agent definition, it probably still belongs under `src/agents/`.

## Recommended placement for built-in add-ons

### Runtime-native, not optional

These do not belong only in `capabilities/`:

- activation queue
- scheduler
- checkpoint store
- session-state
- working buffer
- learnings inbox

These belong in:

- `runtime/`
- `memory/`

### Bundled default behaviors

These should live under `capabilities/` and be available by default:

- `self-improvement`
- `proactivity`
- `runtime-memory-hygiene`

### Optional higher-order capabilities

These should also live under `capabilities/`, but not always attach:

- `ontology`
- `chat-binding`
- `work-binding`
- `observe-binding`

## Most important boundary

The agent core must remain domain-agnostic.

That means:

- `runtime/`, `memory/`, `tools/`, `sandbox/`, `providers/`, `auth/`, `runners/`, `workspace/`
  should not know business semantics
- `capabilities/chat-binding`, `capabilities/work-binding`, and `capabilities/observe-binding`
  may know those semantics

This preserves both:

- OpenClaw-aligned agent subsystem coherence
- openboa-specific layered extensibility

## Concrete recommendation

If openboa wants to stay close to OpenClaw, the right move is:

- keep everything under `src/agents/`
- do not create a sibling top-level tree for add-ons
- represent add-ons as subfolders within `src/agents/`
- keep runtime-native concerns in `runtime/` and `memory/`
- keep bundled and optional extensions in `capabilities/`

That is the cleanest way to stay structurally aligned with OpenClaw while still making openboa's extensions explicit.
