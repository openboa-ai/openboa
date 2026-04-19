import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { findChatLegacyNamingViolations } from "../scripts/check-chat-legacy-naming.mjs"

const REPO_ROOT = resolve(import.meta.dirname, "..")

describe("chat legacy naming guard", () => {
  it("keeps chat-owned code free of legacy company/openboa chat aliases and admin naming", async () => {
    const violations = await findChatLegacyNamingViolations({ repoRoot: REPO_ROOT })
    expect(violations).toEqual([])
  })
})
