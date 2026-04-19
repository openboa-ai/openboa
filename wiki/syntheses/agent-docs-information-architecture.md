# Agent Docs Information Architecture

This note defines how the public `Agent` docs should be structured so the runtime is understandable without forcing the reader to reverse-engineer the codebase.

## Why this synthesis exists

The previous Agent docs accreted by adding sections wherever a new runtime feature landed.

That created three problems:

- concept and reference material overlapped
- bootstrap, runtime, and architecture blurred together
- the reading order was not obvious

The result was technically correct but hard to read.

The fix is not "write more."
The fix is to separate document responsibilities and enforce a stable reading order.

## Design rule

The public Agent docs should teach the runtime in this order:

1. meaning
2. capabilities
3. runtime contract
4. durable steering substrate
5. internal architecture
6. detailed reference surfaces

If those layers are mixed, the reader is forced to learn the runtime backwards from low-level details.

## Target page responsibilities

### `docs/agents/index.md`

Role:

- navigation hub for the Agent docs
- one place that tells the reader what to read first and why

It should not:

- redefine the full runtime
- duplicate detailed reference content

### `docs/agent.md`

Role:

- explain what the Agent layer is
- explain why it exists
- state what belongs inside and outside the layer

It should not:

- become a raw tool catalog
- become a deep code map

### `docs/agents/capabilities.md`

Role:

- explain what the runtime can do and why those capabilities exist

Current capability set:

- session-first truth
- proactive revisits
- learning
- retrieval and reread
- filesystem-native execution
- safe shared improvement
- outcome-evaluated improvement

It should not:

- repeat full CLI or storage references

### `docs/agent-runtime.md`

Role:

- explain the operating contract
- explain one bounded wake
- explain runtime objects, artifacts, proactive, learning, retrieval, and promotion loops

It should not:

- become the main architecture page
- duplicate bootstrap file-by-file meaning

### `docs/agents/bootstrap.md`

Role:

- explain bootstrap substrate
- explain why bootstrap exists as files
- explain how `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, and `MEMORY.md` are assembled

It should not:

- absorb all mount or runtime artifact semantics

### `docs/agents/architecture.md`

Role:

- explain the internal structure
- explain layer map, storage model, mount topology, retrieval loop, promotion loop, and code map

It should not:

- restate the entire meaning of the Agent layer

### Reference pages

Role:

- answer precise questions about one seam

Current reference set:

- `sessions.md`
- `environments.md`
- `resources.md`
- `harness.md`
- `sandbox.md`
- `tools.md`

They should not:

- redefine the whole Agent model
- become entry pages

## Reading order contract

The public reading order should be:

1. `Agent Hub`
2. `Agent`
3. `Agent Capabilities`
4. `Agent Runtime`
5. `Agent Bootstrap`
6. `Agent Architecture`
7. reference pages as needed

This order reflects how a human actually learns the runtime:

- what it is
- what it can do
- how it operates
- what durable files steer it
- how it is built
- where to look for seam-specific details

## Boundary rules

### Agent docs should avoid leading with upper layers

Inside the Agent docs, upper-layer names should stay out of the central explanation.

Use:

- `application-specific routing`
- `external publication semantics`
- `broader domain truth`

instead of repeatedly naming product surfaces in the middle of Agent docs.

### Agent docs should stay concrete

Agent docs should describe:

- where the Agent works
- where it remembers
- where it rereads
- where it promotes

This is why pages such as `bootstrap`, `resources`, `sandbox`, and `tools` matter.

The docs should not feel like generic agent philosophy.

## OpenClaw pattern we are intentionally borrowing

The useful OpenClaw documentation pattern is:

- hub page
- concrete runtime page
- concrete workspace page
- concrete memory page
- separate reference pages

What we should borrow:

- strong page responsibility
- concrete filesystem/runtime explanations
- clear reading order

What we should not borrow blindly:

- gateway-first product framing inside Agent docs

## Near-term follow-ups

The next likely public doc additions, if the Agent runtime keeps growing, are:

- `docs/agents/workspace.md`
  - if bootstrap, resources, and runtime-artifact explanations remain too split
- `docs/agents/memory.md`
  - if learn store, `MEMORY.md`, runtime memory, and promotion remain too scattered
- `docs/agents/context.md`
  - if retrieval, context pressure, and session reread need a clearer single home

Those are not justified just by naming.
They should only be added when the existing pages can no longer explain those concerns cleanly.
