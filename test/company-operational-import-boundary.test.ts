import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

const FILES = [
  "src/shell/web/App.tsx",
  "src/shell/web/components/work/work-workspace.tsx",
  "src/shell/web/components/observe/observe-workspace.tsx",
] as const

describe("company operational import boundary", () => {
  it("keeps the app and operational workspaces free of direct demo shell imports", async () => {
    for (const filePath of FILES) {
      const source = await readFile(filePath, "utf8")
      expect(source).not.toContain("demo-shell")
      expect(source).not.toContain("demoCompanyShell")
    }
  })
})
