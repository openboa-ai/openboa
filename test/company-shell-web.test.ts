import { describe, expect, it } from "vitest"
import { demoCompanyShell } from "../src/shell/web/demo-shell.js"
import { buildCompanyShellFrame, resolveInitialSurface } from "../src/shell/web/frame-state.js"

describe("company-shell web frame", () => {
  it("defaults first run to chat and resumes valid last tab", () => {
    expect(resolveInitialSurface(null)).toBe("chat")
    expect(resolveInitialSurface("work", "chat")).toBe("work")
    expect(resolveInitialSurface("not-a-surface", "observe")).toBe("observe")
  })

  it("builds tab-specific sidebar sections", () => {
    const workFrame = buildCompanyShellFrame(demoCompanyShell, "work")
    expect(workFrame.sidebarSections.map((section) => section.label)).toEqual([
      "Queues",
      "Channels",
      "Participants",
    ])

    const observeFrame = buildCompanyShellFrame(demoCompanyShell, "observe")
    expect(observeFrame.sidebarSections.map((section) => section.label)).toEqual([
      "Queues",
      "Participants",
    ])
  })

  it("shows only one detail drawer at a time for the active surface", () => {
    const workFrame = buildCompanyShellFrame(demoCompanyShell, "work")
    expect(workFrame.detailPane).toBeNull()

    const observeFrame = buildCompanyShellFrame(demoCompanyShell, "observe")
    expect(observeFrame.detailPane).toBeNull()
  })
})
