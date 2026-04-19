# Coding Seeds

This vendored note distills external implementation patterns that `auto-coding` uses.

Use these ideas, not their source names:

- move in thin slices, keep the diff bounded, verify after each step
- tests are proof, not decoration
- protect boundaries and avoid silent contract drift
- reproduce, localize, reduce, fix, guard
- treat CI as an extension of the local loop
- keep only improvements on the branch

Shape inside the generic harness:

- `auto-coding` works inside one PR frontier
- every attempt must be measurable against baseline checks
- only changes that improve or preserve the frontier evidence survive on the branch
- if a fix needs a wider boundary, the loop hands back to `auto-pm`
