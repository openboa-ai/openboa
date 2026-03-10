import { describe, expect, it } from "vitest"

import { validateCiExceptions, validateCodeowners } from "../scripts/validate-ci-policy.mjs"

describe("ci policy validator", () => {
  it("accepts a non-placeholder CODEOWNERS file", () => {
    expect(() => validateCodeowners("* @SonSangjoon\n")).not.toThrow()
  })

  it("rejects the placeholder CODEOWNERS owner", () => {
    expect(() => validateCodeowners("* @<owner-or-team>\n")).toThrow(/placeholder/)
  })

  it("accepts an empty exception registry with a valid SLA", () => {
    expect(() =>
      validateCiExceptions(
        {
          slaDays: 14,
          exceptions: [],
        },
        new Date("2026-03-10T00:00:00Z"),
      ),
    ).not.toThrow()
  })

  it("rejects exceptions without an owner", () => {
    expect(() =>
      validateCiExceptions(
        {
          slaDays: 14,
          exceptions: [
            {
              id: "detect-secrets-baseline",
              openedOn: "2026-03-01",
              expiresOn: "2026-03-10",
              reason: "Waiting for upstream scanner tuning.",
              trackingIssue: "#28",
            },
          ],
        },
        new Date("2026-03-05T00:00:00Z"),
      ),
    ).toThrow(/owner/)
  })

  it("rejects exceptions that exceed the SLA", () => {
    expect(() =>
      validateCiExceptions(
        {
          slaDays: 14,
          exceptions: [
            {
              id: "codeql-noise",
              owner: "@SonSangjoon",
              openedOn: "2026-03-01",
              expiresOn: "2026-03-20",
              reason: "Tracking a temporary false positive while rules are tuned.",
              trackingIssue: "#28",
            },
          ],
        },
        new Date("2026-03-05T00:00:00Z"),
      ),
    ).toThrow(/14-day exception SLA/)
  })

  it("rejects expired exceptions", () => {
    expect(() =>
      validateCiExceptions(
        {
          slaDays: 14,
          exceptions: [
            {
              id: "gitleaks-noise",
              owner: "@SonSangjoon",
              openedOn: "2026-03-01",
              expiresOn: "2026-03-05",
              reason: "Temporary allowlist while test fixtures are narrowed.",
              trackingIssue: "#28",
            },
          ],
        },
        new Date("2026-03-10T00:00:00Z"),
      ),
    ).toThrow(/expired/)
  })
})
