import { describe, expect, it } from "vitest"
import { validatePrConvention } from "../scripts/validate-pr-convention.mjs"

describe("dependency update PR conventions", () => {
  it.each([
    "build: bump the routine-npm-updates group across 1 directory with 16 updates",
    "build: bump the github-actions group across 1 directory with 4 updates",
    "build(deps): bump axios from 1.18.0 to 1.18.1",
    "build(deps-dev): bump electron from 43.5.0 to 43.5.1",
    "Bump axios from 1.18.0 to 1.18.1",
  ])("accepts configured and legacy Dependabot title: %s", (title) => {
    expect(
      validatePrConvention({
        title,
        body: "Automated dependency update",
        author: "dependabot[bot]",
      }),
    ).toEqual([])
  })

  it.each(["build: ", "feat: unrelated feature", "unstructured title"])(
    "rejects invalid bot title: %s",
    (title) => {
      expect(validatePrConvention({ title, body: "", author: "dependabot[bot]" })).not.toEqual([])
    },
  )

  it.each(["contributor", "dependabot", "dependabot[bot]-other"])(
    "keeps all human body requirements for %s",
    (author) => {
      expect(validatePrConvention({ title: "build: bump dependencies", body: "", author })).toEqual(
        [
          "Missing section: ## Summary",
          "Missing section: ## Checklist",
          "Missing section: ## Validation",
          "Missing section: ## Related",
        ],
      )
    },
  )
})
