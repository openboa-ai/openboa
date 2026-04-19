import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { findAgentImportBoundaryViolations } from "../scripts/check-agent-boundary.mjs"

const REPO_ROOT = resolve(import.meta.dirname, "..")

describe("agent import boundary", () => {
  it("allows agents to import only agents or foundation modules via relative imports", async () => {
    const violations = await findAgentImportBoundaryViolations({ repoRoot: REPO_ROOT })
    expect(violations).toEqual([])
  })
})
