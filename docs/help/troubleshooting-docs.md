---
title: "Docs Troubleshooting"
summary: "Fix broken links, markdown issues, and docs structure drift before PR merge."
read_when:
  - Docs checks fail locally or in CI
  - You need the standard verification sequence for docs changes
---
# Docs Troubleshooting


## Quick Checks

```bash
pnpm check:docs
pnpm docs:linkcheck
pnpm docs:validate
```

<Note>
Run checks from the repository root unless the command explicitly changes into `docs`.
</Note>

## Common Issues

<AccordionGroup>
  <Accordion title="Broken relative links">
Symptom: link checker reports missing files.

Fix: Ensure links target valid Mintlify routes (`/path`), keep routes aligned with `docs/docs.json` navigation, and remove stale paths after page rename or move.
  </Accordion>
  <Accordion title="Missing page in navigation">
Symptom: page exists but does not appear in docs sidebar/tab structure.

Fix: Add the page route to `docs/docs.json` and re-run `mintlify validate` to confirm structure integrity.
  </Accordion>
  <Accordion title="Markdown lint failures">
Symptom: `pnpm check:docs` fails on format or heading rules.

Fix: Follow linter output line-by-line, keep heading hierarchy and list formatting consistent, and prefer native Mintlify components over custom HTML blocks.
  </Accordion>
  <Accordion title="Mintlify build validation failure">
Symptom: `mintlify validate` fails despite passing markdown lint.

Fix: Check unsupported component syntax, verify tab/group/page mapping in `docs/docs.json`, and confirm all route links point to existing docs pages.
  </Accordion>
  <Accordion title="Page loads with a Mintlify 500 error">
Symptom: the route exists, but Mintlify shows `Page not found!` and an unexpected error page.

Fix: Reduce the page to standard Mintlify frontmatter (`title`, `summary`) plus supported Markdown or Mintlify components, then run `pnpm docs:routecheck --base-url <preview-or-site-url>` so you validate real route rendering instead of static checks only.
  </Accordion>
</AccordionGroup>

## PR Checklist

<Steps>
  <Step title="Validate formatting and links">
    Run `pnpm check:docs` and `pnpm docs:linkcheck`.
  </Step>
  <Step title="Validate Mintlify routing and structure">
    Run `pnpm docs:validate`.
  </Step>
  <Step title="Smoke test real route rendering when debugging 500s">
    Run `pnpm docs:routecheck --base-url http://localhost:3000` against a local preview, or point it at the deployed docs host.
  </Step>
  <Step title="Spot check key navigation paths">
    Confirm [Docs Portal](../index.md), [FAQ](./faq.md), and [Business of Agents](../concepts/business-of-agents.md) are reachable.
  </Step>
</Steps>
