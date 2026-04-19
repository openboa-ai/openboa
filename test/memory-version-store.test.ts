import { describe, expect, it } from "vitest"
import { ManagedMemoryVersionStore } from "../src/agents/memory/version-store.js"
import { createCompanyFixture } from "./helpers.js"

describe("managed memory version store", () => {
  it("records and rereads immutable versions for session-scoped stores", async () => {
    const companyDir = await createCompanyFixture()
    const store = new ManagedMemoryVersionStore(companyDir)

    const version = await store.recordVersion({
      agentId: "alpha",
      sessionId: "sess-1",
      target: "working_buffer",
      content: "- first working note",
      createdAt: "2026-04-10T10:00:00.000Z",
      source: "memory_write",
      mode: "append",
      wakeId: "wake-1",
    })

    const listed = await store.listVersions({
      agentId: "alpha",
      sessionId: "sess-1",
      target: "working_buffer",
      limit: 5,
    })
    const reread = await store.readVersion({
      agentId: "alpha",
      sessionId: "sess-1",
      target: "working_buffer",
      versionId: version.versionId,
    })

    expect(listed).toHaveLength(1)
    expect(listed[0]?.versionId).toBe(version.versionId)
    expect(listed[0]?.wakeId).toBe("wake-1")
    expect(reread?.record.versionId).toBe(version.versionId)
    expect(reread?.content).toBe("- first working note")
  })

  it("records and rereads immutable versions for shared workspace memory notes", async () => {
    const companyDir = await createCompanyFixture()
    const store = new ManagedMemoryVersionStore(companyDir)

    const version = await store.recordVersion({
      agentId: "alpha",
      sessionId: null,
      target: "workspace_memory_notes",
      content: "- durable managed note",
      createdAt: "2026-04-10T10:05:00.000Z",
      source: "memory_promote_note",
      mode: "append",
      wakeId: "wake-2",
    })

    const latest = await store.latestVersion({
      agentId: "alpha",
      sessionId: null,
      target: "workspace_memory_notes",
    })
    const reread = await store.readVersion({
      agentId: "alpha",
      sessionId: null,
      target: "workspace_memory_notes",
      versionId: version.versionId,
    })

    expect(latest?.versionId).toBe(version.versionId)
    expect(latest?.source).toBe("memory_promote_note")
    expect(reread?.content).toBe("- durable managed note")
  })
})
