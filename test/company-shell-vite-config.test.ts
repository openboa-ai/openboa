import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { buildShellViteConfig } from "../vite.config.js"

describe("company-shell vite config", () => {
  it("uses a relative asset base for build output so Electron file loading works", () => {
    const config = buildShellViteConfig("build")

    expect(config.base).toBe("./")
    expect(config.build.outDir).toBe(resolve(process.cwd(), "dist/web"))
  })

  it("keeps the dev server rooted at slash", () => {
    const config = buildShellViteConfig("serve")

    expect(config.base).toBe("/")
  })
})
