import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { runChatTurn } from "../src/runtime/chat.js"
import { ensureCodexPiAgentConfig } from "../src/runtime/setup.js"

const temporaryRoots: string[] = []

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), ".tmp-openboa-min-"))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("minimal requirement flow", () => {
  it("supports 1) setup 2) run 3) successful chat", async () => {
    const workspaceDir = await createWorkspace()

    // 1) setup
    const setup = await ensureCodexPiAgentConfig(workspaceDir, "pi-agent")
    expect(setup.created).toBe(true)

    // oauth-browser default credential source
    await mkdir(join(workspaceDir, ".openboa", "auth"), { recursive: true })
    await writeFile(
      join(workspaceDir, ".openboa", "auth", "codex.oauth.json"),
      JSON.stringify({ accessToken: "oauth-token", expiresAt: 4102444800 }),
      "utf8",
    )

    // 2) run + 3) chat success
    const result = await runChatTurn({
      workspaceDir,
      agentId: "pi-agent",
      chatId: "minimal-chat",
      sessionId: "minimal-session",
      senderId: "operator",
      message: "hello",
    })

    expect(result.final.kind).toBe("turn.final")
    expect(result.final.authMode).toBe("codex-oauth")
    expect(result.final.response).toContain("answer:hello")
    expect(result.chunks.length).toBeGreaterThan(0)
  })
})
