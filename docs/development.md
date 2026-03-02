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
</CardGroup>

## Git Hooks (pre-commit)

This repository uses a git pre-commit hook via `.githooks/pre-commit`.

- Hook path: `core.hooksPath=.githooks`
- Always runs: `pnpm check:docs`
- Runs for code-related staged changes: `pnpm check`

If `pnpm` is missing, commits are blocked with install guidance.

## Recommended Workflow

<Steps>
  <Step title="Align on intent">
    Start from [Introduction](/introduction) and relevant concept/help pages.
  </Step>
  <Step title="Implement changes">
    Keep scope small and prefer incremental changes with clear commit boundaries.
  </Step>
  <Step title="Validate locally">
    Run `pnpm check` for code changes and docs checks for documentation changes.
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
