import { describe, expect, it } from "vitest"

import { OPENBOA_VERSION } from "../src/index.js"

describe("openboa bootstrap", () => {
  it("exposes a semantic version string", () => {
    expect(OPENBOA_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
