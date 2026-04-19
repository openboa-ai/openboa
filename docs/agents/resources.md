---
title: "Agent Resources"
summary: "Session-attached resources, mount semantics, and the boundary between session-local state and agent-level memory."
---

`ResourceAttachment` is how a session sees durable inputs.

This is an important shift in mental model:

- not everything should become prompt text
- not everything should become global memory
- many useful inputs should instead be attached resources

Use this page when you want to answer:

- which durable things should be mounted instead of pasted into prompt text
- what belongs to the session hand versus the shared substrate
- how writeback and promotion work without direct shared mutation

## Current resource kinds

The current public kinds are:

- `session_workspace`
- `agent_workspace_substrate`
- `local_file`
- `learnings_memory_store`
- `session_runtime_memory`
- `vault`

Reserved for later:

- `remote_file_store`
- `repo_mount`

## Default resources

Every new session automatically receives default local resources:

- the session execution workspace
- the shared agent workspace substrate
- the agent learnings store
- the session runtime directory
- any discovered vault mounts under `.openboa/vaults/`

The writable session hand also materializes a runtime catalog under `/workspace/.openboa-runtime/` so the agent can inspect its current environment, mounted resources, protected vaults, available skills, managed tool contract, active outcome, current deterministic outcome grade, current context budget, recent event stream, and wake traces from the filesystem itself.

The shared substrate also contains the Agent bootstrap files that define durable local steering:

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`
- `MEMORY.md`

Read [Agent Bootstrap](./bootstrap.md) for the purpose and loading model of those files.

That gives the harness:

- shared agent substrate
- isolated execution hand
- shared agent-level lessons
- isolated per-session continuity

## Why learnings are mounted as a resource

The learnings store is not only a hidden database detail.
It is mounted as a resource because it is part of the Agent's durable operating surface.

That means:

- learnings are reusable across sessions
- learnings are inspectable through the same runtime model as other resources
- learnings are not confused with session-local scratch state

This is an important design choice.
If learnings lived only inside prompt text or only inside one session checkpoint, the Agent would not have a clean long-term improvement surface.

## Why this split matters

The most important distinction is:

- **session-local**
  - runtime scratch state
  - session-specific checkpointing
  - session-specific working buffer
  - writable execution workspace
- **agent-level**
  - reusable learnings
  - durable workspace substrate
  - stable steering files
  - mounted for inspection, not arbitrary sandbox mutation
- **vault-protected**
  - read-only secret-bearing mounts
  - never writable through the normal sandbox hand

If those are mixed, long-lived agents become hard to reason about.

## Access model

Each resource carries:

- `sourceRef`
- `mountPath`
- `access`
- optional `metadata.prompt`

Current access values:

- `read_only`
- `read_write`

This means the resource contract is about:

- what the resource is
- where it appears in the runtime
- how writable it is
- and, when useful, how the agent should use it

not about which product layer invented it.

## Writeback path

The shared substrate mount at `/workspace/agent` is intentionally read-only inside the normal sandbox hand.

That prevents accidental mutation from arbitrary filesystem actions while still letting the Agent inspect its durable substrate.

If work produced in the writable session hand under `/workspace` should become durable shared substrate, the managed runtime now exposes:

- `resources_stage_from_substrate`
- `resources_compare_with_substrate`
- `resources_list_versions`
- `resources_read_version`
- `resources_restore_version`
- `resources_promote_to_substrate`

Those tools create the explicit edit loop:

1. stage a shared substrate file into the session hand
2. compare the staged file against the current substrate when needed
  The compare result now includes the live content hashes plus the latest recorded substrate version metadata, so the next promote can carry an explicit `expectedVersionId` precondition instead of guessing.
3. inspect prior promoted versions when substrate history matters
4. mutate it under `/workspace`
5. if a durable outcome exists, verify promotion safety through `outcome_evaluate`
6. promote the chosen result back into the shared substrate, optionally with an `expectedVersionId` or `expectedContentHash` precondition
7. if a bad promotion slipped through, restore an immutable version back into the shared substrate through `resources_restore_version`, again with optional `expectedVersionId` or `expectedContentHash` protection when current substrate drift matters and, when a durable outcome exists, the same evaluator gate that protects ordinary promotion

This keeps three roles separate:

- session execution hand
  - mutable work for the current run
- shared substrate
  - durable reusable agent files
- vault mounts
  - read-only protected material

When a durable outcome exists, shared substrate promotion is now evaluator-gated by default.
That means `resources_promote_to_substrate` expects `outcome_evaluate` to return `status=pass` before it mutates shared agent-level files, unless the caller explicitly disables that gate for one bounded exceptional case.

## Good design rule

Ask these questions in order:

1. should this be durable across sessions?
2. should it be isolated per session?
3. does the harness need it as a mounted input, or just as summarized prompt text?

If the answer is:

- durable + isolated + directly useful to execution

it probably belongs as a `ResourceAttachment`.

## Future direction

The public contract is ready for richer resources later:

- attached repositories
- remote file stores
- work-specific attached artifacts

Those should be added without changing the core meaning of `Session`.

## Related reading

- [Agent Runtime](../agent-runtime.md)
- [Agent Workspace](./workspace.md)
- [Agent Memory](./memory.md)
- [Agent Bootstrap](./bootstrap.md)
- [Agent Sessions](./sessions.md)
- [Agent Environments](./environments.md)
- [Agent Sandbox](./sandbox.md)
