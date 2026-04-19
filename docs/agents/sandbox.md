---
title: "Agent Sandbox"
summary: "Provision-and-execute boundary for local session resources and tool work."
---

The sandbox is the execution boundary for session-attached resources and tool work.

Use this page when you want to answer:

- what the execution hand can actually do
- how mount boundaries affect file and shell work
- why the shell surface is bounded the way it is
- what the sandbox owns versus what tools own

Its public contract is intentionally small:

```ts
provision(resources)
describe()
execute(name, input)
```

## Why this abstraction matters

The sandbox should be replaceable.

Today it is local-only.
Later it may be:

- a remote container
- a cloud worker
- another isolated executor

If the rest of the runtime depends only on `provision` and `execute`, that swap stays tractable.

## Current implementation

The current implementation is:

- local
- workspace-backed
- resource-aware
- path-scoped by provisioned mounts

Today that means the sandbox can behave like a bounded filesystem hand instead of a fake echo layer.

Current named actions include:

- `list_dir`
- `read_text`
- `write_text`
- `append_text`
- `replace_text`
- `mkdir`
- `stat`
- `find_entries`
- `glob_entries`
- `grep_text`
- `run_command`
- `run_shell`
- `inspect_persistent_shell`
- `open_persistent_shell`
- `exec_persistent_shell`
- `close_persistent_shell`
- `inspect`

The important constraint is that these actions only work inside provisioned mounts such as:

- `/workspace`
- `/workspace/agent`
- `/runtime`
- `/memory/learnings`
- `/vaults/<name>`

The writable session hand also includes `.openboa-runtime/` guides inside `/workspace`:

- `session-runtime.md`
- `session-runtime.json`
- `managed-tools.json`
- `permissions.json`
- `environment.json`
- `agent-setup.json`
- `agent-setup.md`
- `skills.json`
- `vaults.json`
- `session-status.json`
- `outcome.json`
- `outcome-grade.json`
- `outcome-grade.md`
- `outcome-evaluation.json`
- `outcome-evaluation.md`
- `outcome-evaluations.json`
- `outcome-evaluations.md`
- `outcome-repair.md`
- `event-feed.json`
- `event-feed.md`
- `wake-traces.json`
- `shell-state.json`
- `shell-history.json`
- `shell-history.md`
- `shell-last-output.json`
- `shell-last-output.md`

These files materialize the current session, recent event feed, wake traces, active outcome, deterministic outcome grade, the current evaluator verdict, recent evaluator iterations, the current outcome-repair recommendation, environment, mounted resource, managed tool, permission, skills, and vault contract inside the filesystem itself so the agent can inspect its mounted hand without relying only on prompt text.
For the shell hand specifically, the runtime catalog materializes shell env key summaries rather than raw env values, while the execution hand still uses the full durable shell state internally.

Anything outside mounted roots is denied.
Anything mounted read-only is readable but not writable.
Vault mounts are stricter: ordinary content reads and grep-style content search are blocked so raw secrets are not echoed back through the normal file loop.
Write actions on the same mounted root are also serialized with a local advisory lease, so concurrent same-agent sessions do not blindly mutate the same workspace at once.

`run_command` is a bounded non-shell command hand.
It runs with `shell: false`, a working directory inside a writable mounted root such as `/workspace`, and a timeout.
It also receives only a minimal explicit environment instead of inheriting the full host process environment.
When vault mounts are involved, `run_command` is further restricted to structure-only commands such as `pwd` and `ls` so the runtime does not dump secret file contents through ordinary command output.
`run_shell` is the writable one-shot shell hand.
It is restricted to writable execution mounts such as `/workspace`, runs under an advisory write lease, and is meant to sit behind a higher-level confirmation policy.
The runtime also now exposes a session-scoped persistent shell process through:

- `inspect_persistent_shell`
- `open_persistent_shell`
- `exec_persistent_shell`
- `close_persistent_shell`

At the managed-tool layer this is paired with:

- `shell_open`
- `shell_restart`
- `shell_exec`
- `shell_close`

This is still not a persistent PTY-backed shell session, but it now gives the session execution hand both:

- bounded read-only command inspection via `run_command`
- permission-gated one-shot writable shell composition via `run_shell`
- permission-gated multi-step shell continuity via the persistent shell actions

The runtime pairs both with a durable session-scoped shell state and a small recent-command history, including bounded output previews and durable `commandId` values, so future commands can continue from the last chosen cwd without losing immediate shell continuity.
The persistent shell metadata is also mirrored into `.openboa-runtime/shell-state.json`, `.openboa-runtime/shell-history.md`, and `.openboa-runtime/shell-last-output.md`, while `shell_describe` prefers live process introspection for the current session so stale runtime memory does not misreport an already-closed shell.
That live metadata now includes whether the shell is `busy` and which `currentCommand` is still running, so the runtime can treat a long-lived shell command as an active hand instead of guessing from stale summaries.
When the live shell is busy, `shell_describe` also returns a `busyPlan` that points the model at `shell_wait` first, exposes `shell_read_last_output` as the bounded evidence step, and enumerates the safe read-first tools that can still run while the shell mutation hand is occupied.
That same live metadata now includes partial stdout/stderr preview for the running command, so read-first inspection can use current evidence instead of only durable last-command state.
If the live process is gone, `shell_describe` now returns a `recoveryPlan` that tells the model whether it should call `shell_restart` or `shell_open` next.

`glob_entries` is the low-level path-matching primitive behind the higher-level `glob` managed tool.
`grep_text` also supports optional regex mode for the higher-level `grep` managed tool.

`sandbox_describe` should be treated as the source of truth for the hand's current contract.
It returns:

- mounted resources
- explicit constraints
- action-level access hints
- command policy details such as the allowlisted read-only commands and exposed environment keys

The current read-only command allowlist is intentionally small but practical:

- file and directory listing or reads (`ls`, `cat`, `head`, `tail`, `wc`)
- workspace/path introspection (`pwd`, `basename`, `dirname`, `realpath`)
- environment inspection (`env`)

The shared substrate mount at `/workspace/agent` is intentionally read-only through normal sandbox actions.
If a durable substrate file should be edited, stage it into `/workspace` with `resources_stage_from_substrate`, compare it with `resources_compare_with_substrate`, then promote the chosen result back with `resources_promote_to_substrate`.

The shared learnings mount at `/memory/learnings` is also read-only through the sandbox hand.
Cross-session learnings should be promoted through the runtime learning capture path, not rewritten ad hoc through filesystem actions.

That is enough for the current session-first runtime frontier.

The important mental model is:

- tools describe intent and policy
- the sandbox performs bounded execution inside the current environment and mounts

If those are mixed together, execution policy becomes harder to reason about.

## Relationship to resources

The sandbox does not invent resources.
It receives `ResourceAttachment[]` and provisions them.

That keeps the boundary clear:

- session owns the list of attached resources
- environment defines the reusable execution substrate
- sandbox turns those into an executable runtime context

## Relationship to tools

The sandbox is not the tool registry.

Tools define:

- name
- description
- schema
- ownership
- permission policy

The sandbox only executes within the current environment boundary.

## Current non-goals

The current sandbox layer does not yet try to be:

- a PTY-backed terminal emulator
- a cloud container runtime
- a full network policy engine
- a secret distribution system
- a multi-tenant production isolation layer

Those are future concerns.
The current goal is a durable, explicit local contract.

## Related reading

- [Agent Runtime](../agent-runtime.md)
- [Agent Environments](./environments.md)
- [Agent Resources](./resources.md)
- [Agent Tools](./tools.md)
