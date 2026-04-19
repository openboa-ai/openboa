import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { findShellChatImportBoundaryViolations } from "../scripts/check-shell-chat-boundary.mjs"

const REPO_ROOT = resolve(import.meta.dirname, "..")

describe("shell chat import boundary", () => {
  it("allows shell chat to import only chat, shell-chat, or foundation modules via relative imports", async () => {
    const violations = await findShellChatImportBoundaryViolations({ repoRoot: REPO_ROOT })
    expect(violations).toEqual([])
  })
})
