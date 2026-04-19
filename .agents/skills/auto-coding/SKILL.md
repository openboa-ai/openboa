---
name: auto-coding
description: Project harness implementation worker. Use when a PR frontier is locked and the next step is to improve correctness, runtime behavior, reliability, architecture, or CI through one bounded code hypothesis at a time until the runtime bar is met.
---

# Auto Coding

`auto-coding` is the runtime and correctness worker.

It optimizes for:

- correctness
- runtime behavior
- reliability
- architecture quality
- CI health

It stops only when:

- the runtime or correctness gap is closed for the current PR, or
- the next meaningful improvement must be rerouted, or
- diminishing returns have been made explicit

It may edit UI files, but only when behavior or runtime quality is the target.

It must:

1. establish a code baseline
2. change one bounded variable
3. run the relevant checks
4. keep or revert
5. hand back to `auto-project`

Use companion skills:

- `auto-coding-implement-loop`
- `auto-coding-test-loop`
- `auto-coding-recovery-loop`
- `auto-coding-ci-loop`
- `auto-coding-interface-guard`
