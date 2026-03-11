import { describe, expect, it } from "vitest"

import { validatePrConvention } from "../scripts/validate-pr-convention.mjs"

describe("pr convention validator", () => {
  it("accepts a standard human-authored PR title and body", () => {
    expect(
      validatePrConvention({
        author: "octocat",
        title: "ci: harden PR convention policy",
        body: `## Summary
- update workflow

## Checklist
- [x] tests added/updated

## Validation
- Commands run: pnpm test

## Related
- Issue/Thread/PR: #41`,
      }),
    ).toEqual([])
  })

  it("rejects a human-authored PR that omits required sections", () => {
    expect(
      validatePrConvention({
        author: "octocat",
        title: "ci: harden PR convention policy",
        body: "## Summary\n- only one section",
      }),
    ).toEqual([
      "Missing section: ## Checklist",
      "Missing section: ## Validation",
      "Missing section: ## Related",
    ])
  })

  it("accepts a dependabot bump title without template sections", () => {
    expect(
      validatePrConvention({
        author: "dependabot[bot]",
        title: "Bump vite from 7.1.10 to 7.1.11",
        body: "",
      }),
    ).toEqual([])
  })

  it("accepts a semantic dependabot dependency title without template sections", () => {
    expect(
      validatePrConvention({
        author: "dependabot[bot]",
        title: "build(deps): bump vite from 7.1.10 to 7.1.11",
        body: "",
      }),
    ).toEqual([])
  })

  it("rejects an invalid dependabot title", () => {
    expect(
      validatePrConvention({
        author: "dependabot[bot]",
        title: "docs: update vite",
        body: "",
      }),
    ).toEqual(["Dependabot PR title must match 'build(deps): ...' or 'Bump ... from ... to ...'"])
  })
})
