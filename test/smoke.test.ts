import { describe, expect, it } from "vitest"

import { createMinimalPiRuntime, OPENBOA_VERSION } from "../src/index.js"

describe("openboa bootstrap", () => {
  it("exposes a semantic version string", () => {
    expect(OPENBOA_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it("exposes minimal runtime factory", () => {
    const runtime = createMinimalPiRuntime(process.cwd())
    expect(runtime.gateway).toBeDefined()
    expect(runtime.runtime).toBeDefined()
  })
})
