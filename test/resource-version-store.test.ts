import { describe, expect, it } from "vitest"
import { SubstrateArtifactVersionStore } from "../src/agents/resources/version-store.js"
import { createCompanyFixture } from "./helpers.js"

describe("substrate artifact version store", () => {
  it("records and rereads immutable promoted substrate versions", async () => {
    const companyDir = await createCompanyFixture()
    const store = new SubstrateArtifactVersionStore(companyDir)

    const version = await store.recordPromotion({
      agentId: "alpha",
      sessionId: "sess-1",
      sourcePath: "drafts/plan.md",
      targetPath: "notes/plan.md",
      content: "# plan\nshared baseline",
      createdAt: "2026-04-10T10:20:00.000Z",
      wakeId: "wake-1",
    })

    const listed = await store.listVersions({
      agentId: "alpha",
      targetPath: "notes/plan.md",
      limit: 5,
    })
    const reread = await store.readVersion({
      agentId: "alpha",
      versionId: version.versionId,
    })

    expect(listed).toHaveLength(1)
    expect(listed[0]?.versionId).toBe(version.versionId)
    expect(listed[0]?.sourcePath).toBe("drafts/plan.md")
    expect(reread?.record.targetPath).toBe("notes/plan.md")
    expect(reread?.content).toContain("shared baseline")
  })
})
