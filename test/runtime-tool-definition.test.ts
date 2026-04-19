import { describe, expect, it } from "vitest"
import { createRuntimeToolDefinition } from "../src/agents/tools/runtime-tool.js"

describe("runtime tool definition", () => {
  it("defaults managed tools to always_allow and preserves explicit MCP/custom policies", async () => {
    const managed = createRuntimeToolDefinition({
      name: "workspace_read",
      description: "Read a workspace file",
      execute: async () => "ok",
    })
    const mcp = createRuntimeToolDefinition({
      name: "connector_search",
      description: "Search MCP connector",
      ownership: "mcp",
      permissionPolicy: "always_ask",
      execute: async () => "ok",
    })

    expect(managed.ownership).toBe("managed")
    expect(managed.permissionPolicy).toBe("always_allow")
    expect(managed.readOnly).toBe(true)
    expect(managed.destructive).toBe(false)
    expect(managed.interruptBehavior).toBe("block")
    expect(managed.effects).toEqual([])
    expect(mcp.ownership).toBe("mcp")
    expect(mcp.permissionPolicy).toBe("always_ask")
  })
})
