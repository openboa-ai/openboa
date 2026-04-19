import { describe, expect, it } from "vitest"
import { resolveAuthTargets } from "../src/agents/auth/provider-auth-plan.js"

describe("resolveAuthTargets", () => {
  it("accepts openai-codex as a codex auth alias", () => {
    expect(resolveAuthTargets("openai-codex", "openai-codex")).toEqual(["codex"])
    expect(resolveAuthTargets("openai_codex", "openai-codex")).toEqual(["codex"])
  })

  it("reports the supported auth target values on invalid input", () => {
    expect(() => resolveAuthTargets("bogus", "openai-codex")).toThrow(
      "unsupported auth selection: bogus (expected one of: default, none, both, codex, openai-codex, claude-cli)",
    )
  })
})
