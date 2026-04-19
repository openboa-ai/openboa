import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { findChatImportBoundaryViolations } from "../scripts/check-chat-boundary.mjs"

const REPO_ROOT = resolve(import.meta.dirname, "..")

describe("chat import boundary", () => {
  it("allows chat to import only chat or foundation modules via relative imports", async () => {
    const violations = await findChatImportBoundaryViolations({ repoRoot: REPO_ROOT })
    expect(violations).toEqual([])
  })
})
