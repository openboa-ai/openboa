---
title: "Development"
summary: "Core commands and the quality-driven PR loop used by the generic project harness in this repository."
layer: "docs"
status: "canonical"
audience: "contributors"
canonical: true
derived_from:
  - ".agents/AGENTS.md"
  - "docs/harness.md"
last_reviewed: "2026-04-09"
owner: "engineering"
review_after: "2026-05-08"
---

Use this page as the baseline development contract for local work.

## Read This First

The repository should be driven in this order:

1. repo-level operating contract in `.agents/AGENTS.md`
2. [Project Harness](./harness.md)
3. [Product Canon](./PRODUCT.md)
4. [Design Canon](./DESIGN.md)
5. [Quality Canon](./QUALITY.md)
6. `docs/README.md` for public docs structure and the active internal `wiki/` surfaces for working-state guidance
7. `wiki/frontiers.md`
8. the active `wiki/prs/PR-*.md`
9. the latest relevant `wiki/runs/RUN-*.md`
10. project-specific architecture and product docs as needed

If the active frontier touches `src/agents/`, read [Agent Runtime](./agent-runtime.md) before making changes.

## Harness Workflow

The repository follows a generic autonomous harness model:

- `auto-project` owns PR lifecycle
- `auto-pm` owns frontier definition and quality-target lock
- `auto-coding` owns behavior and runtime-gap closure
- `auto-qa` owns functional evaluation and promotion veto
- `auto-ui` owns visual and interaction-gap closure
- `auto-wiki` owns durable memory and synthesis

Practical meaning:

1. open or resume one bounded PR frontier
2. read canon docs before interpreting the frontier
3. establish a baseline before changing code
4. change one bounded variable at a time
5. measure and keep or discard the result
6. continue until the quality gap is closed or explicitly rerouted
7. record every meaningful iteration in `wiki/`
8. land only after final signoff, QA passes, UI passes when relevant, and open safety risk is zero

This repository treats repo artifacts as durable memory, not chat history.

## Required Working Surfaces

- `raw/`
  - immutable sources and evidence
- `wiki/`
  - frontier map, PR pages, run pages, chronology
- `.agents/`
  - skill behavior and operating schema
- `docs/`
  - stable explanation for humans

## PR Loop

Each PR is a bounded frontier.
Each run is one bounded hypothesis inside that PR.

Default loop:

1. `auto-pm` locks the PR goal, metric, quality target, boundary, and acceptance criteria
2. `auto-wiki` records the baseline PR page
3. `auto-coding` tries one bounded code hypothesis and closes runtime gaps
4. `auto-qa` evaluates behavior and can veto continued promotion
5. `auto-ui` evaluates and polishes the surface when UI is in scope
6. `auto-wiki` records the run, quality delta, and current gap
7. `auto-project` decides whether to continue, reroute, discard, move to `final-signoff`, or mark `ready-to-land`

## Human Gate

Humans should not micromanage normal iteration.
Humans do set direction, taste, and the final signoff bar.

Immediate escalation exists for:

- destructive history or repository operations
- secrets, privacy, security, or billing risk
- irreversible publication or release

## Core Commands

<CardGroup cols={2}>
  <Card title="Run CLI entry">
    ```bash
    pnpm dev
    ```
  </Card>
  <Card title="Run tests">
    ```bash
    pnpm test
    ```
  </Card>
  <Card title="Run full checks">
    ```bash
    pnpm check
    ```
  </Card>
  <Card title="Docs checks">
    ```bash
    pnpm check:docs
    pnpm docs:linkcheck
    pnpm docs:validate
    ```
  </Card>
  <Card title="Queue latency gate">
    ```bash
    pnpm check:queue-latency
    ```
  </Card>
</CardGroup>

## Recommended Workflow

<Steps>
  <Step title="Resume one frontier">
    Start from `.agents/AGENTS.md`, [Project Harness](./harness.md), `docs/README.md`, and the active `wiki/` surfaces.
  </Step>
  <Step title="Lock one PR">
    Create or resume one `wiki/prs/PR-*.md` page and lock its goal, metric, quality target, boundary, and acceptance criteria.
  </Step>
  <Step title="Baseline the quality gap">
    Make the current gap explicit before the next worker makes a change.
  </Step>
  <Step title="Run one bounded improvement">
    Change one bounded variable at a time. Keep only measured improvements.
  </Step>
  <Step title="Evaluate against the active axis">
    Validate the current hypothesis against runtime, QA, or UI criteria. Do not accumulate speculative changes.
  </Step>
  <Step title="Write back memory">
    Record the run in `wiki/runs/` and update the PR page before moving to the next owner.
  </Step>
  <Step title="Stop only at the right threshold">
    A PR moves to `final-signoff` only when the quality gap is closed. It moves to `ready-to-land` only after signoff readiness, latest QA, latest UI when relevant, and zero open safety risk.
  </Step>
</Steps>

## Related Pages

- [Project Harness](./harness.md)
- [Product Canon](./PRODUCT.md)
- [Design Canon](./DESIGN.md)
- [Quality Canon](./QUALITY.md)
- [Quickstart](./quickstart.md)
- [Agent Runtime](./agent-runtime.md)
- [Business as Agent](./concepts/business-as-agent.md)
- [Docs Troubleshooting](./help/troubleshooting-docs.md)
