---
title: "Agent Environments"
summary: "Reusable execution substrates for sessions, with a local-only implementation in the current runtime."
---
# Agent Environments


`Environment` is the reusable execution substrate definition for a session.

The current runtime keeps environments deliberately small and explicit.

Use this page when you want to answer:

- what an environment owns
- why a session references an environment instead of embedding it
- how execution substrate differs from agent definition and session truth

## Why environments exist

An environment answers:

- where does this session execute
- what sandbox posture applies
- what default workspace mounts should exist

The important design rule is:

- a session references an environment
- a session does not embed the whole environment definition

That allows many sessions to reuse one environment definition.

This page is intentionally narrow.

It is not the place to explain:

- the session lifecycle
- the writable workspace hand
- the shared substrate

Those are separate runtime surfaces with their own pages.

## Current shape

The current environment contract includes:

- `id`
- `name`
- `kind: "local"`
- `sandbox`
- `workspaceMountDefaults`
- `createdAt`
- `updatedAt`

The default local environment currently carries:

- workspace access mode
- network access mode
- package policy
- default mount paths for workspace and runtime directories

## Current implementation

Today openboa ships only:

- `kind: "local"`

This is intentional.
The current frontier is to stabilize the public contract before adding cloud containers or remote executors.

## Storage

Reusable environment definitions live under:

```text
.openboa/environments/<environment-id>.json
```

During setup, openboa seeds:

- `local-default`

That means sessions can be created without a separate environment bootstrap step.

## Session relationship

A session stores:

- `environmentId`

At runtime:

1. the session is loaded
2. the environment definition is loaded
3. resources are provisioned against that environment
4. the harness runs

This keeps the session small and the environment reusable.

## What does not belong here

The environment is not:

- the agent definition
- the provider model choice
- a full session snapshot

It is only the execution substrate.

## Future shape

This contract is intentionally open to later additions such as:

- remote containers
- cloud workers
- richer network policy
- package/image pinning
- vault-aware provisioning

Those can all evolve without changing the session-first public runtime model.

## Related reading

- [Agent Runtime](../agent-runtime.md)
- [Agent Sessions](./sessions.md)
- [Agent Sandbox](./sandbox.md)
- [Agent Resources](./resources.md)
