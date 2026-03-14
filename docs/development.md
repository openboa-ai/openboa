---
title: "Development"
summary: "Core commands and baseline workflow for contributing to openboa."
read_when:
  - You are implementing changes in this repository
  - You want a consistent local quality-check workflow
---

Use this page as the baseline development contract for local work.

## Core Commands

<CardGroup cols={2}>
  <Card title="Run runtime entry">
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
    ```
  </Card>
  <Card title="Queue latency gate">
    ```bash
    pnpm check:queue-latency
    ```
  </Card>
</CardGroup>

## MVP Queue-Latency Fixture

Issue `#36` adds a deterministic evidence path for queue-latency readiness:

- fixture spec: `config/queue-latency-fixture.json`
- regression log: `test/fixtures/queue-latency-regression.jsonl`
- calculator: `scripts/check-queue-latency.mjs`

The gate measures `task_enqueued_at -> first_worker_ack_at` in UTC JSONL records and exits non-zero when either:

- rolling-window p95 exceeds `3000ms`
- full-run p95 exceeds `3000ms`

## Git Hooks (pre-commit)

This repository uses a mandatory v1 pre-commit profile via `.pre-commit-config.yaml`.

- Hard-block baseline: repository hygiene hooks + `pnpm precommit:check`
- `pnpm precommit:check` runs:
  - `pnpm format:check`
  - `pnpm lint`
  - `pnpm typecheck`
- Advisory/manual checks:
  - `pnpm test`
  - `detect-secrets`
  - `actionlint`
  - `zizmor`

Verify the mandatory baseline with:

```bash
pnpm precommit:check
```

## Merge Gate (Main PRs)

Merge-gate v1 uses `strict-required core only`.

- Required statuses: `ci / required-ci`, `PR Convention / convention`
- Advisory statuses: `codeql / analyze (javascript-typescript)` and the individual `ci` sub-jobs
- Canonical policy: see [Contributing](/contributing#merge-gate-check-matrix-v1)

If a required check appears to be a false failure, use the documented single-PR admin bypass path in [Contributing](/contributing#temporary-bypass-path-false-failures-only). Bypasses are exceptional, auditable, and time-bounded.

## Merge Gate (Reference)

Merge-gate v1 uses `strict-required core only`.

- Required statuses: `ci / required-ci`, `PR Convention / convention`
- Advisory statuses: `codeql / analyze (javascript-typescript)` and the individual `ci` sub-jobs
- Canonical policy: see [Contributing](/contributing#merge-gate-check-matrix-v1)

If a required check appears to be a false failure, use the documented single-PR admin bypass path in [Contributing](/contributing#temporary-bypass-path-false-failures-only). Bypasses are exceptional, auditable, and time-bounded.

## Recommended Workflow

<Steps>
  <Step title="Align on intent">
    Start from [Introduction](/introduction) and relevant concept/help pages.
  </Step>
  <Step title="Implement changes">
    Keep scope small and prefer incremental changes with clear commit boundaries.
  </Step>
  <Step title="Validate locally">
    Run `pnpm precommit:check` before commit, then `pnpm check` when you need the full code gate.
  </Step>
  <Step title="Validate Mintlify structure">
    ```bash
    cd docs && pnpm dlx mintlify validate
    ```
  </Step>
</Steps>

## Related Pages

- [Quickstart](/quickstart)
- [Business as Agent](/concepts/business-as-agent)
- [Docs Troubleshooting](/help/troubleshooting-docs)
