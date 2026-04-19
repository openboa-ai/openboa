# OpenClaw Agents Source Reading

This page captures what OpenClaw `src/agents/` actually does from source, before translating any of it into openboa.

Read against upstream commit:

- `46480f531a37e3d22fb0d0f622c75db42770f108`

Use this page when:

- deciding how closely openboa should stay aligned with OpenClaw
- separating core runtime, execution seams, and extension seams inside `src/agents/`
- avoiding premature re-architecture based on folder names alone

## Main conclusion

OpenClaw does **not** structure `src/agents/` as one small runtime plus many equal siblings.

Instead, it has a clear center of gravity:

- `agent-command.ts` is the orchestration ingress
- `agent-scope.ts` resolves the effective agent definition
- `workspace.ts` and bootstrap helpers prepare the agent-local environment
- `skills/` loads, filters, gates, and serializes workflow knowledge
- `sandbox/` resolves and enforces execution boundaries
- `auth-profiles/` manages reusable provider auth state and selection order
- `pi-embedded-runner/` performs the real turn execution
- `pi-hooks/` and `schema/` are support layers around maintenance and provider compatibility

So the system reads like:

1. resolve the agent
2. resolve session and workspace
3. prepare bootstrap and skills
4. enforce sandbox and auth constraints
5. run one actual model/tool attempt
6. persist delivery/session consequences

## `agent-command.ts` is the real ingress

`src/agents/agent-command.ts` is not a thin CLI wrapper.

It is the top-level orchestration hub for agent execution. It:

- loads runtime config and secrets
- validates the target agent and session inputs
- resolves the effective session and workspace
- refreshes or reuses the session skill snapshot
- resolves model overrides and fallback policy
- resolves transcript/session persistence
- chooses between ACP path and embedded runner path
- invokes `runAgentAttempt(...)`
- delivers the result and updates session store state

This means OpenClaw's practical runtime boundary is not `pi-embedded-runner/` alone.

The true command path is:

- `agent-command.ts`
- `command/*`
- `pi-embedded-runner/*` or ACP

## `command/` is execution support, not the runtime itself

`src/agents/command/` contains support layers used by `agent-command.ts`:

- `attempt-execution.ts`
  - bridges orchestration into actual CLI/embedded execution
  - handles transcript persistence, fallback retry prompt behavior, ACP transcript persistence
- `session.ts`
  - resolves session key, session id, store path, rollover, persisted thinking/verbose state
- `run-context.ts`
  - normalizes channel/account/group/thread context for the current run
- `delivery.ts`
  - handles how results are returned outward

So `command/` is the orchestration support package around a run, not the core execution engine.

## `agent-scope.ts` is the agent-definition resolver

`src/agents/agent-scope.ts` answers:

- which agent ids exist
- which one is default
- which config applies to this agent
- what workspace, agentDir, model, heartbeat, skills, sandbox, tools, identity, and subagent settings are effective

This file is important because it shows OpenClaw treats agent definition as a first-class subsystem concern.

It does not bury workspace or skill resolution in the runner.

It resolves the effective agent shape before the run.

## `workspace.ts` owns the bootstrap contract

`src/agents/workspace.ts` is more than a directory helper.

It owns the agent-local bootstrap surface:

