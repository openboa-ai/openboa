import { access, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { AgentLearningsStore } from "../src/agents/memory/learnings-store.js"
import {
  readAgentWorkspaceManagedMemoryNotes,
  syncAgentWorkspaceRuntimeLearnings,
  writeAgentWorkspaceManagedMemoryNotes,
} from "../src/agents/workspace/bootstrap-files.js"
import { createCompanyFixture, createOfflineCodexAgent } from "./helpers.js"

describe("workspace MEMORY bootstrap sections", () => {
  it("preserves managed memory notes when runtime learnings sync rewrites MEMORY.md", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")

    await writeAgentWorkspaceManagedMemoryNotes({
      companyDir,
      agentId: "alpha",
      content: "- durable operator preference",
      mode: "append",
    })

    await syncAgentWorkspaceRuntimeLearnings(companyDir, "alpha", [
      {
        kind: "lesson",
        title: "Session-first recall",
        detail: "Verify retrieval candidates with exact rereads before trusting them.",
      },
    ])

    const notes = await readAgentWorkspaceManagedMemoryNotes(companyDir, "alpha")
    expect(notes).toContain("durable operator preference")

    const memoryText = await readFile(
      join(companyDir, ".openboa", "agents", "alpha", "workspace", "MEMORY.md"),
      "utf8",
    )
    expect(memoryText).toContain("## Managed Memory Notes")
    expect(memoryText).toContain("durable operator preference")
    expect(memoryText).toContain("## Promoted Runtime Learnings")
    expect(memoryText).toContain("Session-first recall")
  })

  it("self-heals a legacy agent missing the shared workspace bootstrap", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")

    const workspaceDir = join(companyDir, ".openboa", "agents", "alpha", "workspace")
    await rm(workspaceDir, { recursive: true, force: true })

    const learningsStore = new AgentLearningsStore(companyDir)
    const memoryText = await learningsStore.readWorkspaceMemory("alpha")

    expect(memoryText).toContain("# MEMORY.md")
    await expect(access(join(workspaceDir, "MEMORY.md"))).resolves.toBeUndefined()

    const notes = await readAgentWorkspaceManagedMemoryNotes(companyDir, "alpha")
    expect(notes).toBeNull()
  })
})
