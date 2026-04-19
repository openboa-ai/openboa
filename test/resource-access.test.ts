import { mkdir, open, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  compareSessionWorkspaceArtifactToSubstrate,
  listStagedSubstrateDrafts,
  promoteSessionWorkspaceArtifact,
  restoreSessionWorkspaceArtifactVersion,
  stageSubstrateArtifactToSessionWorkspace,
} from "../src/agents/resources/resource-access.js"
import { SubstrateArtifactVersionStore } from "../src/agents/resources/version-store.js"
import { sandboxLockPathForRoot } from "../src/agents/sandbox/sandbox.js"
import { SessionStore } from "../src/agents/sessions/session-store.js"
import { createCompanyFixture, createOfflineCodexAgent } from "./helpers.js"

describe("resource access", () => {
  it("stages and promotes AGENTS.md through the session hand instead of mutating substrate in place", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    const originalAgents = await readFile(
      join(companyDir, ".openboa", "agents", "alpha", "workspace", "AGENTS.md"),
      "utf8",
    )
    expect(originalAgents).toContain("You are alpha, an openboa agent.")

    const staged = await stageSubstrateArtifactToSessionWorkspace({
      session,
      sourcePath: "AGENTS.md",
      targetPath: "drafts/AGENTS.md",
      overwrite: true,
    })
    expect(staged.targetPath).toBe("drafts/AGENTS.md")

    const stagedPath = join(
      companyDir,
      ".openboa",
      "agents",
      "alpha",
      "sessions",
      session.id,
      "workspace",
      "drafts",
      "AGENTS.md",
    )
    await writeFile(
      stagedPath,
      `${originalAgents.trim()}\n- Prefer bounded self-improvement through staged substrate edits.\n`,
      "utf8",
    )

    const comparison = await compareSessionWorkspaceArtifactToSubstrate({
      session,
      sessionPath: "drafts/AGENTS.md",
      substratePath: "AGENTS.md",
      maxPreviewLines: 6,
    })
    expect(comparison.identical).toBe(false)
    expect(comparison.sessionContentHash).not.toBe(comparison.substrateContentHash)

    const promoted = await promoteSessionWorkspaceArtifact({
      session,
      sourcePath: "drafts/AGENTS.md",
      targetPath: "AGENTS.md",
      overwrite: true,
    })
    expect(promoted.targetPath).toBe("AGENTS.md")

    const promotedAgents = await readFile(
      join(companyDir, ".openboa", "agents", "alpha", "workspace", "AGENTS.md"),
      "utf8",
    )
    expect(promotedAgents).toContain(
      "Prefer bounded self-improvement through staged substrate edits.",
    )
  })

  it("reuses an existing staged draft from the same substrate source instead of failing on retry", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    const firstStage = await stageSubstrateArtifactToSessionWorkspace({
      session,
      sourcePath: "SOUL.md",
      targetPath: "drafts/SOUL.md",
      overwrite: true,
    })
    expect(firstStage.reusedExisting).toBe(false)
    expect(firstStage.divergedFromSource).toBe(false)

    const stagedPath = join(
      companyDir,
      ".openboa",
      "agents",
      "alpha",
      "sessions",
      session.id,
      "workspace",
      "drafts",
      "SOUL.md",
    )
    await writeFile(stagedPath, "- Calm\n- Happy\n", "utf8")

    const secondStage = await stageSubstrateArtifactToSessionWorkspace({
      session,
      sourcePath: "SOUL.md",
      targetPath: "drafts/SOUL.md",
      overwrite: false,
    })
    expect(secondStage.targetPath).toBe("drafts/SOUL.md")
    expect(secondStage.reusedExisting).toBe(true)
    expect(secondStage.divergedFromSource).toBe(true)
    expect(secondStage.sourceContentHash).not.toBe(secondStage.targetContentHash)
  })

  it("reconciles staged draft status after successful promotion", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    await stageSubstrateArtifactToSessionWorkspace({
      session,
      sourcePath: "SOUL.md",
      targetPath: "drafts/SOUL.md",
      overwrite: true,
    })

    const stagedPath = join(
      companyDir,
      ".openboa",
      "agents",
      "alpha",
      "sessions",
      session.id,
      "workspace",
      "drafts",
      "SOUL.md",
    )
    const originalSoul = await readFile(
      join(companyDir, ".openboa", "agents", "alpha", "workspace", "SOUL.md"),
      "utf8",
    )
    await writeFile(stagedPath, `${originalSoul.trim()}\n- Happy\n`, "utf8")

    await promoteSessionWorkspaceArtifact({
      session,
      sourcePath: "drafts/SOUL.md",
      targetPath: "SOUL.md",
      overwrite: true,
    })

    const drafts = await listStagedSubstrateDrafts({ session })
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.sessionPath).toBe("drafts/SOUL.md")
    expect(drafts[0]?.substratePath).toBe("SOUL.md")
    expect(drafts[0]?.status).toBe("in_sync")
    expect(drafts[0]?.sourceChangedSinceStage).toBe(false)
    expect(drafts[0]?.draftChangedSinceStage).toBe(false)
  })

  it("still rejects staging onto an existing unrelated session file without overwrite", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    const targetPath = join(
      companyDir,
      ".openboa",
      "agents",
      "alpha",
      "sessions",
      session.id,
      "workspace",
      "drafts",
      "SOUL.md",
    )
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, "unrelated existing file", "utf8")

    await expect(
      stageSubstrateArtifactToSessionWorkspace({
        session,
        sourcePath: "SOUL.md",
        targetPath: "drafts/SOUL.md",
        overwrite: false,
      }),
    ).rejects.toThrow("already exists in the session workspace")
  })

  it("stages and promotes files across session hand and shared substrate", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    await mkdir(join(companyDir, ".openboa", "agents", "alpha", "workspace", "notes"), {
      recursive: true,
    })
    await writeFile(
      join(companyDir, ".openboa", "agents", "alpha", "workspace", "notes", "baseline.md"),
      "shared baseline",
      "utf8",
    )

    const staged = await stageSubstrateArtifactToSessionWorkspace({
      session,
      sourcePath: "notes/baseline.md",
      targetPath: "drafts/baseline.md",
      overwrite: true,
    })
    expect(staged.targetPath).toBe("drafts/baseline.md")

    await writeFile(
      join(
        companyDir,
        ".openboa",
        "agents",
        "alpha",
        "sessions",
        session.id,
        "workspace",
        "drafts",
        "baseline.md",
      ),
      "session edited baseline",
      "utf8",
    )

    const promoted = await promoteSessionWorkspaceArtifact({
      session,
      sourcePath: "drafts/baseline.md",
      targetPath: "notes/baseline-promoted.md",
      overwrite: true,
    })
    expect(promoted.targetPath).toBe("notes/baseline-promoted.md")

    const promotedText = await readFile(
      join(companyDir, ".openboa", "agents", "alpha", "workspace", "notes", "baseline-promoted.md"),
      "utf8",
    )
    expect(promotedText).toBe("session edited baseline")
  })

  it("accepts mounted resource paths when staging and promoting substrate artifacts", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    const originalSoul = await readFile(
      join(companyDir, ".openboa", "agents", "alpha", "workspace", "SOUL.md"),
      "utf8",
    )

    const staged = await stageSubstrateArtifactToSessionWorkspace({
      session,
      sourcePath: "/workspace/agent/SOUL.md",
      targetPath: "/workspace/drafts/SOUL.md",
      overwrite: true,
    })
    expect(staged.sourcePath).toBe("SOUL.md")
    expect(staged.targetPath).toBe("drafts/SOUL.md")

    const stagedPath = join(
      companyDir,
      ".openboa",
      "agents",
      "alpha",
      "sessions",
      session.id,
      "workspace",
      "drafts",
      "SOUL.md",
    )
    await writeFile(stagedPath, `${originalSoul.trim()}\n- Happy\n`, "utf8")

    const promoted = await promoteSessionWorkspaceArtifact({
      session,
      sourcePath: "/workspace/drafts/SOUL.md",
      targetPath: "/workspace/agent/SOUL.md",
      overwrite: true,
    })
    expect(promoted.sourcePath).toBe("drafts/SOUL.md")
    expect(promoted.targetPath).toBe("SOUL.md")

    const promotedSoul = await readFile(
      join(companyDir, ".openboa", "agents", "alpha", "workspace", "SOUL.md"),
      "utf8",
    )
    expect(promotedSoul).toContain("- Happy")
  })

  it("blocks promotion while the shared substrate root is busy", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    await mkdir(
      join(companyDir, ".openboa", "agents", "alpha", "sessions", session.id, "workspace", "notes"),
      { recursive: true },
    )
    await writeFile(
      join(
        companyDir,
        ".openboa",
        "agents",
        "alpha",
        "sessions",
        session.id,
        "workspace",
        "notes",
        "busy.md",
      ),
      "busy substrate write",
      "utf8",
    )

    const substrateRoot = join(companyDir, ".openboa", "agents", "alpha", "workspace")
    const lockPath = sandboxLockPathForRoot(substrateRoot)
    await mkdir(dirname(lockPath), { recursive: true })
    const lockHandle = await open(lockPath, "wx", 0o600)
    try {
      await lockHandle.writeFile("busy\n", "utf8")
    } finally {
      await lockHandle.close()
    }

    await expect(
      promoteSessionWorkspaceArtifact({
        session,
        sourcePath: "notes/busy.md",
        targetPath: "notes/busy-promoted.md",
        overwrite: true,
      }),
    ).rejects.toThrow("currently busy")
  })

  it("restores a recorded substrate version back into the shared substrate", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })
    const versionStore = new SubstrateArtifactVersionStore(companyDir)

    await mkdir(join(companyDir, ".openboa", "agents", "alpha", "workspace", "notes"), {
      recursive: true,
    })
    await writeFile(
      join(companyDir, ".openboa", "agents", "alpha", "workspace", "notes", "plan.md"),
      "current substrate",
      "utf8",
    )

    const version = await versionStore.recordPromotion({
      agentId: "alpha",
      sessionId: session.id,
      sourcePath: "drafts/plan.md",
      targetPath: "notes/plan.md",
      content: "restored substrate",
      createdAt: "2026-04-10T10:30:00.000Z",
      wakeId: "wake-restore",
    })
    const reread = await versionStore.readVersion({
      agentId: "alpha",
      versionId: version.versionId,
    })
    if (!reread) {
      throw new Error("missing recorded substrate version")
    }

    const restored = await restoreSessionWorkspaceArtifactVersion({
      session,
      targetPath: reread.record.targetPath,
      content: reread.content,
      overwrite: true,
    })
    expect(restored.targetPath).toBe("notes/plan.md")

    const restoredText = await readFile(
      join(companyDir, ".openboa", "agents", "alpha", "workspace", "notes", "plan.md"),
      "utf8",
    )
    expect(restoredText).toBe("restored substrate")
  })

  it("returns content hashes when comparing session workspace files to substrate", async () => {
    const companyDir = await createCompanyFixture()
    await createOfflineCodexAgent(companyDir, "alpha")
    const store = new SessionStore(companyDir)
    const session = await store.createSession({ agentId: "alpha" })

    await mkdir(join(companyDir, ".openboa", "agents", "alpha", "workspace", "notes"), {
      recursive: true,
    })
    await mkdir(
      join(
        companyDir,
        ".openboa",
        "agents",
        "alpha",
        "sessions",
        session.id,
        "workspace",
        "drafts",
      ),
      { recursive: true },
    )
    await writeFile(
      join(companyDir, ".openboa", "agents", "alpha", "workspace", "notes", "compare.md"),
      "shared substrate text",
      "utf8",
    )
    await writeFile(
      join(
        companyDir,
        ".openboa",
        "agents",
        "alpha",
        "sessions",
        session.id,
        "workspace",
        "drafts",
        "compare.md",
      ),
      "session revised text",
      "utf8",
    )

    const comparison = await compareSessionWorkspaceArtifactToSubstrate({
      session,
      sessionPath: "drafts/compare.md",
      substratePath: "notes/compare.md",
      maxPreviewLines: 4,
    })

    expect(comparison.sessionContentHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(comparison.substrateContentHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(comparison.sessionContentHash).not.toBe(comparison.substrateContentHash)
    expect(comparison.identical).toBe(false)
  })
})
