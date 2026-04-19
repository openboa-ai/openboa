---
name: auto-promotion-protocol
description: Shared promotion contract for project harness PRs. Use when deciding whether a frontier can move from looping to final-signoff, ready-to-land, or should be rerouted or discarded.
---

# Auto Promotion Protocol

A PR may move to `final-signoff` only when:

- acceptance criteria are met
- the current quality gap is recorded as closed
- the latest QA pass is green
- the latest UI pass is acceptable when UI is in scope
- the latest wiki writeback is current
- there is no open safety risk

A PR may move to `ready-to-land` only when:

- final signoff is explicitly ready
- the final signoff checklist is complete
- the latest QA pass is still green
- the latest UI pass is still acceptable when UI is in scope
- the latest wiki writeback is current
- there is no open safety risk

Do not promote when:

- the latest winning run is stale
- the current owner is unclear
- regressions are open
