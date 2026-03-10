import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../src/runtime/setup.js", () => ({
  ensureOpenboaSetup: vi.fn(async (workspaceDir: string) => ({
    workspaceDir,
    created: true,
    bootstrapConfigPath: `${workspaceDir}/.openboa/bootstrap/runtime.json`,
    basePromptPath: `${workspaceDir}/.openboa/system/base.prompt`,
  })),
  ensureCodexPiAgentConfig: vi.fn(async (workspaceDir: string, agentId: string) => ({
    created: true,
    configPath: `${workspaceDir}/.openboa/agents/${agentId}/agent.json`,
  })),
}))

vi.mock("../src/runtime/chat.js", () => ({
  runChatTurn: vi.fn(async () => ({
    final: { response: "stored", kind: "turn.final", recoveredFromCheckpoint: false },
    chunks: ["hello"],
  })),
}))

vi.mock("../src/runtime/api-server.js", () => ({
  startChatApiServer: vi.fn(async () => ({
    host: "127.0.0.1",
    port: 8787,
  })),
}))

vi.mock("../src/runtime/auth/codex-oauth-login.js", () => ({
  runCodexOauthLoginAndSync: vi.fn(async () => ({ oauthPath: "/tmp/openboa/codex.oauth.json" })),
}))

vi.mock("../src/runtime/tui.js", () => ({
  runTuiChat: vi.fn(async () => {}),
}))

const { runCli } = await import("../src/index.js")

const { ensureOpenboaSetup, ensureCodexPiAgentConfig } = await import("../src/runtime/setup.js")
const { runChatTurn } = await import("../src/runtime/chat.js")
const { startChatApiServer } = await import("../src/runtime/api-server.js")
const { runCodexOauthLoginAndSync } = await import("../src/runtime/auth/codex-oauth-login.js")
const { runTuiChat } = await import("../src/runtime/tui.js")

describe("openboa command dispatch", () => {
  let originalCwd = process.cwd()
  let workspace = ""

  beforeEach(async () => {
    originalCwd = process.cwd()
    workspace = await mkdtemp(join(process.cwd(), ".tmp-openboa-cli-"))
    process.chdir(workspace)
    vi.spyOn(process.stdout, "write").mockImplementation(() => true)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    vi.restoreAllMocks()
    await rm(workspace, { recursive: true, force: true })
  })

  it("dispatches setup", async () => {
    await runCli(["setup"])
    expect(ensureOpenboaSetup).toHaveBeenCalledWith(workspace)
  })

  it("dispatches agent spawn", async () => {
    await runCli(["agent", "spawn", "--name", "agent_1"])
    expect(ensureCodexPiAgentConfig).toHaveBeenCalledWith(workspace, "agent_1")
  })

  it("dispatches agent chat", async () => {
    await runCli([
      "agent",
      "chat",
      "--name",
      "agent_1",
      "--chat-id",
      "c1",
      "--session-id",
      "s1",
      "--sender-id",
      "u1",
    ])

    expect(runTuiChat).toHaveBeenCalledWith(workspace, "agent_1", {
      chatId: "c1",
      sessionId: "s1",
      senderId: "u1",
    })
  })

  it("dispatches codex-login", async () => {
    await runCli(["codex-login"])
    expect(runCodexOauthLoginAndSync).toHaveBeenCalledWith(workspace)
  })

  it("dispatches service mode", async () => {
    await runCli(["serve"])
    expect(startChatApiServer).toHaveBeenCalledWith({
      workspaceDir: workspace,
      host: "0.0.0.0",
      port: 8787,
    })
  })

  it("dispatches one-shot chat", async () => {
    await runCli(["hello", "pi"])
    expect(runChatTurn).toHaveBeenCalledWith({
      workspaceDir: workspace,
      agentId: "pi-agent",
      chatId: "local-chat",
      sessionId: "local-session",
      senderId: "operator",
      message: "hello pi",
    })
  })

  it("returns validation error when malformed", async () => {
    await expect(runCli(["agent", "spawn"])).rejects.toThrow(
      "agent spawn requires --name <agent-id>",
    )
  })
})
