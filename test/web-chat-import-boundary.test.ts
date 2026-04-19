import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { findWebChatImportBoundaryViolations } from "../scripts/check-web-chat-boundary.mjs"

const REPO_ROOT = resolve(import.meta.dirname, "..")

describe("web chat import boundary", () => {
  it("keeps chat web runtime and components free of product-surface and mixed-demo imports", async () => {
    const violations = await findWebChatImportBoundaryViolations({ repoRoot: REPO_ROOT })
    expect(violations).toEqual([])
  })
})
