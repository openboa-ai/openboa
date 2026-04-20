import { describe, expect, it } from "vitest"
import { createDemoOperationalShellState } from "../src/shell/web/company-shell-state.js"
import { buildCompanyShellFrame, resolveInitialSurface } from "../src/shell/web/frame-state.js"

describe("company-shell web frame", () => {
  it("defaults first run to chat and resumes valid last tab", () => {
    expect(resolveInitialSurface(null)).toBe("chat")
    expect(resolveInitialSurface("work", "chat")).toBe("work")
    expect(resolveInitialSurface("not-a-surface", "observe")).toBe("observe")
  })

  it("builds tab-specific sidebar sections", () => {
    const shell = createDemoOperationalShellState()
    const workFrame = buildCompanyShellFrame(shell, "work")
    expect(workFrame.sidebarSections.map((section) => section.label)).toEqual([
      "Queues",
      "Channels",
      "Participants",
    ])

    const observeFrame = buildCompanyShellFrame(shell, "observe")
    expect(observeFrame.sidebarSections.map((section) => section.label)).toEqual([
      "Queues",
      "Participants",
    ])
  })

  it("shows only one detail drawer at a time for the active surface", () => {
    const shell = createDemoOperationalShellState()
    const workFrame = buildCompanyShellFrame(shell, "work")
    expect(workFrame.detailPane).toBeNull()

    const observeFrame = buildCompanyShellFrame(shell, "observe")
    expect(observeFrame.detailPane).toBeNull()
  })
})
