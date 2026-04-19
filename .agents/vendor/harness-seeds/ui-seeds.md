# UI Seeds

This vendored note distills external UI iteration patterns that `auto-ui` uses.

Use these ideas, not their source names:

- component discipline, layout hierarchy, reusable primitives, and accessible defaults
- runtime truth should come from a real browser session and screenshots, not imagination
- avoid visual polish that regresses responsiveness or load behavior
- UI changes still need explicit quality gates and evidence

Shape inside the generic harness:

- `auto-ui` starts from live screenshots, not from abstract preference
- it changes one visual variable at a time
- it keeps only changes that improve hierarchy, density, spacing, alignment, or navigation clarity
- it does not widen product or contract scope; wider changes hand back to `auto-pm`
