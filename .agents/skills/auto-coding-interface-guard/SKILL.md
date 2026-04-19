---
name: auto-coding-interface-guard
description: Interface and boundary guard for project harness coding work. Use inside `auto-coding` when a fix risks widening APIs, module boundaries, or ownership surfaces beyond the current PR frontier.
---

# Auto Coding Interface Guard

Stop and reroute when:

- the fix changes the declared boundary
- the next correct change is architectural, not local
- the PR page no longer matches reality
