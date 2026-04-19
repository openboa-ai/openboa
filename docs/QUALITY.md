---
title: "Quality Canon"
summary: "Stable quality thresholds, severity language, and final-signoff expectations for autonomous PR work."
---
# Quality Canon


This page is the stable quality canon for autonomous project work in this repository.

Workers should use this page to decide whether a PR should continue looping, move to final signoff,
or be discarded.

## Ship bar

A PR is not done when it first works.
A PR is done when the relevant quality gap is closed well enough to justify final signoff.

## Functional severity definitions

- `critical`
  - the primary flow is broken, unsafe, or misleading
- `high`
  - the feature technically exists but cannot be trusted for normal use
- `medium`
  - the core flow works but important friction, inconsistency, or missing resilience remains
- `low`
  - polish-only gap that does not change trust in the result

## Runtime and reliability expectations

- targeted checks must be green
- no known high-severity regressions may remain open
- retries and failure paths should remain believable when they are part of the scoped feature

## UI quality expectations

- hierarchy should be understandable at a glance
- spacing and density should support fast scanning
- interaction cues should make state and actions legible
- UI work is not ready if it still obviously needs manual taste cleanup

## Final signoff checklist

- the PR goal and acceptance criteria are met
- the relevant quality gap is explicitly recorded as closed
- latest QA judgment is acceptable
- latest UI judgment is acceptable when UI is in scope
- wiki writeback is current
- open risks are either resolved or consciously accepted

## Discard instead of continue when

- three consecutive runs fail to improve the same axis
- the next meaningful improvement is outside the current boundary
- the PR goal no longer looks worthwhile relative to the current wedge
