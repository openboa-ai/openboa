---
name: auto-ui-compare-and-revert
description: Keep-discard specialist for project harness UI work. Use inside `auto-ui` to compare screenshots, decide whether the latest UI hypothesis helped, and revert if it did not.
---

# Auto UI Compare And Revert

Rules:

- compare against the baseline, not memory
- keep only when one axis clearly improves without harming another
- explain the remaining quality gap when keeping is not justified
- revert if improvement is not clear
