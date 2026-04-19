---
name: auto-loop-protocol
description: Shared keep-discard loop for project harness work. Use when a worker must establish a baseline, try one bounded change, measure it, and decide whether to keep or discard the result.
---

# Auto Loop Protocol

Every worker follows the same loop:

1. establish a baseline
2. choose one bounded hypothesis
3. make one bounded change
4. measure with explicit evidence
5. keep only if better
6. discard or revert if not better
7. return control to `auto-project`

The goal is not to finish an assigned task.
The goal is to close the relevant quality gap for the current PR.

Continue until one of these is true:

- the targeted quality axis is clearly improved enough
- the work should be rerouted
- diminishing returns are explicit

Guardrails:

- never accumulate speculative changes
- never claim improvement without evidence
- never self-schedule indefinitely
- never widen scope during a run
