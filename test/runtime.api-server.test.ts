import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { startChatApiServer } from "../src/runtime/api-server.js"
import type { ChatTurnInput, ChatTurnResult } from "../src/runtime/chat.js"

const temporaryRoots: string[] = []
const originalApiKey = process.env.CODEX_API_KEY

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), ".tmp-openboa-api-"))
  temporaryRoots.push(root)
  return root
}

beforeEach(() => {
  process.env.CODEX_API_KEY = "test-api-key"
})

afterEach(async () => {
  process.env.CODEX_API_KEY = originalApiKey
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("chat api server", () => {
  it("serves /health", async () => {
    const workspaceDir = await createWorkspace()
    const server = await startChatApiServer({
      workspaceDir,
      host: "127.0.0.1",
      port: 0,
    })

    const response = await fetch(`http://127.0.0.1:${server.port}/health`)
    const payload = (await response.json()) as { ok: boolean; service: string }

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.service).toBe("openboa-pi-chat")

    await server.close()
  })

  it("rejects /chat when CODEX_API_KEY is missing", async () => {
    process.env.CODEX_API_KEY = ""
    const workspaceDir = await createWorkspace()
    const server = await startChatApiServer({
      workspaceDir,
      host: "127.0.0.1",
      port: 0,
    })

    const response = await fetch(`http://127.0.0.1:${server.port}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    })

    const payload = (await response.json()) as { error: { code: string } }
    expect(response.status).toBe(503)
    expect(payload.error.code).toBe("missing_api_key")

    await server.close()
  })

  it("runs /chat with default ids and preserves continuity inputs", async () => {
    const workspaceDir = await createWorkspace()
    const executeChatTurn = vi.fn(
      async (input: ChatTurnInput): Promise<ChatTurnResult> => ({
        chunks: ["chunk-a", "chunk-b"],
        final: {
          kind: "turn.final",
          chatId: input.chatId,
          sessionId: input.sessionId,
          agentId: input.agentId,
          response: `echo:${input.message}`,
          checkpointId: `${input.sessionId}:checkpoint`,
          recoveredFromCheckpoint: false,
          recoveredCheckpointId: null,
          authMode: "codex-env",
        },
      }),
    )

    const server = await startChatApiServer({
      workspaceDir,
      host: "127.0.0.1",
      port: 0,
      executeChatTurn,
    })

    const first = await fetch(`http://127.0.0.1:${server.port}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    })
    const second = await fetch(`http://127.0.0.1:${server.port}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "again" }),
    })

    const firstPayload = (await first.json()) as {
      ok: boolean
      data: { chatId: string; sessionId: string; response: string }
    }
    const secondPayload = (await second.json()) as {
      ok: boolean
      data: { chatId: string; sessionId: string; response: string }
    }

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(firstPayload.ok).toBe(true)
    expect(secondPayload.ok).toBe(true)
    expect(firstPayload.data.chatId).toBe("api-chat")
    expect(firstPayload.data.sessionId).toBe("api-session")
    expect(secondPayload.data.chatId).toBe("api-chat")
    expect(secondPayload.data.sessionId).toBe("api-session")
    expect(executeChatTurn).toHaveBeenCalledTimes(2)

    await server.close()
  })

  it("enforces request size limits", async () => {
    const workspaceDir = await createWorkspace()
    const server = await startChatApiServer({
      workspaceDir,
      host: "127.0.0.1",
      port: 0,
      maxBodyBytes: 40,
    })

    const response = await fetch(`http://127.0.0.1:${server.port}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "this message should exceed the configured body limit" }),
    })

    const payload = (await response.json()) as { error: { code: string } }
    expect(response.status).toBe(413)
    expect(payload.error.code).toBe("payload_too_large")

    await server.close()
  })

  it("returns normalized timeout errors", async () => {
    const workspaceDir = await createWorkspace()
    const executeChatTurn = vi.fn(
      async () =>
        new Promise<ChatTurnResult>((resolve) => {
          setTimeout(
            () =>
              resolve({
                chunks: [],
                final: {
                  kind: "turn.final",
                  chatId: "api-chat",
                  sessionId: "api-session",
                  agentId: "pi-agent",
                  response: "late",
                  checkpointId: "api-session:checkpoint",
                  recoveredFromCheckpoint: false,
                  recoveredCheckpointId: null,
                  authMode: "codex-env",
                },
              }),
            50,
          )
        }),
    )

    const server = await startChatApiServer({
      workspaceDir,
      host: "127.0.0.1",
      port: 0,
      chatTimeoutMs: 10,
      executeChatTurn,
    })

    const response = await fetch(`http://127.0.0.1:${server.port}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    })

    const payload = (await response.json()) as { error: { code: string } }
    expect(response.status).toBe(504)
    expect(payload.error.code).toBe("chat_timeout")

    await server.close()
  })
})
