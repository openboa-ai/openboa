---
name: auto-coding-recovery-loop
description: Recovery specialist for project harness coding work. Use inside `auto-coding` when a bounded implementation attempt fails verification and must be fixed forward or reverted cleanly.
---

# Auto Coding Recovery Loop

Rules:

- prefer revert over speculative patch stacks
- keep the recovery bounded to the same hypothesis
- if the correct fix widens scope, hand back to `auto-project`