- default workspace location
- recognized bootstrap files like `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, `MEMORY.md`
- template seeding
- guarded workspace file reads
- workspace setup state

This is a key OpenClaw pattern:

- agent behavior is partly shaped by durable workspace files
- bootstrap is a real substrate, not just a prompt string concatenation trick

## `bootstrap-hooks.ts` is an extension seam, not a separate architecture layer

`src/agents/bootstrap-hooks.ts` allows internal hook handlers to rewrite the bootstrap file set before injection.

That means OpenClaw does not fork bootstrap logic into many separate systems.

Instead, it:

- keeps bootstrap ownership in `workspace.ts`
- exposes a narrow hook seam for mutation

This is an important pattern for openboa:

- keep the owner local
- expose narrow mutation seams
- do not spread ownership across multiple top-level subsystems

## `skills/` is discovery, gating, filtering, and prompt packaging

The `src/agents/skills/` subtree is not a generic “capability layer.”

It specifically owns:

- loading skills safely from filesystem roots
- frontmatter parsing
- precedence between workspace, managed/user, bundled, and plugin roots
- eligibility filtering
- runtime snapshotting and refresh
- serialization into prompt-friendly form

Important observations from source:

- `local-loader.ts`
  - loads only safe `SKILL.md` entries under verified roots
- `workspace.ts`
  - aggregates workspace, managed, bundled, plugin skills
  - applies config and eligibility filters
  - produces prompt-usable snapshots
- `runtime-config.ts`
  - resolves the current runtime config snapshot, not just static config
- `filter.ts`
  - keeps skill filters normalized and comparable for session snapshot reuse

So in OpenClaw:

- `skills/` is **skill loading infrastructure**
- it is not the same thing as runtime loop logic
- it is not the same thing as tools

## `sandbox/` is a real execution boundary subsystem

`src/agents/sandbox/` is much heavier than a few path guards.

From source it owns:

- config resolution
- backend registration and lookup
- workspace mirroring and skill sync into sandbox workspace
- filesystem bridges
- registry/pruning/runtime status
- browser sidecar handling
- tool allow/deny rules for sandboxed runs

Important observations:

- `context.ts`
  - resolves whether a run is sandboxed
  - prepares sandbox workspace layout
  - syncs eligible skills into sandbox workspace when needed
  - provisions the backend and returns fs bridge + runtime context
- `config.ts`
  - merges global and agent-specific sandbox config
  - resolves scope, workspace access, docker/ssh/browser/prune config
  - folds sandbox tool policy into the result
- `backend.ts`
  - registers concrete backends like `docker` and `ssh`
  - keeps backend registration separate from higher runtime logic
- `tool-policy.ts`
  - resolves effective allow/deny rules with explicit provenance

So sandbox in OpenClaw is:

- not merely “safety policy”
- not merely “docker”
- but a complete execution-boundary subsystem

## `auth-profiles/` is a reusable credential-state machine

`src/agents/auth-profiles/` is not just oauth helpers.

It is a credential-selection and health subsystem.

From source it owns:

- persisted auth profile store
- provider/profile ordering
- cooldown and failure tracking
- oauth and external auth syncing
- per-session auth overrides
- doctor/repair/display helpers

Important observations:

- `auth-profiles.ts`
  - intentionally exports a public facade over many smaller files
- `order.ts`
  - resolves eligible profiles
  - applies provider matching, mode matching, credential validity, cooldown handling, and ordering policy
  - prefers explicit order when present but still demotes cooled-down credentials

So auth in OpenClaw is:

- a runtime reliability layer
- not just a login convenience

## `pi-embedded-runner/` is the actual turn engine

This subtree is where the heavy turn execution happens.

Important observations:

- `run.ts`
  - orchestrates one embedded run
  - sets queue lanes
  - resolves workspace fallback
  - ensures runtime plugins and model config
  - resolves auth profile ordering and fallback behavior
  - delegates the actual attempt to `run/attempt.ts`
- `run/attempt.ts`
  - is the deepest execution assembly layer
  - resolves sandbox context
  - resolves embedded run skill entries
  - prepares session manager, tools, bootstrap injection, system prompt, context engine, stream strategy, compaction behavior, tool normalization, and transcript policies
  - then performs the actual attempt

This tells us something critical:

OpenClaw separates:

- orchestration ingress
- attempt assembly
- model/tool execution

It does not flatten them into one file, but it also does not treat them as unrelated layers.

## `pi-embedded-helpers/` is support code for the runner, not a second runtime

`src/agents/pi-embedded-helpers/` mostly contains:

- bootstrap shaping helpers
- provider-specific error handling
- thinking and turn helpers
- dedupe helpers

This is not a peer subsystem to the runner.

It is support code for keeping the embedded runner readable and provider-compatible.

## `pi-hooks/` is runtime maintenance and guardrails

The `src/agents/pi-hooks/` subtree is not general business hooks.

From source, it is tightly focused on:

- compaction safeguards
- compaction instruction shaping
- context pruning runtime helpers
- session-manager runtime registries for hook-time state

This means hooks in OpenClaw are used to:

- preserve runtime quality
- manage compaction/pruning safety
- inject narrow lifecycle behavior

They are not the main orchestration engine.

## `schema/` is provider-compat schema normalization

The `src/agents/schema/` subtree is very small.

It is not an app-domain schema layer.

From source, it mainly does:

- safe `TypeBox` enum/schema helpers
- provider-specific schema cleaning such as Gemini compatibility normalization

So `schema/` is about tool-schema portability and provider quirks, not product-domain meaning.

## The real OpenClaw agents flow

The most faithful reading of the source is:

1. `agent-command.ts`
   - accept and normalize a run request
2. `agent-scope.ts`
   - resolve the effective agent definition
3. `command/session.ts`
   - resolve the session identity and persistence surface
4. `workspace.ts` + bootstrap files
   - prepare the agent-local bootstrap substrate
5. `skills/`
   - resolve eligible skill knowledge and prompt packaging
6. `sandbox/`
   - resolve whether execution is constrained and how
7. `auth-profiles/`
   - choose usable credentials for the provider path
8. `pi-embedded-runner/run.ts`
   - orchestrate one embedded turn
9. `pi-embedded-runner/run/attempt.ts`
   - assemble and execute the attempt
10. `command/*`
   - persist session/delivery consequences

## What this means for openboa

Before designing add-on layers, we should preserve these facts:

- OpenClaw keeps almost everything under one coherent `agents` subsystem
- `agent-command.ts` is the practical runtime ingress
- `skills/` is loading/gating infrastructure, not the same thing as tools or capabilities
- `sandbox/` is a first-class execution-boundary subsystem
- `auth-profiles/` is part of runtime reliability, not a side helper
- `pi-hooks/` and `schema/` are support seams, not top-level product layers
- the embedded runner is deep because actual attempt assembly is deep

So if openboa wants to stay close to OpenClaw, the right question is not:

- "What new top-level layer should we invent?"

It is:

- "Which openboa-specific additions belong inside the same `agents` subsystem, and at which seam?"
