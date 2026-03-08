import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { createMinimalPiRuntime } from "../src/runtime/factory.js"
import type { TurnEnvelope, TurnFinalEvent } from "../src/runtime/protocol.js"

const temporaryRoots: string[] = []

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), ".tmp-openboa-"))
  temporaryRoots.push(root)
  return root
}

async function collectFrames(
  workspaceDir: string,
  envelope: TurnEnvelope,
): Promise<Array<Record<string, unknown>>> {
  const { gateway } = createMinimalPiRuntime(workspaceDir)
  const frames: Array<Record<string, unknown>> = []
  for await (const frame of gateway.handleWebSocketMessage(JSON.stringify(envelope))) {
    frames.push(JSON.parse(frame) as Record<string, unknown>)
  }
  return frames
}

function buildEnvelope(overrides: Partial<TurnEnvelope> = {}): TurnEnvelope {
  return {
    protocol: "boa.turn.v1",
    chatId: "chat-1",
    sessionId: "session-1",
    agentId: "pi-agent",
    sender: { kind: "human", id: "fox-tail" },
    recipient: { kind: "agent", id: "pi-agent" },
    message: "status check",
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("minimal single-agent runtime on pi", () => {
  it("runs end-to-end turn and stores chat/session boundaries", async () => {
    const workspaceDir = await createWorkspace()

    const frames = await collectFrames(workspaceDir, buildEnvelope())

    const final = frames[frames.length - 1] as TurnFinalEvent
    expect(final.kind).toBe("turn.final")
    expect(final.response).toContain("answer:status check")

    const chatPath = join(workspaceDir, ".openboa", "chat", "chats", "chat-1.jsonl")
    const sessionPath = join(
      workspaceDir,
      ".openboa",
      "agents",
      "pi-agent",
      "sessions",
      "session-1.jsonl",
    )

    const chatLines = (await readFile(chatPath, "utf8")).trim().split("\n")
    const sessionLines = (await readFile(sessionPath, "utf8")).trim().split("\n")

    expect(chatLines).toHaveLength(2)
    expect(sessionLines).toHaveLength(1)
    expect(chatPath).not.toBe(sessionPath)
  })

  it("uses one protocol route for human-agent and agent-agent turns", async () => {
    const workspaceDir = await createWorkspace()

    await collectFrames(workspaceDir, {
      protocol: "boa.turn.v1",
      chatId: "chat-proto",
      sessionId: "session-proto",
      agentId: "pi-agent",
      sender: { kind: "human", id: "operator" },
      recipient: { kind: "agent", id: "pi-agent" },
      message: "human message",
    })

    await collectFrames(workspaceDir, {
      protocol: "boa.turn.v1",
      chatId: "chat-proto",
      sessionId: "session-proto",
      agentId: "pi-agent",
      sender: { kind: "agent", id: "agent-a" },
      recipient: { kind: "agent", id: "pi-agent" },
      message: "agent message",
    })

    const chatPath = join(workspaceDir, ".openboa", "chat", "chats", "chat-proto.jsonl")
    const parsed = (await readFile(chatPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; sender: { kind: string } })

    const inboundKinds = parsed
      .filter((entry) => entry.type === "inbound")
      .map((entry) => entry.sender.kind)
    expect(inboundKinds).toEqual(["human", "agent"])
  })

  it("recovers from latest session checkpoint after restart", async () => {
    const workspaceDir = await createWorkspace()

    const firstRun = await collectFrames(
      workspaceDir,
      buildEnvelope({
        chatId: "chat-restart",
        sessionId: "session-restart",
        sender: { kind: "human", id: "operator" },
        message: "first turn",
      }),
    )

    const firstFinal = firstRun[firstRun.length - 1] as TurnFinalEvent

    const bootstrapPath = join(workspaceDir, ".openboa", "bootstrap", "runtime.json")
    await mkdir(join(workspaceDir, ".openboa", "bootstrap"), { recursive: true })
    await writeFile(bootstrapPath, JSON.stringify({ tokenBudget: 400 }), { encoding: "utf8" })

    const secondRun = await collectFrames(
      workspaceDir,
      buildEnvelope({
        chatId: "chat-restart",
        sessionId: "session-restart",
        sender: { kind: "human", id: "operator" },
        message: "second turn",
      }),
    )

    const secondFinal = secondRun[secondRun.length - 1] as TurnFinalEvent

    expect(secondFinal.recoveredFromCheckpoint).toBe(true)
    expect(secondFinal.recoveredCheckpointId).toBe(firstFinal.checkpointId)
  })

  it("requires codex auth when agent config marks auth as required", async () => {
    const workspaceDir = await createWorkspace()
    await mkdir(join(workspaceDir, ".openboa", "agents", "pi-agent"), { recursive: true })
    await writeFile(
      join(workspaceDir, ".openboa", "agents", "pi-agent", "agent.json"),
      JSON.stringify({ runtime: "pi", auth: { provider: "codex", required: true } }),
      "utf8",
    )

    await expect(collectFrames(workspaceDir, buildEnvelope())).rejects.toThrow(
      "codex auth required for agent: pi-agent",
    )
  })

  it("supports codex-auth-required agent once token is configured", async () => {
    const workspaceDir = await createWorkspace()
    await mkdir(join(workspaceDir, ".openboa", "agents", "pi-agent"), { recursive: true })
    await writeFile(
      join(workspaceDir, ".openboa", "agents", "pi-agent", "agent.json"),
      JSON.stringify({ runtime: "pi", auth: { provider: "codex", required: true } }),
      "utf8",
    )
    await mkdir(join(workspaceDir, ".openboa", "auth"), { recursive: true })
    await writeFile(join(workspaceDir, ".openboa", "auth", "codex.token"), "token-value\n", "utf8")

    const frames = await collectFrames(
      workspaceDir,
      buildEnvelope({ message: "auth required turn" }),
    )
    const final = frames[frames.length - 1] as TurnFinalEvent
    expect(final.kind).toBe("turn.final")
    expect(final.authMode).toBe("codex-file")
  })

  it("runs minimal codex-auth pi conversation flow from agent setup", async () => {
    const workspaceDir = await createWorkspace()
    const agentDir = join(workspaceDir, ".openboa", "agents", "pi-agent")
    await mkdir(agentDir, { recursive: true })
    await writeFile(
      join(agentDir, "agent.json"),
      JSON.stringify({ runtime: "pi", auth: { provider: "codex", required: true } }),
      "utf8",
    )
    await mkdir(join(workspaceDir, ".openboa", "auth"), { recursive: true })
    await writeFile(join(workspaceDir, ".openboa", "auth", "codex.token"), "token-value\n", "utf8")

    const frames = await collectFrames(
      workspaceDir,
      buildEnvelope({
        chatId: "chat-codex-min",
        sessionId: "session-codex-min",
        message: "hello from codex setup",
      }),
    )

    const chunkCount = frames.filter((frame) => frame.kind === "turn.chunk").length
    const final = frames[frames.length - 1] as TurnFinalEvent
    expect(chunkCount).toBeGreaterThan(0)
    expect(final.kind).toBe("turn.final")
    expect(final.authMode).toBe("codex-file")
    expect(final.response).toContain("codex-auth")
    expect(final.response).toContain("answer:hello from codex setup")

    const chatPath = join(workspaceDir, ".openboa", "chat", "chats", "chat-codex-min.jsonl")
    const sessionPath = join(
      workspaceDir,
      ".openboa",
      "agents",
      "pi-agent",
      "sessions",
      "session-codex-min.jsonl",
    )
    const chatLines = (await readFile(chatPath, "utf8")).trim().split("\n")
    const sessionLines = (await readFile(sessionPath, "utf8")).trim().split("\n")

    expect(chatLines).toHaveLength(2)
    expect(sessionLines).toHaveLength(1)
  })
})
