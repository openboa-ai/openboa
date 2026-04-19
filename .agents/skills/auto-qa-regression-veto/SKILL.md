---
name: auto-qa-regression-veto
description: Veto specialist for project harness QA work. Use inside `auto-qa` when new defects, regressions, or unacceptable gaps mean the PR must not progress toward landing.
---

# Auto QA Regression Veto

Veto when:

- a core flow is still broken
- a regression was introduced
- acceptance criteria are not yet met

Return a defect packet with clear severity and next owner.
Include confidence and the remaining quality gap.
