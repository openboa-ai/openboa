---
title: "Docs Troubleshooting"
summary: "Fix broken links, markdown issues, and docs structure drift before PR merge."
read_when:
  - Docs checks fail locally or in CI
  - You need the standard verification sequence for docs changes
---

## Quick Checks

```bash
pnpm check:docs
pnpm docs:linkcheck
cd docs && pnpm dlx mintlify broken-links
cd docs && pnpm dlx mintlify validate
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
</AccordionGroup>

## PR Checklist

<Steps>
  <Step title="Validate formatting and links">
    Run `pnpm check:docs` and `pnpm docs:linkcheck`.
  </Step>
  <Step title="Validate Mintlify routing and structure">
    Run `cd docs && pnpm dlx mintlify broken-links` and `cd docs && pnpm dlx mintlify validate`.
  </Step>
  <Step title="Spot check key navigation paths">
    Confirm [Docs Portal](/), [FAQ](/help/faq), and [Business as Agent](/concepts/business-as-agent) are reachable.
  </Step>
</Steps>
